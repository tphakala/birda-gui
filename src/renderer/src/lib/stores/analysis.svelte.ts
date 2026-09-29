import type {
  AnalysisProgressSnapshot,
  BirdaEventEnvelope,
  FileCompletedPayload,
  ProgressPayload,
} from '$shared/types';
import { applyProgressEvent, fileStatusOf, type FileStatus } from '$shared/analysis-progress';

// Re-export event types for renderer use
export type { BirdaEventEnvelope };

interface FileProgress {
  path: string;
  segmentsDone: number;
  segmentsTotal: number;
  percent: number;
}

interface AnalysisProgress {
  /** The source the panel describes, so revisiting the page does not dismiss it. */
  source: string | null;
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
  /** Outcome per source file path, set as each file_completed event arrives. */
  fileStatuses: Record<string, FileStatus>;
}

export const analysisState = $state<AnalysisProgress>({
  source: null,
  totalFiles: 0,
  filesProcessed: 0,
  filesFailed: 0,
  totalDetections: 0,
  currentFile: null,
  status: 'idle',
  hadErrors: false,
  discarded: false,
  error: null,
  fileStatuses: {},
});

export function dismissAnalysis(): void {
  if (analysisState.status !== 'idle' && analysisState.status !== 'running') {
    analysisState.status = 'idle';
    // The panel no longer describes any source, so choosing the same one again starts fresh
    analysisState.source = null;
  }
}

export function resetAnalysis(source: string | null): void {
  analysisState.source = source;
  analysisState.totalFiles = 0;
  analysisState.filesProcessed = 0;
  analysisState.filesFailed = 0;
  analysisState.totalDetections = 0;
  analysisState.currentFile = null;
  analysisState.status = 'idle';
  analysisState.hadErrors = false;
  analysisState.discarded = false;
  analysisState.error = null;
  analysisState.fileStatuses = {};
}

/**
 * Starts showing an analysis this window joined mid-run, from the counts the
 * main process kept, including each finished file's status for the per-file
 * status list.
 */
export function joinRunningAnalysis(source: string, progress: AnalysisProgressSnapshot): void {
  resetAnalysis(source);
  analysisState.status = 'running';
  analysisState.totalFiles = progress.totalFiles;
  analysisState.filesProcessed = progress.filesProcessed;
  analysisState.filesFailed = progress.filesFailed;
  analysisState.totalDetections = progress.totalDetections;
  for (const f of progress.completedFiles) analysisState.fileStatuses[f.file] = fileStatusOf(f.status);
}

export function handleAnalysisEvent(envelope: BirdaEventEnvelope): void {
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
      const p = envelope.payload as FileCompletedPayload;
      analysisState.fileStatuses[p.file] = fileStatusOf(p.status);
      analysisState.currentFile = null;
      break;
    }
  }
}
