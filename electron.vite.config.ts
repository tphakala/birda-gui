import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        $shared: resolve(__dirname, 'shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      chunkSizeWarningLimit: 1100,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
        output: {
          manualChunks: {
            maplibre: ['maplibre-gl'],
          },
        },
      },
    },
    plugins: [
      svelte({ configFile: resolve(__dirname, 'svelte.config.mjs') }),
      tailwindcss(),
      paraglideVitePlugin({
        project: resolve(__dirname, 'project.inlang'),
        outdir: resolve(__dirname, 'src/renderer/src/paraglide'),
      }),
    ],
    resolve: {
      alias: {
        $lib: resolve(__dirname, 'src/renderer/src/lib'),
        $shared: resolve(__dirname, 'shared'),
        $paraglide: resolve(__dirname, 'src/renderer/src/paraglide'),
      },
    },
  },
});
