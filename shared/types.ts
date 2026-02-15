// === Audio file scanning ===

export interface AudioMothMeta {
  deviceId: string;
  gain: string;
  batteryV: number | null;
  temperatureC: number | null;
  /** ISO 8601 recording timestamp. Includes 'Z' for UTC or '+HH:MM'/'-HH:MM' offset. */
  recordedAt: string | null;
  /** UTC offset in minutes parsed from the AudioMoth comment (0 = UTC, null = unknown). */
  timezoneOffsetMin: number | null;
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
  status: 'pending' | 'running' | 'completed' | 'failed' | 'completed_with_errors';
  started_at: string | null;
  completed_at: string | null;
  /** UTC offset in minutes of the recording's timezone (0 = UTC, null = unknown). */
  timezone_offset_min: number | null;
}

export interface RunWithStats extends AnalysisRun {
  detection_count: number;
  file_count: number; // NEW: number of audio files in this run
  is_directory: boolean; // NEW: true if source_path is a directory
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface Detection {
  id: number;
  run_id: number;
  location_id: number | null;
  audio_file_id: number; // NEW: replaces source_file as primary reference
  start_time: number;
  end_time: number;
  scientific_name: string;
  confidence: number;
  clip_path: string | null;
  detected_at: string;
  source_file?: string; // DEPRECATED: kept for backward compat during migration
}

// === Audio Files ===

export interface AudioFile {
  id: number;
  run_id: number;
  file_path: string;
  file_name: string;
  recording_start: string | null;
  timezone_offset_min: number | null;
  duration_sec: number | null;
  sample_rate: number | null;
  channels: number | null;
  audiomoth_device_id: string | null;
  audiomoth_gain: string | null;
  audiomoth_battery_v: number | null;
  audiomoth_temperature_c: number | null;
  created_at: string;
}

/** Metadata for creating audio_files records during analysis */
export interface AudioFileMetadata {
  recording_start: string | null;
  timezone_offset_min: number | null;
  duration_sec: number | null;
  sample_rate: number | null;
  channels: number | null;
  audiomoth_device_id?: string | null;
  audiomoth_gain?: string | null;
  audiomoth_battery_v?: number | null;
  audiomoth_temperature_c?: number | null;
}

/** Detection enriched with common_name and audio_file data */
export interface EnrichedDetection extends Detection {
  common_name: string;
  audio_file: AudioFile; // NEW: joined audio file data
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

/** Per-species aggregation for a filtered run, used by the Species cards view */
export interface RunSpeciesAggregation {
  scientific_name: string;
  common_name: string;
  detection_count: number;
  avg_confidence: number;
  max_confidence: number;
  first_detected: string;
  last_detected: string;
}

/** Single cell in the hourly detection heatmap */
export interface HourlyDetectionCell {
  scientific_name: string;
  common_name: string;
  hour: number; // 0-23
  detection_count: number;
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
  /** UTC offset in minutes from AudioMoth metadata (0 = UTC). Omit if unknown. */
  timezone_offset_min?: number | undefined;
}

export interface DetectionFilter {
  species?: string | undefined;
  scientific_names?: string[] | undefined;
  location_id?: number | undefined;
  min_confidence?: number | undefined;
  run_id?: number | undefined;
  species_list_id?: number | undefined;
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
  default_execution_provider: string;
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

export interface FileStartedPayload {
  file: string;
  samples: number;
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

// === Species Lists ===

/** A species list stored in the database */
export interface SpeciesList {
  id: number;
  name: string;
  description: string | null;
  source: 'fetched' | 'custom';
  latitude: number | null;
  longitude: number | null;
  week: number | null;
  threshold: number | null;
  species_count: number;
  created_at: string;
}

/** An entry within a species list */
export interface SpeciesListEntry {
  id: number;
  list_id: number;
  scientific_name: string;
  common_name: string | null;
  frequency: number | null;
}

/** Entry enriched with resolved common name from label service */
export interface EnrichedSpeciesListEntry extends SpeciesListEntry {
  resolved_common_name: string;
}

/** Request to fetch species from birda CLI */
export interface SpeciesFetchRequest {
  latitude: number;
  longitude: number;
  week: number;
  threshold?: number;
}

/** A single species returned from birda CLI species command */
export interface BirdaSpeciesResult {
  scientific_name: string;
  common_name: string;
  frequency: number;
}

/** Full result payload from birda CLI species command */
export interface BirdaSpeciesResponse {
  lat: number;
  lon: number;
  week: number;
  threshold: number;
  species_count: number;
  species: BirdaSpeciesResult[];
}
