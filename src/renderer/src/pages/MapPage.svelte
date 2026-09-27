<script lang="ts">
  import SpeciesSearch from '$lib/components/SpeciesSearch.svelte';
  import MapView from '$lib/components/MapView.svelte';
  import { mapState } from '$lib/stores/map.svelte';
  import { appState } from '$lib/stores/app.svelte';
  import { getLocationsWithCounts, getSpeciesLocations } from '$lib/utils/ipc';
  import { SvelteSet } from 'svelte/reactivity';
  import { onMount } from 'svelte';
  import type { EnrichedSpeciesSummary } from '$shared/types';

  // Reload when the catalog's runs change; the page stays mounted while hidden.
  let seenRunsVersion = appState.runsVersion;
  $effect(() => {
    if (appState.runsVersion !== seenRunsVersion) {
      seenRunsVersion = appState.runsVersion;
      void loadLocations();
    }
  });

  onMount(() => {
    void loadLocations();
  });

  async function loadLocations() {
    mapState.loading = true;
    try {
      const locations = await getLocationsWithCounts();
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
      mapState.loading = false;
    }
    // Keep a selected species' highlight and its per-location counts after a reload.
    if (mapState.selectedSpecies) await highlightSpecies(mapState.selectedSpecies);
  }

  async function handleSpeciesSelect(species: EnrichedSpeciesSummary) {
    mapState.selectedSpecies = species.scientific_name;
    await highlightSpecies(species.scientific_name);
  }

  async function highlightSpecies(scientificName: string) {
    try {
      const locs = await getSpeciesLocations(scientificName);
      mapState.highlightedLocationIds = new SvelteSet(locs.map((l) => l.location_id));
      // Update detection counts from the species-specific query
      for (const loc of locs) {
        const existing = mapState.locations.find((l) => l.location_id === loc.location_id);
        if (existing) {
          existing.detection_count = loc.detection_count;
        }
      }
    } catch {
      mapState.highlightedLocationIds = new SvelteSet();
    }
  }

  function handleSpeciesClear() {
    mapState.selectedSpecies = null;
    mapState.highlightedLocationIds = new SvelteSet();
  }
</script>

<div class="flex flex-1 flex-col overflow-hidden">
  <div class="border-base-300 bg-base-200 border-b p-2">
    <SpeciesSearch onselect={handleSpeciesSelect} onclear={handleSpeciesClear} />
  </div>
  <MapView />
</div>
