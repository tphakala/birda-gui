<script lang="ts">
  import InstalledModelCard from './InstalledModelCard.svelte';
  import { Cpu } from '@lucide/svelte';
  import * as m from '$paraglide/messages';
  import { formatFileSize } from '$lib/utils/format';
  import { hasUpdate } from '$lib/gallery/logic';
  import type { InstalledModel, ModelManifest, ManifestVariant } from '$shared/types';

  const {
    installed,
    manifests,
    defaultId,
    busy,
    onSetDefault,
    onRemove,
    onUpdate,
    onBrowse,
  }: {
    installed: InstalledModel[];
    manifests: Record<string, ModelManifest>;
    defaultId: string;
    busy: boolean;
    onSetDefault: (id: string) => void;
    onRemove: (model: InstalledModel) => void;
    onUpdate: (model: InstalledModel) => void;
    onBrowse: () => void;
  } = $props();

  function manifestFor(model: InstalledModel): ModelManifest | undefined {
    return manifests[model.registry_id ?? model.model_type];
  }
  function variantFor(model: InstalledModel): ManifestVariant | undefined {
    return manifestFor(model)?.variants.find((v) => v.region === model.region);
  }
  function titleFor(model: InstalledModel): string {
    const base = manifestFor(model)?.name ?? model.id;
    const region = variantFor(model)?.region_name;
    return region ? `${base} · ${region}` : base;
  }
  function updateFor(model: InstalledModel): { available: boolean; latest?: string } {
    const man = manifestFor(model);
    if (!man || !hasUpdate(model, man)) return { available: false };
    return { available: true, latest: man.version };
  }

  const sorted = $derived(
    [...installed].sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      const byType = a.model_type.localeCompare(b.model_type);
      if (byType !== 0) return byType;
      return (a.region ?? '').localeCompare(b.region ?? '');
    }),
  );
</script>

{#if installed.length === 0}
  <div class="text-base-content/50 py-12 text-center">
    <Cpu size={40} class="mx-auto mb-3 opacity-30" />
    <p class="text-sm">{m.gallery_installed_empty_title()}</p>
    <p class="mt-1 text-xs">{m.gallery_installed_empty_body()}</p>
    <button class="btn btn-primary btn-sm mt-4" onclick={onBrowse}>{m.gallery_installed_empty_cta()}</button>
  </div>
{:else}
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
    {#each sorted as model (model.id)}
      {@const upd = updateFor(model)}
      {@const variant = variantFor(model)}
      <InstalledModelCard
        {model}
        title={titleFor(model)}
        family={manifestFor(model)?.id ?? model.model_type}
        regionName={variant?.region_name}
        size={variant?.size_bytes !== undefined ? formatFileSize(variant.size_bytes) : undefined}
        isDefault={model.id === defaultId}
        updateAvailable={upd.available}
        latestVersion={upd.latest}
        {busy}
        onSetDefault={() => {
          onSetDefault(model.id);
        }}
        onRemove={() => {
          onRemove(model);
        }}
        onUpdate={() => {
          onUpdate(model);
        }}
      />
    {/each}
  </div>
{/if}
