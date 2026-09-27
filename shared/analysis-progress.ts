import type {
  BirdaEventEnvelope,
  FileCompletedPayload,
  PipelineCompletedPayload,
  PipelineStartedPayload,
} from './types';

export interface ProgressCounts {
  totalFiles: number;
  filesProcessed: number;
  filesFailed: number;
  totalDetections: number;
}

/**
 * Applies one birda event to progress counts. The renderer's progress panel and
 * the main process's snapshot for a window that joins mid-run both count this
 * way, so the two agree.
 */
export function applyProgressEvent(counts: ProgressCounts, envelope: BirdaEventEnvelope): void {
  if (envelope.event === 'pipeline_started') {
    counts.totalFiles = (envelope.payload as PipelineStartedPayload).total_files;
  } else if (envelope.event === 'file_completed') {
    const payload = envelope.payload as FileCompletedPayload;
    counts.filesProcessed++;
    if (payload.status === 'failed') counts.filesFailed++;
    // birda omits detections for a file that failed or was skipped.
    counts.totalDetections += payload.detections ?? 0;
  } else if (envelope.event === 'pipeline_completed') {
    counts.totalDetections = (envelope.payload as PipelineCompletedPayload).total_detections;
  }
}
