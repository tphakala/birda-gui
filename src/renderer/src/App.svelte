<script lang="ts">
  import * as m from '$paraglide/messages';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import ProgressPanel from '$lib/components/ProgressPanel.svelte';
  import LogPanel from '$lib/components/LogPanel.svelte';
  import SetupWizard from '$lib/components/SetupWizard.svelte';
  import LicenseViewer from '$lib/components/LicenseViewer.svelte';
  import AnnotationEditor from '$lib/components/AnnotationEditor.svelte';
  import { annotationEditor } from '$lib/stores/annotation.svelte';
  import ToastOutlet from '$lib/components/ToastOutlet.svelte';
  import AnalysisPage from './pages/AnalysisPage.svelte';
  import DetectionsPage from './pages/DetectionsPage.svelte';
  import MapPage from './pages/MapPage.svelte';
  import SpeciesPage from './pages/SpeciesPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';
  import { appState, refreshCatalogStats } from '$lib/stores/app.svelte';
  import { showToast } from '$lib/stores/toast.svelte';
  import { followModelInstalls } from '$lib/stores/modelInstall.svelte';
  import {
    analysisState,
    handleAnalysisEvent,
    joinRunningAnalysis,
    resetAnalysis,
    type BirdaEventEnvelope,
  } from '$lib/stores/analysis.svelte';
  import { addLog, type LogEntry } from '$lib/stores/log.svelte';
  import {
    getSettings,
    listModels,
    startAnalysis,
    cancelAnalysis,
    getAnalysisStatus,
    onAnalysisProgress,
    onAnalysisStatusChanged,
    onLog,
    onSetupWizard,
    onShowLicenses,
  } from '$lib/utils/ipc';
  import { setupMenuListeners, isTab } from '$lib/utils/shortcuts';
  import { onMount } from 'svelte';
  import type { AnalysisResult, AnalysisStatus } from '$shared/types';

  let showWizard = $state<boolean | null>(null); // null = loading, true/false = resolved
  let showLicenses = $state(false);

  /** Sync appState.selectedModel from birda CLI's is_default flag. */
  async function syncDefaultModel(): Promise<void> {
    try {
      const models = await listModels();
      const defaultModel = models.find((m) => m.is_default);
      appState.selectedModel = defaultModel?.id ?? '';
    } catch {
      // birda may not be available yet
    }
  }

  // Track which expensive tabs have been visited (lazy keep-alive)
  const visited = $state({ detections: false, map: false, species: false });

  $effect(() => {
    const tab = appState.activeTab;
    if (tab in visited) {
      visited[tab as keyof typeof visited] = true;
    }
  });

  // Kept-alive pages are hidden, not unmounted, on a tab switch. A modal
  // dialog left open inside one would stay modal while invisible and block
  // the whole window, so close it; its close event resets its own state.
  $effect(() => {
    const _tab = appState.activeTab; // re-run on every tab switch
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) {
      if (!dialog.checkVisibility()) dialog.close();
    }
  });

  async function handleWizardComplete() {
    try {
      const settings = await getSettings();
      appState.theme = settings.theme;
      appState.analysisConfidence = settings.default_confidence;
    } catch {
      // proceed with existing state
    }
    await syncDefaultModel();
    await refreshCatalogStats();
    showWizard = false;
  }

  // True while this window's startAnalysis call is pending. That call owns the
  // running flags until it settles; status events only drive a window that did
  // not start the analysis, for example one reloaded mid-run.
  let startPending = false;
  // Set once this window has shown the outcome of its own analysis, so the idle
  // status event for it (which may arrive after the start call settles) is not
  // shown a second time. Cleared when the next analysis starts.
  let shownOwnOutcome = false;

  type Outcome = AnalysisResult & { error?: string | undefined };

  /** Shows how an analysis ended and reloads what it changed in the catalog. */
  function showOutcome(outcome: Outcome) {
    if (outcome.status === 'cancelled') {
      analysisState.status = 'idle';
      if (outcome.runId === null) showToast(m.analysis_stopped());
      else if (outcome.discardedPartial) showToast(m.analysis_stoppedDiscarded());
      else showToast(m.analysis_stoppedKept());
    } else if (outcome.status === 'failed') {
      analysisState.status = 'failed';
      // A returned failure is a run in which no file was analysed or imported.
      analysisState.error = outcome.error ?? m.analysis_allFilesFailed();
    } else {
      analysisState.status = 'completed';
    }
    appState.runsVersion++;
    void refreshCatalogStats();
  }

  function applyAnalysisStatus(status: AnalysisStatus) {
    if (startPending) return;
    if (status.state !== 'idle') shownOwnOutcome = false;
    else if (shownOwnOutcome) return;
    appState.isAnalysisRunning = status.state !== 'idle';
    appState.isAnalysisStopping = status.state === 'stopping';
    if (status.state !== 'idle') {
      // Joining a running analysis: show its source, so Stop is on screen, and its counts so far.
      appState.sourcePath ??= status.sourcePath;
      if (analysisState.status === 'idle') joinRunningAnalysis(status.progress);
    } else if (status.finished && analysisState.status !== 'idle') {
      // The panel may already say complete from birda's pipeline_completed event.
      showOutcome(status.finished);
    } else if (status.finished) {
      appState.runsVersion++;
      void refreshCatalogStats();
    }
  }

  // Start stays unavailable until the analysis has finished: the main process
  // keeps its lock until then.
  async function handleStop() {
    appState.isAnalysisStopping = true;
    try {
      const wasRunning = await cancelAnalysis();
      if (!wasRunning && !startPending) {
        appState.isAnalysisRunning = false;
        appState.isAnalysisStopping = false;
      }
    } catch {
      appState.isAnalysisStopping = false;
      showToast(m.analysis_stopFailed(), { severity: 'error' });
    }
  }

  async function handleStartAnalysis(opts: {
    locationName: string;
    latitude: number;
    longitude: number;
    month?: number | undefined;
    day?: number | undefined;
    timezoneOffsetMin?: number | undefined;
  }) {
    const sourcePath = appState.sourcePath;
    if (!sourcePath || appState.isAnalysisRunning) return;

    resetAnalysis();
    appState.isAnalysisRunning = true;
    startPending = true;
    shownOwnOutcome = false;
    // Set when the start was refused because another analysis holds the lock,
    // and this window joined that one instead.
    let joined = false;

    try {
      const result = await startAnalysis({
        source_path: sourcePath,
        model: appState.selectedModel,
        min_confidence: appState.analysisConfidence,
        latitude: opts.latitude || undefined,
        longitude: opts.longitude || undefined,
        location_name: opts.locationName || undefined,
        month: opts.month,
        day: opts.day,
        timezone_offset_min: opts.timezoneOffsetMin,
      });
      showOutcome(result);
      shownOwnOutcome = true;
      if (result.runId !== null && (result.status === 'completed' || result.status === 'completed_with_errors')) {
        appState.lastRunId = result.runId;
        appState.lastSourceFile = sourcePath;
        appState.selectedRunId = result.runId;
        appState.activeTab = 'detections';
      }
    } catch (err) {
      // A window that did not know about a running analysis (its status reply
      // had not arrived yet) is refused by the lock: join that analysis instead.
      const current = await getAnalysisStatus().catch(() => null);
      if (current && current.state !== 'idle') {
        joined = true;
        startPending = false;
        applyAnalysisStatus(current);
      } else {
        showOutcome({ runId: null, status: 'failed', discardedPartial: false, error: (err as Error).message });
        shownOwnOutcome = true;
      }
    } finally {
      startPending = false;
      if (!joined) {
        appState.isAnalysisRunning = false;
        appState.isAnalysisStopping = false;
      }
    }
  }

  let systemPrefersDark = $state(false);

  onMount(() => {
    // Restore active tab after locale change reload
    const savedTab = sessionStorage.getItem('activeTabBeforeReload');
    if (isTab(savedTab)) {
      console.log('[App] Restoring activeTab from sessionStorage:', savedTab);
      appState.activeTab = savedTab;
      sessionStorage.removeItem('activeTabBeforeReload');
    }

    // Initial theme setup
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    systemPrefersDark = mediaQuery.matches;

    const handler = (e: MediaQueryListEvent) => {
      systemPrefersDark = e.matches;
    };
    mediaQuery.addEventListener('change', handler);

    // Async init (no cleanup needed from these)
    void (async () => {
      try {
        const settings = await getSettings();
        appState.theme = settings.theme;
        appState.analysisConfidence = settings.default_confidence;
        showWizard = !settings.setup_completed;
      } catch {
        // Failed to load settings — show wizard as fallback
        showWizard = true;
      }

      await syncDefaultModel();
      await refreshCatalogStats();
    })();

    const unsubscribes = [
      onSetupWizard(() => {
        showWizard = true;
      }),
      onShowLicenses(() => {
        showLicenses = true;
      }),
      setupMenuListeners({
        onOpenFile: (path: string) => {
          appState.sourcePath = path;
        },
        onFocusSearch: () => {
          // The visible species search that is not behind the annotation editor.
          const inputs = document.querySelectorAll<HTMLInputElement>('input[data-focus-search]');
          [...inputs].find((input) => input.checkVisibility() && !input.closest('[inert]'))?.focus();
        },
      }),
      // One progress listener for the window's lifetime, so a Stop then Start
      // never leaves two listeners counting the same events.
      onAnalysisProgress((envelope) => {
        handleAnalysisEvent(envelope as BirdaEventEnvelope);
      }),
      onAnalysisStatusChanged(applyAnalysisStatus),
      followModelInstalls(),
      onLog((entry) => {
        const { level, source, message } = entry as { level: LogEntry['level']; source: string; message: string };
        addLog(level, source, message);
      }),
    ];

    // Pick up an analysis that was already running when this window loaded.
    getAnalysisStatus()
      .then(applyAnalysisStatus)
      .catch(() => {
        // Assume idle
      });

    return () => {
      mediaQuery.removeEventListener('change', handler);
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  });

  $effect(() => {
    // Determine effective theme and apply daisyUI data-theme attribute
    const isDark = appState.theme === 'dark' || (appState.theme === 'system' && systemPrefersDark);
    document.documentElement.setAttribute('data-theme', isDark ? 'birda-dark' : 'birda-light');
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  });
</script>

{#if showWizard === null}
  <main class="bg-base-100 flex h-screen items-center justify-center select-none">
    <span class="loading loading-spinner loading-lg text-primary" role="status" aria-label={m.common_loading()}></span>
  </main>
{:else if showWizard}
  <main class="bg-base-100 text-base-content h-screen select-none">
    <SetupWizard oncomplete={handleWizardComplete} />
  </main>
{:else}
  <!-- The annotation editor overlays the app; keep the page behind it out of reach. -->
  <main class="bg-base-100 text-base-content flex h-screen select-none" inert={annotationEditor.open}>
    <Sidebar />

    <div class="flex flex-1 flex-col overflow-hidden">
      <!-- Lazy keep-alive: mount on first visit, then toggle via CSS -->
      {#if visited.detections}
        <div class="flex flex-1 flex-col overflow-hidden" class:hidden={appState.activeTab !== 'detections'}>
          <DetectionsPage />
        </div>
      {/if}
      {#if visited.map}
        <div class="flex flex-1 flex-col overflow-hidden" class:hidden={appState.activeTab !== 'map'}>
          <MapPage />
        </div>
      {/if}
      {#if visited.species}
        <div class="flex flex-1 flex-col overflow-hidden" class:hidden={appState.activeTab !== 'species'}>
          <SpeciesPage />
        </div>
      {/if}

      <!-- Conditionally rendered (cheap to recreate) -->
      {#if appState.activeTab === 'analysis'}
        <div class="flex flex-1 flex-col overflow-hidden">
          <AnalysisPage onstart={handleStartAnalysis} onstop={handleStop} />
        </div>
      {:else if appState.activeTab === 'settings'}
        <div class="flex flex-1 flex-col overflow-hidden">
          <SettingsPage />
        </div>
      {/if}

      <ProgressPanel />
      <LogPanel />
      <StatusBar />
    </div>
  </main>
{/if}

<LicenseViewer bind:open={showLicenses} />
<AnnotationEditor />
<ToastOutlet />
