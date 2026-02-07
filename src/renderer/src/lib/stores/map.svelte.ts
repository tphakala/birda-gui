import { SvelteSet } from 'svelte/reactivity';

export interface MapLocation {
  location_id: number;
  latitude: number;
  longitude: number;
  name: string | null;
  detection_count: number;
  species_count?: number;
}

export const mapState = $state({
  locations: [] as MapLocation[],
  selectedSpecies: null as string | null,
  highlightedLocationIds: new SvelteSet<number>(),
  loading: false,
});
