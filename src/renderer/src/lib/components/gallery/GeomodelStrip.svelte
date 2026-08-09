<script lang="ts">
  import { Globe, CircleCheckBig, Download as DownloadIcon, TriangleAlert, Trash2 } from '@lucide/svelte';
  import * as m from '$paraglide/messages';

  const {
    status,
    version,
    size,
    nudge = false,
    busy = false,
    onInstall,
    onUpdate,
    onRemove,
  }: {
    status: 'absent' | 'installed' | 'update';
    version?: string;
    size?: string;
    nudge?: boolean;
    busy?: boolean;
    onInstall: () => void;
    onUpdate: () => void;
    onRemove: () => void;
  } = $props();
</script>

<div class="card border-base-300 bg-base-200 border {nudge ? 'ring-primary ring-2 motion-safe:animate-pulse' : ''}">
  <div class="card-body flex-row items-center gap-3 p-4">
    <div class="bg-primary/10 rounded-lg p-2.5">
      <Globe size={22} class="text-primary" />
    </div>
    <div class="min-w-0 flex-1">
      <h4 class="text-sm font-semibold">{m.gallery_geomodel_title()}</h4>
      {#if status === 'absent'}
        <p class="text-base-content/60 text-xs">{m.gallery_geomodel_description()}</p>
      {:else}
        <p class="text-base-content/60 text-xs">
          {m.gallery_geomodel_installedMeta({ version: version ?? '', size: size ?? '' })}
        </p>
      {/if}
      {#if nudge}
        <p class="text-primary mt-0.5 text-xs">{m.gallery_geomodel_nudge()}</p>
      {/if}
    </div>
    <div class="flex items-center gap-1.5">
      {#if status === 'absent'}
        <button class="btn btn-primary btn-sm gap-1" onclick={onInstall} disabled={busy}>
          <DownloadIcon size={14} />{m.gallery_install()}
        </button>
      {:else if status === 'update'}
        <span class="badge badge-warning badge-sm gap-1">
          <TriangleAlert size={10} />{m.gallery_updateAvailable({ version: version ?? '' })}
        </span>
        <button class="btn btn-primary btn-sm" onclick={onUpdate} disabled={busy}>{m.gallery_update()}</button>
      {:else}
        <span class="badge badge-success badge-sm gap-1">
          <CircleCheckBig size={10} />{m.gallery_installedBadge()}
        </span>
      {/if}
      {#if status !== 'absent'}
        <button
          class="btn btn-ghost btn-sm btn-square"
          onclick={onRemove}
          disabled={busy}
          aria-label={m.gallery_remove()}
          title={m.gallery_remove()}
        >
          <Trash2 size={14} />
        </button>
      {/if}
    </div>
  </div>
</div>
