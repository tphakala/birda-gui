<script lang="ts">
  import { showModal } from '$lib/utils/dialog';
  import { X } from '@lucide/svelte';
  import type { Component, Snippet } from 'svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    open: boolean;
    title: string;
    icon?: Component | undefined;
    iconClass?: string | undefined;
    iconSize?: number | undefined;
    maxWidth?: string | undefined;
    showCloseButton?: boolean | undefined;
    /** Id of an element in the content that describes the dialog. */
    descriptionId?: string | undefined;
    /** For a confirmation of a destructive action: announced as an alert dialog. */
    alert?: boolean | undefined;
    children?: Snippet | undefined;
    actions?: Snippet | undefined;
  }

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment */
  let {
    open = $bindable(false),
    title,
    icon,
    iconClass = 'text-primary',
    iconSize = 20,
    maxWidth = 'max-w-lg',
    showCloseButton = true,
    descriptionId,
    alert = false,
    children,
    actions,
  }: Props = $props();
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  function close() {
    open = false;
  }

  const titleId = $props.id();
</script>

{#if open}
  <dialog
    class="modal"
    role={alert ? 'alertdialog' : undefined}
    {@attach showModal}
    onclose={close}
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
  >
    <div class="modal-box {maxWidth}">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          {#if icon}
            {@const Icon = icon}
            <Icon size={iconSize} class={iconClass} />
          {/if}
          <h3 id={titleId} class="text-lg font-semibold">{title}</h3>
        </div>
        {#if showCloseButton}
          <button onclick={close} class="btn btn-ghost btn-sm btn-square" aria-label={m.common_button_close()}>
            <X size={18} />
          </button>
        {/if}
      </div>

      <!-- Content -->
      {#if children}
        <div class="mt-4">
          {@render children()}
        </div>
      {/if}

      <!-- Actions (optional) -->
      {#if actions}
        <div class="modal-action">
          {@render actions()}
        </div>
      {/if}
    </div>

    <!-- Backdrop close handler -->
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" aria-label={m.common_button_close()}>close</button>
    </form>
  </dialog>
{/if}
