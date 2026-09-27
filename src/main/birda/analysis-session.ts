import type { AnalysisProgressSnapshot, AnalysisStatus } from '$shared/types';

/** Rejects an analysis that ended because the user cancelled it. */
export class AnalysisCancelledError extends Error {
  constructor() {
    super('Analysis cancelled');
    this.name = 'AnalysisCancelledError';
  }
}

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

interface Cancellable {
  cancel: () => void;
  stderrLog: () => string;
}

/** One analysis, from taking the lock until releasing it. */
export class AnalysisSession {
  private handle: Cancellable | null = null;
  private cancelled = false;
  /** The catalog run, once created. */
  runId: number | null = null;
  /** birda's temporary output directory, for a directory analysis. */
  outputDir: string | null = null;
  /** The app is quitting: the run was already recorded and the catalog is closing. */
  quitting = false;
  readonly progress: AnalysisProgressSnapshot = {
    totalFiles: 0,
    filesProcessed: 0,
    filesFailed: 0,
    totalDetections: 0,
    completedFiles: [],
  };

  constructor(readonly sourcePath: string) {}

  get cancelRequested(): boolean {
    return this.cancelled;
  }

  /** Connects the birda process. A cancel requested before this is passed on to it. */
  attach(handle: Cancellable): void {
    this.handle = handle;
    if (this.cancelled) handle.cancel();
  }

  cancel(): void {
    this.cancelled = true;
    this.handle?.cancel();
  }

  stderrLog(): string {
    return this.handle?.stderrLog() ?? '';
  }
}

/** Allows one analysis at a time. Only the session holding the lock can release it. */
export class AnalysisLock {
  private current: AnalysisSession | null = null;

  get active(): AnalysisSession | null {
    return this.current;
  }

  acquire(sourcePath: string): AnalysisSession {
    if (this.current) {
      throw new Error(
        this.current.cancelRequested
          ? 'The previous analysis is still stopping. Try again when it has stopped.'
          : 'An analysis is already running. Cancel it first.',
      );
    }
    this.current = new AnalysisSession(sourcePath);
    return this.current;
  }

  release(session: AnalysisSession): void {
    if (this.current === session) this.current = null;
  }

  status(): AnalysisStatus {
    if (!this.current) return { state: 'idle' };
    return {
      state: this.current.cancelRequested ? 'stopping' : 'running',
      sourcePath: this.current.sourcePath,
      progress: { ...this.current.progress, completedFiles: [...this.current.progress.completedFiles] },
    };
  }
}
