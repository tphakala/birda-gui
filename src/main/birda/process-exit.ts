type ExitOutcome = 'success' | 'cancelled' | 'failed';

/**
 * Classifies how a birda process ended. Only exit code 0 is a success: a
 * process killed by a signal exits with code null, so null is a failure unless
 * the kill was a requested cancel. After a cancel any non-zero exit counts as
 * the cancel, whatever code or signal the killed process reports.
 */
export function classifyExit(code: number | null, cancelRequested: boolean): ExitOutcome {
  if (code === 0) return 'success';
  return cancelRequested ? 'cancelled' : 'failed';
}
