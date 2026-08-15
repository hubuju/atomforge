import { describe, expect, it } from 'vitest';

import {
  auditPrompt,
  emptyAudit,
  isRuntimeReport,
  mergeAudit,
  runtimeAudit,
  staticAudit,
  type RuntimeReport,
} from '@/lib/audit';
import type { ProjectFile } from '@/lib/client';

/**
 * The self-check is the product's safety net: it is what turns "the preview
 * looks fine but nothing works" into an actionable repair prompt. Every rule
 * here is tested in both directions — it must fire on a real defect and stay
 * quiet on healthy code, otherwise the auto-fix loop either misses bugs or
 * chases phantoms.
 */

function check(checks: ReturnType<typeof staticAudit>, id: string) {
  const found = checks.find((item) => item.id === id);
  expect(found, `缺少检查项 ${id}`).toBeDefined();
  return found!;
}

const healthy: ProjectFile[] = [
  {
    path: 'index.html',
    content: [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1">',
      '  <link rel="stylesheet" href="styles.css">',
      '</head>',
      '<body>',
      '  <button id="go">开始</button>',
      '  <script src="app.js" defer></script>',
      '</body>',
      '</html>',
    ].join('\n'),
  },
  { path: 'styles.css', content: 'body { margin: 0; font-family: sans-serif; }' },
  {
    path: 'app.js',
    content: [
      'function boot() {',
      "  var go = document.getElementById('go');",
      "  go.addEventListener('click', function () { go.textContent = '已开始'; });",
      '}',
      'boot();',
    ].join('\n'),
  },
];

describe('staticAudit — 健康项目', () => {
  const checks = staticAudit(healthy);

  it('所有检查项都通过', () => {
    const bad = checks.filter((item) => item.level !== 'pass');
    expect(bad, JSON.stringify(bad)).toHaveLength(0);
  });

  it('合并结果为 ok 且尚未看到运行时数据', () => {
    const merged = mergeAudit(checks, null);
    expect(merged.ok).toBe(true);
    expect(merged.errors).toHaveLength(0);
    expect(merged.runtimeSeen).toBe(false);
  });
});

describe('staticAudit — 各类缺陷', () => {
  it('没有任何文件时直接报错', () => {
    const checks = staticAudit([]);
    expect(checks).toHaveLength(1);
    expect(checks[0].level).toBe('error');
  });

  it('缺少入口文件', () => {
    const checks = staticAudit([{ path: 'app.js', content: 'console.log(1);' }]);
    expect(check(checks, 'entry').level).toBe('error');
    expect(check(checks, 'entry').detail).toContain('index.html');
  });

  it('入口文件被截断（没写到 </html>）', () => {
    const checks = staticAudit([
      { path: 'index.html', content: '<!DOCTYPE html>\n<html><body><div>hi</div>' },
    ]);
    expect(check(checks, 'entry').level).toBe('error');
    expect(check(checks, 'entry').detail).toContain('截断');
  });

  it('引用了不存在的本地文件', () => {
    const checks = staticAudit([
      {
        path: 'index.html',
        content:
          '<html><head><link rel="stylesheet" href="theme.css"></head><body><script src="main.js"></script></body></html>',
      },
    ]);
    const refs = check(checks, 'refs');
    expect(refs.level).toBe('error');
    expect(refs.detail).toContain('theme.css');
    expect(refs.detail).toContain('main.js');
  });

  it('CDN 引用不算缺失文件', () => {
    const checks = staticAudit([
      {
        path: 'index.html',
        content:
          '<html><head><script src="https://cdn.tailwindcss.com"></script><meta name="viewport" content="width=device-width"></head><body><div>静态页</div></body></html>',
      },
    ]);
    expect(check(checks, 'refs').level).toBe('pass');
  });

  it('存在空文件', () => {
    const checks = staticAudit([...healthy, { path: 'empty.js', content: '  ' }]);
    expect(check(checks, 'empty').level).toBe('error');
    expect(check(checks, 'empty').detail).toContain('empty.js');
  });

  it('script 标签开合不成对', () => {
    const checks = staticAudit([
      {
        path: 'index.html',
        content: '<html><body><script>var a = 1;</body></html>',
      },
    ]);
    expect(check(checks, 'script-tags').level).toBe('error');
  });

  it('脚本括号不配平', () => {
    const files: ProjectFile[] = [
      healthy[0],
      healthy[1],
      { path: 'app.js', content: 'function boot() {\n  var a = 1;\n' },
    ];
    const balance = check(staticAudit(files), 'js-balance');
    expect(balance.level).toBe('error');
    expect(balance.detail).toContain('app.js');
  });

  it('字符串与注释里的括号不会造成误判', () => {
    const files: ProjectFile[] = [
      healthy[0],
      healthy[1],
      {
        path: 'app.js',
        content: [
          '// 这里有个不配平的 {',
          '/* 还有一个 ( */',
          'var tip = "缺一个 }";',
          'var tpl = `另一个 (`;',
          "document.getElementById('go').addEventListener('click', function () {});",
        ].join('\n'),
      },
    ];
    expect(check(staticAudit(files), 'js-balance').level).toBe('pass');
  });

  it('留下 TODO 占位只算警告', () => {
    const files: ProjectFile[] = [
      healthy[0],
      healthy[1],
      { path: 'app.js', content: "// TODO: 补充逻辑\ndocument.body.addEventListener('click', () => {});" },
    ];
    expect(check(staticAudit(files), 'placeholder').level).toBe('warn');
  });

  it('有按钮但完全没有事件绑定，视为阻塞缺陷', () => {
    const checks = staticAudit([
      {
        path: 'index.html',
        content:
          '<html><head><meta name="viewport" content="width=device-width"><style>b{color:red}</style></head><body><button>点我</button></body></html>',
      },
    ]);
    const interaction = check(checks, 'interaction');
    expect(interaction.level).toBe('error');
    expect(interaction.detail).toContain('事件绑定');
  });

  it('内联 onclick 也算已绑定事件', () => {
    const checks = staticAudit([
      {
        path: 'index.html',
        content:
          '<html><head><meta name="viewport" content="width=device-width"><style>b{color:red}</style></head><body><button onclick="alert(1)">点我</button></body></html>',
      },
    ]);
    expect(check(checks, 'interaction').level).toBe('pass');
  });

  it('样式文件没有被入口引用时给出警告', () => {
    const files: ProjectFile[] = [
      { ...healthy[0], content: healthy[0].content.replace(/<link[^>]*>/, '') },
      healthy[1],
      healthy[2],
    ];
    expect(check(staticAudit(files), 'css-link').level).toBe('warn');
  });

  it('完全没有样式时给出警告', () => {
    const checks = staticAudit([
      {
        path: 'index.html',
        content:
          '<html><head><meta name="viewport" content="width=device-width"></head><body><div>纯文本</div></body></html>',
      },
    ]);
    expect(check(checks, 'css-link').level).toBe('warn');
  });

  it('缺少 viewport 时给出警告', () => {
    const files: ProjectFile[] = [
      { ...healthy[0], content: healthy[0].content.replace(/<meta name="viewport"[^>]*>/, '') },
      healthy[1],
      healthy[2],
    ];
    expect(check(staticAudit(files), 'viewport').level).toBe('warn');
  });
});

describe('runtimeAudit', () => {
  const alive: RuntimeReport = {
    nodes: 42,
    bodyChars: 180,
    buttons: 3,
    listeners: 3,
    inlineHandlers: 0,
    canvases: 0,
    inputs: 1,
    errors: [],
  };

  it('正常运行的页面全部通过', () => {
    const checks = runtimeAudit(alive, healthy);
    expect(checks.filter((item) => item.level !== 'pass')).toHaveLength(0);
  });

  it('有运行时报错时定位为错误', () => {
    const checks = runtimeAudit({ ...alive, errors: ['a is not defined'] }, healthy);
    const found = checks.find((item) => item.id === 'runtime-error');
    expect(found?.level).toBe('error');
    expect(found?.detail).toContain('a is not defined');
  });

  it('页面几乎空白时定位为错误', () => {
    const checks = runtimeAudit(
      { ...alive, nodes: 4, bodyChars: 2, buttons: 0, inputs: 0, canvases: 0 },
      healthy,
    );
    expect(checks.find((item) => item.id === 'render')?.level).toBe('error');
  });

  it('canvas 页面即使文字很少也不算空白', () => {
    const checks = runtimeAudit(
      { ...alive, nodes: 5, bodyChars: 0, buttons: 0, inputs: 0, canvases: 1 },
      healthy,
    );
    expect(checks.find((item) => item.id === 'render')?.level).toBe('pass');
  });

  it('有控件但运行后一个事件都没绑定，判为点了没反应', () => {
    const checks = runtimeAudit({ ...alive, listeners: 0, inlineHandlers: 0 }, healthy);
    const wiring = checks.find((item) => item.id === 'runtime-wiring');
    expect(wiring?.level).toBe('error');
    expect(wiring?.detail).toContain('点了不会有反应');
  });

  it('完全没有可交互控件时只给警告', () => {
    const checks = runtimeAudit(
      { ...alive, buttons: 0, inputs: 0, canvases: 0, listeners: 0, inlineHandlers: 0 },
      healthy,
    );
    expect(checks.find((item) => item.id === 'runtime-wiring')?.level).toBe('warn');
  });
});

describe('mergeAudit / auditPrompt', () => {
  it('同 id 的运行时结果覆盖静态结果', () => {
    const merged = mergeAudit(
      [{ id: 'render', label: '页面渲染', level: 'error', detail: '静态判断' }],
      [{ id: 'render', label: '页面渲染', level: 'pass', detail: '实际跑起来了' }],
    );
    expect(merged.ok).toBe(true);
    expect(merged.runtimeSeen).toBe(true);
    expect(merged.checks).toHaveLength(1);
    expect(merged.checks[0].detail).toBe('实际跑起来了');
  });

  it('区分阻塞项与警告项', () => {
    const merged = mergeAudit(
      [
        { id: 'a', label: 'A', level: 'error', detail: 'e1' },
        { id: 'b', label: 'B', level: 'warn', detail: 'w1' },
        { id: 'c', label: 'C', level: 'pass', detail: 'ok' },
      ],
      null,
    );
    expect(merged.errors).toHaveLength(1);
    expect(merged.warnings).toHaveLength(1);
    expect(merged.ok).toBe(false);
  });

  it('空结果视为通过', () => {
    const empty = emptyAudit();
    expect(empty.ok).toBe(true);
    expect(empty.runtimeSeen).toBe(false);
  });

  it('把阻塞项编号后转成修复提示词', () => {
    const merged = mergeAudit(
      [
        { id: 'a', label: '交互绑定', level: 'error', detail: '按钮没有绑定事件' },
        { id: 'b', label: '移动端适配', level: 'warn', detail: '缺少 viewport' },
      ],
      null,
    );
    const prompt = auditPrompt(merged);
    expect(prompt).toContain('1. 交互绑定：按钮没有绑定事件');
    expect(prompt).toContain('顺带留意');
    expect(prompt).toContain('缺少 viewport');
    expect(prompt).toContain('不要重写整个项目');
  });
});

describe('isRuntimeReport', () => {
  it('只接受形状正确的探针数据', () => {
    expect(isRuntimeReport({ nodes: 1, errors: [] })).toBe(true);
    expect(isRuntimeReport({ nodes: '1', errors: [] })).toBe(false);
    expect(isRuntimeReport({ nodes: 1, errors: 'boom' })).toBe(false);
    expect(isRuntimeReport(null)).toBe(false);
    expect(isRuntimeReport('report')).toBe(false);
  });
});