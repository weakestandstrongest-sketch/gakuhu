import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages などのサブパスでも動くよう相対パスで出力する
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/**/*.test.ts'] },
});
