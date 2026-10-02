<script lang="ts">
  import { Search, X, AudioLines, List, Table2, LayoutGrid, Grid3x3, Clock, TriangleAlert } from '@lucide/svelte';
  import RunList from '$lib/components/RunList.svelte';
  import AnalysisTable from '$lib/components/AnalysisTable.svelte';
  import SpeciesCards from '$lib/components/SpeciesCards.svelte';
  import DetectionHeatmap from '$lib/components/DetectionHeatmap.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import TimeZoneSelect from '$lib/components/TimeZoneSelect.svelte';
  import { appState, catalogChanged } from '$lib/stores/app.svelte';
  import { showToast } from '$lib/stores/toast.svelte';
  import { dismissAnalysis } from '$lib/stores/analysis.svelte';
  import {
    getRuns,
    getDetections,
    getRunSpecies,
    getHourlyDetections,
    deleteRun,
    getSpeciesLists,
    setRunTimezone,
  } from '$lib/utils/ipc';
  import { formatNumber } from '$lib/utils/format';
  import { displayZone, offsetLabel, parseStoredInstant, wallClockAt } from '$shared/time-zone';
  import { latestRequest } from '$lib/utils/latest';
  import { keepIfPresent, reconcileSelectedRun } from '$lib/utils/selection';
  import type {
    EnrichedDetection,
    RunWithStats,
    SpeciesList,
    RunSpeciesAggregation,
    HourlyDetectionCell,
  } from '$shared/types';
  import { untrack } from 'svelte';
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
  // The run's clock: its zone, else the offset of its files (UTC when they have none).
  const runZone = $derived(selectedRun ? displayZone(selectedRun.timezone, selectedRun.timezone_offset_min) : null);
  // The grid needs recording starts; files without one are left out of it.
  const gridAvailable = $derived((selectedRun?.timed_file_count ?? 0) > 0);
  // The day the sun phases are drawn for, in the run's clock. A run whose
  // recordings start on different days has no single day, so it gets no phases.
  const sunDate = $derived.by(() => {
    const first = parseStoredInstant(selectedRun?.first_recording_start ?? null);
    const last = parseStoredInstant(selectedRun?.last_recording_start ?? null);
    if (first === null || last === null || runZone === null) return null;
    const a = wallClockAt(first, runZone);
    const b = wallClockAt(last, runZone);
    if (a.year !== b.year || a.month !== b.month || a.day !== b.day) return null;
    return { year: a.year, month: a.month, day: a.day };
  });
  // What the zone button shows: the run's zone, else the fixed offset its files are shown in.
  const runZoneLabel = $derived(selectedRun?.timezone ?? offsetLabel(selectedRun?.timezone_offset_min ?? 0));

  // --- Run time zone dialog ---
  let zoneDialogOpen = $state(false);
  let zoneChoice = $state('UTC');
  let zoneSaving = $state(false);

  // A run without a zone shows its files in a fixed offset that no zone stands
  // for, so the dialog makes the user pick one instead of preselecting UTC.
  function openZoneDialog() {
    zoneChoice = selectedRun?.timezone ?? '';
    zoneDialogOpen = true;
  }

  async function applyZone() {
    if (!selectedRun) return;
    zoneSaving = true;
    try {
      await setRunTimezone(selectedRun.id, zoneChoice);
      zoneDialogOpen = false;
      catalogChanged();
    } catch (error) {
      showToast(m.detections_timezoneFailed({ error: error instanceof Error ? error.message : String(error) }), {
        severity: 'error',
      });
    } finally {
      zoneSaving = false;
    }
  }

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

  // One getRuns at a time: an analysis that ends and selects its new run asks
  // for the list twice in the same moment. A call made while one is in flight
  // asks for one more load after it, so no caller gets a list from before its change.
  let runsRequest: Promise<void> | null = null;
  let runsWanted = 0;

  function refreshRuns(): Promise<void> {
    runsWanted++;
    if (runsRequest) return runsRequest;
    runsRequest = (async () => {
      let loaded;
      do {
        loaded = runsWanted;
        await loadRuns();
      } while (runsWanted !== loaded);
    })().finally(() => {
      runsRequest = null;
    });
    return runsRequest;
  }

  async function loadRuns() {
    const selectedAtStart = appState.selectedRunId;
    const previous = runs.find((r) => r.id === selectedAtStart);
    try {
      runs = await getRuns();
      // A selection made during the request is newer than this list; leave it.
      // If the selected run is gone (e.g. replaced by a newer analysis of the
      // same source and model), this selects that one, or nothing.
      if (appState.selectedRunId === selectedAtStart) {
        appState.selectedRunId = reconcileSelectedRun(selectedAtStart, previous, runs);
      }
    } catch {
      runs = [];
    } finally {
      runsLoading = false;
    }
    // A run that just finished is only known now; one without timed files has no grid.
    if (fallBackFromGrid()) loadActiveView();
  }

  // Counts selections, so a reload of the runs that a newer selection overtook does not load the old run again.
  let selectionSeq = 0;

  // Reload the run list whenever the catalog's runs change, and the shown
  // detections when the selected run survives (a Stop can discard its rows).
  // The first run of this effect is the initial load.
  $effect(() => {
    const _version = appState.runsVersion; // re-run when the runs change
    untrack(() => {
      void onRunsChanged();
    });
  });

  async function onRunsChanged() {
    const seq = selectionSeq;
    const selected = appState.selectedRunId;
    await refreshRuns();
    // A selection made meanwhile is loaded by onRunSelected.
    if (seq === selectionSeq && selected !== null && appState.selectedRunId === selected) loadActiveView();
  }

  /** A run without timed files has no grid view: show the table instead. Returns whether the view changed. */
  function fallBackFromGrid(): boolean {
    if (activeView === 'grid' && selectedRun && !gridAvailable) {
      activeView = 'table';
      return true;
    }
    return false;
  }

  // Loads overlap when filters change quickly or a run is replaced; only the newest of each kind applies its result.
  const detectionsRequest = latestRequest();
  const speciesRequest = latestRequest();
  const gridRequest = latestRequest();

  async function loadRunDetections() {
    const isLatest = detectionsRequest();
    if (!appState.selectedRunId) {
      loading = false;
      return;
    }
    loading = true;
    try {
      const result = await getDetections({
        ...buildBaseFilter(),
        sort_column: sortColumn,
        sort_dir: sortDir,
        limit,
        offset,
      });
      if (!isLatest()) return;
      detections = result.detections;
      total = result.total;
    } catch {
      if (!isLatest()) return;
      detections = [];
      total = 0;
    } finally {
      if (isLatest()) loading = false;
    }
  }

  async function loadSpeciesView() {
    const isLatest = speciesRequest();
    if (!appState.selectedRunId) {
      speciesLoading = false;
      return;
    }
    speciesLoading = true;
    try {
      const result = await getRunSpecies({
        ...buildBaseFilter(),
        sort_column:
          speciesSortBy === 'count'
            ? 'detection_count'
            : speciesSortBy === 'name'
              ? 'scientific_name'
              : 'avg_confidence',
        sort_dir: speciesSortBy === 'name' ? 'asc' : 'desc',
      });
      if (!isLatest()) return;
      speciesData = result;
    } catch {
      if (isLatest()) speciesData = [];
    } finally {
      if (isLatest()) speciesLoading = false;
    }
  }

  async function loadGridView() {
    const isLatest = gridRequest();
    if (!appState.selectedRunId) {
      gridLoading = false;
      return;
    }
    gridLoading = true;
    try {
      const result = await getHourlyDetections(buildBaseFilter());
      if (!isLatest()) return;
      gridData = result;
    } catch {
      if (isLatest()) gridData = [];
    } finally {
      if (isLatest()) gridLoading = false;
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

  async function handleRunDelete(runId: number): Promise<void> {
    try {
      await deleteRun(runId);
      runs = runs.filter((r) => r.id !== runId);
      if (appState.selectedRunId === runId) {
        appState.selectedRunId = null;
      }
      catalogChanged();
      // A finished analysis's panel may describe results that are gone now.
      dismissAnalysis();
    } catch (error) {
      console.error('Failed to delete run', runId, error);
      showToast(m.runs_deleteFailed(), { severity: 'error' });
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

  // Reset the view and load the run whenever the selected run changes. The first
  // run of this effect covers a run that was already selected when the page mounted.
  $effect(() => {
    const id = appState.selectedRunId;
    untrack(() => {
      onRunSelected(id);
    });
  });

  function onRunSelected(id: number | null) {
    selectionSeq++;
    offset = 0;
    speciesQuery = '';
    ignoreConfidence = false;
    speciesData = [];
    gridData = [];
    fallBackFromGrid();
    loadActiveView();
    // Refresh runs list only if the selected run is not already in our list
    if (id !== null && !runs.some((r) => r.id === id)) void refreshRuns();
  }

  // The slider is dragged, so the reload waits until it settles.
  function handleConfidenceInput() {
    if (!appState.selectedRunId) return;
    if (confidenceTimeout) clearTimeout(confidenceTimeout);
    confidenceTimeout = setTimeout(() => {
      offset = 0;
      loadActiveView();
    }, 200);
  }

  const listsRequest = latestRequest();

  /** Reloads the species lists for the dropdown, and drops a list filter whose list is gone. */
  async function loadSpeciesLists() {
    const isLatest = listsRequest();
    let loaded: SpeciesList[];
    try {
      loaded = await getSpeciesLists();
    } catch {
      return; // Keep the lists shown so far
    }
    if (!isLatest()) return;
    speciesLists = loaded;
    // A filter on a deleted list would match nothing: the list is an empty subquery.
    if (speciesListFilterId !== 0 && keepIfPresent(speciesListFilterId, loaded) === null) {
      speciesListFilterId = 0;
      offset = 0;
      loadActiveView();
    }
  }

  // Load the lists on mount and whenever they change (Species page, Clear Database).
  $effect(() => {
    const _version = appState.speciesListsVersion; // re-run when the lists change
    untrack(() => {
      void loadSpeciesLists();
    });
  });

  // The Species page asks for a list to filter by; take the request once.
  $effect(() => {
    const id = appState.listFilterRequest;
    if (id === null) return;
    untrack(() => {
      appState.listFilterRequest = null;
      speciesListFilterId = id;
      offset = 0;
      // The list may be newer than the dropdown
      void loadSpeciesLists();
      loadActiveView();
    });
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
          <span class="truncate font-medium" title={selectedRun.source_path}>{selectedRun.source_path}</span>
          <span class="text-base-content/40">|</span>
          <span class="text-base-content/60">{m.detections_fileCount({ count: String(selectedRun.file_count) })}</span>
        {:else}
          <span class="font-medium">{sourceFileName}</span>
        {/if}

        <span class="text-base-content/40">|</span>
        <span class="text-base-content/60">{headerCount}</span>

        {#if selectedRun.range_filter_note !== null}
          <span
            class="badge badge-warning badge-sm gap-1"
            title={m.analysis_rangeFilterOff({ reason: selectedRun.range_filter_note })}
          >
            <TriangleAlert size={12} />
            {m.analysis_noRangeFiltering()}
          </span>
        {/if}

        <div class="flex-1"></div>

        {#if selectedRun.filename_file_count > 0}
          <button
            type="button"
            class="btn btn-ghost btn-sm gap-1.5"
            onclick={openZoneDialog}
            title={m.detections_timezoneTitle()}
          >
            <Clock size={14} />
            {m.detections_timezone({ zone: runZoneLabel })}
          </button>
        {/if}

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
          <div class="tooltip tooltip-left" data-tip={!gridAvailable ? m.grid_noTimestamp() : ''}>
            <button
              class="btn btn-sm join-item {activeView === 'grid' ? 'btn-active' : ''}"
              disabled={!gridAvailable}
              onclick={() => {
                switchView('grid');
              }}
              title={gridAvailable ? m.view_grid() : undefined}
            >
              <Grid3x3 size={14} class={!gridAvailable ? 'opacity-40' : ''} />
              <span class="hidden sm:inline {!gridAvailable ? 'line-through opacity-40' : ''}">{m.view_grid()}</span>
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
            aria-label={m.analysis_filterByName()}
            data-focus-search
            bind:value={speciesQuery}
            oninput={handleSpeciesInput}
            class="input input-bordered input-sm w-48 pr-7 pl-7 text-xs"
          />
          {#if speciesQuery}
            <button
              type="button"
              onclick={clearSpeciesFilter}
              aria-label={m.common_button_clear()}
              title={m.common_button_clear()}
              class="text-base-content/60 hover:text-base-content absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5"
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
            oninput={handleConfidenceInput}
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
          runTimezone={selectedRun.timezone}
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
          {sunDate}
          zone={runZone ?? 'UTC'}
          untimedFiles={selectedRun.file_count - selectedRun.timed_file_count}
        />
      {/if}
    </div>
  {:else}
    <!-- No run selected -->
    <div class="flex flex-1 flex-col items-center justify-center gap-3">
      <List size={40} class="text-base-content/15" />
      <p class="text-base-content/60 text-sm">{runs.length > 0 ? m.runs_selectRun() : m.runs_empty()}</p>
    </div>
  {/if}
</div>

<Modal bind:open={zoneDialogOpen} title={m.detections_timezoneTitle()} icon={Clock} descriptionId="run-zone-body">
  <div class="space-y-3">
    <p id="run-zone-body" class="text-base-content/80 text-sm">
      {m.detections_timezoneBody({ count: String(selectedRun?.filename_file_count ?? 0) })}
    </p>
    <TimeZoneSelect
      bind:value={zoneChoice}
      placeholder={m.detections_timezoneChoose()}
      class="w-full"
      aria-label={m.detections_timezoneTitle()}
    />
  </div>
  {#snippet actions()}
    <button type="button" class="btn btn-sm" onclick={() => (zoneDialogOpen = false)}>
      {m.common_button_cancel()}
    </button>
    <button
      type="button"
      class="btn btn-primary btn-sm"
      onclick={() => void applyZone()}
      disabled={zoneSaving || zoneChoice === '' || zoneChoice === selectedRun?.timezone}
    >
      {m.common_button_apply()}
    </button>
  {/snippet}
</Modal>
