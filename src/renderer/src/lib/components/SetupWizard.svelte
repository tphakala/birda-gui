<script lang="ts">
  import ClassicCatalog from './ClassicCatalog.svelte';
  import {
    Bird,
    CircleCheckBig,
    CircleX,
    Loader,
    FolderOpen,
    ExternalLink,
    ChevronRight,
    ChevronLeft,
  } from '@lucide/svelte';
  import {
    checkBirda,
    setSettings,
    openExecutableDialog,
    listModels,
    listAvailableModels,
    getAvailableLanguages,
    getSystemLocale,
  } from '$lib/utils/ipc';
  import type { InstalledModel, AvailableModel, BirdaCheckResponse } from '$shared/types';
  import { BIRDA_RELEASES_URL } from '$shared/constants';
  import { onMount } from 'svelte';
  import { modelInstall, reportInstallOutcomes } from '$lib/stores/modelInstall.svelte';
  import * as m from '$paraglide/messages';
  import { LANGUAGES, getLanguage } from '$lib/i18n/languages';
  import { detectLanguage } from '$lib/i18n/detect';
  import { isLocale, setLocale } from '$paraglide/runtime';

  interface Props {
    oncomplete: () => void;
  }

  const { oncomplete }: Props = $props();

  // --- Step management ---
  type WizardStep = 'welcome' | 'ui-language' | 'cli' | 'model' | 'language';
  const steps: WizardStep[] = ['welcome', 'ui-language', 'cli', 'model', 'language'];
  let currentStep = $state<WizardStep>('welcome');
  const stepIndex = $derived(steps.indexOf(currentStep));

  function nextStep() {
    const idx = steps.indexOf(currentStep);
    if (idx < steps.length - 1) currentStep = steps[idx + 1];
  }

  function prevStep() {
    const idx = steps.indexOf(currentStep);
    if (idx > 0) currentStep = steps[idx - 1];
  }

  // --- birda CLI ---
  let birdaStatus = $state<BirdaCheckResponse | null>(null);
  let birdaPath = $state('');

  async function checkCli() {
    birdaStatus = null;
    try {
      if (birdaPath) {
        await setSettings({ birda_path: birdaPath });
      }
      birdaStatus = await checkBirda();
    } catch (e) {
      birdaStatus = { available: false, error: (e as Error).message };
    }
  }

  async function browseBirdaPath() {
    const path = await openExecutableDialog();
    if (path) {
      birdaPath = path;
      try {
        await setSettings({ birda_path: path });
        birdaStatus = await checkBirda();
      } catch (e) {
        birdaStatus = { available: false, error: (e as Error).message };
      }
    }
  }

  // --- Models ---
  let installedModels = $state<InstalledModel[]>([]);
  let availableModels = $state<AvailableModel[]>([]);
  // The install in flight, whichever window or component started it.
  const installing = $derived(modelInstall.current?.request.id ?? null);
  let installAnnouncement = $state('');
  let modelsError = $state<string | null>(null);

  async function refreshModels() {
    modelsError = null;
    try {
      [installedModels, availableModels] = await Promise.all([listModels(), listAvailableModels()]);
    } catch (e) {
      modelsError = (e as Error).message;
    }
  }

  // Report each install that ends once, including one followed after a reload.
  reportInstallOutcomes((finished) => {
    const modelId = finished.request.id;
    if (finished.outcome === 'installed') {
      installAnnouncement = m.gallery_installedToast({ model: modelId });
      void refreshModels();
    } else if (finished.outcome === 'cancelled') {
      installAnnouncement = m.gallery_download_cancelled();
    } else {
      modelsError = m.settings_models_failedInstall({ modelId, error: finished.error ?? '' });
    }
  });

  // --- UI Language ---
  let selectedUiLanguage = $state('en');
  let detectedLanguage = $state<string | null>(null);

  // --- Species Language ---
  let availableLanguages = $state<{ code: string; name: string }[]>([]);
  let selectedLanguage = $state('en');
  let languagesError = $state<string | null>(null);

  // --- Lifecycle ---
  onMount(async () => {
    // Auto-detect system language for UI language step
    try {
      const systemLocale = await getSystemLocale();
      detectedLanguage = detectLanguage(systemLocale);
      selectedUiLanguage = detectedLanguage;
    } catch {
      // Detection failed, use English default
      selectedUiLanguage = 'en';
    }

    // Pre-fetch data for later steps
    await checkCli();
    try {
      await refreshModels();
    } catch {
      // birda may not be available yet
    }
    try {
      availableLanguages = await getAvailableLanguages();
    } catch {
      // Will retry when step is reached
    }
  });

  // When entering model step, refresh if we have no data yet
  $effect(() => {
    if (currentStep === 'model' && availableModels.length === 0 && birdaStatus?.available) {
      void refreshModels();
    }
    if (currentStep === 'language' && availableLanguages.length === 0 && birdaStatus?.available) {
      void getAvailableLanguages()
        .then((langs) => {
          availableLanguages = langs;
          languagesError = null;
        })
        .catch((e: unknown) => {
          languagesError = e instanceof Error ? e.message : String(e);
        });
    }
  });

  async function handleUiLanguageNext() {
    // Apply UI language immediately and save to settings
    if (selectedUiLanguage && isLocale(selectedUiLanguage)) {
      try {
        await setSettings({ ui_language: selectedUiLanguage });
        void setLocale(selectedUiLanguage, { reload: false });
      } catch {
        // Proceed even if saving fails
      }
    }
    nextStep();
  }

  async function handleSkip() {
    try {
      await setSettings({ setup_completed: true });
    } catch {
      // Proceed even if persisting fails; the user can redo setup later
    }
    oncomplete();
  }

  async function handleFinish() {
    try {
      await setSettings({
        species_language: selectedLanguage,
        setup_completed: true,
      });
    } catch {
      // Proceed even if persisting fails
    }
    oncomplete();
  }
</script>

<div class="bg-base-100 flex h-screen items-center justify-center">
  <div class="w-full max-w-2xl px-6">
    <!-- Step indicator -->
    <div class="mb-8 flex items-center justify-center gap-2">
      {#each steps as step, i (step)}
        <div class="h-1.5 w-12 rounded-full transition-colors {i <= stepIndex ? 'bg-primary' : 'bg-base-300'}"></div>
      {/each}
      <span class="text-base-content/40 ml-2 text-xs">
        {m.wizard_stepOf({ current: String(stepIndex + 1), total: String(steps.length) })}
      </span>
    </div>

    <!-- ==================== WELCOME ==================== -->
    {#if currentStep === 'welcome'}
      <div class="text-center">
        <div class="bg-primary/10 mx-auto mb-6 inline-flex rounded-2xl p-5">
          <Bird size={48} class="text-primary" />
        </div>
        <h1 class="text-2xl font-bold">{m.wizard_welcome_title()}</h1>
        <p class="text-base-content/60 mt-2 text-sm">{m.wizard_welcome_subtitle()}</p>

        <div class="mt-10 flex flex-col items-center gap-3">
          <button onclick={nextStep} class="btn btn-primary btn-wide gap-2">
            {m.wizard_welcome_getStarted()}
            <ChevronRight size={16} />
          </button>
          <button onclick={handleSkip} class="btn btn-ghost btn-sm text-base-content/40">
            {m.wizard_welcome_skip()}
          </button>
        </div>
      </div>

      <!-- ==================== UI LANGUAGE ==================== -->
    {:else if currentStep === 'ui-language'}
      <div class="text-center">
        <h2 class="text-xl font-bold">{m.wizard_uiLanguage_title()}</h2>
        <p class="text-base-content/60 mt-1 text-sm">{m.wizard_uiLanguage_subtitle()}</p>

        <div class="card bg-base-200 mx-auto mt-8 max-w-sm text-left">
          <div class="card-body p-6">
            <label class="block">
              <span class="text-base-content/70 text-sm font-medium">
                {m.settings_general_uiLanguage()}
              </span>
              <select bind:value={selectedUiLanguage} class="select select-bordered mt-2 w-full">
                {#each LANGUAGES as lang (lang.code)}
                  <option value={lang.code}>{lang.nativeName}</option>
                {/each}
              </select>
            </label>

            {#if detectedLanguage && getLanguage(detectedLanguage)}
              <p class="text-base-content/50 text-xs">
                {m.wizard_uiLanguage_detected({
                  language: getLanguage(detectedLanguage)?.nativeName ?? detectedLanguage,
                })}
              </p>
            {/if}
          </div>
        </div>

        <div class="mt-8 flex items-center justify-between">
          <button onclick={prevStep} class="btn btn-ghost gap-1">
            <ChevronLeft size={16} />
            {m.wizard_back()}
          </button>
          <button onclick={handleUiLanguageNext} class="btn btn-primary gap-1">
            {m.wizard_next()}
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <!-- ==================== CLI CHECK ==================== -->
    {:else if currentStep === 'cli'}
      <div class="text-center">
        <h2 class="text-xl font-bold">{m.wizard_cli_title()}</h2>
        <p class="text-base-content/60 mt-1 text-sm">{m.wizard_cli_subtitle()}</p>

        <div class="card bg-base-200 mt-8 text-left">
          <div class="card-body gap-4 p-6">
            {#if birdaStatus === null}
              <div class="text-base-content/50 flex items-center gap-2 text-sm">
                <Loader size={16} class="motion-safe:animate-spin" />
                <span>{m.wizard_cli_checking()}</span>
              </div>
            {:else if birdaStatus.available}
              <div class="flex flex-col gap-2">
                <div class="text-success flex items-center gap-2 text-sm">
                  <CircleCheckBig size={18} />
                  <span>{m.wizard_cli_found({ path: birdaStatus.path })}</span>
                </div>
                <div class="text-base-content/70 flex items-center gap-2 pl-7 text-xs">
                  <span>{m.settings_cli_version({ version: birdaStatus.version })}</span>
                </div>
              </div>
            {:else}
              <div class="space-y-3">
                <div class="text-error flex items-center gap-2 text-sm">
                  <CircleX size={18} />
                  <span>{birdaStatus.error}</span>
                </div>
                {#if birdaStatus.version && birdaStatus.minVersion}
                  <div class="text-warning text-xs">
                    {m.wizard_cli_outdated({ current: birdaStatus.version, required: birdaStatus.minVersion })}
                  </div>
                {/if}
                <p class="text-base-content/50 text-xs">{m.wizard_cli_notFoundHint()}</p>
                <div class="flex gap-2">
                  <button onclick={browseBirdaPath} class="btn btn-outline btn-sm gap-1.5">
                    <FolderOpen size={14} />
                    {m.wizard_cli_setPath()}
                  </button>
                  <a
                    href={BIRDA_RELEASES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="btn btn-outline btn-sm gap-1.5"
                  >
                    <ExternalLink size={14} />
                    {m.wizard_cli_download()}
                  </a>
                </div>
              </div>
            {/if}
          </div>
        </div>

        <div class="mt-8 flex items-center justify-between">
          <button onclick={prevStep} class="btn btn-ghost gap-1">
            <ChevronLeft size={16} />
            {m.wizard_back()}
          </button>
          <button onclick={nextStep} disabled={!birdaStatus?.available} class="btn btn-primary gap-1">
            {m.wizard_next()}
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <!-- ==================== MODEL INSTALL ==================== -->
    {:else if currentStep === 'model'}
      <div>
        <div class="text-center">
          <h2 class="text-xl font-bold">{m.wizard_model_title()}</h2>
          <p class="text-base-content/60 mt-1 text-sm">{m.wizard_model_subtitle()}</p>
        </div>

        <div class="sr-only" aria-live="polite">{installAnnouncement}</div>
        {#if modelsError}
          <div role="alert" class="alert alert-error mt-4">
            <span class="text-sm">{modelsError}</span>
          </div>
        {/if}

        {#if installedModels.length > 0}
          <div class="alert alert-success mt-4">
            <CircleCheckBig size={16} />
            <span class="text-sm">{m.wizard_model_hasModels({ count: String(installedModels.length) })}</span>
          </div>
        {/if}

        <div class="mt-6">
          <ClassicCatalog
            installed={installedModels}
            available={availableModels}
            onstart={() => {
              modelsError = null;
            }}
          />
        </div>

        {#if availableModels.length === 0 && !modelsError}
          {#if !birdaStatus?.available}
            <div role="alert" class="alert alert-warning mt-4">
              <CircleX size={16} />
              <span class="text-sm">{m.wizard_model_noCli()}</span>
            </div>
          {:else}
            <div class="text-base-content/50 py-8 text-center text-sm">
              <Loader size={20} class="mx-auto mb-2 opacity-30 motion-safe:animate-spin" />
              <p>{m.settings_models_loadingCatalog()}</p>
            </div>
          {/if}
        {/if}

        <div class="mt-8 flex items-center justify-between">
          <button onclick={prevStep} class="btn btn-ghost gap-1">
            <ChevronLeft size={16} />
            {m.wizard_back()}
          </button>
          <button
            onclick={nextStep}
            disabled={installedModels.length === 0 || installing !== null}
            title={installing !== null ? m.settings_models_installing() : undefined}
            class="btn btn-primary gap-1"
          >
            {m.wizard_next()}
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <!-- ==================== LANGUAGE ==================== -->
    {:else if currentStep === 'language'}
      <div class="text-center">
        <h2 class="text-xl font-bold">{m.wizard_language_title()}</h2>
        <p class="text-base-content/60 mt-1 text-sm">{m.wizard_language_subtitle()}</p>

        {#if languagesError}
          <div role="alert" class="alert alert-error mx-auto mt-4 max-w-sm">
            <span class="text-sm">{languagesError}</span>
          </div>
        {/if}

        <div class="card bg-base-200 mx-auto mt-8 max-w-sm text-left">
          <div class="card-body p-6">
            <label class="block">
              <span class="text-base-content/70 text-sm font-medium">{m.settings_general_speciesLanguage()}</span>
              <select bind:value={selectedLanguage} class="select select-bordered mt-2 w-full">
                {#each availableLanguages as lang (lang.code)}
                  <option value={lang.code}>{lang.name} ({lang.code})</option>
                {/each}
              </select>
            </label>
          </div>
        </div>

        <div class="mt-8 flex items-center justify-between">
          <button onclick={prevStep} class="btn btn-ghost gap-1">
            <ChevronLeft size={16} />
            {m.wizard_back()}
          </button>
          <button onclick={handleFinish} class="btn btn-primary gap-1">
            {m.wizard_finish()}
            <CircleCheckBig size={16} />
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>
