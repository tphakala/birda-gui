<script lang="ts">
  import { showModal } from '$lib/utils/dialog';
  import { CircleCheckBig, Loader, Download, ExternalLink, Cpu, X } from '@lucide/svelte';
  import logoBirdnet from '../../assets/logo-birdnet.png';
  import logoGoogle from '../../assets/logo-google.png';
  import logoJyu from '../../assets/logo-jyu.jpeg';
  import type { InstalledModel, AvailableModel } from '$shared/types';
  import { modelInstall, startModelInstall } from '$lib/stores/modelInstall.svelte';
  import * as m from '$paraglide/messages';

  /**
   * The classic model catalog: one card per available model with its license
   * prompt, shared by the setup wizard and the Models settings on a birda that
   * has no regional manifests. The parent reports how each install ends
   * (reportInstallOutcomes), since the outcome can arrive after a reload.
   */
  interface Props {
    installed: InstalledModel[];
    available: AvailableModel[];
    /** Called when an install is about to start, so the parent can clear an earlier error. */
    onstart?: () => void;
  }

  const { installed, available, onstart }: Props = $props();

  let licenseModel = $state<AvailableModel | null>(null);
  // The install in flight, whichever window or component started it.
  const installing = $derived(modelInstall.current?.request.id ?? null);
  const installProgress = $derived(modelInstall.current?.progress?.line ?? '');
  const installedIds = $derived(new Set(installed.map((mod) => mod.id)));

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

  function promptLicense(model: AvailableModel) {
    licenseModel = model;
  }

  async function handleAcceptAndInstall() {
    if (!licenseModel) return;
    const id = licenseModel.id;
    licenseModel = null;
    onstart?.();
    await startModelInstall({ id });
  }
</script>

<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
  {#each available as model (model.id)}
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
              <Loader size={12} class="motion-safe:animate-spin" />
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

<!-- License Acceptance Modal -->
{#if licenseModel}
  <dialog
    class="modal"
    {@attach showModal}
    onclose={() => (licenseModel = null)}
    aria-labelledby="classic-license-title"
    aria-describedby="classic-license-agree"
  >
    <div class="modal-box">
      <div class="flex items-center justify-between">
        <h2 id="classic-license-title" class="text-lg font-semibold">{m.settings_licenseModal_title()}</h2>
        <button
          onclick={() => (licenseModel = null)}
          class="btn btn-ghost btn-sm btn-square"
          aria-label={m.common_button_close()}
        >
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

        <p id="classic-license-agree" class="text-base-content/70 text-sm">
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
      <button tabindex="-1" aria-label={m.common_button_close()}>close</button>
    </form>
  </dialog>
{/if}
