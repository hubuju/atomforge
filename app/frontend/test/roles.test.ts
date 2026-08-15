import { describe, expect, it } from 'vitest';

import {
  actionableFindings,
  coderMessages,
  extractJson,
  fileLooksComplete,
  fixerMessages,
  parseFindings,
  parseSpec,
  plannerMessages,
  reviewerMessages,
  specDigest,
  specHeadline,
  stripCodeFence,
  type ProjectSpec,
} from '@/lib/roles';
import type { ProjectFile } from '@/lib/client';

/**
 * The multi-agent pipeline hands structured payloads between roles. Models are
 * unreliable narrators — they wrap JSON in fences, invent severities, prefix
 * code with the filename. These tests pin down the normalization layer that
 * keeps one sloppy response from derailing the whole run.
 */

const RAW_SPEC = `好的，这是规格：

\`\`\`json
{
  "title": "极简待办清单",
  "summary": "管理每日任务的小工具",
  "views": ["顶部输入区", "任务列表", "底部统计条", "", "  "],
  "data": ["tasks：id、title、done"],
  "interactions": ["回车添加任务 -> 出现在列表顶部", "点击勾选 -> 标题划线"],
  "files": [
    { "path": "./index.html", "purpose": "页面结构" },
    { "path": "styles.css", "purpose": "视觉样式" },
    { "path": "INDEX.html", "purpose": "重复项，应被丢弃" },
    { "path": "  ", "purpose": "空路径，应被丢弃" }
  ]
}
\`\`\``;

describe('extractJson', () => {
  it('剥掉 markdown 围栏', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('从前后有闲话的文本里截出 JSON', () => {
    expect(extractJson('这是结果：{"a":1} 就这样')).toBe('{"a":1}');
  });

  it('没有 JSON 时原样返回', () => {
    expect(extractJson('  纯文本  ')).toBe('纯文本');
  });
});

describe('parseSpec', () => {
  const spec = parseSpec(RAW_SPEC, 6);

  it('解析带围栏与闲话的规格', () => {
    expect(spec.title).toBe('极简待办清单');
    expect(spec.summary).toBe('管理每日任务的小工具');
  });

  it('过滤空条目', () => {
    expect(spec.views).toEqual(['顶部输入区', '任务列表', '底部统计条']);
  });

  it('归一化路径、去重（忽略大小写）、丢掉空路径', () => {
    expect(spec.files.map((file) => file.path)).toEqual(['index.html', 'styles.css']);
  });

  it('文件数不受 maxFiles 硬性限制', () => {
    const many = JSON.stringify({
      title: 'x',
      summary: 'y',
      files: Array.from({ length: 9 }, (_, i) => ({ path: `f${i}.js`, purpose: 'p' })),
    });
    expect(parseSpec(many, 4).files).toHaveLength(9);
  });

  it('标题与说明缺失时有兜底文案', () => {
    const spec2 = parseSpec('{"files":[{"path":"index.html","purpose":"p"}]}', 6);
    expect(spec2.title).toBe('未命名项目');
    expect(spec2.summary).toContain('规划者');
  });

  it('没有任何文件时抛错，交给编排器重试', () => {
    expect(() => parseSpec('{"title":"x","files":[]}', 6)).toThrow();
    expect(() => parseSpec('这不是 JSON', 6)).toThrow();
  });
});

describe('specDigest / specHeadline', () => {
  const spec = parseSpec(RAW_SPEC, 6);

  it('摘要包含下游角色需要的全部信息', () => {
    const digest = specDigest(spec);
    expect(digest).toContain('极简待办清单');
    expect(digest).toContain('界面区块');
    expect(digest).toContain('数据结构');
    expect(digest).toContain('交互清单');
    expect(digest).toContain('index.html：页面结构');
  });

  it('空的区块不会留下空标题', () => {
    const bare: ProjectSpec = {
      title: 'T',
      summary: 'S',
      views: [],
      data: [],
      interactions: [],
      files: [{ path: 'index.html', purpose: 'p' }],
    };
    const digest = specDigest(bare);
    expect(digest).not.toContain('界面区块');
    expect(digest).toContain('文件划分');
  });

  it('一句话摘要给出文件数与交互数', () => {
    expect(specHeadline(spec)).toBe('极简待办清单 · 2 个文件 · 2 条交互');
  });
});

describe('plannerMessages', () => {
  it('全新项目时说明要覆盖完整实现', () => {
    const messages = plannerMessages('做个待办', [], 6);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('规划者');
    expect(messages[1].content).toContain('做个待办');
    expect(messages[1].content).toContain('全新项目');
  });

  it('增量修改时列出现有文件并要求只列改动文件', () => {
    const messages = plannerMessages('加个深色模式', [{ path: 'app.js', content: 'a\nb' }], 6);
    expect(messages[1].content).toContain('app.js');
    expect(messages[1].content).toContain('增量修改');
  });

  it('系统提示不再写死文件数上限，而是按需拆分', () => {
    const content = plannerMessages('x', [], 4)[0].content;
    expect(content).toContain('按需拆分');
    expect(content).not.toContain('不超过 4 个');
  });
});

describe('coderMessages', () => {
  const spec = parseSpec(RAW_SPEC, 6);
  const written: ProjectFile[] = [{ path: 'index.html', content: '<html></html>' }];

  it('带上已写文件与待写文件，且点明本次目标文件', () => {
    const messages = coderMessages({
      spec,
      target: spec.files[1],
      written,
      pending: [],
      previous: '',
      index: 1,
      total: 2,
    });
    const user = messages[1].content;
    expect(messages[0].content).toContain('实现者');
    expect(user).toContain('第 2/2 个文件');
    expect(user).toContain('styles.css');
    expect(user).toContain('<html></html>');
  });

  it('目标文件自身不会被塞进「已写好的文件」上下文', () => {
    const messages = coderMessages({
      spec,
      target: spec.files[0],
      written,
      pending: [spec.files[1]],
      previous: '',
      index: 0,
      total: 2,
    });
    const user = messages[1].content;
    expect(user).not.toContain('<<<FILE path="index.html">>>\n<html></html>');
    expect(user).toContain('还没有写、但一定会存在的文件');
  });

  it('已有旧版本时要求做最小必要改动', () => {
    const messages = coderMessages({
      spec,
      target: spec.files[1],
      written,
      pending: [],
      previous: 'body { color: red; }',
      index: 1,
      total: 2,
    });
    expect(messages[1].content).toContain('最小必要改动');
    expect(messages[1].content).toContain('body { color: red; }');
  });
});

describe('fileLooksComplete', () => {
  it('HTML 以 </html> 结尾才算完整', () => {
    expect(fileLooksComplete('<!DOCTYPE html><html><body>x</body></html>', 'index.html')).toBe(true);
    expect(fileLooksComplete('<html><body>x', 'index.html')).toBe(false);
  });

  it('含正则字面量的 JS 不误判为括号不配平', () => {
    const js = `var url = location.href;
var clean = url.replace(/https?:\\/\\//, '');
var braces = '{}'.replace(/}/g, ')');
function ok() { return clean + braces; }
ok();`;
    expect(fileLooksComplete(js, 'app.js')).toBe(true);
  });

  it('正则里的 // 不误判为行注释吞掉后续代码', () => {
    const js = `var re = /https?:\\/\\//i;
var n = 1 + 2;
console.log(re, n);`;
    expect(fileLooksComplete(js, 'app.js')).toBe(true);
  });

  it('关键字 + 空格 + 正则（如 if (/}/)）不误判为括号不配平', () => {
    const js = `function boot(str) {
  if (/}/.test(str)) { return 'brace'; }
  var ratio = (price / 100);
  return ratio;
}
boot('x');`;
    expect(fileLooksComplete(js, 'app.js')).toBe(true);
  });

  it('真正截断的 JS（括号未闭合）判不完整', () => {
    expect(fileLooksComplete('function run() {\n  var a = 1;\n', 'app.js')).toBe(false);
  });
});

describe('stripCodeFence', () => {
  it('剥掉 markdown 围栏', () => {
    expect(stripCodeFence('```js\nvar a = 1;\n```', 'app.js')).toBe('var a = 1;');
  });

  it('剥掉模型习惯性加上的 FILE 包裹', () => {
    expect(stripCodeFence('<<<FILE path="app.js">>>\nvar a = 1;\n<<<END>>>', 'app.js')).toBe(
      'var a = 1;',
    );
  });

  it('HTML 文件丢掉文档开头之前的闲话', () => {
    const raw = '这是文件内容：\n<!DOCTYPE html>\n<html></html>';
    expect(stripCodeFence(raw, 'index.html')).toBe('<!DOCTYPE html>\n<html></html>');
  });

  it('干净的内容原样保留', () => {
    expect(stripCodeFence('body { margin: 0; }', 'styles.css')).toBe('body { margin: 0; }');
  });
});

describe('parseFindings', () => {
  it('按严重度排序并归一化未知严重度', () => {
    const raw = JSON.stringify({
      findings: [
        { severity: 'minor', file: 'styles.css', detail: '按钮圆角不统一', suggestion: '统一 6px' },
        { severity: 'BLOCKER', file: './app.js', detail: 'render 未定义', suggestion: '补上函数' },
        { severity: '瞎写的', file: 'app.js', detail: '未知级别应降级为 minor' },
        { severity: 'major', file: 'app.js', detail: '空列表会崩', suggestion: '加判空' },
      ],
    });
    const findings = parseFindings(raw);
    expect(findings.map((item) => item.severity)).toEqual([
      'blocker',
      'major',
      'minor',
      'minor',
    ]);
    expect(findings[0].file).toBe('app.js');
    expect(findings[0].detail).toBe('render 未定义');
  });

  it('丢掉没有描述的条目，其余全部保留（不设条数上限）', () => {
    const raw = JSON.stringify({
      findings: [
        { severity: 'major', file: 'a.js', detail: '   ' },
        ...Array.from({ length: 10 }, (_, i) => ({
          severity: 'major',
          file: 'a.js',
          detail: `问题 ${i}`,
        })),
      ],
    });
    expect(parseFindings(raw)).toHaveLength(10);
  });

  it('审查通过时返回空数组', () => {
    expect(parseFindings('{"findings": []}')).toEqual([]);
    expect(parseFindings('```json\n{"findings":[]}\n```')).toEqual([]);
  });

  it('不是 JSON 时抛错，交给编排器重试', () => {
    expect(() => parseFindings('代码看起来没问题')).toThrow();
  });
});

describe('actionableFindings', () => {
  it('只保留能定位到文件的非打磨项', () => {
    const findings = parseFindings(
      JSON.stringify({
        findings: [
          { severity: 'blocker', file: 'app.js', detail: '崩了' },
          { severity: 'major', file: '', detail: '跨文件问题，没有定位' },
          { severity: 'minor', file: 'styles.css', detail: '圆角' },
        ],
      }),
    );
    const actionable = actionableFindings(findings);
    expect(actionable).toHaveLength(1);
    expect(actionable[0].file).toBe('app.js');
  });
});

describe('reviewerMessages / fixerMessages', () => {
  const spec = parseSpec(RAW_SPEC, 6);
  const files: ProjectFile[] = [
    { path: 'index.html', content: '<html></html>' },
    { path: 'app.js', content: 'render();' },
  ];

  it('审查者拿到规格与全部代码，第二轮起提示重新完整检查', () => {
    expect(reviewerMessages(spec, files, 1)[1].content).not.toContain('第 1 轮');
    const second = reviewerMessages(spec, files, 2)[1].content;
    expect(second).toContain('第 2 轮');
    expect(second).toContain('render();');
  });

  it('CSS 以摘要形式进入审查上下文，并附带交叉引用对照表', () => {
    const withCss: ProjectFile[] = [
      {
        path: 'index.html',
        content: '<html><body><button id="addBtn">x</button></body></html>',
      },
      {
        path: 'app.js',
        content: "document.getElementById('addBtn').addEventListener('click', fn);\ndocument.getElementById('nope');",
      },
      {
        path: 'styles.css',
        content: '.card { margin: 0; }\n@media (max-width: 600px) { .card { margin: 0; } }',
      },
    ];
    const content = reviewerMessages(spec, withCss, 1)[1].content;
    expect(content).toContain('styles-digest');
    expect(content).not.toContain('.card { margin: 0; }');
    expect(content).toContain('addBtn');
    expect(content).toContain('不存在的 id：nope');
  });

  it('修复者只收到被点名文件的完整内容与问题清单', () => {
    const findings = parseFindings(
      JSON.stringify({
        findings: [
          { severity: 'blocker', file: 'app.js', detail: 'render 未定义', suggestion: '补函数' },
        ],
      }),
    );
    const messages = fixerMessages({
      spec,
      file: files[1],
      findings,
      siblings: files,
    });
    const user = messages[1].content;
    expect(messages[0].content).toContain('修复者');
    expect(user).toContain('**app.js**');
    expect(user).toContain('[阻塞] render 未定义');
    expect(user).toContain('建议：补函数');
    expect(user).toContain('<<<FILE path="index.html">>>');
  });
});