# syntax=docker/dockerfile:1

# ==================== Stage 1: build the frontend ====================
FROM node:20-alpine AS frontend-build
WORKDIR /build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY app/frontend/package.json app/frontend/pnpm-lock.yaml ./
RUN pnpm install --no-frozen-lockfile
COPY app/frontend/ ./
RUN pnpm run build

# ==================== Stage 2: run backend + serve frontend ====================
FROM python:3.12-slim
WORKDIR /app/backend

COPY app/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app/backend/ ./
COPY --from=frontend-build /build/dist /app/frontend/dist

# SQLite database lives on a persistent volume at /data.
# APP_AI_BASE_URL/APP_AI_KEY point the built-in AI relay at any
# OpenAI-compatible provider (default: DeepSeek). The key is injected at
# deploy time, never baked into the image.
ENV PYTHONUNBUFFERED=1 \
    DATABASE_URL=sqlite:////data/atomforge.db \
    FRONTEND_DIST=/app/frontend/dist \
    APP_AI_BASE_URL=https://api.deepseek.com/v1 \
    IS_LAMBDA=false \
    ENVIRONMENT=prod

VOLUME /data
EXPOSE 8000

CMD ["sh", "-c", "mkdir -p /data && exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
