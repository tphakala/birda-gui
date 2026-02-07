import type {
  BirdaEventEnvelope,
  ProgressPayload,
  PipelineStartedPayload,
  FileCompletedPayload,
  PipelineCompletedPayload,
} from '$shared/types';

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
  status: 'idle' | 'running' | 'completed' | 'failed';
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
  error: null,
  events: [],
});

export function resetAnalysis(): void {
  analysisState.totalFiles = 0;
  analysisState.filesProcessed = 0;
  analysisState.filesFailed = 0;
  analysisState.totalDetections = 0;
  analysisState.currentFile = null;
  analysisState.status = 'idle';
  analysisState.error = null;
  analysisState.events = [];
}

const MAX_EVENTS = 500;

export function handleAnalysisEvent(envelope: BirdaEventEnvelope): void {
  if (analysisState.events.length >= MAX_EVENTS) {
    analysisState.events.splice(0, analysisState.events.length - MAX_EVENTS + 1);
  }
  analysisState.events.push(envelope);

  switch (envelope.event) {
    case 'pipeline_started': {
      const p = envelope.payload as PipelineStartedPayload;
      analysisState.totalFiles = p.total_files;
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
      analysisState.filesProcessed++;
      if (p.status === 'failed') analysisState.filesFailed++;
      analysisState.totalDetections += p.detections;
      analysisState.currentFile = null;
      break;
    }
    case 'pipeline_completed': {
      const p = envelope.payload as PipelineCompletedPayload;
      analysisState.status = 'completed';
      analysisState.totalDetections = p.total_detections;
      break;
    }
  }
}
