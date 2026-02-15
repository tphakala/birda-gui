<script lang="ts">
  import {
    Bird,
    CircleCheckBig,
    CircleX,
    Loader,
    Download,
    FolderOpen,
    ExternalLink,
    ChevronRight,
    ChevronLeft,
    Cpu,
    X,
  } from '@lucide/svelte';
  import logoBirdnet from '../../assets/logo-birdnet.png';
  import logoGoogle from '../../assets/logo-google.png';
  import logoJyu from '../../assets/logo-jyu.jpeg';
  import {
    checkBirda,
    setSettings,
    openExecutableDialog,
    listModels,
    listAvailableModels,
    installModel,
    getAvailableLanguages,
    onModelInstallProgress,
    offModelInstallProgress,
  } from '$lib/utils/ipc';
  import type { InstalledModel, AvailableModel, BirdaCheckResponse } from '$shared/types';
  import { BIRDA_RELEASES_URL } from '$shared/constants';
  import { onMount, onDestroy } from 'svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    oncomplete: () => void;
  }

  const { oncomplete }: Props = $props();

  // --- Step management ---
  type WizardStep = 'welcome' | 'cli' | 'model' | 'language';
  const steps: WizardStep[] = ['welcome', 'cli', 'model', 'language'];
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
      birdaStatus = { available: false, error: (e as Error).message } as BirdaCheckResponse;
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
        birdaStatus = { available: false, error: (e as Error).message } as BirdaCheckResponse;
      }
    }
  }

  // --- Models ---
  let installedModels = $state<InstalledModel[]>([]);
  let availableModels = $state<AvailableModel[]>([]);
  let installing = $state<string | null>(null);
  let installProgress = $state('');
  let modelsError = $state<string | null>(null);
  let licenseModel = $state<AvailableModel | null>(null);
  const installedIds = $derived(new Set(installedModels.map((mod) => mod.id)));

  const MODEL_LOGOS: Record<string, string> = {
    birdnet: logoBirdnet,
    perch: logoGoogle,
    bsg: logoJyu,
  };

  function getModelLogo(id: string): string | null {
    for (const [prefix, logo] of Object.entries(MODEL_LOGOS)) {
      if (id.startsWith(prefix)) return logo;
    }
    return null;
  }

  const LICENSE_URLS: Record<string, string> = {
    'CC-BY-NC-SA-4.0': 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    'Apache-2.0': 'https://www.apache.org/licenses/LICENSE-2.0',
    MIT: 'https://opensource.org/licenses/MIT',
  };

  async function refreshModels() {
    modelsError = null;
    try {
      [installedModels, availableModels] = await Promise.all([listModels(), listAvailableModels()]);
    } catch (e) {
      modelsError = (e as Error).message;
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
    installProgress = '';
    modelsError = null;

    onModelInstallProgress((line) => {
      installProgress = line;
    });

    try {
      await installModel(id);
      await refreshModels();
    } catch (e) {
      modelsError = m.settings_models_failedInstall({ modelId: id, error: (e as Error).message });
    } finally {
      installing = null;
      installProgress = '';
      offModelInstallProgress();
    }
  }

  // --- Language ---
  let availableLanguages = $state<{ code: string; name: string }[]>([]);
  let selectedLanguage = $state('en');

  // --- Lifecycle ---
  onMount(async () => {
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

  onDestroy(() => {
    offModelInstallProgress();
  });

  // When entering model step, refresh if we have no data yet
  $effect(() => {
    if (currentStep === 'model' && availableModels.length === 0 && birdaStatus?.available) {
      void refreshModels();
    }
    if (currentStep === 'language' && availableLanguages.length === 0 && birdaStatus?.available) {
      void getAvailableLanguages()
        .then((langs) => (availableLanguages = langs))
        .catch(() => {});
    }
  });

  async function handleSkip() {
    try {
      await setSettings({ setup_completed: true });
    } catch {
      // Proceed even if persisting fails — user can redo setup later
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

      <!-- ==================== CLI CHECK ==================== -->
    {:else if currentStep === 'cli'}
      <div class="text-center">
        <h2 class="text-xl font-bold">{m.wizard_cli_title()}</h2>
        <p class="text-base-content/60 mt-1 text-sm">{m.wizard_cli_subtitle()}</p>

        <div class="card bg-base-200 mt-8 text-left">
          <div class="card-body gap-4 p-6">
            {#if birdaStatus === null}
              <div class="text-base-content/50 flex items-center gap-2 text-sm">
                <Loader size={16} class="animate-spin" />
                <span>{m.wizard_cli_checking()}</span>
              </div>
            {:else if birdaStatus.available}
              <div class="flex flex-col gap-2">
                <div class="text-success flex items-center gap-2 text-sm">
                  <CircleCheckBig size={18} />
                  <span>{m.wizard_cli_found({ path: birdaStatus.path })}</span>
                </div>
                <div class="text-base-content/70 flex items-center gap-2 pl-7 text-xs">
                  <span>Version: {birdaStatus.version}</span>
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
                    Found version {birdaStatus.version}, but {birdaStatus.minVersion} or higher is required.
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

        <div class="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {#each availableModels as model (model.id)}
            {@const isInstalled = installedIds.has(model.id)}
            {@const logo = getModelLogo(model.id)}
            {@const isInstalling = installing === model.id}
            <div class="card border-base-300 bg-base-200 border">
              <div class="card-body gap-3 p-4">
                <div class="flex items-start gap-3">
                  {#if logo}
                    <img src={logo} alt="" class="size-10 shrink-0 rounded-lg" />
                  {:else}
                    <div class="bg-primary/10 shrink-0 rounded-lg p-2.5">
                      <Cpu size={24} class="text-primary" />
                    </div>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <h4 class="text-sm font-semibold">{model.name}</h4>
                    {#if model.description}
                      <p class="text-base-content/70 mt-0.5 line-clamp-2 text-xs">{model.description}</p>
                    {/if}
                    <p class="text-base-content/60 mt-1 text-xs">{model.vendor}</p>
                  </div>
                </div>

                <div class="border-base-300 flex items-center justify-between border-t pt-3">
                  <div class="flex items-center gap-2">
                    <span class="text-base-content/60 text-xs">v{model.version}</span>
                    {#if !model.commercial_use}
                      <span class="text-base-content/20">·</span>
                      <span class="text-error/80 text-xs">{m.settings_models_nonCommercial()}</span>
                    {/if}
                  </div>
                  {#if isInstalled}
                    <span class="badge badge-success badge-sm gap-1">
                      <CircleCheckBig size={10} />
                      {m.settings_models_installedBadge()}
                    </span>
                  {:else if isInstalling}
                    <span class="text-primary flex items-center gap-1.5 text-xs">
                      <Loader size={12} class="animate-spin" />
                      {m.settings_models_installing()}
                    </span>
                  {:else}
                    <button
                      onclick={() => {
                        promptLicense(model);
                      }}
                      disabled={installing !== null}
                      class="btn btn-primary btn-xs gap-1"
                    >
                      <Download size={12} />
                      {m.settings_models_install()}
                    </button>
                  {/if}
                </div>

                {#if isInstalling && installProgress}
                  <p class="text-base-content/50 truncate text-xs">{installProgress}</p>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        {#if availableModels.length === 0 && !modelsError}
          {#if !birdaStatus?.available}
            <div role="alert" class="alert alert-warning mt-4">
              <CircleX size={16} />
              <span class="text-sm">{m.wizard_model_noCli()}</span>
            </div>
          {:else}
            <div class="text-base-content/50 py-8 text-center text-sm">
              <Loader size={20} class="mx-auto mb-2 animate-spin opacity-30" />
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
          <p class="text-base-content/50 text-xs">{licenseModel.vendor}</p>
        </div>

        <div class="border-base-300 bg-base-200 space-y-2 rounded-lg border p-3 text-sm">
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

        <p class="text-base-content/50 text-xs">
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
