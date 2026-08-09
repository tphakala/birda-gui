<script lang="ts">
  import CoverageMap from './CoverageMap.svelte';
  import { Cpu, Globe, CircleCheckBig, TriangleAlert, Trash2 } from '@lucide/svelte';
  import * as m from '$paraglide/messages';
  import type { InstalledModel } from '$shared/types';

  const {
    model,
    title,
    family,
    regionName,
    size,
    isDefault,
    updateAvailable,
    latestVersion,
    busy = false,
    onSetDefault,
    onRemove,
    onUpdate,
  }: {
    model: InstalledModel;
    title: string;
    family: string;
    regionName?: string;
    size?: string;
    isDefault: boolean;
    updateAvailable: boolean;
    latestVersion?: string;
    busy?: boolean;
    onSetDefault: () => void;
    onRemove: () => void;
    onUpdate: () => void;
  } = $props();

  const provenance = $derived.by(() => {
    const parts: string[] = [];
    if (model.installed_version) {
      parts.push(
        model.installed_build !== undefined
          ? m.gallery_provenance({ version: model.installed_version, build: model.installed_build })
          : `v${model.installed_version}`,
      );
    }
    if (model.variant) parts.push(model.variant.toUpperCase());
    if (size) parts.push(m.gallery_sizeOnDisk({ size }));
    return parts.join(' · ');
  });
</script>

<div class="card border-base-300 bg-base-200 border">
  <div class="card-body gap-3 p-4">
    <div class="flex items-start gap-3">
      {#if model.region}
        <div class="w-16 shrink-0">
          <CoverageMap {family} region={model.region} regionName={regionName ?? model.region} />
        </div>
      {:else}
        <div class="bg-primary/10 shrink-0 rounded-lg p-2.5">
          {#if family.includes('perch') || family.includes('birdnet')}
            <Globe size={22} class="text-primary" />
          {:else}
            <Cpu size={22} class="text-primary" />
          {/if}
        </div>
      {/if}
      <div class="min-w-0 flex-1">
        <h4 class="truncate text-sm font-semibold">{title}</h4>
        {#if provenance}
          <p class="text-base-content/60 mt-0.5 text-xs tabular-nums">{provenance}</p>
        {/if}
        {#if updateAvailable}
          <span class="badge badge-warning badge-sm mt-1 gap-1">
            <TriangleAlert size={10} />{m.gallery_updateAvailable({ version: latestVersion ?? '' })}
          </span>
        {/if}
      </div>
    </div>

    <div class="border-base-300 flex items-center justify-between border-t pt-3">
      <div class="flex items-center gap-1.5">
        {#if updateAvailable}
          <button class="btn btn-primary btn-xs" onclick={onUpdate} disabled={busy}>{m.gallery_update()}</button>
        {/if}
        <button
          class="btn btn-xs {isDefault ? 'btn-primary' : 'btn-ghost'}"
          onclick={onSetDefault}
          disabled={busy || isDefault}
        >
          {#if isDefault}
            <CircleCheckBig size={12} />{m.gallery_default()}
          {:else}
            {m.gallery_setDefault()}
          {/if}
        </button>
      </div>
      <button
        class="btn btn-ghost btn-xs btn-square"
        onclick={onRemove}
        disabled={busy || isDefault}
        aria-label={isDefault ? m.gallery_removeDisabledDefault() : m.gallery_remove()}
        title={isDefault ? m.gallery_removeDisabledDefault() : m.gallery_remove()}
      >
        <Trash2 size={13} />
      </button>
    </div>
  </div>
</div>
