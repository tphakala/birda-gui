<script lang="ts">
  import { Bird, Download, Plus, Search, Trash2, X, Funnel, MapPin } from '@lucide/svelte';
  import CoordinateInput from '$lib/components/CoordinateInput.svelte';
  import { appState } from '$lib/stores/app.svelte';
  import {
    fetchSpeciesList,
    saveSpeciesList,
    getSpeciesLists,
    getSpeciesListEntries,
    deleteSpeciesListById,
    createCustomSpeciesList,
  } from '$lib/utils/ipc';
  import type { SpeciesList, EnrichedSpeciesListEntry, BirdaSpeciesResponse } from '$shared/types';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import * as m from '$paraglide/messages';

  // --- List panel state ---
  let lists = $state<SpeciesList[]>([]);
  let listsLoading = $state(true);

  // --- Selected list state ---
  let entries = $state<EnrichedSpeciesListEntry[]>([]);
  let entriesLoading = $state(false);
  let entryFilter = $state('');

  const selectedList = $derived(lists.find((l) => l.id === appState.selectedSpeciesListId) ?? null);
  const filteredEntries = $derived(() => {
    if (!entryFilter) return entries;
    const q = entryFilter.toLowerCase();
    return entries.filter(
      (e) => e.resolved_common_name.toLowerCase().includes(q) || e.scientific_name.toLowerCase().includes(q),
    );
  });

  // --- Fetch modal state ---
  let showFetchModal = $state(false);
  let fetchLat = $state(0);
  let fetchLon = $state(0);
  let fetchWeek = $state<number | undefined>(undefined);
  let fetchThreshold = $state(0.03);
  let fetchLoading = $state(false);
  let fetchError = $state<string | null>(null);
  let fetchResult = $state<BirdaSpeciesResponse | null>(null);
  let fetchListName = $state('');

  // --- Custom list modal state ---
  let showCustomModal = $state(false);
  let customName = $state('');
  let customDescription = $state('');
  let customSearchQuery = $state('');
  let customSearchResults = $state<{ scientific_name: string; common_name: string }[]>([]);
  const customSelected = new SvelteMap<string, string>(); // scientific_name -> common_name
  let customSearchTimeout: ReturnType<typeof setTimeout> | null = null;

  async function refreshLists() {
    try {
      lists = await getSpeciesLists();
    } catch {
      lists = [];
    } finally {
      listsLoading = false;
    }
  }

  async function loadEntries(listId: number) {
    entriesLoading = true;
    try {
      entries = await getSpeciesListEntries(listId);
    } catch {
      entries = [];
    } finally {
      entriesLoading = false;
    }
  }

  function handleListSelect(listId: number) {
    appState.selectedSpeciesListId = listId;
    entryFilter = '';
    void loadEntries(listId);
  }

  async function handleListDelete(id: number) {
    try {
      await deleteSpeciesListById(id);
      lists = lists.filter((l) => l.id !== id);
      if (appState.selectedSpeciesListId === id) {
        appState.selectedSpeciesListId = null;
        entries = [];
      }
    } catch (err) {
      console.error('Failed to delete species list', id, err);
    }
  }

  function handleUseAsFilter() {
    if (!selectedList) return;
    appState.activeTab = 'detections';
    // The DetectionsPage will pick up the species_list_id from the filter
    // We store the intent in a way that DetectionsPage can consume
    appState.selectedSpeciesListId = selectedList.id;
  }

  // --- Fetch modal ---
  function openFetchModal() {
    fetchLat = 0;
    fetchLon = 0;
    fetchWeek = undefined;
    fetchThreshold = 0.03;
    fetchLoading = false;
    fetchError = null;
    fetchResult = null;
    fetchListName = '';
    showFetchModal = true;
  }

  async function handleFetch() {
    if (fetchWeek === undefined || fetchWeek < 1 || fetchWeek > 48) {
      fetchError = 'Week must be between 1 and 48';
      return;
    }
    if (fetchLat === 0 && fetchLon === 0) {
      fetchError = 'Please set coordinates';
      return;
    }

    fetchLoading = true;
    fetchError = null;
    try {
      fetchResult = await fetchSpeciesList({
        latitude: fetchLat,
        longitude: fetchLon,
        week: fetchWeek,
        threshold: fetchThreshold,
      });
      // Auto-generate a default name
      fetchListName = `${fetchLat.toFixed(2)}, ${fetchLon.toFixed(2)} — Week ${fetchWeek}`;
    } catch (err) {
      fetchError = (err as Error).message;
    } finally {
      fetchLoading = false;
    }
  }

  async function handleSaveFetchedList() {
    if (!fetchResult || !fetchListName.trim()) return;
    try {
      const saved = await saveSpeciesList(fetchListName.trim(), $state.snapshot(fetchResult));
      lists = [saved, ...lists];
      showFetchModal = false;
      appState.selectedSpeciesListId = saved.id;
      void loadEntries(saved.id);
    } catch (err) {
      fetchError = (err as Error).message;
    }
  }

  // --- Custom list modal ---
  function openCustomModal() {
    customName = '';
    customDescription = '';
    customSearchQuery = '';
    customSearchResults = [];
    customSelected.clear();
    showCustomModal = true;
  }

  async function doCustomSearch() {
    if (!customSearchQuery.trim()) {
      customSearchResults = [];
      return;
    }
    try {
      // Use the labels:search-by-common-name IPC to find species
      const scientificNames = (await window.birda.invoke(
        'labels:search-by-common-name',
        customSearchQuery,
      )) as string[];
      // Resolve common names
      const nameMap = (await window.birda.invoke('labels:resolve-all', scientificNames)) as Record<string, string>;
      customSearchResults = scientificNames.slice(0, 50).map((sn) => ({
        scientific_name: sn,
        common_name: nameMap[sn] ?? sn,
      }));
    } catch {
      customSearchResults = [];
    }
  }

  function handleCustomSearch() {
    if (customSearchTimeout) clearTimeout(customSearchTimeout);
    customSearchTimeout = setTimeout(() => {
      void doCustomSearch();
    }, 200);
  }

  function addToCustomList(scientificName: string, commonName: string) {
    customSelected.set(scientificName, commonName);
  }

  function removeFromCustomList(scientificName: string) {
    customSelected.delete(scientificName);
  }

  async function handleCreateCustomList() {
    if (!customName.trim() || customSelected.size === 0) return;
    try {
      const saved = await createCustomSpeciesList(
        customName.trim(),
        [...customSelected.keys()],
        customDescription.trim() || undefined,
      );
      lists = [saved, ...lists];
      showCustomModal = false;
      appState.selectedSpeciesListId = saved.id;
      void loadEntries(saved.id);
    } catch (err) {
      console.error('Failed to create custom list', err);
    }
  }

  // Week-to-month helper
  function weekToMonth(week: number): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const idx = Math.min(Math.floor((week - 1) / 4), 11);
    return months[idx];
  }

  onMount(() => {
    void refreshLists();
  });

  // Load entries when selectedSpeciesListId changes externally
  let prevListId: number | null = null;
  $effect(() => {
    if (appState.selectedSpeciesListId !== prevListId) {
      prevListId = appState.selectedSpeciesListId;
      if (appState.selectedSpeciesListId) {
        void loadEntries(appState.selectedSpeciesListId);
      }
    }
  });
</script>

<div class="flex flex-1 overflow-hidden">
  <!-- Left panel: Species list sidebar -->
  <div class="border-base-300 flex w-64 shrink-0 flex-col border-r">
    <div class="border-base-300 flex items-center justify-between border-b px-3 py-2">
      <h2 class="text-sm font-semibold">{m.species_title()}</h2>
    </div>

    <!-- Action buttons -->
    <div class="border-base-300 flex gap-1 border-b px-3 py-2">
      <button onclick={openFetchModal} class="btn btn-outline btn-xs flex-1 gap-1">
        <Download size={12} />
        {m.species_fetchNew()}
      </button>
      <button onclick={openCustomModal} class="btn btn-outline btn-xs flex-1 gap-1">
        <Plus size={12} />
        {m.species_customList()}
      </button>
    </div>

    <!-- Species lists -->
    <div class="flex-1 overflow-y-auto">
      {#if listsLoading}
        <div class="text-base-content/40 p-4 text-center text-sm">Loading...</div>
      {:else if lists.length === 0}
        <div class="flex flex-col items-center gap-2 p-6 text-center">
          <Bird size={32} class="text-base-content/15" />
          <p class="text-base-content/40 text-sm">{m.species_empty()}</p>
          <p class="text-base-content/30 text-xs">{m.species_emptyHint()}</p>
        </div>
      {:else}
        {#each lists as list (list.id)}
          <div
            role="button"
            tabindex="0"
            onclick={() => {
              handleListSelect(list.id);
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleListSelect(list.id);
              }
            }}
            class="group border-base-300 flex w-full cursor-pointer items-start gap-2 border-b px-3 py-2.5 text-left transition-colors
              {appState.selectedSpeciesListId === list.id
              ? 'bg-primary/10 border-l-primary border-l-2'
              : 'hover:bg-base-200/50'}"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{list.name}</div>
              <div class="text-base-content/50 flex items-center gap-2 text-xs">
                <span
                  class="rounded px-1 py-0.5 text-[10px] font-medium
                  {list.source === 'fetched' ? 'bg-info/20 text-info' : 'bg-success/20 text-success'}"
                >
                  {list.source === 'fetched' ? m.species_sourceFetched() : m.species_sourceCustom()}
                </span>
                <span>{m.species_speciesCount({ count: String(list.species_count) })}</span>
              </div>
            </div>
            <button
              onclick={(e) => {
                e.stopPropagation();
                void handleListDelete(list.id);
              }}
              class="text-base-content/30 hover:text-error mt-0.5 opacity-0 transition-opacity group-hover:opacity-100"
              title={m.species_deleteList()}
            >
              <Trash2 size={14} />
            </button>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Right panel: Selected list content -->
  {#if selectedList}
    <div class="flex flex-1 flex-col overflow-hidden">
      <!-- Header -->
      <div class="border-base-300 bg-base-200/50 flex items-center gap-3 border-b px-4 py-2.5 text-sm">
        <Bird size={16} class="text-primary shrink-0" />
        <span class="font-medium">{selectedList.name}</span>
        <span class="text-base-content/40">|</span>
        <span class="text-base-content/60">
          {m.species_speciesCount({ count: String(selectedList.species_count) })}
        </span>

        {#if selectedList.source === 'fetched'}
          {#if selectedList.latitude !== null && selectedList.longitude !== null}
            <span class="text-base-content/40">|</span>
            <span class="text-base-content/50 flex items-center gap-1 text-xs">
              <MapPin size={11} />
              {selectedList.latitude.toFixed(2)}, {selectedList.longitude.toFixed(2)}
            </span>
          {/if}
          {#if selectedList.week !== null}
            <span class="text-base-content/50 text-xs">
              {m.species_detail_week({ week: String(selectedList.week) })}
            </span>
          {/if}
          {#if selectedList.threshold !== null}
            <span class="text-base-content/50 text-xs">
              {m.species_detail_threshold({ threshold: (selectedList.threshold * 100).toFixed(1) })}
            </span>
          {/if}
        {/if}

        <!-- Search within list -->
        <div class="relative ml-auto">
          <Search size={14} class="text-base-content/40 absolute top-1/2 left-2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={m.species_searchInList()}
            bind:value={entryFilter}
            class="input input-bordered input-sm w-48 pr-7 pl-7 text-xs"
          />
          {#if entryFilter}
            <button
              onclick={() => (entryFilter = '')}
              class="text-base-content/40 hover:text-base-content absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5"
            >
              <X size={12} />
            </button>
          {/if}
        </div>

        <button onclick={handleUseAsFilter} class="btn btn-primary btn-xs gap-1" title={m.species_useAsFilter()}>
          <Funnel size={12} />
          {m.species_useAsFilter()}
        </button>
      </div>

      <!-- Species table -->
      <div class="flex-1 overflow-y-auto">
        {#if entriesLoading}
          <div class="text-base-content/40 p-8 text-center text-sm">Loading...</div>
        {:else}
          <table class="table-sm table">
            <thead class="bg-base-200/50">
              <tr>
                <th class="w-[40%]">{m.species_table_commonName()}</th>
                <th class="w-[40%]">{m.species_table_scientificName()}</th>
                <th class="w-[20%] text-right">{m.species_table_frequency()}</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredEntries() as entry (entry.id)}
                <tr class="hover:bg-base-200/30">
                  <td class="text-sm">{entry.resolved_common_name}</td>
                  <td class="text-base-content/60 text-sm italic">{entry.scientific_name}</td>
                  <td class="text-right">
                    {#if entry.frequency !== null}
                      <div class="flex items-center justify-end gap-2">
                        <div class="bg-base-300 h-1.5 w-16 rounded-full">
                          <div
                            class="bg-primary h-1.5 rounded-full"
                            style="width: {Math.min(entry.frequency * 100, 100)}%"
                          ></div>
                        </div>
                        <span class="text-base-content/60 w-12 text-right text-xs tabular-nums">
                          {(entry.frequency * 100).toFixed(1)}%
                        </span>
                      </div>
                    {:else}
                      <span class="text-base-content/30 text-xs">—</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>
  {:else}
    <!-- No list selected -->
    <div class="flex flex-1 flex-col items-center justify-center gap-3">
      <Bird size={40} class="text-base-content/15" />
      <p class="text-base-content/40 text-sm">{m.species_selectList()}</p>
    </div>
  {/if}
</div>

<!-- Fetch Species Modal -->
{#if showFetchModal}
  <dialog class="modal modal-open">
    <div class="modal-box max-w-lg">
      <div class="flex items-center gap-2">
        <Download size={18} class="text-primary" />
        <h3 class="text-lg font-semibold">{m.species_fetch_title()}</h3>
      </div>
      <p class="text-base-content/60 mt-1 text-sm">{m.species_fetch_subtitle()}</p>

      <div class="mt-4 space-y-4">
        <CoordinateInput bind:latitude={fetchLat} bind:longitude={fetchLon} />

        <div class="flex gap-3">
          <label class="flex-1">
            <span class="text-base-content/70 text-xs">{m.species_fetch_week()}</span>
            <div class="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="48"
                bind:value={fetchWeek}
                class="input input-bordered input-sm w-full"
                placeholder={m.species_fetch_weekHint()}
              />
              {#if fetchWeek && fetchWeek >= 1 && fetchWeek <= 48}
                <span class="text-base-content/50 shrink-0 text-xs">~{weekToMonth(fetchWeek)}</span>
              {/if}
            </div>
          </label>
          <label class="w-32">
            <span class="text-base-content/70 text-xs">{m.species_fetch_threshold()}</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              bind:value={fetchThreshold}
              class="input input-bordered input-sm w-full"
            />
          </label>
        </div>

        {#if fetchError}
          <div class="text-error text-sm">{m.species_fetch_error({ error: fetchError })}</div>
        {/if}

        {#if !fetchResult}
          <button onclick={handleFetch} disabled={fetchLoading} class="btn btn-primary btn-sm w-full">
            {#if fetchLoading}
              <span class="loading loading-spinner loading-xs"></span>
              {m.species_fetch_fetching()}
            {:else}
              {m.species_fetch_button()}
            {/if}
          </button>
        {:else}
          <!-- Results preview -->
          <div class="bg-base-200 rounded-lg p-3">
            <div class="text-sm font-medium">
              {m.species_fetch_resultCount({ count: String(fetchResult.species_count) })}
            </div>
            <div class="mt-2 max-h-48 overflow-y-auto">
              {#each fetchResult.species.slice(0, 20) as species (species.scientific_name)}
                <div class="text-base-content/70 flex justify-between py-0.5 text-xs">
                  <span>{species.common_name}</span>
                  <span class="text-base-content/40 tabular-nums">{(species.frequency * 100).toFixed(1)}%</span>
                </div>
              {/each}
              {#if fetchResult.species.length > 20}
                <div class="text-base-content/40 mt-1 text-xs">
                  ...and {fetchResult.species.length - 20} more
                </div>
              {/if}
            </div>
          </div>

          <label>
            <span class="text-base-content/70 text-xs">{m.species_fetch_listName()}</span>
            <input
              type="text"
              bind:value={fetchListName}
              class="input input-bordered input-sm w-full"
              placeholder={m.species_fetch_listNamePlaceholder()}
            />
          </label>

          <button
            onclick={handleSaveFetchedList}
            disabled={!fetchListName.trim()}
            class="btn btn-primary btn-sm w-full"
          >
            {m.species_fetch_save()}
          </button>
        {/if}
      </div>

      <div class="modal-action">
        <button onclick={() => (showFetchModal = false)} class="btn btn-ghost btn-sm">
          {m.common_button_close()}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button onclick={() => (showFetchModal = false)}>close</button>
    </form>
  </dialog>
{/if}

<!-- Custom Species List Modal -->
{#if showCustomModal}
  <dialog class="modal modal-open">
    <div class="modal-box max-w-lg">
      <div class="flex items-center gap-2">
        <Plus size={18} class="text-primary" />
        <h3 class="text-lg font-semibold">{m.species_custom_title()}</h3>
      </div>

      <div class="mt-4 space-y-3">
        <label>
          <span class="text-base-content/70 text-xs">{m.species_custom_name()}</span>
          <input
            type="text"
            bind:value={customName}
            class="input input-bordered input-sm w-full"
            placeholder={m.species_custom_namePlaceholder()}
          />
        </label>

        <label>
          <span class="text-base-content/70 text-xs">{m.species_custom_description()}</span>
          <input
            type="text"
            bind:value={customDescription}
            class="input input-bordered input-sm w-full"
            placeholder={m.species_custom_descriptionPlaceholder()}
          />
        </label>

        <!-- Species search -->
        <div>
          <span class="text-base-content/70 text-xs">{m.species_custom_searchAdd()}</span>
          <div class="relative mt-1">
            <Search size={14} class="text-base-content/40 absolute top-1/2 left-2 -translate-y-1/2" />
            <input
              type="text"
              bind:value={customSearchQuery}
              oninput={handleCustomSearch}
              class="input input-bordered input-sm w-full pl-7"
              placeholder={m.species_custom_searchAdd()}
            />
          </div>

          {#if customSearchResults.length > 0}
            <div class="border-base-300 mt-1 max-h-40 overflow-y-auto rounded border">
              {#each customSearchResults as result (result.scientific_name)}
                {@const isSelected = customSelected.has(result.scientific_name)}
                <button
                  onclick={() => {
                    if (isSelected) {
                      removeFromCustomList(result.scientific_name);
                    } else {
                      addToCustomList(result.scientific_name, result.common_name);
                    }
                  }}
                  class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors
                    {isSelected ? 'bg-primary/10' : 'hover:bg-base-200'}"
                >
                  <input type="checkbox" checked={isSelected} class="checkbox checkbox-xs checkbox-primary" />
                  <span class="flex-1">{result.common_name}</span>
                  <span class="text-base-content/40 italic">{result.scientific_name}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Selected species chips -->
        {#if customSelected.size > 0}
          <div>
            <span class="text-base-content/70 text-xs">
              {m.species_custom_selectedCount({ count: String(customSelected.size) })}
            </span>
            <div class="mt-1 flex flex-wrap gap-1">
              {#each [...customSelected.entries()] as [sci, common] (sci)}
                <span class="badge badge-sm gap-1">
                  {common}
                  <button
                    onclick={() => {
                      removeFromCustomList(sci);
                    }}
                    class="hover:text-error"
                  >
                    <X size={10} />
                  </button>
                </span>
              {/each}
            </div>
          </div>
        {/if}

        <button
          onclick={handleCreateCustomList}
          disabled={!customName.trim() || customSelected.size === 0}
          class="btn btn-primary btn-sm w-full"
        >
          {m.species_custom_create()}
        </button>
      </div>

      <div class="modal-action">
        <button onclick={() => (showCustomModal = false)} class="btn btn-ghost btn-sm">
          {m.common_button_close()}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button onclick={() => (showCustomModal = false)}>close</button>
    </form>
  </dialog>
{/if}
