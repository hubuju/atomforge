# 核心逻辑单元测试

运行：

```bash
pnpm run test        # 跑一遍
pnpm run test:watch  # 改代码自动重跑
```

技术栈：Vitest + jsdom，配置在根目录 `vitest.config.ts`（与应用的 `vite.config.ts` 分开，
避免测试进程去加载源码定位器、预渲染、站点地图这些只在构建时才需要的插件）。

## 覆盖范围

测试只针对**核心逻辑层**（`src/lib/`）里的纯函数与状态模块，不做像素级 UI 断言，
因为界面外观由渲染检查负责，而下面这些逻辑一旦出错会直接导致「白屏」「预览点不动」
「设置读不回来」这类用户可感知的故障。

| 测试文件 | 被测模块 | 关心的故障 |
|---|---|---|
| `agent.test.ts` | `lib/agent.ts` | 生成协议解析：流式未闭合、模型无视协议只吐裸 HTML、同名文件覆盖、增量合并、预览探针注入、postMessage 校验 |
| `bundler.test.ts` | `lib/bundler.ts`、`lib/exporter.ts` | 预览打包：本地样式/脚本是否真被内联、CDN 是否被误伤、引用缺失时不吞标签、导出文件名清洗 |
| `audit.test.ts` | `lib/audit.ts` | 自检双向准确性：每条规则既要能抓到真缺陷，也不能在健康代码上误报（含字符串/注释里的括号不误判） |
| `roles.test.ts` | `lib/roles.ts` | 四角色之间的结构化交接：规格 JSON 归一化、路径去重、审查问题排序与降级、修复者上下文裁剪 |
| `settings.test.ts` | `lib/settings.ts` | 配置持久化与修复读取：越界夹取、垃圾值回落、角色模型覆盖不破坏传输与密钥 |
| `theme.test.ts` | `lib/theme.ts` | 深浅主题：首屏上色、偏好落盘、非法值回落、`system` 跟随 OS 实时切换、显式选定后不再被系统影响 |

## 约定

- 测试文件放在本目录，命名 `*.test.ts`。
- 通过 `@/` 别名引用源码，和应用代码保持一致。
- `agent.ts` 在模块顶层创建了 web SDK 客户端，测试里用 `vi.mock` 把传输层替掉，
  只验证纯函数部分；网络请求不在单测范围内。
- `theme.ts` 在导入时就会涂色并注册 `matchMedia` 监听，所以每个用例先装自己的
  `matchMedia` 桩、再用 `vi.resetModules()` 重新导入，保证用例之间互不污染。

## 这轮测试发现并修掉的问题

`loadSettings()` 里用 `Number(parsed.versionKeep)`，而 `Number(null)` 等于 `0`，
会被区间夹取成最小值 5，看起来像是用户主动选了 5。已改为先判空再转数字
（`numeric()`），缺失或非数字时回落到默认值。