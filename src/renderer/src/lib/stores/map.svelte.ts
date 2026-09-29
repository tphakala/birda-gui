import { SvelteMap } from 'svelte/reactivity';

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
  /** The selected species' detection count at each location that has it; the locations' own totals stay as loaded. */
  speciesCounts: new SvelteMap<number, number>(),
  loading: false,
});
