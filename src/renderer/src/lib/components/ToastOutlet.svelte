<script lang="ts">
  import { X } from '@lucide/svelte';
  import { toast, dismissToast } from '$lib/stores/toast.svelte';
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

{#if toast.message}
  <div class="toast toast-end toast-bottom z-[100]">
    <div role="alert" class="alert {severityClass} text-sm">
      <span>{toast.message}</span>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-circle"
        onclick={dismissToast}
        aria-label={m.common_button_close()}
      >
        <X size={14} />
      </button>
    </div>
  </div>
{/if}
