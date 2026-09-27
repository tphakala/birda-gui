import { getCatalogStats } from '$lib/utils/ipc';
import type { RunningAnalysisSettings } from '$shared/types';

export type Tab = 'analysis' | 'detections' | 'map' | 'species' | 'settings';

interface AppState {
  activeTab: Tab;
  selectedSpecies: string | null;
  isAnalysisRunning: boolean;
  /** Stop was requested and the analysis has not ended yet. */
  isAnalysisStopping: boolean;
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
  theme: 'system' | 'light' | 'dark';
  settingsHasUnsavedChanges: boolean;
  selectedSpeciesListId: number | null;
  /** Bumped whenever the catalog's runs change (an analysis ends, a run is deleted, the catalog is cleared), so views that show runs reload them. */
  runsVersion: number;
  /** Settings of a running analysis this window joined; the analysis page takes them over once. */
  joinedSettings: RunningAnalysisSettings | null;
}

export const appState = $state<AppState>({
  activeTab: 'analysis',
  selectedSpecies: null,
  isAnalysisRunning: false,
  isAnalysisStopping: false,
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
  runsVersion: 0,
  joinedSettings: null,
});

/** The catalog's runs changed: views that show runs reload, and so do the status bar counts. */
export function catalogChanged(): void {
  appState.runsVersion++;
  void refreshCatalogStats();
}

/** Reloads the status bar counts. A failure keeps the last counts; they refresh on the next change. */
export async function refreshCatalogStats(): Promise<void> {
  try {
    appState.catalogStats = await getCatalogStats();
  } catch {
    // Keep the last counts
  }
}
