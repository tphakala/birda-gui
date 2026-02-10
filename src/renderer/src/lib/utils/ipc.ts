import type {
  AnalysisRequest,
  EnrichedDetection,
  DetectionFilter,
  EnrichedSpeciesSummary,
  RunSpeciesAggregation,
  HourlyDetectionCell,
  Location,
  InstalledModel,
  AvailableModel,
  AppSettings,
  CatalogStats,
  SourceScanResult,
  RunWithStats,
  SpeciesList,
  EnrichedSpeciesListEntry,
  SpeciesFetchRequest,
  BirdaSpeciesResponse,
} from '$shared/types';

declare global {
  interface Window {
    birda: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, callback: (...args: unknown[]) => void) => void;
      removeAllListeners: (channel: string) => void;
    };
  }
}

// Analysis
export function startAnalysis(request: AnalysisRequest): Promise<{ runId: number; status: string }> {
  return window.birda.invoke('birda:analyze', request) as Promise<{ runId: number; status: string }>;
}

export function cancelAnalysis(): Promise<boolean> {
  return window.birda.invoke('birda:cancel-analysis') as Promise<boolean>;
}

export function onAnalysisProgress(callback: (envelope: unknown) => void): void {
  window.birda.on('birda:analysis-progress', callback);
}

export function offAnalysisProgress(): void {
  window.birda.removeAllListeners('birda:analysis-progress');
}

// Catalog
export function getRuns(): Promise<RunWithStats[]> {
  return window.birda.invoke('catalog:get-runs') as Promise<RunWithStats[]>;
}

export function deleteRun(id: number): Promise<void> {
  return window.birda.invoke('catalog:delete-run', id) as Promise<void>;
}

export function getDetections(filter: DetectionFilter): Promise<{ detections: EnrichedDetection[]; total: number }> {
  return window.birda.invoke('catalog:get-detections', filter) as Promise<{
    detections: EnrichedDetection[];
    total: number;
  }>;
}

export function getRunSpecies(filter: DetectionFilter): Promise<RunSpeciesAggregation[]> {
  return window.birda.invoke('catalog:get-run-species', filter) as Promise<RunSpeciesAggregation[]>;
}

export function getHourlyDetections(filter: DetectionFilter): Promise<HourlyDetectionCell[]> {
  return window.birda.invoke('catalog:get-hourly-detections', filter) as Promise<HourlyDetectionCell[]>;
}

export function searchSpecies(query: string): Promise<EnrichedSpeciesSummary[]> {
  return window.birda.invoke('catalog:search-species', query) as Promise<EnrichedSpeciesSummary[]>;
}

export function getSpeciesLocations(
  scientificName: string,
): Promise<
  { location_id: number; latitude: number; longitude: number; name: string | null; detection_count: number }[]
> {
  return window.birda.invoke('catalog:species-locations', scientificName) as Promise<
    { location_id: number; latitude: number; longitude: number; name: string | null; detection_count: number }[]
  >;
}

export function getLocations(): Promise<Location[]> {
  return window.birda.invoke('catalog:get-locations') as Promise<Location[]>;
}

export function getLocationsWithCounts(): Promise<(Location & { detection_count: number; species_count: number })[]> {
  return window.birda.invoke('catalog:get-locations-with-counts') as Promise<
    (Location & { detection_count: number; species_count: number })[]
  >;
}

export function getCatalogStats(): Promise<CatalogStats> {
  return window.birda.invoke('catalog:stats') as Promise<CatalogStats>;
}

// Database maintenance
export function clearDatabase(): Promise<{ detections: number; runs: number; locations: number }> {
  return window.birda.invoke('catalog:clear-database') as Promise<{
    detections: number;
    runs: number;
    locations: number;
  }>;
}

// Models
export function listModels(): Promise<InstalledModel[]> {
  return window.birda.invoke('birda:models-list') as Promise<InstalledModel[]>;
}

export function listAvailableModels(): Promise<AvailableModel[]> {
  return window.birda.invoke('birda:models-available') as Promise<AvailableModel[]>;
}

export function installModel(name: string): Promise<string> {
  return window.birda.invoke('birda:models-install', name) as Promise<string>;
}

// Settings
export function getSettings(): Promise<AppSettings> {
  return window.birda.invoke('app:get-settings') as Promise<AppSettings>;
}

export function setSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return window.birda.invoke('app:set-settings', settings) as Promise<AppSettings>;
}

export function checkBirda(): Promise<{ available: boolean; path?: string; error?: string }> {
  return window.birda.invoke('app:check-birda') as Promise<{ available: boolean; path?: string; error?: string }>;
}

export function getBirdaConfig(): Promise<Record<string, unknown>> {
  return window.birda.invoke('birda:config-show') as Promise<Record<string, unknown>>;
}

// File system
export function openFileDialog(): Promise<string | null> {
  return window.birda.invoke('fs:open-file-dialog') as Promise<string | null>;
}

export function openExecutableDialog(): Promise<string | null> {
  return window.birda.invoke('fs:open-executable-dialog') as Promise<string | null>;
}

export function openFolderDialog(defaultPath?: string): Promise<string | null> {
  return window.birda.invoke('fs:open-folder-dialog', defaultPath) as Promise<string | null>;
}

export function openInExplorer(folderPath: string): Promise<void> {
  return window.birda.invoke('fs:open-in-explorer', folderPath) as Promise<void>;
}

export function scanSource(sourcePath: string): Promise<SourceScanResult> {
  return window.birda.invoke('fs:scan-source', sourcePath) as Promise<SourceScanResult>;
}

export function readCoordinates(folderPath: string): Promise<{ latitude: number; longitude: number } | null> {
  return window.birda.invoke('fs:read-coordinates', folderPath) as Promise<{
    latitude: number;
    longitude: number;
  } | null>;
}

// Log
export function onLog(callback: (entry: { level: string; source: string; message: string }) => void): void {
  window.birda.on('app:log', callback as (...args: unknown[]) => void);
}

export function offLog(): void {
  window.birda.removeAllListeners('app:log');
}

// Clip extraction
export function extractClip(
  detectionId: number,
  sourceFile: string,
  startTime: number,
  endTime: number,
  outputDir: string,
): Promise<string> {
  return window.birda.invoke(
    'birda:extract-clip',
    detectionId,
    sourceFile,
    startTime,
    endTime,
    outputDir,
  ) as Promise<string>;
}

// Labels
export function getAvailableLanguages(): Promise<{ code: string; name: string }[]> {
  return window.birda.invoke('labels:available-languages') as Promise<{ code: string; name: string }[]>;
}

export function searchByCommonName(query: string): Promise<string[]> {
  return window.birda.invoke('labels:search-by-common-name', query) as Promise<string[]>;
}

export function resolveAllLabels(scientificNames: string[]): Promise<Record<string, string>> {
  return window.birda.invoke('labels:resolve-all', scientificNames) as Promise<Record<string, string>>;
}

// Model install progress
export function onModelInstallProgress(callback: (line: string) => void): void {
  window.birda.on('birda:models-install-progress', callback as (...args: unknown[]) => void);
}

export function offModelInstallProgress(): void {
  window.birda.removeAllListeners('birda:models-install-progress');
}

// Menu events
export function onSetupWizard(callback: () => void): void {
  window.birda.on('menu:setup-wizard', callback as (...args: unknown[]) => void);
}

export function offSetupWizard(): void {
  window.birda.removeAllListeners('menu:setup-wizard');
}

// Region export
export function exportRegionAsWav(wavBytes: Uint8Array, defaultName?: string): Promise<string | null> {
  // Chunked base64 encoding to avoid stack overflow on large arrays
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < wavBytes.length; i += chunkSize) {
    binary += String.fromCharCode(...wavBytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return window.birda.invoke('clip:export-region', base64, defaultName) as Promise<string | null>;
}

// Licenses
export function getLicenses(): Promise<string | null> {
  return window.birda.invoke('app:get-licenses') as Promise<string | null>;
}

export function onShowLicenses(callback: () => void): void {
  window.birda.on('menu:show-licenses', callback as (...args: unknown[]) => void);
}

export function offShowLicenses(): void {
  window.birda.removeAllListeners('menu:show-licenses');
}

// Species Lists
export function fetchSpeciesList(request: SpeciesFetchRequest): Promise<BirdaSpeciesResponse> {
  return window.birda.invoke('species:fetch', request) as Promise<BirdaSpeciesResponse>;
}

export function saveSpeciesList(name: string, response: BirdaSpeciesResponse): Promise<SpeciesList> {
  return window.birda.invoke('species:save-list', name, response) as Promise<SpeciesList>;
}

export function createCustomSpeciesList(
  name: string,
  scientificNames: string[],
  description?: string,
): Promise<SpeciesList> {
  return window.birda.invoke('species:create-custom-list', name, scientificNames, description) as Promise<SpeciesList>;
}

export function getSpeciesLists(): Promise<SpeciesList[]> {
  return window.birda.invoke('species:get-lists') as Promise<SpeciesList[]>;
}

export function getSpeciesListEntries(listId: number): Promise<EnrichedSpeciesListEntry[]> {
  return window.birda.invoke('species:get-entries', listId) as Promise<EnrichedSpeciesListEntry[]>;
}

export function deleteSpeciesListById(id: number): Promise<void> {
  return window.birda.invoke('species:delete-list', id) as Promise<void>;
}

// Spectrogram cache
export function saveSpectrogram(clipPath: string, freqMax: number, height: number, dataUrl: string): Promise<string> {
  return window.birda.invoke('clip:save-spectrogram', clipPath, freqMax, height, dataUrl) as Promise<string>;
}
