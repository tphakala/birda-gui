<script lang="ts">
  import FilterPanel from '$lib/components/FilterPanel.svelte';
  import DetectionsTable from '$lib/components/DetectionsTable.svelte';
  import { loadDetections } from '$lib/stores/catalog.svelte';
  import { onMount } from 'svelte';

  onMount(() => {
    void loadDetections();
  });
</script>

<div class="flex flex-1 overflow-hidden">
  <FilterPanel onapply={loadDetections} />
  <DetectionsTable onrefresh={loadDetections} />
</div>
