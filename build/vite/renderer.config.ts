import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

const root = resolve(import.meta.dirname, '../..');

export default defineConfig(({ command }) => ({
  root: resolve(root, 'src/renderer'),
  // Relative base so built assets resolve under file:// (loadFile). The dev
  // server serves from '/'.
  base: command === 'build' ? './' : '/',
  build: {
    outDir: resolve(root, 'out/renderer'),
    emptyOutDir: true,
    target: 'esnext',
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      input: resolve(root, 'src/renderer/index.html'),
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
        },
      },
    },
  },
  plugins: [
    svelte({ configFile: resolve(root, 'svelte.config.mjs') }),
    tailwindcss(),
    paraglideVitePlugin({
      project: resolve(root, 'project.inlang'),
      outdir: resolve(root, 'src/renderer/src/paraglide'),
    }),
  ],
  resolve: {
    alias: {
      $lib: resolve(root, 'src/renderer/src/lib'),
      $shared: resolve(root, 'shared'),
      $paraglide: resolve(root, 'src/renderer/src/paraglide'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
}));
