export type Tab = 'analysis' | 'detections' | 'map' | 'species' | 'settings';

export interface AppState {
  activeTab: string;
  selectedSpecies: string | null;
  isAnalysisRunning: boolean;
  sourcePath: string | null;
  selectedModel: string;
  minConfidence: number;
  analysisConfidence: number;
  catalogStats: {
    total_detections: number;
    total_species: number;
    total_locations: number;
  };
  birdaAvailable: boolean | null;
  showLogPanel: boolean;
  lastRunId: number | null;
  lastSourceFile: string | null;
  selectedRunId: number | null;
  theme: string;
  settingsHasUnsavedChanges: boolean;
  selectedSpeciesListId: number | null;
}

export const appState = $state<AppState>({
  activeTab: 'analysis',
  selectedSpecies: null,
  isAnalysisRunning: false,
  sourcePath: null,
  selectedModel: 'birdnet-v24',
  minConfidence: 0.5,
  analysisConfidence: 0.1,
  catalogStats: {
    total_detections: 0,
    total_species: 0,
    total_locations: 0,
  },
  birdaAvailable: null,
  showLogPanel: false,
  lastRunId: null,
  lastSourceFile: null,
  selectedRunId: null,
  theme: 'system',
  settingsHasUnsavedChanges: false,
  selectedSpeciesListId: null,
});
