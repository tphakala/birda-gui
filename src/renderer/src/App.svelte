<script lang="ts">
  import Sidebar from '$lib/components/Sidebar.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import ProgressPanel from '$lib/components/ProgressPanel.svelte';
  import LogPanel from '$lib/components/LogPanel.svelte';
  import SetupWizard from '$lib/components/SetupWizard.svelte';
  import AnalysisPage from './pages/AnalysisPage.svelte';
  import DetectionsPage from './pages/DetectionsPage.svelte';
  import MapPage from './pages/MapPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';
  import { appState } from '$lib/stores/app.svelte';
  import {
    analysisState,
    handleAnalysisEvent,
    resetAnalysis,
    type BirdaEventEnvelope,
  } from '$lib/stores/analysis.svelte';
  import { addLog, type LogEntry } from '$lib/stores/log.svelte';
  import { loadDetections } from '$lib/stores/catalog.svelte';
  import {
    getCatalogStats,
    getSettings,
    startAnalysis,
    cancelAnalysis,
    onAnalysisProgress,
    offAnalysisProgress,
    onLog,
    offLog,
    onSetupWizard,
    offSetupWizard,
  } from '$lib/utils/ipc';
  import { setupMenuListeners } from '$lib/utils/shortcuts';
  import { onMount, onDestroy } from 'svelte';

  let cleanupMenu: (() => void) | null = null;
  let showWizard = $state<boolean | null>(null); // null = loading, true/false = resolved

  async function handleWizardComplete() {
    try {
      const settings = await getSettings();
      appState.theme = settings.theme;
      appState.analysisConfidence = settings.default_confidence;
      if (settings.default_model) {
        appState.selectedModel = settings.default_model;
      }
    } catch {
      // proceed with existing state
    }
    try {
      appState.catalogStats = await getCatalogStats();
    } catch {
      // DB may not be ready
    }
    showWizard = false;
  }

  async function handleStop() {
    try {
      await cancelAnalysis();
    } catch {
      // Ensure UI recovers even if cancel IPC fails
    }
    appState.isAnalysisRunning = false;
  }

  async function handleStartAnalysis(opts: {
    locationName: string;
    latitude: number;
    longitude: number;
    month?: number | undefined;
    day?: number | undefined;
  }) {
    if (!appState.sourcePath) return;

    resetAnalysis();
    appState.isAnalysisRunning = true;

    onAnalysisProgress((envelope) => {
      handleAnalysisEvent(envelope as BirdaEventEnvelope);
    });

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
      });
      analysisState.status = 'completed';
      appState.lastRunId = result.runId;
      appState.lastSourceFile = appState.sourcePath;
      appState.activeTab = 'analysis';
      appState.catalogStats = await getCatalogStats();
      await loadDetections();
    } catch (err) {
      analysisState.status = 'failed';
      analysisState.error = (err as Error).message;
    } finally {
      appState.isAnalysisRunning = false;
      offAnalysisProgress();
    }
  }

  let systemPrefersDark = $state(false);

  onMount(() => {
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
        if (settings.default_model) {
          appState.selectedModel = settings.default_model;
        }
        showWizard = !settings.setup_completed;
      } catch {
        // Failed to load settings — show wizard as fallback
        showWizard = true;
      }

      try {
        appState.catalogStats = await getCatalogStats();
      } catch {
        // DB not ready yet
      }
    })();

    onSetupWizard(() => {
      showWizard = true;
    });

    cleanupMenu = setupMenuListeners({
      onOpenFile: (path: string) => {
        appState.sourcePath = path;
      },
      onFocusSearch: () => {
        const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="species"]');
        searchInput?.focus();
      },
    });

    onLog((entry) => {
      const { level, source, message } = entry as { level: LogEntry['level']; source: string; message: string };
      addLog(level, source, message);
    });

    return () => {
      mediaQuery.removeEventListener('change', handler);
    };
  });

  $effect(() => {
    // Determine effective theme and apply daisyUI data-theme attribute
    const isDark = appState.theme === 'dark' || (appState.theme === 'system' && systemPrefersDark);
    document.documentElement.setAttribute('data-theme', isDark ? 'birda-dark' : 'birda-light');
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  });

  onDestroy(() => {
    offAnalysisProgress();
    offLog();
    offSetupWizard();
    cleanupMenu?.();
  });
</script>

{#if showWizard === null}
  <!-- Loading settings, show nothing -->
  <main class="bg-base-100 flex h-screen select-none"></main>
{:else if showWizard}
  <main class="bg-base-100 text-base-content h-screen select-none">
    <SetupWizard oncomplete={handleWizardComplete} />
  </main>
{:else}
  <main class="bg-base-100 text-base-content flex h-screen select-none">
    <Sidebar />

    <div class="flex flex-1 flex-col overflow-hidden">
      <div class="flex flex-1 flex-col overflow-hidden">
        {#if appState.activeTab === 'analysis'}
          <AnalysisPage onstart={handleStartAnalysis} onstop={handleStop} />
        {:else if appState.activeTab === 'detections'}
          <DetectionsPage />
        {:else if appState.activeTab === 'map'}
          <MapPage />
        {:else if appState.activeTab === 'settings'}
          <SettingsPage />
        {/if}
      </div>

      <ProgressPanel />
      <LogPanel />
      <StatusBar />
    </div>
  </main>
{/if}
