<script lang="ts">
  import { Search, X, AudioLines, List, Table2, LayoutGrid, Grid3x3 } from '@lucide/svelte';
  import RunList from '$lib/components/RunList.svelte';
  import AnalysisTable from '$lib/components/AnalysisTable.svelte';
  import SpeciesCards from '$lib/components/SpeciesCards.svelte';
  import DetectionHeatmap from '$lib/components/DetectionHeatmap.svelte';
  import { appState } from '$lib/stores/app.svelte';
  import {
    getRuns,
    getDetections,
    getRunSpecies,
    getHourlyDetections,
    deleteRun,
    getCatalogStats,
    getSpeciesLists,
  } from '$lib/utils/ipc';
  import { formatNumber } from '$lib/utils/format';
  import type {
    EnrichedDetection,
    RunWithStats,
    SpeciesList,
    RunSpeciesAggregation,
    HourlyDetectionCell,
  } from '$shared/types';
  import { onMount } from 'svelte';
  import * as m from '$paraglide/messages';

  // --- Run list state ---
  let runs = $state<RunWithStats[]>([]);
  let runsLoading = $state(true);

  // --- View state ---
  type DetectionView = 'table' | 'species' | 'grid';
  let activeView = $state<DetectionView>('table');

  // --- Detection results state (table view) ---
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
  let confidenceTimeout: ReturnType<typeof setTimeout> | null = null;

  // --- Species view state ---
  let speciesData = $state<RunSpeciesAggregation[]>([]);
  let speciesLoading = $state(false);
  let speciesSortBy = $state<'count' | 'name' | 'confidence'>('count');

  // --- Grid view state ---
  let gridData = $state<HourlyDetectionCell[]>([]);
  let gridLoading = $state(false);

  // --- Species list filter state ---
  let speciesLists = $state<SpeciesList[]>([]);
  let speciesListFilterId = $state(0);

  // --- Derived from selected run ---
  const selectedRun = $derived(runs.find((r) => r.id === appState.selectedRunId) ?? null);
  const sourceFileName = $derived(selectedRun ? (selectedRun.source_path.split(/[\\/]/).pop() ?? '') : '');

  // --- Contextual header count ---
  const headerCount = $derived.by(() => {
    switch (activeView) {
      case 'table':
        return total === 1
          ? m.pagination_detectionCountSingular({ count: formatNumber(total) })
          : m.pagination_detectionCount({ count: formatNumber(total) });
      case 'species':
        return m.pagination_speciesCount({ count: formatNumber(speciesData.length) });
      case 'grid': {
        const uniqueSpecies = new Set(gridData.map((c) => c.scientific_name)).size;
        return m.pagination_speciesCount({ count: formatNumber(uniqueSpecies) });
      }
    }
  });

  // --- Shared filter builder ---
  function buildBaseFilter() {
    return {
      run_id: appState.selectedRunId ?? 0,
      min_confidence: ignoreConfidence ? undefined : appState.minConfidence,
      species: speciesQuery || undefined,
      species_list_id: speciesListFilterId || undefined,
    };
  }

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
        ...buildBaseFilter(),
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

  async function loadSpeciesView() {
    if (!appState.selectedRunId) return;
    speciesLoading = true;
    try {
      speciesData = await getRunSpecies({
        ...buildBaseFilter(),
        sort_column:
          speciesSortBy === 'count'
            ? 'detection_count'
            : speciesSortBy === 'name'
              ? 'scientific_name'
              : 'avg_confidence',
        sort_dir: speciesSortBy === 'name' ? 'asc' : 'desc',
      });
    } catch {
      speciesData = [];
    } finally {
      speciesLoading = false;
    }
  }

  async function loadGridView() {
    if (!appState.selectedRunId) return;
    gridLoading = true;
    try {
      gridData = await getHourlyDetections(buildBaseFilter());
    } catch {
      gridData = [];
    } finally {
      gridLoading = false;
    }
  }

  function loadActiveView() {
    switch (activeView) {
      case 'table':
        void loadRunDetections();
        break;
      case 'species':
        void loadSpeciesView();
        break;
      case 'grid':
        void loadGridView();
        break;
    }
  }

  function switchView(view: DetectionView) {
    if (view === activeView) return;
    activeView = view;
    loadActiveView();
  }

  function handleRunSelect(runId: number) {
    appState.selectedRunId = runId;
  }

  async function handleRunDelete(runId: number) {
    try {
      await deleteRun(runId);
      runs = runs.filter((r) => r.id !== runId);
      if (appState.selectedRunId === runId) {
        appState.selectedRunId = null;
      }
      appState.catalogStats = await getCatalogStats();
    } catch (error) {
      console.error('Failed to delete run', runId, error);
    }
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
      loadActiveView();
    }, 250);
  }

  function clearSpeciesFilter() {
    speciesQuery = '';
    offset = 0;
    loadActiveView();
  }

  function handleSpeciesSortChange(sort: 'count' | 'name' | 'confidence') {
    speciesSortBy = sort;
    void loadSpeciesView();
  }

  // React to selectedRunId changes
  let prevSelectedRunId: number | null = null;
  $effect(() => {
    if (appState.selectedRunId !== prevSelectedRunId) {
      prevSelectedRunId = appState.selectedRunId;
      offset = 0;
      speciesQuery = '';
      ignoreConfidence = false;
      speciesData = [];
      gridData = [];
      // Fall back from grid view if the new run is a directory
      if (activeView === 'grid' && selectedRun?.is_directory) {
        activeView = 'table';
      }
      loadActiveView();
      // Refresh runs list only if the selected run is not already in our list
      if (appState.selectedRunId && !runs.some((r) => r.id === appState.selectedRunId)) {
        void refreshRuns();
      }
    }
  });

  // React to confidence changes (debounced for slider dragging)
  let prevConfidence = appState.minConfidence;
  $effect(() => {
    if (appState.minConfidence !== prevConfidence) {
      prevConfidence = appState.minConfidence;
      if (appState.selectedRunId) {
        if (confidenceTimeout) clearTimeout(confidenceTimeout);
        confidenceTimeout = setTimeout(() => {
          offset = 0;
          loadActiveView();
        }, 200);
      }
    }
  });

  onMount(() => {
    void refreshRuns();
    void (async () => {
      try {
        speciesLists = await getSpeciesLists();
      } catch {
        // no lists yet
      }
    })();
  });

  // React to species list from Species page (selectedSpeciesListId used as cross-tab intent)
  $effect(() => {
    if (appState.activeTab === 'detections' && appState.selectedSpeciesListId !== null) {
      speciesListFilterId = appState.selectedSpeciesListId;
      appState.selectedSpeciesListId = null;
      offset = 0;
      // Refresh lists so the dropdown includes any newly created list
      getSpeciesLists()
        .then((l) => (speciesLists = l))
        .catch(() => {
          /* ignore */
        });
      loadActiveView();
    }
  });
</script>

<div class="flex flex-1 overflow-hidden">
  <RunList
    {runs}
    selectedRunId={appState.selectedRunId}
    onselect={handleRunSelect}
    ondelete={handleRunDelete}
    loading={runsLoading}
  />

  {#if appState.selectedRunId && selectedRun}
    <div class="flex flex-1 flex-col overflow-hidden">
      <!-- Header row -->
      <div class="border-base-300 bg-base-200/50 flex items-center gap-3 border-b px-4 py-2 text-sm">
        <AudioLines size={16} class="text-primary shrink-0" />

        {#if selectedRun.is_directory}
          <span class="font-medium truncate" title={selectedRun.source_path}>{selectedRun.source_path}</span>
          <span class="text-base-content/40">|</span>
          <span class="text-base-content/60">{selectedRun.file_count} files</span>
        {:else}
          <span class="font-medium">{sourceFileName}</span>
        {/if}

        <span class="text-base-content/40">|</span>
        <span class="text-base-content/60">{headerCount}</span>

        <div class="flex-1"></div>

        <!-- View toggle -->
        <div class="join">
          <button
            class="btn btn-sm join-item {activeView === 'table' ? 'btn-active' : ''}"
            onclick={() => {
              switchView('table');
            }}
            title={m.view_table()}
          >
            <Table2 size={14} />
            <span class="hidden sm:inline">{m.view_table()}</span>
          </button>
          <button
            class="btn btn-sm join-item {activeView === 'species' ? 'btn-active' : ''}"
            onclick={() => {
              switchView('species');
            }}
            title={m.view_species()}
          >
            <LayoutGrid size={14} />
            <span class="hidden sm:inline">{m.view_species()}</span>
          </button>
          <div class="tooltip tooltip-left" data-tip={selectedRun.is_directory ? m.grid_noTimestamp() : ''}>
            <button
              class="btn btn-sm join-item {activeView === 'grid' ? 'btn-active' : ''}"
              disabled={selectedRun.is_directory}
              onclick={() => {
                switchView('grid');
              }}
              title={!selectedRun.is_directory ? m.view_grid() : undefined}
            >
              <Grid3x3 size={14} class={selectedRun.is_directory ? 'opacity-40' : ''} />
              <span class="hidden sm:inline {selectedRun.is_directory ? 'line-through opacity-40' : ''}">{m.view_grid()}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Filter row -->
      <div class="border-base-300 bg-base-200/30 flex items-center gap-3 border-b px-4 py-1.5 text-sm">
        <!-- Species filter -->
        <div class="relative">
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
              loadActiveView();
            }}
            class="checkbox checkbox-xs checkbox-primary"
          />
          {m.analysis_allConfidences()}
        </label>

        <!-- Species list filter -->
        {#if speciesLists.length > 0}
          <select
            bind:value={speciesListFilterId}
            onchange={() => {
              offset = 0;
              loadActiveView();
            }}
            class="select select-bordered select-sm text-xs"
          >
            <option value={0}>{m.species_allSpecies()}</option>
            {#each speciesLists as list (list.id)}
              <option value={list.id}>{list.name} ({list.species_count})</option>
            {/each}
          </select>
        {/if}

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

      <!-- View content -->
      {#if activeView === 'table'}
        <AnalysisTable
          {detections}
          {total}
          {loading}
          isDirectory={selectedRun.is_directory}
          {sortColumn}
          {sortDir}
          {offset}
          {limit}
          onsort={handleSort}
          onpage={handlePage}
        />
      {:else if activeView === 'species'}
        <SpeciesCards
          species={speciesData}
          loading={speciesLoading}
          sortBy={speciesSortBy}
          onsortchange={handleSpeciesSortChange}
        />
      {:else}
        <DetectionHeatmap
          cells={gridData}
          loading={gridLoading}
          latitude={selectedRun.latitude}
          longitude={selectedRun.longitude}
          recordingDate={null}
          timezoneOffsetMin={selectedRun.timezone_offset_min}
        />
      {/if}
    </div>
  {:else}
    <!-- No run selected -->
    <div class="flex flex-1 flex-col items-center justify-center gap-3">
      <List size={40} class="text-base-content/15" />
      <p class="text-base-content/40 text-sm">{m.runs_selectRun()}</p>
    </div>
  {/if}
</div>
