<script lang="ts">
  import { AudioLines, List, Map, Settings } from '@lucide/svelte';
  import { appState, type Tab } from '$lib/stores/app.svelte';
  import * as m from '$paraglide/messages';

  const tabs: { id: Tab; label: string; icon: typeof List }[] = [
    { id: 'analysis', label: m.sidebar_analysis(), icon: AudioLines },
    { id: 'detections', label: m.sidebar_detections(), icon: List },
    { id: 'map', label: m.sidebar_map(), icon: Map },
    { id: 'settings', label: m.sidebar_settings(), icon: Settings },
  ];
</script>

<nav class="border-base-300 bg-base-200 flex w-[72px] shrink-0 flex-col border-r">
  <div class="flex flex-col gap-1 py-2">
    {#each tabs as tab (tab.id)}
      <button
        onclick={() => (appState.activeTab = tab.id)}
        class="relative mx-auto flex w-full flex-col items-center gap-0.5 px-1 py-2.5 transition-colors
          {appState.activeTab === tab.id
          ? 'text-primary'
          : 'text-base-content/50 hover:text-base-content/80 hover:bg-base-300/50'}"
        title={tab.label}
      >
        <!-- Active indicator -->
        {#if appState.activeTab === tab.id}
          <span class="bg-primary absolute top-1 bottom-1 left-0 w-[3px] rounded-r-full"></span>
        {/if}
        <tab.icon size={22} />
        <span class="text-[10px] leading-tight font-medium">{tab.label}</span>
      </button>
    {/each}
  </div>
</nav>
