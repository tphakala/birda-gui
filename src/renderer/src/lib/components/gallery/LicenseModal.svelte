<script lang="ts">
  import { X, CircleCheckBig } from '@lucide/svelte';
  import * as m from '$paraglide/messages';
  import type { ModelLicense } from '$shared/types';

  const {
    license,
    modelName,
    onAccept,
    onCancel,
  }: { license: ModelLicense; modelName: string; onAccept: () => void; onCancel: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    dialog?.showModal();
  });
</script>

<dialog class="modal" bind:this={dialog} onclose={onCancel}>
  <div class="modal-box">
    <div class="mb-3 flex items-center justify-between">
      <h3 class="text-base font-semibold">{m.gallery_license_title()}</h3>
      <button onclick={onCancel} class="btn btn-ghost btn-sm btn-square" aria-label={m.common_button_close()}>
        <X size={16} />
      </button>
    </div>

    <p class="text-sm font-medium">{modelName}</p>

    <div class="my-3 space-y-1.5 text-sm">
      <div class="flex items-center justify-between">
        <span class="text-base-content/60">{m.settings_licenseModal_license()}</span>
        <a href={license.url} target="_blank" rel="noopener noreferrer" class="link link-primary">{license.type}</a>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-base-content/60">{m.settings_licenseModal_commercialUse()}</span>
        <span class={license.commercial_use ? 'text-success' : 'text-error'}>
          {license.commercial_use ? m.settings_licenseModal_allowed() : m.settings_licenseModal_notAllowed()}
        </span>
      </div>
      {#if license.share_alike}
        <div class="flex items-center justify-between">
          <span class="text-base-content/60">{m.gallery_license_shareAlike()}</span>
          <CircleCheckBig size={14} class="text-base-content/70" />
        </div>
      {/if}
    </div>

    <p class="text-base-content/70 text-sm">{m.gallery_license_agree({ license: license.type })}</p>
    <p class="text-base-content/50 mt-2 text-xs">{m.gallery_hardware_auto()}</p>

    <div class="modal-action">
      <button onclick={onCancel} class="btn">{m.common_button_cancel()}</button>
      <button onclick={onAccept} class="btn btn-primary">{m.gallery_license_acceptInstall()}</button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={onCancel}>close</button>
  </form>
</dialog>
