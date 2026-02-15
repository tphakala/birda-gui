<script lang="ts">
  import { appState } from '$lib/stores/app.svelte';
  import { formatNumber } from '$lib/utils/format';
  import { checkBirda } from '$lib/utils/ipc';
  import type { BirdaCheckResponse } from '$shared/types';
  import { TriangleAlert } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import * as m from '$paraglide/messages';

  let birdaStatus = $state<BirdaCheckResponse | null>(null);

  onMount(() => {
    let mounted = true;

    void (async () => {
      try {
        const result = await checkBirda();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (mounted) {
          birdaStatus = result;
        }
      } catch {
        // Silent fail - status bar is not critical
      }
    })();

    return () => {
      mounted = false;
    };
  });
</script>

<div class="border-base-300 bg-base-200 text-base-content/60 flex items-center gap-4 border-t px-3 py-1.5 text-xs">
  <span>
    {#if appState.isAnalysisRunning}
      <span class="bg-primary mr-1 inline-block h-2 w-2 animate-pulse rounded-full"></span>
      {m.status_analyzing()}
    {:else}
      {m.status_ready()}
    {/if}
  </span>

  <div class="bg-base-300 h-3 w-px"></div>

  <span>{m.status_detections({ count: formatNumber(appState.catalogStats.total_detections) })}</span>
  <span>{m.status_species({ count: formatNumber(appState.catalogStats.total_species) })}</span>
  <span>{m.status_locations({ count: formatNumber(appState.catalogStats.total_locations) })}</span>

  <div class="flex-1"></div>

  {#if birdaStatus?.available === false && birdaStatus.version && birdaStatus.minVersion}
    <span class="text-warning flex items-center gap-1.5" title="birda CLI update required: {birdaStatus.version} → {birdaStatus.minVersion}">
      <TriangleAlert size={14} />
      <span>birda {birdaStatus.version}</span>
    </span>
    <div class="bg-base-300 h-3 w-px"></div>
  {:else if birdaStatus?.version}
    <span title="birda CLI version">birda {birdaStatus.version}</span>
    <div class="bg-base-300 h-3 w-px"></div>
  {/if}

  <span>v1.0.0</span>
</div>
