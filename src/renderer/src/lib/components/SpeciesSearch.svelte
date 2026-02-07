<script lang="ts">
  import { Search, X } from '@lucide/svelte';
  import { searchSpecies } from '$lib/utils/ipc';
  import type { EnrichedSpeciesSummary } from '$shared/types';
  import * as m from '$paraglide/messages';

  const {
    onselect,
    onclear,
  }: {
    onselect: (species: EnrichedSpeciesSummary) => void;
    onclear: () => void;
  } = $props();

  let query = $state('');
  let results = $state<EnrichedSpeciesSummary[]>([]);
  let showDropdown = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function handleInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!query.trim()) {
      results = [];
      showDropdown = false;
      return;
    }
    debounceTimer = setTimeout(() => {
      void (async () => {
        try {
          results = await searchSpecies(query);
          showDropdown = results.length > 0;
        } catch {
          results = [];
        }
      })();
    }, 200);
  }

  function select(species: EnrichedSpeciesSummary) {
    query = species.common_name;
    showDropdown = false;
    onselect(species);
  }

  function clear() {
    query = '';
    results = [];
    showDropdown = false;
    onclear();
  }
</script>

<div class="relative">
  <div class="relative">
    <Search size={16} class="text-base-content/40 absolute top-1/2 left-2.5 -translate-y-1/2" />
    <input
      type="text"
      bind:value={query}
      oninput={handleInput}
      onfocus={() => {
        if (results.length) showDropdown = true;
      }}
      onblur={() => setTimeout(() => (showDropdown = false), 200)}
      placeholder={m.speciesSearch_placeholder()}
      class="input input-bordered input-sm w-full pr-8 pl-8"
    />
    {#if query}
      <button onclick={clear} class="btn btn-ghost btn-xs btn-square absolute top-1/2 right-1 -translate-y-1/2">
        <X size={14} />
      </button>
    {/if}
  </div>

  {#if showDropdown}
    <div
      class="border-base-300 bg-base-100 absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border shadow-lg"
    >
      {#each results as species (species.scientific_name)}
        <button
          class="hover:bg-primary/10 flex w-full items-center justify-between px-3 py-2 text-left text-sm"
          onmousedown={() => {
            select(species);
          }}
        >
          <div>
            <span class="text-base-content font-medium">{species.common_name}</span>
            <span class="text-base-content/50 ml-1 italic">{species.scientific_name}</span>
          </div>
          <span class="text-base-content/50 text-xs"
            >{m.speciesSearch_detCount({ count: String(species.detection_count) })}</span
          >
        </button>
      {/each}
    </div>
  {/if}
</div>
