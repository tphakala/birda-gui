import { SvelteSet } from 'svelte/reactivity';
import type { ModelManifest, InstalledModel } from '$shared/types';

// Progress of the install in flight (see modelInstall.svelte.ts), as the
// gallery's cards and dialogs show it.
export interface Download {
  line?: string;
  percent?: number;
  bytesDone?: number;
  bytesTotal?: number;
}

interface GalleryState {
  tab: 'installed' | 'browse';
  family: string;
  manifests: Record<string, ModelManifest>;
  installed: InstalledModel[];
  // Keyed by `${family}:${licenseType}`. Remembered per family+license so a user
  // assembling several regions of one family accepts its license only once.
  acceptedLicenses: SvelteSet<string>;
  error: string | null;
}

export const galleryStore: GalleryState = $state({
  tab: 'installed',
  family: 'birdnet-v30',
  manifests: {},
  installed: [],
  acceptedLicenses: new SvelteSet<string>(),
  error: null,
});

// Pure key helpers live in the framework-free logic module (unit tested there);
// re-exported here so components keep importing them from the store.
export { variantKey, licenseKey } from '$lib/gallery/logic';
