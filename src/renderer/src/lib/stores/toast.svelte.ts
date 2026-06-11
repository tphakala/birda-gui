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

/**
 * Show a transient toast, replacing any current one. Callable from non-component
 * contexts (e.g. store actions), so the auto-dismiss timer lives at module scope
 * rather than in a component $effect. Re-entrant calls restart the timer.
 */
export function showToast(message: string, options?: { severity?: ToastSeverity; durationMs?: number }): void {
  if (toastTimer !== null) clearTimeout(toastTimer);
  toast.message = message;
  toast.severity = options?.severity ?? 'info';
  toastTimer = setTimeout(() => {
    toast.message = null;
    toastTimer = null;
  }, options?.durationMs ?? DEFAULT_TOAST_DURATION_MS);
}

/** Dismiss the current toast immediately. Clears the pending timer first so it cannot null a toast shown later. */
export function dismissToast(): void {
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toast.message = null;
}
