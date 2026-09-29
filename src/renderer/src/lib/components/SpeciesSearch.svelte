<script lang="ts">
  import { Search, X } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { searchSpecies } from '$lib/utils/ipc';
  import { comboboxKey } from '$lib/utils/combobox';
  import { latestRequest } from '$lib/utils/latest';
  import type { EnrichedSpeciesSummary } from '$shared/types';
  import * as m from '$paraglide/messages';

  const {
    onselect,
    onclear,
    placeholder = m.speciesSearch_placeholder(),
    search = searchSpecies,
  }: {
    onselect: (species: EnrichedSpeciesSummary) => void;
    onclear: () => void;
    /** Input placeholder; defaults to the map page wording. */
    placeholder?: string;
    /** Search backend; defaults to the catalog (detected species) search. */
    search?: (query: string) => Promise<EnrichedSpeciesSummary[]>;
  } = $props();

  const id = $props.id();
  const listboxId = `${id}-listbox`;
  const optionId = (i: number) => `${id}-option-${i}`;

  let query = $state('');
  let results = $state<EnrichedSpeciesSummary[]>([]);
  let open = $state(false);
  let active = $state(-1);
  let inputEl = $state<HTMLInputElement | null>(null);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const beginSearch = latestRequest();

  /** Drop any pending or in-flight search so it cannot reopen the list. */
  function invalidateSearch() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    beginSearch();
  }

  function closeList() {
    open = false;
    active = -1;
  }

  /** Close the list for good: a search still pending must not bring it back. */
  function dismiss() {
    invalidateSearch();
    closeList();
  }

  function handleInput() {
    invalidateSearch();
    // Options of the previous query must not stay selectable while the next search runs
    results = [];
    closeList();
    if (!query.trim()) {
      onclear();
      return;
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const isLatest = beginSearch();
      void (async () => {
        try {
          const found = await search(query);
          if (!isLatest()) return;
          results = found;
          active = -1;
          open = found.length > 0;
        } catch {
          if (!isLatest()) return;
          results = [];
          closeList();
        }
      })();
    }, 200);
  }

  function select(species: EnrichedSpeciesSummary) {
    invalidateSearch();
    query = species.common_name;
    closeList();
    onselect(species);
  }

  function clear() {
    invalidateSearch();
    query = '';
    results = [];
    closeList();
    onclear();
    inputEl?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    const action = comboboxKey(e.key, { open, active }, results.length);
    if (action.kind === 'ignore') return;
    e.preventDefault();
    if (action.kind === 'move') {
      open = true;
      active = action.active;
      void tick().then(() => {
        document.getElementById(optionId(action.active))?.scrollIntoView({ block: 'nearest' });
      });
    } else if (action.kind === 'select') {
      select(results[action.index]);
    } else {
      dismiss();
    }
  }
</script>

<div class="relative">
  <div class="relative">
    <Search size={16} class="text-base-content/40 absolute top-1/2 left-2.5 -translate-y-1/2" />
    <input
      type="text"
      data-focus-search
      bind:this={inputEl}
      bind:value={query}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onfocus={() => {
        if (results.length) open = true;
      }}
      onblur={dismiss}
      {placeholder}
      aria-label={placeholder}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
      autocomplete="off"
      class="input input-bordered input-sm w-full pr-8 pl-8"
    />
    {#if query}
      <button
        type="button"
        onclick={clear}
        aria-label={m.common_button_clear()}
        class="btn btn-ghost btn-xs btn-square absolute top-1/2 right-1 -translate-y-1/2"
      >
        <X size={14} />
      </button>
    {/if}
  </div>

  <!-- mousedown default is blocked so clicks and scrollbar drags keep input focus -->
  <ul
    id={listboxId}
    role="listbox"
    tabindex="-1"
    aria-label={placeholder}
    hidden={!open}
    onmousedown={(e) => {
      e.preventDefault();
    }}
    class="border-base-300 bg-base-100 absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border shadow-lg"
  >
    {#each results as species, i (species.scientific_name)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li
        id={optionId(i)}
        role="option"
        tabindex="-1"
        aria-selected={i === active}
        onclick={() => {
          select(species);
        }}
        class="hover:bg-primary/10 flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm {i ===
        active
          ? 'bg-primary/10'
          : ''}"
      >
        <div>
          <span class="text-base-content font-medium">{species.common_name}</span>
          <span class="text-base-content/50 ml-1 italic">{species.scientific_name}</span>
        </div>
        {#if species.detection_count > 0}
          <span class="text-base-content/50 text-xs"
            >{m.speciesSearch_detCount({ count: String(species.detection_count) })}</span
          >
        {/if}
      </li>
    {/each}
  </ul>
</div>
