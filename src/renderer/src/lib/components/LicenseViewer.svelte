<script lang="ts">
  import { showModal } from '$lib/utils/dialog';
  import { X, Loader } from '@lucide/svelte';
  import { getLicenses } from '$lib/utils/ipc';
  import * as m from '$paraglide/messages';

  let {
    open = $bindable(), // eslint-disable-line @typescript-eslint/no-useless-default-assignment -- $bindable() required for Svelte bind:
  }: { open: boolean } = $props();

  let licenseText = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (open && licenseText === null) {
      loading = true;
      error = null;
      getLicenses()
        .then((text) => {
          licenseText = text;
        })
        .catch((e: unknown) => {
          error = e instanceof Error ? e.message : String(e);
        })
        .finally(() => {
          loading = false;
        });
    }
  });

  function close() {
    open = false;
  }
</script>

{#if open}
  <dialog class="modal" {@attach showModal} onclose={close} aria-labelledby="license-viewer-title">
    <div class="modal-box flex h-[80vh] max-w-4xl flex-col">
      <div class="flex items-center justify-between">
        <h2 id="license-viewer-title" class="text-lg font-semibold">{m.licenses_title()}</h2>
        <button onclick={close} class="btn btn-ghost btn-sm btn-square" aria-label={m.common_button_close()}>
          <X size={20} />
        </button>
      </div>

      <div class="mt-4 flex-1 overflow-auto">
        {#if loading}
          <div class="flex items-center justify-center py-12">
            <span role="status" aria-label={m.common_loading()}><Loader size={24} class="animate-spin" /></span>
          </div>
        {:else if error}
          <p class="text-error text-sm">{error}</p>
        {:else if licenseText}
          <pre class="text-base-content/80 font-mono text-sm leading-relaxed whitespace-pre-wrap">{licenseText}</pre>
        {:else}
          <p class="text-base-content/50 text-sm">{m.licenses_notFound()}</p>
        {/if}
      </div>

      <div class="modal-action">
        <button onclick={close} class="btn">{m.common_button_close()}</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" aria-label={m.common_button_close()}>close</button>
    </form>
  </dialog>
{/if}
