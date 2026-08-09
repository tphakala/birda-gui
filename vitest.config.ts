import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Unit tests cover the framework-free logic only (no Svelte/DOM), so a plain
// node environment is enough. Aliases mirror the app's tsconfig paths.
export default defineConfig({
  resolve: {
    alias: {
      $lib: resolve(__dirname, 'src/renderer/src/lib'),
      $shared: resolve(__dirname, 'shared'),
      $paraglide: resolve(__dirname, 'src/renderer/src/paraglide'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts'],
  },
});
