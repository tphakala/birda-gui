<script lang="ts">
  import * as m from '$paraglide/messages';

  const {
    modelName,
    busy = false,
    onConfirm,
    onCancel,
  }: { modelName: string; busy?: boolean; onConfirm: () => void; onCancel: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    dialog?.showModal();
  });
</script>

<dialog class="modal" bind:this={dialog} onclose={onCancel}>
  <div class="modal-box">
    <h3 class="text-base font-semibold">{m.gallery_confirmRemove_title({ model: modelName })}</h3>
    <p class="text-base-content/70 mt-2 text-sm">{m.gallery_confirmRemove_body()}</p>
    <div class="modal-action">
      <button onclick={onCancel} class="btn" disabled={busy}>{m.common_button_cancel()}</button>
      <button onclick={onConfirm} class="btn btn-error" disabled={busy}>{m.gallery_remove()}</button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={onCancel}>close</button>
  </form>
</dialog>
