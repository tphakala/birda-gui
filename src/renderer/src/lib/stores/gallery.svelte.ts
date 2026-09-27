import { SvelteSet } from 'svelte/reactivity';
import type { ModelManifest, InstalledModel } from '$shared/types';

// Progress for a single in-flight install. An entry exists only while the
// install is running; it is removed on success, error, or cancel (errors and
// cancellations surface via galleryStore.error and the aria-live announcer).
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
  // Keyed by variantKey(family, region). Present only while a download is in
  // flight; cleared on success, error, or cancel.
  downloads: Record<string, Download>;
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
  downloads: {},
  acceptedLicenses: new SvelteSet<string>(),
  error: null,
});

/**
 * The single in-flight install, by variant key. Kept here rather than in the
 * gallery component so a gallery remounted mid-install (a settings sub-tab
 * switch) shares it with the instance that started the install. Not reactive.
 */
export const installTracker = {
  /** The install this window started or adopted. */
  currentKey: null as string | null,
  /** The install the user cancelled, so its rejection is reported as a cancel. */
  cancelledKey: null as string | null,
  /** An install this window did not start, e.g. one still running after a reload. */
  adoptedKey: null as string | null,
};

// Pure key helpers live in the framework-free logic module (unit tested there);
// re-exported here so components keep importing them from the store.
export { variantKey, licenseKey } from '$lib/gallery/logic';
