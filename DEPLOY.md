# AtomForge 部署指南（已脱离 Atoms Cloud）

本项目已改造为**完全自托管**：不依赖 Atoms 平台。一个容器装下前端、后端与数据库（SQLite），AI 生成走任意 OpenAI 兼容 API（默认 DeepSeek）。

```
浏览器 ──> [一个容器：FastAPI]
              ├── /              前端页面（构建产物 dist）
              ├── /api/v1/hub/*  账号 / 项目 / 版本 / 模板
              ├── /api/v1/share/{slug}  免登录公开分享
              ├── /api/v1/aihub/gentxt  AI 流式中转（服务端持 Key）
              └── /data/atomforge.db    SQLite 持久化（挂载持久卷）
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `APP_AI_KEY` | ✅ | DeepSeek（或任意 OpenAI 兼容服务）的 API Key |
| `APP_AI_BASE_URL` | 否 | 默认 `https://api.deepseek.com/v1`，可换 GLM / Qwen / vLLM 等 |
| `DATABASE_URL` | 否 | 默认 `sqlite:////data/atomforge.db` |
| `PORT` | 否 | 监听端口（PaaS 自动注入） |

> Key 只放在部署平台的环境变量里，**不要提交进 Git 仓库**。

---

## 方案 A：Zeabur 一键部署（推荐，免费额度，国内可访问）

1. 把代码推到 GitHub 仓库（注意 `.env` 不要提交，仓库里只有 `.env.example`）；
2. 打开 [Zeabur](https://zeabur.com) → 新建 Project → 从 GitHub 导入该仓库，Zeabur 会**自动识别根目录 Dockerfile** 并构建；
3. 在 Service 的环境变量里添加 `APP_AI_KEY` = 你的 DeepSeek Key；
4. 在 Project 设置里给 Service 添加一个 **Volume**，挂载路径 `/data`（不挂的话数据库在容器重建后丢失）；
5. 部署完成后 Zeabur 会分配一个公网域名（可在 Networking 里绑定自己的域名），把该地址填进 README 的「在线体验」即可。

## 方案 B：任意带 Docker 的服务器

```bash
git clone <你的仓库地址>
cd <仓库目录>
cp .env.example .env   # 编辑 .env，填入 APP_AI_KEY
docker compose up -d --build
```

访问 `http://<服务器IP>:8000` 即可。数据保存在 Docker 卷 `atomforge-data` 中。

## 方案 C：本地开发

```bash
# 前端
cd app/frontend
pnpm install
pnpm run dev        # 默认 3000 端口，已代理 /api 到 8000

# 后端（另开终端）
cd app/backend
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# Windows PowerShell:
#   $env:DATABASE_URL="sqlite:///./data/atomforge.db"
#   $env:APP_AI_BASE_URL="https://api.deepseek.com/v1"
#   $env:APP_AI_KEY="sk-..."
# Linux/macOS:  export DATABASE_URL=... 依次 export
uvicorn main:app --host 0.0.0.0 --port 8000
```

## 数据备份 / 迁移

全部数据在单个 SQLite 文件（容器内 `/data/atomforge.db`）里：

- **Zeabur**：备份时挂载卷导出该文件即可；
- **服务器**：`docker cp <容器>:/data/atomforge.db ./backup.db`；
- 要换平台时，把这个文件放进新容器的 `/data/` 目录即可完整迁移。
