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

export interface DetectionsPayload {
  file: string;
  detections: BirdaDetection[];
}

export interface PipelineStartedPayload {
  files_total: number;
}

export interface FileStartedPayload {
  file: string;
  samples: number;
}

export interface ProgressPayload {
  percent: number;
  current_time: number;
}

export interface FileCompletedPayload {
  file: string;
  status: 'processed' | 'failed' | 'skipped';
  detections: number;
  duration_ms: number;
}

export interface PipelineCompletedPayload {
  status: 'success' | 'failed';
  files_processed: number;
}

export interface BirdaDetection {
  species: string;
  scientific_name: string;
  common_name: string;
  confidence: number;
  start_time: number;
  end_time: number;
}
