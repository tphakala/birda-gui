<script lang="ts">
  import { X } from '@lucide/svelte';
  import * as m from '$paraglide/messages';
  import { formatFileSize } from '$lib/utils/format';
  import type { Download } from '$lib/stores/gallery.svelte';

  const { download, onCancel }: { download: Download; onCancel: () => void } = $props();
</script>

<div class="flex items-center gap-2">
  <div class="min-w-0 flex-1">
    {#if download.percent !== undefined}
      <progress
        class="progress progress-primary h-2 w-full"
        value={download.percent}
        max="100"
        aria-label={m.gallery_installing()}
      ></progress>
    {:else}
      <progress class="progress progress-primary h-2 w-full" aria-label={m.gallery_installing()}></progress>
    {/if}
    {#if download.bytesDone !== undefined && download.bytesTotal !== undefined}
      <p class="text-base-content/60 mt-1 text-xs tabular-nums">
        {m.gallery_download_progress({
          done: formatFileSize(download.bytesDone),
          total: formatFileSize(download.bytesTotal),
        })}
      </p>
    {:else}
      <p class="text-base-content/60 mt-1 text-xs">{m.gallery_installing()}</p>
    {/if}
  </div>
  <button
    class="btn btn-ghost btn-xs btn-square"
    onclick={onCancel}
    aria-label={m.gallery_download_cancel()}
    title={m.gallery_download_cancel()}
  >
    <X size={14} />
  </button>
</div>
