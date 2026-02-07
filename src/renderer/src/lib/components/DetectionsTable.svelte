<script lang="ts">
  import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from '@lucide/svelte';
  import AudioPlayer from './AudioPlayer.svelte';
  import { catalogState, type SortColumn } from '$lib/stores/catalog.svelte';
  import { formatConfidence, formatTimeRange, formatDate } from '$lib/utils/format';
  import type { EnrichedDetection } from '$shared/types';
  import * as m from '$paraglide/messages';

  const {
    onrefresh,
  }: {
    onrefresh: () => void;
  } = $props();

  const columns: { key: SortColumn; label: string; class?: string }[] = [
    { key: 'common_name', label: m.table_columnSpecies() },
    { key: 'scientific_name', label: m.table_columnScientificName() },
    { key: 'confidence', label: m.table_columnConfidence(), class: 'w-24 text-right' },
    { key: 'start_time', label: m.table_columnTime(), class: 'w-28' },
    { key: 'source_file', label: m.table_columnSourceFile() },
    { key: 'detected_at', label: m.table_columnDate(), class: 'w-28' },
  ];

  function toggleSort(col: SortColumn) {
    if (catalogState.sortColumn === col) {
      catalogState.sortDir = catalogState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      catalogState.sortColumn = col;
      catalogState.sortDir = 'desc';
    }
    onrefresh();
  }

  function prevPage() {
    const limit = catalogState.filter.limit ?? 50;
    catalogState.filter.offset = Math.max(0, (catalogState.filter.offset ?? 0) - limit);
    onrefresh();
  }

  function nextPage() {
    const limit = catalogState.filter.limit ?? 50;
    const offset = (catalogState.filter.offset ?? 0) + limit;
    if (offset < catalogState.total) {
      catalogState.filter.offset = offset;
      onrefresh();
    }
  }

  const currentPage = $derived(Math.floor((catalogState.filter.offset ?? 0) / (catalogState.filter.limit ?? 50)) + 1);
  const totalPages = $derived(Math.ceil(catalogState.total / (catalogState.filter.limit ?? 50)) || 1);

  function selectDetection(d: EnrichedDetection) {
    catalogState.selectedDetection = catalogState.selectedDetection?.id === d.id ? null : d;
  }
</script>

<div class="flex flex-1 flex-col overflow-hidden">
  <div class="bg-base-100 flex-1 overflow-auto">
    <table class="table-sm table">
      <thead>
        <tr>
          {#each columns as col (col.key)}
            <th class={col.class ?? ''}>
              <button
                class="hover:text-base-content flex items-center gap-1"
                onclick={() => {
                  toggleSort(col.key);
                }}
              >
                {col.label}
                {#if catalogState.sortColumn === col.key}
                  {#if catalogState.sortDir === 'asc'}
                    <ArrowUp size={14} />
                  {:else}
                    <ArrowDown size={14} />
                  {/if}
                {:else}
                  <ArrowUpDown size={14} class="opacity-30" />
                {/if}
              </button>
            </th>
          {/each}
          <th class="w-20">{m.table_columnClip()}</th>
        </tr>
      </thead>
      <tbody>
        {#each catalogState.detections as detection (detection.id)}
          <tr
            class="hover cursor-pointer {catalogState.selectedDetection?.id === detection.id ? 'bg-primary/20' : ''}"
            onclick={() => {
              selectDetection(detection);
            }}
            ondblclick={() => {
              catalogState.selectedDetection = detection;
            }}
          >
            <td class="font-medium">{detection.common_name}</td>
            <td class="text-base-content/50 italic">{detection.scientific_name}</td>
            <td class="text-right tabular-nums">{formatConfidence(detection.confidence)}</td>
            <td class="tabular-nums">{formatTimeRange(detection.start_time, detection.end_time)}</td>
            <td class="text-base-content/60 max-w-48 truncate">{detection.source_file}</td>
            <td class="text-base-content/60">{formatDate(detection.detected_at)}</td>
            <td>
              {#if detection.clip_path}
                <AudioPlayer clipPath={detection.clip_path} />
              {/if}
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan="7" class="px-3 py-8 text-center text-base-content/50">
              {#if catalogState.loading}
                {m.table_loadingDetections()}
              {:else}
                {m.table_noDetections()}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Pagination -->
  <div
    class="border-base-300 bg-base-200 text-base-content/60 flex items-center justify-between border-t px-3 py-2 text-xs"
  >
    <span>{m.pagination_totalDetections({ count: String(catalogState.total) })}</span>
    <div class="flex items-center gap-2">
      <button onclick={prevPage} disabled={currentPage <= 1} class="btn btn-ghost btn-xs">
        <ChevronLeft size={14} />
      </button>
      <span class="tabular-nums"
        >{m.pagination_pageOf({ current: String(currentPage), total: String(totalPages) })}</span
      >
      <button onclick={nextPage} disabled={currentPage >= totalPages} class="btn btn-ghost btn-xs">
        <ChevronRight size={14} />
      </button>
    </div>
  </div>
</div>
