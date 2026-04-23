export type Tab = 'analysis' | 'detections' | 'map' | 'species' | 'settings';

export const appState = $state({
  activeTab: 'analysis',
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
  },
  birdaAvailable: null as boolean | null,
  showLogPanel: false,
  lastRunId: null as number | null,
  lastSourceFile: null as string | null,
  selectedRunId: null as number | null,
  theme: 'system',
  settingsHasUnsavedChanges: false,
  selectedSpeciesListId: null as number | null,
});
