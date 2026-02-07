<script lang="ts">
  import { X, Trash2, Copy, ChevronDown, ChevronUp } from '@lucide/svelte';
  import { appState } from '$lib/stores/app.svelte';
  import { logState, clearLog, type LogEntry } from '$lib/stores/log.svelte';
  import * as m from '$paraglide/messages';

  let scrollContainer: HTMLDivElement | undefined = $state();
  let autoScroll = $state(true);
  let collapsed = $state(false);

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function levelColor(level: LogEntry['level']): string {
    switch (level) {
      case 'error':
        return 'text-red-400';
      case 'warn':
        return 'text-yellow-400';
      case 'debug':
        return 'text-gray-400';
      default:
        return 'text-gray-300';
    }
  }

  function levelBadgeColor(level: LogEntry['level']): string {
    switch (level) {
      case 'error':
        return 'bg-red-900/30 text-red-400';
      case 'warn':
        return 'bg-yellow-900/30 text-yellow-400';
      case 'debug':
        return 'bg-gray-800 text-gray-500';
      default:
        return 'bg-blue-900/30 text-blue-400';
    }
  }

  function handleScroll() {
    if (!scrollContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    autoScroll = scrollHeight - scrollTop - clientHeight < 30;
  }

  function scrollToBottom() {
    if (scrollContainer && autoScroll) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }

  async function copyLog() {
    const text = logState.entries
      .map((e) => `[${formatTime(e.timestamp)}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
  }

  // Auto-scroll when entries change
  $effect(() => {
    // Access entries.length to track reactivity (eslint-disable-next-line)
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    logState.entries.length;
    // Use tick to scroll after DOM update
    requestAnimationFrame(scrollToBottom);
  });
</script>

{#if appState.showLogPanel}
  <div class="flex flex-col border-t border-base-300 bg-base-200" style="height: {collapsed ? 'auto' : '220px'}">
    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-base-300 bg-base-300/50 px-3 py-1.5">
      <button
        class="btn btn-ghost btn-xs btn-square"
        onclick={() => (collapsed = !collapsed)}
        title={collapsed ? m.log_expand() : m.log_collapse()}
      >
        {#if collapsed}
          <ChevronUp size={14} />
        {:else}
          <ChevronDown size={14} />
        {/if}
      </button>
      <span class="text-xs font-semibold uppercase text-base-content/60">{m.log_title()}</span>
      <span class="badge badge-sm badge-ghost tabular-nums">{logState.entries.length}</span>

      <div class="flex-1"></div>

      <button
        class="btn btn-ghost btn-xs btn-square"
        onclick={copyLog}
        title={m.log_copyToClipboard()}
      >
        <Copy size={13} />
      </button>
      <button
        class="btn btn-ghost btn-xs btn-square"
        onclick={clearLog}
        title={m.log_clear()}
      >
        <Trash2 size={13} />
      </button>
      <button
        class="btn btn-ghost btn-xs btn-square"
        onclick={() => (appState.showLogPanel = false)}
        title={m.log_close()}
      >
        <X size={13} />
      </button>
    </div>

    <!-- Log entries -->
    {#if !collapsed}
      <div
        bind:this={scrollContainer}
        onscroll={handleScroll}
        class="flex-1 overflow-auto bg-[#0f172a] p-1 font-mono text-[11px] leading-[18px]"
      >
        {#if logState.entries.length === 0}
          <div class="p-3 text-center text-gray-500">{m.log_empty()}</div>
        {:else}
          {#each logState.entries as entry (entry.timestamp)}
            <div class="flex gap-1 px-1 hover:bg-white/5">
              <span class="shrink-0 text-gray-500">{formatTime(entry.timestamp)}</span>
              <span class="shrink-0 rounded px-1 {levelBadgeColor(entry.level)}"
                >{entry.level.toUpperCase().padEnd(5)}</span
              >
              <span class="shrink-0 text-cyan-400">[{entry.source}]</span>
              <span class="{levelColor(entry.level)} break-all whitespace-pre-wrap">{entry.message}</span>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
{/if}
