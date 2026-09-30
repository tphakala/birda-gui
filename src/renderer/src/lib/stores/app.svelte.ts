import { checkBirda, getCatalogStats } from '$lib/utils/ipc';
import { latestRequest } from '$lib/utils/latest';
import { tabSwitch, type Tab } from '$lib/utils/navigation';
import type { BirdaCheckResponse, CatalogStats, RunningAnalysisSettings } from '$shared/types';

export type { Tab };

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
  /** A new default confidence saved while an analysis runs; applied to the slider once it ends. */
  pendingConfidence: number | null;
  catalogStats: CatalogStats;
  /** The last birda CLI check; null until the first one answers. */
  birdaStatus: BirdaCheckResponse | null;
  showLogPanel: boolean;
  lastRunId: number | null;
  lastSourceFile: string | null;
  selectedRunId: number | null;
  theme: 'system' | 'light' | 'dark';
  settingsHasUnsavedChanges: boolean;
  /** A tab the user asked for while Settings has unsaved changes; the sidebar asks before leaving. */
  pendingTab: Tab | null;
  /** A species list the Species page asked Detections to filter by; Detections takes it once and clears it. */
  listFilterRequest: number | null;
  /** Bumped whenever the catalog's runs change (an analysis ends, a run is deleted, the catalog is cleared), so views that show runs reload them. */
  runsVersion: number;
  /** Bumped whenever the species lists change (one is created, saved or deleted, or the catalog is cleared), so views that show lists reload them. */
  speciesListsVersion: number;
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
  pendingConfidence: null,
  catalogStats: {
    total_detections: 0,
    total_species: 0,
    total_locations: 0,
    saved_locations: 0,
    total_runs: 0,
  },
  birdaStatus: null,
  showLogPanel: false,
  lastRunId: null,
  lastSourceFile: null,
  selectedRunId: null,
  theme: 'system',
  settingsHasUnsavedChanges: false,
  pendingTab: null,
  listFilterRequest: null,
  runsVersion: 0,
  speciesListsVersion: 0,
  joinedSettings: null,
});

/** The catalog's runs changed: views that show runs reload, and so do the status bar counts. */
export function catalogChanged(): void {
  appState.runsVersion++;
  void refreshCatalogStats();
}

/** The species lists changed: views that show lists reload them, and drop a selection or filter that names a list that is gone. */
export function speciesListsChanged(): void {
  appState.speciesListsVersion++;
}

/** Opens a tab, or asks first when leaving Settings would discard unsaved changes. */
export function requestTab(tab: Tab): void {
  const action = tabSwitch(appState.activeTab, tab, appState.settingsHasUnsavedChanges);
  if (action === 'switch') appState.activeTab = tab;
  else if (action === 'confirm') appState.pendingTab = tab;
}

/** Reloads the status bar counts. A failure keeps the last counts; they refresh on the next change. */
export async function refreshCatalogStats(): Promise<void> {
  try {
    appState.catalogStats = await getCatalogStats();
  } catch {
    // Keep the last counts
  }
}

const birdaStatusRequest = latestRequest();

/** Checks the birda CLI again and stores the result; the newest check wins. A check that cannot run is stored as unavailable. */
export async function refreshBirdaStatus(): Promise<void> {
  const isCurrent = birdaStatusRequest();
  let status: BirdaCheckResponse;
  try {
    status = await checkBirda();
  } catch (e) {
    status = { available: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (isCurrent()) appState.birdaStatus = status;
}
