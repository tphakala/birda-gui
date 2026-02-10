<script lang="ts">
  import { Bird } from '@lucide/svelte';
  import { formatConfidence, formatDate } from '$lib/utils/format';
  import type { RunSpeciesAggregation } from '$shared/types';
  import * as m from '$paraglide/messages';

  type SortOption = 'count' | 'name' | 'confidence';

  const {
    species,
    loading,
    sortBy,
    onsortchange,
  }: {
    species: RunSpeciesAggregation[];
    loading: boolean;
    sortBy: SortOption;
    onsortchange: (sort: SortOption) => void;
  } = $props();

  const sortOptions: { id: SortOption; label: string }[] = [
    { id: 'count', label: m.species_card_sortCount() },
    { id: 'name', label: m.species_card_sortName() },
    { id: 'confidence', label: m.species_card_sortConfidence() },
  ];
</script>

<div class="flex flex-1 flex-col overflow-hidden">
  <!-- Sort bar -->
  <div class="flex items-center gap-2 px-4 py-2">
    <div class="join">
      {#each sortOptions as opt (opt.id)}
        <button
          class="btn btn-xs join-item {sortBy === opt.id ? 'btn-active' : ''}"
          onclick={() => {
            onsortchange(opt.id);
          }}
        >
          {opt.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Card grid -->
  <div class="flex-1 overflow-y-auto px-4 pb-4">
    {#if loading}
      <div class="text-base-content/50 flex flex-1 items-center justify-center py-12 text-sm">
        {m.species_loading()}
      </div>
    {:else if species.length === 0}
      <div class="flex flex-1 flex-col items-center justify-center gap-3 py-12">
        <Bird size={40} class="text-base-content/15" />
        <p class="text-base-content/40 text-sm">{m.species_card_noResults()}</p>
      </div>
    {:else}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {#each species as sp (sp.scientific_name)}
          <div class="card card-compact bg-base-200 shadow-sm">
            <div class="card-body gap-1.5">
              <!-- Name -->
              <h3 class="truncate text-sm font-semibold">{sp.common_name}</h3>
              <p class="text-base-content/50 truncate text-xs italic">{sp.scientific_name}</p>

              <!-- Stats row -->
              <div class="mt-1 flex items-center gap-2 text-xs">
                <span class="badge badge-primary badge-sm">
                  {sp.detection_count === 1
                    ? m.species_card_detectionsSingular({ count: String(sp.detection_count) })
                    : m.species_card_detections({ count: String(sp.detection_count) })}
                </span>
                <span class="text-base-content/60" title={m.species_card_avgConfidence({ value: '' })}>
                  {m.species_card_avgConfidence({ value: formatConfidence(sp.avg_confidence) })}
                </span>
                <span class="text-base-content/60" title={m.species_card_maxConfidence({ value: '' })}>
                  {m.species_card_maxConfidence({ value: formatConfidence(sp.max_confidence) })}
                </span>
              </div>

              <!-- Time row -->
              <div class="text-base-content/50 mt-1 flex items-center gap-3 text-xs">
                <span>
                  <span class="text-base-content/40">{m.species_card_firstSeen()}</span>
                  {formatDate(sp.first_detected)}
                </span>
                <span>
                  <span class="text-base-content/40">{m.species_card_lastSeen()}</span>
                  {formatDate(sp.last_detected)}
                </span>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
