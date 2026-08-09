<script lang="ts">
  import CoverageMap from './CoverageMap.svelte';
  import DownloadProgress from './DownloadProgress.svelte';
  import { X, Download as DownloadIcon, CircleCheckBig } from '@lucide/svelte';
  import * as m from '$paraglide/messages';
  import { formatFileSize, formatNumber } from '$lib/utils/format';
  import type { ManifestVariant, ModelLicense } from '$shared/types';
  import type { Download } from '$lib/stores/gallery.svelte';

  const {
    variant,
    family,
    license,
    installed,
    download,
    installDisabled = false,
    onInstall,
    onCancel,
    onClose,
  }: {
    variant: ManifestVariant;
    family: string;
    license?: ModelLicense | undefined;
    installed: boolean;
    download?: Download | undefined;
    installDisabled?: boolean;
    onInstall: () => void;
    onCancel: () => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    dialog?.showModal();
  });

  const core = $derived(variant.countries?.core ?? []);
  const partial = $derived(variant.countries?.partial ?? []);
</script>

<dialog class="modal" bind:this={dialog} onclose={onClose} aria-labelledby="region-detail-title">
  <div class="modal-box max-w-2xl">
    <div class="mb-3 flex items-center justify-between">
      <h3 id="region-detail-title" class="text-base font-semibold">{variant.region_name}</h3>
      <button
        onclick={() => dialog?.close()}
        class="btn btn-ghost btn-sm btn-square"
        aria-label={m.common_button_close()}
      >
        <X size={16} />
      </button>
    </div>

    <CoverageMap {family} region={variant.region} regionName={variant.region_name ?? ''} />

    <div class="text-base-content/70 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <span class="inline-flex items-center gap-1">
        <span class="inline-block size-3 rounded-sm bg-[#2f9e6b]"></span>{m.gallery_legend_core()}
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="inline-block size-3 rounded-sm bg-[#cfe8d9]"></span>{m.gallery_legend_partial()}
      </span>
    </div>

    <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
      <div>
        <p class="text-base-content/50 text-xs">{m.gallery_detail_species()}</p>
        <p class="tabular-nums">{variant.classes !== undefined ? formatNumber(variant.classes) : '-'}</p>
      </div>
      <div>
        <p class="text-base-content/50 text-xs">{m.gallery_detail_download()}</p>
        <p class="tabular-nums">{variant.size_bytes !== undefined ? formatFileSize(variant.size_bytes) : '-'}</p>
      </div>
    </div>

    {#if core.length}
      <div class="mt-3">
        <p class="text-base-content/50 text-xs">{m.gallery_detail_coreCountries()}</p>
        <div class="mt-1 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
          {#each core as c (c)}<span class="badge badge-soft badge-sm">{c}</span>{/each}
        </div>
      </div>
    {/if}
    {#if partial.length}
      <div class="mt-2">
        <p class="text-base-content/50 text-xs">{m.gallery_detail_partialCountries()}</p>
        <div class="mt-1 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
          {#each partial as c (c)}<span class="badge badge-ghost badge-sm">{c}</span>{/each}
        </div>
      </div>
    {/if}

    {#if license}
      <p class="text-base-content/50 mt-3 text-xs">{m.gallery_license_agree({ license: license.type })}</p>
    {/if}
    <p class="text-base-content/50 mt-1 text-xs">{m.gallery_hardware_auto()}</p>

    <div class="modal-action">
      {#if download}
        <div class="w-full"><DownloadProgress {download} {onCancel} /></div>
      {:else if installed}
        <span class="badge badge-success gap-1"><CircleCheckBig size={12} />{m.gallery_installedBadge()}</span>
      {:else}
        <button
          onclick={onInstall}
          disabled={installDisabled}
          title={installDisabled ? m.gallery_installAnotherRunning() : undefined}
          class="btn btn-primary gap-1"
        >
          <DownloadIcon size={14} />{m.gallery_install()}
        </button>
      {/if}
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button aria-label={m.common_button_close()}>close</button>
  </form>
</dialog>
