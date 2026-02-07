import type { CatalogStats } from '$shared/types';

export type Tab = 'analysis' | 'detections' | 'map' | 'settings';

export const appState = $state({
  activeTab: 'analysis' as Tab,
  selectedSpecies: null as string | null,
  isAnalysisRunning: false,
  sourcePath: null as string | null,
  selectedModel: 'birdnet-v24',
  minConfidence: 0.5,
  analysisConfidence: 0.1,
  catalogStats: {
    total_detections: 0,
    total_species: 0,
    total_locations: 0,
  } as CatalogStats,
  birdaAvailable: null as boolean | null,
  showLogPanel: false,
  lastRunId: null as number | null,
  lastSourceFile: null as string | null,
  theme: 'system' as 'system' | 'light' | 'dark',
  settingsHasUnsavedChanges: false,
});
