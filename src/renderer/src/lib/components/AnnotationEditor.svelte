<script lang="ts">
  import { Play, Pause, LoaderCircle, ZoomIn, ZoomOut, X } from '@lucide/svelte';
  import WaveSurfer from 'wavesurfer.js';
  import SpectrogramPlugin from 'wavesurfer.js/dist/plugins/spectrogram.esm.js';
  import { onDestroy } from 'svelte';
  import { getSettings } from '$lib/utils/ipc';
  import {
    annotationEditor,
    closeAnnotationEditor,
    selectBox,
    getSelectedBox,
    acceptBox,
    updateBoxLocal,
    commitBox,
    createManualBox,
    removeBox,
  } from '$lib/stores/annotation.svelte';
  import { annotationToRect, xToTime, yToFreq, type SpectrogramViewport } from '$lib/utils/spectrogram-geometry';
  import { toBirdaMediaUrl } from '$lib/utils/media-url';
  import AnnotationBox from './AnnotationBox.svelte';
  import AnnotationSidePanel from './AnnotationSidePanel.svelte';
  import * as m from '$paraglide/messages';

  let wavesurfer: WaveSurfer | null = null;
  let spectrogramPlugin: SpectrogramPlugin | null = null;
  let waveformEl = $state<HTMLDivElement | undefined>(undefined);
  let spectrogramEl = $state<HTMLDivElement | undefined>(undefined);
  let overlayEl = $state<HTMLDivElement | undefined>(undefined);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let playing = $state(false);
  let duration = $state(0);
  let freqMax = $state(15000);
  const spectrogramHeight = 256;
  /** Minimum drag-drawn box width, in seconds; narrower draws are treated as clicks. */
  const MIN_DRAW_SPAN_S = 0.02;
  /** Minimum box span preserved while resizing, in seconds. */
  const MIN_RESIZE_SPAN_S = 0.01;

  // Viewport state drives box geometry. Bumped via reactive reassignment to retrigger $derived.
  let pxPerSecond = $state(1);
  let scrollLeft = $state(0);

  let resizeObserver: ResizeObserver | null = null;

  const viewport = $derived<SpectrogramViewport>({
    pxPerSecond,
    scrollLeft,
    freqMax,
    height: spectrogramHeight,
  });

  let zoomPxPerSec = 0; // 0 => fit to width

  function refreshViewport(): void {
    if (!wavesurfer) return;
    scrollLeft = wavesurfer.getScroll();
    // Anchor the time scale to wavesurfer's actually rendered content width
    // (scrollWidth covers the zoomed case; clientWidth the fit-to-width case)
    // instead of estimating from zoom level, so boxes cannot drift from the audio.
    const wsWrapper = wavesurfer.getWrapper();
    const contentWidth = Math.max(wsWrapper.scrollWidth, wsWrapper.clientWidth);
    pxPerSecond = duration > 0 && contentWidth > 0 ? contentWidth / duration : 1;
    // The spectrogram is mounted outside wavesurfer's scroll container, so it
    // does not scroll natively; mirror wavesurfer's horizontal scroll onto it.
    const pluginWrapper = spectrogramEl?.firstElementChild;
    if (pluginWrapper instanceof HTMLElement) pluginWrapper.scrollLeft = scrollLeft;
  }

  /**
   * Some environments ignore the spectrogram plugin's container option and mount
   * its wrapper inside wavesurfer's own waveform wrapper instead. There the
   * spectrogram sits under wavesurfer's click-to-seek and our overlay measures
   * zero height. Re-parent the wrapper into our container so the overlay
   * geometry and pointer handling always line up, regardless of where the
   * plugin decided to mount.
   */
  function ensureSpectrogramMount(): void {
    const wrapper = (spectrogramPlugin as unknown as { wrapper?: HTMLElement } | null)?.wrapper;
    if (wrapper && spectrogramEl && wrapper.parentElement !== spectrogramEl) {
      // eslint-disable-next-line svelte/no-dom-manipulating -- spectrogramEl's children are owned by the wavesurfer plugin, not Svelte
      spectrogramEl.appendChild(wrapper);
    }
  }

  let initializing = false;

  async function init(): Promise<void> {
    const filePath = annotationEditor.filePath;
    if (!filePath || !waveformEl || !spectrogramEl) return;
    if (wavesurfer || initializing) return; // already initialized (or initializing) for this open
    initializing = true;
    loading = true;
    loadError = null;

    let settings;
    try {
      settings = await getSettings();
    } catch (err) {
      loadError = m.detail_audioLoadFailed({ message: err instanceof Error ? err.message : String(err) });
      loading = false;
      initializing = false;
      return;
    }
    initializing = false;
    // The editor may have been closed (or pointed at another file) while settings loaded.
    if (!annotationEditor.open || annotationEditor.filePath !== filePath) return;
    freqMax = settings.default_freq_max;

    spectrogramPlugin = SpectrogramPlugin.create({
      container: spectrogramEl,
      labels: true,
      labelsColor: '#9ca3af',
      labelsHzColor: '#9ca3af',
      labelsBackground: 'rgba(0,0,0,0)',
      height: spectrogramHeight,
      fftSamples: 1024,
      windowFunc: 'hann',
      frequencyMax: freqMax,
    });

    wavesurfer = WaveSurfer.create({
      container: waveformEl,
      height: 48,
      waveColor: '#93c5fd',
      progressColor: '#023E8A',
      cursorColor: '#012d65',
      sampleRate: 48000, // Default is 8000 which kills spectrogram frequency range
      url: toBirdaMediaUrl(filePath),
      plugins: [spectrogramPlugin],
    });

    wavesurfer.on('ready', () => {
      if (!wavesurfer) return;
      loading = false;
      duration = wavesurfer.getDuration();
      ensureSpectrogramMount();
      refreshViewport();
    });
    wavesurfer.on('play', () => {
      playing = true;
    });
    wavesurfer.on('pause', () => {
      playing = false;
    });
    wavesurfer.on('finish', () => {
      playing = false;
    });
    wavesurfer.on('redraw', () => {
      ensureSpectrogramMount();
      refreshViewport();
    });
    wavesurfer.on('zoom', (px: number) => {
      zoomPxPerSec = px;
      refreshViewport();
    });
    wavesurfer.on('scroll', () => {
      refreshViewport();
    });
    wavesurfer.on('error', (err: Error) => {
      loadError = m.detail_audioLoadFailed({ message: err.message });
      loading = false;
    });

    // ResizeObserver: window resize changes effective px-per-second without a wavesurfer event.
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => {
      refreshViewport();
    });
    resizeObserver.observe(waveformEl);
  }

  // Re-init whenever the editor opens with a file.
  $effect(() => {
    if (annotationEditor.open && annotationEditor.filePath && waveformEl && spectrogramEl) {
      void init();
    }
    return () => {
      removeDragListeners();
      resetDragState();
      resizeObserver?.disconnect();
      resizeObserver = null;
      wavesurfer?.destroy();
      wavesurfer = null;
      spectrogramPlugin = null;
    };
  });

  onDestroy(() => {
    removeDragListeners();
    resizeObserver?.disconnect();
    wavesurfer?.destroy();
  });

  function togglePlay(): void {
    void wavesurfer?.playPause();
  }
  function zoomIn(): void {
    const next = (zoomPxPerSec || pxPerSecond) * 1.5;
    wavesurfer?.zoom(next);
  }
  function zoomOut(): void {
    const next = Math.max(1, (zoomPxPerSec || pxPerSecond) / 1.5);
    wavesurfer?.zoom(next);
  }
  function handleWheel(e: WheelEvent): void {
    // Wheel over the spectrogram pane zooms. Smaller factor than the buttons
    // because trackpads emit many small-delta events. Svelte 5 wheel handlers
    // are passive, but the pane has nothing to scroll so no preventDefault needed.
    if (loading || !wavesurfer || e.deltaY === 0 || duration <= 0) return;
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    // Anchor on the cursor: the time under the mouse becomes the new view center.
    const anchorTime = overlayEl ? xToTime(e.clientX - overlayEl.getBoundingClientRect().left, viewport) : null;
    const next = Math.max(1, (zoomPxPerSec || pxPerSecond) * factor);
    wavesurfer.zoom(next);
    if (anchorTime !== null) {
      // The zoom render lands on the next frame; only then is the new scroll width valid.
      requestAnimationFrame(() => {
        if (!wavesurfer) return;
        refreshViewport(); // pick up the post-zoom content width
        const wrapperWidth = waveformEl?.clientWidth ?? 0;
        wavesurfer.setScroll(Math.max(0, anchorTime * pxPerSecond - wrapperWidth / 2));
        refreshViewport();
      });
    }
  }

  function overlayMetrics(e: PointerEvent): { x: number; y: number } | null {
    if (!overlayEl) return null;
    const r = overlayEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  let drag: {
    mode: 'draw' | 'move' | 'resize';
    key?: string;
    edge?: 'left' | 'right' | 'top' | 'bottom';
    startX: number;
    startY: number;
    orig?: { s: number; e: number; lo: number | null; hi: number | null };
  } | null = null;
  let drawRectStart: { x: number; y: number } | null = null;

  function addDragListeners(): void {
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
  }

  function removeDragListeners(): void {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerCancel);
  }

  function resetDragState(): void {
    drag = null;
    drawRectStart = null;
    liveDraw = null;
  }

  function handleOverlayPointerDown(e: PointerEvent): void {
    // Pointerdown on empty overlay starts a draw; on a box, the box handles it.
    if (e.button !== 0) return;
    const p = overlayMetrics(e);
    if (!p) return;
    selectBox(null);
    drawRectStart = p;
    drag = { mode: 'draw', startX: p.x, startY: p.y };
    addDragListeners();
  }

  function startMove(key: string, e: PointerEvent): void {
    if (e.button !== 0) return;
    const p = overlayMetrics(e);
    const box = annotationEditor.boxes.find((b) => b.key === key);
    if (!p || !box) return;
    drag = {
      mode: 'move',
      key,
      startX: p.x,
      startY: p.y,
      orig: { s: box.start_time, e: box.end_time, lo: box.low_freq_hz, hi: box.high_freq_hz },
    };
    addDragListeners();
  }

  function startResize(key: string, edge: 'left' | 'right' | 'top' | 'bottom', e: PointerEvent): void {
    if (e.button !== 0) return;
    const p = overlayMetrics(e);
    const box = annotationEditor.boxes.find((b) => b.key === key);
    if (!p || !box) return;
    drag = {
      mode: 'resize',
      key,
      edge,
      startX: p.x,
      startY: p.y,
      orig: { s: box.start_time, e: box.end_time, lo: box.low_freq_hz, hi: box.high_freq_hz },
    };
    addDragListeners();
  }

  let liveDraw = $state<{ left: number; top: number; width: number; height: number } | null>(null);

  function handlePointerMove(e: PointerEvent): void {
    if (!drag || !overlayEl) return;
    const r = overlayEl.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (drag.mode === 'draw' && drawRectStart) {
      liveDraw = {
        left: Math.min(drawRectStart.x, x),
        top: Math.min(drawRectStart.y, y),
        width: Math.abs(x - drawRectStart.x),
        height: Math.abs(y - drawRectStart.y),
      };
    } else if (drag.mode === 'move' && drag.key && drag.orig) {
      // Clamp the delta so the box keeps its span instead of inverting at t=0.
      const rawDt = xToTime(x, viewport) - xToTime(drag.startX, viewport);
      const dt = Math.max(rawDt, -drag.orig.s);
      updateBoxLocal(drag.key, { start_time: drag.orig.s + dt, end_time: drag.orig.e + dt });
    } else if (drag.mode === 'resize' && drag.key && drag.orig) {
      const t = xToTime(x, viewport);
      const f = yToFreq(y, viewport);
      if (drag.edge === 'left')
        updateBoxLocal(drag.key, { start_time: Math.max(0, Math.min(t, drag.orig.e - MIN_RESIZE_SPAN_S)) });
      else if (drag.edge === 'right')
        updateBoxLocal(drag.key, { end_time: Math.max(t, drag.orig.s + MIN_RESIZE_SPAN_S) });
      else if (drag.edge === 'top') updateBoxLocal(drag.key, { high_freq_hz: f, low_freq_hz: drag.orig.lo ?? 0 });
      else if (drag.edge === 'bottom')
        updateBoxLocal(drag.key, { low_freq_hz: f, high_freq_hz: drag.orig.hi ?? viewport.freqMax });
    }
  }

  function handlePointerUp(e: PointerEvent): void {
    removeDragListeners();
    if (drag?.mode === 'draw' && drawRectStart && overlayEl) {
      const r = overlayEl.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const t1 = Math.max(0, xToTime(Math.min(drawRectStart.x, x), viewport));
      const t2 = xToTime(Math.max(drawRectStart.x, x), viewport);
      const f1 = yToFreq(Math.max(drawRectStart.y, y), viewport); // bottom => low
      const f2 = yToFreq(Math.min(drawRectStart.y, y), viewport); // top => high
      if (t2 - t1 > MIN_DRAW_SPAN_S) {
        void createManualBox({ start_time: t1, end_time: t2, low_freq_hz: f1, high_freq_hz: f2 });
      }
    } else if ((drag?.mode === 'move' || drag?.mode === 'resize') && drag.key) {
      // Geometry was updated locally during the drag; persist once now.
      void commitBox(drag.key);
    }
    resetDragState();
  }

  function handlePointerCancel(): void {
    // The OS or browser took over the pointer (context menu, gesture): abandon the drag.
    removeDragListeners();
    if ((drag?.mode === 'move' || drag?.mode === 'resize') && drag.key && drag.orig) {
      updateBoxLocal(drag.key, {
        start_time: drag.orig.s,
        end_time: drag.orig.e,
        low_freq_hz: drag.orig.lo,
        high_freq_hz: drag.orig.hi,
      });
    }
    resetDragState();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (!annotationEditor.open) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    const boxes = annotationEditor.boxes;
    const selected = getSelectedBox();
    const idx = selected ? boxes.findIndex((b) => b.key === selected.key) : -1;

    if (e.key === ' ') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'Enter' && selected) {
      e.preventDefault();
      void acceptBox(selected.key).then(() => {
        if (idx >= 0 && idx + 1 < boxes.length) selectBox(boxes[idx + 1].key);
      });
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (boxes.length === 0) return;
      // nextIdx is always within [0, boxes.length) after the length-0 early return above.
      const nextIdx = e.shiftKey ? (idx <= 0 ? boxes.length - 1 : idx - 1) : (idx + 1) % boxes.length;
      selectBox(boxes[nextIdx].key);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      void removeBox(selected.key);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (annotationEditor.selectedKey) selectBox(null);
      else closeAnnotationEditor();
    }
  }
</script>

{#if annotationEditor.open}
  <div class="bg-base-300/80 fixed inset-0 z-50 flex flex-col p-4 backdrop-blur-sm">
    <div class="bg-base-100 flex h-full flex-col overflow-hidden rounded-lg shadow-xl">
      <!-- Header -->
      <div class="border-base-300 flex items-center gap-3 border-b px-4 py-2">
        <span class="font-medium">{m.annotation_editor_title()}</span>
        <span class="text-base-content/70 truncate text-xs">{annotationEditor.filePath}</span>
        <button
          class="btn btn-ghost btn-sm btn-circle ml-auto"
          onclick={closeAnnotationEditor}
          aria-label={m.common_button_close()}
        >
          <X size={18} />
        </button>
      </div>

      <!-- Transport -->
      <div class="border-base-300 flex items-center gap-2 border-b px-4 py-2 text-xs">
        <button
          class="btn btn-primary btn-sm btn-circle"
          onclick={togglePlay}
          disabled={loading}
          aria-label={m.annotation_play()}
        >
          {#if loading}<LoaderCircle size={16} class="animate-spin" />{:else if playing}<Pause size={16} />{:else}<Play
              size={16}
            />{/if}
        </button>
        <button class="btn btn-ghost btn-sm" onclick={zoomOut} aria-label={m.annotation_zoomOut()}
          ><ZoomOut size={14} /></button
        >
        <button class="btn btn-ghost btn-sm" onclick={zoomIn} aria-label={m.annotation_zoomIn()}
          ><ZoomIn size={14} /></button
        >
        <span class="text-base-content/80 ml-2">{m.annotation_drawHint()}</span>
      </div>

      {#if loadError}
        <div role="alert" class="alert alert-error mx-4 my-1 py-1 text-xs">{loadError}</div>
      {/if}
      {#if annotationEditor.error}
        <div role="alert" class="alert alert-error mx-4 my-1 py-1 text-xs">{annotationEditor.error}</div>
      {/if}

      <!-- Main: spectrogram + overlay on the left, side panel on the right -->
      <div class="flex min-h-0 flex-1">
        <div class="relative min-w-0 flex-1 overflow-hidden p-2" onwheel={handleWheel}>
          <div bind:this={waveformEl} class="bg-base-100"></div>
          <div class="relative">
            <!-- isolate traps the plugin's internal z-indexes in their own stacking context;
                 pointer-events-none guarantees the plugin DOM never steals clicks from the overlay -->
            <div
              bind:this={spectrogramEl}
              class="bg-base-100 isolate overflow-hidden"
              style="pointer-events: none"
            ></div>
            <!-- Overlay: sibling layer over the spectrogram, NOT injected into wavesurfer's container.
                 z-10 beats the plugin's own canvases (labels z=9, spectrogram z=4), which would
                 otherwise paint above the boxes and swallow every pointer event. -->
            <div
              bind:this={overlayEl}
              class="absolute inset-0 z-10 overflow-hidden"
              role="application"
              aria-label={m.annotation_overlay_label()}
              onpointerdown={handleOverlayPointerDown}
            >
              {#each annotationEditor.boxes as box (box.key)}
                <AnnotationBox
                  {box}
                  rect={annotationToRect(box, viewport)}
                  selected={annotationEditor.selectedKey === box.key}
                  onselect={() => {
                    selectBox(box.key);
                  }}
                  onmovestart={(e: PointerEvent) => {
                    startMove(box.key, e);
                  }}
                  onresizestart={(edge: 'left' | 'right' | 'top' | 'bottom', e: PointerEvent) => {
                    startResize(box.key, edge, e);
                  }}
                />
              {/each}
              {#if liveDraw}
                <div
                  class="border-success bg-success/20 pointer-events-none absolute border-2"
                  style="left:{liveDraw.left}px;top:{liveDraw.top}px;width:{liveDraw.width}px;height:{liveDraw.height}px;"
                ></div>
              {/if}
            </div>
          </div>
        </div>
        <AnnotationSidePanel />
      </div>
    </div>

    {#if annotationEditor.toast}
      <div class="toast toast-end">
        <div class="alert alert-error text-sm">{annotationEditor.toast}</div>
      </div>
    {/if}
  </div>
{/if}

<svelte:window onkeydown={handleKeydown} />
