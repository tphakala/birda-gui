<script lang="ts">
  import { appState } from '$lib/stores/app.svelte';
  import { formatNumber } from '$lib/utils/format';
  import { checkBirda, getAppVersion } from '$lib/utils/ipc';
  import type { BirdaCheckResponse } from '$shared/types';
  import { BIRDA_RELEASES_URL } from '$shared/constants';
  import { TriangleAlert, ExternalLink } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import * as m from '$paraglide/messages';
  import Modal from './Modal.svelte';

  let birdaStatus = $state<BirdaCheckResponse | null>(null);
  let showVersionModal = $state(false);
  let appVersion = $state('');

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

    void (async () => {
      try {
        const version = await getAppVersion();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (mounted) {
          appVersion = version;
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
      <span class="bg-primary mr-1 inline-block h-2 w-2 rounded-full motion-safe:animate-pulse"></span>
      {appState.isAnalysisStopping ? m.analysis_stopping() : m.status_analyzing()}
    {:else}
      {m.status_ready()}
    {/if}
  </span>

  <div class="bg-base-300 h-3 w-px"></div>

  <!-- Totals of finished analyses; a running one is counted when it ends. -->
  <span title={m.status_catalogTotals()}
    >{m.status_detections({ count: formatNumber(appState.catalogStats.total_detections) })}</span
  >
  <span>{m.status_species({ count: formatNumber(appState.catalogStats.total_species) })}</span>
  <span>{m.status_locations({ count: formatNumber(appState.catalogStats.total_locations) })}</span>

  <div class="flex-1"></div>

  {#if isOutdated && birdaStatus}
    <button
      onclick={() => (showVersionModal = true)}
      class="text-warning flex items-center gap-1.5 transition-opacity hover:opacity-70"
      title={m.status_updateTooltip({ current: birdaStatus.version ?? '', required: birdaStatus.minVersion ?? '' })}
    >
      <TriangleAlert size={14} />
      <span>birda {birdaStatus.version}</span>
    </button>
    <div class="bg-base-300 h-3 w-px"></div>
  {:else if birdaStatus?.available}
    <span title={m.status_cliVersionTooltip()}>birda {birdaStatus.version}</span>
    <div class="bg-base-300 h-3 w-px"></div>
  {/if}

  {#if appVersion}<span>v{appVersion}</span>{/if}
</div>

<!-- Birda Version Update Modal -->
{#if isOutdated && birdaStatus}
  <Modal
    bind:open={showVersionModal}
    title={m.status_updateModal_title()}
    icon={TriangleAlert}
    iconClass="text-warning"
    descriptionId="update-modal-body"
  >
    <div class="space-y-4">
      <p id="update-modal-body" class="text-base-content/80 text-sm">
        {m.status_updateModal_body()}
      </p>

      <div class="border-base-300 bg-base-200 space-y-2 rounded-lg border p-3">
        <div class="flex items-center justify-between text-sm">
          <span class="text-base-content/70">{m.status_updateModal_currentVersion()}</span>
          <span class="font-semibold">{birdaStatus.version}</span>
        </div>
        <div class="flex items-center justify-between text-sm">
          <span class="text-base-content/70">{m.status_updateModal_requiredVersion()}</span>
          <span class="font-semibold">{m.status_updateModal_minVersion({ version: birdaStatus.minVersion ?? '' })}</span
          >
        </div>
      </div>

      <a
        href={BIRDA_RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-primary btn-sm w-full gap-2"
      >
        <ExternalLink size={14} />
        {m.status_updateModal_download()}
      </a>
    </div>
  </Modal>
{/if}
