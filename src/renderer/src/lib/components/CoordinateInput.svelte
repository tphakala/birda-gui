<script lang="ts">
  import { MapPin, Map, X } from '@lucide/svelte';
  import { MapLibre, Marker } from 'svelte-maplibre-gl';
  import type maplibregl from 'maplibre-gl';
  import * as m from '$paraglide/messages';

  let {
    latitude = $bindable(), // eslint-disable-line @typescript-eslint/no-useless-default-assignment -- $bindable() required for Svelte bind:
    longitude = $bindable(), // eslint-disable-line @typescript-eslint/no-useless-default-assignment -- $bindable() required for Svelte bind:
    autoDetected = false, // eslint-disable-line prefer-const -- destructuring requires `let` for other reassigned props
  }: {
    latitude: number;
    longitude: number;
    autoDetected?: boolean;
  } = $props();

  let showMapModal = $state(false);

  const hasCoords = $derived(latitude !== 0 || longitude !== 0);

  function handleMapClick(e: maplibregl.MapMouseEvent) {
    latitude = Math.round(e.lngLat.lat * 10000) / 10000;
    longitude = Math.round(e.lngLat.lng * 10000) / 10000;
  }
</script>

<div class="space-y-2">
  <div class="flex items-center gap-2">
    <MapPin size={16} class="text-base-content/50" />
    <span class="text-sm font-medium text-base-content/70">{m.coords_title()}</span>
    {#if autoDetected}
      <span class="badge badge-success badge-sm">{m.coords_autoDetected()}</span>
    {/if}
    <button
      type="button"
      onclick={() => (showMapModal = true)}
      class="btn btn-outline btn-sm ml-auto gap-1.5"
      title={m.coords_pickOnMap()}
    >
      <Map size={14} />
      {m.coords_pickOnMapButton()}
    </button>
  </div>

  <div class="flex gap-3">
    <label class="flex-1">
      <span class="text-xs text-base-content/70">{m.coords_latitude()}</span>
      <input
        type="number"
        step="0.0001"
        min="-90"
        max="90"
        bind:value={latitude}
        class="input input-bordered input-sm w-full"
        placeholder={m.coords_latitudePlaceholder()}
      />
    </label>
    <label class="flex-1">
      <span class="text-xs text-base-content/70">{m.coords_longitude()}</span>
      <input
        type="number"
        step="0.0001"
        min="-180"
        max="180"
        bind:value={longitude}
        class="input input-bordered input-sm w-full"
        placeholder={m.coords_longitudePlaceholder()}
      />
    </label>
  </div>
</div>

{#if showMapModal}
  <dialog class="modal modal-open" style="z-index: 1000;">
    <div class="modal-box max-w-2xl p-0">
      <div class="flex items-center justify-between px-4 py-3">
        <div class="flex items-center gap-2">
          <MapPin size={16} class="text-primary" />
          <span class="font-medium">{m.coords_pickTitle()}</span>
          {#if hasCoords}
            <span class="text-sm text-base-content/50">{latitude}, {longitude}</span>
          {/if}
        </div>
        <button onclick={() => (showMapModal = false)} class="btn btn-ghost btn-sm btn-square">
          <X size={18} />
        </button>
      </div>
      <div class="h-[28rem] border-t border-base-300">
        <MapLibre
          style="https://tiles.openfreemap.org/styles/bright"
          center={hasCoords ? [longitude, latitude] : [24.9384, 60.1699]}
          zoom={hasCoords ? 10 : 4}
          class="h-full w-full"
          cursor="crosshair"
          autoloadGlobalCss={false}
          onclick={handleMapClick}
        >
          {#if hasCoords}
            <Marker lnglat={[longitude, latitude]} />
          {/if}
        </MapLibre>
      </div>
      <p class="px-4 py-2 text-xs text-base-content/50">{m.coords_clickToSet()}</p>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button onclick={() => (showMapModal = false)}>close</button>
    </form>
  </dialog>
{/if}
