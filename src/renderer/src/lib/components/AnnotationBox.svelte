<script lang="ts">
  import type { BoxRect } from '$lib/utils/spectrogram-geometry';
  import type { EditorBox } from '$lib/stores/annotation.svelte';

  const {
    box,
    rect,
    selected,
    onselect,
    onmovestart,
    onresizestart,
  }: {
    box: EditorBox;
    rect: BoxRect;
    selected: boolean;
    onselect: () => void;
    onmovestart: (e: PointerEvent) => void;
    onresizestart: (edge: 'left' | 'right' | 'top' | 'bottom', e: PointerEvent) => void;
  } = $props();

  const edges = ['left', 'right', 'top', 'bottom'] as const;

  const colorClass = $derived(
    box.display === 'suggested'
      ? 'border-warning bg-warning/10'
      : box.display === 'manual'
        ? 'border-success bg-success/10'
        : 'border-primary bg-primary/10',
  );
</script>

<div
  class="absolute box-border cursor-move border-2 {colorClass} {selected ? 'ring-2 ring-offset-1' : ''}"
  style="left: {rect.left}px; top: {rect.top}px; width: {rect.width}px; height: {rect.height}px;"
  role="button"
  tabindex="0"
  aria-label={box.common_name || box.scientific_name || 'annotation'}
  onpointerdown={(e) => {
    e.stopPropagation();
    onselect();
    onmovestart(e);
  }}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onselect();
    }
  }}
>
  <span class="bg-base-100/80 pointer-events-none absolute -top-4 left-0 truncate px-1 text-[10px] leading-tight">
    {box.common_name || box.scientific_name || '(unnamed)'}
  </span>
  {#if selected}
    {#each edges as edge (edge)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="bg-base-content/70 absolute"
        class:cursor-ew-resize={edge === 'left' || edge === 'right'}
        class:cursor-ns-resize={edge === 'top' || edge === 'bottom'}
        style={edge === 'left'
          ? 'left:-3px;top:0;width:6px;height:100%'
          : edge === 'right'
            ? 'right:-3px;top:0;width:6px;height:100%'
            : edge === 'top'
              ? 'top:-3px;left:0;height:6px;width:100%'
              : 'bottom:-3px;left:0;height:6px;width:100%'}
        onpointerdown={(e) => {
          e.stopPropagation();
          onresizestart(edge, e);
        }}
      ></div>
    {/each}
  {/if}
</div>
