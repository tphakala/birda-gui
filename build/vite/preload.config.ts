import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { isExternal } from './externalize';

const root = resolve(import.meta.dirname, '../..');

export default defineConfig({
  root,
  build: {
    outDir: resolve(root, 'out/preload'),
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    sourcemap: false,
    lib: {
      entry: resolve(root, 'src/preload/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    rollupOptions: {
      external: isExternal,
    },
  },
});
