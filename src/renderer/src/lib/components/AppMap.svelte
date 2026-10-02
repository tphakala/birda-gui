<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import { MapLibre } from 'svelte-maplibre-gl';
  import MapUnavailable from './MapUnavailable.svelte';
  // Importing this module sets MapLibre's worker URL, so every map goes through it first.
  import { mapAvailable } from '$lib/utils/maplibre';

  /**
   * A MapLibre map that falls back to a message when the system has no WebGL 2
   * or the map throws while starting. Other props go to MapLibre.
   */
  const {
    message,
    onfail,
    ...rest
  }: ComponentProps<typeof MapLibre> & {
    /** Shown instead of the map. */
    message: string;
    /** Called once when the map throws while starting. */
    onfail?: () => void;
  } = $props();
</script>

{#if mapAvailable()}
  <svelte:boundary
    onerror={(e) => {
      console.error('Map failed to start', e);
      onfail?.();
    }}
  >
    <MapLibre style="https://tiles.openfreemap.org/styles/bright" autoloadGlobalCss={false} {...rest} />
    {#snippet failed()}
      <MapUnavailable {message} />
    {/snippet}
  </svelte:boundary>
{:else}
  <MapUnavailable {message} />
{/if}
