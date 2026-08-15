# Requirements & Progress

## Requirements Overview

交付一个可运行、可体验、可扩展的 Atoms Demo：真实交互 + 数据持久化 + 完整主流程（注册登录 / 项目管理 / 对话生成 / 实时预览）+ 至少一项延展能力（AI 自动修错闭环、一键公开分享）+ 落地页与说明文档。

## User Stories

- 作为访客，我能在落地页看懂产品定位与能力，并直接点击登录进入。
- 作为登录用户，我能新建 / 重命名 / 删除项目，刷新后数据仍在。
- 作为用户，我能在工作台用一句话描述需求，看到 AI 流式生成过程，并在右侧立刻运行生成的应用。
- 作为用户，我能继续追加需求做增量修改，也能切换文件、手动改代码并即时刷新预览。
- 作为用户，我能查看历史版本并一键回滚到任意一版。
- 作为用户，当预览报错时，我能一键让 AI 自动修复并重新运行。
- 作为用户，我能一键发布，拿到免登录即可访问运行的公开链接。

## Task Breakdown

- [x] 创建 projects / chat_messages / code_versions 三张表
- [x] 编写项目上下文文档（架构、决策、进度）
- [x] 后端免鉴权分享路由 /api/v1/share/{slug}
- [x] 设计令牌与字体（index.css）
- [x] SDK 封装与生成 Agent（client.ts / agent.ts）
- [x] 首页即工作区：项目列表 + 新建/重命名/删除（Index.tsx）
- [x] 入口页：简易注册（名称 + 两次密码）/ 登录（Auth.tsx）
- [x] 自建轻量账号后端 /api/v1/hub（PBKDF2 + session token）
- [x] 生成产物改为多文件项目 + 预览打包器（bundler.ts）
- [x] 美观代码展示：行号 + 语法高亮 + 三视图 + 响应式切换（CodeViewer.tsx）
- [x] 三栏工作台：对话 / 代码 / 预览 / 版本 / 发布 / 修错（Workspace.tsx）
- [x] 公开只读运行页（Share.tsx）+ 路由挂载
- [x] 生成品牌与展示用图片素材
- [x] lint / build 校验与 UI 检查
- [x] 真实模型设置面板（内置模型 / OpenAI 兼容端点 / 创造性 / 拆分文件数 / 自动体检）
- [x] 生成阶段可见流水线（读需求 → 写文件 → 自检 → 运行）
- [x] 预览自验证：静态审计 + 沙箱运行探针 + 合并报告 + 一键让 AI 修
- [x] 源码导出：zip 多文件 / standalone.html / 当前单文件
- [x] 版本备注与自检结果落库、版本列表展示与备注编辑
- [x] 多 agent 设置：按角色模型覆盖 + 规格确认开关（可配置）
- [x] 四角色提示词与规格 / 审查结果解析（lib/roles.ts）
- [x] 编排器：Planner → Coder(逐文件) → Reviewer → Fixer + 修复轮次上限（lib/orchestrator.ts）
- [x] 角色泳道可视化（components/RoleLanes.tsx）
- [x] 规格确认与编辑面板（components/SpecPanel.tsx）
- [x] 工作台接入编排器与「规划 → 确认 → 实现」两阶段流程
- [x] T1 内置模板库（6 个可直接运行的起步项目，lib/templates.ts）
- [x] T2 项目列表搜索 / 状态筛选 / 排序（Index.tsx）
- [x] T3 版本保留上限：设置面板滑块 + 前端传参 + 后端自动清理
- [x] T5 个人模板全链路：工作台存为模板、新建弹窗选择与删除、打开即刷新
- [x] 模板推荐：需求命中内置模板时高亮并可一键采用
- [x] 模板进入工作台不误触发生成，需求预填进输入框待确认
- [x] T6 深浅双主题：主题状态层与持久化（lib/theme.ts，light / dark / system）
- [x] T6 顶栏与登录页外观切换入口（components/ThemeToggle.tsx + AppShell / Auth）
- [x] T6 设置面板「外观」页签，与顶栏共享同一份偏好
- [x] T6 浅色 / 深色令牌化（index.css：code / tone / ink 变量）
- [x] T6 替换写死深色高亮为语义令牌（CodeViewer / AuditPanel / RoleLanes / Pipeline / SpecPanel / Workspace）
- [x] T6 修复入口页白屏：Auth 漏导入 ThemeToggle；sonner 改读项目主题而非 next-themes
- [x] T7 引入 Vitest + jsdom 测试运行器与独立 vitest.config.ts
- [x] T7 核心逻辑单元测试 test/ 目录（116 个用例，6 个测试文件）
- [x] T7 测试发现并修复 loadSettings() 把 null 当成 0 的取值缺陷
- [x] lint / build / test 全部通过
- [x] T8 仓库根目录交付说明文档 README.md（实现思路与取舍 / 完成程度 / 后续扩展优先级）

## Progress Log

- 2026-08-15 迁移到自托管部署（脱离 Atoms Cloud）：前端 `client.apiCall.invoke` 全部换成自有 `lib/http.ts`（同源 fetch），`client.ai.gentxt` 换成后端 `/api/v1/aihub/gentxt` 流式中转（服务端持 Key，浏览器不落密钥），内置模型列表改为 DeepSeek（deepseek-chat / deepseek-reasoner，compat 自定义端点模式保留）；数据库 DATABASE_URL 切 SQLite 单文件（后端 database.py 原生支持，无需改模型）；`main.py` 增加前端静态托管 + SPA fallback（挂载在全部 API 路由之后）。新增 Dockerfile / docker-compose.yml / .env.example / DEPLOY.md / GitHub Actions CI；vite 配置转为纯 JS 并移除 Atoms 生态插件（atoms/source-locator/sitemap/prerender），压缩改用 terser。本地验证：eslint / tsc 全绿，后端 SQLite 启动 + 注册登录 + workspace CRUD + DeepSeek 流式生成（<<<FILE>>> 协议闭合）+ 发布分享读取全链路通过。

- 2026-08-15 补齐交付说明文档 `/workspace/README.md`：按笔试要求的三块结构组织（实现思路与关键取舍 / 当前完成程度 / 继续投入的扩展与优先级），另加体验路径、功能清单、架构选型、本地运行与目录结构。取舍章节写的是开发过程中真实发生的 8 次方案调整（单文件→多文件、单提示词→四角色、规格闸门做成开关、自检双层互补、角色只覆盖 model id、分享走免鉴权路由、自研 tokenizer、带备注版本免清理），并如实披露未完成项（生成中断恢复、产物无自有后端、无协作、无端到端测试）及其原因。文中技术细节均按当前代码核对：表名为 workspaces / workspace_messages / workspace_versions / user_templates / accounts，路由为 /api/v1/hub/* 与免鉴权 /api/v1/share/{slug}，默认模型 claude-opus-5，版本上限默认 20、修复轮次默认 1。在线链接与仓库地址留占位符待用户发布后填写。
- 2026-08-15 补齐核心逻辑单元测试：新增 `test/` 目录（Vitest + jsdom，配置独立于应用的 `vite.config.ts`，避免测试进程加载源码定位器与预渲染插件），共 6 个测试文件 116 个用例，`pnpm run test` / `pnpm run test:watch` 一键运行。覆盖生成协议解析（流式未闭合、裸 HTML 回落、同名覆盖、增量合并、探针注入、postMessage 校验）、预览打包（本地资源内联 vs CDN 不误伤、缺失引用不吞标签）、自检双向准确性（每条规则既抓真缺陷也不误报，字符串/注释里的括号不误判）、四角色结构化交接（规格归一化去重、问题排序降级、修复者上下文裁剪）、设置持久化修复读取、主题三态与跟随系统实时切换。`test/README.md` 记录范围与约定。
- 2026-08-15 测试跑出一个真实缺陷并修复：`loadSettings()` 用 `Number(parsed.versionKeep)`，而 `Number(null)` 为 0 会被区间夹成最小值 5，看起来像用户主动选了 5；改为先判空的 `numeric()` 再夹取，缺失或非数字时回落默认值（`temperature` / `maxFiles` / `maxRepairRounds` 同步修正）。
- 2026-08-15 深浅双主题落地：新增 `lib/theme.ts`（light / dark / system 三态，偏好存 localStorage，模块导入即上色避免闪白，`system` 由 matchMedia 实时跟随）与 `components/ThemeToggle.tsx`（顶栏 + 登录页右上角下拉切换），设置面板新增「外观」页签共享同一份偏好；`index.css` 补齐浅色令牌并把代码高亮、状态色、文件类型色抽成 `--code-* / --tone-* / --ink-*` 变量，CodeViewer / AuditPanel / RoleLanes / Pipeline / SpecPanel / Workspace 的写死深色改为语义类。
- 2026-08-15 修复入口页白屏：`Auth.tsx` 使用了 ThemeToggle 但漏了 import 导致运行时崩溃；`ui/sonner.tsx` 原先从未挂载的 next-themes 取主题，改为读项目自己的主题模块，toast 现在跟随深浅切换。lint / build 通过，界面渲染检查通过。
- 2026-08-14 模板库与项目列表接入完成：新增 `components/TemplatePicker.tsx`（内置模板 6 个 + 个人模板，含删除与推荐高亮），Index 加入搜索 / 状态筛选 / 排序，新建弹窗打开即刷新个人模板；工作台新增「存为我的模板」入口与弹窗，快照保存不随后续修改而变。
- 2026-08-14 模板起步流程闭环：选模板创建时写入初始版本快照并计数，进入工作台不误触发生成，用户填的「想改什么」预填进输入框待确认后再发送。
- 2026-08-14 版本保留上限打通全链路：设置面板新增滑块（5-50，默认 20），工作台与模板初始化均传 `keep_limit`，后端 `prune_versions()` 自动清理最旧版本且保留带备注的版本。
- 2026-08-14 生成流程重构为**四角色多智能体流水线**：新增 `lib/roles.ts`（规划者 / 实现者 / 审查者 / 修复者的提示词与结构化输出解析）与 `lib/orchestrator.ts`（黑板共享状态 + 编排器 + 泳道状态机）。实现者按文件逐个调用，审查者输出带严重度与文件定位的问题清单，修复者只重写被点名的文件，修复轮次有硬上限。
- 2026-08-14 新增 `components/RoleLanes.tsx` 角色泳道：每个角色一条泳道，显示所用模型、当前动作、耗时与产出字符数，可展开查看它收到什么、交出什么。
- 2026-08-14 新增 `components/SpecPanel.tsx` 规格确认闸门：规划者出规格后停下等确认，可直接编辑界面/数据/交互/文件划分再开工（开关可关，关闭则自动继续）。
- 2026-08-14 设置面板新增「多智能体」页签：流水线开关、规格确认开关、审查→修复轮次上限、按角色指定模型（留空继承全局，仅覆盖 model id，传输与 Key 共用）。
- 2026-08-14 新增「真实模型设置」体系（`lib/settings.ts` + `components/SettingsDialog.tsx`）：内置模型与 OpenAI 兼容端点双模式、创造性/最大文件数/自动体检与自动修复开关，首页与工作台共用同一份配置。
- 2026-08-14 新增生成流水线可视化（`components/Pipeline.tsx`）与预览自验证（`lib/audit.ts`）：静态规则审计 + iframe 运行探针结果合并成体检报告，阻塞项可一键转成修复提示词交给 AI。
- 2026-08-14 新增源码导出（`lib/exporter.ts`）：多文件 zip、内联 standalone.html、当前单文件；版本快照增加 note / audit_json 字段，版本列表支持备注编辑。

- 2026-08-14 生成产物由「单文件内联 HTML」改为**真正的多文件项目**（index.html + styles.css + app.js，最多 6 个文件）：模型按 `<<<FILE path="...">>>` 协议逐个文件输出，新增 `lib/bundler.ts` 只在预览时把本地 link/script 内联成单文档运行，源码保持分离，便于阅读与修改。
- 2026-08-14 代码展示改造：新增 `components/CodeViewer.tsx`，深色底 + 行号槽 + 逐语言词法着色（HTML/CSS/JS 各一套 tokenizer）+ 流式光标 + 行 hover；顶部新增「预览 / 代码 / 分屏」三视图与桌面/平板/手机响应式切换，以及「运行正常 / 运行报错 / 生成中」状态胶囊。
- 2026-08-14 简化账号体系：自建 `accounts` 表 + `/api/v1/hub` 路由（PBKDF2 加盐哈希 + 不透明 session token），注册仅需「名称 + 两次密码」，移除邮箱与游客模式；删除 `store.ts` / `guestStore.ts`。
- 2026-08-14 清空历史用户数据：改用全新 `workspaces` / `workspace_messages` / `workspace_versions` 表存多文件项目，旧数据不再被读取；分享路由改为按 slug 返回文件集合。

- 2026-08-14 计划确认，初始化 Atoms Cloud 全栈模板，完成数据库建表。
- 2026-08-14 写入 ARCHITECTURE / ATOMS / PROGRESS 上下文文档，确定单文件 HTML 产物与 iframe 沙箱方案。
- 2026-08-14 生成 4 张品牌/展示图片；完成后端分享路由、设计令牌、Agent 逻辑层与全部四个页面。
- 2026-08-14 补齐缺失的 NotFound 页面，lint 与 build 全部通过，界面渲染检查通过，交付完成。
- 2026-08-14 按用户反馈改版：首页直接为 AtomForge 工作区（移除落地页与 Dashboard 中转），新增 /auth 三入口（注册 / 登录 / 游客）。
- 2026-08-14 新增游客模式本地存储与统一数据层（guestStore / store），登录后可一键把游客项目同步到账号；游客不可发布公开链接。
- 2026-08-14 修复当前轮用户消息重复渲染：本地回显气泡在入库成功后关闭（StreamingTurn.echo）。
- 2026-08-14 新增模型可选（4 个模型，本地记忆选择，工作台与新建弹窗均可切换）+ 新手引导（使用流程弹窗、需求写法正反例、示例一键填入）。
- 2026-08-14 修复「预览渲染出来但点不动」：runGeneration 支持截断自动续写（最多 4 段、去重拼接、UI 显示续写进度），预览沙箱注入 storage 兜底避免 SecurityError 中断脚本，parseStream 容忍无围栏裸 HTML，system prompt 增加体量控制。