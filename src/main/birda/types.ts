export interface BirdaEventEnvelope {
  spec_version: string;
  timestamp: string;
  event: BirdaEventType;
  payload: unknown;
}

export type BirdaEventType =
  | 'pipeline_started'
  | 'file_started'
  | 'progress'
  | 'file_completed'
  | 'pipeline_completed'
  | 'detections';

export interface PipelineStartedPayload {
  total_files: number;
  model: string;
  min_confidence: number;
}

export interface FileStartedPayload {
  file: string;
  index: number;
  estimated_segments: number;
}

export interface ProgressPayload {
  file: {
    path: string;
    segments_done: number;
    segments_total: number;
    percent: number;
  };
}

export interface FileCompletedPayload {
  file: string;
  status: 'processed' | 'failed' | 'skipped';
  detections: number;
  duration_ms: number;
}

export interface PipelineCompletedPayload {
  status: string;
  files_processed: number;
  files_failed: number;
  total_detections: number;
  duration_ms: number;
  realtime_factor: number;
}

export interface DetectionsPayload {
  file: string;
  detections: BirdaDetection[];
}

export interface BirdaDetection {
  species: string;
  scientific_name: string;
  common_name: string;
  confidence: number;
  start_time: number;
  end_time: number;
}
