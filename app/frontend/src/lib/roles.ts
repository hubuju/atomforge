/**
 * The four roles of the generation pipeline.
 *
 * A single prompt asked to "understand the requirement, write every file, then
 * check its own work" is the reason complex briefs come back half-implemented:
 * one context, one shot, no separation of concerns. Here each role gets a short,
 * focused prompt and a narrow contract:
 *
 * - Planner  : brief            -> structured spec (JSON, user-editable)
 * - Coder    : spec + one file  -> that file's full content (one call per file)
 * - Reviewer : spec + all files -> findings list (JSON, severity + location)
 * - Fixer    : findings + file  -> that file repaired, nothing else touched
 *
 * The spec, the file set and the findings live on a shared blackboard (see
 * `orchestrator.ts`) instead of being passed along as chat history, so every
 * role reads exactly the state it needs.
 */

import type { ChatTurn } from './agent';
import { fileLang, type FileLang } from './bundler';
import type { ProjectFile } from './client';
import type { RoleId } from './settings';

export interface RoleMeta {
  id: RoleId;
  /** Chinese display name. */
  name: string;
  /** Latin short name shown next to it. */
  short: string;
  /** One line describing what this role is responsible for. */
  duty: string;
  /** What it consumes / produces, shown in the lane tooltip. */
  io: string;
}

export const ROLE_META: Record<RoleId, RoleMeta> = {
  planner: {
    id: 'planner',
    name: '规划者',
    short: 'Planner',
    duty: '把一句话需求拆成可执行的规格：界面、数据、交互、文件划分',
    io: '需求 → 规格',
  },
  coder: {
    id: 'coder',
    name: '实现者',
    short: 'Coder',
    duty: '只看规格，按文件逐个写出完整代码，一次一个文件',
    io: '规格 → 源码',
  },
  reviewer: {
    id: 'reviewer',
    name: '审查者',
    short: 'Reviewer',
    duty: '对照规格审查代码，输出定位到文件的问题清单',
    io: '源码 → 问题清单',
  },
  fixer: {
    id: 'fixer',
    name: '修复者',
    short: 'Fixer',
    duty: '只修被点名的问题，不重写无关文件',
    io: '问题清单 → 修复后的文件',
  },
};

/** One file the Planner decided the project needs. */
export interface SpecFile {
  path: string;
  purpose: string;
}

/** The structured, user-editable contract every downstream role reads. */
export interface ProjectSpec {
  title: string;
  summary: string;
  /** Screens or major blocks of the UI. */
  views: string[];
  /** Data shapes that need to be held or persisted. */
  data: string[];
  /** "user action -> result" statements. */
  interactions: string[];
  files: SpecFile[];
}

export type Severity = 'blocker' | 'major' | 'minor';

export interface ReviewFinding {
  severity: Severity;
  /** File the problem lives in; may be empty for cross-file issues. */
  file: string;
  detail: string;
  suggestion: string;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: '阻塞',
  major: '偏差',
  minor: '打磨',
};

const SHARED_CODE_RULES = `代码硬性要求：
- 必须真的能跑：不留 TODO、不留空函数，每个按钮和输入框都要有真实绑定的事件处理。
- index.html 用 <link rel="stylesheet" href="styles.css"> 和 <script src="app.js" defer></script> 引用同目录兄弟文件，必须写到 </html>，必须声明 <meta name="viewport" content="width=device-width, initial-scale=1">。
- 多个 js 文件之间通过 window 上的全局对象通信，不要用 ES module 的 import/export。
- 沙箱里 localStorage 可能不可用，访问时必须 try/catch 包裹。
- 外部资源只允许 https://cdn.tailwindcss.com 、https://unpkg.com 、https://cdn.jsdelivr.net ，图片只用 https://images.unsplash.com。
- 用原生 JS，不要引入 React 构建链。
- 视觉现代精致：配色克制、留白合理、有 hover/active 状态、移动端可用；避免蓝紫渐变与玻璃拟态。
- 注释与界面文案使用中文。`;

/* ------------------------------------------------------------------ */
/* Planner                                                             */
/* ------------------------------------------------------------------ */

function plannerSystem(_maxFiles: number): string {
  return `你是 AtomForge 多智能体流水线里的「规划者（Planner）」。你不写代码，只把需求拆成一份可执行的规格，交给下游的实现者。

只输出一个 JSON 对象，第一个字符必须是 {，不要写解释文字，不要 markdown 围栏。结构：
{
  "title": "项目名称，6-16 个字",
  "summary": "一句话说明这个应用是什么、解决什么",
  "views": ["界面区块或页面，每条 8-24 字"],
  "data": ["需要保存的数据结构，格式为 名称：字段1、字段2"],
  "interactions": ["用户操作 -> 结果，每条 10-32 字"],
  "files": [{ "path": "index.html", "purpose": "这个文件负责什么" }]
}

约束：
- views 3-6 条，data 1-4 条，interactions 4-8 条，全部使用中文。
- files 必须包含 index.html，数量按需拆分（通常 3-6 个，复杂项目可以更多，不设硬上限），只用同目录相对路径（如 "app.js"），不要建子目录。
- 常规拆分 index.html（结构）/ styles.css（样式）/ app.js（逻辑）；逻辑复杂时再拆 1-2 个 js 文件。
- 规格要具体到能直接照着写代码：不要写"实现相关功能"这类空话。
- 功能完整优先：把需求里的核心能力做扎实，不要为压行数砍功能。`;
}

export function plannerMessages(
  brief: string,
  files: ProjectFile[],
  maxFiles: number,
): ChatTurn[] {
  const existing = files.length
    ? `项目已经存在下面这些文件：\n${files
        .map((file) => `- ${file.path}（${file.content.split('\n').length} 行）`)
        .join('\n')}\n\n这是一次增量修改。files 里只列出**需要改动或新增**的文件，未受影响的文件不要列。`
    : '这是一个全新项目，files 需要覆盖完整的实现。';

  return [
    { role: 'system', content: plannerSystem(maxFiles) },
    { role: 'user', content: `用户需求：${brief}\n\n${existing}` },
  ];
}

/** Ask the model to turn its own malformed output into valid JSON. */
export function repairJsonMessages(raw: string): ChatTurn[] {
  return [
    {
      role: 'system',
      content: '你是 JSON 修复器。把用户给的内容整理成合法 JSON，只输出 JSON 本身，不要解释。',
    },
    { role: 'user', content: raw },
  ];
}

/* ------------------------------------------------------------------ */
/* Spec helpers                                                        */
/* ------------------------------------------------------------------ */

/** Pull the JSON payload out of a response that may be fenced or chatty. */
export function extractJson(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function asList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, limit);
}

function cleanPath(raw: string): string {
  return raw
    .trim()
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\s+/g, '');
}

/**
 * Parse and normalize the Planner output. Throws when the payload is unusable,
 * which lets the orchestrator run one repair pass before giving up.
 */
export function parseSpec(raw: string, maxFiles: number): ProjectSpec {
  const parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>;

  const files: SpecFile[] = Array.isArray(parsed.files)
    ? (parsed.files as unknown[])
        .map((item) => {
          const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          return {
            path: cleanPath(typeof entry.path === 'string' ? entry.path : ''),
            purpose: typeof entry.purpose === 'string' ? entry.purpose.trim() : '',
          };
        })
        .filter((item) => item.path.length > 0)
    : [];

  const unique: SpecFile[] = [];
  files.forEach((file) => {
    if (unique.some((item) => item.path.toLowerCase() === file.path.toLowerCase())) return;
    unique.push(file);
  });

  if (unique.length === 0) throw new Error('规格里没有任何文件');

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';

  return {
    title: title || '未命名项目',
    summary: summary || '（规划者没有给出说明）',
    views: asList(parsed.views, 8),
    data: asList(parsed.data, 6),
    interactions: asList(parsed.interactions, 10),
    files: unique,
  };
}

/** Compact spec rendering handed to the Coder / Reviewer / Fixer. */
export function specDigest(spec: ProjectSpec): string {
  const block = (label: string, items: string[]) =>
    items.length ? `${label}：\n${items.map((item) => `- ${item}`).join('\n')}` : '';
  return [
    `项目：${spec.title}`,
    `定位：${spec.summary}`,
    block('界面区块', spec.views),
    block('数据结构', spec.data),
    block('交互清单', spec.interactions),
    `文件划分：\n${spec.files.map((file) => `- ${file.path}：${file.purpose}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** One-line summary for the chat bubble and the version note. */
export function specHeadline(spec: ProjectSpec): string {
  return `${spec.title} · ${spec.files.length} 个文件 · ${spec.interactions.length} 条交互`;
}

/* ------------------------------------------------------------------ */
/* Coder                                                               */
/* ------------------------------------------------------------------ */

const CODER_SYSTEM = `你是 AtomForge 流水线里的「实现者（Coder）」。你一次只负责一个文件，并且只输出这个文件的完整内容。

输出协议：
- 第一个字符就是文件内容本身，不要写任何解释，不要 markdown 围栏，不要重复文件名。
- 严格实现规格里属于本文件的职责，不要越界替其他文件写逻辑。
- 引用其他文件里的函数或元素 id 时，必须与已给出的兄弟文件保持完全一致。
- 必须把文件写到真正结束：HTML 要写到 </html>，CSS/JS 的所有括号都要闭合，不留半截内容。

${SHARED_CODE_RULES}`;

function fileContext(files: ProjectFile[], skipPath: string, targetLang?: FileLang): string {
  let others = files.filter((file) => file.path.toLowerCase() !== skipPath.toLowerCase());
  // A JS file never consumes CSS classes; dropping styles from its sibling
  // context trims thousands of characters per request without losing any
  // information the code can actually depend on.
  if (targetLang === 'js') {
    others = others.filter((file) => fileLang(file.path) !== 'css');
  }
  if (!others.length) return '（还没有其他文件）';
  return others
    .map((file) => `<<<FILE path="${file.path}">>>\n${file.content}\n<<<END>>>`)
    .join('\n\n');
}

/**
 * Every element id declared in the entry document. The Coder gets this list
 * verbatim so a JS file can never "hallucinate" an id that does not exist —
 * which was the single most common defect class the reviewer kept finding
 * (getElementById('records-list') when the HTML says 'interview-list').
 */
function collectHtmlIds(files: ProjectFile[]): string[] {
  const ids: string[] = [];
  files.forEach((file) => {
    if (fileLang(file.path) !== 'html') return;
    const re = /\bid\s*=\s*["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(file.content)) !== null) {
      const id = match[1].trim();
      if (id && !ids.includes(id)) ids.push(id);
    }
  });
  return ids;
}

export function coderMessages(options: {
  spec: ProjectSpec;
  target: SpecFile;
  written: ProjectFile[];
  pending: SpecFile[];
  previous: string;
  index: number;
  total: number;
}): ChatTurn[] {
  const { spec, target, written, pending, previous, index, total } = options;
  const upcoming = pending.length
    ? `还没有写、但一定会存在的文件：\n${pending
        .map((file) => `- ${file.path}：${file.purpose}`)
        .join('\n')}\n（可以放心引用它们，但不要在本文件里实现它们的职责）`
    : '所有其他文件都已给出。';

  const revision = previous
    ? `\n\n这个文件已有旧版本，请在它的基础上做最小必要改动：\n<<<FILE path="${target.path}">>>\n${previous}\n<<<END>>>`
    : '';

  // The single most common defect was a JS file referencing ids that do not
  // exist in the HTML (or vice versa). Hand the Coder the verbatim id list so
  // it can never guess wrong.
  const ids = collectHtmlIds(written);
  const idContract = ids.length
    ? `\nindex.html 中真实存在的元素 id（引用必须严格一致，禁止使用清单之外的 id）：\n${ids.join('、')}`
    : '';

  return [
    { role: 'system', content: CODER_SYSTEM },
    {
      role: 'user',
      content: `规格如下：

${specDigest(spec)}

已经写好的文件（保持接口一致）：

${fileContext(written, target.path, fileLang(target.path))}
${idContract}

${upcoming}

现在请写第 ${index + 1}/${total} 个文件：**${target.path}**
它的职责：${target.purpose || '按规格实现'}
文件类型：${fileLang(target.path)}${revision}

只输出 ${target.path} 的完整内容。`,
    },
  ];
}

/** Strip strings, template literals, regex literals and comments so brace counting works. */
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
      // Heuristic regex literal: a '/' that follows an operator, an opening
      // bracket or a statement keyword starts a regex, not a division.
      // `if (/}/.test(x))` has a space before the '/', so look at the last
      // non-space output character AND at a trailing keyword.
      const trimmed = out.replace(/\s+$/, '');
      const prev = trimmed.length ? trimmed[trimmed.length - 1] : ' ';
      const afterKeyword = /\b(if|while|for|return|typeof|instanceof|switch|catch|with|in|of|void|case|throw|new|delete)\s*$/.test(trimmed);
      if (/[(=,:;!&|?{}[\n]/.test(prev) || afterKeyword) {
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

/**
 * Best-effort "did the model finish this file?" check. A truncated HTML loses
 * its closing tag, a truncated CSS/JS stops mid-brace. This is the exact
 * failure mode that used to ship half files and crash the preview with
 * `Cannot read properties of null`.
 */
export function fileLooksComplete(content: string, path: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (fileLang(path) === 'html') return /<\/html\s*>/i.test(text);
  if (fileLang(path) === 'css') {
    const clean = stripNoise(text);
    return balance(clean, '{', '}') === 0;
  }
  if (fileLang(path) === 'js') {
    const clean = stripNoise(text);
    return balance(clean, '{', '}') === 0 && balance(clean, '(', ')') === 0;
  }
  return true;
}

/** Ask the model to continue a file that was cut off mid-write. */
export function continueFileMessages(
  path: string,
  written: string,
  role: 'coder' | 'fixer',
): ChatTurn[] {
  const tail = written.slice(-800);
  return [
    {
      role: 'system',
      content:
        role === 'coder'
          ? `你是 AtomForge 流水线里的「实现者（Coder）」。上一个回答在文件写到一半时被截断了，请**紧接着断点继续输出剩余内容**，把文件写到真正结束（HTML 到 </html>，CSS/JS 括号全部闭合）。只输出剩余部分，不要重复已输出的内容，不要解释，不要围栏。`
          : `你是 AtomForge 流水线里的「修复者（Fixer）」。上一个回答在文件写到一半时被截断了，请**紧接着断点继续输出剩余内容**，把文件写到真正结束。只输出剩余部分，不要重复已输出的内容，不要解释，不要围栏。`,
    },
    {
      role: 'user',
      content: `文件 ${path} 已输出内容的结尾是：

${tail}

请直接从断点的下一个字符继续，输出该文件的剩余部分。`,
    },
  ];
}

/**
 * Strip whatever wrapper the model added around a single file's content.
 * Coder and Fixer are told to emit raw code, but models occasionally add a
 * fence or a `<<<FILE>>>` header out of habit.
 */export function stripCodeFence(raw: string, path: string): string {
  let text = raw.trim();

  const block = text.match(/<<<FILE[^>]*>>>([\s\S]*?)(?:<<<END>>>|$)/i);
  if (block) text = block[1].trim();

  const fenced = text.match(/^```[a-z0-9]*\s*\n([\s\S]*?)\n?```\s*$/i);
  if (fenced) text = fenced[1];
  else {
    text = text.replace(/^```[a-z0-9]*\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  }

  if (fileLang(path) === 'html') {
    const at = text.search(/<!DOCTYPE html|<html[\s>]/i);
    if (at > 0) text = text.slice(at);
  }

  return text.trim();
}

/* ------------------------------------------------------------------ */
/* Reviewer                                                            */
/* ------------------------------------------------------------------ */

const REVIEWER_SYSTEM = `你是 AtomForge 流水线里的「审查者（Reviewer）」。你不写代码，只对照规格挑**真问题**。

只输出一个 JSON 对象，第一个字符必须是 {，不要解释，不要围栏：
{ "findings": [ { "severity": "blocker", "file": "app.js", "detail": "问题是什么", "suggestion": "该怎么改" } ] }

severity 判定标准（宁缺毋滥）：
- blocker：功能直接不可用。例如引用了不存在的函数或元素 id、按钮没有绑定事件、脚本不闭合、HTML 没有写完、规格里的核心交互完全没实现。
- major：能跑但明显偏离规格，或存在确定会触发的崩溃（空数据崩溃、必需元素缺失）。

严格要求：
- **禁止**为凑数而报问题：样式细节、文案措辞、可读性、性能微调等打磨项一律不要报。
- 只有当你**在代码中找到了确定性的缺陷证据**（缺失的元素、未绑定的按钮、引用了不存在的函数/变量、脚本不闭合、核心交互没实现）时才报。
- **输出前逐条自检**：这个问题的具体后果是什么？如果分析后发现「其实能正常运行」「实际不会触发」，就**不要**把它写进 findings。
- 不要把推理过程中的「可能/如果」式疑虑当问题上报——宁可漏报，不要误报。
- detail 必须具体到位置或标识符，例如「app.js 里 document.getElementById('xxx') 对应元素在 index.html 中不存在」。
- 最多 5 条，按严重度从高到低排列。
- 确认没有问题时输出 { "findings": [] }，这完全是可接受的结论。`;

/** Ids a JS file looks up through getElementById / querySelector('#id'). */
function collectJsRefs(files: ProjectFile[]): string[] {
  const refs: string[] = [];
  files.forEach((file) => {
    if (fileLang(file.path) !== 'js') return;
    // Only element *ids* are comparable with the HTML id list. Class
    // selectors (querySelector('.card')) and compound selectors must NOT be
    // compared — treating them as missing ids produced false blockers that
    // forced a pointless fix round and a second review.
    const re = /getElementById\s*\(\s*['"]([^'")\s]+)['"]|querySelector(?:All)?\s*\(\s*['"]#([^'")\s]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(file.content)) !== null) {
      const id = (match[1] || match[2] || '').trim();
      if (id && !refs.includes(id)) refs.push(id);
    }
  });
  return refs;
}

/**
 * Compact stand-in for a CSS file in the reviewer context. CSS is the bulk of
 * a project's bytes but can rarely cause the *functional* defects the
 * reviewer reports (blocker/major); a class inventory plus structure facts is
 * enough, and keeps the reviewer input small enough to answer quickly.
 */
function cssDigest(content: string): string {
  const classes = new Set<string>();
  const re = /\.([A-Za-z_][\w-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) classes.add(match[1]);
  const lines = content.split('\n').length;
  const media = /@media/g.test(content) ? '含响应式断点' : '无响应式断点';
  const vars = (content.match(/--[\w-]+/g) || []).length;
  const classList = Array.from(classes).slice(0, 40).join('、');
  return `styles.css 摘要（${lines} 行）：定义类 ${classes.size} 个${
    classList ? `（${classList}${classes.size > 40 ? '…' : ''}）` : ''
  }，${media}，CSS 变量 ${vars} 个。`;
}

export function reviewerMessages(
  spec: ProjectSpec,
  files: ProjectFile[],
  round: number,
): ChatTurn[] {
  const body = files
    .map((file) =>
      fileLang(file.path) === 'css'
        ? `<<<FILE path="${file.path}" type="styles-digest">>>\n${cssDigest(file.content)}\n<<<END>>>`
        : `<<<FILE path="${file.path}">>>\n${file.content}\n<<<END>>>`,
    )
    .join('\n\n');

  // A pre-computed cross-reference table: the reviewer can immediately see
  // whether every id the JS touches actually exists in the HTML, instead of
  // having to eyeball-diff two long files itself.
  const htmlIds = collectHtmlIds(files);
  const jsRefs = collectJsRefs(files);
  const missing = jsRefs.filter((id) => !htmlIds.includes(id));
  const xref = `交叉引用对照表（已自动核对）：
- HTML 声明的 id（${htmlIds.length} 个）：${htmlIds.join('、') || '（无）'}
- JS 引用的 id（${jsRefs.length} 个）：${jsRefs.join('、') || '（无）'}
${missing.length ? `- ⚠️ JS 引用了 HTML 中不存在的 id：${missing.join('、')}` : '- ✅ JS 引用的 id 全部能在 HTML 中找到'}`;

  return [
    { role: 'system', content: REVIEWER_SYSTEM },
    {
      role: 'user',
      content: `规格：

${specDigest(spec)}

${xref}

${round > 1 ? `这是第 ${round} 轮审查，上一轮的问题已被修复者处理过，请重新完整检查。\n\n` : ''}实现代码：

${body}`,
    },
  ];
}

/** Parse the Reviewer payload. Throws so the orchestrator can retry once. */
export function parseFindings(raw: string): ReviewFinding[] {
  const parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>;
  const list = Array.isArray(parsed.findings) ? (parsed.findings as unknown[]) : [];

  const rank: Record<Severity, number> = { blocker: 0, major: 1, minor: 2 };

  return list
    .map((item) => {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const severityRaw = typeof entry.severity === 'string' ? entry.severity.toLowerCase() : '';
      const severity: Severity =
        severityRaw === 'blocker' ? 'blocker' : severityRaw === 'major' ? 'major' : 'minor';
      return {
        severity,
        file: typeof entry.file === 'string' ? cleanPath(entry.file) : '',
        detail: typeof entry.detail === 'string' ? entry.detail.trim() : '',
        suggestion: typeof entry.suggestion === 'string' ? entry.suggestion.trim() : '',
      };
    })
    .filter((item) => item.detail.length > 0)
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/* ------------------------------------------------------------------ */
/* Fixer                                                               */
/* ------------------------------------------------------------------ */

const FIXER_SYSTEM = `你是 AtomForge 流水线里的「修复者（Fixer）」。你只修被点名的问题，只输出一个文件。

输出协议：
- 第一个字符就是修复后的完整文件内容，不要解释，不要 markdown 围栏。
- 只解决列出的问题，不要顺手重构、不要改动无关逻辑、不要删掉已有功能。
- 修完之后这个文件必须仍然与其他文件的接口保持一致。

${SHARED_CODE_RULES}`;

export function fixerMessages(options: {
  spec: ProjectSpec;
  file: ProjectFile;
  findings: ReviewFinding[];
  siblings: ProjectFile[];
}): ChatTurn[] {
  const { spec, file, findings, siblings } = options;
  const list = findings
    .map(
      (item, index) =>
        `${index + 1}. [${SEVERITY_LABEL[item.severity]}] ${item.detail}${
          item.suggestion ? `\n   建议：${item.suggestion}` : ''
        }`,
    )
    .join('\n');

  return [
    { role: 'system', content: FIXER_SYSTEM },
    {
      role: 'user',
      content: `规格摘要：

${specDigest(spec)}

需要修复的文件是 **${file.path}**，它当前的内容：

<<<FILE path="${file.path}">>>
${file.content}
<<<END>>>

审查者指出的问题：
${list}

其他文件（只读，用于保持接口一致）：

${fileContext(siblings, file.path, fileLang(file.path))}

只输出修复后的 ${file.path} 完整内容。`,
    },
  ];
}

/** Findings that justify spending a Fixer round. */
export function actionableFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return findings.filter((item) => item.severity !== 'minor' && item.file.length > 0);
}