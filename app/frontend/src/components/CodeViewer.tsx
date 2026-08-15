import { useEffect, useMemo, useRef, useState } from 'react';
import { fileLang, type FileLang } from '@/lib/bundler';

/**
 * Read-only source viewer with a line-number gutter and lightweight syntax
 * colouring. Highlighting is done with a single tokenizing regex per language
 * instead of a heavyweight editor dependency: the panel only has to *display*
 * generated code beautifully, and editing happens in a separate textarea.
 */

interface Token {
  text: string;
  cls: string;
}

/**
 * Token classes resolve to theme-aware CSS variables (see index.css), so the
 * same tokenizer output stays readable on both the dark and the light surface.
 */
const COLOR = {
  comment: 'tok-comment',
  string: 'tok-string',
  number: 'tok-number',
  keyword: 'tok-keyword',
  builtin: 'tok-builtin',
  fn: 'tok-fn',
  tag: 'tok-keyword',
  attr: 'tok-builtin',
  prop: 'tok-fn',
  punct: 'tok-punct',
  plain: '',
};

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch',
  'case', 'break', 'continue', 'new', 'delete', 'typeof', 'instanceof', 'this', 'class',
  'extends', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield', 'in', 'of',
  'true', 'false', 'null', 'undefined', 'void',
]);

const JS_BUILTINS = new Set([
  'document', 'window', 'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number',
  'Boolean', 'Date', 'Promise', 'Map', 'Set', 'localStorage', 'sessionStorage', 'setTimeout',
  'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'parseInt',
  'parseFloat', 'isNaN', 'fetch',
]);

/** Master tokenizer: comments and strings first so keywords inside them are inert. */
const JS_TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^`\\])*`|'(?:\\[\s\S]|[^'\\\n])*'|"(?:\\[\s\S]|[^"\\\n])*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.:=+\-*/%<>!?&|^~]+)/g;

const CSS_TOKEN =
  /(\/\*[\s\S]*?\*\/)|('(?:\\[\s\S]|[^'\\\n])*'|"(?:\\[\s\S]|[^"\\\n])*")|(@[\w-]+)|(#[0-9a-fA-F]{3,8}\b|\b-?\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|deg|fr)?\b)|([\w-]+)(?=\s*:)|([{}();:,>+~]+)/g;

const HTML_TOKEN =
  /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][\w-]*)|([A-Za-z-]+)(?==)|("(?:[^"]*)"|'(?:[^']*)')|(\/?>)/g;

function tokenizeJs(line: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  JS_TOKEN.lastIndex = 0;
  let match = JS_TOKEN.exec(line);
  while (match) {
    if (match.index > last) out.push({ text: line.slice(last, match.index), cls: COLOR.plain });
    const [raw, comment, str, num, word, punct] = match;
    if (comment) out.push({ text: raw, cls: COLOR.comment });
    else if (str) out.push({ text: raw, cls: COLOR.string });
    else if (num) out.push({ text: raw, cls: COLOR.number });
    else if (word) {
      const after = line.slice(match.index + raw.length);
      let cls = COLOR.plain;
      if (JS_KEYWORDS.has(word)) cls = COLOR.keyword;
      else if (JS_BUILTINS.has(word)) cls = COLOR.builtin;
      else if (after.startsWith('(')) cls = COLOR.fn;
      else if (line[match.index - 1] === '.') cls = COLOR.prop;
      out.push({ text: raw, cls });
    } else if (punct) out.push({ text: raw, cls: COLOR.punct });
    last = match.index + raw.length;
    match = JS_TOKEN.exec(line);
  }
  if (last < line.length) out.push({ text: line.slice(last), cls: COLOR.plain });
  return out;
}

function tokenizeWith(line: string, re: RegExp, map: (groups: string[]) => string): Token[] {
  const out: Token[] = [];
  let last = 0;
  re.lastIndex = 0;
  let match = re.exec(line);
  while (match) {
    if (match.index > last) out.push({ text: line.slice(last, match.index), cls: COLOR.plain });
    out.push({ text: match[0], cls: map(match.slice(1) as string[]) });
    last = match.index + match[0].length;
    match = re.exec(line);
  }
  if (last < line.length) out.push({ text: line.slice(last), cls: COLOR.plain });
  return out;
}

function tokenizeCss(line: string): Token[] {
  return tokenizeWith(line, CSS_TOKEN, ([comment, str, atRule, value, prop]) => {
    if (comment) return COLOR.comment;
    if (str) return COLOR.string;
    if (atRule) return COLOR.keyword;
    if (value) return COLOR.number;
    if (prop) return COLOR.prop;
    return COLOR.punct;
  });
}

function tokenizeHtml(line: string): Token[] {
  return tokenizeWith(line, HTML_TOKEN, ([comment, tag, attr, str]) => {
    if (comment) return COLOR.comment;
    if (tag) return COLOR.tag;
    if (attr) return COLOR.attr;
    if (str) return COLOR.string;
    return COLOR.tag;
  });
}

function tokenize(line: string, lang: FileLang): Token[] {
  if (!line) return [];
  if (lang === 'js' || lang === 'json') return tokenizeJs(line);
  if (lang === 'css') return tokenizeCss(line);
  if (lang === 'html') return tokenizeHtml(line);
  return [{ text: line, cls: COLOR.plain }];
}

/**
 * Line-level token cache. During streaming (and during incremental rewrites)
 * most lines are byte-identical between renders; re-tokenizing them every
 * frame was the dominant cost that made the whole page — and thereby the SSE
 * receive loop — stall. The cache is bounded to avoid unbounded growth on
 * very long files.
 */
const TOKEN_CACHE = new Map<string, Token[]>();
const TOKEN_CACHE_MAX = 4000;

function tokenizeCached(line: string, lang: FileLang): Token[] {
  const key = `${lang}\n${line}`;
  const hit = TOKEN_CACHE.get(key);
  if (hit) return hit;
  const tokens = tokenize(line, lang);
  if (TOKEN_CACHE.size >= TOKEN_CACHE_MAX) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(key, tokens);
  return tokens;
}

interface CodeViewerProps {
  path: string;
  content: string;
  /** Renders a subtle caret marker on the last line while streaming. */
  streaming?: boolean;
}

export function CodeViewer({ path, content, streaming = false }: CodeViewerProps) {
  const lang = fileLang(path);

  // While streaming, throttle actual rendering to ~4Hz: the source can change
  // many times per second and a full re-tokenize + DOM rebuild per change is
  // what used to stall the page and back-pressure the SSE stream itself.
  const [shown, setShown] = useState(content);
  const latestRef = useRef(content);
  useEffect(() => {
    latestRef.current = content;
    if (!streaming) {
      setShown(content);
      return;
    }
    const id = window.setTimeout(() => setShown(latestRef.current), 250);
    return () => window.clearTimeout(id);
  }, [content, streaming]);

  const lines = useMemo(() => shown.replace(/\n$/, '').split('\n'), [shown]);
  const gutterWidth = `${String(lines.length).length + 1}ch`;

  return (
    <div className="code-surface h-full overflow-auto">
      <div className="min-w-full font-code text-[12.5px] leading-[1.65]">
        {lines.map((line, index) => (
          <div key={index} className="code-row group flex whitespace-pre transition-colors duration-150">
            <span
              className="code-gutter sticky left-0 shrink-0 select-none pr-3 text-right nums-tabular"
              style={{ width: gutterWidth }}
            >
              {index + 1}
            </span>
            <code className="pr-6">
              {tokenizeCached(line, lang).map((token, tokenIndex) => (
                <span key={tokenIndex} className={token.cls}>
                  {token.text}
                </span>
              ))}
              {streaming && index === lines.length - 1 ? (
                <span className="ml-px inline-block h-[1.1em] w-[2px] translate-y-[2px] animate-pulse bg-primary" />
              ) : null}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}