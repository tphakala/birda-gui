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
  import { appState } from '$lib/stores/app.svelte';
  import {
    analysisState,
    handleAnalysisEvent,
    resetAnalysis,
    type BirdaEventEnvelope,
  } from '$lib/stores/analysis.svelte';
  import { addLog, type LogEntry } from '$lib/stores/log.svelte';
  import {
    getCatalogStats,
    getSettings,
    listModels,
    startAnalysis,
    cancelAnalysis,
    getAnalysisStatus,
    onAnalysisProgress,
    onAnalysisState,
    onLog,
    offLog,
    onSetupWizard,
    offSetupWizard,
    onShowLicenses,
    offShowLicenses,
  } from '$lib/utils/ipc';
  import { setupMenuListeners, isTab } from '$lib/utils/shortcuts';
  import { onMount, onDestroy } from 'svelte';
  import type { AnalysisStatus } from '$shared/types';

  let cleanupMenu: (() => void) | null = null;
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
    try {
      appState.catalogStats = await getCatalogStats();
    } catch {
      // DB may not be ready
    }
    showWizard = false;
  }

  // True while this window's startAnalysis call is pending. A window reloaded
  // during an analysis has no such call, so the analysis state events end it.
  let startPending = false;

  function applyAnalysisStatus(status: AnalysisStatus) {
    appState.isAnalysisRunning = status.state !== 'idle';
    appState.isAnalysisStopping = status.state === 'stopping';
    if (startPending) return;
    if (status.state !== 'idle' && analysisState.status === 'idle') {
      analysisState.status = 'running';
    } else if (status.state === 'idle' && analysisState.status === 'running') {
      analysisState.status = 'idle';
      getCatalogStats()
        .then((stats) => {
          appState.catalogStats = stats;
        })
        .catch(() => {
          // Stats refresh on the next catalog change
        });
    }
  }

  // Start stays disabled until the analysis has actually ended: the main
  // process keeps its lock until the stopped birda process exits.
  async function handleStop() {
    appState.isAnalysisStopping = true;
    try {
      const wasRunning = await cancelAnalysis();
      if (!wasRunning && !startPending) {
        appState.isAnalysisRunning = false;
        appState.isAnalysisStopping = false;
      }
    } catch {
      // Let the user try Stop again
      appState.isAnalysisStopping = false;
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
    if (!appState.sourcePath || appState.isAnalysisRunning) return;

    resetAnalysis();
    appState.isAnalysisRunning = true;
    startPending = true;

    try {
      const result = await startAnalysis({
        source_path: appState.sourcePath,
        model: appState.selectedModel,
        min_confidence: appState.analysisConfidence,
        latitude: opts.latitude || undefined,
        longitude: opts.longitude || undefined,
        location_name: opts.locationName || undefined,
        month: opts.month,
        day: opts.day,
        timezone_offset_min: opts.timezoneOffsetMin,
      });
      if (result.status === 'cancelled' || result.runId === null) {
        // A stopped run keeps its partial results in the catalog, marked cancelled
        analysisState.status = 'idle';
        appState.catalogStats = await getCatalogStats();
        return;
      }
      analysisState.status = 'completed';
      appState.lastRunId = result.runId;
      appState.lastSourceFile = appState.sourcePath;
      appState.selectedRunId = result.runId;
      appState.activeTab = 'detections';
      appState.catalogStats = await getCatalogStats();
    } catch (err) {
      analysisState.status = 'failed';
      analysisState.error = (err as Error).message;
    } finally {
      startPending = false;
      appState.isAnalysisRunning = false;
      appState.isAnalysisStopping = false;
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

      try {
        appState.catalogStats = await getCatalogStats();
      } catch {
        // DB not ready yet
      }
    })();

    onSetupWizard(() => {
      showWizard = true;
    });

    onShowLicenses(() => {
      showLicenses = true;
    });

    cleanupMenu = setupMenuListeners({
      onOpenFile: (path: string) => {
        appState.sourcePath = path;
      },
      onFocusSearch: () => {
        // The visible species search that is not behind the annotation editor.
        const inputs = document.querySelectorAll<HTMLInputElement>('input[data-focus-search]');
        [...inputs].find((input) => input.checkVisibility() && !input.closest('[inert]'))?.focus();
      },
    });

    // One progress listener for the window's lifetime, so a Stop then Start
    // never leaves two listeners counting the same events.
    const offAnalysisProgress = onAnalysisProgress((envelope) => {
      handleAnalysisEvent(envelope as BirdaEventEnvelope);
    });
    const offAnalysisState = onAnalysisState(applyAnalysisStatus);
    // Pick up an analysis that was already running when this window loaded.
    getAnalysisStatus()
      .then(applyAnalysisStatus)
      .catch(() => {
        // Assume idle
      });

    onLog((entry) => {
      const { level, source, message } = entry as { level: LogEntry['level']; source: string; message: string };
      addLog(level, source, message);
    });

    return () => {
      mediaQuery.removeEventListener('change', handler);
      offAnalysisProgress();
      offAnalysisState();
    };
  });

  $effect(() => {
    // Determine effective theme and apply daisyUI data-theme attribute
    const isDark = appState.theme === 'dark' || (appState.theme === 'system' && systemPrefersDark);
    document.documentElement.setAttribute('data-theme', isDark ? 'birda-dark' : 'birda-light');
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  });

  onDestroy(() => {
    offLog();
    offSetupWizard();
    offShowLicenses();
    cleanupMenu?.();
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
