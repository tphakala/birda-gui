import type { RUN_STATUSES } from './constants';
import type { ClockDay } from './time-zone';
// === CUDA Library Management ===

export interface CudaStatus {
  /** Whether an NVIDIA GPU was detected */
  hasNvidiaGpu: boolean;
  /** Whether CUDA libraries are downloaded and available */
  installed: boolean;
  /** Version of the installed CUDA libraries (from manifest), null if not installed */
  version: string | null;
  /** Disk usage in bytes of the installed CUDA libraries, 0 if not installed */
  diskUsageBytes: number;
  /** Platform supports CUDA (linux or windows only) */
  platformSupported: boolean;
  /** Whether a CUDA download is currently in progress */
  downloadInProgress: boolean;
}

export interface CudaDownloadProgress {
  /** Bytes downloaded so far */
  downloadedBytes: number;
  /** Total bytes to download (0 if unknown) */
  totalBytes: number;
  /** Current phase: 'downloading' | 'extracting' | 'verifying' */
  phase: 'downloading' | 'extracting' | 'verifying';
}

/** Sent to every window on cuda:download-finished when a CUDA download settles. */
export interface CudaDownloadFinished {
  outcome: 'installed' | 'cancelled' | 'failed';
  error?: string | undefined;
}

export interface CudaDownloadResult {
  /** Whether the download and extraction succeeded */
  success: boolean;
  /** Version string from manifest */
  version: string;
  /** Final disk usage in bytes */
  diskUsageBytes: number;
}

export interface BirdaManifest {
  version: string;
  min_gui_version: string;
  assets: {
    embed: Record<string, string>;
    cuda_libs: Record<string, string>;
  };
  cuda: {
    onnxruntime: string;
    cuda_toolkit: string;
    cudnn: string;
  };
}

// === GPU Detection ===

export interface ExecutionProvider {
  id: string;
  name: string;
  description: string;
}

export interface BirdaProvidersResponse {
  spec_version: string;
  timestamp: string;
  event: string;
  payload: {
    result_type: string;
    providers: ExecutionProvider[];
  };
}

export interface GpuCapabilities {
  hasNvidiaGpu: boolean;
  cudaLibrariesFound: boolean;
  availableProviders: string[];
  platform: string;
}

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

export type RunStatus = (typeof RUN_STATUSES)[number];

/** The status a run ends with. */
export type FinishedRunStatus = Extract<RunStatus, 'completed' | 'completed_with_errors' | 'failed' | 'cancelled'>;

export interface AnalysisRun {
  id: number;
  location_id: number | null;
  source_path: string;
  model: string;
  min_confidence: number;
  settings_json: string | null;
  status: RunStatus;
  started_at: string | null;
  completed_at: string | null;
  /** UTC offset in minutes of the recording's timezone (0 = UTC, null = unknown). */
  timezone_offset_min: number | null;
  /** IANA zone (or 'UTC') the run's filename timestamps were read in. Null for AudioMoth runs and older runs, which show each file's stored offset. */
  timezone: string | null;
  /** Reason birda gave when it ran without the range filter, else null. */
  range_filter_note: string | null;
}

export interface RunWithStats extends AnalysisRun {
  detection_count: number;
  file_count: number; // NEW: number of audio files in this run
  /** Files with a recording start that parses as a time. */
  timed_file_count: number;
  /** Files whose recording start was read from the file name (the run's zone applies to them). */
  filename_file_count: number;
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
  /** Where recording_start came from: the AudioMoth header, the file name, or nowhere. */
  timestamp_source: 'header' | 'filename' | null;
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
  timestamp_source: 'header' | 'filename' | null;
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
  audio_file: AudioFile | null; // NEW: joined audio file data
}

export type AnnotationSource = 'birda' | 'manual';
export type AnnotationStatus = 'accepted' | 'rejected' | 'manual';

/** A human-curated annotation, stored separately from immutable detections. */
export interface Annotation {
  id: number;
  audio_file_id: number;
  detection_id: number | null;
  start_time: number;
  end_time: number;
  /** null means time-only (full spectrogram height). */
  low_freq_hz: number | null;
  high_freq_hz: number | null;
  scientific_name: string;
  confidence: number | null;
  source: AnnotationSource;
  status: AnnotationStatus;
  created_at: string;
  updated_at: string;
}

/** Upsert payload. Omit `id` to insert; provide it to update. */
export interface AnnotationInput {
  id?: number | undefined;
  audio_file_id: number;
  detection_id?: number | null | undefined;
  start_time: number;
  end_time: number;
  low_freq_hz?: number | null | undefined;
  high_freq_hz?: number | null | undefined;
  scientific_name: string;
  confidence?: number | null | undefined;
  source: AnnotationSource;
  status: AnnotationStatus;
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

/** Hourly grid data plus the one clock day every counted detection falls on (null when it is not one day). */
export interface HourlyDetections {
  cells: HourlyDetectionCell[];
  sunDay: ClockDay | null;
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
  /** IANA zone (or 'UTC') that file name timestamps are written in. Omit when no file is named by timestamp. */
  timezone?: string | undefined;
}

/**
 * What birda:analyze resolves with, and the finished outcome of the idle status
 * event. runId is null when no run was created (cancelled during setup) and in
 * a failure reported by the status event.
 */
export interface AnalysisResult {
  runId: number | null;
  status: FinishedRunStatus;
  /** The run's partial results were deleted because an earlier complete result for the same source and model exists. */
  discardedPartial: boolean;
  /** birda ran without the range filter; the reason it gave. */
  rangeFilterNote?: string | undefined;
}

/** Progress counted from the analysis events so far, for a window that joins a running analysis. */
export interface AnalysisProgressSnapshot {
  totalFiles: number;
  filesProcessed: number;
  filesFailed: number;
  totalDetections: number;
  /** Each file finished so far, in order, for the per-file status list. */
  completedFiles: { file: string; status: FileCompletedPayload['status'] }[];
}

/** The settings of the analysis that holds the lock, for a window that joins it. */
export type RunningAnalysisSettings = Pick<
  AnalysisRequest,
  'model' | 'min_confidence' | 'latitude' | 'longitude' | 'location_name' | 'month' | 'day' | 'timezone'
>;

/**
 * Whether an analysis holds the lock. birda:analysis-status returns it, and
 * birda:analysis-status-changed sends it when the state changes (start, Stop,
 * end); progress between those is sent as analysis events, not as status.
 * Only the event's idle status carries finished, the outcome of the analysis
 * that just ended.
 */
export type AnalysisStatus =
  | { state: 'idle'; finished?: AnalysisResult & { error?: string } }
  | {
      state: 'running' | 'stopping';
      sourcePath: string;
      settings: RunningAnalysisSettings;
      progress: AnalysisProgressSnapshot;
    };

export interface DetectionFilter {
  species?: string | undefined;
  scientific_names?: string[] | undefined;
  location_id?: number | undefined;
  min_confidence?: number | undefined;
  run_id?: number | undefined;
  audio_file_id?: number | undefined;
  species_list_id?: number | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sort_column?: string | undefined;
  sort_dir?: 'asc' | 'desc' | undefined;
}

// === birda CLI ===

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type BirdaCheckSuccess = {
  available: true;
  path: string;
  version: string;
  minVersion: string;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type BirdaCheckFailure = {
  available: false;
  error: string;
  path?: string;
  version?: string;
  minVersion?: string;
};

export type BirdaCheckResponse = BirdaCheckSuccess | BirdaCheckFailure;

export interface InstalledModel {
  id: string;
  model_type: string;
  is_default: boolean;
  /** Whether the model has its own meta (range) model. Absent from older birda. */
  has_meta_model?: boolean;
  path?: string;
  labels_path?: string;
  // Install provenance from birda (present on registry installs, absent for
  // `models add` or anything installed before provenance was recorded).
  registry_id?: string;
  installed_version?: string;
  installed_build?: number;
  region?: string;
  variant?: string;
}

/** What `birda config show` reports: where the config file is and its contents. */
export interface BirdaConfigPayload {
  config_path?: string;
  config: Record<string, unknown>;
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

// === Model manifest (from `birda models manifest <id>`) ===

export interface ModelLicense {
  type: string; // SPDX id, e.g. "CC-BY-NC-SA-4.0"
  url: string;
  commercial_use: boolean;
  attribution_required: boolean;
  share_alike: boolean;
}

/** One downloadable variant (region + hardware) of a model family. */
export interface ManifestVariant {
  id: string;
  region?: string; // slug; absent for the global/legacy variant
  region_name?: string;
  group?: string; // continent slug
  group_name?: string;
  group_order: number;
  classes?: number;
  size_bytes?: number;
  model_url: string;
  labels_url: string;
  coverage_url?: string; // region coverage map (SVG); absent for global/legacy
  countries?: { core: string[]; partial: string[] };
}

/** Projected manifest for one model family. */
export interface ModelManifest {
  id: string;
  name: string;
  version: string;
  build?: number;
  model_type: string;
  license: ModelLicense;
  default_variant?: string;
  selection: Record<string, string>;
  variants: ManifestVariant[];
}

/** What birda:models-install was asked to install. */
export interface ModelInstallRequest {
  id: string;
  region?: string | undefined;
  variant?: string | undefined;
}

/** Sent to every window on birda:models-install-finished when an install settles. */
export interface ModelInstallFinished {
  request: ModelInstallRequest;
  outcome: 'installed' | 'cancelled' | 'failed';
  error?: string | undefined;
}

/** Structured install progress parsed from birda's stderr progress bar. */
export interface ModelInstallProgress {
  line: string;
  percent?: number;
  bytesDone?: number;
  bytesTotal?: number;
}

export interface AppSettings {
  birda_path: string;
  clip_output_dir: string;
  db_path: string;
  default_confidence: number;
  default_execution_provider: string;
  default_freq_max: number;
  default_spectrogram_height: number;
  species_language: string;
  ui_language: string;
  /** Zone last chosen for file name timestamps; '' means the system zone. */
  filename_timezone: string;
  theme: 'system' | 'light' | 'dark';
  setup_completed: boolean;
}

// === Catalog Stats ===

export interface CatalogStats {
  total_detections: number;
  total_species: number;
  /** Locations with detections from finished runs. */
  total_locations: number;
  /** Every saved location, including those without detections, as Clear Database deletes them. */
  saved_locations: number;
  /** Every analysis run, whatever its status. */
  total_runs: number;
}

export interface ClearDatabaseResult {
  detections: number;
  runs: number;
  locations: number;
  annotations: number;
  /** Where the pre-clear copy of the catalog was saved. */
  backup_path: string;
}

export interface DatabaseHealthResult {
  integrity_ok: boolean;
  integrity_message: string;
  file_size_bytes: number;
  page_count: number;
  page_size: number;
  wal_mode: boolean;
  freelist_count: number;
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
  // 'locked' means another worker held the per-file lock, so birda skipped the
  // file rather than failing it (birda's FileStatus::Locked). Treat it as a skip.
  status: 'processed' | 'failed' | 'skipped' | 'locked';
  /** Absent when the file failed or was skipped. */
  detections?: number;
  /** Absent when the file failed or was skipped. */
  duration_ms?: number;
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

// === Model operation results (from birda CLI JSON output) ===

/** Result payload from `birda --output-mode json models remove` */
export interface ModelRemovedResult {
  id: string;
  purge_requested: boolean;
  new_default: string | null;
}

/** Result payload from `birda --output-mode json models install` */
export interface ModelInstalledResult {
  id: string;
  set_as_default: boolean;
  model_path: string;
  labels_path: string;
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
  /** Model whose range model is preferred; another is used when it has none. */
  model?: string | undefined;
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
  /** Model whose range model produced the list; set by the GUI, not by birda. */
  model_used?: string | undefined;
}
