import { type MessageRecord, type ProjectFile } from './client';
import { ENTRY_FILE, bundleForPreview, entryHtml } from './bundler';
import {
  chatCompletionsUrl,
  DEFAULT_SETTINGS,
  type ModelSettings,
} from './settings';

/**
 * Output protocol: a short plan in prose, then one block per project file.
 * Files stay separate on purpose — HTML, CSS and JS live in their own documents
 * like a normal project, and single-document inlining happens only inside the
 * preview bundler.
 *
 * This single-call path is the "classic" mode. When multi-agent mode is on, the
 * orchestrator in `orchestrator.ts` drives four focused roles instead, reusing
 * the `streamChat` transport exported below.
 */
function systemPrompt(maxFiles: number): string {
  return `你是 AtomForge 的应用生成智能体，交付物是一个**多文件的原生前端项目**，它会在浏览器沙箱里运行。

输出协议（必须严格遵守）：
1. 先用 2-4 句中文说明实现方案（结构、交互、状态），纯文本，不要 markdown 标题。
2. 然后按下面的格式逐个输出文件，每个文件一段：

<<<FILE path="index.html">>>
文件的完整内容
<<<END>>>

<<<FILE path="styles.css">>>
文件的完整内容
<<<END>>>

3. 文件块内部不要写 \`\`\` 围栏。最后一个 <<<END>>> 之后不要再写任何文字。

文件组织要求：
- 必须包含 index.html，且它用 <link rel="stylesheet" href="styles.css"> 与 <script src="app.js" defer></script> 引用同目录的兄弟文件。
- 常规拆分：index.html（结构）、styles.css（样式）、app.js（逻辑）。逻辑较多时可再拆 1-2 个 js 文件（例如 storage.js、render.js），并在 index.html 中按依赖顺序引用。
- 文件总数不超过 ${maxFiles} 个，只用同目录相对路径（如 "app.js"），不要建子目录。
- 不要把 CSS/JS 内联进 HTML —— 拆分后的代码更易读、易改，预览时系统会自动打包成单文档运行。
- 多个 js 文件之间通过 window 上的全局对象通信，不要用 ES module 的 import/export。

代码硬性要求（生成后会被自动检查，不达标会被打回重做）：
- 必须真的能跑：不留 TODO、不留空函数，**每个按钮和输入框都要有真实绑定的事件处理**。
- 绑定事件前先确认元素存在：所有 querySelector / getElementById 的结果要么在 HTML 里保证存在，要么做判空保护，禁止对 null 直接 addEventListener（这是最常见的运行时崩溃）。
- index.html 必须写到 </html>，每个 <script> 都要闭合。
- 必须声明 <meta name="viewport" content="width=device-width, initial-scale=1">。
- 允许的外部资源只有 CDN：https://cdn.tailwindcss.com 、https://unpkg.com 、https://cdn.jsdelivr.net 、以及 https://images.unsplash.com 的图片。
- 沙箱里 localStorage 可能不可用，访问时必须 try/catch 包裹。
- 用原生 JS，不要引入 React 构建链。
- **视觉精致是硬指标**（评审看到的第一眼就是它）：
  * 三层次结构：页面背景（低饱和浅灰/暖灰）、卡片（纯白或微灰、1px 边框+轻投影）、主按钮（一个主题色即可，如深蓝/墨绿/暖橙；禁止蓝紫渐变与玻璃拟态）；
  * 文字三级对比清晰：标题 / 正文 / 辅助文字；中文正文 14-16px、行高 1.6；
  * 卡片圆角统一 10-14px、按钮圆角 8-10px，间距 16-24px，整体留白充足不拥挤；
  * 每个按钮有 hover（加深或轻微位移）与 active 反馈，输入框聚焦有主题色描边；
  * 表单控件（input/select/button）必须自定义样式，禁止浏览器默认外观；
  * 列表要有空状态提示，增删操作要有明确反馈（提示或过渡动画）；
  * 移动端断点流畅：小屏单列、按钮高度 ≥40px。
- 注释与界面文案使用中文。
- **控制体量**：所有文件合计约 900 行以内。注释精简，示例数据 3-6 条，不重复相似的 HTML 区块。

当用户提出修改需求时，基于给定的"当前文件"做增量修改，然后**重新输出所有被改动的文件的完整内容**（未改动的文件可以不输出）。不要输出片段或 diff。`;
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function filesAsContext(files: ProjectFile[]): string {
  return files
    .map((file) => `<<<FILE path="${file.path}">>>\n${file.content}\n<<<END>>>`)
    .join('\n\n');
}

/**
 * Build the model conversation. Chat history is replayed as prose only; the
 * single source of truth for code is the current file set appended to the
 * latest instruction.
 */
export function buildMessages(
  history: MessageRecord[],
  instruction: string,
  files: ProjectFile[],
  maxFiles: number = DEFAULT_SETTINGS.maxFiles,
): ChatTurn[] {
  const messages: ChatTurn[] = [{ role: 'system', content: systemPrompt(maxFiles) }];

  history.slice(-8).forEach((item) => {
    messages.push({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: item.content.slice(0, 1200),
    });
  });

  const tail = files.length
    ? `这是当前项目的全部文件：

${filesAsContext(files)}

请在此基础上完成新的需求：${instruction}

记住：输出简短方案说明 + 被改动文件的完整内容（用 <<<FILE path="...">>> 包裹）。`
    : `请从零创建一个项目，需求是：${instruction}

记住：输出简短方案说明 + 各个文件（用 <<<FILE path="...">>> 包裹），至少包含 index.html、styles.css、app.js。`;

  messages.push({ role: 'user', content: tail });
  return messages;
}

const FILE_OPEN = /<<<FILE\s+path\s*=\s*"([^"]+)"\s*>>>/g;
const END_MARK = '<<<END>>>';

export interface ParsedStream {
  /** Plain-language plan shown in the chat bubble. */
  text: string;
  /** Files parsed so far (the last one may still be streaming). */
  files: ProjectFile[];
  /** Path of the file currently being written, if any. */
  writing: string;
  /** True when every opened block was closed with <<<END>>>. */
  closed: boolean;
}

function cleanPath(raw: string): string {
  return raw.trim().replace(/^\.\//, '').replace(/^\/+/, '').replace(/\s+/g, '');
}

/**
 * Split a (possibly partial) response into narrative text and files. Tolerates
 * a missing final <<<END>>> so the code panel can stream live, and falls back
 * to treating a bare HTML document as index.html when the model ignored the
 * protocol entirely.
 */
export function parseStream(raw: string): ParsedStream {
  FILE_OPEN.lastIndex = 0;
  const opens: { path: string; start: number; headEnd: number }[] = [];
  let match = FILE_OPEN.exec(raw);
  while (match) {
    opens.push({
      path: cleanPath(match[1]),
      start: match.index,
      headEnd: match.index + match[0].length,
    });
    match = FILE_OPEN.exec(raw);
  }

  if (opens.length === 0) {
    const bare = raw.search(/<!DOCTYPE html|<html[\s>]/i);
    if (bare >= 0) {
      const body = raw.slice(bare).replace(/```[\s\S]*$/, '').trimEnd();
      return {
        text: raw.slice(0, bare).replace(/```(?:html)?\s*$/i, '').trim(),
        files: [{ path: ENTRY_FILE, content: body }],
        writing: /<\/html\s*>/i.test(body) ? '' : ENTRY_FILE,
        closed: /<\/html\s*>/i.test(body),
      };
    }
    return { text: raw.trim(), files: [], writing: '', closed: false };
  }

  const text = raw.slice(0, opens[0].start).trim();
  const files: ProjectFile[] = [];
  let writing = '';
  let closed = true;

  opens.forEach((open, index) => {
    const limit = index + 1 < opens.length ? opens[index + 1].start : raw.length;
    const region = raw.slice(open.headEnd, limit);
    const endAt = region.indexOf(END_MARK);
    const content = endAt >= 0 ? region.slice(0, endAt) : region;
    if (endAt < 0) {
      writing = open.path;
      closed = false;
    }
    if (!open.path) return;
    const trimmed = content.replace(/^\n/, '').replace(/\s+$/, '');
    const existing = files.findIndex((file) => file.path === open.path);
    if (existing >= 0) files[existing] = { path: open.path, content: trimmed };
    else files.push({ path: open.path, content: trimmed });
  });

  return { text, files, writing, closed };
}

/**
 * Merge a freshly generated file set onto the stored project: changed files are
 * replaced, untouched files survive, entry file stays first.
 */
export function mergeFiles(current: ProjectFile[], incoming: ProjectFile[]): ProjectFile[] {
  const merged = [...current];
  incoming.forEach((file) => {
    const at = merged.findIndex((item) => item.path.toLowerCase() === file.path.toLowerCase());
    if (at >= 0) merged[at] = file;
    else merged.push(file);
  });
  merged.sort((a, b) => {
    if (a.path.toLowerCase() === ENTRY_FILE) return -1;
    if (b.path.toLowerCase() === ENTRY_FILE) return 1;
    return a.path.localeCompare(b.path);
  });
  return merged;
}

/** Extract a short summary line for the version history list. */
export function summarize(text: string, fallback: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return fallback.replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean.slice(0, 80);
}

/**
 * The sandbox runs without `allow-same-origin`, so touching localStorage or
 * sessionStorage throws a SecurityError. Generated apps commonly read storage
 * at the top of their script — one throw there kills the whole script and every
 * button silently stops responding. Install an in-memory fallback first.
 */
const STORAGE_SHIM = `<script>
(function () {
  var makeStore = function () {
    var data = {};
    return {
      getItem: function (k) {
        var key = String(k);
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { data = {}; },
      key: function (i) { var keys = Object.keys(data); return i < keys.length ? keys[i] : null; },
      get length() { return Object.keys(data).length; }
    };
  };
  var ensure = function (name) {
    try {
      var store = window[name];
      store.setItem('__atomforge_probe__', '1');
      store.removeItem('__atomforge_probe__');
      return;
    } catch (e) {
      /* blocked by the sandbox — fall through and replace it */
    }
    try {
      Object.defineProperty(window, name, { configurable: true, value: makeStore() });
    } catch (e) {}
  };
  ensure('localStorage');
  ensure('sessionStorage');
})();
</script>`;

/**
 * Error reporter + self-check probe.
 *
 * `addEventListener` is wrapped *before* any generated script runs so the probe
 * can tell "rendered but dead" apart from "actually wired". After load it posts
 * one report describing what really exists in the DOM.
 */
const RUNTIME_PROBE = `<script>
(function () {
  var errors = [];
  var listeners = 0;
  var send = function (payload) {
    try { parent.postMessage({ __atomforge: true, payload: payload }, '*'); } catch (e) {}
  };

  var origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type) {
    if (type && String(type).indexOf('atomforge') !== 0) listeners += 1;
    return origAdd.apply(this, arguments);
  };

  var note = function (message) {
    var text = String(message || '未知运行时错误');
    if (errors.indexOf(text) < 0) errors.push(text);
  };

  window.addEventListener('error', function (event) {
    note((event && event.message) || '');
    send({
      kind: 'error',
      message: String((event && event.message) || '未知运行时错误'),
      source: String((event && event.filename) || ''),
      line: (event && event.lineno) || 0
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var text = 'Promise 未处理拒绝: ' + String((reason && reason.message) || reason || '');
    note(text);
    send({ kind: 'error', message: text, source: '', line: 0 });
  });

  var origError = console.error;
  console.error = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i += 1) {
      var a = arguments[i];
      parts.push(a && a.message ? a.message : String(a));
    }
    send({ kind: 'console', message: parts.join(' '), source: '', line: 0 });
    if (origError) origError.apply(console, arguments);
  };

  var inspect = function () {
    var body = document.body;
    var text = body ? (body.innerText || '').replace(/\\s+/g, ' ').trim() : '';
    var inline = 0;
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i += 1) {
      var attrs = all[i].attributes;
      for (var j = 0; j < attrs.length; j += 1) {
        if (attrs[j].name.indexOf('on') === 0 && attrs[j].value) { inline += 1; break; }
      }
    }
    return {
      nodes: all.length,
      bodyChars: text.length,
      buttons: document.querySelectorAll('button, [role="button"], a[href]').length,
      inputs: document.querySelectorAll('input, select, textarea').length,
      canvases: document.querySelectorAll('canvas, svg').length,
      listeners: listeners,
      inlineHandlers: inline,
      errors: errors.slice(0, 4)
    };
  };

  var report = function () {
    // Give async bootstrapping (fetch, requestAnimationFrame, Tailwind CDN) a
    // moment before judging whether the page is alive.
    setTimeout(function () {
      try { send({ kind: 'report', report: inspect() }); } catch (e) {}
    }, 700);
  };

  window.addEventListener('load', function () {
    send({ kind: 'ready' });
    report();
  });
})();
</script>`;

/**
 * Bundle the project files into one runnable document and inject the runtime
 * reporter that powers the self-check and the "let AI fix it" loop.
 */
export function buildPreview(files: ProjectFile[]): string {
  const bundled = bundleForPreview(files);
  if (!bundled.trim()) return '';
  const prelude = STORAGE_SHIM + RUNTIME_PROBE;
  const headIndex = bundled.search(/<head[^>]*>/i);
  if (headIndex >= 0) {
    const insertAt = bundled.indexOf('>', headIndex) + 1;
    return bundled.slice(0, insertAt) + prelude + bundled.slice(insertAt);
  }
  return prelude + bundled;
}

/** A project is runnable once index.html exists and closes its document. */
export function isRunnable(files: ProjectFile[]): boolean {
  return /<\/html\s*>/i.test(entryHtml(files));
}

export interface PreviewError {
  kind: 'error' | 'console';
  message: string;
  source?: string;
  line?: number;
}

export type PreviewMessage =
  | { type: 'ready' }
  | { type: 'error'; error: PreviewError }
  | { type: 'report'; report: unknown };

/** Type guard for messages posted from the preview iframe. */
export function readPreviewMessage(data: unknown): PreviewMessage | null {
  if (!data || typeof data !== 'object') return null;
  const envelope = data as {
    __atomforge?: boolean;
    payload?: { kind?: string; report?: unknown } & Omit<PreviewError, 'kind'>;
  };
  if (!envelope.__atomforge || !envelope.payload) return null;
  const payload = envelope.payload;
  if (payload.kind === 'ready') return { type: 'ready' };
  if (payload.kind === 'report') return { type: 'report', report: payload.report };
  if (payload.kind === 'error' || payload.kind === 'console') {
    return { type: 'error', error: payload as PreviewError };
  }
  return null;
}

/** Stages surfaced in the pipeline strip while a round is running. */
export type Stage = 'plan' | 'write' | 'audit' | 'render';

export interface RunGenerationOptions {
  messages: ChatTurn[];
  settings: ModelSettings;
  onProgress: (parsed: ParsedStream) => void;
  /** Called when a continuation round starts, so the UI can explain the wait. */
  onContinue?: (round: number) => void;
}

export interface GenerationResult extends ParsedStream {
  truncated: boolean;
  continuations: number;
}

/** Continuation attempts allowed when a single response hits the output cap. */
const MAX_CONTINUATIONS = 4;

/**
 * Stream through our own backend relay (`POST /api/v1/aihub/gentxt`).
 *
 * The relay forwards to whatever OpenAI-compatible provider is configured
 * server-side (default: DeepSeek), so the API key never reaches the browser
 * and registered visitors can generate without configuring anything. The
 * relay answers with SSE frames of `{"content": "..."}` plus a final `[DONE]`.
 */
async function streamViaAtoms(
  messages: ChatTurn[],
  settings: ModelSettings,
  onDelta: (delta: string) => void,
): Promise<string> {
  const model = settings.model || DEFAULT_SETTINGS.model;
  // DeepSeek's reasoning model rejects temperature; leave it out for it.
  const body: Record<string, unknown> = {
    messages,
    model,
    stream: true,
    max_tokens: 8192,
  };
  if (!/reasoner/i.test(model)) body.temperature = settings.temperature;

  let response: Response;
  try {
    response = await fetch('/api/v1/aihub/gentxt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('无法连接 AI 服务，请稍后重试');
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 240);
    } catch {
      /* body unavailable */
    }
    throw new Error(`AI 服务返回 ${response.status}${detail ? `：${detail}` : ''}`);
  }
  if (!response.body) throw new Error('AI 服务没有返回流式内容');

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let pending = '';

  const consume = (frame: string) => {
    const lines = frame
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'));
    for (const line of lines) {
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let parsed: { content?: string };
      try {
        parsed = JSON.parse(data) as { content?: string };
      } catch {
        continue; // keep-alive or partial frame — ignore
      }
      const delta = parsed.content || '';
      if (!delta) continue;
      if (delta.startsWith('[ERROR]')) {
        throw new Error(delta.slice(7).trim() || 'AI 生成失败');
      }
      buffer += delta;
      onDelta(delta);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let split = pending.indexOf('\n\n');
    while (split >= 0) {
      consume(pending.slice(0, split));
      pending = pending.slice(split + 2);
      split = pending.indexOf('\n\n');
    }
  }
  if (pending.trim()) consume(pending);

  if (!buffer.trim()) throw new Error('AI 服务返回了空内容，请确认模型配置');
  return buffer;
}

/**
 * Stream from any OpenAI-compatible `/chat/completions` endpoint, parsing SSE
 * frames by hand so the code panel fills in live just like proxy mode.
 */
async function streamViaCompat(
  messages: ChatTurn[],
  settings: ModelSettings,
  onDelta: (delta: string) => void,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(chatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        stream: true,
        temperature: settings.temperature,
      }),
    });
  } catch {
    throw new Error('连接自定义端点失败，请检查 Base URL 是否可访问且允许跨域');
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 240);
    } catch {
      /* body unavailable */
    }
    throw new Error(`端点返回 ${response.status}${detail ? `：${detail}` : ''}`);
  }
  if (!response.body) throw new Error('端点没有返回流式内容');

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let pending = '';
  let buffer = '';

  const consume = (frame: string) => {
    frame
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .forEach((line) => {
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data) as {
            choices?: { delta?: { content?: string }; message?: { content?: string } }[];
          };
          const delta =
            parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content || '';
          if (!delta) return;
          buffer += delta;
          onDelta(delta);
        } catch {
          /* keep-alive or partial frame — ignore */
        }
      });
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let split = pending.indexOf('\n\n');
    while (split >= 0) {
      consume(pending.slice(0, split));
      pending = pending.slice(split + 2);
      split = pending.indexOf('\n\n');
    }
  }
  if (pending.trim()) consume(pending);

  if (!buffer.trim()) throw new Error('端点返回了空内容，请确认模型名称是否正确');
  return buffer;
}

/**
 * One streaming round against whichever backend the settings point at.
 * Exported so the multi-agent orchestrator can drive each role through the
 * same transport (Atoms proxy or an OpenAI-compatible endpoint).
 */
export function streamChat(
  messages: ChatTurn[],
  settings: ModelSettings,
  onDelta: (delta: string) => void,
): Promise<string> {
  return settings.mode === 'compat'
    ? streamViaCompat(messages, settings, onDelta)
    : streamViaAtoms(messages, settings, onDelta);
}

/**
 * Join a continuation onto the accumulated output, dropping any prefix the
 * model repeated from the tail of what it already produced.
 */
function joinWithoutOverlap(head: string, tail: string): string {
  const max = Math.min(400, head.length, tail.length);
  for (let size = max; size >= 24; size -= 1) {
    if (head.endsWith(tail.slice(0, size))) return head + tail.slice(size);
  }
  return head + tail;
}

/**
 * Stream a generation round, automatically continuing when the model hits its
 * per-response output limit mid-file. A truncated script file renders but never
 * executes, which is exactly why "the preview shows up but nothing is
 * clickable".
 */
export async function runGeneration({
  messages,
  settings,
  onProgress,
  onContinue,
}: RunGenerationOptions): Promise<GenerationResult> {
  let accumulated = '';
  let live = '';

  const emit = () => onProgress(parseStream(accumulated + live));

  const round = async (turns: ChatTurn[]) => {
    live = '';
    const raw = await streamChat(turns, settings, (delta) => {
      live += delta;
      emit();
    });
    live = '';
    accumulated = accumulated ? joinWithoutOverlap(accumulated, raw) : raw;
    emit();
  };

  await round(messages);

  let continuations = 0;
  const needsMore = () => {
    const parsed = parseStream(accumulated);
    if (!parsed.files.length) return false;
    return !parsed.closed || !isRunnable(parsed.files);
  };

  while (continuations < MAX_CONTINUATIONS && needsMore()) {
    const soFar = parseStream(accumulated);
    continuations += 1;
    onContinue?.(continuations);
    const tailOfCurrent = soFar.files[soFar.files.length - 1]?.content.slice(-600) || '';
    await round([
      ...messages,
      { role: 'assistant', content: accumulated.slice(-6000) },
      {
        role: 'user',
        content: `你上面的输出在到达长度上限时被截断了。请**紧接着断点继续输出剩余内容**，把所有文件写完（每个文件都要以 <<<END>>> 结束，index.html 必须写到 </html>）。

严格要求：
- 不要重新开头，不要重复已经输出过的任何内容。
- 不要写解释文字。
- 如果当前正在写的文件是 ${soFar.writing || '（已闭合）'}，直接从断点的下一个字符继续；写完它的 <<<END>>> 后再继续输出还没写的文件。
- 已输出内容的结尾是：
${tailOfCurrent}`,
      },
    ]);
  }

  const parsed = parseStream(accumulated);
  if (!parsed.files.length) {
    throw new Error('模型没有按文件格式输出内容，请补充需求细节后重试');
  }
  if (!entryHtml(parsed.files).trim()) {
    throw new Error('生成结果缺少 index.html 入口文件，请重试');
  }

  return {
    text: parsed.text,
    files: parsed.files,
    writing: parsed.writing,
    closed: parsed.closed,
    truncated: !parsed.closed || !isRunnable(parsed.files),
    continuations,
  };
}

/** Onboarding guidance: how to describe a requirement that generates well. */
export const PROMPT_TIPS = [
  {
    title: '说清「是什么 + 能干什么」',
    good: '做一个记账本，可以增删记录、按分类统计月度支出',
    bad: '做个好看的网页',
  },
  {
    title: '把关键交互点出来',
    good: '待办清单，支持拖拽排序、回车快速添加、完成后划线',
    bad: '做个待办',
  },
  {
    title: '一次一个目标，之后再迭代',
    good: '先生成主界面，下一轮再说「加一个深色模式开关」',
    bad: '做个包含登录、支付、后台管理的完整系统',
  },
];

export const GUIDE_STEPS = [
  {
    title: '1 · 描述需求',
    body: '在左侧对话框写下你想要的应用，越具体越好。可以直接点示例快速填入。',
  },
  {
    title: '2 · 规划者先出规格',
    body: '规划者把需求拆成界面、数据、交互与文件划分。默认会停下来等你确认，可以直接编辑再开工。',
  },
  {
    title: '3 · 四个角色接力干活',
    body: '实现者按文件逐个写代码，审查者对照规格挑问题，修复者只改被点名的文件。每个角色一条泳道，耗时和产出都看得见。',
  },
  {
    title: '4 · 备注 / 回滚 / 导出 / 发布',
    body: '版本历史里可以给每一版写备注再回滚；源码可以打包成 zip 下载；满意了点发布拿公开链接。',
  },
];

export const STARTER_IDEAS = [
  '做一个像素风的贪吃蛇小游戏，带最高分记录和方向键/触屏控制',
  '做一个番茄钟专注计时器，可自定义时长、有环形进度和完成提示音',
  '做一个个人开支记录器，可增删记录、按分类统计并画一个占比条形图',
  '做一个 Markdown 实时预览编辑器，左边写右边渲染，支持导出',
];