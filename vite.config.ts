import { defineConfig } from 'vite';

export default defineConfig({
  // @jsquash ships its own .wasm files resolved via import.meta.url;
  // pre-bundling would break those paths.
  optimizeDeps: { exclude: ['@jsquash/jxl'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
