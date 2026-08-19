/**
 * Closed-loop E2E: 生成 → 落库 → Preview 运行 → 同项目连续修改 → 刷新重登恢复。
 *
 * 依赖（见 playwright.config.ts 的 webServer 配置）：
 *   1. 本地模拟 LLM（e2e/mock-llm-server.mjs，端口 8124）——按角色返回确定性
 *      的规格 / 文件内容，不消耗真实 API 配额；
 *   2. 后端 uvicorn（127.0.0.1:8123，DATABASE_URL 指向 SQLite 单文件，
 *      APP_AI_BASE_URL 指向模拟 LLM，FRONTEND_DIST 指向已构建的 dist）。
 *
 * 运行：pnpm run test:e2e
 */
import { expect, test } from '@playwright/test';

const NAME = `e2e-${Date.now().toString(36)}`;
const PASSWORD = 'test123456';
const BRIEF_1 = '做一个极简计数器';
const BRIEF_2 = '把标题改成 极简计数器 Pro';

test.describe.configure({ mode: 'serial' });

test('注册 → 生成落库 → 预览运行 → 连续修改 → 刷新重登恢复', async ({ page }) => {
  // ---------- 1. 注册 ----------
  await page.goto('/auth');
  await page.locator('#reg-name').fill(NAME);
  await page.locator('#reg-pass').fill(PASSWORD);
  await page.locator('#reg-pass2').fill(PASSWORD);
  await page.getByRole('button', { name: '注册并进入' }).click();
  await expect(page.getByRole('heading', { name: '工作区' })).toBeVisible({ timeout: 30_000 });
  console.log('[1/7] 注册成功，进入工作区', NAME);

  // ---------- 2. 新建项目并自动发起第一轮生成 ----------
  await page.getByRole('button', { name: '新建项目' }).click();
  await page.locator('#project-name').fill('计数器项目');
  await page.locator('#project-brief').fill(BRIEF_1);
  await page.getByRole('button', { name: '创建并进入' }).click();
  await expect(page).toHaveURL(/\/w\/\d+/, { timeout: 30_000 });

  // 生成完成：TopBar 出现 v1 徽标（commitRound 已把文件/消息/版本写入后端）
  await expect(page.getByText('v1')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('button').filter({ hasText: 'index.html' }).first()).toBeVisible();
  await expect(page.locator('button').filter({ hasText: 'styles.css' }).first()).toBeVisible();
  await expect(page.locator('button').filter({ hasText: 'app.js' }).first()).toBeVisible();
  console.log('[2/7] 第一轮生成完成：文件树出现 index.html / styles.css / app.js，v1 落库');

  // ---------- 3. Preview 真实运行 ----------
  const preview = page.frameLocator('iframe[title="应用预览"]');
  await expect(preview.locator('#btn')).toBeVisible({ timeout: 30_000 });
  await preview.locator('#btn').click();
  await preview.locator('#btn').click();
  await expect(preview.locator('#count')).toHaveText('2');
  await page.screenshot({ path: '../../analysis/evidence-e2e/01-preview-v1-running.png' });
  console.log('[3/7] 沙箱预览运行：连续点击两次，计数从 0 → 2');

  // ---------- 4. 同项目连续修改（第二轮增量生成） ----------
  const composer = page.getByPlaceholder(/继续提修改|描述你想要的应用/);
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  await composer.fill(BRIEF_2);
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('v2')).toBeVisible({ timeout: 90_000 });
  await expect(preview.locator('#title')).toContainText('极简计数器 Pro', { timeout: 30_000 });
  await page.screenshot({ path: '../../analysis/evidence-e2e/02-preview-v2-updated.png' });
  console.log('[4/7] 第二轮修改完成：v2 落库，预览标题已更新为「极简计数器 Pro」');

  // 版本历史对话框里能看到两轮快照
  await page.getByRole('button', { name: /版本/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('v1')).toBeVisible();
  await expect(dialog.getByText('v2')).toBeVisible();
  await page.keyboard.press('Escape');
  console.log('[5/7] 版本历史包含 v1 / v2 两个快照');

  // ---------- 5. 刷新恢复 ----------
  await page.reload();
  await expect(page.getByText('v2')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('button').filter({ hasText: 'app.js' }).first()).toBeVisible();
  await expect(page.getByText(BRIEF_2).first()).toBeVisible();
  await page.screenshot({ path: '../../analysis/evidence-e2e/03-after-reload.png' });
  console.log('[6/7] 刷新后恢复：v2 徽标、文件树、两轮对话全部从后端读回');

  // ---------- 6. 退出重登恢复 ----------
  await page.getByRole('button', { name: '账户菜单' }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/auth/, { timeout: 15_000 });
  await page.getByRole('tab', { name: '登录' }).click();
  await page.locator('#login-name').fill(NAME);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '工作区' })).toBeVisible({ timeout: 30_000 });

  await page.getByText('计数器项目', { exact: true }).click();
  await expect(page).toHaveURL(/\/w\/\d+/, { timeout: 30_000 });
  await expect(page.getByText('v2')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('button').filter({ hasText: 'index.html' }).first()).toBeVisible();
  await expect(preview.locator('#btn')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: '../../analysis/evidence-e2e/04-after-relogin.png' });
  console.log('[7/7] 退出重登：项目列表可见，进入后 v2、文件树、预览全部恢复');
});
