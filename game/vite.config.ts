import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    // tone-lab is linked from ../tone-lab (outside this folder); let the dev server read it.
    fs: { allow: ['.', '../tone-lab'] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
