<script lang="ts">
  import {
    AudioLines,
    X,
    FileHeadphone,
    FolderOpen,
    Play,
    Square,
    Calendar,
    ChevronLeft,
    ChevronRight,
    TriangleAlert,
    Check,
    Minus,
  } from '@lucide/svelte';
  import CoordinateInput from '$lib/components/CoordinateInput.svelte';
  import SourceFilesPanel from '$lib/components/SourceFilesPanel.svelte';
  import { appState } from '$lib/stores/app.svelte';
  import {
    openFileDialog,
    openFolderDialog,
    listModels,
    listAvailableModels,
    readCoordinates,
    getLocations,
    scanSource,
  } from '$lib/utils/ipc';
  import { parseRecordingStart } from '$lib/utils/format';
  import type { AvailableModel, InstalledModel, Location, SourceScanResult } from '$shared/types';
  import { onMount } from 'svelte';
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
  const now = new Date();
  let calYear = $state(now.getFullYear());
  let calMonth = $state(now.getMonth());

  const MONTH_NAMES = [
    m.calendar_month_january(),
    m.calendar_month_february(),
    m.calendar_month_march(),
    m.calendar_month_april(),
    m.calendar_month_may(),
    m.calendar_month_june(),
    m.calendar_month_july(),
    m.calendar_month_august(),
    m.calendar_month_september(),
    m.calendar_month_october(),
    m.calendar_month_november(),
    m.calendar_month_december(),
  ];
  const WEEKDAYS = [
    m.calendar_weekday_mo(),
    m.calendar_weekday_tu(),
    m.calendar_weekday_we(),
    m.calendar_weekday_th(),
    m.calendar_weekday_fr(),
    m.calendar_weekday_sa(),
    m.calendar_weekday_su(),
  ];

  const calendarDays = $derived.by(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const off = (firstDay + 6) % 7;
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();

    const days: { day: number; month: number; year: number; current: boolean }[] = [];

    for (let i = off - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const mo = calMonth === 0 ? 11 : calMonth - 1;
      const y = calMonth === 0 ? calYear - 1 : calYear;
      days.push({ day: d, month: mo, year: y, current: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, month: calMonth, year: calYear, current: true });
    }

    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        const mo = calMonth === 11 ? 0 : calMonth + 1;
        const y = calMonth === 11 ? calYear + 1 : calYear;
        days.push({ day: d, month: mo, year: y, current: false });
      }
    }

    return days;
  });

  const selectedDateObj = $derived(recordingDate ? new Date(recordingDate) : null);
  const formattedDate = $derived(
    selectedDateObj
      ? selectedDateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '',
  );

  function prevMonth() {
    if (calMonth === 0) {
      calMonth = 11;
      calYear--;
    } else {
      calMonth--;
    }
  }

  function nextMonth() {
    if (calMonth === 11) {
      calMonth = 0;
      calYear++;
    } else {
      calMonth++;
    }
  }

  function selectDate(day: number, month: number, year: number) {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    recordingDate = `${year}-${mm}-${dd}`;
    showDatePicker = false;
  }

  function selectToday() {
    const t = new Date();
    selectDate(t.getDate(), t.getMonth(), t.getFullYear());
  }

  function clearDate() {
    recordingDate = '';
    showDatePicker = false;
  }

  let dateInput = $state('');
  let dateInputError = $state(false);

  function applyDateInput() {
    const trimmed = dateInput.trim();
    let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed);
    if (match) {
      const [, dd, mm, yyyy] = match;
      const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      if (!isNaN(d.getTime()) && d.getDate() === Number(dd)) {
        selectDate(d.getDate(), d.getMonth(), d.getFullYear());
        dateInputError = false;
        return;
      }
    }
    match = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(trimmed);
    if (match) {
      const [, yyyy, mm, dd] = match;
      const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      if (!isNaN(d.getTime()) && d.getDate() === Number(dd)) {
        selectDate(d.getDate(), d.getMonth(), d.getFullYear());
        dateInputError = false;
        return;
      }
    }
    dateInputError = true;
  }

  function handleDateInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyDateInput();
    }
  }

  function openDatePicker() {
    if (selectedDateObj) {
      calYear = selectedDateObj.getFullYear();
      calMonth = selectedDateObj.getMonth();
    } else {
      const t = new Date();
      calYear = t.getFullYear();
      calMonth = t.getMonth();
    }
    dateInput = '';
    dateInputError = false;
    showDatePicker = true;
  }

  function isSelectedDay(day: number, month: number, year: number): boolean {
    if (!selectedDateObj) return false;
    return (
      selectedDateObj.getDate() === day &&
      selectedDateObj.getMonth() === month &&
      selectedDateObj.getFullYear() === year
    );
  }

  function isTodayDay(day: number, month: number, year: number): boolean {
    const t = new Date();
    return t.getDate() === day && t.getMonth() === month && t.getFullYear() === year;
  }

  // --- Derived values for analysis config ---
  const configSourceFileName = $derived(appState.sourcePath ? (appState.sourcePath.split(/[\\/]/).pop() ?? '') : '');
  const fileDate = $derived(configSourceFileName ? parseRecordingStart(configSourceFileName) : null);
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
    if (appState.sourcePath && appState.sourcePath !== prevSourcePath) {
      prevSourcePath = appState.sourcePath;
      // Scan source files
      scanning = true;
      scanResult = null;
      void (async () => {
        try {
          scanResult = await scanSource(appState.sourcePath!);
        } catch {
          scanResult = null;
        } finally {
          scanning = false;
        }
      })();
      // Auto-detect coordinates
      void (async () => {
        try {
          const coords = await readCoordinates(appState.sourcePath!);
          if (coords) {
            latitude = coords.latitude;
            longitude = coords.longitude;
            autoDetected = true;
          }
        } catch {
          // No coordinates file found
        }
      })();
    } else if (!appState.sourcePath) {
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

  function handleStartClick() {
    if (missingRangeFilter) {
      showNoFilterWarning = true;
      return;
    }
    doStart();
  }

  function doStart() {
    let month: number | undefined;
    let day: number | undefined;
    if (recordingDate) {
      const d = new Date(recordingDate);
      month = d.getMonth() + 1;
      day = d.getDate();
    }
    // Extract timezone offset from AudioMoth metadata of the first scanned file
    const timezoneOffsetMin = scanResult?.files[0]?.audiomoth?.timezoneOffsetMin ?? undefined;
    onstart({ locationName, latitude, longitude, month, day, timezoneOffsetMin });
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
        onclick={handleOpenFile}
        class="card border-base-300 bg-base-100 hover:bg-base-200 border p-5 text-left transition-colors"
      >
        <FileHeadphone size={28} class="text-primary mb-2" />
        <span class="font-medium">{m.analysis_selectFile()}</span>
        <span class="text-base-content/50 mt-1 text-sm">{m.analysis_selectFileDesc()}</span>
      </button>
      <button
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
        <button onclick={handleOpenFile} class="btn btn-outline btn-sm flex-1 gap-1.5">
          <FileHeadphone size={14} />
          {m.analysis_openFile()}
        </button>
        <button onclick={handleOpenFolder} class="btn btn-outline btn-sm flex-1 gap-1.5">
          <FolderOpen size={14} />
          {m.analysis_openFolder()}
        </button>
      </div>

      <!-- Selected source (compact) -->
      <div class="border-base-300 bg-base-200/50 flex items-center gap-2 rounded-lg border px-3 py-2">
        <AudioLines size={16} class="text-primary shrink-0" />
        <span class="min-w-0 flex-1 truncate text-sm">{appState.sourcePath.split(/[\\/]/).pop()}</span>
        <button
          onclick={() => (appState.sourcePath = null)}
          class="btn btn-ghost btn-xs btn-square"
          title={m.common_button_clear()}
        >
          <X size={14} />
        </button>
      </div>

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
            onclick={openDatePicker}
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
          <button onclick={() => (showNoFilterWarning = false)} class="btn btn-sm flex-1"
            >{m.common_button_back()}</button
          >
          <button onclick={doStart} class="btn btn-warning btn-sm flex-1">{m.analysis_startAnyway()}</button>
        </div>
      {:else}
        <!-- Start / Stop button -->
        {#if appState.isAnalysisRunning}
          <button onclick={onstop} class="btn btn-error w-full gap-2">
            <Square size={18} />
            {m.analysis_stopAnalysis()}
          </button>
        {:else}
          <button
            onclick={handleStartClick}
            disabled={appState.isAnalysisRunning}
            class="btn btn-primary w-full gap-2 transition-all duration-200 hover:brightness-110"
          >
            <Play size={18} />
            {m.analysis_startAnalysis()}
          </button>
        {/if}
      {/if}
    </div>

    <!-- Right column: Source files panel -->
    <div class="bg-base-100 flex flex-1 flex-col overflow-hidden">
      <SourceFilesPanel {scanResult} {scanning} analysisRunning={appState.isAnalysisRunning} />
    </div>
  </div>
{/if}

{#if showDatePicker}
  <dialog class="modal modal-open" style="z-index: 1000;">
    <div class="modal-box max-w-xs p-4">
      <!-- Month/year header -->
      <div class="flex items-center justify-between">
        <button type="button" onclick={prevMonth} class="btn btn-ghost btn-sm btn-square">
          <ChevronLeft size={18} />
        </button>
        <span class="text-sm font-semibold">{MONTH_NAMES[calMonth]} {calYear}</span>
        <button type="button" onclick={nextMonth} class="btn btn-ghost btn-sm btn-square">
          <ChevronRight size={18} />
        </button>
      </div>

      <!-- Type date -->
      <div class="mt-2">
        <input
          type="text"
          bind:value={dateInput}
          onkeydown={handleDateInputKeydown}
          placeholder={m.calendar_datePlaceholder()}
          class="input input-bordered input-sm w-full text-center {dateInputError ? 'input-error' : ''}"
        />
      </div>

      <!-- Weekday headers -->
      <div class="text-base-content/50 mt-2 grid grid-cols-7 text-center text-xs font-medium">
        {#each WEEKDAYS as wd, i (i)}
          <span class="py-1">{wd}</span>
        {/each}
      </div>

      <!-- Day grid -->
      <div class="grid grid-cols-7 text-center text-sm">
        {#each calendarDays as { day, month, year, current }, i (i)}
          {@const selected = isSelectedDay(day, month, year)}
          {@const today = isTodayDay(day, month, year)}
          <button
            type="button"
            onclick={() => {
              selectDate(day, month, year);
            }}
            class="mx-auto flex h-8 w-8 items-center justify-center rounded-full transition-colors
              {selected ? 'bg-primary text-primary-content' : ''}
              {!selected && today ? 'border-primary text-primary border' : ''}
              {!selected && !today && current ? 'hover:bg-base-300' : ''}
              {!current ? 'text-base-content/25 hover:bg-base-300/50' : ''}"
          >
            {day}
          </button>
        {/each}
      </div>

      <!-- Footer actions -->
      <div class="border-base-300 mt-3 flex items-center justify-between border-t pt-3">
        <button type="button" onclick={clearDate} class="btn btn-ghost btn-xs">{m.common_button_clear()}</button>
        <button type="button" onclick={selectToday} class="btn btn-ghost btn-xs">{m.calendar_today()}</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button onclick={() => (showDatePicker = false)}>close</button>
    </form>
  </dialog>
{/if}
