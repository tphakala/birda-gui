/** Severity drives the daisyUI alert color in ToastOutlet. */
type ToastSeverity = 'error' | 'warning' | 'info' | 'success';

interface ToastState {
  message: string | null;
  severity: ToastSeverity;
}

const DEFAULT_TOAST_DURATION_MS = 4000;

/** Single app-wide transient toast. Rendered once by ToastOutlet at the app root. */
export const toast = $state<ToastState>({ message: null, severity: 'info' });

let toastTimer: ReturnType<typeof setTimeout> | null = null;
// How long the current toast has left, while it is paused.
let remainingMs = 0;
let shownAt = 0;
let durationMs = 0;

/**
 * Show a transient toast, replacing any current one. Callable from non-component
 * contexts (e.g. store actions), so the auto-dismiss timer lives at module scope
 * rather than in a component $effect. Re-entrant calls restart the timer, and
 * the timer pauses while the pointer or focus is on the toast.
 */
export function showToast(message: string, options?: { severity?: ToastSeverity; durationMs?: number }): void {
  if (toastTimer !== null) clearTimeout(toastTimer);
  toast.message = message;
  toast.severity = options?.severity ?? 'info';
  startTimer(options?.durationMs ?? DEFAULT_TOAST_DURATION_MS);
}

function startTimer(ms: number): void {
  shownAt = Date.now();
  durationMs = ms;
  toastTimer = setTimeout(() => {
    toast.message = null;
    toastTimer = null;
  }, ms);
}

/** Keeps the toast up while the pointer or focus is on it. */
export function pauseToast(): void {
  if (toastTimer === null) return;
  clearTimeout(toastTimer);
  toastTimer = null;
  remainingMs = Math.max(0, durationMs - (Date.now() - shownAt));
}

/** Lets a paused toast finish its remaining time. */
export function resumeToast(): void {
  if (toast.message === null || toastTimer !== null) return;
  startTimer(Math.max(remainingMs, 1500));
}

/** Dismiss the current toast immediately. Clears the pending timer first so it cannot null a toast shown later. */
export function dismissToast(): void {
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toast.message = null;
}
