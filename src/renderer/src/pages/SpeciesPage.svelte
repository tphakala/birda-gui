<script lang="ts">
  import { focusIfLost, showModal } from '$lib/utils/dialog';
  import { Bird, Download, Plus, Search, Trash, X, Funnel, MapPin } from '@lucide/svelte';
  import CoordinateInput from '$lib/components/CoordinateInput.svelte';
  import { appState, requestTab, speciesListsChanged } from '$lib/stores/app.svelte';
  import { showToast } from '$lib/stores/toast.svelte';
  import {
    fetchSpeciesList,
    saveSpeciesList,
    getSpeciesLists,
    getSpeciesListEntries,
    deleteSpeciesListById,
    createCustomSpeciesList,
    searchByCommonName,
    resolveAllLabels,
  } from '$lib/utils/ipc';
  import { latestRequest } from '$lib/utils/latest';
  import { describeBirdaFailure, speciesFetchProblem } from '$shared/birda-error';
  import { keepIfPresent } from '$lib/utils/selection';
  import type { SpeciesList, EnrichedSpeciesListEntry, BirdaSpeciesResponse } from '$shared/types';
  import { tick, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import * as m from '$paraglide/messages';
  import { getLocale } from '$paraglide/runtime';

  // --- List panel state ---
  let lists = $state<SpeciesList[]>([]);
  let listsLoading = $state(true);

  // --- Selected list state ---
  // The list shown on the right; a request to filter Detections by it is a separate, one-shot appState.listFilterRequest.
  let selectedListId = $state<number | null>(null);
  let entries = $state<EnrichedSpeciesListEntry[]>([]);
  let entriesLoading = $state(false);
  let entryFilter = $state('');

  const selectedList = $derived(lists.find((l) => l.id === selectedListId) ?? null);
  const filteredEntries = $derived.by(() => {
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
  // The model the fetch asked for, to tell when another model's range model was used.
  let fetchRequestedModel = $state('');
  let fetchListName = $state('');

  // --- Custom list modal state ---
  let showCustomModal = $state(false);
  let customName = $state('');
  let customDescription = $state('');
  let customError = $state<string | null>(null);
  let customSearchQuery = $state('');
  let customSearchResults = $state<{ scientific_name: string; common_name: string }[]>([]);
  // The query customSearchResults belong to; the count is announced only once they match.
  let customResultsQuery = $state('');
  const customSelected = new SvelteMap<string, string>(); // scientific_name -> common_name
  let customSearchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Only the newest load of each kind applies its result.
  const listsRequest = latestRequest();
  const entriesRequest = latestRequest();

  async function refreshLists() {
    const isLatest = listsRequest();
    try {
      const loaded = await getSpeciesLists();
      if (!isLatest()) return;
      lists = loaded;
      // The open list was deleted elsewhere, for example by Clear Database.
      if (selectedListId !== null && keepIfPresent(selectedListId, loaded) === null) selectList(null);
    } catch {
      // Keep the lists shown so far
    } finally {
      if (isLatest()) listsLoading = false;
    }
  }

  async function loadEntries(listId: number) {
    const isLatest = entriesRequest();
    entriesLoading = true;
    try {
      const loaded = await getSpeciesListEntries(listId);
      if (!isLatest()) return;
      entries = loaded;
    } catch {
      if (isLatest()) entries = [];
    } finally {
      if (isLatest()) entriesLoading = false;
    }
  }

  /** Shows a list, or none. This is the only place that changes the selection, so its entries load exactly once. */
  function selectList(listId: number | null) {
    selectedListId = listId;
    entryFilter = '';
    if (listId === null) {
      // A load still in flight was for the list that was open.
      entriesRequest();
      entries = [];
      entriesLoading = false;
    } else {
      void loadEntries(listId);
    }
  }

  let pendingDelete = $state<SpeciesList | null>(null);
  let listsHeading = $state<HTMLHeadingElement>();

  async function handleListDelete(target: SpeciesList) {
    const id = target.id;
    pendingDelete = null;
    try {
      await deleteSpeciesListById(id);
      lists = lists.filter((l) => l.id !== id);
      if (selectedListId === id) selectList(null);
      speciesListsChanged();
      // The delete button that opened the confirmation is gone with its row.
      await tick();
      focusIfLost(listsHeading);
    } catch (err) {
      console.error('Failed to delete species list', id, err);
      showToast(m.species_deleteFailed({ name: target.name, error: (err as Error).message }), { severity: 'error' });
    }
  }

  function handleUseAsFilter() {
    if (!selectedList) return;
    appState.listFilterRequest = selectedList.id;
    requestTab('detections');
  }

  // --- Fetch modal ---
  // Bumped whenever the dialog opens, so a fetch that finishes after its
  // dialog was closed cannot write into a newer one.
  let fetchSeq = 0;

  function openFetchModal() {
    fetchSeq++;
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
      fetchError = m.species_fetch_weekError();
      return;
    }
    if (fetchLat === 0 && fetchLon === 0) {
      fetchError = m.species_fetch_coordsError();
      return;
    }

    const seq = fetchSeq;
    // The inputs stay editable while the fetch runs; name the list after the request that was sent.
    const request = {
      latitude: fetchLat,
      longitude: fetchLon,
      week: fetchWeek,
      threshold: fetchThreshold,
      model: appState.selectedModel || undefined,
    };
    fetchLoading = true;
    fetchError = null;
    try {
      const result = await fetchSpeciesList(request);
      if (seq !== fetchSeq) return;
      fetchResult = result;
      fetchRequestedModel = request.model ?? '';
      // Auto-generate a default name
      fetchListName = m.species_fetch_defaultName({
        lat: request.latitude.toFixed(2),
        lon: request.longitude.toFixed(2),
        week: String(request.week),
      });
    } catch (err) {
      if (seq === fetchSeq) {
        const message = err instanceof Error ? err.message : String(err);
        const problem = speciesFetchProblem(message);
        fetchError =
          problem === 'no_installed_model'
            ? m.species_fetch_noInstalledModel()
            : problem === 'no_model'
              ? m.species_fetch_noModel()
              : problem === 'no_range_model'
                ? m.species_fetch_noRangeModel()
                : describeBirdaFailure(message).headline;
      }
    } finally {
      if (seq === fetchSeq) fetchLoading = false;
    }
  }

  async function handleSaveFetchedList() {
    if (!fetchResult || !fetchListName.trim()) return;
    try {
      const saved = await saveSpeciesList(fetchListName.trim(), $state.snapshot(fetchResult));
      lists = [saved, ...lists];
      showFetchModal = false;
      selectList(saved.id);
      speciesListsChanged();
    } catch (err) {
      fetchError = (err as Error).message;
    }
  }

  // --- Custom list modal ---
  function openCustomModal() {
    customName = '';
    customDescription = '';
    customError = null;
    customSearchQuery = '';
    customSearchResults = [];
    customResultsQuery = '';
    customSelected.clear();
    showCustomModal = true;
  }

  async function doCustomSearch() {
    const query = customSearchQuery;
    if (!query.trim()) {
      customSearchResults = [];
      customResultsQuery = query;
      return;
    }
    let results: typeof customSearchResults;
    try {
      const scientificNames = await searchByCommonName(query);
      const nameMap = await resolveAllLabels(scientificNames);
      results = scientificNames.slice(0, 50).map((sn) => ({
        scientific_name: sn,
        common_name: nameMap[sn] ?? sn,
      }));
    } catch {
      results = [];
    }
    // The query changed (or was cleared) while this search was running.
    if (query !== customSearchQuery) return;
    customSearchResults = results;
    customResultsQuery = query;
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
    customError = null;
    try {
      const saved = await createCustomSpeciesList(
        customName.trim(),
        [...customSelected.keys()],
        customDescription.trim() || undefined,
      );
      lists = [saved, ...lists];
      showCustomModal = false;
      selectList(saved.id);
      speciesListsChanged();
    } catch (err) {
      customError = (err as Error).message;
    }
  }

  // Week-to-month helper
  function weekToMonth(week: number): string {
    const idx = Math.min(Math.floor((week - 1) / 4), 11);
    return new Intl.DateTimeFormat(getLocale(), { month: 'short' }).format(new Date(2000, idx, 1));
  }

  // Load the lists on mount and whenever they change elsewhere (Clear Database).
  $effect(() => {
    const _version = appState.speciesListsVersion; // re-run when the lists change
    untrack(() => {
      void refreshLists();
    });
  });
</script>

<div class="flex flex-1 overflow-hidden">
  <!-- Left panel: Species list sidebar -->
  <div class="border-base-300 flex w-64 shrink-0 flex-col border-r">
    <div class="border-base-300 flex items-center justify-between border-b px-3 py-2">
      <h2 bind:this={listsHeading} tabindex="-1" class="text-sm font-semibold">{m.species_title()}</h2>
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
        <div class="text-base-content/40 p-4 text-center text-sm">{m.species_loading()}</div>
      {:else if lists.length === 0}
        <div class="flex flex-col items-center gap-2 p-6 text-center">
          <Bird size={32} class="text-base-content/15" />
          <p class="text-base-content/40 text-sm">{m.species_empty()}</p>
          <p class="text-base-content/30 text-xs">{m.species_emptyHint()}</p>
        </div>
      {:else}
        {#each lists as list (list.id)}
          <div
            class="group border-base-300 flex w-full items-start gap-2 border-b pr-3 transition-colors
              {selectedListId === list.id ? 'bg-primary/10 border-l-primary border-l-2' : 'hover:bg-base-200/50'}"
          >
            <button
              type="button"
              onclick={() => {
                selectList(list.id);
              }}
              aria-current={selectedListId === list.id ? 'true' : undefined}
              class="min-w-0 flex-1 cursor-pointer py-2.5 pl-3 text-left"
            >
              <span class="block truncate text-sm font-medium">{list.name}</span>
              <span class="text-base-content/50 flex items-center gap-2 text-xs">
                <span
                  class="rounded px-1 py-0.5 text-[10px] font-medium
                  {list.source === 'fetched' ? 'bg-info/20 text-info' : 'bg-success/20 text-success'}"
                >
                  {list.source === 'fetched' ? m.species_sourceFetched() : m.species_sourceCustom()}
                </span>
                <span>{m.species_speciesCount({ count: String(list.species_count) })}</span>
              </span>
            </button>
            <button
              type="button"
              onclick={() => (pendingDelete = list)}
              class="text-base-content/30 hover:text-error mt-3 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
              title={m.species_deleteList()}
              aria-label={m.species_deleteList()}
            >
              <Trash size={14} />
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
            aria-label={m.species_searchInList()}
            bind:value={entryFilter}
            class="input input-bordered input-sm w-48 pr-7 pl-7 text-xs"
          />
          {#if entryFilter}
            <button
              type="button"
              onclick={() => (entryFilter = '')}
              aria-label={m.common_button_clear()}
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
          <div class="text-base-content/40 p-8 text-center text-sm">{m.species_loading()}</div>
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
              {#each filteredEntries as entry (entry.id)}
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
                      <span class="text-base-content/30 text-xs">-</span>
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
  <dialog
    class="modal"
    {@attach showModal}
    onclose={() => (showFetchModal = false)}
    aria-labelledby="fetch-modal-title"
    aria-describedby="fetch-modal-subtitle"
  >
    <div class="modal-box max-w-lg">
      <div class="flex items-center gap-2">
        <Download size={18} class="text-primary" />
        <h3 id="fetch-modal-title" class="text-lg font-semibold">{m.species_fetch_title()}</h3>
      </div>
      <p id="fetch-modal-subtitle" class="text-base-content/60 mt-1 text-sm">{m.species_fetch_subtitle()}</p>

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
            {#if fetchResult.model_used && fetchResult.model_used !== fetchRequestedModel}
              <div class="text-base-content/60 mt-1 text-xs">
                {m.species_fetch_usedModel({ model: fetchResult.model_used })}
              </div>
            {/if}
            <div class="mt-2 max-h-48 overflow-y-auto">
              {#each fetchResult.species.slice(0, 20) as species (species.scientific_name)}
                <div class="text-base-content/70 flex justify-between py-0.5 text-xs">
                  <span>{species.common_name}</span>
                  <span class="text-base-content/40 tabular-nums">{(species.frequency * 100).toFixed(1)}%</span>
                </div>
              {/each}
              {#if fetchResult.species.length > 20}
                <div class="text-base-content/40 mt-1 text-xs">
                  {m.species_fetch_moreSpecies({ count: String(fetchResult.species.length - 20) })}
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
      <button tabindex="-1" aria-label={m.common_button_close()}>close</button>
    </form>
  </dialog>
{/if}

<!-- Custom Species List Modal -->
{#if showCustomModal}
  <dialog
    class="modal"
    {@attach showModal}
    onclose={() => (showCustomModal = false)}
    aria-labelledby="custom-modal-title"
  >
    <div class="modal-box max-w-lg">
      <div class="flex items-center gap-2">
        <Plus size={18} class="text-primary" />
        <h3 id="custom-modal-title" class="text-lg font-semibold">{m.species_custom_title()}</h3>
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
              onkeydown={(e) => {
                // Escape clears a non-empty search instead of closing the dialog.
                if (e.key === 'Escape' && customSearchQuery) {
                  e.preventDefault();
                  if (customSearchTimeout) clearTimeout(customSearchTimeout);
                  customSearchQuery = '';
                  customSearchResults = [];
                  customResultsQuery = '';
                }
              }}
              class="input input-bordered input-sm w-full pl-7"
              placeholder={m.species_custom_searchAdd()}
              aria-label={m.species_custom_searchAdd()}
            />
          </div>

          <p class="sr-only" aria-live="polite">
            {customSearchQuery && customResultsQuery === customSearchQuery
              ? m.species_custom_resultCount({ count: String(customSearchResults.length) })
              : ''}
          </p>
          {#if customSearchResults.length > 0}
            <div class="border-base-300 mt-1 max-h-40 overflow-y-auto rounded border">
              {#each customSearchResults as result (result.scientific_name)}
                {@const isSelected = customSelected.has(result.scientific_name)}
                <label
                  class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors
                    {isSelected ? 'bg-primary/10' : 'hover:bg-base-200'}"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onchange={() => {
                      if (isSelected) {
                        removeFromCustomList(result.scientific_name);
                      } else {
                        addToCustomList(result.scientific_name, result.common_name);
                      }
                    }}
                    class="checkbox checkbox-xs checkbox-primary"
                  />
                  <span class="flex-1">{result.common_name}</span>
                  <span class="text-base-content/40 italic">{result.scientific_name}</span>
                </label>
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
                    type="button"
                    onclick={() => {
                      removeFromCustomList(sci);
                    }}
                    aria-label={m.species_custom_removeSpecies({ name: common })}
                    class="hover:text-error"
                  >
                    <X size={10} />
                  </button>
                </span>
              {/each}
            </div>
          </div>
        {/if}

        {#if customError}
          <div class="text-error text-sm">{customError}</div>
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
      <button tabindex="-1" aria-label={m.common_button_close()}>close</button>
    </form>
  </dialog>
{/if}

<!-- Delete Species List Confirmation -->
{#if pendingDelete}
  {@const target = pendingDelete}
  <dialog
    class="modal"
    {@attach showModal}
    onclose={() => (pendingDelete = null)}
    role="alertdialog"
    aria-labelledby="delete-list-title"
    aria-describedby="delete-list-body"
  >
    <div class="modal-box max-w-sm">
      <h3 id="delete-list-title" class="text-lg font-semibold">{m.species_deleteConfirm_title()}</h3>
      <p id="delete-list-body" class="text-base-content/70 mt-2 text-sm">
        {m.species_deleteConfirm_body({ name: target.name })}
      </p>
      <div class="modal-action">
        <button type="button" onclick={() => (pendingDelete = null)} class="btn">{m.common_button_cancel()}</button>
        <button type="button" onclick={() => void handleListDelete(target)} class="btn btn-error">
          {m.species_deleteList()}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" aria-label={m.common_button_close()}>close</button>
    </form>
  </dialog>
{/if}
