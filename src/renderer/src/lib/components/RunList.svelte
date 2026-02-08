<script lang="ts">
  import { AudioLines, CircleAlert, Loader, X } from '@lucide/svelte';
  import { formatDate } from '$lib/utils/format';
  import type { RunWithStats } from '$shared/types';
  import * as m from '$paraglide/messages';

  const {
    runs,
    selectedRunId,
    onselect,
    ondelete,
    loading = false,
  }: {
    runs: RunWithStats[];
    selectedRunId: number | null;
    onselect: (runId: number) => void;
    ondelete?: (runId: number) => void;
    loading?: boolean;
  } = $props();

  function sourceName(sourcePath: string): string {
    return sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  }

  function detectionLabel(count: number): string {
    return count === 1
      ? m.runs_detectionCountSingular({ count: String(count) })
      : m.runs_detectionCount({ count: String(count) });
  }
</script>

<div class="border-base-300 bg-base-200 flex w-64 shrink-0 flex-col overflow-hidden border-r">
  <div class="border-base-300 flex items-center gap-1.5 border-b px-3 py-2">
    <h3 class="text-sm font-medium">{m.runs_title()}</h3>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#if loading}
      <div class="flex items-center justify-center py-8">
        <Loader size={20} class="text-base-content/40 animate-spin" />
      </div>
    {:else if runs.length === 0}
      <div class="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <AudioLines size={28} class="text-base-content/20" />
        <p class="text-base-content/50 text-sm">{m.runs_empty()}</p>
        <p class="text-base-content/30 text-xs">{m.runs_emptyHint()}</p>
      </div>
    {:else}
      {#each runs as run (run.id)}
        <div
          onclick={() => {
            onselect(run.id);
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (e.target === e.currentTarget) onselect(run.id);
            }
          }}
          role="button"
          tabindex="0"
          class="border-base-300 relative w-full cursor-pointer border-b px-3 py-2.5 text-left transition-colors
            {selectedRunId === run.id ? 'bg-primary/10 border-l-primary border-l-2' : 'hover:bg-base-300/50'}"
        >
          {#if run.status === 'failed' && ondelete}
            <button
              onclick={(e) => {
                e.stopPropagation();
                ondelete(run.id);
              }}
              class="text-base-content/30 hover:text-error absolute top-1.5 right-1.5 rounded p-0.5 transition-colors"
              title={m.runs_deleteRun()}
            >
              <X size={14} />
            </button>
          {/if}
          <div class="truncate text-sm font-medium">{sourceName(run.source_path)}</div>
          <div class="text-base-content/50 mt-0.5 flex items-center gap-1.5 text-xs">
            <span class="truncate">{run.model}</span>
            <span class="text-base-content/30">·</span>
            <span>{run.detection_count > 0 ? detectionLabel(run.detection_count) : m.runs_noDetections()}</span>
          </div>
          <div class="text-base-content/40 mt-0.5 flex items-center gap-1.5 text-xs">
            {#if run.location_name}
              <span class="truncate">{run.location_name}</span>
              <span class="text-base-content/30">·</span>
            {/if}
            {#if run.started_at}
              <span>{formatDate(run.started_at)}</span>
            {/if}
            {#if run.status === 'running'}
              <span class="badge badge-info badge-xs">{m.runs_status_running()}</span>
            {:else if run.status === 'failed'}
              <span class="badge badge-error badge-xs gap-0.5">
                <CircleAlert size={10} />
                {m.runs_status_failed()}
              </span>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>
