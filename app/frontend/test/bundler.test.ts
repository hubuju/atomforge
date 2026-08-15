import { describe, expect, it } from 'vitest';

import {
  ENTRY_FILE,
  bundleForPreview,
  entryHtml,
  fileLang,
  findFile,
  totalChars,
} from '@/lib/bundler';
import { slugifyName } from '@/lib/exporter';
import type { ProjectFile } from '@/lib/client';

/**
 * The bundler is the seam between "readable multi-file source" and "one runnable
 * document". If it silently fails to inline a stylesheet or a script, the
 * preview renders unstyled or dead — which is exactly the class of bug the
 * product is supposed to catch, so it gets tested first.
 */

const project: ProjectFile[] = [
  {
    path: 'index.html',
    content: [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '  <meta charset="utf-8">',
      '  <link rel="stylesheet" href="styles.css">',
      '  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/x/x.css">',
      '  <link rel="icon" href="favicon.ico">',
      '</head>',
      '<body>',
      '  <button id="go">开始</button>',
      '  <script src="./app.js" defer></script>',
      '  <script src="https://unpkg.com/vendor.js"></script>',
      '</body>',
      '</html>',
    ].join('\n'),
  },
  { path: 'styles.css', content: 'body { margin: 0; }' },
  { path: 'app.js', content: "document.getElementById('go').addEventListener('click', () => {});" },
];

describe('fileLang', () => {
  it('识别常见文件类型', () => {
    expect(fileLang('index.html')).toBe('html');
    expect(fileLang('page.HTM')).toBe('html');
    expect(fileLang('styles.css')).toBe('css');
    expect(fileLang('app.js')).toBe('js');
    expect(fileLang('mod.mjs')).toBe('js');
    expect(fileLang('data.json')).toBe('json');
    expect(fileLang('README.md')).toBe('md');
    expect(fileLang('notes.rst')).toBe('text');
  });
});

describe('findFile / entryHtml / totalChars', () => {
  it('查找文件时忽略大小写', () => {
    expect(findFile(project, 'INDEX.HTML')?.path).toBe('index.html');
    expect(findFile(project, 'missing.js')).toBeUndefined();
  });

  it('入口文件缺失时返回空串而不是抛错', () => {
    expect(entryHtml(project)).toContain('<!DOCTYPE html>');
    expect(entryHtml([{ path: 'app.js', content: 'x' }])).toBe('');
  });

  it('统计所有文件的字符总数', () => {
    const sum = project.reduce((acc, file) => acc + file.content.length, 0);
    expect(totalChars(project)).toBe(sum);
    expect(totalChars([])).toBe(0);
  });
});

describe('bundleForPreview', () => {
  const bundled = bundleForPreview(project);

  it('把本地样式表内联成 <style>', () => {
    expect(bundled).toContain('<style data-src="styles.css">');
    expect(bundled).toContain('body { margin: 0; }');
    expect(bundled).not.toContain('href="styles.css"');
  });

  it('把本地脚本内联成行内 <script>，支持 ./ 前缀', () => {
    expect(bundled).toContain('<script data-src="app.js">');
    expect(bundled).toContain("getElementById('go')");
    expect(bundled).not.toContain('src="./app.js"');
  });

  it('保留 CDN 资源与非样式表 link', () => {
    expect(bundled).toContain('https://cdn.jsdelivr.net/npm/x/x.css');
    expect(bundled).toContain('https://unpkg.com/vendor.js');
    expect(bundled).toContain('href="favicon.ico"');
  });

  it('引用了不存在的本地文件时原样保留，不吞掉标签', () => {
    const broken = bundleForPreview([
      { path: ENTRY_FILE, content: '<html><head><script src="missing.js"></script></head></html>' },
    ]);
    expect(broken).toContain('src="missing.js"');
  });

  it('保留 type="module" 属性', () => {
    const moduleProject: ProjectFile[] = [
      {
        path: ENTRY_FILE,
        content: '<html><body><script type="module" src="app.js"></script></body></html>',
      },
      { path: 'app.js', content: 'export const a = 1;' },
    ];
    expect(bundleForPreview(moduleProject)).toContain('<script data-src="app.js" type="module">');
  });

  it('没有入口文件时返回空串', () => {
    expect(bundleForPreview([])).toBe('');
    expect(bundleForPreview([{ path: 'app.js', content: 'x' }])).toBe('');
  });
});

describe('slugifyName', () => {
  it('清掉非法字符并把空格转成连字符', () => {
    expect(slugifyName('我的 待办 清单')).toBe('我的-待办-清单');
    expect(slugifyName('a/b:c*?"<>|d')).toBe('abcd');
  });

  it('空名称回落到默认名', () => {
    expect(slugifyName('   ')).toBe('atomforge-project');
    expect(slugifyName('')).toBe('atomforge-project');
  });

  it('长名称被截断', () => {
    expect(slugifyName('x'.repeat(80))).toHaveLength(48);
  });
});