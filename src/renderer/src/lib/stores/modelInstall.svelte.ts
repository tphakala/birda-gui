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
  /** The last install that ended. seq grows by one per install, so a component handles each once. */
  lastFinished: (ModelInstallFinished & { seq: number }) | null;
}

/**
 * The model install for the whole window. followModelInstalls keeps it in step
 * with the main process for the window's lifetime, so a component that is not
 * mounted when an install ends cannot leave it stuck.
 */
export const modelInstall = $state<ModelInstallState>({ current: null, lastFinished: null });

let finishedCount = 0;

async function syncFromMain(): Promise<void> {
  const seenAt = finishedCount;
  const request = await getModelInstallStatus();
  // A finished event since the query was sent is newer than this reply.
  if (finishedCount !== seenAt) return;
  if (request) modelInstall.current ??= { request, progress: null };
  else modelInstall.current = null;
}

/** Follows model installs for the window's lifetime, including one already running. Call once, from App. */
export function followModelInstalls(): () => void {
  const unsubscribes = [
    onModelInstallProgress((progress) => {
      if (modelInstall.current) modelInstall.current.progress = progress;
    }),
    onModelInstallFinished((finished) => {
      finishedCount++;
      modelInstall.current = null;
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
 * Starts an install unless one is running. Resolves true when it installed;
 * how it ended is also reported through lastFinished, for every component.
 */
export async function startModelInstall(request: ModelInstallRequest): Promise<boolean> {
  if (modelInstall.current) return false;
  modelInstall.current = { request, progress: null };
  const seenAt = finishedCount;
  try {
    await installModel(request);
    return true;
  } catch {
    // Refused before it started (another install holds the slot): no finished
    // event will come, so take the running install's state from main.
    if (finishedCount === seenAt) await syncFromMain().catch(() => undefined);
    return false;
  }
}

export async function cancelModelInstall(): Promise<void> {
  await cancelInstall();
}
