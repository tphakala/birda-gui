<script lang="ts">
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
  <dialog class="modal modal-open">
    <div class="modal-box flex h-[80vh] max-w-4xl flex-col">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">{m.licenses_title()}</h2>
        <button onclick={close} class="btn btn-ghost btn-sm btn-square">
          <X size={20} />
        </button>
      </div>

      <div class="mt-4 flex-1 overflow-auto">
        {#if loading}
          <div class="flex items-center justify-center py-12">
            <Loader size={24} class="animate-spin" />
          </div>
        {:else if error}
          <p class="text-error text-sm">{error}</p>
        {:else if licenseText}
          <pre class="text-base-content/70 font-mono text-xs leading-relaxed whitespace-pre-wrap">{licenseText}</pre>
        {:else}
          <p class="text-base-content/50 text-sm">{m.licenses_notFound()}</p>
        {/if}
      </div>

      <div class="modal-action">
        <button onclick={close} class="btn">{m.common_button_close()}</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button onclick={close}>close</button>
    </form>
  </dialog>
{/if}
