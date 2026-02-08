<script lang="ts">
  import { appState } from '$lib/stores/app.svelte';
  import { formatNumber } from '$lib/utils/format';
  import * as m from '$paraglide/messages';
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
  <span>v1.0.0</span>
</div>
