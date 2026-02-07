<script lang="ts">
  import { Funnel, X } from '@lucide/svelte';
  import { catalogState, resetFilters } from '$lib/stores/catalog.svelte';
  import * as m from '$paraglide/messages';

  const {
    onapply,
  }: {
    onapply: () => void;
  } = $props();

  let collapsed = $state(false);
</script>

{#if !collapsed}
  <div class="w-56 shrink-0 space-y-4 overflow-y-auto border-r border-base-300 bg-base-200 p-3">
    <div class="flex items-center justify-between">
      <h3 class="flex items-center gap-1.5 text-sm font-medium text-base-content">
        <Funnel size={14} />
        {m.filter_title()}
      </h3>
      <button
        onclick={() => (collapsed = true)}
        class="btn btn-ghost btn-xs btn-square"
        title={m.filter_collapse()}
      >
        <X size={14} />
      </button>
    </div>

    <label class="block">
      <span class="text-xs text-base-content/60">{m.filter_species()}</span>
      <input
        type="text"
        bind:value={catalogState.filter.species}
        placeholder={m.filter_searchSpecies()}
        class="input input-bordered input-sm w-full"
      />
    </label>

    <label class="block">
      <span class="text-xs text-base-content/60">{m.filter_minConfidence()}</span>
      <div class="flex items-center gap-2">
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          bind:value={catalogState.filter.min_confidence}
          class="range range-primary range-xs flex-1"
        />
        <span class="w-8 text-xs tabular-nums text-base-content"
          >{catalogState.filter.min_confidence !== undefined
            ? (catalogState.filter.min_confidence * 100).toFixed(0) + '%'
            : m.filter_all()}</span
        >
      </div>
    </label>

    <div class="flex gap-2">
      <button
        onclick={() => {
          catalogState.filter.offset = 0;
          onapply();
        }}
        class="btn btn-primary btn-xs flex-1"
      >
        {m.common_button_apply()}
      </button>
      <button
        onclick={() => {
          resetFilters();
          onapply();
        }}
        class="btn btn-ghost btn-xs flex-1"
      >
        {m.common_button_clear()}
      </button>
    </div>
  </div>
{:else}
  <button
    onclick={() => (collapsed = false)}
    class="border-r border-base-300 bg-base-200 px-2 py-1 hover:bg-base-300"
    title={m.filter_show()}
  >
    <Funnel size={16} class="text-base-content/60" />
  </button>
{/if}
