<script lang="ts">
  import { MapPinOff } from '@lucide/svelte';

  const { message }: { message: string } = $props();
</script>

<div class="text-base-content/70 flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
  <MapPinOff size={32} aria-hidden="true" />
  <p class="max-w-sm text-sm">{message}</p>
</div>
