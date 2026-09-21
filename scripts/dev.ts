import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer, build, type Rollup, type ViteDevServer } from 'vite';
import electron from 'electron';

// `import electron from 'electron'` in a Node context resolves to the path of
// the Electron binary; its type is the Electron API, hence the cast.
const electronPath = electron as unknown as string;

const root = resolve(import.meta.dirname, '..');
const configFor = (name: string): string => resolve(root, `build/vite/${name}.config.ts`);

let server: ViteDevServer | null = null;
let electronProc: ChildProcess | null = null;
let quitting = false;
// Serialize (re)starts so a rebuild during an in-flight restart cannot spawn a
// second, overlapping Electron process against the same SQLite database.
let startChain: Promise<void> = Promise.resolve();

/** Kill the current Electron process, if any, and resolve once it has exited. */
function killCurrent(): Promise<void> {
  const dying = electronProc;
  electronProc = null;
  if (!dying) return Promise.resolve();
  // Already exited: the 'exit' event will not fire again, so awaiting it would
  // hang forever (for example on window close, where the exit handler itself
  // drives shutdown).
  if (dying.exitCode !== null || dying.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((res) => {
    dying.once('exit', () => {
      res();
    });
    dying.kill();
  });
}

async function shutdown(code: number): Promise<void> {
  // A second signal while already shutting down forces an immediate exit, so a
  // hung teardown can still be interrupted with a second Ctrl+C.
  if (quitting) {
    process.exit(code);
  }
  quitting = true;
  await killCurrent();
  if (server) await server.close();
  process.exit(code);
}

function spawnElectron(url: string): void {
  const proc = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RENDERER_URL: url },
  });
  electronProc = proc;
  proc.on('error', (err) => {
    console.error('[electron] failed to start:', err.message);
    if (!quitting && electronProc === proc) void shutdown(1);
  });
  proc.on('exit', () => {
    // Only the user closing the current window tears the loop down. A kill
    // during a restart clears electronProc first, so proc no longer matches
    // and its exit is ignored.
    if (!quitting && electronProc === proc) void shutdown(0);
  });
}

/** Restart Electron, serialized through startChain so restarts never overlap. */
function relaunchElectron(url: string): void {
  startChain = startChain
    .then(async () => {
      await killCurrent();
      if (!quitting) spawnElectron(url);
    })
    .catch((err: unknown) => {
      console.error(err);
      void shutdown(1);
    });
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
    relaunchElectron(url);
  }, 150);

  // 2. Watch-build main and preload. build() in watch mode resolves with a
  //    RollupWatcher. Sequence is START -> BUNDLE_START -> BUNDLE_END -> END on
  //    success, and START -> BUNDLE_START -> ERROR -> END on failure, so END
  //    alone is not proof of success: track an error flag per run. `mode:
  //    development` matches electron-vite dev (import.meta.env.DEV etc.).
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
  // the first build asynchronously, so a same-tick listener catches its first
  // END; awaiting a second build() before attaching would let the first
  // watcher's initial END slip by and the app would never launch on startup.
  const mainWatcher = (await build({
    configFile: configFor('main'),
    mode: 'development',
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
    mode: 'development',
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
