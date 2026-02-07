<script lang="ts">
  import {
    Save,
    FolderOpen,
    FileCode,
    CircleCheckBig,
    CircleX,
    Loader,
    Trash2,
    TriangleAlert,
    Database,
    Download,
    RefreshCw,
    X,
    ExternalLink,
    Cpu,
  } from '@lucide/svelte';
  import {
    getSettings,
    setSettings,
    checkBirda,
    getBirdaConfig,
    openExecutableDialog,
    openFolderDialog,
    getAvailableLanguages,
    getCatalogStats,
    clearDatabase,
    listModels,
    listAvailableModels,
    installModel,
  } from '$lib/utils/ipc';
  import { appState } from '$lib/stores/app.svelte';
  import type { AppSettings, InstalledModel, AvailableModel } from '$shared/types';
  import { onDestroy, onMount } from 'svelte';
  import * as m from '$paraglide/messages';
  import { locales, setLocale, isLocale } from '$paraglide/runtime';

  // --- UI language display names (always in native script) ---
  const UI_LANGUAGE_NAMES: Record<string, string> = {
    en: 'English',
  };

  const uiLanguages = locales.map((code) => ({
    code,
    name: UI_LANGUAGE_NAMES[code] ?? code,
  }));

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
    default_model: 'birdnet-v24',
    default_confidence: 0.1,
    default_freq_max: 15000,
    default_spectrogram_height: 160,
    species_language: 'en',
    ui_language: 'en',
    theme: 'system',
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

  let birdaStatus = $state<{ available: boolean; path?: string; error?: string } | null>(null);
  let birdaConfig = $state<Record<string, unknown> | null>(null);
  let availableLanguages = $state<{ code: string; name: string }[]>([]);
  let saving = $state(false);
  let saved = $state(false);
  let error = $state<string | null>(null);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;

  let showClearConfirm = $state(false);
  let clearing = $state(false);
  let clearResult = $state<{ detections: number; runs: number; locations: number } | null>(null);
  let clearResultTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Models state ---
  let installedModels = $state<InstalledModel[]>([]);
  let availableModelsToInstall = $state<AvailableModel[]>([]);
  let modelsLoading = $state(false);
  let installing = $state<string | null>(null);
  let modelsError = $state<string | null>(null);
  let licenseModel = $state<AvailableModel | null>(null);

  type ModelsTab = 'installed' | 'catalog';
  let modelsTab = $state<ModelsTab>('installed');
  const installedIds = $derived(new Set(installedModels.map((mod) => mod.id)));

  const LICENSE_URLS: Record<string, string> = {
    'CC-BY-NC-SA-4.0': 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    'Apache-2.0': 'https://www.apache.org/licenses/LICENSE-2.0',
    MIT: 'https://opensource.org/licenses/MIT',
  };

  const modelInList = $derived(installedModels.some((mod) => mod.id === settings.default_model));

  $effect(() => {
    appState.theme = settings.theme;
  });

  async function load() {
    try {
      const loaded = await getSettings();
      settings = { ...settings, ...loaded };
      appState.theme = loaded.theme;

      birdaStatus = await checkBirda();
      if (birdaStatus.available) {
        birdaConfig = await getBirdaConfig();
        availableLanguages = await getAvailableLanguages();
        await refreshModels();
      }
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function refreshModels() {
    modelsLoading = true;
    modelsError = null;
    try {
      [installedModels, availableModelsToInstall] = await Promise.all([listModels(), listAvailableModels()]);
    } catch (e) {
      modelsError = (e as Error).message;
      installedModels = [];
      availableModelsToInstall = [];
    } finally {
      modelsLoading = false;
    }
  }

  function promptLicense(model: AvailableModel) {
    licenseModel = model;
  }

  async function handleAcceptAndInstall() {
    if (!licenseModel) return;
    const id = licenseModel.id;
    licenseModel = null;
    installing = id;
    modelsError = null;
    try {
      await installModel(id);
      await refreshModels();
    } catch (e) {
      modelsError = m.settings_models_failedInstall({ modelId: id, error: (e as Error).message });
    } finally {
      installing = null;
    }
  }

  async function handleSetDefault(modelId: string) {
    settings.default_model = modelId;
    saving = true;
    error = null;
    try {
      settings = await setSettings($state.snapshot(settings));
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }

  async function save() {
    saving = true;
    saved = false;
    error = null;
    try {
      const previousLang = settings.ui_language;
      settings = await setSettings($state.snapshot(settings));
      birdaStatus = await checkBirda();

      // If UI language changed, reload to apply new locale
      if (previousLang !== settings.ui_language && isLocale(settings.ui_language)) {
        void setLocale(settings.ui_language);
        return;
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
    const path = await openFolderDialog();
    if (path) settings.clip_output_dir = path;
  }

  async function confirmClearDatabase() {
    clearing = true;
    error = null;
    try {
      const result = await clearDatabase();
      clearResult = result;
      showClearConfirm = false;
      appState.catalogStats = await getCatalogStats();
      if (clearResultTimer) clearTimeout(clearResultTimer);
      clearResultTimer = setTimeout(() => (clearResult = null), 5000);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      clearing = false;
    }
  }

  onMount(load);
  onDestroy(() => {
    if (savedTimer) clearTimeout(savedTimer);
    if (clearResultTimer) clearTimeout(clearResultTimer);
  });
</script>

<div class="flex-1 overflow-auto p-4">
  <div class="mx-auto max-w-7xl space-y-6">
    <h2 class="text-lg font-semibold">{m.settings_title()}</h2>

    <!-- Sub-tab bar -->
    <div class="tabs tabs-border">
      {#each subTabs as tab (tab.id)}
        <button
          class="tab"
          class:tab-active={activeSubTab === tab.id}
          onclick={() => (activeSubTab = tab.id)}
        >
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
          <h3 class="text-sm font-medium text-base-content/70">{m.settings_cli_title()}</h3>
          {#if birdaStatus === null}
            <p class="text-sm text-base-content/50">{m.settings_cli_checking()}</p>
          {:else if birdaStatus.available}
            <div class="flex items-center gap-2 text-sm text-success">
              <CircleCheckBig size={16} />
              <span>{m.settings_cli_availableAt({ path: birdaStatus.path ?? '' })}</span>
            </div>
          {:else}
            <div class="flex items-center gap-2 text-sm text-error">
              <CircleX size={16} />
              <span>{birdaStatus.error}</span>
            </div>
          {/if}
        </div>
      </div>

      <!-- General -->
      <div class="card bg-base-200">
        <div class="card-body gap-4 p-4">
          <h3 class="text-sm font-medium text-base-content/70">{m.settings_general_title()}</h3>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <label class="block">
              <span class="text-sm font-medium text-base-content/70">{m.settings_general_theme()}</span>
              <select bind:value={settings.theme} class="select select-bordered mt-1 w-full">
                {#each themeOptions as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>

            <label class="block">
              <span class="text-sm font-medium text-base-content/70">{m.settings_general_uiLanguage()}</span>
              <select bind:value={settings.ui_language} class="select select-bordered mt-1 w-full">
                {#each uiLanguages as lang (lang.code)}
                  <option value={lang.code}>{lang.name}</option>
                {/each}
              </select>
            </label>
          </div>

          <label class="block">
            <span class="text-sm font-medium text-base-content/70">{m.settings_general_birdaPath()}</span>
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
          <h3 class="text-sm font-medium text-base-content/70">{m.settings_analysis_title()}</h3>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <label class="block">
              <span class="text-sm font-medium text-base-content/70">{m.settings_analysis_defaultModel()}</span>
              <select bind:value={settings.default_model} class="select select-bordered mt-1 w-full">
                {#if !modelInList && settings.default_model}
                  <option value={settings.default_model}>{settings.default_model}</option>
                {/if}
                {#each installedModels as model (model.id)}
                  <option value={model.id}>{model.id}</option>
                {/each}
              </select>
            </label>

            <label class="block">
              <span class="text-sm font-medium text-base-content/70">{m.settings_analysis_confidence()}</span>
              <div class="mt-1 flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  bind:value={settings.default_confidence}
                  class="range range-primary flex-1"
                />
                <span class="w-12 text-sm tabular-nums text-base-content/70"
                  >{(settings.default_confidence * 100).toFixed(0)}%</span
                >
              </div>
            </label>

            {#if availableLanguages.length > 0}
              <label class="block">
                <span class="text-sm font-medium text-base-content/70">{m.settings_general_speciesLanguage()}</span>
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
          <h3 class="text-sm font-medium text-base-content/70">{m.settings_spectrogram_title()}</h3>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <label class="block">
              <span class="text-sm font-medium text-base-content/70">{m.settings_spectrogram_maxFreq()}</span>
              <select bind:value={settings.default_freq_max} class="select select-bordered mt-1 w-full">
                {#each freqOptions as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>

            <label class="block">
              <span class="text-sm font-medium text-base-content/70">{m.settings_spectrogram_height()}</span>
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
          <h3 class="text-sm font-medium text-base-content/70">{m.settings_storage_title()}</h3>

          <label class="block">
            <span class="text-sm font-medium text-base-content/70">{m.settings_storage_clipDir()}</span>
            <div class="mt-1 flex gap-2">
              <input
                type="text"
                bind:value={settings.clip_output_dir}
                class="input input-bordered flex-1"
              />
              <button onclick={browseClipDir} class="btn btn-outline gap-1.5">
                <FolderOpen size={16} />
                {m.common_button_browse()}
              </button>
            </div>
          </label>

          <div>
            <span class="text-sm font-medium text-base-content/70">{m.settings_storage_dbLocation()}</span>
            <p class="mt-1 truncate rounded-lg border border-base-300 bg-base-300/50 p-2 text-sm text-base-content/50">
              {settings.db_path}
            </p>
          </div>
        </div>
      </div>

      <!-- Save button -->
      <div class="flex items-center gap-3">
        <button onclick={save} disabled={saving} class="btn btn-primary gap-1.5">
          {#if saving}
            <Loader size={14} class="animate-spin" />
          {:else}
            <Save size={14} />
          {/if}
          {m.common_button_save()}
        </button>
        {#if saved}
          <span class="flex items-center gap-1 text-sm text-success">
            <CircleCheckBig size={14} />
            {m.settings_saved()}
          </span>
        {/if}
      </div>

      <!-- ==================== MODELS ==================== -->
    {:else if activeSubTab === 'models'}
      <!-- Models header -->
      <div class="flex items-center justify-between">
        <div class="tabs tabs-border">
          <button class="tab" class:tab-active={modelsTab === 'installed'} onclick={() => (modelsTab = 'installed')}>
            {m.settings_models_installed()}
            {#if installedModels.length > 0}
              <span class="badge badge-sm ml-1.5">{installedModels.length}</span>
            {/if}
          </button>
          <button class="tab" class:tab-active={modelsTab === 'catalog'} onclick={() => (modelsTab = 'catalog')}>
            {m.settings_models_catalog()}
          </button>
        </div>
        <button onclick={refreshModels} disabled={modelsLoading} class="btn btn-ghost btn-sm gap-1.5">
          <RefreshCw size={14} class={modelsLoading ? 'animate-spin' : ''} />
          {m.settings_models_refresh()}
        </button>
      </div>

      {#if modelsError}
        <div role="alert" class="alert alert-error">
          <span>{modelsError}</span>
        </div>
      {/if}

      {#if modelsTab === 'installed'}
        <!-- Installed models grid -->
        {#if installedModels.length === 0}
          <div class="py-12 text-center text-base-content/50">
            <Cpu size={40} class="mx-auto mb-3 opacity-30" />
            <p class="text-sm">{modelsLoading ? m.settings_models_loading() : m.settings_models_noInstalled()}</p>
            <p class="mt-1 text-xs">{m.settings_models_switchToCatalog()}</p>
          </div>
        {:else}
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {#each installedModels as model (model.id)}
              {@const info = availableModelsToInstall.find((a) => a.id === model.id)}
              <div class="card border border-base-300 bg-base-200">
                <div class="card-body gap-3 p-4">
                  <div class="flex items-start gap-3">
                    <div class="shrink-0 rounded-lg bg-primary/10 p-2.5">
                      <Cpu size={24} class="text-primary" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <h4 class="text-sm font-semibold">{info?.name ?? model.id}</h4>
                      {#if info?.description}
                        <p class="mt-0.5 line-clamp-2 text-xs text-base-content/50">{info.description}</p>
                      {/if}
                      <p class="mt-1 text-xs text-base-content/40">{info?.vendor ?? ''}</p>
                    </div>
                  </div>

                  <div class="flex items-center justify-between border-t border-base-300 pt-3">
                    <div class="flex items-center gap-2">
                      {#if info?.version}
                        <span class="text-xs text-base-content/40">v{info.version}</span>
                        <span class="text-base-content/20">·</span>
                      {/if}
                      <span class="text-xs text-base-content/40">{model.model_type}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <button
                        onclick={() => handleSetDefault(model.id)}
                        class="btn btn-xs {settings.default_model === model.id ? 'btn-primary' : 'btn-ghost'}"
                      >
                        {#if settings.default_model === model.id}
                          <CircleCheckBig size={12} />
                          {m.settings_models_default()}
                        {:else}
                          {m.settings_models_setDefault()}
                        {/if}
                      </button>
                      <button
                        class="btn btn-ghost btn-xs btn-square"
                        disabled
                        title={m.settings_models_uninstallSoon()}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <!-- Catalog grid -->
        {#if availableModelsToInstall.length === 0}
          <div class="py-12 text-center text-base-content/50">
            <Download size={40} class="mx-auto mb-3 opacity-30" />
            <p class="text-sm">{modelsLoading ? m.settings_models_loadingCatalog() : m.settings_models_noCatalog()}</p>
          </div>
        {:else}
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {#each availableModelsToInstall as model (model.id)}
              {@const isInstalled = installedIds.has(model.id)}
              <div class="card relative overflow-hidden border border-base-300 bg-base-200">
                {#if model.recommended}
                  <div class="bg-primary px-3 py-1 text-xs font-semibold text-primary-content">
                    {m.settings_models_recommended()}
                  </div>
                {/if}
                <div class="card-body gap-3 p-4">
                  <div class="flex items-start gap-3">
                    <div class="shrink-0 rounded-lg bg-primary/10 p-2.5">
                      <Cpu size={24} class="text-primary" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <h4 class="text-sm font-semibold">{model.name}</h4>
                      {#if model.description}
                        <p class="mt-0.5 line-clamp-2 text-xs text-base-content/50">{model.description}</p>
                      {/if}
                      <p class="mt-1 text-xs text-base-content/40">{model.vendor}</p>
                    </div>
                  </div>

                  <div class="flex items-center justify-between border-t border-base-300 pt-3">
                    <div class="flex items-center gap-2">
                      <span class="text-xs text-base-content/40">v{model.version}</span>
                      <span class="text-base-content/20">·</span>
                      <span class="text-xs text-base-content/40">{model.model_type}</span>
                      {#if !model.commercial_use}
                        <span class="text-base-content/20">·</span>
                        <span class="text-xs text-warning">{m.settings_models_nonCommercial()}</span>
                      {/if}
                    </div>
                    {#if isInstalled}
                      <span class="badge badge-success badge-sm gap-1">
                        <CircleCheckBig size={10} />
                        {m.settings_models_installedBadge()}
                      </span>
                    {:else}
                      <button
                        onclick={() => { promptLicense(model); }}
                        disabled={installing !== null}
                        class="btn btn-primary btn-xs gap-1"
                      >
                        {#if installing === model.id}
                          <Loader size={12} class="animate-spin" />
                          {m.settings_models_installing()}
                        {:else}
                          <Download size={12} />
                          {m.settings_models_install()}
                        {/if}
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/if}

      <!-- ==================== DATA ==================== -->
    {:else if activeSubTab === 'data'}
      <div class="card bg-base-200">
        <div class="card-body gap-4 p-4">
          <div class="flex items-center gap-2">
            <Database size={16} class="text-base-content/50" />
            <h3 class="text-sm font-medium text-base-content/70">{m.settings_data_dbContent()}</h3>
          </div>

          <div class="flex items-center gap-6 text-sm text-base-content/70">
            <span>{m.settings_data_detections({ count: appState.catalogStats.total_detections })}</span>
            <span>{m.settings_data_species({ count: appState.catalogStats.total_species })}</span>
            <span>{m.settings_data_locations({ count: appState.catalogStats.total_locations })}</span>
          </div>

          <div class="flex items-center gap-3">
            <button
              onclick={() => (showClearConfirm = true)}
              disabled={clearing || appState.catalogStats.total_detections === 0}
              class="btn btn-error btn-sm gap-1.5"
            >
              <Trash2 size={14} />
              {m.settings_data_clearAll()}
            </button>
            {#if clearResult}
              <span class="text-sm text-success">
                {m.settings_data_cleared({
                  detections: clearResult.detections,
                  runs: clearResult.runs,
                  locations: clearResult.locations,
                })}
              </span>
            {/if}
          </div>
        </div>
      </div>

      {#if birdaConfig}
        <div class="card bg-base-200">
          <div class="card-body gap-2 p-4">
            <div class="flex items-center gap-2">
              <FileCode size={16} class="text-base-content/50" />
              <h3 class="text-sm font-medium text-base-content/70">{m.settings_data_birdaConfig()}</h3>
            </div>
            <pre
              class="max-h-64 overflow-auto rounded-lg border border-base-300 bg-base-300/50 p-3 text-xs text-base-content/50">{JSON.stringify(
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
  <dialog class="modal modal-open">
    <div class="modal-box">
      <div class="flex items-center gap-3 text-error">
        <TriangleAlert size={24} />
        <h3 class="text-lg font-semibold">{m.settings_clearModal_title()}</h3>
      </div>
      <p class="mt-3 text-sm text-base-content/70">
        {m.settings_clearModal_warning()}
      </p>
      <div class="mt-2 rounded-lg border border-base-300 bg-base-200 p-3 text-sm">
        <p>{m.settings_clearModal_detectionsRemoved({ count: appState.catalogStats.total_detections })}</p>
        <p>{m.settings_clearModal_locationsRemoved({ count: appState.catalogStats.total_locations })}</p>
      </div>
      <div class="modal-action">
        <button onclick={() => (showClearConfirm = false)} disabled={clearing} class="btn">
          {m.common_button_cancel()}
        </button>
        <button onclick={confirmClearDatabase} disabled={clearing} class="btn btn-error gap-1.5">
          {#if clearing}
            <Loader size={14} class="animate-spin" />
          {/if}
          {m.settings_clearModal_deleteAll()}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button onclick={() => (showClearConfirm = false)}>close</button>
    </form>
  </dialog>
{/if}

<!-- License Acceptance Modal -->
{#if licenseModel}
  <dialog class="modal modal-open">
    <div class="modal-box">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">{m.settings_licenseModal_title()}</h2>
        <button onclick={() => (licenseModel = null)} class="btn btn-ghost btn-sm btn-square">
          <X size={20} />
        </button>
      </div>

      <div class="mt-4 space-y-4">
        <div>
          <p class="text-sm font-medium">{licenseModel.name}</p>
          <p class="text-xs text-base-content/50">{licenseModel.vendor}</p>
        </div>

        <div class="space-y-2 rounded-lg border border-base-300 bg-base-200 p-3 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-base-content/70">{m.settings_licenseModal_license()}</span>
            {#if LICENSE_URLS[licenseModel.license]}
              <a
                href={LICENSE_URLS[licenseModel.license]}
                target="_blank"
                rel="noopener noreferrer"
                class="link link-primary flex items-center gap-1"
              >
                {licenseModel.license}
                <ExternalLink size={12} />
              </a>
            {:else}
              <span class="font-medium">{licenseModel.license}</span>
            {/if}
          </div>
          <div class="flex items-center justify-between">
            <span class="text-base-content/70">{m.settings_licenseModal_commercialUse()}</span>
            <span class="font-medium {licenseModel.commercial_use ? 'text-success' : 'text-error'}">
              {licenseModel.commercial_use ? m.settings_licenseModal_allowed() : m.settings_licenseModal_notAllowed()}
            </span>
          </div>
        </div>

        <p class="text-xs text-base-content/50">
          {m.settings_licenseModal_agree({ license: licenseModel.license })}
        </p>
      </div>

      <div class="modal-action">
        <button onclick={() => (licenseModel = null)} class="btn">
          {m.common_button_cancel()}
        </button>
        <button onclick={handleAcceptAndInstall} class="btn btn-primary gap-1.5">
          <Download size={16} />
          {m.settings_licenseModal_acceptInstall()}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button onclick={() => (licenseModel = null)}>close</button>
    </form>
  </dialog>
{/if}
