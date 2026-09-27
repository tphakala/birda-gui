import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { isExternal } from './externalize.ts';

const root = resolve(import.meta.dirname, '../..');

export default defineConfig(({ mode }) => ({
  root,
  build: {
    outDir: resolve(root, 'out/preload'),
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    // Inline sourcemaps in dev, none in the production build (electron-vite parity).
    sourcemap: mode === 'development' ? 'inline' : false,
    lib: {
      entry: resolve(root, 'src/preload/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    rolldownOptions: {
      external: isExternal,
      // Rolldown defaults to 'auto' (no directive for ES module input);
      // keep the "use strict" prologue the Rollup build emitted.
      output: {
        strict: true,
      },
    },
  },
}));
