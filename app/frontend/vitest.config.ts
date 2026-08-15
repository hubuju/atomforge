import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Test-only Vite config.
 *
 * Kept separate from `vite.config.js` on purpose: the app config pulls in the
 * React plugin and manual chunks that should not run inside a unit test
 * process. Tests only need the `@` alias and a DOM.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
    reporters: 'default',
  },
});