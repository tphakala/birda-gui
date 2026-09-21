import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { isExternal } from './externalize';

const root = resolve(import.meta.dirname, '../..');

// ESM output uses __dirname/__filename/require, which are not defined in ES
// modules. Inject them at the top of the bundle, matching what electron-vite
// produced. Electron 43 bundles Node 22, so import.meta.dirname is available.
const esmShim = [
  `import { createRequire as __birdaCreateRequire } from 'node:module';`,
  `const require = __birdaCreateRequire(import.meta.url);`,
  `const __filename = import.meta.filename;`,
  `const __dirname = import.meta.dirname;`,
].join('\n');

export default defineConfig(({ mode }) => ({
  root,
  resolve: {
    alias: {
      $shared: resolve(root, 'shared'),
    },
  },
  build: {
    outDir: resolve(root, 'out/main'),
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    // Inline sourcemaps in dev (main-process stack traces map to TS source),
    // none in the production build, matching electron-vite.
    sourcemap: mode === 'development' ? 'inline' : false,
    lib: {
      entry: resolve(root, 'src/main/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: isExternal,
      output: {
        banner: esmShim,
      },
    },
  },
}));
