import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build, type Rollup, type ViteDevServer } from 'vite';
import electron from 'electron';

// `import electron from 'electron'` in a Node context resolves to the path of
// the Electron binary; its type is the Electron API, hence the cast.
const electronPath = electron as unknown as string;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configFor = (name: string): string => resolve(root, `build/vite/${name}.config.ts`);

let server: ViteDevServer | null = null;
let electronProc: ChildProcess | null = null;
let quitting = false;

/** Kill the current Electron process, if any, and resolve once it has exited. */
function killCurrent(): Promise<void> {
  const dying = electronProc;
  electronProc = null;
  if (!dying) return Promise.resolve();
  return new Promise<void>((res) => {
    dying.removeAllListeners('exit');
    dying.once('exit', () => {
      res();
    });
    dying.kill();
  });
}

/**
 * Wait for the previous Electron process to fully exit before spawning a new
 * one. The old main process closes the SQLite database on exit; overlapping a
 * new process onto it can race the native better-sqlite3 handle.
 */
async function startElectron(url: string): Promise<void> {
  await killCurrent();
  if (quitting) return;
  const proc = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RENDERER_URL: url },
  });
  electronProc = proc;
  proc.on('exit', () => {
    // Only the user closing the current window should tear the dev loop down;
    // our own kill during a restart clears listeners in killCurrent first.
    if (!quitting && electronProc === proc) void shutdown(0);
  });
}

async function shutdown(code: number): Promise<void> {
  if (quitting) return;
  quitting = true;
  await killCurrent();
  if (server) await server.close();
  process.exit(code);
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: NodeJS.Timeout | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

async function main(): Promise<void> {
  // 1. Renderer dev server. HMR is handled by Vite.
  server = await createServer({ configFile: configFor('renderer') });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('Vite dev server did not report a local URL');

  const state = { mainOk: false, preloadOk: false, started: false };
  // Coalesce the two watchers' END events (and rapid rebuilds) into one relaunch.
  const relaunch = debounce(() => {
    void startElectron(url);
  }, 150);

  // 2. Watch-build main and preload. build() in watch mode resolves with a
  //    RollupWatcher. Sequence is START -> BUNDLE_START -> BUNDLE_END -> END on
  //    success, and START -> BUNDLE_START -> ERROR -> END on failure, so END
  //    alone is not proof of success: track an error flag per run.
  const attach = (watcher: Rollup.RollupWatcher, mark: (ok: boolean) => void, label: string): void => {
    let errored = false;
    watcher.on('event', (event) => {
      if (event.code === 'BUNDLE_START') {
        errored = false;
      } else if (event.code === 'ERROR') {
        errored = true;
        console.error(`[${label}] build error:`, event.error.message);
      } else if (event.code === 'END') {
        if (errored) return; // do not launch or restart into a broken build
        mark(true);
        if (state.started) {
          relaunch();
        } else if (state.mainOk && state.preloadOk) {
          state.started = true;
          relaunch();
        }
      }
    });
  };

  // Attach each watcher's listener synchronously right after its build()
  // resolves, before awaiting the next build. build() in watch mode schedules
  // the first build asynchronously, so a listener attached on the same tick
  // catches its first END; awaiting a second build() before attaching would
  // let the first watcher's initial END slip by unobserved.
  const mainWatcher = (await build({
    configFile: configFor('main'),
    build: { watch: {} },
  })) as Rollup.RollupWatcher;
  attach(
    mainWatcher,
    (ok) => {
      state.mainOk = ok;
    },
    'main',
  );

  const preloadWatcher = (await build({
    configFile: configFor('preload'),
    build: { watch: {} },
  })) as Rollup.RollupWatcher;
  attach(
    preloadWatcher,
    (ok) => {
      state.preloadOk = ok;
    },
    'preload',
  );
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

main().catch((err: unknown) => {
  console.error(err);
  void shutdown(1);
});
