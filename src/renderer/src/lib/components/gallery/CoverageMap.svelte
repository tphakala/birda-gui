<script lang="ts">
  import { Map as MapIcon } from '@lucide/svelte';
  import * as m from '$paraglide/messages';

  const {
    family,
    region,
    regionName,
    class: klass = '',
  }: { family: string; region?: string | undefined; regionName: string; class?: string } = $props();

  let loaded = $state(false);
  let failed = $state(false);
  const src = $derived(region ? `birda-map://${family}/${encodeURIComponent(region)}` : '');
</script>

<div class="border-base-300 bg-base-300 relative aspect-[4/3] w-full overflow-hidden rounded-lg border {klass}">
  {#if !region || failed}
    <div class="text-base-content/40 absolute inset-0 flex flex-col items-center justify-center gap-1">
      <MapIcon size={24} />
      <span class="text-xs">{m.gallery_coverage_unavailable()}</span>
    </div>
  {:else}
    {#if !loaded}
      <div class="skeleton absolute inset-0"></div>
    {/if}
    <img
      {src}
      alt={m.gallery_coverage_alt({ region: regionName })}
      loading="lazy"
      decoding="async"
      class="h-full w-full object-cover transition-opacity {loaded ? 'opacity-100' : 'opacity-0'}"
      onload={() => (loaded = true)}
      onerror={() => (failed = true)}
    />
  {/if}
</div>
