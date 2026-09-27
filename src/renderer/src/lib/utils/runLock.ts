import * as m from '$paraglide/messages';
import { appState } from '$lib/stores/app.svelte';

/** The title for a control that is unavailable while an analysis runs, else the given one. */
export function lockedTitle(otherwise?: string): string | undefined {
  return appState.isAnalysisRunning ? m.analysis_lockedDuringRun() : otherwise;
}
