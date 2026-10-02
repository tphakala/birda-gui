<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import { GPUInitializationError } from 'maplibre-gl';
  import { MapLibre } from 'svelte-maplibre-gl';
  import MapUnavailable from './MapUnavailable.svelte';
  // Importing this module sets MapLibre's worker URL, so every map goes through it first.
  import { mapAvailable } from '$lib/utils/maplibre';

  /**
   * A MapLibre map that falls back to a message when the system has no WebGL 2
   * or the map cannot get a WebGL context. Other props go to MapLibre.
   */
  const {
    message,
    onfail,
    onerror,
    ...rest
  }: ComponentProps<typeof MapLibre> & {
    /** Shown instead of the map. */
    message: string;
    /** Called once when the map fails to start or to restore its WebGL context. */
    onfail?: () => void;
  } = $props();

  // MapLibre throws when it cannot create its context while starting, but only
  // fires an error event when it cannot restore a lost one.
  let gpuFailed = $state(false);

  function fail(e: unknown) {
    console.error('Map failed to start', e);
    onfail?.();
  }

  function handleError(ev: Parameters<NonNullable<typeof onerror>>[0]) {
    if (ev.error instanceof GPUInitializationError) {
      gpuFailed = true;
      fail(ev.error);
    } else if (onerror) {
      onerror(ev);
    } else {
      // What MapLibre logs when the map has no error listener.
      console.error(ev.error);
    }
  }
</script>

{#if mapAvailable() && !gpuFailed}
  <svelte:boundary onerror={fail}>
    <MapLibre
      style="https://tiles.openfreemap.org/styles/bright"
      autoloadGlobalCss={false}
      {...rest}
      onerror={handleError}
    />
    {#snippet failed()}
      <MapUnavailable {message} />
    {/snippet}
  </svelte:boundary>
{:else}
  <MapUnavailable {message} />
{/if}
