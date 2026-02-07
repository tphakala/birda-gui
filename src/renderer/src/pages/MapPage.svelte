<script lang="ts">
  import SpeciesSearch from '$lib/components/SpeciesSearch.svelte';
  import MapView from '$lib/components/MapView.svelte';
  import { mapState } from '$lib/stores/map.svelte';
  import { getLocationsWithCounts, getSpeciesLocations } from '$lib/utils/ipc';
  import { SvelteSet } from 'svelte/reactivity';
  import { onMount } from 'svelte';
  import type { EnrichedSpeciesSummary } from '$shared/types';

  onMount(async () => {
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
  });

  async function handleSpeciesSelect(species: EnrichedSpeciesSummary) {
    mapState.selectedSpecies = species.scientific_name;
    try {
      const locs = await getSpeciesLocations(species.scientific_name);
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
  <div class="border-b border-base-300 bg-base-200 p-2">
    <SpeciesSearch onselect={handleSpeciesSelect} onclear={handleSpeciesClear} />
  </div>
  <MapView />
</div>
