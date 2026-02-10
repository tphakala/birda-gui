<script lang="ts">
  import { Grid3x3 } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { HourlyDetectionCell } from '$shared/types';
  import * as m from '$paraglide/messages';

  const {
    cells,
    loading,
  }: {
    cells: HourlyDetectionCell[];
    loading: boolean;
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

  // --- Color palettes (BirdNET-Go style blue/teal monochrome) ---
  type RGB = [number, number, number];

  // Light: light blue-gray (empty) → pale blue → medium blue → dark navy
  const lightStops: RGB[] = [
    [228, 234, 240], // 0: light blue-gray (empty)
    [198, 214, 232], // 1: pale blue
    [170, 198, 222], // 2: light blue
    [140, 178, 210], // 3: medium-light blue
    [107, 155, 195], // 4: medium blue
    [75, 130, 178], // 5: blue
    [48, 105, 158], // 6: dark blue
    [28, 78, 138], // 7: darker blue
    [8, 48, 107], // 8: navy
  ];

  // Dark: dark blue-gray (empty) → dark teal → medium teal → bright cyan
  const darkStops: RGB[] = [
    [35, 42, 52], // 0: dark blue-gray (empty)
    [28, 62, 78], // 1: very dark teal
    [32, 80, 98], // 2: dark teal
    [38, 100, 118], // 3: teal
    [48, 122, 140], // 4: medium teal
    [60, 148, 162], // 5: bright teal
    [75, 172, 182], // 6: brighter teal
    [95, 195, 202], // 7: light teal
    [120, 218, 225], // 8: cyan
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
    if (isDark) return '#ffffff';
    const ratio = count / maxCount;
    return ratio > 0.4 ? '#ffffff' : '#334155';
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
      <div class="grid" style="grid-template-columns: minmax(180px, max-content) repeat(24, 32px); gap: 2px;">
        <!-- Header row: empty corner + hour labels -->
        <div class="bg-base-100 sticky left-0 z-10"></div>
        {#each hours as h (h)}
          <div class="text-base-content/50 flex h-6 items-center justify-center text-[10px] font-medium">
            {String(h).padStart(2, '0')}
          </div>
        {/each}

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
              class="tooltip tooltip-top flex h-7 items-center justify-center rounded-[3px] text-[10px] font-medium"
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
    </div>
  {/if}
</div>
