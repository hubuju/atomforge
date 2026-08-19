/**
 * Playwright config for the closed-loop E2E test (e2e/closed-loop.spec.ts).
 *
 * Starts a local mock LLM (8124) and the FastAPI backend (8123, SQLite at
 * app/backend/data/e2e.db) when they are not already running. The backend
 * serves the built frontend (dist), so the whole product runs exactly like
 * the single-container deployment.
 *
 * NOTE: requires Python 3.12 with app/backend/site-pkgs on PYTHONPATH, plus
 * `npx playwright install chromium` once.
 */
import { defineConfig } from '@playwright/test';
import path from 'node:path';

const backendDir = path.resolve(__dirname, '..', 'backend');
const distDir = path.resolve(__dirname, 'dist');

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8123',
    headless: true,
  },
  webServer: [
    {
      command: 'node e2e/mock-llm-server.mjs',
      url: 'http://127.0.0.1:8124/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'python -m uvicorn main:app --host 127.0.0.1 --port 8123',
      cwd: backendDir,
      env: {
        PYTHONPATH: path.join(backendDir, 'site-pkgs'),
        DATABASE_URL: 'sqlite:///./data/e2e.db',
        APP_AI_BASE_URL: 'http://127.0.0.1:8124/v1',
        APP_AI_KEY: 'sk-e2e-mock',
        ENVIRONMENT: 'prod',
        IS_LAMBDA: 'false',
        FRONTEND_DIST: distDir,
      },
      url: 'http://127.0.0.1:8123/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
