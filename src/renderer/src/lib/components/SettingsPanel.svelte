<script lang="ts">
  import { focusIfLost, showModal } from '$lib/utils/dialog';
  import {
    Save,
    FolderOpen,
    FileCode,
    CircleCheckBig,
    CircleX,
    Loader,
    Trash,
    TriangleAlert,
    Database,
    Download,
    RefreshCw,
    X,
    ExternalLink,
    Info,
    ShieldCheck,
    Wrench,
  } from '@lucide/svelte';
  import {
    getSettings,
    setSettings,
    getBirdaConfig,
    openExecutableDialog,
    openFolderDialog,
    openInExplorer,
    getDataPath,
    checkDatabaseHealth,
    optimizeDatabase,
    vacuumDatabase,
    getAvailableLanguages,
    clearDatabase,
    detectGpuCapabilities,
    checkCudaStatus,
    downloadCudaLibs,
    cancelCudaDownload,
    removeCudaLibs,
    getCudaDownloadSize,
    onCudaDownloadProgress,
    onCudaDownloadFinished,
  } from '$lib/utils/ipc';
  import { formatFileSize } from '$lib/utils/format';
  import ModelGallery from '$lib/components/gallery/ModelGallery.svelte';
  import { appState, catalogChanged, refreshBirdaStatus, speciesListsChanged } from '$lib/stores/app.svelte';
  import { dismissAnalysis } from '$lib/stores/analysis.svelte';
  import type {
    AppSettings,
    CudaStatus,
    CudaDownloadProgress,
    DatabaseHealthResult,
    ClearDatabaseResult,
  } from '$shared/types';
  import { BIRDA_RELEASES_URL, BIRDA_CLI_VERSION } from '$shared/constants';
  import { onDestroy, onMount, tick } from 'svelte';
  import * as m from '$paraglide/messages';
  import { setLocale, isLocale } from '$paraglide/runtime';
  import { LANGUAGES } from '$lib/i18n/languages';

  // --- UI language options from central registry ---
  const uiLanguages = LANGUAGES;

  // --- Sub-tab state ---
  type SettingsTab = 'preferences' | 'models' | 'data';
  let activeSubTab = $state<SettingsTab>('preferences');

  const subTabs: { id: SettingsTab; label: string }[] = [
    { id: 'preferences', label: m.settings_tab_preferences() },
    { id: 'models', label: m.settings_tab_models() },
    { id: 'data', label: m.settings_tab_data() },
  ];

  // --- Settings state ---
  let settings = $state<AppSettings>({
    birda_path: '',
    clip_output_dir: '',
    db_path: '',
    default_confidence: 0.1,
    default_execution_provider: 'auto',
    default_freq_max: 15000,
    default_spectrogram_height: 160,
    species_language: 'en',
    ui_language: 'en',
    theme: 'system',
    setup_completed: true,
  });

  const freqOptions = [
    { value: 8000, label: '8 kHz' },
    { value: 10000, label: '10 kHz' },
    { value: 12000, label: '12 kHz' },
    { value: 15000, label: '15 kHz' },
    { value: 20000, label: '20 kHz' },
    { value: 24000, label: '24 kHz' },
  ];

  const heightOptions = [
    { value: 128, label: m.settings_spectrogram_heightSmall() },
    { value: 160, label: m.settings_spectrogram_heightMedium() },
    { value: 256, label: m.settings_spectrogram_heightLarge() },
    { value: 384, label: m.settings_spectrogram_heightXL() },
  ];

  const themeOptions = [
    { value: 'system', label: m.settings_general_themeSystem() },
    { value: 'light', label: m.settings_general_themeLight() },
    { value: 'dark', label: m.settings_general_themeDark() },
  ];

  let settingsLoaded = $state(false);
  const birdaStatus = $derived(appState.birdaStatus);
  let birdaConfig = $state<Record<string, unknown> | null>(null);
  let availableLanguages = $state<{ code: string; name: string }[]>([]);
  let savedSettings = $state<AppSettings | null>(null);
  let saving = $state(false);
  let saved = $state(false);
  let error = $state<string | null>(null);
  let clearError = $state<string | null>(null);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;

  let dataPath = $state('');
  let dbHealth = $state<DatabaseHealthResult | null>(null);
  let checkingHealth = $state(false);
  let optimizing = $state(false);
  let optimized = $state(false);
  let vacuuming = $state(false);
  let vacuumed = $state(false);
  let optimizeTimer: ReturnType<typeof setTimeout> | null = null;
  let vacuumTimer: ReturnType<typeof setTimeout> | null = null;

  let showClearConfirm = $state(false);
  let clearing = $state(false);
  let clearResult = $state<ClearDatabaseResult | null>(null);
  let dbContentHeading = $state<HTMLHeadingElement>();
  let clearResultTimer: ReturnType<typeof setTimeout> | null = null;

  // --- GPU state ---
  let gpuCapabilities = $state<{
    hasNvidiaGpu: boolean;
    cudaLibrariesFound: boolean;
    availableProviders: string[];
    platform: string;
  } | null>(null);
  const availableProviders = $derived(gpuCapabilities?.availableProviders ?? []);

  // --- CUDA state ---
  let cudaStatus = $state<CudaStatus | null>(null);
  let cudaDownloading = $state(false);
  let cudaProgress = $state<CudaDownloadProgress | null>(null);
  let cudaError = $state<string | null>(null);
  let cudaRemoveError = $state<string | null>(null);
  let cudaDownloadSizeBytes = $state(0);
  let showCudaRemoveConfirm = $state(false);
  // Progress and the outcome of a CUDA download, whichever window started it,
  // for as long as this panel is mounted.
  // Counts cuda:download-finished events, to tell a refused download from one that ended.
  let cudaFinishedCount = 0;
  const offCudaListeners = [
    onCudaDownloadProgress((progress) => {
      // Progress goes to every window, so this also follows a download another window started.
      cudaDownloading = true;
      cudaProgress = progress;
    }),
    onCudaDownloadFinished((finished) => {
      cudaFinishedCount++;
      cudaDownloading = false;
      cudaProgress = null;
      if (finished.outcome === 'failed') cudaError = finished.error ?? '';
      void refreshCudaStatus();
    }),
  ];

  $effect(() => {
    // Only sync theme to appState after settings are loaded to prevent flash
    if (settingsLoaded) {
      appState.theme = settings.theme;
    }
  });

  $effect(() => {
    if (!savedSettings) {
      appState.settingsHasUnsavedChanges = false;
      return;
    }
    appState.settingsHasUnsavedChanges = JSON.stringify($state.snapshot(settings)) !== JSON.stringify(savedSettings);
  });

  async function load() {
    try {
      const loaded = await getSettings();
      settings = { ...settings, ...loaded };
      savedSettings = structuredClone($state.snapshot(settings));

      // Sync theme to localStorage for instant application on next startup
      try {
        localStorage.setItem('theme', settings.theme);
      } catch (e) {
        console.error('Failed to save theme to localStorage:', e);
      }

      settingsLoaded = true; // Mark as loaded - $effect will sync theme

      dataPath = await getDataPath();
      await runHealthCheck();
      const detailsError = await loadBirdaDetails();
      if (detailsError) error = detailsError;
      // CUDA status is independent of birda CLI availability
      await refreshCudaStatus();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  /**
   * Checks birda, then loads what depends on it (config, languages, GPU providers); with no usable birda they
   * are cleared. The pieces load independently, so one that fails leaves the others. Returns the first failure's
   * message, or null.
   */
  async function loadBirdaDetails(): Promise<string | null> {
    await refreshBirdaStatus();
    if (!appState.birdaStatus?.available) {
      birdaConfig = null;
      availableLanguages = [];
      gpuCapabilities = null;
      return null;
    }
    const [config, languages] = await Promise.allSettled([
      getBirdaConfig(),
      getAvailableLanguages(),
      refreshGpuCapabilities(),
    ]);
    birdaConfig = config.status === 'fulfilled' ? config.value : null;
    availableLanguages = languages.status === 'fulfilled' ? languages.value : [];
    const failed = [config, languages].find((r) => r.status === 'rejected');
    if (!failed) return null;
    const reason: unknown = failed.reason;
    return (reason instanceof Error ? reason.message : String(reason)) || 'Unknown error';
  }

  async function refreshGpuCapabilities() {
    try {
      gpuCapabilities = await detectGpuCapabilities();
    } catch (e) {
      console.error('GPU detection failed:', e);
      gpuCapabilities = null;
    }
  }

  async function refreshCudaStatus() {
    try {
      cudaStatus = await checkCudaStatus();
      // Follow a download that is already running (after a tab switch or a
      // reload); cuda:download-finished ends it.
      if (cudaStatus.downloadInProgress && !cudaDownloading) {
        cudaDownloading = true;
        cudaProgress = null;
      }
      if (!cudaStatus.installed && cudaStatus.platformSupported) {
        cudaDownloadSizeBytes = await getCudaDownloadSize(BIRDA_CLI_VERSION);
      }
    } catch (e) {
      console.error('CUDA status check failed:', e);
      cudaStatus = null;
    }
  }

  async function handleCudaDownload() {
    cudaDownloading = true;
    cudaError = null;
    cudaProgress = null;
    const seenAt = cudaFinishedCount;
    try {
      await downloadCudaLibs(BIRDA_CLI_VERSION);
    } catch {
      // The outcome, a failure included, arrives on cuda:download-finished,
      // which refreshes the status. Only a download refused because another
      // is running sends none; cudaDownloading stays set until that one ends.
      if (cudaFinishedCount === seenAt) await refreshCudaStatus();
    }
  }

  async function handleCudaCancelDownload() {
    // The panel's state is reset by cuda:download-finished.
    await cancelCudaDownload();
  }

  async function handleCudaRemove() {
    showCudaRemoveConfirm = false;
    cudaRemoveError = null;
    try {
      await removeCudaLibs();
      await refreshCudaStatus();
    } catch (e) {
      cudaRemoveError = (e as Error).message;
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  async function save() {
    saving = true;
    saved = false;
    error = null;
    try {
      // Compare against savedSettings (last saved state), not current settings
      // because the dropdown binding already changed settings.ui_language
      const previous = savedSettings;
      const previousLang = previous?.ui_language;
      settings = await setSettings($state.snapshot(settings));
      savedSettings = structuredClone($state.snapshot(settings));

      // Sync theme to localStorage for instant application on next startup
      try {
        localStorage.setItem('theme', settings.theme);
      } catch (e) {
        console.error('Failed to save theme to localStorage:', e);
      }

      // The settings are saved by now, so a birda that cannot list its config or languages is not a failed save
      if (previous?.birda_path !== settings.birda_path) {
        const detailsError = await loadBirdaDetails();
        if (detailsError) console.error('Failed to load birda details:', detailsError);
      } else await refreshBirdaStatus();

      // The default confidence applies to the next analysis, not one that is running
      if (previous?.default_confidence !== settings.default_confidence && !appState.isAnalysisRunning) {
        appState.analysisConfidence = settings.default_confidence;
      }

      // If UI language changed, apply new locale
      if (previousLang !== settings.ui_language && isLocale(settings.ui_language)) {
        console.log('[SettingsPanel] Language changed from', previousLang, 'to', settings.ui_language);
        // Save current tab to sessionStorage so we can restore it after reload
        sessionStorage.setItem('activeTabBeforeReload', appState.activeTab);
        console.log('[SettingsPanel] Calling setLocale with reload=true (default)');
        await setLocale(settings.ui_language);
        console.log('[SettingsPanel] setLocale completed, reload should have happened');
      }

      saved = true;
      if (savedTimer) clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (saved = false), 2000);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }

  async function browseBirdaPath() {
    const path = await openExecutableDialog();
    if (path) settings.birda_path = path;
  }

  async function browseClipDir() {
    const path = await openFolderDialog(settings.clip_output_dir || undefined);
    if (path) settings.clip_output_dir = path;
  }

  async function confirmClearDatabase() {
    clearing = true;
    clearError = null;
    try {
      const result = await clearDatabase();
      clearResult = result;
      showClearConfirm = false;
      // Clear all, which opened the dialog, is disabled while clearing and once the catalog is empty.
      await tick();
      focusIfLost(dbContentHeading);
      catalogChanged();
      // Clearing also deletes the species lists.
      speciesListsChanged();
      // A finished analysis's panel may describe results that are gone now.
      dismissAnalysis();
      if (clearResultTimer) clearTimeout(clearResultTimer);
      clearResultTimer = setTimeout(() => (clearResult = null), 5000);
    } catch (e) {
      clearError = (e as Error).message;
    } finally {
      clearing = false;
    }
  }

  async function runHealthCheck() {
    checkingHealth = true;
    try {
      dbHealth = await checkDatabaseHealth();
    } catch (e) {
      dbHealth = {
        integrity_ok: false,
        integrity_message: (e as Error).message,
        file_size_bytes: 0,
        page_count: 0,
        page_size: 0,
        wal_mode: false,
        freelist_count: 0,
      };
    } finally {
      checkingHealth = false;
    }
  }

  async function runOptimize() {
    optimizing = true;
    try {
      await optimizeDatabase();
      optimized = true;
      if (optimizeTimer) clearTimeout(optimizeTimer);
      optimizeTimer = setTimeout(() => (optimized = false), 3000);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      optimizing = false;
    }
  }

  async function runVacuum() {
    vacuuming = true;
    try {
      await vacuumDatabase();
      vacuumed = true;
      if (vacuumTimer) clearTimeout(vacuumTimer);
      vacuumTimer = setTimeout(() => (vacuumed = false), 3000);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      vacuuming = false;
      // Refresh health info to show updated size (best-effort, don't overwrite vacuum error)
      try {
        dbHealth = await checkDatabaseHealth();
      } catch {
        /* ignore: health refresh failure is non-critical */
      }
    }
  }

  onMount(load);
  onDestroy(() => {
    if (savedTimer) clearTimeout(savedTimer);
    if (clearResultTimer) clearTimeout(clearResultTimer);
    if (optimizeTimer) clearTimeout(optimizeTimer);
    if (vacuumTimer) clearTimeout(vacuumTimer);
    for (const off of offCudaListeners) off();
    appState.settingsHasUnsavedChanges = false;
  });
</script>

<div class="flex-1 overflow-auto p-4">
  <div class="mx-auto max-w-7xl space-y-6">
    <h2 class="text-lg font-semibold">{m.settings_title()}</h2>

    <!-- Sub-tab bar -->
    <div class="tabs tabs-border">
      {#each subTabs as tab (tab.id)}
        <button class="tab" class:tab-active={activeSubTab === tab.id} onclick={() => (activeSubTab = tab.id)}>
          {tab.label}
        </button>
      {/each}
    </div>

    {#if error}
      <div role="alert" class="alert alert-error">
        <span>{error}</span>
      </div>
    {/if}

    <!-- ==================== PREFERENCES ==================== -->
    {#if activeSubTab === 'preferences'}
      <!-- birda CLI Status -->
      <div class="card bg-base-200">
        <div class="card-body gap-3 p-4">
          <h3 class="text-base-content/70 text-sm font-medium">{m.settings_cli_title()}</h3>
          {#if birdaStatus === null}
            <p class="text-base-content/50 text-sm">{m.settings_cli_checking()}</p>
          {:else if birdaStatus.available}
            <div class="flex flex-col gap-2">
              <div class="text-success flex items-center gap-2 text-sm">
                <CircleCheckBig size={16} />
                <span>{m.settings_cli_availableAt({ path: birdaStatus.path })}</span>
              </div>
              <div class="text-base-content/70 flex items-center gap-2 pl-6 text-sm">
                <span>{m.settings_cli_version({ version: birdaStatus.version })}</span>
              </div>
            </div>
          {:else}
            <div class="text-error flex items-center gap-2 text-sm">
              <CircleX size={16} />
              <span>{birdaStatus.error}</span>
            </div>
          {/if}
        </div>
      </div>

      <!-- Outdated birda Version Alert -->
      {#if birdaStatus?.available === false && birdaStatus.version && birdaStatus.minVersion}
        <div role="alert" class="alert alert-warning">
          <TriangleAlert size={20} />
          <div class="flex-1">
            <h4 class="font-medium">{m.status_updateModal_title()}</h4>
            <p class="text-sm opacity-80">
              {m.settings_cli_outdated({ current: birdaStatus.version, required: birdaStatus.minVersion })}
            </p>
            <div class="mt-2">
              <a
                href={BIRDA_RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                class="link link-primary flex items-center gap-1 text-sm"
              >
                <ExternalLink size={14} />
                {m.status_updateModal_download()}
              </a>
            </div>
          </div>
        </div>
      {/if}

      <!-- GPU Acceleration Section -->
      <div class="card bg-base-200">
        <div class="card-body gap-3 p-4">
          <h3 class="text-base-content/70 text-sm font-medium">{m.settings_cuda_title()}</h3>

          {#if cudaStatus === null}
            <p class="text-base-content/50 text-sm">{m.settings_cli_checking()}</p>
          {:else if !cudaStatus.platformSupported}
            <p class="text-base-content/50 text-sm">
              <Info size={14} class="mr-1 inline" />
              {m.settings_cuda_notSupported()}
            </p>
          {:else if !cudaStatus.hasNvidiaGpu}
            <p class="text-base-content/50 text-sm">
              <Info size={14} class="mr-1 inline" />
              {m.settings_cuda_noGpu()}
            </p>
          {:else if cudaDownloading}
            <div class="space-y-2">
              <p class="text-sm">
                {#if cudaProgress?.phase === 'extracting'}
                  {m.settings_cuda_extracting()}
                {:else if cudaProgress?.phase === 'verifying'}
                  {m.settings_cuda_verifying()}
                {:else}
                  {m.settings_cuda_downloading()}
                {/if}
              </p>
              <div class="flex items-center gap-3">
                <progress
                  class="progress progress-primary flex-1"
                  value={cudaProgress?.totalBytes ? cudaProgress.downloadedBytes : undefined}
                  max={cudaProgress?.totalBytes ?? undefined}
                ></progress>
                <span class="text-base-content/50 w-28 text-right text-xs">
                  {#if cudaProgress?.phase === 'downloading' && cudaProgress.totalBytes > 0}
                    {formatBytes(cudaProgress.downloadedBytes)} / {formatBytes(cudaProgress.totalBytes)}
                  {/if}
                </span>
              </div>
              <button
                class="btn btn-ghost btn-sm"
                onclick={handleCudaCancelDownload}
                disabled={cudaProgress !== null && cudaProgress.phase !== 'downloading'}
              >
                {m.settings_cuda_cancelButton()}
              </button>
            </div>
          {:else if !cudaStatus.installed}
            {#if cudaStatus.version}
              <!-- Libraries from an older birda release are on disk but not used. -->
              <p class="text-base-content/70 text-sm">
                {m.settings_cuda_outdated({ installed: cudaStatus.version, required: BIRDA_CLI_VERSION })}
              </p>
            {:else}
              <p class="text-base-content/70 text-sm">{m.settings_cuda_notInstalled()}</p>
            {/if}
            {#if cudaDownloadSizeBytes > 0}
              <p class="text-base-content/50 text-xs">
                {m.settings_cuda_downloadSize({ size: formatBytes(cudaDownloadSizeBytes) })}
              </p>
            {/if}
            <div>
              <button class="btn btn-primary btn-sm gap-1.5" onclick={handleCudaDownload}>
                <Download size={14} />
                {m.settings_cuda_downloadButton()}
              </button>
            </div>
          {:else}
            <div class="flex items-center gap-2">
              <span class="badge badge-success gap-1">
                <CircleCheckBig size={12} />
                {m.settings_cuda_installed()}
              </span>
              <span class="text-base-content/70 text-sm">
                {m.settings_cuda_version({ version: cudaStatus.version ?? '' })}
              </span>
            </div>
            <p class="text-base-content/50 text-xs">
              {m.settings_cuda_diskUsage({ size: formatBytes(cudaStatus.diskUsageBytes) })}
            </p>
            <p class="text-base-content/50 text-xs">
              {m.settings_cuda_requiresRestart()}
            </p>
            <div>
              <button class="btn btn-outline btn-error btn-sm" onclick={() => (showCudaRemoveConfirm = true)}>
                {m.settings_cuda_removeButton()}
              </button>
            </div>
          {/if}

          {#if cudaError}
            <div role="alert" class="alert alert-error mt-2">
              <span>{m.settings_cuda_downloadFailed({ error: cudaError })}</span>
              <button
                class="btn btn-ghost btn-sm btn-square"
                onclick={() => (cudaError = null)}
                aria-label={m.common_button_close()}
              >
                <X size={16} />
              </button>
            </div>
          {/if}
          {#if cudaRemoveError}
            <div role="alert" class="alert alert-error mt-2">
              <span>{m.settings_cuda_removeFailed({ error: cudaRemoveError })}</span>
              <button
                class="btn btn-ghost btn-sm btn-square"
                onclick={() => (cudaRemoveError = null)}
                aria-label={m.common_button_close()}
              >
                <X size={16} />
              </button>
            </div>
          {/if}
        </div>
      </div>

      <!-- General -->
      <div class="card bg-base-200">
        <div class="card-body gap-4 p-4">
          <h3 class="text-base-content/70 text-sm font-medium">{m.settings_general_title()}</h3>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <label class="block">
              <span class="text-base-content/70 text-sm font-medium">{m.settings_general_theme()}</span>
              <select bind:value={settings.theme} class="select select-bordered mt-1 w-full">
                {#each themeOptions as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>

            <label class="block">
              <span class="text-base-content/70 text-sm font-medium">{m.settings_general_uiLanguage()}</span>
              <select bind:value={settings.ui_language} class="select select-bordered mt-1 w-full">
                {#each uiLanguages as lang (lang.code)}
                  <option value={lang.code}>{lang.nativeName}</option>
                {/each}
              </select>
            </label>
          </div>

          <label class="block">
            <span class="text-base-content/70 text-sm font-medium">{m.settings_general_birdaPath()}</span>
            <div class="mt-1 flex gap-2">
              <input
                type="text"
                bind:value={settings.birda_path}
                placeholder={m.settings_general_birdaPathPlaceholder()}
                class="input input-bordered flex-1"
              />
              <button onclick={browseBirdaPath} class="btn btn-outline gap-1.5">
                <FolderOpen size={16} />
                {m.common_button_browse()}
              </button>
            </div>
          </label>
        </div>
      </div>

      <!-- Analysis Defaults -->
      <div class="card bg-base-200">
        <div class="card-body gap-4 p-4">
          <h3 class="text-base-content/70 text-sm font-medium">{m.settings_analysis_title()}</h3>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <label class="block">
              <span class="text-base-content/70 text-sm font-medium">{m.settings_analysis_confidence()}</span>
              <div class="mt-1 flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  bind:value={settings.default_confidence}
                  class="range range-primary flex-1"
                />
                <span class="text-base-content/70 w-12 text-sm tabular-nums"
                  >{(settings.default_confidence * 100).toFixed(0)}%</span
                >
              </div>
            </label>

            <label class="block">
              <span class="text-base-content/70 text-sm font-medium">{m.settings_analysis_executionProvider()}</span>
              <select bind:value={settings.default_execution_provider} class="select select-bordered mt-1 w-full">
                <option value="auto">{m.settings_analysis_epAuto()}</option>
                {#each availableProviders as provider (provider)}
                  <option value={provider.toLowerCase()}>
                    {provider}
                  </option>
                {/each}
              </select>
              <p class="text-base-content/50 mt-1 text-xs">
                {m.settings_analysis_epDescription()}
              </p>
            </label>

            {#if availableLanguages.length > 0}
              <label class="block">
                <span class="text-base-content/70 text-sm font-medium">{m.settings_general_speciesLanguage()}</span>
                <select bind:value={settings.species_language} class="select select-bordered mt-1 w-full">
                  {#each availableLanguages as lang (lang.code)}
                    <option value={lang.code}>{lang.name} ({lang.code})</option>
                  {/each}
                </select>
              </label>
            {/if}
          </div>
        </div>
      </div>

      <!-- Spectrogram -->
      <div class="card bg-base-200">
        <div class="card-body gap-4 p-4">
          <h3 class="text-base-content/70 text-sm font-medium">{m.settings_spectrogram_title()}</h3>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <label class="block">
              <span class="text-base-content/70 text-sm font-medium">{m.settings_spectrogram_maxFreq()}</span>
              <select bind:value={settings.default_freq_max} class="select select-bordered mt-1 w-full">
                {#each freqOptions as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>

            <label class="block">
              <span class="text-base-content/70 text-sm font-medium">{m.settings_spectrogram_height()}</span>
              <select bind:value={settings.default_spectrogram_height} class="select select-bordered mt-1 w-full">
                {#each heightOptions as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>
          </div>
        </div>
      </div>

      <!-- Storage Paths -->
      <div class="card bg-base-200">
        <div class="card-body gap-4 p-4">
          <h3 class="text-base-content/70 text-sm font-medium">{m.settings_storage_title()}</h3>

          <label class="block">
            <span class="text-base-content/70 text-sm font-medium">{m.settings_storage_clipDir()}</span>
            <div class="mt-1 flex gap-2">
              <input type="text" bind:value={settings.clip_output_dir} class="input input-bordered flex-1" />
              <button
                onclick={() => settings.clip_output_dir && openInExplorer(settings.clip_output_dir)}
                disabled={!settings.clip_output_dir}
                class="btn btn-outline gap-1.5"
                title={m.settings_storage_openClipDir()}
                aria-label={m.settings_storage_openClipDir()}
              >
                <ExternalLink size={16} />
              </button>
              <button onclick={browseClipDir} class="btn btn-outline gap-1.5">
                <FolderOpen size={16} />
                {m.common_button_browse()}
              </button>
            </div>
          </label>

          <div>
            <span class="text-base-content/70 text-sm font-medium">{m.settings_storage_dbLocation()}</span>
            <p class="border-base-300 bg-base-300/50 text-base-content/50 mt-1 truncate rounded-lg border p-2 text-sm">
              {settings.db_path}
            </p>
          </div>
        </div>
      </div>

      <!-- Save button -->
      <div class="flex items-center gap-3">
        <button onclick={save} disabled={saving} class="btn btn-primary gap-1.5">
          {#if saving}
            <Loader size={14} class="motion-safe:animate-spin" />
          {:else}
            <Save size={14} />
          {/if}
          {m.common_button_save()}
        </button>
        {#if saved}
          <span class="text-success flex items-center gap-1 text-sm">
            <CircleCheckBig size={14} />
            {m.settings_saved()}
          </span>
        {/if}
      </div>

      <!-- ==================== MODELS ==================== -->
    {:else if activeSubTab === 'models'}
      <ModelGallery />

      <!-- ==================== DATA ==================== -->
    {:else if activeSubTab === 'data'}
      <div class="card bg-base-200">
        <div class="card-body gap-4 p-4">
          <div class="flex items-center gap-2">
            <FolderOpen size={16} class="text-base-content/50" />
            <h3 class="text-base-content/70 text-sm font-medium">{m.settings_data_dataPath()}</h3>
          </div>
          <p class="text-base-content/50 text-xs">{m.settings_data_dataPathDescription()}</p>
          <div class="flex items-center gap-3">
            <code class="bg-base-300/50 border-base-300 rounded border px-2 py-1 text-xs">{dataPath}</code>
            <button onclick={() => openInExplorer(dataPath)} disabled={!dataPath} class="btn btn-outline gap-1.5">
              <FolderOpen size={14} />
              {m.settings_data_openFolder()}
            </button>
          </div>
        </div>
      </div>

      <!-- Database Health -->
      <div class="card bg-base-200">
        <div class="card-body gap-4 p-4">
          <div class="flex items-center gap-2">
            <ShieldCheck size={16} class="text-base-content/50" />
            <h3 class="text-base-content/70 text-sm font-medium">{m.settings_data_dbHealth()}</h3>
          </div>

          {#if dbHealth}
            <div class="flex flex-wrap items-center gap-4 text-sm">
              {#if dbHealth.integrity_ok}
                <span class="text-success flex items-center gap-1.5">
                  <CircleCheckBig size={14} />
                  {m.settings_data_dbHealthOk()}
                </span>
              {:else}
                <span class="text-error flex items-center gap-1.5">
                  <CircleX size={14} />
                  {m.settings_data_dbHealthError({ message: dbHealth.integrity_message })}
                </span>
              {/if}
              <span class="text-base-content/50"
                >{m.settings_data_dbSize({ size: formatFileSize(dbHealth.file_size_bytes) })}</span
              >
              {#if dbHealth.freelist_count > 0}
                <span class="text-base-content/50"
                  >{m.settings_data_dbFreePages({ count: dbHealth.freelist_count })}</span
                >
              {/if}
              {#if dbHealth.wal_mode}
                <span class="badge badge-ghost badge-sm">{m.settings_data_dbWalMode()}</span>
              {/if}
            </div>
          {/if}

          <div>
            <button onclick={runHealthCheck} disabled={checkingHealth} class="btn btn-outline btn-sm gap-1.5">
              {#if checkingHealth}
                <Loader size={14} class="motion-safe:animate-spin" />
                {m.settings_data_checking()}
              {:else}
                <RefreshCw size={14} />
                {m.settings_data_checkIntegrity()}
              {/if}
            </button>
          </div>
        </div>
      </div>

      <!-- Database Maintenance -->
      <div class="card bg-base-200">
        <div class="card-body gap-4 p-4">
          <div class="flex items-center gap-2">
            <Wrench size={16} class="text-base-content/50" />
            <h3 class="text-base-content/70 text-sm font-medium">{m.settings_data_dbMaintenance()}</h3>
          </div>

          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-3">
              <button onclick={runOptimize} disabled={optimizing} class="btn btn-outline btn-sm gap-1.5">
                {#if optimizing}
                  <Loader size={14} class="motion-safe:animate-spin" />
                {:else}
                  <RefreshCw size={14} />
                {/if}
                {m.settings_data_optimize()}
              </button>
              <span class="text-base-content/50 text-xs">{m.settings_data_optimizeDescription()}</span>
              {#if optimized}
                <span class="text-success text-sm">{m.settings_data_optimized()}</span>
              {/if}
            </div>

            <div class="flex items-center gap-3">
              <button onclick={runVacuum} disabled={vacuuming} class="btn btn-outline btn-sm gap-1.5">
                {#if vacuuming}
                  <Loader size={14} class="motion-safe:animate-spin" />
                {:else}
                  <Database size={14} />
                {/if}
                {m.settings_data_vacuum()}
              </button>
              <span class="text-base-content/50 text-xs">{m.settings_data_vacuumDescription()}</span>
              {#if vacuumed}
                <span class="text-success text-sm">{m.settings_data_vacuumed()}</span>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <div class="card bg-base-200">
        <div class="card-body gap-4 p-4">
          <div class="flex items-center gap-2">
            <Database size={16} class="text-base-content/50" />
            <h3 bind:this={dbContentHeading} tabindex="-1" class="text-base-content/70 text-sm font-medium">
              {m.settings_data_dbContent()}
            </h3>
          </div>

          <div class="text-base-content/70 flex items-center gap-6 text-sm">
            <span>{m.settings_data_detections({ count: appState.catalogStats.total_detections })}</span>
            <span>{m.settings_data_species({ count: appState.catalogStats.total_species })}</span>
            <span>{m.settings_data_locations({ count: appState.catalogStats.saved_locations })}</span>
          </div>

          <div class="flex items-center gap-3">
            <button
              onclick={() => {
                clearError = null;
                showClearConfirm = true;
              }}
              disabled={clearing ||
                (appState.catalogStats.total_detections === 0 && appState.catalogStats.saved_locations === 0) ||
                appState.isAnalysisRunning}
              title={appState.isAnalysisRunning ? m.analysis_lockedDuringRun() : undefined}
              class="btn btn-error btn-sm gap-1.5"
            >
              <Trash size={14} />
              {m.settings_data_clearAll()}
            </button>
            <span role="status" class="text-success text-sm">
              {#if clearResult}
                {m.settings_data_cleared({
                  detections: clearResult.detections,
                  runs: clearResult.runs,
                  locations: clearResult.locations,
                  annotations: clearResult.annotations,
                })}
              {/if}
            </span>
          </div>
        </div>
      </div>

      {#if birdaConfig}
        <div class="card bg-base-200">
          <div class="card-body gap-2 p-4">
            <div class="flex items-center gap-2">
              <FileCode size={16} class="text-base-content/50" />
              <h3 class="text-base-content/70 text-sm font-medium">{m.settings_data_birdaConfig()}</h3>
            </div>
            <pre
              class="border-base-300 bg-base-300/50 text-base-content/50 max-h-64 overflow-auto rounded-lg border p-3 text-xs">{JSON.stringify(
                birdaConfig,
                null,
                2,
              )}</pre>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- Clear Database Confirmation Modal -->
{#if showClearConfirm}
  <dialog
    class="modal"
    {@attach showModal}
    onclose={() => (showClearConfirm = false)}
    closedby={clearing ? 'none' : undefined}
    role="alertdialog"
    aria-labelledby="clear-modal-title"
    aria-describedby="clear-modal-warning"
  >
    <div class="modal-box">
      <div class="text-error flex items-center gap-3">
        <TriangleAlert size={24} />
        <h3 id="clear-modal-title" class="text-lg font-semibold">{m.settings_clearModal_title()}</h3>
      </div>
      <p id="clear-modal-warning" class="text-base-content/70 mt-3 text-sm">
        {m.settings_clearModal_warning()}
      </p>
      <div class="border-base-300 bg-base-200 mt-2 rounded-lg border p-3 text-sm">
        <p>{m.settings_clearModal_detectionsRemoved({ count: appState.catalogStats.total_detections })}</p>
        <p>{m.settings_clearModal_locationsRemoved({ count: appState.catalogStats.saved_locations })}</p>
      </div>
      {#if clearError}
        <p role="alert" class="text-error mt-3 text-sm">{clearError}</p>
      {/if}
      <div class="modal-action">
        <button onclick={() => (showClearConfirm = false)} disabled={clearing} class="btn">
          {m.common_button_cancel()}
        </button>
        <button onclick={confirmClearDatabase} disabled={clearing} class="btn btn-error gap-1.5">
          {#if clearing}
            <Loader size={14} class="motion-safe:animate-spin" />
          {/if}
          {m.settings_clearModal_deleteAll()}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" aria-label={m.common_button_close()} disabled={clearing}>close</button>
    </form>
  </dialog>
{/if}

<!-- CUDA Remove Confirmation Modal -->
{#if showCudaRemoveConfirm}
  <dialog
    class="modal"
    {@attach showModal}
    onclose={() => (showCudaRemoveConfirm = false)}
    role="alertdialog"
    aria-labelledby="cuda-remove-modal-title"
    aria-describedby="cuda-remove-modal-body"
  >
    <div class="modal-box">
      <div class="text-error flex items-center gap-3">
        <TriangleAlert size={24} />
        <h3 id="cuda-remove-modal-title" class="text-lg font-semibold">{m.settings_cuda_removeButton()}</h3>
      </div>
      <p id="cuda-remove-modal-body" class="text-base-content/70 mt-3 text-sm">
        {m.settings_cuda_removeConfirm({ size: formatBytes(cudaStatus?.diskUsageBytes ?? 0) })}
      </p>
      <div class="modal-action">
        <button class="btn" onclick={() => (showCudaRemoveConfirm = false)}>
          {m.common_button_cancel()}
        </button>
        <button class="btn btn-error" onclick={handleCudaRemove}>
          {m.settings_cuda_removeButton()}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" aria-label={m.common_button_close()}>close</button>
    </form>
  </dialog>
{/if}
