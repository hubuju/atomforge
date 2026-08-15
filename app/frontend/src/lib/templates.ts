/**
 * Built-in starter templates (T1).
 *
 * These exist to make the common cases instant and free: when a brief clearly
 * describes a well-known app shape, we hand over a real, working project
 * without spending a single model token. Every template below is complete and
 * runnable — no TODOs, no dead handlers — because a template that still needs
 * fixing is worse than no template at all.
 *
 * Matching only *suggests*; the workspace always asks before applying one, so a
 * user who wanted something different is never forced into the wrong shape.
 */
import type { ProjectFile } from '@/lib/client';

export interface StarterTemplate {
  id: string;
  name: string;
  /** One-line pitch shown on the template card. */
  summary: string;
  /** Short tag used for grouping in the picker. */
  category: string;
  /** Lowercase trigger words matched against the user's brief. */
  keywords: string[];
  /** What the user can already do the moment the template is applied. */
  highlights: string[];
  files: ProjectFile[];
}

/** Shared page shell so every template starts from readable, modern defaults. */
const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;
background:#12130f;color:#e9ece2;-webkit-font-smoothing:antialiased}
button{font:inherit;cursor:pointer;border:0;border-radius:8px}
input,select,textarea{font:inherit;color:inherit}
h1,h2,h3{margin:0;font-weight:650;letter-spacing:-.01em}
`;

// ----------------------------------------------------------------- 1. todo

const TODO: StarterTemplate = {
  id: 'todo',
  name: '待办清单',
  summary: '添加、勾选、筛选、清除已完成，数据存在本地不会丢。',
  category: '效率工具',
  keywords: ['待办', 'todo', '任务', '清单', 'task', '事项', '备忘'],
  highlights: ['回车快速添加', '未完成 / 已完成筛选', '刷新后数据仍在'],
  files: [
    {
      path: 'index.html',
      content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>待办清单</title>
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<main class="app">
  <header class="head">
    <h1>今天要做的事</h1>
    <p class="summary" id="summary">还没有任务</p>
  </header>

  <form class="add" id="add-form">
    <input id="add-input" type="text" placeholder="添加一件事，回车保存" autocomplete="off" />
    <button type="submit">添加</button>
  </form>

  <div class="filters" id="filters">
    <button class="filter is-on" data-filter="all" type="button">全部</button>
    <button class="filter" data-filter="active" type="button">未完成</button>
    <button class="filter" data-filter="done" type="button">已完成</button>
  </div>

  <ul class="list" id="list"></ul>
  <p class="empty" id="empty">列表是空的，先添加一件事吧。</p>
  <button class="clear" id="clear-done" type="button">清除已完成</button>
</main>
<script src="app.js"></script>
</body>
</html>
`,
    },
    {
      path: 'styles.css',
      content: `${BASE_CSS}
.app{max-width:560px;margin:0 auto;padding:48px 20px 64px}
.head h1{font-size:26px}
.summary{margin:8px 0 0;font-size:13px;color:#9aa290}
.add{display:flex;gap:8px;margin:24px 0 16px}
.add input{flex:1;min-width:0;padding:11px 13px;border-radius:9px;border:1px solid #2c2f26;background:#1a1c16}
.add input:focus{outline:0;border-color:#a3d14a}
.add button{padding:0 18px;background:#a3d14a;color:#16180f;font-weight:650}
.filters{display:flex;gap:6px;margin-bottom:14px}
.filter{padding:6px 12px;font-size:12.5px;background:#1a1c16;color:#9aa290;border:1px solid #2c2f26}
.filter.is-on{color:#16180f;background:#a3d14a;border-color:#a3d14a}
.list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.item{display:flex;align-items:center;gap:11px;padding:12px 13px;border-radius:10px;
background:#1a1c16;border:1px solid #2c2f26}
.item input[type=checkbox]{width:17px;height:17px;accent-color:#a3d14a;cursor:pointer;flex:none}
.item span{flex:1;min-width:0;font-size:14.5px;word-break:break-word}
.item.done span{color:#6f7565;text-decoration:line-through}
.item button{background:transparent;color:#7d8471;font-size:18px;line-height:1;padding:2px 6px}
.item button:hover{color:#e4736b}
.empty{margin:28px 0;text-align:center;font-size:13px;color:#7d8471}
.clear{display:block;width:100%;margin-top:20px;padding:10px;background:#1a1c16;
color:#9aa290;border:1px solid #2c2f26}
.clear:hover{color:#e9ece2}
`,
    },
    {
      path: 'app.js',
      content: `(function () {
  'use strict';
  var KEY = 'starter.todo.items';
  var items = load();
  var filter = 'all';

  var listEl = document.getElementById('list');
  var emptyEl = document.getElementById('empty');
  var summaryEl = document.getElementById('summary');
  var formEl = document.getElementById('add-form');
  var inputEl = document.getElementById('add-input');

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(items));
    } catch (err) {
      /* private mode: keep working in memory */
    }
  }

  function visible() {
    if (filter === 'active') return items.filter(function (it) { return !it.done; });
    if (filter === 'done') return items.filter(function (it) { return it.done; });
    return items;
  }

  function render() {
    var rows = visible();
    listEl.textContent = '';
    rows.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'item' + (item.done ? ' done' : '');

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!item.done;
      box.addEventListener('change', function () {
        item.done = box.checked;
        save();
        render();
      });

      var text = document.createElement('span');
      text.textContent = item.text;

      var del = document.createElement('button');
      del.type = 'button';
      del.textContent = '\\u00d7';
      del.setAttribute('aria-label', '删除');
      del.addEventListener('click', function () {
        items = items.filter(function (it) { return it.id !== item.id; });
        save();
        render();
      });

      li.appendChild(box);
      li.appendChild(text);
      li.appendChild(del);
      listEl.appendChild(li);
    });

    emptyEl.style.display = rows.length ? 'none' : 'block';
    var left = items.filter(function (it) { return !it.done; }).length;
    summaryEl.textContent = items.length
      ? '共 ' + items.length + ' 项，还有 ' + left + ' 项未完成'
      : '还没有任务';
  }

  formEl.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = inputEl.value.trim();
    if (!text) return;
    items.push({ id: Date.now() + '-' + Math.random().toString(16).slice(2), text: text, done: false });
    inputEl.value = '';
    save();
    render();
  });

  document.getElementById('filters').addEventListener('click', function (event) {
    var btn = event.target.closest('.filter');
    if (!btn) return;
    filter = btn.getAttribute('data-filter');
    Array.prototype.forEach.call(document.querySelectorAll('.filter'), function (el) {
      el.classList.toggle('is-on', el === btn);
    });
    render();
  });

  document.getElementById('clear-done').addEventListener('click', function () {
    items = items.filter(function (it) { return !it.done; });
    save();
    render();
  });

  render();
})();
`,
    },
  ],
};

// ------------------------------------------------------------- 2. pomodoro

const POMODORO: StarterTemplate = {
  id: 'pomodoro',
  name: '番茄钟计时器',
  summary: '25 分钟专注 / 5 分钟休息自动切换，可暂停、重置、记录完成轮数。',
  category: '效率工具',
  keywords: ['番茄', 'pomodoro', '计时', '倒计时', 'timer', '专注', '时钟'],
  highlights: ['专注与休息自动轮换', '大字号剩余时间', '累计完成轮数'],
  files: [
    {
      path: 'index.html',
      content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>番茄钟</title>
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<main class="app">
  <p class="phase" id="phase">专注</p>
  <div class="dial">
    <svg viewBox="0 0 120 120" class="ring">
      <circle cx="60" cy="60" r="54" class="ring-bg"></circle>
      <circle cx="60" cy="60" r="54" class="ring-fg" id="ring"></circle>
    </svg>
    <div class="time" id="time">25:00</div>
  </div>
  <div class="actions">
    <button id="toggle" class="primary" type="button">开始</button>
    <button id="reset" class="ghost" type="button">重置</button>
    <button id="skip" class="ghost" type="button">跳过本轮</button>
  </div>
  <p class="stat" id="stat">已完成 0 个专注轮</p>
</main>
<script src="app.js"></script>
</body>
</html>
`,
    },
    {
      path: 'styles.css',
      content: `${BASE_CSS}
.app{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
gap:22px;padding:32px 20px}
.phase{margin:0;font-size:13px;letter-spacing:.14em;color:#a3d14a}
.dial{position:relative;width:248px;height:248px}
.ring{width:100%;height:100%;transform:rotate(-90deg)}
.ring-bg{fill:none;stroke:#22251c;stroke-width:6}
.ring-fg{fill:none;stroke:#a3d14a;stroke-width:6;stroke-linecap:round;
stroke-dasharray:339.29;stroke-dashoffset:0;transition:stroke-dashoffset .3s linear}
.time{position:absolute;inset:0;display:grid;place-items:center;font-size:52px;font-weight:600;
font-variant-numeric:tabular-nums}
.actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.primary{padding:11px 30px;background:#a3d14a;color:#16180f;font-weight:650}
.ghost{padding:11px 18px;background:#1a1c16;color:#9aa290;border:1px solid #2c2f26}
.ghost:hover{color:#e9ece2}
.stat{margin:0;font-size:13px;color:#7d8471;font-variant-numeric:tabular-nums}
body.rest .phase{color:#7fc4d6}
body.rest .ring-fg{stroke:#7fc4d6}
body.rest .primary{background:#7fc4d6}
`,
    },
    {
      path: 'app.js',
      content: `(function () {
  'use strict';
  var FOCUS = 25 * 60;
  var REST = 5 * 60;
  var CIRCUMFERENCE = 339.29;

  var mode = 'focus';
  var remaining = FOCUS;
  var running = false;
  var ticker = null;
  var rounds = 0;

  var timeEl = document.getElementById('time');
  var phaseEl = document.getElementById('phase');
  var ringEl = document.getElementById('ring');
  var statEl = document.getElementById('stat');
  var toggleEl = document.getElementById('toggle');

  function total() {
    return mode === 'focus' ? FOCUS : REST;
  }

  function pad(value) {
    return value < 10 ? '0' + value : '' + value;
  }

  function render() {
    var minutes = Math.floor(remaining / 60);
    var seconds = remaining % 60;
    timeEl.textContent = pad(minutes) + ':' + pad(seconds);
    phaseEl.textContent = mode === 'focus' ? '专注' : '休息';
    document.body.classList.toggle('rest', mode === 'rest');
    var ratio = remaining / total();
    ringEl.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - ratio));
    statEl.textContent = '已完成 ' + rounds + ' 个专注轮';
    toggleEl.textContent = running ? '暂停' : '开始';
  }

  function switchMode() {
    if (mode === 'focus') {
      rounds += 1;
      mode = 'rest';
    } else {
      mode = 'focus';
    }
    remaining = total();
  }

  function tick() {
    if (remaining > 0) {
      remaining -= 1;
      render();
      return;
    }
    switchMode();
    render();
  }

  function start() {
    if (running) return;
    running = true;
    ticker = window.setInterval(tick, 1000);
    render();
  }

  function pause() {
    running = false;
    if (ticker) window.clearInterval(ticker);
    ticker = null;
    render();
  }

  toggleEl.addEventListener('click', function () {
    if (running) pause();
    else start();
  });

  document.getElementById('reset').addEventListener('click', function () {
    pause();
    mode = 'focus';
    rounds = 0;
    remaining = FOCUS;
    render();
  });

  document.getElementById('skip').addEventListener('click', function () {
    switchMode();
    render();
  });

  render();
})();
`,
    },
  ],
};

// -------------------------------------------------------------- 3. expenses

const EXPENSE: StarterTemplate = {
  id: 'expense',
  name: '记账本',
  summary: '记录收入与支出，实时算出结余，明细可删可持久化。',
  category: '生活记录',
  keywords: ['记账', '账本', '收支', '花费', '预算', 'expense', '开销', '理财'],
  highlights: ['收入 / 支出双向记录', '自动汇总结余', '明细可删除、可持久化'],
  files: [
    {
      path: 'index.html',
      content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>记账本</title>
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<main class="app">
  <h1>记账本</h1>

  <section class="cards">
    <div class="card"><span>结余</span><strong id="balance">0.00</strong></div>
    <div class="card up"><span>收入</span><strong id="income">0.00</strong></div>
    <div class="card down"><span>支出</span><strong id="outcome">0.00</strong></div>
  </section>

  <form class="form" id="form">
    <input id="note" type="text" placeholder="说明，例如 午饭" autocomplete="off" />
    <input id="amount" type="number" step="0.01" min="0" placeholder="金额" />
    <select id="kind">
      <option value="out">支出</option>
      <option value="in">收入</option>
    </select>
    <button type="submit">记一笔</button>
  </form>

  <ul class="list" id="list"></ul>
  <p class="empty" id="empty">还没有记录，从上面记第一笔开始。</p>
</main>
<script src="app.js"></script>
</body>
</html>
`,
    },
    {
      path: 'styles.css',
      content: `${BASE_CSS}
.app{max-width:640px;margin:0 auto;padding:44px 20px 64px}
h1{font-size:24px;margin-bottom:20px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:22px}
.card{padding:14px;border-radius:11px;background:#1a1c16;border:1px solid #2c2f26;
display:flex;flex-direction:column;gap:6px}
.card span{font-size:11.5px;color:#8d947f;letter-spacing:.05em}
.card strong{font-size:19px;font-variant-numeric:tabular-nums}
.card.up strong{color:#a3d14a}
.card.down strong{color:#e4a05f}
.form{display:grid;grid-template-columns:1fr 110px 92px auto;gap:8px;margin-bottom:20px}
.form input,.form select{padding:10px 12px;border-radius:9px;border:1px solid #2c2f26;
background:#1a1c16;min-width:0}
.form input:focus,.form select:focus{outline:0;border-color:#a3d14a}
.form button{padding:0 18px;background:#a3d14a;color:#16180f;font-weight:650}
.list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px}
.row{display:flex;align-items:center;gap:12px;padding:12px 13px;border-radius:10px;
background:#1a1c16;border:1px solid #2c2f26}
.row .note{flex:1;min-width:0;font-size:14px;word-break:break-word}
.row .when{font-size:11.5px;color:#7d8471;flex:none}
.row .num{font-variant-numeric:tabular-nums;font-weight:600;flex:none}
.row.in .num{color:#a3d14a}
.row.out .num{color:#e4a05f}
.row button{background:transparent;color:#7d8471;font-size:17px;padding:2px 4px}
.row button:hover{color:#e4736b}
.empty{margin:26px 0;text-align:center;font-size:13px;color:#7d8471}
@media(max-width:560px){.form{grid-template-columns:1fr 1fr}.cards{grid-template-columns:1fr}}
`,
    },
    {
      path: 'app.js',
      content: `(function () {
  'use strict';
  var KEY = 'starter.expense.records';
  var records = load();

  var listEl = document.getElementById('list');
  var emptyEl = document.getElementById('empty');
  var noteEl = document.getElementById('note');
  var amountEl = document.getElementById('amount');
  var kindEl = document.getElementById('kind');

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(records));
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function money(value) {
    return (Math.round(value * 100) / 100).toFixed(2);
  }

  function render() {
    var income = 0;
    var outcome = 0;
    records.forEach(function (item) {
      if (item.kind === 'in') income += item.amount;
      else outcome += item.amount;
    });

    document.getElementById('income').textContent = money(income);
    document.getElementById('outcome').textContent = money(outcome);
    document.getElementById('balance').textContent = money(income - outcome);

    listEl.textContent = '';
    records.slice().reverse().forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'row ' + item.kind;

      var note = document.createElement('span');
      note.className = 'note';
      note.textContent = item.note;

      var when = document.createElement('span');
      when.className = 'when';
      when.textContent = item.when;

      var num = document.createElement('span');
      num.className = 'num';
      num.textContent = (item.kind === 'in' ? '+' : '-') + money(item.amount);

      var del = document.createElement('button');
      del.type = 'button';
      del.textContent = '\\u00d7';
      del.setAttribute('aria-label', '删除这笔');
      del.addEventListener('click', function () {
        records = records.filter(function (it) { return it.id !== item.id; });
        save();
        render();
      });

      li.appendChild(note);
      li.appendChild(when);
      li.appendChild(num);
      li.appendChild(del);
      listEl.appendChild(li);
    });

    emptyEl.style.display = records.length ? 'none' : 'block';
  }

  document.getElementById('form').addEventListener('submit', function (event) {
    event.preventDefault();
    var note = noteEl.value.trim() || '未命名';
    var amount = parseFloat(amountEl.value);
    if (!isFinite(amount) || amount <= 0) {
      amountEl.focus();
      return;
    }
    var now = new Date();
    records.push({
      id: Date.now() + '-' + Math.random().toString(16).slice(2),
      note: note,
      amount: amount,
      kind: kindEl.value === 'in' ? 'in' : 'out',
      when: (now.getMonth() + 1) + '/' + now.getDate()
    });
    noteEl.value = '';
    amountEl.value = '';
    save();
    render();
  });

  render();
})();
`,
    },
  ],
};

// --------------------------------------------------------------- 4. landing

const LANDING: StarterTemplate = {
  id: 'landing',
  name: '产品落地页',
  summary: '首屏主张 + 三个卖点 + 留资表单，适合作为宣传页起点。',
  category: '展示页面',
  keywords: ['落地页', 'landing', '官网', '宣传', '推广', '首页', '产品页', '介绍页'],
  highlights: ['首屏标题与行动按钮', '三卖点栅格', '邮箱留资即时校验'],
  files: [
    {
      path: 'index.html',
      content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Nimbus · 把想法一天变成产品</title>
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<header class="nav">
  <span class="logo">Nimbus</span>
  <nav>
    <a href="#features">能力</a>
    <a href="#signup">开始使用</a>
  </nav>
</header>

<section class="hero">
  <p class="badge">全新发布</p>
  <h1>把想法，一天变成能用的产品</h1>
  <p class="lede">
    描述你要什么，Nimbus 负责设计、实现与上线。不需要配置环境，不需要等排期。
  </p>
  <div class="cta">
    <a class="btn primary" href="#signup">免费开始</a>
    <a class="btn ghost" href="#features">看看能做什么</a>
  </div>
</section>

<section class="features" id="features">
  <article>
    <h3>说人话就够了</h3>
    <p>用一句话描述需求，系统自动拆成页面、数据与交互，不用你写规格文档。</p>
  </article>
  <article>
    <h3>改完立刻能看</h3>
    <p>每次调整都会即时构建并运行，右侧预览随时反映最新状态。</p>
  </article>
  <article>
    <h3>一键就能分享</h3>
    <p>生成公开链接，同事和客户打开就能用，不需要注册也不需要安装。</p>
  </article>
</section>

<section class="signup" id="signup">
  <h2>留个邮箱，抢先体验</h2>
  <form id="form" class="form" novalidate>
    <input id="email" type="email" placeholder="you@example.com" />
    <button type="submit">加入等待列表</button>
  </form>
  <p class="hint" id="hint">我们只会发送产品更新，随时可退订。</p>
</section>

<footer class="foot">© 2026 Nimbus Labs</footer>
<script src="app.js"></script>
</body>
</html>
`,
    },
    {
      path: 'styles.css',
      content: `${BASE_CSS}
a{color:inherit;text-decoration:none}
.nav{display:flex;align-items:center;justify-content:space-between;padding:20px 28px;
max-width:1080px;margin:0 auto}
.logo{font-weight:700;letter-spacing:-.02em;font-size:17px}
.nav nav{display:flex;gap:20px;font-size:13.5px;color:#9aa290}
.nav nav a:hover{color:#e9ece2}
.hero{max-width:760px;margin:0 auto;padding:76px 24px 64px;text-align:center}
.badge{display:inline-block;margin:0 0 18px;padding:5px 11px;border-radius:999px;font-size:11.5px;
letter-spacing:.06em;color:#a3d14a;background:rgba(163,209,74,.11);border:1px solid rgba(163,209,74,.3)}
.hero h1{font-size:clamp(30px,5.2vw,50px);line-height:1.1}
.lede{margin:18px auto 0;max-width:520px;font-size:15.5px;line-height:1.65;color:#9aa290}
.cta{display:flex;gap:11px;justify-content:center;flex-wrap:wrap;margin-top:30px}
.btn{display:inline-block;padding:12px 24px;border-radius:9px;font-size:14.5px;font-weight:600}
.btn.primary{background:#a3d14a;color:#16180f}
.btn.ghost{border:1px solid #333729;color:#c9cfbd}
.btn.ghost:hover{border-color:#a3d14a;color:#e9ece2}
.features{max-width:1000px;margin:0 auto;padding:36px 24px 72px;
display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
.features article{padding:24px;border-radius:13px;background:#1a1c16;border:1px solid #2c2f26;
transition:border-color .2s cubic-bezier(.25,1,.5,1)}
.features article:hover{border-color:rgba(163,209,74,.42)}
.features h3{font-size:16.5px;margin-bottom:9px}
.features p{margin:0;font-size:13.8px;line-height:1.62;color:#9aa290}
.signup{max-width:520px;margin:0 auto;padding:0 24px 72px;text-align:center}
.signup h2{font-size:24px;margin-bottom:20px}
.form{display:flex;gap:9px}
.form input{flex:1;min-width:0;padding:12px 14px;border-radius:9px;border:1px solid #2c2f26;
background:#1a1c16}
.form input:focus{outline:0;border-color:#a3d14a}
.form input.bad{border-color:#e4736b}
.form button{padding:0 20px;background:#a3d14a;color:#16180f;font-weight:650}
.hint{margin:12px 0 0;font-size:12.5px;color:#7d8471}
.hint.ok{color:#a3d14a}
.hint.bad{color:#e4736b}
.foot{padding:26px;text-align:center;font-size:12px;color:#6f7565;border-top:1px solid #22251c}
`,
    },
    {
      path: 'app.js',
      content: `(function () {
  'use strict';
  var form = document.getElementById('form');
  var email = document.getElementById('email');
  var hint = document.getElementById('hint');

  function setHint(text, tone) {
    hint.textContent = text;
    hint.className = 'hint' + (tone ? ' ' + tone : '');
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var value = email.value.trim();
    var valid = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(value);
    email.classList.toggle('bad', !valid);
    if (!valid) {
      setHint('这个邮箱看起来不太对，检查一下拼写。', 'bad');
      email.focus();
      return;
    }
    setHint('已收到，我们会用 ' + value + ' 通知你。', 'ok');
    email.value = '';
  });

  email.addEventListener('input', function () {
    if (email.classList.contains('bad')) {
      email.classList.remove('bad');
      setHint('我们只会发送产品更新，随时可退订。');
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll('a[href^="#"]'), function (link) {
    link.addEventListener('click', function (event) {
      var target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();
`,
    },
  ],
};

// ----------------------------------------------------------------- 5. snake

const SNAKE: StarterTemplate = {
  id: 'snake',
  name: '贪吃蛇小游戏',
  summary: '方向键或滑动控制，吃食物变长，撞墙结束并记录最高分。',
  category: '小游戏',
  keywords: ['游戏', '贪吃蛇', 'snake', '小游戏', 'game', '休闲'],
  highlights: ['键盘 + 触屏双控制', '实时分数与最高分', '暂停 / 重开'],
  files: [
    {
      path: 'index.html',
      content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>贪吃蛇</title>
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<main class="app">
  <header class="bar">
    <span>分数 <strong id="score">0</strong></span>
    <span>最高 <strong id="best">0</strong></span>
  </header>
  <div class="stage">
    <canvas id="board" width="360" height="360"></canvas>
    <div class="overlay" id="overlay">
      <p id="overlay-text">方向键开始</p>
      <button id="overlay-btn" type="button">开始游戏</button>
    </div>
  </div>
  <p class="tip">方向键 / WASD 控制，空格暂停；手机上可直接滑动。</p>
</main>
<script src="app.js"></script>
</body>
</html>
`,
    },
    {
      path: 'styles.css',
      content: `${BASE_CSS}
.app{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
gap:16px;padding:28px 16px}
.bar{display:flex;gap:26px;font-size:13.5px;color:#9aa290}
.bar strong{color:#e9ece2;font-variant-numeric:tabular-nums;font-size:16px;margin-left:4px}
.stage{position:relative;border-radius:13px;overflow:hidden;border:1px solid #2c2f26;background:#171a13}
canvas{display:block;max-width:min(88vw,360px);height:auto;touch-action:none}
.overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
justify-content:center;gap:14px;background:rgba(18,19,15,.86)}
.overlay.hide{display:none}
.overlay p{margin:0;font-size:15px;color:#c9cfbd}
.overlay button{padding:10px 24px;background:#a3d14a;color:#16180f;font-weight:650}
.tip{margin:0;font-size:12.5px;color:#7d8471;text-align:center}
`,
    },
    {
      path: 'app.js',
      content: `(function () {
  'use strict';
  var SIZE = 18;
  var CELLS = 20;
  var BEST_KEY = 'starter.snake.best';

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var overlay = document.getElementById('overlay');
  var overlayText = document.getElementById('overlay-text');
  var overlayBtn = document.getElementById('overlay-btn');

  var snake = null;
  var dir = { x: 1, y: 0 };
  var pending = dir;
  var food = { x: 5, y: 5 };
  var score = 0;
  var best = 0;
  var timer = null;
  var state = 'idle';

  function readBest() {
    try {
      return parseInt(window.localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    } catch (err) {
      return 0;
    }
  }

  function writeBest(value) {
    try {
      window.localStorage.setItem(BEST_KEY, String(value));
    } catch (err) {
      /* ignore */
    }
  }

  function placeFood() {
    var spot;
    do {
      spot = { x: Math.floor(Math.random() * CELLS), y: Math.floor(Math.random() * CELLS) };
    } while (snake.some(function (part) { return part.x === spot.x && part.y === spot.y; }));
    food = spot;
  }

  function reset() {
    snake = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
    dir = { x: 1, y: 0 };
    pending = dir;
    score = 0;
    scoreEl.textContent = '0';
    placeFood();
    draw();
  }

  function draw() {
    ctx.fillStyle = '#171a13';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#e4a05f';
    ctx.beginPath();
    ctx.arc(food.x * SIZE + SIZE / 2, food.y * SIZE + SIZE / 2, SIZE / 2 - 3, 0, Math.PI * 2);
    ctx.fill();

    snake.forEach(function (part, index) {
      ctx.fillStyle = index === 0 ? '#c3e86a' : '#8bb63f';
      ctx.fillRect(part.x * SIZE + 1, part.y * SIZE + 1, SIZE - 2, SIZE - 2);
    });
  }

  function gameOver() {
    state = 'over';
    if (timer) window.clearInterval(timer);
    timer = null;
    if (score > best) {
      best = score;
      bestEl.textContent = String(best);
      writeBest(best);
    }
    overlayText.textContent = '结束了，得分 ' + score;
    overlayBtn.textContent = '再来一局';
    overlay.classList.remove('hide');
  }

  function step() {
    dir = pending;
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= CELLS || head.y >= CELLS) {
      gameOver();
      return;
    }
    if (snake.some(function (part) { return part.x === head.x && part.y === head.y; })) {
      gameOver();
      return;
    }

    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      scoreEl.textContent = String(score);
      placeFood();
    } else {
      snake.pop();
    }
    draw();
  }

  function start() {
    if (state === 'over' || !snake) reset();
    state = 'running';
    overlay.classList.add('hide');
    if (timer) window.clearInterval(timer);
    timer = window.setInterval(step, 120);
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    if (timer) window.clearInterval(timer);
    timer = null;
    overlayText.textContent = '已暂停';
    overlayBtn.textContent = '继续';
    overlay.classList.remove('hide');
  }

  function turn(x, y) {
    if (dir.x === -x && dir.y === -y) return;
    pending = { x: x, y: y };
  }

  document.addEventListener('keydown', function (event) {
    var key = String(event.key || '').toLowerCase();
    if (key === ' ') {
      event.preventDefault();
      if (state === 'running') pause();
      else start();
      return;
    }
    if (key === 'arrowup' || key === 'w') turn(0, -1);
    else if (key === 'arrowdown' || key === 's') turn(0, 1);
    else if (key === 'arrowleft' || key === 'a') turn(-1, 0);
    else if (key === 'arrowright' || key === 'd') turn(1, 0);
    else return;
    event.preventDefault();
    if (state !== 'running') start();
  });

  var touchStart = null;
  canvas.addEventListener('touchstart', function (event) {
    var t = event.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });

  canvas.addEventListener('touchend', function (event) {
    if (!touchStart) return;
    var t = event.changedTouches[0];
    var dx = t.clientX - touchStart.x;
    var dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
    if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 1 : -1, 0);
    else turn(0, dy > 0 ? 1 : -1);
    if (state !== 'running') start();
  }, { passive: true });

  overlayBtn.addEventListener('click', start);

  best = readBest();
  bestEl.textContent = String(best);
  reset();
})();
`,
    },
  ],
};

// ------------------------------------------------------------------ 6. form

const FORM: StarterTemplate = {
  id: 'form',
  name: '报名收集表单',
  summary: '带必填校验的报名表，提交后进入名单并可导出 CSV。',
  category: '表单收集',
  keywords: ['表单', '报名', '问卷', '登记', '收集', 'form', '预约', '投票'],
  highlights: ['逐字段校验与错误提示', '提交后即时进名单', '一键导出 CSV'],
  files: [
    {
      path: 'index.html',
      content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>活动报名</title>
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<main class="app">
  <section class="panel">
    <h1>周末工作坊报名</h1>
    <p class="sub">填写后即刻确认席位，名额有限。</p>

    <form id="form" class="form" novalidate>
      <label>
        <span>姓名 *</span>
        <input id="name" type="text" autocomplete="name" />
        <em class="err" id="err-name"></em>
      </label>
      <label>
        <span>邮箱 *</span>
        <input id="email" type="email" autocomplete="email" />
        <em class="err" id="err-email"></em>
      </label>
      <label>
        <span>参与场次 *</span>
        <select id="slot">
          <option value="">请选择</option>
          <option value="周六上午">周六上午</option>
          <option value="周六下午">周六下午</option>
          <option value="周日上午">周日上午</option>
        </select>
        <em class="err" id="err-slot"></em>
      </label>
      <label>
        <span>想聊的话题（可选）</span>
        <textarea id="topic" rows="3"></textarea>
      </label>
      <button type="submit">提交报名</button>
      <p class="ok" id="ok"></p>
    </form>
  </section>

  <section class="panel">
    <div class="head">
      <h2>已报名 <span id="count">0</span> 人</h2>
      <button id="export" class="ghost" type="button">导出 CSV</button>
    </div>
    <ul class="list" id="list"></ul>
    <p class="empty" id="empty">还没有人报名。</p>
  </section>
</main>
<script src="app.js"></script>
</body>
</html>
`,
    },
    {
      path: 'styles.css',
      content: `${BASE_CSS}
.app{max-width:900px;margin:0 auto;padding:44px 20px 64px;display:grid;
grid-template-columns:1fr 1fr;gap:18px;align-items:start}
.panel{padding:24px;border-radius:13px;background:#1a1c16;border:1px solid #2c2f26}
h1{font-size:21px}
h2{font-size:16px}
.sub{margin:8px 0 20px;font-size:13px;color:#9aa290}
.form{display:flex;flex-direction:column;gap:14px}
label{display:flex;flex-direction:column;gap:6px}
label span{font-size:12.5px;color:#9aa290}
input,select,textarea{padding:10px 12px;border-radius:9px;border:1px solid #2c2f26;
background:#12130f;resize:vertical}
input:focus,select:focus,textarea:focus{outline:0;border-color:#a3d14a}
input.bad,select.bad{border-color:#e4736b}
.err{font-size:11.5px;color:#e4736b;min-height:14px;font-style:normal}
.form button{padding:11px;background:#a3d14a;color:#16180f;font-weight:650}
.ok{margin:0;font-size:12.5px;color:#a3d14a;min-height:16px}
.head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.ghost{padding:7px 13px;font-size:12.5px;background:#12130f;color:#9aa290;border:1px solid #2c2f26}
.ghost:hover{color:#e9ece2}
.list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px}
.row{padding:11px 12px;border-radius:9px;background:#12130f;border:1px solid #2c2f26}
.row strong{font-size:14px}
.row p{margin:4px 0 0;font-size:12px;color:#8d947f;word-break:break-word}
.empty{margin:16px 0 0;font-size:12.5px;color:#7d8471}
@media(max-width:760px){.app{grid-template-columns:1fr}}
`,
    },
    {
      path: 'app.js',
      content: `(function () {
  'use strict';
  var KEY = 'starter.form.entries';
  var entries = load();

  var fields = {
    name: document.getElementById('name'),
    email: document.getElementById('email'),
    slot: document.getElementById('slot')
  };

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(entries));
    } catch (err) {
      /* ignore */
    }
  }

  function setError(key, message) {
    var input = fields[key];
    var slot = document.getElementById('err-' + key);
    if (slot) slot.textContent = message || '';
    if (input) input.classList.toggle('bad', Boolean(message));
  }

  function validate() {
    var ok = true;
    var name = fields.name.value.trim();
    var email = fields.email.value.trim();
    var slot = fields.slot.value;

    if (name.length < 2) {
      setError('name', '请填写至少 2 个字的姓名');
      ok = false;
    } else {
      setError('name', '');
    }

    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(email)) {
      setError('email', '邮箱格式不正确');
      ok = false;
    } else if (entries.some(function (it) { return it.email === email; })) {
      setError('email', '这个邮箱已经报过名了');
      ok = false;
    } else {
      setError('email', '');
    }

    if (!slot) {
      setError('slot', '请选择一个场次');
      ok = false;
    } else {
      setError('slot', '');
    }

    return ok;
  }

  function render() {
    var listEl = document.getElementById('list');
    listEl.textContent = '';
    entries.slice().reverse().forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'row';
      var title = document.createElement('strong');
      title.textContent = item.name + ' · ' + item.slot;
      var meta = document.createElement('p');
      meta.textContent = item.email + (item.topic ? ' — ' + item.topic : '');
      li.appendChild(title);
      li.appendChild(meta);
      listEl.appendChild(li);
    });
    document.getElementById('count').textContent = String(entries.length);
    document.getElementById('empty').style.display = entries.length ? 'none' : 'block';
  }

  document.getElementById('form').addEventListener('submit', function (event) {
    event.preventDefault();
    document.getElementById('ok').textContent = '';
    if (!validate()) return;
    entries.push({
      name: fields.name.value.trim(),
      email: fields.email.value.trim(),
      slot: fields.slot.value,
      topic: document.getElementById('topic').value.trim()
    });
    save();
    render();
    document.getElementById('ok').textContent = '报名成功，已加入名单。';
    fields.name.value = '';
    fields.email.value = '';
    fields.slot.value = '';
    document.getElementById('topic').value = '';
  });

  document.getElementById('export').addEventListener('click', function () {
    if (!entries.length) return;
    var lines = ['姓名,邮箱,场次,话题'];
    entries.forEach(function (item) {
      lines.push([item.name, item.email, item.slot, item.topic || ''].map(function (cell) {
        return '"' + String(cell).replace(/"/g, '""') + '"';
      }).join(','));
    });
    var blob = new Blob(['\\ufeff' + lines.join('\\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'signups.csv';
    link.click();
    URL.revokeObjectURL(url);
  });

  render();
})();
`,
    },
  ],
};

export const STARTER_TEMPLATES: StarterTemplate[] = [
  TODO,
  POMODORO,
  EXPENSE,
  LANDING,
  SNAKE,
  FORM,
];

export interface TemplateMatch {
  template: StarterTemplate;
  score: number;
  hits: string[];
}

/**
 * Score built-in templates against a free-form brief.
 *
 * Deliberately conservative: a single incidental word should not hijack the
 * request, so we return the evidence alongside the score and let the caller
 * decide whether the confidence is worth interrupting the user for.
 */
export function matchTemplates(brief: string): TemplateMatch[] {
  const text = (brief || '').toLowerCase();
  if (text.trim().length < 2) return [];

  return STARTER_TEMPLATES.map((template) => {
    const hits = template.keywords.filter((word) => text.includes(word.toLowerCase()));
    // An explicit name mention is a far stronger signal than a generic keyword.
    const nameBonus = text.includes(template.name.toLowerCase()) ? 2 : 0;
    return { template, score: hits.length + nameBonus, hits };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Best match only, or null when nothing is convincing enough to suggest. */
export function bestTemplateMatch(brief: string): TemplateMatch | null {
  const matches = matchTemplates(brief);
  return matches.length ? matches[0] : null;
}

/** Deep copy so an applied template can be edited without touching the source. */
export function templateFiles(template: StarterTemplate): ProjectFile[] {
  return template.files.map((file) => ({ path: file.path, content: file.content }));
}

export function findTemplate(id: string): StarterTemplate | null {
  return STARTER_TEMPLATES.find((item) => item.id === id) || null;
}