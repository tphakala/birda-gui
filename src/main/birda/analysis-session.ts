import type { AnalysisProgressSnapshot, AnalysisStatus, RunningAnalysisSettings } from '$shared/types';

/** Rejects an analysis that ended because the user cancelled it. */
export class AnalysisCancelledError extends Error {
  constructor() {
    super('Analysis cancelled');
    this.name = 'AnalysisCancelledError';
  }
}

interface Cancellable {
  cancel: () => void;
}

/** One analysis, from taking the lock until releasing it. */
export class AnalysisSession {
  private handle: Cancellable | null = null;
  private cancelled = false;
  /**
   * The catalog run while its final status is still to be recorded: set when
   * the run is created, back to null once the status is recorded (by the
   * analysis or by a quit), so it is never recorded twice.
   */
  runId: number | null = null;
  /** birda's temporary output directory, for a directory analysis. */
  outputDir: string | null = null;
  /** The app is quitting: the run was recorded, if one was created, and the catalog is closing. */
  quitting = false;
  readonly progress: AnalysisProgressSnapshot = {
    totalFiles: 0,
    filesProcessed: 0,
    filesFailed: 0,
    totalDetections: 0,
    completedFiles: [],
  };

  constructor(
    readonly sourcePath: string,
    readonly settings: RunningAnalysisSettings,
  ) {}

  /** A run was created and its final status is not recorded yet. */
  get runPending(): boolean {
    return this.runId !== null;
  }

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
}

/** Allows one analysis at a time. Only the session holding the lock can release it. */
export class AnalysisLock {
  private current: AnalysisSession | null = null;

  get active(): AnalysisSession | null {
    return this.current;
  }

  acquire(sourcePath: string, settings: RunningAnalysisSettings): AnalysisSession {
    if (this.current) {
      throw new Error(
        this.current.cancelRequested
          ? 'The previous analysis is still stopping. Try again when it has stopped.'
          : 'An analysis is already running. Stop it first.',
      );
    }
    this.current = new AnalysisSession(sourcePath, settings);
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
      settings: this.current.settings,
      progress: { ...this.current.progress, completedFiles: [...this.current.progress.completedFiles] },
    };
  }
}
