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

export interface BirdaDetection {
  species: string;
  scientific_name: string;
  common_name: string;
  confidence: number;
  start_time: number;
  end_time: number;
}
