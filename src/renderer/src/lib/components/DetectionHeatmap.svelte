<script lang="ts">
  import { Grid3x3, Sun } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { HourlyDetectionCell } from '$shared/types';
  import { computeHourlySunPhases, type SunPhase, type SunPhaseGradient } from '$lib/utils/sun';
  import * as m from '$paraglide/messages';

  const {
    cells,
    loading,
    latitude,
    longitude,
    recordingDate,
    timezoneOffsetMin,
  }: {
    cells: HourlyDetectionCell[];
    loading: boolean;
    latitude: number | null;
    longitude: number | null;
    recordingDate: Date | null;
    timezoneOffsetMin: number | null;
  } = $props();

  const hours = Array.from({ length: 24 }, (_, i) => i);

  // --- Theme detection ---
  let isDark = $state(false);

  function updateDarkMode() {
    const cs = getComputedStyle(document.documentElement).colorScheme;
    isDark = cs.includes('dark');
  }

  onMount(() => {
    updateDarkMode();
    const observer = new MutationObserver(updateDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style'],
    });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', updateDarkMode);
    return () => {
      observer.disconnect();
      mq.removeEventListener('change', updateDarkMode);
    };
  });

  // --- Color palettes (matching BirdNET-Go heatmap colors) ---
  type RGB = [number, number, number];

  // Light: very light cyan (empty) → pale cyan → medium blue → dark navy
  const lightStops: RGB[] = [
    [240, 249, 252], // 0: empty (#f0f9fc)
    [224, 243, 248], // 1: (#e0f3f8)
    [204, 235, 246], // 2: (#ccebf6)
    [153, 215, 237], // 3: (#99d7ed)
    [102, 194, 228], // 4: (#66c2e4)
    [51, 173, 225], // 5: (#33ade1)
    [0, 153, 216], // 6: (#0099d8)
    [0, 119, 190], // 7: (#0077be)
    [0, 85, 149], // 8: (#005595)
  ];

  // Dark: slate (empty) → dark cyan → bright cyan → light blue
  const darkStops: RGB[] = [
    [30, 41, 59], // 0: empty (#1e293b)
    [22, 78, 99], // 1: (#164e63)
    [14, 116, 144], // 2: (#0e7490)
    [8, 145, 178], // 3: (#0891b2)
    [6, 182, 212], // 4: (#06b6d4)
    [34, 211, 238], // 5: (#22d3ee)
    [56, 189, 248], // 6: (#38bdf8)
    [96, 165, 250], // 7: (#60a5fa)
    [147, 197, 253], // 8: (#93c5fd)
  ];

  const stops = $derived(isDark ? darkStops : lightStops);

  // --- Derived data ---
  const speciesList = $derived.by(() => {
    const seen = new SvelteMap<string, string>();
    for (const c of cells) seen.set(c.scientific_name, c.common_name);
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([scientific_name, common_name]) => ({ scientific_name, common_name }));
  });

  const cellMap = $derived.by(() => {
    const lookup = new SvelteMap<string, number>();
    for (const c of cells) lookup.set(`${c.scientific_name}:${c.hour}`, c.detection_count);
    return lookup;
  });

  const maxCount = $derived(Math.max(1, ...cells.map((c) => c.detection_count)));

  function cellColor(count: number): string {
    if (count === 0) return `rgb(${stops[0].join(',')})`;
    const ratio = count / maxCount;
    const idx = Math.min(Math.floor(ratio * 8) + 1, 8);
    const [r, g, b] = stops[idx];
    return `rgb(${r},${g},${b})`;
  }

  function textColor(count: number): string {
    if (count === 0) return 'transparent';
    const ratio = count / maxCount;
    if (isDark) {
      // Dark theme: scale goes dark→bright, so high intensity needs dark text
      return ratio > 0.5 ? '#000000' : '#ffffff';
    }
    // Light theme: scale goes bright→dark, so high intensity needs white text
    return ratio > 0.35 ? '#ffffff' : '#334155';
  }

  function cellTooltip(commonName: string, hour: number, count: number): string {
    const countText =
      count === 1
        ? m.grid_detectionCountSingular({ count: String(count) })
        : m.grid_detectionCount({ count: String(count) });
    return `${commonName} @ ${String(hour).padStart(2, '0')}:00 — ${countText}`;
  }

  // Legend: subset of current palette stops
  const legendColors = $derived([stops[0], stops[1], stops[3], stops[5], stops[7], stops[8]]);

  // --- Daylight indicator (BirdNET-Go palette: indigo night → amber/yellow day) ---
  const sunPhaseColorsLight: Record<SunPhase, string> = {
    night: 'rgb(30 27 75 / 0.35)',
    twilight: 'rgb(99 102 241 / 0.25)',
    daylight: 'rgb(254 240 138 / 0.8)',
  };

  const sunPhaseColorsDark: Record<SunPhase, string> = {
    night: 'rgb(30 27 75 / 0.6)',
    twilight: 'rgb(99 102 241 / 0.35)',
    daylight: 'rgb(253 224 71 / 0.55)',
  };

  const sunPhaseLabels: Record<SunPhase, () => string> = {
    night: () => m.grid_phase_night(),
    twilight: () => m.grid_phase_twilight(),
    daylight: () => m.grid_phase_daylight(),
  };

  const sunPhases = $derived.by(() => {
    if (latitude === null || longitude === null || recordingDate === null) return null;
    return computeHourlySunPhases(recordingDate, latitude, longitude, timezoneOffsetMin ?? 0);
  });

  const sunColors = $derived(isDark ? sunPhaseColorsDark : sunPhaseColorsLight);

  // BirdNET-Go sunrise gradient: orange → amber
  const sunriseGradientLight = ['#f97316', '#fcd34d']; // orange-500 → amber-300
  const sunriseGradientDark = ['#fb923c', '#fbbf24']; // orange-400 → amber-400

  // BirdNET-Go sunset gradient: rose → purple
  const sunsetGradientLight = ['#fb7185', '#a855f7']; // rose-400 → purple-500
  const sunsetGradientDark = ['#fda4af', '#c084fc']; // rose-300 → purple-400

  /** Half-width (in percentage points) of the gradient transition band around sunrise/sunset. */
  const GRADIENT_BAND_HALFWIDTH_PCT = 15;

  function sunCellBackground(phase: SunPhase, gradient: SunPhaseGradient | undefined): string {
    if (!gradient) return sunColors[phase];

    const from = sunColors[gradient.fromPhase];
    const to = sunColors[gradient.toPhase];
    const pct = Math.round(gradient.at * 100);
    const lo = Math.max(0, pct - GRADIENT_BAND_HALFWIDTH_PCT);
    const hi = Math.min(100, pct + GRADIENT_BAND_HALFWIDTH_PCT);

    // Sunrise: twilight → daylight — use warm orange→amber accent
    const isSunrise = gradient.fromPhase === 'twilight' && gradient.toPhase === 'daylight';
    // Sunset: daylight → twilight — use rose→purple accent
    const isSunset = gradient.fromPhase === 'daylight' && gradient.toPhase === 'twilight';

    if (isSunrise) {
      const [a, b] = isDark ? sunriseGradientDark : sunriseGradientLight;
      return `linear-gradient(to right, ${from} ${lo}%, ${a} ${pct}%, ${b} ${hi}%, ${to})`;
    }
    if (isSunset) {
      const [a, b] = isDark ? sunsetGradientDark : sunsetGradientLight;
      return `linear-gradient(to right, ${from}, ${a} ${lo}%, ${b} ${pct}%, ${to} ${hi}%)`;
    }

    // night ↔ twilight: simple smooth blend
    return `linear-gradient(to right, ${from} ${lo}%, ${to} ${hi}%)`;
  }
</script>

<div class="flex flex-1 flex-col overflow-hidden">
  {#if loading}
    <div class="text-base-content/50 flex flex-1 items-center justify-center text-sm">
      {m.species_loading()}
    </div>
  {:else if cells.length === 0}
    <div class="flex flex-1 flex-col items-center justify-center gap-3">
      <Grid3x3 size={40} class="text-base-content/15" />
      <p class="text-base-content/40 text-sm">{m.grid_noResults()}</p>
    </div>
  {:else}
    <!-- Grid -->
    <div class="flex-1 overflow-auto px-4 pt-2 pb-4">
      <div class="grid w-fit" style="grid-template-columns: minmax(180px, max-content) repeat(24, 32px); gap: 2px;">
        <!-- Header row: empty corner + hour labels -->
        <div class="bg-base-100 sticky left-0 z-10"></div>
        {#each hours as h (h)}
          <div class="text-base-content/50 flex h-6 items-center justify-center text-[10px] font-medium">
            {String(h).padStart(2, '0')}
          </div>
        {/each}

        <!-- Daylight indicator row -->
        {#if sunPhases}
          <div class="bg-base-100 text-base-content/50 sticky left-0 z-10 flex items-center gap-1 pr-2 text-[10px]">
            <Sun size={12} class="shrink-0 opacity-60" />
            <span class="truncate">{m.grid_daylight()}</span>
          </div>
          {#each sunPhases as { hour, phase, gradient } (hour)}
            <div
              class="tooltip {hour <= 4
                ? 'tooltip-right'
                : hour >= 19
                  ? 'tooltip-left'
                  : 'tooltip-top'} flex h-5 items-center justify-center rounded-[3px] hover:z-20"
              style="background: {sunCellBackground(phase, gradient)};"
              data-tip={sunPhaseLabels[phase]()}
            ></div>
          {/each}
        {/if}

        <!-- Data rows -->
        {#each speciesList as sp (sp.scientific_name)}
          <!-- Species label (sticky left) -->
          <div
            class="bg-base-100 text-base-content/70 sticky left-0 z-10 flex items-center truncate pr-2 text-xs"
            title={`${sp.common_name} (${sp.scientific_name})`}
          >
            {sp.common_name}
          </div>

          <!-- Hour cells -->
          {#each hours as h (h)}
            {@const count = cellMap.get(`${sp.scientific_name}:${h}`) ?? 0}
            <div
              class="tooltip {h <= 4
                ? 'tooltip-right'
                : h >= 19
                  ? 'tooltip-left'
                  : 'tooltip-top'} flex h-7 items-center justify-center rounded-[3px] text-[10px] font-medium hover:z-20"
              style="background-color: {cellColor(count)}; color: {textColor(count)};"
              data-tip={cellTooltip(sp.common_name, h, count)}
            >
              {#if count > 0}
                {count}
              {/if}
            </div>
          {/each}
        {/each}
      </div>

      <!-- Legend (bottom-right) -->
      <div class="mt-3 flex items-center justify-end gap-1.5 text-[11px]">
        <span class="text-base-content/50">{m.grid_less()}</span>
        {#each legendColors as [r, g, b], i (i)}
          <div class="h-3.5 w-3.5 rounded-[3px]" style="background-color: rgb({r},{g},{b});"></div>
        {/each}
        <span class="text-base-content/50">{m.grid_more()}</span>
      </div>

      {#if sunPhases}
        <div class="mt-1.5 flex items-center justify-end gap-1.5 text-[11px]">
          <div class="h-3 w-3 rounded-[3px]" style="background-color: {sunColors.night};"></div>
          <span class="text-base-content/50">{m.grid_phase_night()}</span>
          <div class="h-3 w-3 rounded-[3px]" style="background-color: {sunColors.twilight};"></div>
          <span class="text-base-content/50">{m.grid_phase_twilight()}</span>
          <div class="h-3 w-3 rounded-[3px]" style="background-color: {sunColors.daylight};"></div>
          <span class="text-base-content/50">{m.grid_phase_daylight()}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>
