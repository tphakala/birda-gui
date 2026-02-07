<script lang="ts">
  import { Play, Pause, Volume2 } from '@lucide/svelte';
  import * as m from '$paraglide/messages';

  const {
    clipPath,
  }: {
    clipPath: string;
  } = $props();

  let playing = $state(false);
  let audioEl: HTMLAudioElement | null = null;

  // Convert local path to birda-media:// protocol URL
  const mediaUrl = $derived(`birda-media://${clipPath}`);

  function toggle() {
    if (!audioEl) return;
    if (playing) {
      audioEl.pause();
    } else {
      void audioEl.play();
    }
  }

  function handlePlay() {
    playing = true;
  }

  function handlePause() {
    playing = false;
  }

  function handleEnded() {
    playing = false;
  }
</script>

<div class="inline-flex items-center gap-1">
  <button
    onclick={toggle}
    class="btn btn-ghost btn-xs btn-square"
    title={playing ? m.audio_pause() : m.audio_playClip()}
  >
    {#if playing}
      <Pause size={14} />
    {:else}
      <Play size={14} />
    {/if}
  </button>
  <Volume2 size={12} class="text-base-content/40" />
  <audio
    bind:this={audioEl}
    src={mediaUrl}
    onplay={handlePlay}
    onpause={handlePause}
    onended={handleEnded}
    preload="none"
  ></audio>
</div>
