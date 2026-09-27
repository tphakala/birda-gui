<script lang="ts">
  import { FileHeadphone, CircleCheckBig, CircleSlash, CircleX, X } from '@lucide/svelte';
  import { analysisState, dismissAnalysis } from '$lib/stores/analysis.svelte';
  import { appState } from '$lib/stores/app.svelte';
  import { formatNumber } from '$lib/utils/format';
  import * as m from '$paraglide/messages';

  const AUTO_DISMISS_DELAY_MS = 5000;

  const overallPercent = $derived(
    analysisState.totalFiles > 0 ? Math.round((analysisState.filesProcessed / analysisState.totalFiles) * 100) : 0,
  );

  // Auto-dismiss a clean success after a delay; one with failed files stays until dismissed.
  $effect(() => {
    if (analysisState.status === 'completed' && !analysisState.hadErrors && analysisState.filesFailed === 0) {
      const timer = setTimeout(dismissAnalysis, AUTO_DISMISS_DELAY_MS);
      return () => {
        clearTimeout(timer);
      };
    }
  });
</script>

{#if analysisState.status !== 'idle'}
  <div class="border-base-300 bg-base-200 space-y-2 border-t p-3">
    <div class="flex items-center justify-between text-sm">
      <span class="text-base-content flex items-center gap-1 font-medium">
        <!-- Mounted once the analysis reports it is running, so a later change to complete, failed or stopped is announced. -->
        <span role="status" class="flex items-center gap-1">
          {#if analysisState.status === 'running'}
            {appState.isAnalysisStopping ? m.analysis_stopping() : m.status_analyzing()}
          {:else if analysisState.status === 'completed'}
            <span class="text-success flex items-center gap-1">
              <CircleCheckBig size={16} />
              {analysisState.hadErrors ? m.progress_completeWithErrors() : m.progress_complete()}
            </span>
          {:else if analysisState.status === 'failed'}
            <span class="text-error flex items-center gap-1">
              <CircleX size={16} />
              {m.progress_failed()}
            </span>
          {:else if analysisState.status === 'stopped'}
            <span class="badge badge-warning gap-1">
              <CircleSlash size={14} />
              {analysisState.discarded ? m.progress_stoppedDiscarded() : m.progress_stopped()}
            </span>
          {/if}
          {#if analysisState.filesFailed > 0 && analysisState.status !== 'running'}
            <span class="text-error text-xs font-normal"
              >{m.progress_filesFailed({ count: formatNumber(analysisState.filesFailed) })}</span
            >
          {/if}
        </span>
        {#if analysisState.status !== 'running'}
          <button
            type="button"
            onclick={dismissAnalysis}
            class="btn btn-ghost btn-xs btn-square"
            aria-label={m.common_button_close()}
          >
            <X size={14} />
          </button>
        {/if}
      </span>
      <span class="text-base-content/60">
        {m.progress_status({
          processed: formatNumber(analysisState.filesProcessed),
          total: formatNumber(analysisState.totalFiles),
          detections: formatNumber(analysisState.totalDetections),
        })}
      </span>
    </div>

    <!-- Overall progress -->
    <progress
      class="progress w-full {analysisState.status === 'failed'
        ? 'progress-error'
        : analysisState.status === 'stopped'
          ? 'progress-warning'
          : 'progress-primary'}"
      value={overallPercent}
      max="100"
    ></progress>

    <!-- Current file progress -->
    {#if analysisState.currentFile}
      <div class="text-base-content/50 flex items-center gap-2 text-xs">
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
