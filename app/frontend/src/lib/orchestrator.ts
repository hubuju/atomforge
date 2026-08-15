/**
 * Orchestrator + blackboard.
 *
 * The roles themselves are just prompts (see `roles.ts`); what actually makes
 * this a multi-agent system is the machinery here:
 *
 * - a **blackboard**: spec, file set and findings are shared state, not chat
 *   history, so each role reads exactly what it needs and nothing else;
 * - an **orchestrator** that drives Planner → Coder(×N files) → Reviewer →
 *   Fixer with a hard cap on repair loops, so it can never spin forever;
 * - a **lane board** that records every role's model, elapsed time, streamed
 *   size and input/output digest, which is what the swimlane UI renders.
 *
 * Planning and building are two separate entry points on purpose: when the
 * "confirm spec" setting is on, the workspace stops between them and lets the
 * user edit the spec before a single line of code is written.
 */

import { mergeFiles, streamChat, type ChatTurn } from './agent';
import { ENTRY_FILE } from './bundler';
import type { ProjectFile } from './client';
import {
  actionableFindings,
  coderMessages,
  continueFileMessages,
  fileLooksComplete,
  fixerMessages,
  parseFindings,
  parseSpec,
  plannerMessages,
  repairJsonMessages,
  reviewerMessages,
  ROLE_META,
  SEVERITY_LABEL,
  specDigest,
  specHeadline,
  stripCodeFence,
  type ProjectSpec,
  type ReviewFinding,
  type SpecFile,
} from './roles';
import {
  resolveRoleSettings,
  roleModelLabel,
  ROLE_IDS,
  type ModelSettings,
  type RoleId,
} from './settings';

export type LaneStatus = 'idle' | 'active' | 'done' | 'failed' | 'skipped';

/** Per-role execution record rendered as one swimlane. */
export interface Lane {
  role: RoleId;
  status: LaneStatus;
  /** What this role is doing / did, one short line. */
  detail: string;
  /** Model actually used (global or per-role override). */
  model: string;
  /** Streamed characters produced so far. */
  chars: number;
  /** Wall-clock duration in ms once finished. */
  ms: number;
  /** Digest of what was handed in. */
  input: string;
  /** Digest of what came out. */
  output: string;
}

/** Shared state every role reads from and writes to. */
export interface Blackboard {
  brief: string;
  spec: ProjectSpec | null;
  files: ProjectFile[];
  findings: ReviewFinding[];
  rounds: number;
}

export function emptyLanes(settings: ModelSettings): Lane[] {
  return ROLE_IDS.map((role) => ({
    role,
    status: 'idle' as LaneStatus,
    detail: '等待上游',
    model: roleModelLabel(settings, role),
    chars: 0,
    ms: 0,
    input: '',
    output: '',
  }));
}

/**
 * Mutable lane state with throttled notification — a streaming role would
 * otherwise re-render the panel on every token.
 */
export class LaneBoard {
  private lanes = new Map<RoleId, Lane>();
  private startedAt = new Map<RoleId, number>();
  private lastFlush = new Map<RoleId, number>();
  private notify: (lanes: Lane[]) => void;

  constructor(settings: ModelSettings, notify: (lanes: Lane[]) => void) {
    this.notify = notify;
    emptyLanes(settings).forEach((lane) => this.lanes.set(lane.role, lane));
    this.flush();
  }

  list(): Lane[] {
    return ROLE_IDS.map((role) => ({ ...(this.lanes.get(role) as Lane) }));
  }

  private flush(): void {
    this.notify(this.list());
  }

  patch(role: RoleId, patch: Partial<Lane>): void {
    const lane = this.lanes.get(role);
    if (!lane) return;
    this.lanes.set(role, { ...lane, ...patch });
    this.flush();
  }

  start(role: RoleId, detail: string): void {
    this.startedAt.set(role, Date.now());
    this.lastFlush.set(role, 0);
    this.patch(role, { status: 'active', detail, chars: 0, ms: 0 });
  }

  /** Count streamed characters without flooding React with updates. */
  bump(role: RoleId, delta: number): void {
    const lane = this.lanes.get(role);
    if (!lane) return;
    const chars = lane.chars + delta;
    this.lanes.set(role, { ...lane, chars });
    const last = this.lastFlush.get(role) || 0;
    if (chars - last >= 260) {
      this.lastFlush.set(role, chars);
      this.flush();
    }
  }

  private elapsed(role: RoleId): number {
    const started = this.startedAt.get(role);
    return started ? Date.now() - started : 0;
  }

  done(role: RoleId, detail: string, output?: string): void {
    this.patch(role, {
      status: 'done',
      detail,
      ms: this.elapsed(role),
      ...(output === undefined ? {} : { output: output.slice(0, 1200) }),
    });
  }

  fail(role: RoleId, detail: string): void {
    this.patch(role, { status: 'failed', detail, ms: this.elapsed(role) });
  }

  skip(role: RoleId, detail: string): void {
    this.patch(role, { status: 'skipped', detail });
  }
}

/** Run one role, attributing streamed output to its lane. */
async function callRole(
  board: LaneBoard,
  role: RoleId,
  settings: ModelSettings,
  messages: ChatTurn[],
  inputDigest: string,
): Promise<string> {
  const roleSettings = resolveRoleSettings(settings, role);
  board.patch(role, { input: inputDigest.slice(0, 1200) });
  const raw = await streamChat(messages, roleSettings, (delta) => board.bump(role, delta.length));
  if (!raw.trim()) throw new Error(`${ROLE_META[role].name}没有返回任何内容`);
  return raw;
}

/**
 * A truncated file (HTML missing </html>, CSS/JS with unbalanced braces) used
 * to ship as-is and crash the preview at the first addEventListener. When the
 * model hits its output cap mid-file, append continuation rounds until the
 * file looks complete.
 *
 * Crucially, an *empty* response must never destroy the progress already made:
 * DeepSeek V4 thinks before answering, and a continuation round can burn its
 * whole budget on `reasoning_content` and produce zero `content`. In that case
 * we keep the partial file (the audit layer will flag the truncation) instead
 * of throwing the whole Coder stage away.
 */
async function writeFileComplete(
  board: LaneBoard,
  settings: ModelSettings,
  role: 'coder' | 'fixer',
  path: string,
  firstMessages: ChatTurn[],
  inputDigest: string,
): Promise<{ content: string; complete: boolean }> {
  let content = '';
  try {
    const raw = await callRole(board, role, settings, firstMessages, inputDigest);
    content = stripCodeFence(raw, path);
  } catch {
    // First attempt produced nothing (thinking swallowed the budget). One
    // explicit retry before giving up on the round.
    board.patch(role, { detail: `${path} 首轮没有正文输出，正在重试` });
    try {
      const raw = await callRole(
        board,
        role,
        settings,
        [
          ...firstMessages,
          {
            role: 'user' as const,
            content:
              '（上一轮请求没有返回任何正文内容。请直接输出结果本身，不要只输出思考过程，不要解释。）',
          },
        ],
        `重试 ${path}`,
      );
      content = stripCodeFence(raw, path);
    } catch {
      content = '';
    }
  }

  for (let attempt = 0; attempt < 2 && content && !fileLooksComplete(content, path); attempt += 1) {
    board.patch(role, { detail: `${path} 被截断，正在续写（${attempt + 1}/2）` });
    try {
      const more = await callRole(
        board,
        role,
        settings,
        continueFileMessages(path, content, role),
        `续写 ${path}`,
      );
      const tail = stripCodeFence(more, path);
      if (tail) content = `${content.replace(/\s+$/, '')}\n${tail}`;
    } catch {
      // Continuation round came back empty — keep the partial file rather
      // than throwing away everything written so far.
      break;
    }
  }

  return { content, complete: fileLooksComplete(content, path) };
}

/* ------------------------------------------------------------------ */
/* Stage 1 — Planner                                                   */
/* ------------------------------------------------------------------ */

export interface PlanOptions {
  brief: string;
  files: ProjectFile[];
  settings: ModelSettings;
  board: LaneBoard;
}

/**
 * Turn the brief into a spec. Structured output is validated, with exactly one
 * repair attempt, because everything downstream depends on it.
 */
export async function planProject({
  brief,
  files,
  settings,
  board,
}: PlanOptions): Promise<ProjectSpec> {
  board.start('planner', files.length ? '分析改动范围' : '拆解需求');

  try {
    const raw = await callRole(
      board,
      'planner',
      settings,
      plannerMessages(brief, files, settings.maxFiles),
      brief,
    );

    let spec: ProjectSpec;
    try {
      spec = parseSpec(raw, settings.maxFiles);
    } catch {
      board.patch('planner', { detail: '规格格式不合法，正在重写' });
      const repaired = await callRole(board, 'planner', settings, repairJsonMessages(raw), brief);
      spec = parseSpec(repaired, settings.maxFiles);
    }

    board.done('planner', specHeadline(spec), specDigest(spec));
    return spec;
  } catch (error) {
    board.fail('planner', error instanceof Error ? error.message : '规划失败');
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Stage 2 — Coder / Reviewer / Fixer                                  */
/* ------------------------------------------------------------------ */

export interface BuildOptions {
  spec: ProjectSpec;
  files: ProjectFile[];
  settings: ModelSettings;
  board: LaneBoard;
  /** Live file set after each written or repaired file. */
  onFiles: (files: ProjectFile[], writing: string) => void;
}

export interface BuildOutcome {
  files: ProjectFile[];
  findings: ReviewFinding[];
  /** Reviewer passes actually executed. */
  rounds: number;
  /** Paths the Fixer rewrote. */
  fixed: string[];
  /** Set when review output could not be parsed at all. */
  reviewSkipped: boolean;
}

/** Entry document first: everything else references its ids and class names. */
function orderPlan(plan: SpecFile[]): SpecFile[] {
  const weight = (path: string) => (path.toLowerCase() === ENTRY_FILE ? 0 : 1);
  return [...plan].sort((a, b) => weight(a.path) - weight(b.path));
}

function findingsSummary(findings: ReviewFinding[]): string {
  if (!findings.length) return '没有发现问题';
  const blockers = findings.filter((item) => item.severity === 'blocker').length;
  const majors = findings.filter((item) => item.severity === 'major').length;
  const minors = findings.length - blockers - majors;
  return [
    blockers ? `${blockers} 个阻塞` : '',
    majors ? `${majors} 处偏差` : '',
    minors ? `${minors} 条打磨` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Write every planned file, review the result, then repair only what was
 * flagged. The Reviewer → Fixer loop is bounded by `maxRepairRounds`.
 */
export async function buildProject({
  spec,
  files,
  settings,
  board,
  onFiles,
}: BuildOptions): Promise<BuildOutcome> {
  const plan = orderPlan(spec.files);
  let working = [...files];

  /* ---- Coder: one call per file ---- */
  board.start('coder', `准备写 ${plan.length} 个文件`);
  try {
    for (let index = 0; index < plan.length; index += 1) {
      const target = plan[index];
      board.patch('coder', {
        detail: `写 ${target.path}（${index + 1}/${plan.length}）`,
        chars: 0,
      });

      const previous =
        working.find((file) => file.path.toLowerCase() === target.path.toLowerCase())?.content || '';

      const { content, complete } = await writeFileComplete(
        board,
        settings,
        'coder',
        target.path,
        coderMessages({
          spec,
          target,
          written: working,
          pending: plan.slice(index + 1),
          previous,
          index,
          total: plan.length,
        }),
        `${target.path} · ${target.purpose}`,
      );

      if (!content) throw new Error(`${target.path} 写出来是空的`);
      if (!complete) {
        board.patch('coder', { detail: `${target.path} 内容不完整（已保留，交给自检兜底）` });
      }

      working = mergeFiles(working, [{ path: target.path, content }]);
      onFiles(working, target.path);
    }
  } catch (error) {
    board.fail('coder', error instanceof Error ? error.message : '写文件失败');
    throw error;
  }

  board.done(
    'coder',
    `${plan.length} 个文件已写入`,
    plan.map((file) => file.path).join('、'),
  );

  /* ---- Reviewer / Fixer loop (configurable) ---- */
  let findings: ReviewFinding[] = [];
  let rounds = 0;
  let reviewSkipped = false;
  const fixed: string[] = [];
  const maxRounds = Math.max(1, settings.maxRepairRounds + 1);

  if (!settings.reviewFix) {
    board.skip('reviewer', '审查已关闭（设置里可重新开启）');
    board.skip('fixer', '修复已关闭（设置里可重新开启）');
    return { files: working, findings, rounds: 0, fixed, reviewSkipped: true };
  }

  for (let round = 1; round <= maxRounds; round += 1) {
    rounds = round;
    board.start('reviewer', round === 1 ? '对照规格审查代码' : `第 ${round} 轮复查`);

    try {
      const raw = await callRole(
        board,
        'reviewer',
        settings,
        reviewerMessages(spec, working, round),
        `${working.length} 个文件 · 第 ${round} 轮`,
      );
      try {
        findings = parseFindings(raw);
      } catch {
        board.patch('reviewer', { detail: '审查结果格式异常，正在重写' });
        const repaired = await callRole(
          board,
          'reviewer',
          settings,
          repairJsonMessages(raw),
          '修正审查 JSON',
        );
        findings = parseFindings(repaired);
      }
      board.done(
        'reviewer',
        findingsSummary(findings),
        findings
          .map((item) => `[${item.severity}] ${item.file || '全局'}：${item.detail}`)
          .join('\n'),
      );
    } catch {
      // Review is a safety net, not the deliverable: never fail the round
      // because the critic misbehaved — say so and keep the generated code.
      reviewSkipped = true;
      findings = [];
      board.skip('reviewer', '审查结果无法解析，本轮跳过审查');
      break;
    }

    const targets = actionableFindings(findings);
    if (!targets.length) {
      if (round === 1) board.skip('fixer', '没有需要修复的问题');
      break;
    }
    if (settings.maxRepairRounds === 0) {
      board.skip('fixer', '自动修复已关闭');
      break;
    }
    if (round > settings.maxRepairRounds) {
      board.skip('fixer', `已达修复轮次上限（${settings.maxRepairRounds}）`);
      break;
    }

    /* ---- Fixer: one call per affected file ---- */
    const grouped = new Map<string, ReviewFinding[]>();
    targets.forEach((item) => {
      const file = working.find((entry) => entry.path.toLowerCase() === item.file.toLowerCase());
      if (!file) return;
      const list = grouped.get(file.path) || [];
      list.push(item);
      grouped.set(file.path, list);
    });

    if (!grouped.size) {
      board.skip('fixer', '问题没有定位到具体文件，交给自检兜底');
      break;
    }

    board.start('fixer', `修复 ${grouped.size} 个文件`);
    try {
      let position = 0;
      for (const [path, items] of grouped) {
        position += 1;
        board.patch('fixer', { detail: `修 ${path}（${position}/${grouped.size}）`, chars: 0 });
        const file = working.find((entry) => entry.path === path);
        if (!file) continue;

        const { content } = await writeFileComplete(
          board,
          settings,
          'fixer',
          path,
          fixerMessages({ spec, file, findings: items, siblings: working }),
          items.map((item) => item.detail).join('；'),
        );
        if (!content) continue;

        working = mergeFiles(working, [{ path, content }]);
        if (!fixed.includes(path)) fixed.push(path);
        onFiles(working, path);
      }
      board.done('fixer', `已修复 ${fixed.join('、') || '（无改动）'}`, fixed.join('、'));
    } catch (error) {
      // A failed repair still leaves the reviewed code in place.
      board.fail('fixer', error instanceof Error ? error.message : '修复失败');
      break;
    }
  }

  return { files: working, findings, rounds, fixed, reviewSkipped };
}

/** Chat-bubble text describing what the pipeline produced. */
export function outcomeNarrative(spec: ProjectSpec, outcome: BuildOutcome): string {
  const lines = [
    `${spec.title}：${spec.summary}`,
    `实现者写了 ${outcome.files.length} 个文件（${outcome.files
      .map((file) => file.path)
      .join('、')}）。`,
  ];

  if (outcome.reviewSkipped) {
    lines.push('本轮未运行模型审查（设置中已关闭），静态体检已兜底。');
  } else if (!outcome.findings.length) {
    lines.push('审查者没有发现问题。');
  } else {
    lines.push(`审查者提出 ${findingsSummary(outcome.findings)}。`);
    if (outcome.fixed.length) {
      lines.push(`修复者重写了 ${outcome.fixed.join('、')}。`);
    } else if (actionableFindings(outcome.findings).length) {
      const remaining = actionableFindings(outcome.findings)
        .map((item) => `- [${SEVERITY_LABEL[item.severity]}] ${item.file || '全局'}：${item.detail}`)
        .join('\n');
      lines.push(`修复轮次已用完，以下问题仍未解决：\n${remaining}`);
    } else {
      lines.push('其中没有需要动代码的阻塞项。');
    }
  }

  return lines.join('\n');
}

/** Human-readable duration for the lane footer. */
export function formatMs(ms: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}