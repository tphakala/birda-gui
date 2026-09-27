<script lang="ts">
  import { AudioLines, CircleAlert, CircleSlash, Loader, Trash } from '@lucide/svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { tick } from 'svelte';
  import { focusIfLost } from '$lib/utils/dialog';
  import { formatDate, formatNumber } from '$lib/utils/format';
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
    ondelete?: (runId: number) => Promise<void>;
    loading?: boolean;
  } = $props();

  function sourceName(sourcePath: string): string {
    return sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  }

  // A run is deleted only after a confirmation; its audio files and annotations go with it.
  let confirmOpen = $state(false);
  let pendingDelete = $state<RunWithStats | null>(null);
  let listHeading = $state<HTMLHeadingElement | undefined>();

  async function deleteRun(run: RunWithStats) {
    await ondelete?.(run.id);
    // The deleted row held focus; once it is gone, keep focus in the list.
    await tick();
    focusIfLost(listHeading);
  }

  function requestDelete(run: RunWithStats) {
    // Even a run with no detections can hold audio files and their annotations.
    pendingDelete = run;
    confirmOpen = true;
  }

  function confirmDelete() {
    const run = pendingDelete;
    pendingDelete = null;
    confirmOpen = false;
    if (run) void deleteRun(run);
  }

  function cancelDelete() {
    pendingDelete = null;
    confirmOpen = false;
  }

  function detectionLabel(count: number): string {
    return count === 1
      ? m.runs_detectionCountSingular({ count: formatNumber(count) })
      : m.runs_detectionCount({ count: formatNumber(count) });
  }
</script>

<div class="border-base-300 bg-base-200 flex w-64 shrink-0 flex-col overflow-hidden border-r">
  <div class="border-base-300 flex items-center gap-1.5 border-b px-3 py-2">
    <h3
      bind:this={listHeading}
      tabindex="-1"
      class="focus-visible:outline-primary text-sm font-medium focus-visible:outline-2"
    >
      {m.runs_title()}
    </h3>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#if loading}
      <div class="flex items-center justify-center py-8">
        <Loader size={20} class="text-base-content/40 motion-safe:animate-spin" />
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
          class="border-base-300 relative w-full border-b transition-colors
            {selectedRunId === run.id ? 'bg-primary/10 border-l-primary border-l-2' : 'hover:bg-base-300/50'}"
        >
          <button
            type="button"
            onclick={() => {
              onselect(run.id);
            }}
            aria-current={selectedRunId === run.id ? 'true' : undefined}
            class="w-full cursor-pointer px-3 py-2.5 text-left"
          >
            <span class="block truncate text-sm font-medium">{sourceName(run.source_path)}</span>
            <span class="text-base-content/50 mt-0.5 flex items-center gap-1.5 text-xs">
              <span class="truncate">{run.model}</span>
              <span class="text-base-content/30">·</span>
              <span>{run.detection_count > 0 ? detectionLabel(run.detection_count) : m.runs_noDetections()}</span>
            </span>
            <span class="text-base-content/40 mt-0.5 flex items-center gap-1.5 text-xs">
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
              {:else if run.status === 'cancelled'}
                <span class="badge badge-warning badge-xs gap-0.5">
                  <CircleSlash size={10} />
                  {m.runs_status_cancelled()}
                </span>
              {/if}
            </span>
          </button>
          {#if (run.status === 'failed' || run.status === 'cancelled') && ondelete}
            <button
              type="button"
              onclick={() => {
                requestDelete(run);
              }}
              class="text-base-content/30 hover:text-error absolute top-1.5 right-1.5 rounded p-0.5 transition-colors"
              title={m.runs_deleteRun()}
              aria-label={m.runs_deleteRun()}
            >
              <Trash size={14} />
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<Modal
  bind:open={confirmOpen}
  title={m.runs_confirmDelete_title()}
  icon={Trash}
  iconClass="text-error"
  descriptionId="run-delete-body"
  alert
  showCloseButton={false}
>
  <p id="run-delete-body" class="text-base-content/80 text-sm">
    {#if pendingDelete}
      {m.runs_confirmDelete_body({
        source: sourceName(pendingDelete.source_path),
        detections: detectionLabel(pendingDelete.detection_count),
      })}
    {/if}
  </p>
  {#snippet actions()}
    <button type="button" class="btn btn-sm" onclick={cancelDelete}>{m.common_button_cancel()}</button>
    <button type="button" class="btn btn-error btn-sm" onclick={confirmDelete}>{m.runs_deleteRun()}</button>
  {/snippet}
</Modal>
