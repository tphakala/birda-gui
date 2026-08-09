<script lang="ts">
  import RegionCard from './RegionCard.svelte';
  import DownloadProgress from './DownloadProgress.svelte';
  import { Search, Globe, Download as DownloadIcon, CircleCheckBig } from '@lucide/svelte';
  import * as m from '$paraglide/messages';
  import { formatFileSize, formatNumber } from '$lib/utils/format';
  import {
    variantKey,
    dedupeRegionVariants,
    pickGlobalVariant,
    groupVariants,
    searchRegions,
  } from '$lib/gallery/logic';
  import type { Download } from '$lib/stores/gallery.svelte';
  import type { ModelManifest, ManifestVariant } from '$shared/types';

  const {
    manifest,
    family,
    families,
    installedRegions,
    downloads,
    installing,
    onSelectFamily,
    onOpenRegion,
    onInstall,
    onCancel,
  }: {
    manifest: ModelManifest;
    family: string;
    families: { id: string; name: string; vendor: string; recommended: boolean }[];
    installedRegions: Set<string>;
    downloads: Record<string, Download>;
    installing: boolean;
    onSelectFamily: (id: string) => void;
    onOpenRegion: (v: ManifestVariant) => void;
    onInstall: (v: ManifestVariant) => void;
    onCancel: (v: ManifestVariant) => void;
  } = $props();

  let query = $state('');

  const familyInfo = $derived(families.find((f) => f.id === family));

  // One entry per region (hardware variants collapsed), the global variant,
  // ranked search results, and continent groups. Logic is unit tested in logic.ts.
  const regionVariants = $derived(dedupeRegionVariants(manifest));
  const globalVariant = $derived(pickGlobalVariant(manifest));
  const results = $derived(query.trim() ? searchRegions(regionVariants, query) : null);
  const groups = $derived(groupVariants(regionVariants));

  function groupLabel(slug: string, fallback: string): string {
    switch (slug) {
      case 'europe':
        return m.gallery_group_europe();
      case 'asia':
        return m.gallery_group_asia();
      case 'north-america':
        return m.gallery_group_northAmerica();
      case 'south-america':
        return m.gallery_group_southAmerica();
      case 'africa':
        return m.gallery_group_africa();
      case 'oceania':
        return m.gallery_group_oceania();
      default:
        return fallback;
    }
  }

  const installedGlobal = $derived(installedRegions.has('global'));
  const globalDownload = $derived(downloads[variantKey(family, undefined)]);
</script>

<div class="space-y-4">
  <!-- Family selector -->
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div role="tablist" class="tabs tabs-box">
      {#each families as f (f.id)}
        <button
          role="tab"
          aria-selected={family === f.id}
          class="tab {family === f.id ? 'tab-active' : ''}"
          onclick={() => {
            onSelectFamily(f.id);
          }}
        >
          {f.name}
          {#if f.recommended}
            <span class="badge badge-soft badge-primary badge-xs ms-1.5">{m.gallery_family_recommended()}</span>
          {/if}
        </button>
      {/each}
    </div>
    {#if familyInfo}
      <p class="text-base-content/50 text-xs">
        {m.gallery_family_meta({
          vendor: familyInfo.vendor,
          license: manifest.license.type,
          count: regionVariants.length,
        })}
      </p>
    {/if}
  </div>

  <!-- Country search -->
  <label class="input input-bordered flex max-w-md items-center gap-2">
    <Search size={16} class="opacity-50" />
    <input
      type="text"
      class="grow"
      placeholder={m.gallery_search_placeholder()}
      aria-label={m.gallery_search_placeholder()}
      bind:value={query}
    />
  </label>

  {#if results}
    <!-- Flat ranked results -->
    {#if results.length === 0}
      <div class="text-base-content/50 py-8 text-center">
        <p class="text-sm">{m.gallery_search_noResults({ query })}</p>
        <p class="mt-1 text-xs">{m.gallery_search_tryGlobal()}</p>
      </div>
    {:else}
      <p class="text-base-content/50 text-xs">{m.gallery_search_matches({ count: results.length })}</p>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {#each results as r (r.variant.region)}
          <RegionCard
            variant={r.variant}
            {family}
            installed={installedRegions.has(r.variant.region ?? 'global')}
            download={downloads[variantKey(family, r.variant.region)]}
            matchHint={r.hint}
            installDisabled={installing}
            onOpen={() => {
              onOpenRegion(r.variant);
            }}
            onInstall={() => {
              onInstall(r.variant);
            }}
            onCancel={() => {
              onCancel(r.variant);
            }}
          />
        {/each}
      </div>
    {/if}
  {:else}
    <!-- Global hero -->
    {#if globalVariant}
      <div class="card border-primary/30 from-primary/5 to-base-200 border bg-gradient-to-br">
        <div class="card-body flex-row items-center gap-4 p-4">
          <div class="bg-primary/10 rounded-lg p-3"><Globe size={26} class="text-primary" /></div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold">{m.gallery_global_title()}</h3>
              {#if familyInfo?.recommended}
                <span class="badge badge-soft badge-primary badge-sm">{m.gallery_family_recommended()}</span>
              {/if}
            </div>
            <p class="text-base-content/60 text-xs tabular-nums">
              {m.gallery_global_stats({
                count: globalVariant.classes !== undefined ? formatNumber(globalVariant.classes) : '?',
                size: globalVariant.size_bytes !== undefined ? formatFileSize(globalVariant.size_bytes) : '?',
              })}
            </p>
          </div>
          <div class="shrink-0">
            {#if globalDownload}
              <div class="w-48">
                <DownloadProgress
                  download={globalDownload}
                  onCancel={() => {
                    onCancel(globalVariant);
                  }}
                />
              </div>
            {:else if installedGlobal}
              <span class="badge badge-success gap-1"><CircleCheckBig size={12} />{m.gallery_installedBadge()}</span>
            {:else}
              <button
                class="btn btn-primary btn-sm gap-1"
                disabled={installing}
                title={installing ? m.gallery_installAnotherRunning() : undefined}
                onclick={() => {
                  onInstall(globalVariant);
                }}
              >
                <DownloadIcon size={14} />{m.gallery_install()}
              </button>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- Continent sections -->
    {#each groups as g (g.slug)}
      <section>
        <div class="mb-2 flex items-center gap-2">
          <h3 class="text-base-content/60 text-xs font-semibold tracking-wide uppercase">
            {groupLabel(g.slug, g.name)}
          </h3>
          <span class="badge badge-ghost badge-sm">{g.items.length}</span>
          <div class="bg-base-300 h-px flex-1"></div>
        </div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {#each g.items as v (v.region)}
            <RegionCard
              variant={v}
              {family}
              installed={installedRegions.has(v.region ?? 'global')}
              download={downloads[variantKey(family, v.region)]}
              installDisabled={installing}
              onOpen={() => {
                onOpenRegion(v);
              }}
              onInstall={() => {
                onInstall(v);
              }}
              onCancel={() => {
                onCancel(v);
              }}
            />
          {/each}
        </div>
      </section>
    {/each}
  {/if}
</div>
