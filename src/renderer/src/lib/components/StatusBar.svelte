<script lang="ts">
  import { appState } from '$lib/stores/app.svelte';
  import { formatNumber } from '$lib/utils/format';
  import { checkBirda } from '$lib/utils/ipc';
  import type { BirdaCheckResponse } from '$shared/types';
  import { BIRDA_RELEASES_URL } from '$shared/constants';
  import { TriangleAlert, ExternalLink } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import * as m from '$paraglide/messages';
  import Modal from './Modal.svelte';

  let birdaStatus = $state<BirdaCheckResponse | null>(null);
  let showVersionModal = $state(false);

  const isOutdated = $derived(birdaStatus && !birdaStatus.available && birdaStatus.version && birdaStatus.minVersion);

  onMount(() => {
    let mounted = true;

    void (async () => {
      try {
        const result = await checkBirda();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (mounted) {
          birdaStatus = result;
        }
      } catch {
        // Silent fail - status bar is not critical
      }
    })();

    return () => {
      mounted = false;
    };
  });
</script>

<div class="border-base-300 bg-base-200 text-base-content/60 flex items-center gap-4 border-t px-3 py-1.5 text-xs">
  <span>
    {#if appState.isAnalysisRunning}
      <span class="bg-primary mr-1 inline-block h-2 w-2 animate-pulse rounded-full"></span>
      {m.status_analyzing()}
    {:else}
      {m.status_ready()}
    {/if}
  </span>

  <div class="bg-base-300 h-3 w-px"></div>

  <span>{m.status_detections({ count: formatNumber(appState.catalogStats.total_detections) })}</span>
  <span>{m.status_species({ count: formatNumber(appState.catalogStats.total_species) })}</span>
  <span>{m.status_locations({ count: formatNumber(appState.catalogStats.total_locations) })}</span>

  <div class="flex-1"></div>

  {#if isOutdated}
    <button
      onclick={() => (showVersionModal = true)}
      class="text-warning flex items-center gap-1.5 transition-opacity hover:opacity-70"
      title="birda CLI update required: {birdaStatus.version} → {birdaStatus.minVersion}"
    >
      <TriangleAlert size={14} />
      <span>birda {birdaStatus.version}</span>
    </button>
    <div class="bg-base-300 h-3 w-px"></div>
  {:else if birdaStatus?.available}
    <span title="birda CLI version">birda {birdaStatus.version}</span>
    <div class="bg-base-300 h-3 w-px"></div>
  {/if}

  <span>v1.0.0</span>
</div>

<!-- Birda Version Update Modal -->
{#if birdaStatus && !birdaStatus.available && birdaStatus.version && birdaStatus.minVersion}
  <Modal bind:open={showVersionModal} title="birda Update Required" icon={TriangleAlert} iconClass="text-warning">
    <div class="space-y-4">
      <p class="text-base-content/80 text-sm">
        This version of Birda GUI requires a more recent version of the birda CLI to work properly.
      </p>

      <div class="border-base-300 bg-base-200 space-y-2 rounded-lg border p-3">
        <div class="flex items-center justify-between text-sm">
          <span class="text-base-content/70">Current version:</span>
          <span class="font-semibold">{birdaStatus.version}</span>
        </div>
        <div class="flex items-center justify-between text-sm">
          <span class="text-base-content/70">Required version:</span>
          <span class="font-semibold">{birdaStatus.minVersion} or higher</span>
        </div>
      </div>

      <a
        href={BIRDA_RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-primary btn-sm w-full gap-2"
      >
        <ExternalLink size={14} />
        Download Latest Version
      </a>
    </div>
  </Modal>
{/if}
