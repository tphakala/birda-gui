import { SvelteSet } from 'svelte/reactivity';
import type { ModelManifest, InstalledModel } from '$shared/types';

export type DownloadState = 'installing' | 'error' | 'cancelled';

export interface Download {
  state: DownloadState;
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
  // Keyed by variantKey(family, region). Present while a download is in flight
  // or just after it errored/cancelled; cleared on success or dismissal.
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

/** Stable key for a variant's install/download state (region, or "global"). */
export function variantKey(family: string, region?: string): string {
  return `${family}:${region ?? 'global'}`;
}

/** Key for remembered license acceptance. */
export function licenseKey(family: string, licenseType: string): string {
  return `${family}:${licenseType}`;
}
