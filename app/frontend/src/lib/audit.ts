/**
 * Preview self-check.
 *
 * The point is that the *product* finds the boring, obvious defects before the
 * user does: a page that renders blank, buttons wired to nothing, a stylesheet
 * that points at a file the model never wrote, a script that got truncated
 * mid-function. Two complementary passes:
 *
 * - `staticAudit`  reads the source files (structure, references, balance).
 * - `runtimeAudit` reads a live report posted back from the sandbox after load
 *                  (nodes rendered, listeners attached, thrown errors).
 *
 * Blocking findings (`level: 'error'`) can be fed straight back to the agent
 * through `auditPrompt`, which is what makes the loop self-healing.
 */

import type { ProjectFile } from './client';
import { ENTRY_FILE, entryHtml, fileLang, findFile } from './bundler';

export type AuditLevel = 'pass' | 'warn' | 'error';

export interface AuditCheck {
  id: string;
  label: string;
  level: AuditLevel;
  detail: string;
}

export interface AuditResult {
  checks: AuditCheck[];
  errors: AuditCheck[];
  warnings: AuditCheck[];
  ok: boolean;
  /** True once the runtime pass has contributed results. */
  runtimeSeen: boolean;
}

/** Live report posted from the preview sandbox. */
export interface RuntimeReport {
  nodes: number;
  bodyChars: number;
  buttons: number;
  listeners: number;
  inlineHandlers: number;
  canvases: number;
  inputs: number;
  errors: string[];
}

const PLACEHOLDER_PATTERN =
  /\b(TODO|FIXME|XXX)\b|待实现|此处省略|略去|你的代码|your code here|placeholder here/i;

function pass(id: string, label: string, detail: string): AuditCheck {
  return { id, label, level: 'pass', detail };
}

/** Strip strings, template literals, regex literals and comments so brace counting is usable. */
function stripNoise(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      out += '""';
      continue;
    }
    if (ch === '/' && next !== '/' && next !== '*') {
      // Heuristic regex literal (same logic as roles.ts): a '/' after an
      // operator starts a regex, not a division. Without this, /}/g-style
      // regexes miscount braces and cause false "script truncated" errors,
      // which then trigger pointless auto-repair rounds.
      const prev = out.length ? out[out.length - 1] : ' ';
      if (/[(=,:;!&|?{}[\n]/.test(prev)) {
        i += 1;
        let inClass = false;
        while (i < n) {
          const c = source[i];
          if (c === '\\') {
            i += 2;
            continue;
          }
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) {
            i += 1;
            break;
          } else if (c === '\n' && !inClass) break;
          i += 1;
        }
        out += '""';
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

function balance(source: string, open: string, close: string): number {
  let depth = 0;
  for (const ch of source) {
    if (ch === open) depth += 1;
    else if (ch === close) depth -= 1;
  }
  return depth;
}

/** Collect local (non-CDN) asset references declared by the entry document. */
function localRefs(html: string): string[] {
  const refs: string[] = [];
  const link = /<link\b[^>]*?href=["']([^"']+)["'][^>]*>/gi;
  let match = link.exec(html);
  while (match) {
    if (/stylesheet/i.test(match[0]) && !/^(https?:|\/\/|data:)/i.test(match[1])) {
      refs.push(match[1]);
    }
    match = link.exec(html);
  }
  const script = /<script\b[^>]*?src=["']([^"']+)["'][^>]*>/gi;
  match = script.exec(html);
  while (match) {
    if (!/^(https?:|\/\/|data:)/i.test(match[1])) refs.push(match[1]);
    match = script.exec(html);
  }
  return refs;
}

function refKey(ref: string): string {
  return ref.trim().replace(/^\.\//, '').replace(/^\/+/, '').split(/[?#]/)[0];
}

/**
 * Source-level pass. Runs instantly after generation and catches the failure
 * modes that used to reach the user as "it looks fine but nothing works".
 */
export function staticAudit(files: ProjectFile[]): AuditCheck[] {
  const checks: AuditCheck[] = [];

  if (files.length === 0) {
    return [
      {
        id: 'files',
        label: '项目文件',
        level: 'error',
        detail: '没有生成任何文件',
      },
    ];
  }

  // 1. entry document
  const html = entryHtml(files);
  if (!html.trim()) {
    checks.push({
      id: 'entry',
      label: '入口文件',
      level: 'error',
      detail: `缺少 ${ENTRY_FILE}`,
    });
  } else if (!/<\/html\s*>/i.test(html)) {
    checks.push({
      id: 'entry',
      label: '入口文件',
      level: 'error',
      detail: `${ENTRY_FILE} 没有写到 </html>，代码被截断了`,
    });
  } else {
    checks.push(pass('entry', '入口文件', `${ENTRY_FILE} 结构完整`));
  }

  // 2. local references resolve
  const refs = localRefs(html);
  const missing = refs.filter((ref) => !findFile(files, refKey(ref)));
  if (missing.length) {
    checks.push({
      id: 'refs',
      label: '文件引用',
      level: 'error',
      detail: `引用了不存在的文件：${missing.join('、')}`,
    });
  } else {
    checks.push(
      pass('refs', '文件引用', refs.length ? `${refs.length} 个本地引用都能找到` : '没有外部本地引用'),
    );
  }

  // 3. no empty files
  const empty = files.filter((file) => file.content.trim().length < 8);
  if (empty.length) {
    checks.push({
      id: 'empty',
      label: '空文件',
      level: 'error',
      detail: `内容为空：${empty.map((file) => file.path).join('、')}`,
    });
  } else {
    checks.push(pass('empty', '空文件', `${files.length} 个文件都有内容`));
  }

  // 4. script tags paired inside the entry document
  const openScripts = (html.match(/<script\b/gi) || []).length;
  const closeScripts = (html.match(/<\/script\s*>/gi) || []).length;
  if (openScripts !== closeScripts) {
    checks.push({
      id: 'script-tags',
      label: 'script 标签',
      level: 'error',
      detail: `${openScripts} 个 <script> 只闭合了 ${closeScripts} 个`,
    });
  } else {
    checks.push(pass('script-tags', 'script 标签', '开合成对'));
  }

  // 5. JS brace / paren balance
  const jsFiles = files.filter((file) => fileLang(file.path) === 'js');
  const broken = jsFiles
    .map((file) => {
      const clean = stripNoise(file.content);
      return {
        path: file.path,
        braces: balance(clean, '{', '}'),
        parens: balance(clean, '(', ')'),
      };
    })
    .filter((item) => item.braces !== 0 || item.parens !== 0);
  if (broken.length) {
    checks.push({
      id: 'js-balance',
      label: '脚本完整性',
      level: 'error',
      detail: broken
        .map((item) => `${item.path} 括号不配平（{} 差 ${item.braces}，() 差 ${item.parens}）`)
        .join('；'),
    });
  } else {
    checks.push(
      pass('js-balance', '脚本完整性', jsFiles.length ? `${jsFiles.length} 个脚本括号配平` : '无独立脚本文件'),
    );
  }

  // 6. placeholders left behind
  const placeholders = files.filter((file) => PLACEHOLDER_PATTERN.test(file.content));
  if (placeholders.length) {
    checks.push({
      id: 'placeholder',
      label: '未完成占位',
      level: 'warn',
      detail: `${placeholders.map((file) => file.path).join('、')} 里还留着 TODO / 占位文字`,
    });
  } else {
    checks.push(pass('placeholder', '未完成占位', '没有发现 TODO 或占位文字'));
  }

  // 7. interactivity actually declared somewhere
  const allSource = files.map((file) => file.content).join('\n');
  const hasInteraction =
    /addEventListener\s*\(/.test(allSource) ||
    /\bon(click|input|change|submit|keydown)\s*=/i.test(allSource);
  const hasControls = /<(button|input|select|textarea|a\s)/i.test(html);
  if (hasControls && !hasInteraction) {
    checks.push({
      id: 'interaction',
      label: '交互绑定',
      level: 'error',
      detail: '页面有按钮/输入框，但源码里找不到任何事件绑定',
    });
  } else {
    checks.push(
      pass('interaction', '交互绑定', hasInteraction ? '已声明事件处理' : '静态页面，无需事件'),
    );
  }

  // 8. stylesheet reachable
  const cssFiles = files.filter((file) => fileLang(file.path) === 'css');
  const unusedCss = cssFiles.filter(
    (file) => !refs.some((ref) => refKey(ref).toLowerCase() === file.path.toLowerCase()),
  );
  if (cssFiles.length && unusedCss.length) {
    checks.push({
      id: 'css-link',
      label: '样式接入',
      level: 'warn',
      detail: `${unusedCss.map((file) => file.path).join('、')} 没有被 index.html 引用`,
    });
  } else if (cssFiles.length || /<style[\s>]/i.test(html) || /cdn\.tailwindcss\.com/i.test(html)) {
    checks.push(pass('css-link', '样式接入', '样式已接入页面'));
  } else {
    checks.push({
      id: 'css-link',
      label: '样式接入',
      level: 'warn',
      detail: '没有发现任何样式，页面可能是浏览器默认外观',
    });
  }

  // 9. mobile viewport
  if (/<meta[^>]+name=["']viewport["']/i.test(html)) {
    checks.push(pass('viewport', '移动端适配', '声明了 viewport'));
  } else {
    checks.push({
      id: 'viewport',
      label: '移动端适配',
      level: 'warn',
      detail: '缺少 viewport meta，手机上会被缩放',
    });
  }

  return checks;
}

/**
 * Runtime pass. Interprets the probe report from the sandbox — this is what
 * distinguishes "rendered" from "actually alive".
 */
export function runtimeAudit(report: RuntimeReport, files: ProjectFile[]): AuditCheck[] {
  const checks: AuditCheck[] = [];

  if (report.errors.length) {
    checks.push({
      id: 'runtime-error',
      label: '运行时报错',
      level: 'error',
      detail: report.errors.slice(0, 2).join('；'),
    });
  } else {
    checks.push(pass('runtime-error', '运行时报错', '加载过程没有抛错'));
  }

  const almostBlank = report.nodes < 8 && report.bodyChars < 24 && report.canvases === 0;
  if (almostBlank) {
    checks.push({
      id: 'render',
      label: '页面渲染',
      level: 'error',
      detail: `页面几乎是空白的（${report.nodes} 个元素、${report.bodyChars} 个字符）`,
    });
  } else {
    checks.push(
      pass('render', '页面渲染', `渲染出 ${report.nodes} 个元素、${report.bodyChars} 个字符`),
    );
  }

  const interactive = report.buttons + report.inputs;
  if (interactive > 0 && report.listeners === 0 && report.inlineHandlers === 0) {
    checks.push({
      id: 'runtime-wiring',
      label: '控件是否可用',
      level: 'error',
      detail: `有 ${interactive} 个按钮/输入框，但运行后没有任何事件被绑定，点了不会有反应`,
    });
  } else if (interactive === 0 && report.canvases === 0 && files.length > 0) {
    checks.push({
      id: 'runtime-wiring',
      label: '控件是否可用',
      level: 'warn',
      detail: '页面里没有可交互控件',
    });
  } else {
    checks.push(
      pass(
        'runtime-wiring',
        '控件是否可用',
        `${interactive} 个控件 · ${report.listeners + report.inlineHandlers} 处事件绑定`,
      ),
    );
  }

  return checks;
}

/** Combine passes, de-duplicating by check id (runtime results win). */
export function mergeAudit(
  staticChecks: AuditCheck[],
  runtimeChecks: AuditCheck[] | null,
): AuditResult {
  const map = new Map<string, AuditCheck>();
  staticChecks.forEach((check) => map.set(check.id, check));
  (runtimeChecks || []).forEach((check) => map.set(check.id, check));
  const checks = Array.from(map.values());
  const errors = checks.filter((check) => check.level === 'error');
  const warnings = checks.filter((check) => check.level === 'warn');
  return {
    checks,
    errors,
    warnings,
    ok: errors.length === 0,
    runtimeSeen: Boolean(runtimeChecks?.length),
  };
}

export function emptyAudit(): AuditResult {
  return { checks: [], errors: [], warnings: [], ok: true, runtimeSeen: false };
}

/** Turn blocking findings into a repair instruction for the agent. */
export function auditPrompt(result: AuditResult): string {
  const lines = result.errors.map((check, index) => `${index + 1}. ${check.label}：${check.detail}`);
  const extra = result.warnings
    .slice(0, 2)
    .map((check) => `- ${check.label}：${check.detail}`)
    .join('\n');
  return `自动检查发现下面这些问题，请逐条定位并修复，然后重新输出被改动文件的完整内容：

${lines.join('\n')}${extra ? `\n\n顺带留意（非阻塞）：\n${extra}` : ''}

修复要求：不要改动无关功能，不要重写整个项目，确保每个按钮和输入框都真的绑定了处理逻辑。`;
}

/** Type guard for the probe payload arriving over postMessage. */
export function isRuntimeReport(value: unknown): value is RuntimeReport {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RuntimeReport>;
  return typeof item.nodes === 'number' && Array.isArray(item.errors);
}