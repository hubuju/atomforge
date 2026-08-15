# Architecture Design

## System Overview

AtomForge 是一个「对话驱动生成可运行网页应用」的 AI 工作台（Atoms Demo）。用户注册登录后创建项目，在三栏工作台中用自然语言描述需求，由**四角色流水线（Planner → Coder → Reviewer → Fixer）**协作产出一个**多文件前端项目**（index.html / styles.css / app.js，上限 6 个文件），预览时才由 `lib/bundler.ts` 内联成单文档交给 iframe 沙箱运行。每一轮生成自动落库为版本快照，支持多轮增量迭代、历史回滚、双层自检（静态审计 + 运行探针）与 AI 修复闭环，以及一键发布只读公开链接（免登录访问）。

> 注意：本文件下方部分早期段落（单文件 HTML 产物、projects / chat_messages / code_versions 表、Dashboard 页面）描述的是初版方案，现已被上述多文件 + 四角色方案取代，实际表为 `accounts` / `workspaces` / `workspace_messages` / `workspace_versions` / `user_templates`，接口为 `/api/v1/hub/*` 与免鉴权 `/api/v1/share/{slug}`。交付口径以仓库根目录 `README.md` 为准。

数据流：
```
用户输入 → client.ai.gentxt(stream, claude-opus-5) → 流式解析(计划文本 / 代码块)
   → 实时写入代码面板 & iframe srcDoc → 完成后写入 projects.code
   → 追加 chat_messages(user/assistant) + code_versions 快照
发布：projects.is_published=true + share_slug → GET /api/v1/share/{slug}（免鉴权）→ /s/:slug 只读预览
修错：iframe 内注入 error hook → postMessage 上抛 → 一键把报错回喂 AI → 重新生成 → 新版本
```

## Tech Stack

- 前端：React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui + react-router-dom
- AI：Atoms Cloud aihub，`client.ai.gentxt`（claude-opus-5，流式）
- 后端：Atoms Cloud（Auth + PostgreSQL Entity CRUD）+ FastAPI 自定义只读分享路由
- 持久化：`projects` / `chat_messages` / `code_versions` 三张表
- 沙箱：`<iframe sandbox srcDoc>`，生成产物为单文件 HTML（Tailwind CDN）

## Module Design

| Module | Responsibility | Key Files |
|--------|---------------|-----------|
| 设计令牌 | 深色开发者工作台配色、字体、动效曲线 | `frontend/src/index.css` |
| 路由 | `/` `/dashboard` `/w/:id` `/s/:slug` `/auth/callback` | `frontend/src/App.tsx` |
| SDK 封装 | client 单例、认证 hook、实体类型、slug 工具 | `frontend/src/lib/client.ts` |
| 生成 Agent | system prompt、消息组装、流式解析、预览注入、错误回喂 | `frontend/src/lib/agent.ts` |
| 通用外壳 | 顶栏、Logo、登录态占位、空/错误态 | `frontend/src/components/AppShell.tsx` |
| 落地页 | 产品定位、能力说明、实现文档、CTA | `frontend/src/pages/Index.tsx` |
| 项目台 | 项目列表 / 新建（带首轮需求）/ 重命名 / 删除 | `frontend/src/pages/Dashboard.tsx` |
| 工作台 | 三栏：对话流 / 文件树+代码编辑 / 实时预览 + 版本 + 发布 + 修错 | `frontend/src/pages/Workspace.tsx` |
| 公开分享 | 免登录只读运行页 | `frontend/src/pages/Share.tsx` |
| 分享接口 | 免鉴权按 slug 读取已发布项目 | `backend/routers/share.py` |

## Tech Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| 生成产物形态 | 单文件 HTML（内联 style/script + Tailwind CDN） | 浏览器内 iframe 直接可跑，规避容器沙箱/构建链的巨大复杂度，6-8h 内可交付 |
| 沙箱方案 | `iframe srcDoc` + `sandbox="allow-scripts allow-forms allow-modals"` | 零依赖、即时刷新、与父页隔离；不加 `allow-same-origin` 防止逃逸 |
| 流式 vs 非流式 | 前端 `client.ai.gentxt(stream: true)` | 「过程可见」是 Atoms 的体验精髓，边生成边渲染代码面板 |
| 增量修改 | 把当前完整代码作为上下文，要求整份重写 | 单文件规模可控，比 diff 补丁鲁棒得多，避免补丁定位失败 |
| 版本快照 | 每轮生成成功后写一条 `code_versions` | 回滚成本极低，实现简单 |
| 公开分享 | 后端免鉴权路由而非前端 queryAll | 未登录访客拿不到 token，必须走服务端读取 |
| 错误修复闭环 | iframe 内注入 `window.onerror` + `postMessage` | 无需解析代码即可捕获真实运行时错误，回喂 AI 形成闭环 |
| 模型 | claude-opus-5 | 代码能力最强，单文件应用一次成型率高 |

## File Tree Plan

```
app/
├── backend/
│   └── routers/share.py            # GET /api/v1/share/{slug} 免鉴权只读
└── frontend/src/
    ├── index.css                   # 设计令牌（酸性青柠 + 暖灰深色）
    ├── App.tsx                     # 路由
    ├── lib/
    │   ├── client.ts               # SDK 单例 / useAuth / 类型 / slug
    │   └── agent.ts                # prompt / 流式解析 / 预览注入
    ├── components/AppShell.tsx     # 顶栏与通用态
    └── pages/
        ├── Index.tsx               # 落地页 + 说明文档
        ├── Dashboard.tsx           # 项目列表
        ├── Workspace.tsx           # 三栏工作台（核心）
        └── Share.tsx               # 公开只读运行页
```

## Implementation Guide

1. 认证：`client.auth.me()` 三态（loading/authenticated/anonymous），登录用 `client.auth.toLogin()`，`/auth/callback` 路由复用只读模板页，禁止未登录时自动跳转 callback。
2. 实体写入统一 `client.entities.X.create({ data: {...} })`，读取用 `response.data.items`。
3. 生成流程：`chat_messages`(user) → 流式生成 → `projects.update({code})` → `chat_messages`(assistant) → `code_versions.create` → `projects.update({version_count})`。
4. 预览：`wrapForPreview(code)` 注入错误钩子后赋给 `iframe.srcDoc`；手动编辑代码后点「运行」刷新预览并保存。
5. 发布：生成 8 位 slug，`is_published=true`，公开地址 `/s/:slug`。
6. 修错：捕获到运行时错误显示红色横幅，点「让 AI 修复」把错误文本作为新一轮需求提交。