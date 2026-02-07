<script lang="ts">
  import { FileHeadphone, CircleCheckBig, CircleX } from '@lucide/svelte';
  import { analysisState } from '$lib/stores/analysis.svelte';
  import { formatNumber } from '$lib/utils/format';
  import * as m from '$paraglide/messages';

  const overallPercent = $derived(
    analysisState.totalFiles > 0 ? Math.round((analysisState.filesProcessed / analysisState.totalFiles) * 100) : 0,
  );
</script>

{#if analysisState.status !== 'idle'}
  <div class="space-y-2 border-t border-base-300 bg-base-200 p-3">
    <div class="flex items-center justify-between text-sm">
      <span class="font-medium text-base-content">
        {#if analysisState.status === 'running'}
          {m.status_analyzing()}
        {:else if analysisState.status === 'completed'}
          <span class="flex items-center gap-1 text-success">
            <CircleCheckBig size={16} />
            {m.progress_complete()}
          </span>
        {:else if analysisState.status === 'failed'}
          <span class="flex items-center gap-1 text-error">
            <CircleX size={16} />
            {m.progress_failed()}
          </span>
        {/if}
      </span>
      <span class="text-base-content/60">
        {m.progress_status({ processed: String(analysisState.filesProcessed), total: String(analysisState.totalFiles), detections: formatNumber(analysisState.totalDetections) })}
      </span>
    </div>

    <!-- Overall progress -->
    <progress
      class="progress w-full {analysisState.status === 'failed' ? 'progress-error' : 'progress-primary'}"
      value={overallPercent}
      max="100"
    ></progress>

    <!-- Current file progress -->
    {#if analysisState.currentFile}
      <div class="flex items-center gap-2 text-xs text-base-content/50">
        <FileHeadphone size={14} />
        <span class="flex-1 truncate">{analysisState.currentFile.path}</span>
        <span class="tabular-nums">{analysisState.currentFile.percent.toFixed(0)}%</span>
      </div>
      <progress
        class="progress progress-primary progress-xs w-full opacity-70"
        value={analysisState.currentFile.percent}
        max="100"
      ></progress>
    {/if}

    {#if analysisState.error}
      <div role="alert" class="alert alert-error py-2 text-xs">
        {analysisState.error}
      </div>
    {/if}
  </div>
{/if}
