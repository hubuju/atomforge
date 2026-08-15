import type { ProjectFile } from './client';

/**
 * The generator emits a real multi-file project (index.html + styles.css +
 * app.js ...), which is what a developer expects to read and edit. The browser
 * sandbox, however, can only run a single document, so this module bundles the
 * file set into one runnable HTML string at preview time only — the stored
 * source stays split.
 */

export const ENTRY_FILE = 'index.html';

/** File-type metadata used by the code viewer. */
export type FileLang = 'html' | 'css' | 'js' | 'json' | 'md' | 'text';

export function fileLang(path: string): FileLang {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'js';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'md';
  return 'text';
}

export function findFile(files: ProjectFile[], path: string): ProjectFile | undefined {
  const target = path.toLowerCase();
  return files.find((file) => file.path.toLowerCase() === target);
}

export function entryHtml(files: ProjectFile[]): string {
  return findFile(files, ENTRY_FILE)?.content || '';
}

export function totalChars(files: ProjectFile[]): number {
  return files.reduce((sum, file) => sum + file.content.length, 0);
}

/** Normalize a referenced path (`./app.js`, `/styles.css`) to a file key. */
function normalizeRef(ref: string): string {
  return ref
    .trim()
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .split(/[?#]/)[0]
    .toLowerCase();
}

const LOCAL_REF = /^(?!https?:|\/\/|data:|blob:)/i;

/**
 * Escape the sequence that would prematurely close an inlined block.
 * A generated JS file legitimately containing the string `</script>` (e.g. in
 * an innerHTML template) would otherwise terminate the inlined tag mid-way
 * and tear the document apart.
 */
function safeInline(content: string, tag: 'style' | 'script'): string {
  return content.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
}

/**
 * Inline every local <link rel="stylesheet"> and <script src> reference so the
 * result runs inside a single-document sandbox. External CDN URLs are kept.
 *
 * Defer semantics are preserved explicitly: `defer` has NO effect on inline
 * scripts per the HTML spec, so a `defer` script moved from head into a body
 * that has not parsed yet would run too early and see null for every element.
 * Wrapping it in DOMContentLoaded restores exactly the behaviour the
 * generator relied on when it wrote `defer`.
 */
export function bundleForPreview(files: ProjectFile[]): string {
  const html = entryHtml(files);
  if (!html.trim()) return '';

  const byPath = new Map<string, ProjectFile>();
  files.forEach((file) => byPath.set(file.path.toLowerCase(), file));

  let output = html.replace(
    /<link\b[^>]*?href=["']([^"']+)["'][^>]*>/gi,
    (match, href: string) => {
      if (!/stylesheet/i.test(match) || !LOCAL_REF.test(href)) return match;
      const target = byPath.get(normalizeRef(href));
      if (!target) return match;
      return `<style data-src="${target.path}">\n${safeInline(target.content, 'style')}\n</style>`;
    },
  );

  output = output.replace(
    /<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (match, before: string, src: string, after: string) => {
      if (!LOCAL_REF.test(src)) return match;
      const target = byPath.get(normalizeRef(src));
      if (!target) return match;
      const attrs = `${before} ${after}`;
      const isModule = /type\s*=\s*["']module["']/i.test(attrs);
      const hadDefer = /\bdefer\b/i.test(attrs);
      const typeAttr = isModule ? ' type="module"' : '';
      // module scripts are deferred natively; a plain `defer` script keeps the
      // generator's contract through DOMContentLoaded; scripts without defer
      // keep their immediate-execution semantics.
      const body =
        isModule || !hadDefer
          ? target.content
          : `document.addEventListener('DOMContentLoaded', function () {\n${target.content}\n});`;
      return `<script data-src="${target.path}"${typeAttr}>\n${safeInline(body, 'script')}\n</script>`;
    },
  );

  return output;
}

/** Default scaffold used before the first generation round. */
export function emptyProject(): ProjectFile[] {
  return [];
}