/**
 * Local mock LLM provider for the closed-loop E2E test.
 *
 * Serves an OpenAI-compatible `POST /v1/chat/completions` endpoint that answers
 * each pipeline role deterministically, so the whole Planner → Coder →
 * Reviewer flow can be exercised without spending real API quota:
 *
 *   - Planner  : returns a structured spec (JSON) for a counter page;
 *   - Coder    : returns the complete content of the requested file;
 *   - Reviewer : returns an empty findings list (nothing to fix);
 *   - Fixer    : echoes the file content (not used in the default flow).
 *
 * The generated files are written to pass the frontend's static audit (paired
 * script tags, balanced braces, viewport meta, real event bindings, no
 * placeholder text) and the sandbox runtime probe.
 *
 * Run: node e2e/mock-llm-server.mjs   (default port 8124)
 */

import http from 'node:http';

const PORT = Number(process.env.MOCK_LLM_PORT || 8124);

function pickBrief(messages) {
  const user = [...messages].reverse().find((m) => m.role === 'user');
  return (user && typeof user.content === 'string' && user.content) || '';
}

function titleForBrief(brief) {
  const renamed = brief.match(/把标题改成\s*(.+)/);
  if (renamed) return renamed[1].trim().slice(0, 12);
  const cleaned = brief.replace(/[。！？\s]/g, '');
  return cleaned.slice(0, 12) || '极简计数器';
}

function specJson(brief) {
  const title = titleForBrief(brief);
  return JSON.stringify({
    title,
    summary: '一个用于端到端验证的计数器页面',
    views: ['计数卡片', '操作按钮区', '说明文字', '状态提示'],
    data: ['计数：当前数值'],
    interactions: [
      '点击加一按钮 -> 计数加一',
      '页面加载 -> 显示初始计数',
      '重复点击 -> 计数连续累加',
      '计数变化 -> 页面同步刷新数字',
    ],
    files: [
      { path: 'index.html', purpose: '页面结构' },
      { path: 'styles.css', purpose: '视觉样式' },
      { path: 'app.js', purpose: '计数逻辑' },
    ],
  });
}

function htmlFor(title) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<main class="card">
  <h1 id="title">${title}</h1>
  <p class="hint">点击按钮，数字会增加</p>
  <p class="count"><span id="count">0</span></p>
  <button id="btn" type="button">加一</button>
</main>
<script src="app.js" defer></script>
</body>
</html>`;
}

const CSS = `*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;background:#f4f5f0;color:#1f241b;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{background:#fff;border:1px solid #dfe3d8;border-radius:12px;padding:28px 34px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.05)}
#title{font-size:22px;margin:0 0 8px}
.hint{color:#6a7161;font-size:13px;margin:0 0 14px}
.count{font-size:34px;margin:0 0 18px}
#btn{background:#2f5d3a;color:#fff;border:0;border-radius:8px;padding:10px 22px;font-size:15px;cursor:pointer}
#btn:hover{background:#25492e}`;

const JS = `(function () {
  'use strict';
  var count = 0;
  var countEl = document.getElementById('count');
  var btn = document.getElementById('btn');
  if (!countEl || !btn) {
    return;
  }
  btn.addEventListener('click', function () {
    count += 1;
    countEl.textContent = String(count);
  });
})();`;

function targetFile(userContent) {
  const m = userContent.match(/现在请写第\s*\d+\/\d+\s*个文件：\*\*([^*\n]+)\*\*/);
  return m ? m[1].trim() : '';
}

function titleFromMessage(userContent) {
  const m = userContent.match(/项目：([^\n]+)/);
  return m ? m[1].trim() : '极简计数器';
}

function roleAnswer(messages) {
  const system = (messages.find((m) => m.role === 'system')?.content) || '';
  const userContent = ([...messages].reverse().find((m) => m.role === 'user')?.content) || '';
  const brief = userContent.match(/用户需求：([\s\S]*?)(?:\n\n|$)/)?.[1]?.trim() || userContent;

  if (system.includes('规划者（Planner）') || system.includes('JSON 修复器')) {
    return specJson(brief);
  }
  if (system.includes('审查者（Reviewer）')) {
    return JSON.stringify({ findings: [] });
  }
  if (system.includes('实现者（Coder）') || system.includes('修复者（Fixer）')) {
    const path = targetFile(userContent) || 'index.html';
    const title = titleFromMessage(userContent);
    if (path.endsWith('.css')) return CSS;
    if (path.endsWith('.js')) return JS;
    return htmlFor(title);
  }
  return '这是模拟模型对以下需求的回答：' + brief.slice(0, 40);
}

function sseChunk(content) {
  return (
    `data: ${JSON.stringify({
      id: 'mock-1',
      object: 'chat.completion.chunk',
      model: 'mock',
      choices: [{ index: 0, delta: { content } }],
    })}\n\n`
  );
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        /* keep empty */
      }
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const answer = roleAnswer(messages);
      const stream = body.stream === true;

      if (!stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'mock-1',
            object: 'chat.completion',
            model: body.model || 'mock',
            choices: [{ index: 0, message: { role: 'assistant', content: answer } }],
            usage: { prompt_tokens: 10, completion_tokens: answer.length, total_tokens: 10 + answer.length },
          }),
        );
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      let offset = 0;
      const chunkSize = 48;
      const tick = () => {
        if (offset >= answer.length) {
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.write(sseChunk(answer.slice(offset, offset + chunkSize)));
        offset += chunkSize;
        setTimeout(tick, 5);
      };
      tick();
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"detail":"not found"}');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-llm] listening on http://127.0.0.1:${PORT}/v1/chat/completions`);
});
