import { describe, expect, it, vi } from 'vitest';

/**
 * Only the pure protocol helpers are under test. The generation transport
 * (backend relay / OpenAI-compatible fetch) is covered by the live backend,
 * not by unit tests; the SDK stub below is kept so the module graph never
 * pulls a browser-only client into the jsdom environment.
 */
vi.mock('@metagptx/web-sdk', () => ({
  createClient: () => ({ ai: {}, apiCall: { invoke: vi.fn() } }),
}));

// 顶层 await 导入：`describe` 回调在收集阶段就会执行，用 beforeAll 赋值来不及。
const agent = await import('@/lib/agent');

const FULL = `我会拆成三个文件实现。

<<<FILE path="index.html">>>
<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><button id="go">走</button><script src="app.js" defer></script></body></html>
<<<END>>>

<<<FILE path="./app.js">>>
console.log('hi');
<<<END>>>`;

describe('parseStream', () => {
  it('拆出方案说明与全部文件，并归一化路径', () => {
    const parsed = agent.parseStream(FULL);
    expect(parsed.text).toBe('我会拆成三个文件实现。');
    expect(parsed.files.map((file) => file.path)).toEqual(['index.html', 'app.js']);
    expect(parsed.files[1].content).toBe("console.log('hi');");
    expect(parsed.writing).toBe('');
    expect(parsed.closed).toBe(true);
  });

  it('文件块还没闭合时标记为正在写入', () => {
    const partial = `方案说明

<<<FILE path="index.html">>>
<!DOCTYPE html>
<html><body>`;
    const parsed = agent.parseStream(partial);
    expect(parsed.closed).toBe(false);
    expect(parsed.writing).toBe('index.html');
    expect(parsed.files[0].content).toContain('<!DOCTYPE html>');
  });

  it('模型完全无视协议、只吐裸 HTML 时回落成 index.html', () => {
    const bare = '这是页面：\n<!DOCTYPE html>\n<html><body>hi</body></html>';
    const parsed = agent.parseStream(bare);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].path).toBe('index.html');
    expect(parsed.closed).toBe(true);
    expect(parsed.text).toBe('这是页面：');
  });

  it('裸 HTML 未写到 </html> 时视为未完成', () => {
    const parsed = agent.parseStream('<!DOCTYPE html>\n<html><body>hi');
    expect(parsed.closed).toBe(false);
    expect(parsed.writing).toBe('index.html');
  });

  it('既没有文件块也没有 HTML 时只有文本', () => {
    const parsed = agent.parseStream('我先问你一个问题');
    expect(parsed.files).toEqual([]);
    expect(parsed.text).toBe('我先问你一个问题');
  });

  it('同一路径重复出现时后写的覆盖先写的', () => {
    const raw =
      '<<<FILE path="app.js">>>\nold\n<<<END>>>\n<<<FILE path="app.js">>>\nnew\n<<<END>>>';
    const parsed = agent.parseStream(raw);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].content).toBe('new');
  });
});

describe('mergeFiles', () => {
  it('替换改动文件、保留未改动文件，入口文件排最前', () => {
    const current = [
      { path: 'index.html', content: '<html></html>' },
      { path: 'styles.css', content: 'old css' },
      { path: 'app.js', content: 'old js' },
    ];
    const merged = agent.mergeFiles(current, [
      { path: 'app.js', content: 'new js' },
      { path: 'extra.js', content: 'extra' },
    ]);
    expect(merged.map((file) => file.path)).toEqual([
      'index.html',
      'app.js',
      'extra.js',
      'styles.css',
    ]);
    expect(merged.find((file) => file.path === 'app.js')?.content).toBe('new js');
    expect(merged.find((file) => file.path === 'styles.css')?.content).toBe('old css');
  });

  it('大小写不同的同一路径视为同一个文件', () => {
    const merged = agent.mergeFiles(
      [{ path: 'App.js', content: 'old' }],
      [{ path: 'app.js', content: 'new' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].content).toBe('new');
  });
});

describe('isRunnable / buildPreview', () => {
  const files = agent.parseStream(FULL).files;

  it('入口文件闭合才算可运行', () => {
    expect(agent.isRunnable(files)).toBe(true);
    expect(agent.isRunnable([{ path: 'index.html', content: '<html><body>' }])).toBe(false);
    expect(agent.isRunnable([])).toBe(false);
  });

  it('注入 storage 兜底与运行时探针，并内联本地脚本', () => {
    const html = agent.buildPreview(files);
    expect(html).toContain('__atomforge_probe__');
    expect(html).toContain('__atomforge');
    expect(html).toContain("console.log('hi');");
    // 注入位置必须在 <head> 之后，否则探针晚于业务脚本执行
    expect(html.indexOf('__atomforge_probe__')).toBeGreaterThan(html.indexOf('<head'));
  });

  it('没有可运行页面时返回空串', () => {
    expect(agent.buildPreview([])).toBe('');
  });
});

describe('readPreviewMessage', () => {
  it('识别 ready / error / report 三类消息', () => {
    expect(agent.readPreviewMessage({ __atomforge: true, payload: { kind: 'ready' } })).toEqual({
      type: 'ready',
    });

    const err = agent.readPreviewMessage({
      __atomforge: true,
      payload: { kind: 'error', message: 'boom', source: 'app.js', line: 3 },
    });
    expect(err?.type).toBe('error');

    const report = agent.readPreviewMessage({
      __atomforge: true,
      payload: { kind: 'report', report: { nodes: 10, errors: [] } },
    });
    expect(report?.type).toBe('report');
  });

  it('拒绝不属于自己的 postMessage', () => {
    expect(agent.readPreviewMessage(null)).toBeNull();
    expect(agent.readPreviewMessage('hello')).toBeNull();
    expect(agent.readPreviewMessage({ payload: { kind: 'ready' } })).toBeNull();
    expect(agent.readPreviewMessage({ __atomforge: true })).toBeNull();
    expect(agent.readPreviewMessage({ __atomforge: true, payload: { kind: 'other' } })).toBeNull();
  });
});

describe('summarize', () => {
  it('压缩空白并截断到 80 字符', () => {
    expect(agent.summarize('  多行\n\n说明  ', 'fallback')).toBe('多行 说明');
    expect(agent.summarize('x'.repeat(200), 'fallback')).toHaveLength(80);
  });

  it('文本为空时使用兜底文案', () => {
    expect(agent.summarize('   ', '用户的需求')).toBe('用户的需求');
  });
});