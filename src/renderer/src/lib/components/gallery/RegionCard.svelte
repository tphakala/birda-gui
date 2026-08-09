<script lang="ts">
  import CoverageMap from './CoverageMap.svelte';
  import DownloadProgress from './DownloadProgress.svelte';
  import { Download as DownloadIcon, CircleCheckBig } from '@lucide/svelte';
  import * as m from '$paraglide/messages';
  import { formatFileSize, formatNumber } from '$lib/utils/format';
  import type { ManifestVariant } from '$shared/types';
  import type { Download } from '$lib/stores/gallery.svelte';

  const {
    variant,
    family,
    installed,
    download,
    matchHint,
    installDisabled = false,
    onOpen,
    onInstall,
    onCancel,
  }: {
    variant: ManifestVariant;
    family: string;
    installed: boolean;
    download?: Download | undefined;
    matchHint?: { kind: 'core' | 'partial'; country: string } | undefined;
    installDisabled?: boolean;
    onOpen: () => void;
    onInstall: () => void;
    onCancel: () => void;
  } = $props();

  const core = $derived(variant.countries?.core ?? []);
  const shown = $derived(core.slice(0, 3));
  const extra = $derived(Math.max(0, core.length - 3));
  const allCountries = $derived([...core, ...(variant.countries?.partial ?? [])].join(', '));
  const countryLine = $derived(
    shown.join(', ') + (extra ? ` ${m.gallery_region_moreCountries({ count: extra })}` : ''),
  );
</script>

<div class="card border-base-300 bg-base-200 hover:border-primary/40 overflow-hidden border transition-colors">
  <button type="button" class="block w-full text-start" onclick={onOpen} aria-label={variant.region_name}>
    <CoverageMap
      {family}
      region={variant.region}
      regionName={variant.region_name ?? ''}
      class="rounded-none border-x-0 border-t-0"
    />
  </button>
  <div class="card-body gap-1.5 p-4">
    <div class="flex items-start justify-between gap-2">
      <h4 class="truncate text-sm font-semibold" title={variant.region_name}>{variant.region_name}</h4>
      <div class="shrink-0">
        {#if installed}
          <span class="badge badge-success badge-sm gap-1"
            ><CircleCheckBig size={10} />{m.gallery_installedBadge()}</span
          >
        {:else if !download}
          <button
            class="btn btn-primary btn-xs gap-1"
            onclick={onInstall}
            disabled={installDisabled}
            title={installDisabled ? m.gallery_installAnotherRunning() : undefined}
          >
            <DownloadIcon size={12} />{m.gallery_install()}
          </button>
        {/if}
      </div>
    </div>

    {#if matchHint}
      <div>
        <span class="badge badge-soft badge-primary badge-sm">
          {matchHint.kind === 'core'
            ? m.gallery_search_matchCore({ country: matchHint.country })
            : m.gallery_search_matchPartial({ country: matchHint.country })}
        </span>
      </div>
    {/if}

    <p class="text-base-content/60 text-xs tabular-nums">
      {m.gallery_region_stats({
        count: variant.classes !== undefined ? formatNumber(variant.classes) : '?',
        size: variant.size_bytes !== undefined ? formatFileSize(variant.size_bytes) : '?',
      })}
    </p>

    {#if shown.length}
      <p class="text-base-content/50 truncate text-xs" title={allCountries}>{countryLine}</p>
    {/if}

    {#if download}
      <DownloadProgress {download} {onCancel} />
    {/if}
  </div>
</div>
