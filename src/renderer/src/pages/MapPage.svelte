<script lang="ts">
  import SpeciesSearch from '$lib/components/SpeciesSearch.svelte';
  import MapView from '$lib/components/MapView.svelte';
  import { mapState } from '$lib/stores/map.svelte';
  import { appState } from '$lib/stores/app.svelte';
  import { getLocationsWithCounts, getSpeciesLocations } from '$lib/utils/ipc';
  import { latestRequest } from '$lib/utils/latest';
  import { SvelteMap } from 'svelte/reactivity';
  import { untrack } from 'svelte';
  import type { EnrichedSpeciesSummary } from '$shared/types';

  // Load on mount and reload when the catalog's runs change; the page stays mounted while hidden.
  $effect(() => {
    const _version = appState.runsVersion; // re-run when the runs change
    untrack(() => {
      void loadLocations();
    });
  });

  // Only the newest location load applies its result.
  const locationsRequest = latestRequest();

  async function loadLocations() {
    const isLatest = locationsRequest();
    mapState.loading = true;
    try {
      const locations = await getLocationsWithCounts();
      if (!isLatest()) return;
      mapState.locations = locations.map((l) => ({
        location_id: l.id,
        latitude: l.latitude,
        longitude: l.longitude,
        name: l.name,
        detection_count: l.detection_count,
        species_count: l.species_count,
      }));
    } catch {
      // No locations yet
    } finally {
      if (isLatest()) mapState.loading = false;
    }
    // Keep a selected species' highlight and its per-location counts after a reload.
    if (mapState.selectedSpecies) await highlightSpecies(mapState.selectedSpecies);
  }

  async function handleSpeciesSelect(species: EnrichedSpeciesSummary) {
    mapState.selectedSpecies = species.scientific_name;
    await highlightSpecies(species.scientific_name);
  }

  // Only the newest species request applies; clearing the species drops one still loading.
  const speciesRequest = latestRequest();

  async function highlightSpecies(scientificName: string) {
    const isLatest = speciesRequest();
    try {
      const locs = await getSpeciesLocations(scientificName);
      if (!isLatest()) return;
      mapState.speciesCounts = new SvelteMap(locs.map((l) => [l.location_id, l.detection_count]));
    } catch {
      if (isLatest()) mapState.speciesCounts = new SvelteMap();
    }
  }

  function handleSpeciesClear() {
    speciesRequest();
    mapState.selectedSpecies = null;
    mapState.speciesCounts = new SvelteMap();
  }
</script>

<div class="flex flex-1 flex-col overflow-hidden">
  <div class="border-base-300 bg-base-200 border-b p-2">
    <SpeciesSearch onselect={handleSpeciesSelect} onclear={handleSpeciesClear} />
  </div>
  <MapView />
</div>
