import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { isExternal } from './externalize.ts';

const root = resolve(import.meta.dirname, '../..');

// ESM output uses __dirname/__filename/require, which are not defined in ES
// modules. Inject them at the top of the bundle; unreferenced shim
// declarations are dropped from the output.
// Rolldown does not rename source bindings that collide with these names, so
// a main-process module declaring its own __filename, __dirname or require
// would produce a duplicate declaration. `npm run build` runs `node --check`
// on the output so that fails the build instead of the app launch (the dev
// watcher in scripts/dev.ts does not run the check).
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
    // none in the production build.
    sourcemap: mode === 'development' ? 'inline' : false,
    lib: {
      entry: resolve(root, 'src/main/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rolldownOptions: {
      external: isExternal,
      output: {
        banner: esmShim,
      },
    },
  },
}));
