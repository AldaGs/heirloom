import { defineConfig } from 'vite';

// libraw-wasm spawns its worker via new URL(..., import.meta.url); pre-bundling breaks that path.
export default defineConfig({
  optimizeDeps: { exclude: ['libraw-wasm'] },
  worker: { format: 'es' },
});
