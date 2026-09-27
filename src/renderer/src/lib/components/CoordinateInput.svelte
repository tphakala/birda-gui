<script lang="ts">
  import { showModal } from '$lib/utils/dialog';
  import { MapPin, Map, X } from '@lucide/svelte';
  import { MapLibre, Marker } from 'svelte-maplibre-gl';
  import type { MapMouseEvent } from 'maplibre-gl';
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
  // Unique per instance: the Analysis page and the species fetch dialog each have one.
  const titleId = $props.id();

  const hasCoords = $derived(latitude !== 0 || longitude !== 0);
  // The inputs accept any number while typing; MapLibre throws on a latitude
  // outside [-90, 90], so the map only gets a valid point.
  const mapPoint = $derived<[number, number] | null>(
    hasCoords && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90
      ? [longitude, latitude]
      : null,
  );

  function handleMapClick(e: MapMouseEvent) {
    latitude = Math.round(e.lngLat.lat * 10000) / 10000;
    longitude = Math.round(e.lngLat.lng * 10000) / 10000;
  }
</script>

<div class="space-y-2">
  <div class="flex items-center gap-2">
    <MapPin size={16} class="text-base-content/50" />
    <span class="text-base-content/70 text-sm font-medium">{m.coords_title()}</span>
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
      <span class="text-base-content/70 text-xs">{m.coords_latitude()}</span>
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
      <span class="text-base-content/70 text-xs">{m.coords_longitude()}</span>
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
  <dialog class="modal" {@attach showModal} onclose={() => (showMapModal = false)} aria-labelledby={titleId}>
    <div class="modal-box max-w-2xl p-0">
      <div class="flex items-center justify-between px-4 py-3">
        <div class="flex items-center gap-2">
          <MapPin size={16} class="text-primary" />
          <span id={titleId} class="font-medium">{m.coords_pickTitle()}</span>
          <span class="text-base-content/50 text-sm" aria-live="polite">
            {#if hasCoords}{latitude}, {longitude}{/if}
          </span>
        </div>
        <button
          onclick={() => (showMapModal = false)}
          class="btn btn-ghost btn-sm btn-square"
          aria-label={m.common_button_close()}
        >
          <X size={18} />
        </button>
      </div>
      <div class="border-base-300 h-[28rem] border-t">
        <MapLibre
          style="https://tiles.openfreemap.org/styles/bright"
          center={mapPoint ?? [24.9384, 60.1699]}
          zoom={mapPoint ? 10 : 4}
          class="h-full w-full"
          cursor="crosshair"
          autoloadGlobalCss={false}
          onclick={handleMapClick}
        >
          {#if mapPoint}
            <Marker lnglat={mapPoint} />
          {/if}
        </MapLibre>
      </div>
      <div class="flex items-end gap-3 px-4 py-2">
        <p class="text-base-content/50 flex-1 text-xs">{m.coords_clickToSet()}</p>
        <!-- Typing coordinates is the keyboard route; the map needs a pointer. -->
        <label>
          <span class="text-base-content/70 text-xs">{m.coords_latitude()}</span>
          <input
            type="number"
            step="0.0001"
            min="-90"
            max="90"
            bind:value={latitude}
            class="input input-bordered input-xs w-28"
          />
        </label>
        <label>
          <span class="text-base-content/70 text-xs">{m.coords_longitude()}</span>
          <input
            type="number"
            step="0.0001"
            min="-180"
            max="180"
            bind:value={longitude}
            class="input input-bordered input-xs w-28"
          />
        </label>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" aria-label={m.common_button_close()}>close</button>
    </form>
  </dialog>
{/if}
