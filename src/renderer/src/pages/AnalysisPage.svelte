<script lang="ts">
  import {
    AudioLines,
    X,
    FileHeadphone,
    FolderOpen,
    Play,
    Square,
    Calendar,
    TriangleAlert,
    Check,
    Minus,
  } from '@lucide/svelte';
  import CoordinateInput from '$lib/components/CoordinateInput.svelte';
  import DatePicker from '$lib/components/DatePicker.svelte';
  import SourceFilesPanel from '$lib/components/SourceFilesPanel.svelte';
  import { appState } from '$lib/stores/app.svelte';
  import { dismissAnalysis } from '$lib/stores/analysis.svelte';
  import { lockedTitle } from '$lib/utils/runLock';
  import {
    openFileDialog,
    openFolderDialog,
    listModels,
    listAvailableModels,
    readCoordinates,
    getLocations,
    scanSource,
  } from '$lib/utils/ipc';
  import { parseLocalDate, parseRecordingStart } from '$lib/utils/format';
  import type { AvailableModel, InstalledModel, Location, SourceScanResult } from '$shared/types';
  import { onMount, tick } from 'svelte';
  import * as m from '$paraglide/messages';

  const {
    onstart,
    onstop,
  }: {
    onstart: (opts: {
      locationName: string;
      latitude: number;
      longitude: number;
      month?: number | undefined;
      day?: number | undefined;
      timezoneOffsetMin?: number | undefined;
    }) => void;
    onstop: () => void;
  } = $props();

  let installedModels = $state<InstalledModel[]>([]);
  let availableModels = $state<AvailableModel[]>([]);
  const modelNames = $derived(new Map(availableModels.map((m) => [m.id, m.name])));

  // --- Analysis configuration state ---
  let latitude = $state(0);
  let longitude = $state(0);
  let autoDetected = $state(false);
  let recordingDate = $state('');
  let locationName = $state('');
  let showNoFilterWarning = $state(false);
  let previousLocations = $state<Location[]>([]);

  // --- Source scan state ---
  let scanResult = $state<SourceScanResult | null>(null);
  let scanning = $state(false);

  // --- Date picker state ---
  let showDatePicker = $state(false);

  const selectedDateObj = $derived(recordingDate ? parseLocalDate(recordingDate) : null);
  const formattedDate = $derived(
    selectedDateObj
      ? selectedDateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '',
  );

  // --- Derived values for analysis config ---
  // The whole path, parsed the way the main process parses it for birda.
  const fileDate = $derived(appState.sourcePath ? parseRecordingStart(appState.sourcePath) : null);
  const needsDateInput = $derived(!fileDate);
  const hasCoords = $derived(latitude !== 0 || longitude !== 0);
  const hasDate = $derived(!!fileDate || !!recordingDate);
  const missingRangeFilter = $derived(!hasCoords || !hasDate);

  $effect(() => {
    if (!missingRangeFilter) showNoFilterWarning = false;
  });

  // Auto-detect coordinates and scan files when source path changes
  let prevSourcePath: string | null = null;
  $effect(() => {
    const currentPath = appState.sourcePath;
    if (currentPath && currentPath !== prevSourcePath) {
      prevSourcePath = currentPath;
      // A finished or stopped analysis's per-file statuses belong to its source, not this one.
      if (!appState.isAnalysisRunning) dismissAnalysis();
      // Scan source files
      scanning = true;
      scanResult = null;
      const pathAtStart = currentPath;
      void (async () => {
        try {
          const res = await scanSource(pathAtStart);
          if (appState.sourcePath === pathAtStart) {
            scanResult = res;
          }
        } catch {
          if (appState.sourcePath === pathAtStart) {
            scanResult = null;
          }
        } finally {
          if (appState.sourcePath === pathAtStart) {
            scanning = false;
          }
        }
      })();
      // Auto-detect coordinates, except for a running analysis this window
      // joined: the form shows that analysis's own coordinates.
      void (async () => {
        if (appState.isAnalysisRunning) return;
        try {
          const coords = await readCoordinates(pathAtStart);
          if (coords && appState.sourcePath === pathAtStart) {
            latitude = coords.latitude;
            longitude = coords.longitude;
            autoDetected = true;
          }
        } catch {
          // No coordinates file found
        }
      })();
    } else if (!currentPath) {
      prevSourcePath = null;
      scanResult = null;
      scanning = false;
    }
  });

  function selectLocation(loc: Location) {
    latitude = loc.latitude;
    longitude = loc.longitude;
    locationName = loc.name ?? '';
    autoDetected = false;
  }

  let startStopButton = $state<HTMLButtonElement | undefined>();
  let startAnywayButton = $state<HTMLButtonElement | undefined>();

  async function handleStartClick() {
    if (missingRangeFilter) {
      showNoFilterWarning = true;
      // The Start button is replaced by the warning; move focus into it.
      await tick();
      startAnywayButton?.focus();
      return;
    }
    doStart();
  }

  async function startAnyway() {
    startClickedAt = performance.now();
    doStart();
    // The warning is replaced by the Start/Stop button again; keep focus on it.
    await tick();
    startStopButton?.focus();
  }

  // A double click on Start would otherwise land on Stop and stop the analysis
  // it just started. A held Enter key is handled by ignoring key repeats.
  const STOP_GRACE_MS = 600;
  let startClickedAt = 0;

  function ignoreKeyRepeat(event: KeyboardEvent) {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
  }

  function handleStartStopClick() {
    if (appState.isAnalysisStopping) return;
    if (appState.isAnalysisRunning) {
      if (performance.now() - startClickedAt < STOP_GRACE_MS) return;
      onstop();
      return;
    }
    startClickedAt = performance.now();
    void handleStartClick();
  }

  function doStart() {
    showNoFilterWarning = false;
    let month: number | undefined;
    let day: number | undefined;
    if (recordingDate) {
      const d = parseLocalDate(recordingDate);
      month = d.getMonth() + 1;
      day = d.getDate();
    }
    // Extract timezone offset from AudioMoth metadata of the first scanned file
    const timezoneOffsetMin = scanResult?.files[0]?.audiomoth?.timezoneOffsetMin ?? undefined;
    onstart({ locationName, latitude, longitude, month, day, timezoneOffsetMin });
  }

  // The location and date of a running analysis this window joined (after a
  // reload) replace the form's once; App sets its model and confidence.
  $effect(() => {
    const joined = appState.joinedSettings;
    if (!joined) return;
    latitude = joined.latitude ?? 0;
    longitude = joined.longitude ?? 0;
    locationName = joined.location_name ?? '';
    // Only month and day reach birda; the year is a placeholder.
    recordingDate =
      joined.month !== undefined && joined.day !== undefined
        ? `${new Date().getFullYear()}-${String(joined.month).padStart(2, '0')}-${String(joined.day).padStart(2, '0')}`
        : '';
    appState.joinedSettings = null;
  });

  async function backFromWarning() {
    showNoFilterWarning = false;
    // The warning is replaced by the Start/Stop button again; keep focus on it.
    await tick();
    startStopButton?.focus();
  }

  async function handleOpenFile() {
    const path = await openFileDialog();
    if (path) appState.sourcePath = path;
  }

  async function handleOpenFolder() {
    const path = await openFolderDialog();
    if (path) appState.sourcePath = path;
  }

  onMount(async () => {
    try {
      [installedModels, availableModels] = await Promise.all([listModels(), listAvailableModels()]);
      if (installedModels.length > 0 && !installedModels.some((mod) => mod.id === appState.selectedModel)) {
        appState.selectedModel = installedModels[0].id;
      }
    } catch {
      // Fall back to hardcoded default
    }
    try {
      previousLocations = await getLocations();
    } catch {
      // No locations yet
    }
  });
</script>

{#if !appState.sourcePath}
  <!-- No source: centered file selection -->
  <div class="flex flex-1 flex-col items-center justify-center gap-6">
    <h1 class="text-2xl font-semibold">{m.analysis_title()}</h1>
    <div class="grid w-full max-w-md grid-cols-2 gap-4 px-6">
      <button
        type="button"
        onclick={handleOpenFile}
        class="card border-base-300 bg-base-100 hover:bg-base-200 border p-5 text-left transition-colors"
      >
        <FileHeadphone size={28} class="text-primary mb-2" />
        <span class="font-medium">{m.analysis_selectFile()}</span>
        <span class="text-base-content/50 mt-1 text-sm">{m.analysis_selectFileDesc()}</span>
      </button>
      <button
        type="button"
        onclick={handleOpenFolder}
        class="card border-base-300 bg-base-100 hover:bg-base-200 border p-5 text-left transition-colors"
      >
        <FolderOpen size={28} class="text-primary mb-2" />
        <span class="font-medium">{m.analysis_selectFolder()}</span>
        <span class="text-base-content/50 mt-1 text-sm">{m.analysis_selectFolderDesc()}</span>
      </button>
    </div>
  </div>
{:else}
  <!-- Source selected: two-column layout -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Left column: Configuration -->
    <div class="border-base-300 flex w-80 shrink-0 flex-col space-y-4 overflow-y-auto border-r p-4">
      <h1 class="text-lg font-semibold">{m.analysis_title()}</h1>

      <!-- Compact Open File / Open Folder buttons -->
      <div class="flex gap-2">
        <button
          type="button"
          onclick={handleOpenFile}
          disabled={appState.isAnalysisRunning}
          title={lockedTitle()}
          aria-describedby={appState.isAnalysisRunning ? 'analysis-locked' : undefined}
          class="btn btn-outline btn-sm flex-1 gap-1.5"
        >
          <FileHeadphone size={14} />
          {m.analysis_openFile()}
        </button>
        <button
          type="button"
          onclick={handleOpenFolder}
          disabled={appState.isAnalysisRunning}
          title={lockedTitle()}
          aria-describedby={appState.isAnalysisRunning ? 'analysis-locked' : undefined}
          class="btn btn-outline btn-sm flex-1 gap-1.5"
        >
          <FolderOpen size={14} />
          {m.analysis_openFolder()}
        </button>
      </div>

      <!-- Selected source (compact) -->
      <div class="border-base-300 bg-base-200/50 flex items-center gap-2 rounded-lg border px-3 py-2">
        <AudioLines size={16} class="text-primary shrink-0" />
        <span class="min-w-0 flex-1 truncate text-sm">{appState.sourcePath.split(/[\\/]/).pop()}</span>
        <button
          type="button"
          onclick={() => (appState.sourcePath = null)}
          disabled={appState.isAnalysisRunning}
          class="btn btn-ghost btn-xs btn-square"
          title={lockedTitle(m.common_button_clear())}
          aria-label={m.common_button_clear()}
        >
          <X size={14} />
        </button>
      </div>

      <!-- The configuration applies to the next analysis, so it is locked while
           one runs, with the reason shown for everyone, not only on hover. -->
      {#if appState.isAnalysisRunning}
        <p id="analysis-locked" class="text-base-content/60 text-xs">{m.analysis_lockedDuringRun()}</p>
      {/if}
      <fieldset
        disabled={appState.isAnalysisRunning}
        aria-describedby={appState.isAnalysisRunning ? 'analysis-locked' : undefined}
        class="space-y-4"
      >
        <!-- Model -->
        <label class="block">
          <span class="text-base-content/70 text-xs font-medium">{m.analysis_model()}</span>
          <select bind:value={appState.selectedModel} class="select select-bordered select-sm mt-1 w-full">
            {#each installedModels as model (model.id)}
              <option value={model.id}>{modelNames.get(model.id) ?? model.id}</option>
            {:else}
              <option value={appState.selectedModel}
                >{modelNames.get(appState.selectedModel) ?? appState.selectedModel}</option
              >
            {/each}
          </select>
        </label>

        <!-- Confidence -->
        <label class="block">
          <span class="text-base-content/70 text-xs font-medium">{m.filter_minConfidence()}</span>
          <div class="mt-1 flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={appState.analysisConfidence}
              class="range range-primary range-sm flex-1"
            />
            <span class="w-10 text-xs tabular-nums">{(appState.analysisConfidence * 100).toFixed(0)}%</span>
          </div>
        </label>

        <!-- Location & Date section -->
        <div class="border-base-300 space-y-3 rounded-lg border p-3">
          <div class="flex items-center gap-1.5">
            <h3 class="text-base-content/50 text-xs font-medium">{m.analysis_locationDate()}</h3>
            <div class="ml-auto flex gap-1">
              <span class="badge badge-xs gap-0.5 {hasCoords ? 'badge-success' : 'badge-ghost text-base-content/30'}">
                {#if hasCoords}<Check size={10} />{:else}<Minus size={10} />{/if}
                {m.analysis_statusCoords()}
              </span>
              <span class="badge badge-xs gap-0.5 {hasDate ? 'badge-success' : 'badge-ghost text-base-content/30'}">
                {#if hasDate}<Check size={10} />{:else}<Minus size={10} />{/if}
                {m.analysis_statusDate()}
              </span>
            </div>
          </div>

          <!-- Previous locations dropdown -->
          {#if previousLocations.length > 0}
            <select
              class="select select-bordered select-sm w-full"
              onchange={(e) => {
                const idx = Number((e.target as HTMLSelectElement).value);
                if (idx >= 0) selectLocation(previousLocations[idx]);
              }}
            >
              <option value="-1">{m.analysis_previousLocation()}</option>
              {#each previousLocations as loc, i (loc.id)}
                <option value={i}>
                  {loc.name
                    ? `${loc.name} (${loc.latitude.toFixed(2)}, ${loc.longitude.toFixed(2)})`
                    : `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`}
                </option>
              {/each}
            </select>
          {/if}

          <CoordinateInput bind:latitude bind:longitude {autoDetected} />

          <!-- Recording date -->
          {#if needsDateInput}
            <button
              type="button"
              onclick={() => (showDatePicker = true)}
              class="btn btn-outline btn-sm w-full justify-start gap-2 font-normal {recordingDate
                ? ''
                : 'text-base-content/40'}"
            >
              <Calendar size={14} />
              {formattedDate || m.analysis_recordingDatePlaceholder()}
            </button>
          {:else if fileDate}
            <div class="flex items-center gap-2 text-xs">
              <Calendar size={14} class="text-base-content/50" />
              <span class="text-base-content/70">{m.analysis_recordingDate()}</span>
              <span class="badge badge-success badge-xs">
                {fileDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              </span>
            </div>
          {/if}

          <!-- Location name -->
          <input
            type="text"
            bind:value={locationName}
            placeholder={m.analysis_locationNamePlaceholder()}
            class="input input-bordered input-sm w-full"
          />
        </div>
      </fieldset>

      <!-- Range filter warning -->
      {#if showNoFilterWarning}
        <div role="alert" class="alert alert-warning py-2 text-xs">
          <TriangleAlert size={14} />
          <div>
            <p class="font-medium">{m.analysis_noRangeFiltering()}</p>
            <p class="mt-0.5">
              {hasDate ? m.analysis_noRangeWarningCoordsOnly() : m.analysis_noRangeWarningBoth()}
            </p>
          </div>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            onclick={() => void backFromWarning()}
            onkeydown={ignoreKeyRepeat}
            class="btn btn-sm flex-1">{m.common_button_back()}</button
          >
          <button
            type="button"
            bind:this={startAnywayButton}
            onclick={() => void startAnyway()}
            onkeydown={ignoreKeyRepeat}
            class="btn btn-warning btn-sm flex-1">{m.analysis_startAnyway()}</button
          >
        </div>
      {:else}
        <!-- One Start / Stop button, so focus stays on it as the analysis starts, stops and ends. -->
        <button
          type="button"
          bind:this={startStopButton}
          onclick={handleStartStopClick}
          onkeydown={ignoreKeyRepeat}
          aria-disabled={appState.isAnalysisStopping}
          class="btn w-full gap-2 {appState.isAnalysisRunning
            ? 'btn-error'
            : 'btn-primary transition-all duration-200 hover:brightness-110'} {appState.isAnalysisStopping
            ? 'btn-disabled'
            : ''}"
        >
          {#if appState.isAnalysisStopping}
            <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
            {m.analysis_stopping()}
          {:else if appState.isAnalysisRunning}
            <Square size={18} />
            {m.analysis_stopAnalysis()}
          {:else}
            <Play size={18} />
            {m.analysis_startAnalysis()}
          {/if}
        </button>
      {/if}
    </div>

    <!-- Right column: Source files panel -->
    <div class="bg-base-100 flex flex-1 flex-col overflow-hidden">
      <SourceFilesPanel {scanResult} {scanning} analysisRunning={appState.isAnalysisRunning} />
    </div>
  </div>
{/if}

{#if showDatePicker}
  <DatePicker
    value={recordingDate}
    onchange={(date: string) => {
      recordingDate = date;
      showDatePicker = false;
    }}
    onclose={() => (showDatePicker = false)}
  />
{/if}
