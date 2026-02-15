<script lang="ts">
  import { X } from '@lucide/svelte';
  import type { Component, Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    icon?: Component | undefined;
    iconClass?: string | undefined;
    iconSize?: number | undefined;
    maxWidth?: string | undefined;
    showCloseButton?: boolean | undefined;
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
    children,
    actions,
  }: Props = $props();
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  function close() {
    open = false;
  }
</script>

{#if open}
  <dialog class="modal modal-open" onclose={close}>
    <div class="modal-box {maxWidth}">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          {#if icon}
            {@const Icon = icon}
            <Icon size={iconSize} class={iconClass} />
          {/if}
          <h3 class="text-lg font-semibold">{title}</h3>
        </div>
        {#if showCloseButton}
          <button onclick={close} class="btn btn-ghost btn-sm btn-square">
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
      <button>close</button>
    </form>
  </dialog>
{/if}
