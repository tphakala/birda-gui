<script lang="ts">
  import { MapLibre, Marker, Popup } from 'svelte-maplibre-gl';
  import { mapState, type MapLocation } from '$lib/stores/map.svelte';
  import * as m from '$paraglide/messages';

  let selectedLocation = $state<MapLocation | null>(null);

  function markerColor(loc: MapLocation): string {
    if (mapState.selectedSpecies) {
      return mapState.highlightedLocationIds.has(loc.location_id) ? '#2563eb' : '#d1d5db';
    }
    if (loc.detection_count > 100) return '#ef4444';
    if (loc.detection_count > 50) return '#f97316';
    if (loc.detection_count > 10) return '#eab308';
    return '#3b82f6';
  }

  function markerSize(loc: MapLocation): number {
    const base = 12;
    return Math.min(base + Math.sqrt(loc.detection_count) * 2, 32);
  }

  function toggleLocation(loc: MapLocation) {
    selectedLocation = selectedLocation?.location_id === loc.location_id ? null : loc;
  }
</script>

<div class="relative flex-1 bg-base-200">
  <MapLibre
    style="https://tiles.openfreemap.org/styles/bright"
    center={[24.9384, 60.1699]}
    zoom={4}
    class="h-full w-full"
    autoloadGlobalCss={false}
  >
    {#each mapState.locations as loc (loc.location_id)}
      {@const size = markerSize(loc)}
      {@const color = markerColor(loc)}
      {@const dimmed = mapState.selectedSpecies !== null && !mapState.highlightedLocationIds.has(loc.location_id)}
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
              {loc.detection_count}
            {/if}
          </div>
        {/snippet}
      </Marker>
    {/each}

    {#if selectedLocation}
      {@const loc = selectedLocation}
      <Popup lnglat={[loc.longitude, loc.latitude]} onclose={() => (selectedLocation = null)}>
        <div class="min-w-40 bg-base-100 p-2 text-base-content">
          <h4 class="text-sm font-semibold">{loc.name ?? m.map_unknownLocation()}</h4>
          <p class="text-xs text-base-content/60">
            {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
          </p>
          <p class="mt-1 text-xs">{m.status_detections({ count: String(loc.detection_count) })}</p>
        </div>
      </Popup>
    {/if}
  </MapLibre>
</div>
