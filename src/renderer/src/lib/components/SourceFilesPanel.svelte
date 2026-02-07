<script lang="ts">
  import { FileHeadphone, FolderOpen, Check, X, Loader, Clock, HardDrive, Waves, CircleDot, Cpu, Volume2, Battery, Thermometer } from '@lucide/svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { analysisState } from '$lib/stores/analysis.svelte';
  import { formatDuration, formatFileSize } from '$lib/utils/format';
  import type { SourceScanResult, FileCompletedPayload } from '$shared/types';
  import * as m from '$paraglide/messages';

  const {
    scanResult,
    scanning,
    analysisRunning,
  }: {
    scanResult: SourceScanResult | null;
    scanning: boolean;
    analysisRunning: boolean;
  } = $props();

  type FileStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

  const fileStatuses = $derived.by(() => {
    const statuses = new SvelteMap<string, FileStatus>();
    if (!analysisRunning && analysisState.status === 'idle') return statuses;

    for (const evt of analysisState.events) {
      if (evt.event === 'file_completed') {
        const p = evt.payload as FileCompletedPayload;
        statuses.set(p.file, p.status === 'processed' ? 'completed' : p.status);
      }
    }

    if (analysisState.currentFile) {
      statuses.set(analysisState.currentFile.path, 'processing');
    }

    return statuses;
  });

  function getStatus(filePath: string): FileStatus | null {
    if (!analysisRunning && analysisState.status === 'idle') return null;
    return fileStatuses.get(filePath) ?? 'pending';
  }

  function getPercent(filePath: string): number {
    if (analysisState.currentFile?.path === filePath) {
      return analysisState.currentFile.percent;
    }
    return 0;
  }
</script>

{#if scanning}
  <div class="flex flex-1 items-center justify-center">
    <Loader size={24} class="animate-spin text-primary" />
    <span class="ml-2 text-sm text-base-content/50">{m.sourceFiles_scanning()}</span>
  </div>
{:else if scanResult?.files.length === 1}
  <!-- Single file info card -->
  {@const file = scanResult.files[0]}
  <div class="flex flex-1 flex-col p-6">
    <h3 class="mb-4 text-sm font-medium text-base-content/70">{m.sourceFiles_sourceFile()}</h3>
    <div class="card border border-base-300 bg-base-100 p-5">
      <div class="flex items-center gap-3">
        <FileHeadphone size={24} class="shrink-0 text-primary" />
        <div class="min-w-0">
          <p class="truncate font-medium">{file.name}</p>
          <span class="badge badge-sm mt-1">{file.format.toUpperCase()}</span>
        </div>
      </div>
      <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div class="flex items-center gap-2">
          <Clock size={14} class="text-base-content/40" />
          <span class="text-base-content/60">{m.sourceFiles_duration()}</span>
          <span class="ml-auto font-medium tabular-nums">{formatDuration(file.durationSec)}</span>
        </div>
        <div class="flex items-center gap-2">
          <HardDrive size={14} class="text-base-content/40" />
          <span class="text-base-content/60">{m.sourceFiles_size()}</span>
          <span class="ml-auto font-medium">{formatFileSize(file.size)}</span>
        </div>
        {#if file.sampleRate}
          <div class="flex items-center gap-2">
            <Waves size={14} class="text-base-content/40" />
            <span class="text-base-content/60">{m.sourceFiles_sampleRate()}</span>
            <span class="ml-auto font-medium">{(file.sampleRate / 1000).toFixed(1)} kHz</span>
          </div>
        {/if}
        {#if file.channels}
          <div class="flex items-center gap-2">
            <CircleDot size={14} class="text-base-content/40" />
            <span class="text-base-content/60">{m.sourceFiles_channels()}</span>
            <span class="ml-auto font-medium">{file.channels === 1 ? m.sourceFiles_mono() : file.channels === 2 ? m.sourceFiles_stereo() : file.channels}</span>
          </div>
        {/if}
      </div>
      {#if file.audiomoth}
        <div class="mt-4 border-t border-base-300 pt-3">
          <div class="mb-2 flex items-center gap-2 text-xs font-medium text-base-content/50">
            <Cpu size={12} />
            AudioMoth {file.audiomoth.deviceId}
          </div>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="flex items-center gap-2">
              <Volume2 size={14} class="text-base-content/40" />
              <span class="text-base-content/60">{m.sourceFiles_gain()}</span>
              <span class="ml-auto font-medium">{file.audiomoth.gain}</span>
            </div>
            {#if file.audiomoth.batteryV !== null}
              <div class="flex items-center gap-2">
                <Battery size={14} class="text-base-content/40" />
                <span class="text-base-content/60">{m.sourceFiles_battery()}</span>
                <span class="ml-auto font-medium">{file.audiomoth.batteryV}V</span>
              </div>
            {/if}
            {#if file.audiomoth.temperatureC !== null}
              <div class="flex items-center gap-2">
                <Thermometer size={14} class="text-base-content/40" />
                <span class="text-base-content/60">{m.sourceFiles_temperature()}</span>
                <span class="ml-auto font-medium">{file.audiomoth.temperatureC}°C</span>
              </div>
            {/if}
            {#if file.audiomoth.recordedAtUtc}
              <div class="flex items-center gap-2">
                <Clock size={14} class="text-base-content/40" />
                <span class="text-base-content/60">{m.sourceFiles_recordedUtc()}</span>
                <span class="ml-auto font-medium">{new Date(file.audiomoth.recordedAtUtc).toLocaleString()}</span>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
{:else if scanResult && scanResult.files.length > 1}
  <!-- Folder file list -->
  <div class="flex flex-1 flex-col overflow-hidden">
    <div class="flex items-center gap-3 border-b border-base-300 bg-base-200/50 px-4 py-2.5">
      <FolderOpen size={16} class="text-primary" />
      <span class="text-sm font-medium">{m.sourceFiles_fileCount({ count: String(scanResult.files.length) })}</span>
      <span class="text-xs text-base-content/40">|</span>
      <span class="text-xs text-base-content/50">{formatDuration(scanResult.totalDuration)}</span>
      <span class="text-xs text-base-content/40">|</span>
      <span class="text-xs text-base-content/50">{formatFileSize(scanResult.totalSize)}</span>
    </div>
    <div class="flex-1 overflow-y-auto pr-4">
      <table class="table table-xs w-full">
        <thead class="sticky top-0 bg-base-100">
          <tr class="text-xs text-base-content/50">
            <th class="w-8 text-center">#</th>
            <th>{m.sourceFiles_columnName()}</th>
            <th class="w-20 text-right">{m.sourceFiles_duration()}</th>
            <th class="w-16 text-center">{m.sourceFiles_columnFormat()}</th>
            <th class="w-20 text-right">{m.sourceFiles_size()}</th>
            {#if analysisRunning || analysisState.status !== 'idle'}
              <th class="w-20 text-center">{m.sourceFiles_columnStatus()}</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each scanResult.files as file, i (file.path)}
            {@const status = getStatus(file.path)}
            <tr
              class="hover:bg-base-200/50 {status === 'processing' ? 'bg-primary/5' : ''} {status === 'failed' ? 'bg-error/5' : ''}"
            >
              <td class="text-center text-base-content/30">{i + 1}</td>
              <td class="max-w-0 truncate">{file.name}</td>
              <td class="text-right tabular-nums text-base-content/60">{formatDuration(file.durationSec)}</td>
              <td class="text-center"><span class="badge badge-ghost badge-xs">{file.format}</span></td>
              <td class="text-right text-base-content/50">{formatFileSize(file.size)}</td>
              {#if analysisRunning || analysisState.status !== 'idle'}
                <td class="text-center">
                  {#if status === 'processing'}
                    <div class="flex items-center justify-center gap-1">
                      <Loader size={12} class="animate-spin text-primary" />
                      <span class="text-xs tabular-nums text-primary">{getPercent(file.path).toFixed(0)}%</span>
                    </div>
                  {:else if status === 'completed'}
                    <Check size={14} class="mx-auto text-success" />
                  {:else if status === 'failed'}
                    <X size={14} class="mx-auto text-error" />
                  {:else if status === 'skipped'}
                    <span class="text-xs text-warning">{m.sourceFiles_statusSkip()}</span>
                  {:else if status === 'pending'}
                    <span class="text-xs text-base-content/20">...</span>
                  {/if}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{:else if scanResult?.files.length === 0}
  <div class="flex flex-1 flex-col items-center justify-center gap-2 text-base-content/40">
    <FolderOpen size={32} />
    <p class="text-sm">{m.sourceFiles_noAudioFiles()}</p>
    <p class="text-xs">{m.sourceFiles_supportedFormats()}</p>
  </div>
{/if}
