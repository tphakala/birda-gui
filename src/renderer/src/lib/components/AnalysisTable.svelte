<script lang="ts">
  import { ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, ChevronDown, ChevronLeft } from '@lucide/svelte';
  import DetectionDetail from './DetectionDetail.svelte';
  import { formatConfidence, formatTime, formatDetectionDate, formatDetectionTime } from '$lib/utils/format';
  import type { EnrichedDetection } from '$shared/types';
  import * as m from '$paraglide/messages';

  const {
    detections,
    total,
    loading,
    isDirectory,
    sortColumn,
    sortDir,
    offset,
    limit,
    onsort,
    onpage,
  }: {
    detections: EnrichedDetection[];
    total: number;
    loading: boolean;
    isDirectory: boolean;
    sortColumn: string;
    sortDir: 'asc' | 'desc';
    offset: number;
    limit: number;
    onsort: (column: string) => void;
    onpage: (newOffset: number) => void;
  } = $props();

  type SortableColumn = 'start_time' | 'common_name' | 'scientific_name' | 'confidence';
  type ColumnKey = 'file_name' | 'date' | 'time' | 'start_time' | 'common_name' | 'scientific_name' | 'confidence';

  // Derive whether any detection has timestamp metadata
  const hasTimestamps = $derived(
    detections.some((d) => d.audio_file.recording_start !== null)
  );

  // Build columns with visibility logic
  const columns = $derived<{ key: ColumnKey; label: string; class?: string; sortable: boolean; visible: boolean }[]>([
    {
      key: 'file_name',
      label: m.table_columnSourceFile(),
      class: 'max-w-xs truncate',
      sortable: false,
      visible: isDirectory,
    },
    {
      key: 'date',
      label: m.table_columnDate(),
      class: 'w-20',
      sortable: false,
      visible: isDirectory && hasTimestamps,
    },
    {
      key: 'time',
      label: m.table_columnTime(),
      class: 'w-20',
      sortable: false,
      visible: isDirectory && hasTimestamps,
    },
    {
      key: 'start_time',
      label: hasTimestamps ? m.table_columnOffset() : m.table_columnTime(),
      class: 'w-20',
      sortable: true,
      visible: true,
    },
    { key: 'common_name', label: m.table_columnSpecies(), sortable: true, visible: true },
    { key: 'scientific_name', label: m.table_columnScientificName(), sortable: true, visible: true },
    {
      key: 'confidence',
      label: m.table_columnConfidence(),
      class: 'w-24 text-right',
      sortable: true,
      visible: true,
    },
  ]);

  const visibleColumns = $derived(columns.filter((col) => col.visible));
  const colCount = $derived(visibleColumns.length + 1);

  let expandedId = $state<number | null>(null);

  function toggleExpand(id: number) {
    expandedId = expandedId === id ? null : id;
  }

  const currentPage = $derived(Math.floor(offset / limit) + 1);
  const totalPages = $derived(Math.ceil(total / limit) || 1);

  function prevPage() {
    onpage(Math.max(0, offset - limit));
  }

  function nextPage() {
    const next = offset + limit;
    if (next < total) {
      onpage(next);
    }
  }
</script>

<div class="flex flex-1 flex-col overflow-hidden">
  <div class="bg-base-100 flex-1 overflow-auto">
    <table class="table-sm table">
      <thead>
        <tr>
          <th class="w-8"></th>
          {#each visibleColumns as col (col.key)}
            <th class={col.class ?? ''}>
              {#if col.sortable}
                <button
                  class="hover:text-base-content flex items-center gap-1"
                  onclick={() => {
                    onsort(col.key);
                  }}
                >
                  {col.label}
                  {#if sortColumn === col.key}
                    {#if sortDir === 'asc'}
                      <ArrowUp size={14} />
                    {:else}
                      <ArrowDown size={14} />
                    {/if}
                  {:else}
                    <ArrowUpDown size={14} class="opacity-30" />
                  {/if}
                </button>
              {:else}
                {col.label}
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each detections as detection (detection.id)}
          <tr
            class="hover cursor-pointer {expandedId === detection.id ? 'bg-primary/10' : ''}"
            onclick={() => {
              toggleExpand(detection.id);
            }}
          >
            <td class="text-base-content/50">
              {#if expandedId === detection.id}
                <ChevronDown size={14} />
              {:else}
                <ChevronRight size={14} />
              {/if}
            </td>
            {#each visibleColumns as col (col.key)}
              {#if col.key === 'file_name'}
                <td class={col.class ?? ''}>{detection.audio_file.file_name}</td>
              {:else if col.key === 'date'}
                <td class="{col.class ?? ''} text-base-content/60 tabular-nums">{formatDetectionDate(detection)}</td>
              {:else if col.key === 'time'}
                <td class="{col.class ?? ''} text-base-content/60 tabular-nums">{formatDetectionTime(detection)}</td>
              {:else if col.key === 'start_time'}
                <td class="{col.class ?? ''} tabular-nums">{formatTime(detection.start_time)}</td>
              {:else if col.key === 'common_name'}
                <td class="{col.class ?? ''} font-medium">{detection.common_name}</td>
              {:else if col.key === 'scientific_name'}
                <td class="{col.class ?? ''} text-base-content/50 italic">{detection.scientific_name}</td>
              {:else if col.key === 'confidence'}
                <td class="{col.class ?? ''} text-right tabular-nums">{formatConfidence(detection.confidence)}</td>
              {/if}
            {/each}
          </tr>
          {#if expandedId === detection.id}
            <tr>
              <td colspan={colCount} class="p-0">
                <DetectionDetail
                  {detection}
                  sourceFile={detection.audio_file.file_path}
                />
              </td>
            </tr>
          {/if}
        {:else}
          <tr>
            <td colspan={colCount} class="px-3 py-8 text-center text-base-content/50">
              {#if loading}
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
    <span
      >{total === 1
        ? m.pagination_detectionCountSingular({ count: String(total) })
        : m.pagination_detectionCount({ count: String(total) })}</span
    >
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
