import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer, build, type Rolldown, type ViteDevServer } from 'vite';
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

/** Kill the current Electron process, if any, and resolve once it has closed. */
function killCurrent(): Promise<void> {
  const dying = electronProc;
  electronProc = null;
  if (!dying) return Promise.resolve();
  // Already exited: 'close' will not fire again, so awaiting it would hang.
  if (dying.exitCode !== null || dying.signalCode !== null) return Promise.resolve();
  return new Promise<void>((res) => {
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        res();
      }
    };
    // 'close' fires after a normal exit and after a failed spawn, so cleanup
    // completes in both cases.
    dying.once('close', finish);
    try {
      dying.kill();
    } catch {
      // Already gone (for example ESRCH): nothing to wait for.
      finish();
    }
    // The process may have exited between the check above and attaching the
    // listener; 'close' would then never arrive, so resolve now.
    if (dying.exitCode !== null || dying.signalCode !== null) finish();
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
  proc.on('exit', (code, signal) => {
    // Only the user closing the current window tears the loop down. A kill
    // during a restart clears electronProc first, so proc no longer matches
    // and its exit is ignored. Propagate a crash's status (a signal death
    // reports code === null) rather than masking it as a clean shutdown.
    if (!quitting && electronProc === proc) void shutdown(code ?? (signal ? 1 : 0));
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

  // Per-target build health. Electron launches, and later relaunches, only
  // when BOTH the main and preload bundles are currently valid, so a failed
  // rebuild of one target does not restart Electron into stale output.
  const state = { mainOk: false, preloadOk: false };
  // Coalesce the two watchers' END events (and rapid rebuilds) into one
  // relaunch. Re-check build health at fire time, not schedule time: a target
  // can break during the debounce window after another target scheduled this.
  const relaunch = debounce(() => {
    if (state.mainOk && state.preloadOk) relaunchElectron(url);
  }, 150);

  // build() in watch mode resolves with a RolldownWatcher. The event sequence is
  // START -> BUNDLE_START -> BUNDLE_END -> END on success and START ->
  // BUNDLE_START -> ERROR -> END on failure, so END alone is not proof of
  // success: track an error flag per run and reflect it in build health.
  const attach = (watcher: Rolldown.RolldownWatcher, apply: (ok: boolean) => void, label: string): void => {
    let errored = false;
    watcher.on('event', (event) => {
      if (event.code === 'BUNDLE_START') {
        errored = false;
      } else if (event.code === 'ERROR') {
        errored = true;
        console.error(`[${label}] build error:`, event.error.message);
      } else if (event.code === 'END') {
        apply(!errored);
        relaunch();
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
  })) as Rolldown.RolldownWatcher;
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
  })) as Rolldown.RolldownWatcher;
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
