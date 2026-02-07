<script lang="ts">
  import { appState } from '$lib/stores/app.svelte';
  import { formatNumber } from '$lib/utils/format';
  import * as m from '$paraglide/messages';
</script>

<div class="flex items-center gap-4 border-t border-base-300 bg-base-200 px-3 py-1.5 text-xs text-base-content/60">
  <span>
    {#if appState.isAnalysisRunning}
      <span class="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-primary"></span>
      {m.status_analyzing()}
    {:else}
      {m.status_ready()}
    {/if}
  </span>

  <div class="h-3 w-px bg-base-300"></div>

  <span>{m.status_detections({ count: formatNumber(appState.catalogStats.total_detections) })}</span>
  <span>{m.status_species({ count: formatNumber(appState.catalogStats.total_species) })}</span>
  <span>{m.status_locations({ count: formatNumber(appState.catalogStats.total_locations) })}</span>

  <div class="flex-1"></div>
  <span>v0.1.0</span>
</div>
