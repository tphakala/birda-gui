<script lang="ts">
  import { Search, X, AudioLines, List } from '@lucide/svelte';
  import RunList from '$lib/components/RunList.svelte';
  import AnalysisTable from '$lib/components/AnalysisTable.svelte';
  import { appState } from '$lib/stores/app.svelte';
  import { getRuns, getDetections } from '$lib/utils/ipc';
  import { formatNumber, parseRecordingStart } from '$lib/utils/format';
  import type { EnrichedDetection, RunWithStats } from '$shared/types';
  import { onMount } from 'svelte';
  import * as m from '$paraglide/messages';

  // --- Run list state ---
  let runs = $state<RunWithStats[]>([]);
  let runsLoading = $state(true);

  // --- Detection results state ---
  let detections = $state<EnrichedDetection[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let sortColumn = $state('start_time');
  let sortDir = $state<'asc' | 'desc'>('asc');
  let offset = $state(0);
  const limit = 200;
  let speciesQuery = $state('');
  let ignoreConfidence = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  // --- Derived from selected run ---
  const selectedRun = $derived(runs.find((r) => r.id === appState.selectedRunId) ?? null);
  const sourceFileName = $derived(selectedRun ? (selectedRun.source_path.split(/[\\/]/).pop() ?? '') : '');
  const recordingStart = $derived(sourceFileName ? parseRecordingStart(sourceFileName) : null);

  async function refreshRuns() {
    try {
      runs = await getRuns();
    } catch {
      runs = [];
    } finally {
      runsLoading = false;
    }
  }

  async function loadRunDetections() {
    if (!appState.selectedRunId) return;
    loading = true;
    try {
      const result = await getDetections({
        run_id: appState.selectedRunId,
        min_confidence: ignoreConfidence ? undefined : appState.minConfidence,
        species: speciesQuery || undefined,
        sort_column: sortColumn,
        sort_dir: sortDir,
        limit,
        offset,
      });
      detections = result.detections;
      total = result.total;
    } catch {
      detections = [];
      total = 0;
    } finally {
      loading = false;
    }
  }

  function handleRunSelect(runId: number) {
    appState.selectedRunId = runId;
  }

  function handleSort(column: string) {
    if (sortColumn === column) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortColumn = column;
      sortDir = column === 'start_time' ? 'asc' : 'desc';
    }
    offset = 0;
    void loadRunDetections();
  }

  function handlePage(newOffset: number) {
    offset = newOffset;
    void loadRunDetections();
  }

  function handleSpeciesInput() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      offset = 0;
      void loadRunDetections();
    }, 250);
  }

  function clearSpeciesFilter() {
    speciesQuery = '';
    offset = 0;
    void loadRunDetections();
  }

  // React to selectedRunId changes
  let prevSelectedRunId: number | null = null;
  $effect(() => {
    if (appState.selectedRunId !== prevSelectedRunId) {
      prevSelectedRunId = appState.selectedRunId;
      offset = 0;
      speciesQuery = '';
      ignoreConfidence = false;
      void loadRunDetections();
      // Refresh runs list only if the selected run is not already in our list
      if (appState.selectedRunId && !runs.some((r) => r.id === appState.selectedRunId)) {
        void refreshRuns();
      }
    }
  });

  // React to confidence changes
  let prevConfidence: number | null = null;
  $effect(() => {
    if (appState.minConfidence !== prevConfidence) {
      prevConfidence = appState.minConfidence;
      if (appState.selectedRunId) {
        offset = 0;
        void loadRunDetections();
      }
    }
  });

  onMount(() => {
    void refreshRuns();
    if (appState.selectedRunId) {
      void loadRunDetections();
    }
  });
</script>

<div class="flex flex-1 overflow-hidden">
  <RunList {runs} selectedRunId={appState.selectedRunId} onselect={handleRunSelect} loading={runsLoading} />

  {#if appState.selectedRunId && selectedRun}
    <div class="flex flex-1 flex-col overflow-hidden">
      <!-- Filter bar -->
      <div class="border-base-300 bg-base-200/50 flex items-center gap-3 border-b px-4 py-2 text-sm">
        <AudioLines size={16} class="text-primary shrink-0" />
        <span class="font-medium">{sourceFileName}</span>
        <span class="text-base-content/40">|</span>
        <span class="text-base-content/60"
          >{total === 1
            ? m.pagination_detectionCountSingular({ count: formatNumber(total) })
            : m.pagination_detectionCount({ count: formatNumber(total) })}</span
        >

        <!-- Species filter -->
        <div class="relative ml-3">
          <Search size={14} class="text-base-content/40 absolute top-1/2 left-2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={m.analysis_filterByName()}
            bind:value={speciesQuery}
            oninput={handleSpeciesInput}
            class="input input-bordered input-sm w-48 pr-7 pl-7 text-xs"
          />
          {#if speciesQuery}
            <button
              onclick={clearSpeciesFilter}
              class="text-base-content/40 hover:text-base-content absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5"
            >
              <X size={12} />
            </button>
          {/if}
        </div>

        <!-- Ignore confidence checkbox -->
        <label
          class="text-base-content/60 flex shrink-0 cursor-pointer items-center gap-1 text-xs select-none"
          title={m.analysis_allConfidences()}
        >
          <input
            type="checkbox"
            bind:checked={ignoreConfidence}
            onchange={() => {
              offset = 0;
              void loadRunDetections();
            }}
            class="checkbox checkbox-xs checkbox-primary"
          />
          {m.analysis_allConfidences()}
        </label>

        <div class="flex-1"></div>

        <!-- Confidence filter -->
        <label class="text-base-content/60 flex shrink-0 items-center gap-1.5" title={m.filter_minConfidence()}>
          {m.analysis_conf()}
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={appState.minConfidence}
            class="range range-primary range-xs w-24"
          />
          <span class="w-10 text-xs tabular-nums">{(appState.minConfidence * 100).toFixed(0)}%</span>
        </label>
      </div>

      <AnalysisTable
        {detections}
        {total}
        {loading}
        sourceFile={selectedRun.source_path}
        {recordingStart}
        {sortColumn}
        {sortDir}
        {offset}
        {limit}
        onsort={handleSort}
        onpage={handlePage}
      />
    </div>
  {:else}
    <!-- No run selected -->
    <div class="flex flex-1 flex-col items-center justify-center gap-3">
      <List size={40} class="text-base-content/15" />
      <p class="text-base-content/40 text-sm">{m.runs_selectRun()}</p>
    </div>
  {/if}
</div>
