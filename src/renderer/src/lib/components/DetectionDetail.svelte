<script lang="ts">
  import { Play, Pause, LoaderCircle, Volume2, Repeat, X, Download } from '@lucide/svelte';
  import WaveSurfer from 'wavesurfer.js';
  import SpectrogramPlugin from 'wavesurfer.js/dist/plugins/spectrogram.esm.js';
  import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
  import type { Region } from 'wavesurfer.js/dist/plugins/regions.esm.js';
  import { onMount, onDestroy } from 'svelte';
  import { extractClip, getSettings, saveSpectrogram, exportRegionAsWav } from '$lib/utils/ipc';
  import { formatTime, formatConfidence } from '$lib/utils/format';
  import type { EnrichedDetection } from '$shared/types';
  import * as m from '$paraglide/messages';

  const {
    detection,
    sourceFile,
  }: {
    detection: EnrichedDetection;
    sourceFile: string;
  } = $props();

  let wavesurfer: WaveSurfer | null = null;
  let spectrogramPlugin: SpectrogramPlugin | null = null;
  let waveformEl = $state<HTMLDivElement>(undefined!);
  let spectrogramEl = $state<HTMLDivElement>(undefined!);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let playing = $state(false);
  let currentTime = $state(0);
  let duration = $state(0);
  let sampleRate = $state(0);
  let freqMax = $state(15000);
  let spectrogramHeight = $state(160);
  let clipFilePath = $state<string | null>(null);

  // Gain control via Web Audio API GainNode (supports >1.0 boost)
  let gain = $state(1.0);
  let audioContext: AudioContext | null = null;
  let gainNode: GainNode | null = null;

  // Region selection
  let regionsPlugin: RegionsPlugin | null = null;
  let activeRegion = $state<Region | null>(null);
  let looping = $state(false);
  let disableDragSelection: (() => void) | null = null;
  let exporting = $state(false);

  const freqOptions = [
    { value: 8000, label: '8 kHz' },
    { value: 10000, label: '10 kHz' },
    { value: 12000, label: '12 kHz' },
    { value: 15000, label: '15 kHz' },
    { value: 20000, label: '20 kHz' },
    { value: 24000, label: '24 kHz' },
  ];

  const nyquist = $derived(sampleRate ? Math.floor(sampleRate / 2) : 0);

  function createSpectrogramPlugin() {
    return SpectrogramPlugin.create({
      container: spectrogramEl,
      labels: true,
      labelsColor: '#9ca3af',
      labelsHzColor: '#9ca3af',
      labelsBackground: 'rgba(0, 0, 0, 0)', // Transparent
      height: spectrogramHeight,
      fftSamples: 1024,
      windowFunc: 'hann',
      frequencyMax: freqMax,
    });
  }

  function updateSpectrogram() {
    if (!wavesurfer) return;
    if (spectrogramPlugin) {
      spectrogramPlugin.destroy();
    }
    spectrogramEl.innerHTML = ''; // eslint-disable-line svelte/no-dom-manipulating -- wavesurfer plugin cleanup
    spectrogramPlugin = createSpectrogramPlugin();
    wavesurfer.registerPlugin(spectrogramPlugin);
    requestAnimationFrame(() => {
      cacheCurrentSpectrogram();
    });
  }

  function cacheCurrentSpectrogram() {
    if (!clipFilePath) return;
    const canvas = spectrogramEl.querySelector('canvas');
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    void saveSpectrogram(clipFilePath, freqMax, spectrogramHeight, dataUrl);
  }

  function handleFreqChange(e: Event) {
    freqMax = Number((e.target as HTMLSelectElement).value);
    updateSpectrogram();
  }

  function handleHeightChange(e: Event) {
    spectrogramHeight = Number((e.target as HTMLSelectElement).value);
    updateSpectrogram();
  }

  onMount(async () => {
    try {
      const settings = await getSettings();
      // Apply saved spectrogram defaults
      freqMax = settings.default_freq_max;
      spectrogramHeight = settings.default_spectrogram_height;

      const clipPath = await extractClip(
        detection.id,
        sourceFile,
        Math.max(0, detection.start_time - 2),
        detection.end_time + 2,
        settings.clip_output_dir,
      );
      clipFilePath = clipPath;

      // Normalize Windows backslashes and ensure proper URL format
      // Windows paths like D:\clips\file.wav must become birda-media:///D:/clips/file.wav
      const normalizedPath = clipPath.replace(/\\/g, '/');
      const urlPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath;

      spectrogramPlugin = createSpectrogramPlugin();

      wavesurfer = WaveSurfer.create({
        container: waveformEl,
        height: 48,
        waveColor: '#93c5fd',
        progressColor: '#023E8A',
        cursorColor: '#012d65',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        sampleRate: 48000, // Default is 8000 which kills spectrogram frequency range
        url: `birda-media://${urlPath}`,
        plugins: [spectrogramPlugin],
      });

      wavesurfer.on('ready', () => {
        loading = false;
        duration = wavesurfer!.getDuration();
        sampleRate = wavesurfer!.getDecodedData()?.sampleRate ?? 0;
        requestAnimationFrame(() => {
          cacheCurrentSpectrogram();
        });

        // Connect media element through Web Audio GainNode for >1.0 boost
        try {
          const mediaEl = wavesurfer!.getMediaElement();
          audioContext = new AudioContext();
          const source = audioContext.createMediaElementSource(mediaEl);
          gainNode = audioContext.createGain();
          gainNode.gain.value = gain;
          source.connect(gainNode);
          gainNode.connect(audioContext.destination);
        } catch (err) {
          console.warn('Web Audio gain setup failed, falling back to native volume:', err);
        }

        // Initialize regions plugin for drag-to-select
        regionsPlugin = RegionsPlugin.create();
        wavesurfer!.registerPlugin(regionsPlugin);

        disableDragSelection = regionsPlugin.enableDragSelection({
          color: 'rgba(16, 185, 129, 0.2)',
        });

        regionsPlugin.on('region-created', (region: Region) => {
          // Only allow one region at a time
          if (activeRegion && activeRegion !== region) {
            activeRegion.remove();
          }
          activeRegion = region;
          looping = false;
        });

        regionsPlugin.on('region-updated', (region: Region) => {
          if (region === activeRegion) {
            activeRegion = region;
          }
        });

        regionsPlugin.on('region-removed', (region: Region) => {
          if (region === activeRegion) {
            activeRegion = null;
            looping = false;
          }
        });

        regionsPlugin.on('region-out', (region: Region) => {
          if (looping && region === activeRegion && wavesurfer) {
            wavesurfer.setTime(region.start);
            void wavesurfer.play();
          }
        });
      });

      wavesurfer.on('error', (err: Error) => {
        loading = false;
        error = m.detail_audioLoadFailed({ message: err.message });
      });

      wavesurfer.on('play', () => {
        playing = true;
      });

      wavesurfer.on('pause', () => {
        playing = false;
      });

      wavesurfer.on('timeupdate', (time: number) => {
        currentTime = time;
      });

      wavesurfer.on('finish', () => {
        playing = false;
      });
    } catch (err) {
      loading = false;
      error = (err as Error).message;
    }
  });

  onDestroy(() => {
    disableDragSelection?.();
    wavesurfer?.destroy();
    void audioContext?.close();
  });

  function togglePlay() {
    void wavesurfer?.playPause();
  }

  function handleGainChange(e: Event) {
    gain = Number((e.target as HTMLInputElement).value);
    if (gainNode) {
      gainNode.gain.value = gain;
    } else {
      // Fallback: native volume (clamped 0-1)
      wavesurfer?.setVolume(Math.min(gain, 1));
    }
  }

  function toggleLoop() {
    looping = !looping;
    if (looping && activeRegion && wavesurfer) {
      const current = wavesurfer.getCurrentTime();
      if (current < activeRegion.start || current > activeRegion.end) {
        wavesurfer.setTime(activeRegion.start);
      }
      void wavesurfer.play();
    }
  }

  function clearRegion() {
    activeRegion?.remove();
  }

  async function exportRegion() {
    if (!activeRegion || !wavesurfer) return;
    const audioBuffer = wavesurfer.getDecodedData();
    if (!audioBuffer) return;

    exporting = true;
    try {
      const wavBytes = encodeWavFromRegion(audioBuffer, activeRegion.start, activeRegion.end);
      const species = detection.common_name.replace(/[<>:"/\\|?*]/g, '_');
      let timestamp: string;
      if (detection.audio_file.recording_start) {
        const recordingStart = new Date(detection.audio_file.recording_start);
        const actual = new Date(recordingStart.getTime() + detection.start_time * 1000);
        const y = actual.getFullYear();
        const mo = (actual.getMonth() + 1).toString().padStart(2, '0');
        const d = actual.getDate().toString().padStart(2, '0');
        const h = actual.getHours().toString().padStart(2, '0');
        const mi = actual.getMinutes().toString().padStart(2, '0');
        const s = actual.getSeconds().toString().padStart(2, '0');
        timestamp = `${y}${mo}${d}_${h}${mi}${s}`;
      } else {
        const mins = Math.floor(detection.start_time / 60);
        const s = Math.floor(detection.start_time % 60);
        timestamp = `${mins}m${s.toString().padStart(2, '0')}s`;
      }
      const defaultName = `${species}_${timestamp}.wav`;
      await exportRegionAsWav(wavBytes, defaultName);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      exporting = false;
    }
  }

  function encodeWavFromRegion(audioBuffer: AudioBuffer, startTime: number, endTime: number): Uint8Array {
    const sr = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const startSample = Math.floor(startTime * sr);
    const endSample = Math.min(Math.ceil(endTime * sr), audioBuffer.length);
    const numSamples = endSample - startSample;
    const bytesPerSample = 2;
    const dataSize = numSamples * numChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = audioBuffer.getChannelData(ch)[startSample + i];
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
        offset += 2;
      }
    }

    return new Uint8Array(buffer);
  }
</script>

<div class="border-base-300 bg-base-200 border-t px-4 py-3">
  {#if error}
    <div role="alert" class="alert alert-error py-2 text-sm">{error}</div>
  {:else}
    <div class="flex items-start gap-3">
      <!-- Play button -->
      <button onclick={togglePlay} disabled={loading} class="btn btn-primary btn-circle btn-sm mt-1 shrink-0">
        {#if loading}
          <LoaderCircle size={16} class="animate-spin" />
        {:else if playing}
          <Pause size={16} />
        {:else}
          <Play size={16} class="ml-0.5" />
        {/if}
      </button>

      <!-- Waveform + Spectrogram -->
      <div class="min-w-0 flex-1">
        <div class="text-base-content/60 mb-1 flex items-center gap-3 text-xs">
          <span class="tabular-nums">{formatTime(detection.start_time)} - {formatTime(detection.end_time)}</span>
          <span>{detection.common_name}</span>
          <span class="text-base-content/40">({formatConfidence(detection.confidence)})</span>
          {#if !loading}
            <span class="ml-auto tabular-nums">{currentTime.toFixed(1)}s / {duration.toFixed(1)}s</span>
          {/if}
        </div>
        <div bind:this={waveformEl} class="border-base-300 bg-base-100 rounded border"></div>
        <div bind:this={spectrogramEl} class="border-base-300 bg-base-100 mt-1 overflow-hidden rounded border"></div>

        <!-- Spectrogram controls -->
        {#if !loading}
          <div class="text-base-content/70 mt-1 flex items-center gap-3 text-xs">
            <label class="flex items-center gap-1">
              {m.detail_freqMax()}
              <select value={freqMax} onchange={handleFreqChange} class="select select-bordered select-xs">
                {#each freqOptions as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>
            <label class="flex items-center gap-1">
              {m.detail_height()}
              <select value={spectrogramHeight} onchange={handleHeightChange} class="select select-bordered select-xs">
                <option value={128}>{m.settings_spectrogram_heightSmall()}</option>
                <option value={160}>{m.settings_spectrogram_heightMedium()}</option>
                <option value={256}>{m.settings_spectrogram_heightLarge()}</option>
                <option value={384}>{m.settings_spectrogram_heightXL()}</option>
              </select>
            </label>
            <div class="flex items-center gap-1" title={m.detail_volume({ percent: String(Math.round(gain * 100)) })}>
              <Volume2 size={12} class="text-base-content/40" />
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={gain}
                oninput={handleGainChange}
                class="range range-primary range-xs w-16"
              />
              <span class="w-8 text-right tabular-nums">{Math.round(gain * 100)}%</span>
            </div>
            {#if nyquist}
              <span
                >{m.detail_sampleRate({
                  rate: (sampleRate / 1000).toFixed(1),
                  nyquist: (nyquist / 1000).toFixed(1),
                })}</span
              >
            {/if}
          </div>
        {/if}

        <!-- Region toolbar -->
        {#if activeRegion && !loading}
          <div class="mt-1 flex items-center gap-2 text-xs">
            <span class="text-base-content/60 tabular-nums">
              {m.detail_selection({
                start: activeRegion.start.toFixed(2),
                end: activeRegion.end.toFixed(2),
                duration: (activeRegion.end - activeRegion.start).toFixed(2),
              })}
            </span>
            <button
              onclick={toggleLoop}
              class="btn btn-xs {looping ? 'btn-primary' : 'btn-ghost'}"
              title={looping ? m.detail_stopLooping() : m.detail_loopSelection()}
            >
              <Repeat size={12} />
              {m.detail_loop()}
            </button>
            <button
              onclick={exportRegion}
              disabled={exporting}
              class="btn btn-ghost btn-xs"
              title={m.detail_exportAsWav()}
            >
              <Download size={12} />
              {exporting ? m.detail_exporting() : m.detail_exportWav()}
            </button>
            <button onclick={clearRegion} class="btn btn-ghost btn-xs" title={m.detail_clearSelection()}>
              <X size={12} />
              {m.common_button_clear()}
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
