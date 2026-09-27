import type { AnalysisProgressSnapshot, BirdaEventEnvelope, ProgressPayload } from '$shared/types';
import { applyProgressEvent } from '$shared/analysis-progress';

// Re-export event types for renderer use
export type { BirdaEventEnvelope };

interface FileProgress {
  path: string;
  segmentsDone: number;
  segmentsTotal: number;
  percent: number;
}

interface AnalysisProgress {
  totalFiles: number;
  filesProcessed: number;
  filesFailed: number;
  totalDetections: number;
  currentFile: FileProgress | null;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped';
  /** Completed, but some files failed to analyse or import. */
  hadErrors: boolean;
  /** Stopped, and the partial results were discarded for earlier complete ones. */
  discarded: boolean;
  error: string | null;
  events: BirdaEventEnvelope[];
}

export const analysisState = $state<AnalysisProgress>({
  totalFiles: 0,
  filesProcessed: 0,
  filesFailed: 0,
  totalDetections: 0,
  currentFile: null,
  status: 'idle',
  hadErrors: false,
  discarded: false,
  error: null,
  events: [],
});

export function dismissAnalysis(): void {
  if (analysisState.status !== 'idle' && analysisState.status !== 'running') {
    analysisState.status = 'idle';
  }
}

export function resetAnalysis(): void {
  analysisState.totalFiles = 0;
  analysisState.filesProcessed = 0;
  analysisState.filesFailed = 0;
  analysisState.totalDetections = 0;
  analysisState.currentFile = null;
  analysisState.status = 'idle';
  analysisState.hadErrors = false;
  analysisState.discarded = false;
  analysisState.error = null;
  analysisState.events = [];
}

/**
 * Starts showing an analysis this window joined mid-run, from the counts the
 * main process kept. Finished files become file_completed events, which the
 * per-file status list reads.
 */
export function joinRunningAnalysis(progress: AnalysisProgressSnapshot): void {
  resetAnalysis();
  analysisState.status = 'running';
  analysisState.totalFiles = progress.totalFiles;
  analysisState.filesProcessed = progress.filesProcessed;
  analysisState.filesFailed = progress.filesFailed;
  analysisState.totalDetections = progress.totalDetections;
  analysisState.events = progress.completedFiles.map((f) => ({
    spec_version: '',
    timestamp: '',
    event: 'file_completed',
    payload: { file: f.file, status: f.status },
  }));
}

const MAX_EVENTS = 500;

export function handleAnalysisEvent(envelope: BirdaEventEnvelope): void {
  analysisState.events.push(envelope);

  // Trim only progress events when limit reached - keep file_completed events for UI state
  if (analysisState.events.length > MAX_EVENTS) {
    const criticalEvents = analysisState.events.filter((e) => e.event !== 'progress');
    const progressEvents = analysisState.events.filter((e) => e.event === 'progress');

    // Keep all critical events + recent progress events
    const trimmedProgress = progressEvents.slice(-Math.max(0, MAX_EVENTS - criticalEvents.length));
    analysisState.events = [...criticalEvents, ...trimmedProgress];
  }

  applyProgressEvent(analysisState, envelope);
  switch (envelope.event) {
    case 'pipeline_started': {
      analysisState.status = 'running';
      break;
    }
    case 'progress': {
      const p = envelope.payload as ProgressPayload;
      analysisState.currentFile = {
        path: p.file.path,
        segmentsDone: p.file.segments_done,
        segmentsTotal: p.file.segments_total,
        percent: p.file.percent,
      };
      break;
    }
    case 'file_completed': {
      analysisState.currentFile = null;
      break;
    }
  }
}
