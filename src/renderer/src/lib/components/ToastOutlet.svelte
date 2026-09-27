<script lang="ts">
  import { X } from '@lucide/svelte';
  import { toast, dismissToast, pauseToast, resumeToast } from '$lib/stores/toast.svelte';
  import * as m from '$paraglide/messages';

  // z-[100] so the single fixed outlet sits above the z-50 annotation editor modal.
  const severityClass = $derived(
    toast.severity === 'error'
      ? 'alert-error'
      : toast.severity === 'warning'
        ? 'alert-warning'
        : toast.severity === 'success'
          ? 'alert-success'
          : 'alert-info',
  );
</script>

<!-- The live regions stay mounted and displayed, so a message placed in them is
     announced. Errors interrupt a screen reader; other toasts wait their turn.
     Hover pauses the timeout for pointer users; focusin does it for keyboard users. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="toast toast-end toast-bottom z-[100] {toast.message ? '' : 'pointer-events-none'}"
  onmouseenter={pauseToast}
  onmouseleave={resumeToast}
  onfocusin={pauseToast}
  onfocusout={resumeToast}
>
  <div role="alert" class={toast.message && toast.severity === 'error' ? `alert ${severityClass} text-sm` : ''}>
    {#if toast.message && toast.severity === 'error'}
      <span>{toast.message}</span>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-circle"
        onclick={dismissToast}
        aria-label={m.common_button_close()}
      >
        <X size={14} />
      </button>
    {/if}
  </div>
  <div role="status" class={toast.message && toast.severity !== 'error' ? `alert ${severityClass} text-sm` : ''}>
    {#if toast.message && toast.severity !== 'error'}
      <span>{toast.message}</span>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-circle"
        onclick={dismissToast}
        aria-label={m.common_button_close()}
      >
        <X size={14} />
      </button>
    {/if}
  </div>
</div>
