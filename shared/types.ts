// === Audio file scanning ===

export interface AudioMothMeta {
  deviceId: string;
  gain: string;
  batteryV: number | null;
  temperatureC: number | null;
  recordedAtUtc: string | null;
}

export interface AudioFileInfo {
  path: string;
  name: string;
  size: number;
  durationSec: number | null;
  sampleRate: number | null;
  channels: number | null;
  format: string;
  audiomoth: AudioMothMeta | null;
}

export interface SourceScanResult {
  isFolder: boolean;
  files: AudioFileInfo[];
  totalSize: number;
  totalDuration: number;
}

// === Database entities ===

export interface Location {
  id: number;
  name: string | null;
  latitude: number;
  longitude: number;
  description: string | null;
  created_at: string;
}

export interface AnalysisRun {
  id: number;
  location_id: number | null;
  source_path: string;
  model: string;
  min_confidence: number;
  settings_json: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
}

export interface Detection {
  id: number;
  run_id: number;
  location_id: number | null;
  source_file: string;
  start_time: number;
  end_time: number;
  scientific_name: string;
  confidence: number;
  clip_path: string | null;
  detected_at: string;
}

/** Detection enriched with common_name resolved from label files */
export interface EnrichedDetection extends Detection {
  common_name: string;
}

export interface SpeciesSummary {
  scientific_name: string;
  location_count: number;
  detection_count: number;
  last_detected: string;
  avg_confidence: number;
}

/** SpeciesSummary enriched with common_name resolved from label files */
export interface EnrichedSpeciesSummary extends SpeciesSummary {
  common_name: string;
}

// === Analysis ===

export interface AnalysisRequest {
  source_path: string;
  model: string;
  min_confidence: number;
  location_id?: number | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  location_name?: string | undefined;
  month?: number | undefined;
  day?: number | undefined;
}

export interface DetectionFilter {
  species?: string | undefined;
  scientific_names?: string[] | undefined;
  location_id?: number | undefined;
  min_confidence?: number | undefined;
  run_id?: number | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sort_column?: string | undefined;
  sort_dir?: 'asc' | 'desc' | undefined;
}

// === birda CLI ===

export interface InstalledModel {
  id: string;
  model_type: string;
  is_default: boolean;
  path: string;
  labels_path: string;
  has_meta_model: boolean;
}

export interface AvailableModel {
  id: string;
  name: string;
  description: string;
  vendor: string;
  version: string;
  model_type: string;
  recommended: boolean;
  license: string;
  commercial_use: boolean;
}

export interface AppSettings {
  birda_path: string;
  clip_output_dir: string;
  db_path: string;
  default_model: string;
  default_confidence: number;
  default_freq_max: number;
  default_spectrogram_height: number;
  species_language: string;
  ui_language: string;
  theme: 'system' | 'light' | 'dark';
  setup_completed: boolean;
}

// === Catalog Stats ===

export interface CatalogStats {
  total_detections: number;
  total_species: number;
  total_locations: number;
}

// === birda NDJSON Events (shared for renderer progress display) ===

export interface BirdaEventEnvelope {
  spec_version: string;
  timestamp: string;
  event: string;
  payload: unknown;
}

export interface PipelineStartedPayload {
  total_files: number;
  model: string;
  min_confidence: number;
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
  detections: {
    species: string;
    scientific_name: string;
    common_name: string;
    confidence: number;
    start_time: number;
    end_time: number;
  }[];
}
