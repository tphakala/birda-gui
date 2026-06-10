<script lang="ts">
  import { Check, Trash2 } from '@lucide/svelte';
  import {
    annotationEditor,
    getSelectedBox,
    selectBox,
    acceptBox,
    updateBox,
    removeBox,
  } from '$lib/stores/annotation.svelte';
  import SpeciesSearch from './SpeciesSearch.svelte';
  import { formatConfidence } from '$lib/utils/format';
  import type { EnrichedSpeciesSummary } from '$shared/types';
  import * as m from '$paraglide/messages';

  const selected = $derived(getSelectedBox());

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  function noop(): void {}

  function onSpeciesSelect(key: string, species: EnrichedSpeciesSummary): void {
    void updateBox(key, { scientific_name: species.scientific_name, common_name: species.common_name });
  }
</script>

<div class="border-base-300 bg-base-200 flex w-72 shrink-0 flex-col overflow-hidden border-l">
  <div class="border-base-300 border-b px-3 py-2 text-sm font-medium">{m.annotation_panel_title()}</div>

  {#if selected}
    <div class="space-y-3 p-3 text-xs">
      <div>
        <span class="text-base-content/70 mb-1 block">{m.annotation_field_species()}</span>
        <SpeciesSearch
          onselect={(s: EnrichedSpeciesSummary) => {
            onSpeciesSelect(selected.key, s);
          }}
          onclear={noop}
        />
        <div class="text-base-content/70 mt-1">
          {selected.common_name || selected.scientific_name || m.annotation_unnamed()}
        </div>
      </div>
      <div class="text-base-content/70 tabular-nums">
        {m.annotation_field_time({ start: selected.start_time.toFixed(2), end: selected.end_time.toFixed(2) })}
      </div>
      <div class="text-base-content/70 tabular-nums">
        {#if selected.low_freq_hz === null && selected.high_freq_hz === null}
          {m.annotation_freq_full()}
        {:else}
          {m.annotation_field_freq({
            low: ((selected.low_freq_hz ?? 0) / 1000).toFixed(1),
            high: ((selected.high_freq_hz ?? 0) / 1000).toFixed(1),
          })}
        {/if}
      </div>
      {#if selected.confidence !== null}
        <div class="text-base-content/70">{formatConfidence(selected.confidence)}</div>
      {/if}
      <div class="flex gap-2">
        {#if selected.display === 'suggested'}
          <button
            class="btn btn-primary btn-xs"
            onclick={() => {
              void acceptBox(selected.key);
            }}
          >
            <Check size={12} />{m.annotation_accept()}
          </button>
        {/if}
        <button
          class="btn btn-ghost btn-xs"
          onclick={() => {
            void removeBox(selected.key);
          }}
        >
          <Trash2 size={12} />{m.annotation_remove()}
        </button>
      </div>
    </div>
  {:else}
    <div class="text-base-content/70 p-3 text-xs">{m.annotation_panel_empty()}</div>
  {/if}

  <!-- Annotation list -->
  <div class="border-base-300 mt-auto border-t">
    <div class="text-base-content/60 px-3 py-1 text-[10px] uppercase">{m.annotation_list_title()}</div>
    <div class="max-h-48 overflow-y-auto">
      {#each annotationEditor.boxes as box (box.key)}
        <button
          class="hover:bg-base-300/50 flex w-full items-center gap-2 px-3 py-1 text-left text-xs {annotationEditor.selectedKey ===
          box.key
            ? 'bg-base-300'
            : ''}"
          onclick={() => {
            selectBox(box.key);
          }}
        >
          <span
            class="inline-block h-2 w-2 shrink-0 rounded-full {box.display === 'suggested'
              ? 'bg-warning'
              : box.display === 'manual'
                ? 'bg-success'
                : 'bg-primary'}"
          ></span>
          <span class="truncate">{box.common_name || box.scientific_name || m.annotation_unnamed()}</span>
          <span class="text-base-content/60 ml-auto tabular-nums">{box.start_time.toFixed(1)}s</span>
        </button>
      {/each}
    </div>
  </div>
</div>
