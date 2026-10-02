<script lang="ts">
  import { Marker, Popup } from 'svelte-maplibre-gl';
  import { mapState, type MapLocation } from '$lib/stores/map.svelte';
  import AppMap from './AppMap.svelte';
  import * as m from '$paraglide/messages';

  // The popup follows the location list, so it shows current counts after a reload and closes when its location is gone.
  let selectedLocationId = $state<number | null>(null);
  const selectedLocation = $derived(mapState.locations.find((l) => l.location_id === selectedLocationId) ?? null);

  /** The count shown for a location: the selected species' count there (none where it was not detected), otherwise all detections. */
  function shownCount(loc: MapLocation): number {
    if (!mapState.selectedSpecies) return loc.detection_count;
    return mapState.speciesCounts.get(loc.location_id) ?? 0;
  }

  function markerColor(loc: MapLocation): string {
    if (mapState.selectedSpecies) {
      return mapState.speciesCounts.has(loc.location_id) ? '#2563eb' : '#d1d5db';
    }
    if (loc.detection_count > 100) return '#ef4444';
    if (loc.detection_count > 50) return '#f97316';
    if (loc.detection_count > 10) return '#eab308';
    return '#3b82f6';
  }

  function markerSize(loc: MapLocation): number {
    const base = 12;
    return Math.min(base + Math.sqrt(shownCount(loc)) * 2, 32);
  }

  function toggleLocation(loc: MapLocation) {
    selectedLocationId = selectedLocationId === loc.location_id ? null : loc.location_id;
  }
</script>

<div class="bg-base-200 relative flex-1">
  <AppMap center={[24.9384, 60.1699]} zoom={4} class="h-full w-full" message={m.map_unavailable()}>
    {#each mapState.locations as loc (loc.location_id)}
      {@const size = markerSize(loc)}
      {@const color = markerColor(loc)}
      {@const dimmed = mapState.selectedSpecies !== null && !mapState.speciesCounts.has(loc.location_id)}
      <Marker lnglat={[loc.longitude, loc.latitude]}>
        {#snippet content()}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="flex cursor-pointer items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-md transition-opacity"
            style="width: {size}px; height: {size}px; background-color: {color}; opacity: {dimmed ? 0.3 : 1};"
            onclick={() => {
              toggleLocation(loc);
            }}
          >
            {#if size >= 20}
              {shownCount(loc)}
            {/if}
          </div>
        {/snippet}
      </Marker>
    {/each}

    {#if selectedLocation}
      {@const loc = selectedLocation}
      <Popup lnglat={[loc.longitude, loc.latitude]} onclose={() => (selectedLocationId = null)}>
        <div class="bg-base-100 text-base-content min-w-40 p-2">
          <h4 class="text-sm font-semibold">{loc.name ?? m.map_unknownLocation()}</h4>
          <p class="text-base-content/60 text-xs">
            {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
          </p>
          <p class="mt-1 text-xs">{m.status_detections({ count: String(shownCount(loc)) })}</p>
        </div>
      </Popup>
    {/if}
  </AppMap>
</div>
