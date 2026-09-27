import {
  cancelInstall,
  getModelInstallStatus,
  installModel,
  onModelInstallFinished,
  onModelInstallProgress,
} from '$lib/utils/ipc';
import type { ModelInstallFinished, ModelInstallProgress, ModelInstallRequest } from '$shared/types';

interface ModelInstallState {
  /** The install holding birda's single install slot, whichever component or window started it. */
  current: { request: ModelInstallRequest; progress: ModelInstallProgress | null } | null;
  /** The last install that ended. seq grows by one per install. */
  lastFinished: (ModelInstallFinished & { seq: number }) | null;
  /** seq of the last outcome a component showed; one that ended while none was mounted is shown by the next. */
  reportedSeq: number;
}

/**
 * The model install for the whole window. followModelInstalls keeps it in step
 * with the main process for the window's lifetime, so a component that is not
 * mounted when an install ends cannot leave it stuck.
 */
export const modelInstall = $state<ModelInstallState>({ current: null, lastFinished: null, reportedSeq: 0 });

let finishedCount = 0;
let syncing = false;

function sameRequest(a: ModelInstallRequest, b: ModelInstallRequest): boolean {
  return a.id === b.id && a.region === b.region && a.variant === b.variant;
}

async function syncFromMain(): Promise<void> {
  const seenAt = finishedCount;
  const before = modelInstall.current;
  const request = await getModelInstallStatus();
  // A finished event, or an install this window started, since the query was sent is newer than this reply.
  if (finishedCount !== seenAt || modelInstall.current !== before) return;
  if (request) modelInstall.current ??= { request, progress: null };
  else modelInstall.current = null;
}

/** Follows model installs for the window's lifetime, including one already running. Call once, from App. */
export function followModelInstalls(): () => void {
  const unsubscribes = [
    onModelInstallProgress((progress) => {
      if (modelInstall.current) {
        modelInstall.current.progress = progress;
      } else if (!syncing) {
        // An install another window started: ask main which one it is.
        syncing = true;
        syncFromMain()
          .catch(() => undefined)
          .finally(() => {
            syncing = false;
          });
      }
    }),
    onModelInstallFinished((finished) => {
      finishedCount++;
      // A late event for an install that already settled must not clear the next one.
      if (modelInstall.current && sameRequest(modelInstall.current.request, finished.request)) {
        modelInstall.current = null;
      }
      modelInstall.lastFinished = { ...finished, seq: finishedCount };
    }),
  ];
  syncFromMain().catch(() => {
    // No install to follow
  });
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

/**
 * Starts an install. Resolves true when it installed, false when it was
 * cancelled, failed or refused (another install is running); how it ended is
 * reported through lastFinished.
 */
export async function startModelInstall(request: ModelInstallRequest): Promise<boolean> {
  if (modelInstall.current) return false;
  modelInstall.current = { request, progress: null };
  // The state proxy, not the plain object, so the identity checks below match.
  const mine = modelInstall.current;
  const seenAt = finishedCount;
  try {
    await installModel(request);
    return true;
  } catch {
    if (finishedCount === seenAt) {
      // Refused before it started (another install holds the slot): no
      // finished event will come, so show the install main is running.
      if (modelInstall.current === mine) modelInstall.current = null;
      await syncFromMain().catch(() => undefined);
    }
    return false;
  } finally {
    // The install has settled. Its finished event may arrive after this reply;
    // clear it now so a caller such as Update all can start the next one.
    if (modelInstall.current === mine) modelInstall.current = null;
  }
}

/**
 * Shows each install outcome once, from a component: one that ended while no
 * component was mounted is shown when one mounts. Call during component init.
 */
export function reportInstallOutcomes(report: (finished: ModelInstallFinished) => void): void {
  $effect(() => {
    const finished = modelInstall.lastFinished;
    if (!finished || finished.seq <= modelInstall.reportedSeq) return;
    modelInstall.reportedSeq = finished.seq;
    report(finished);
  });
}

export { cancelInstall as cancelModelInstall };
