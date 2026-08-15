// Build helper: runs Vite's JS API with `configLoader: 'runner'` so the
// config file is executed directly by Node instead of being bundled with
// esbuild. esbuild spawns a child process, which is blocked in this sandbox
// (EPERM), while the production build inside Docker/Linux is unaffected.
import { build } from 'vite';

const started = Date.now();
await build({ configFile: 'vite.config.js', configLoader: 'runner' });
console.log(`BUILD_OK in ${((Date.now() - started) / 1000).toFixed(1)}s`);
