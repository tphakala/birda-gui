import { app, net } from 'electron';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import type { ManifestVariant } from '$shared/types';

// "family/region" -> coverage_url. Populated only from birda manifest fetches,
// so the birda-map:// protocol can never be pointed at an arbitrary URL by the
// renderer (no SSRF): it serves only URLs birda vouched for.
const coverageUrls = new Map<string, string>();

// One in-flight fetch per family/region, so several region cards requesting the
// same map at once share a single download and write instead of racing.
const inFlight = new Map<string, Promise<string | null>>();

const key = (family: string, region: string): string => `${family}/${region}`;
const cacheDir = (): string => path.join(app.getPath('userData'), 'coverage-cache');

// family/region reach here from the renderer via the birda-map:// URL. The
// allow-map lookup already gates on birda-vouched keys, but reject any
// path-bearing segment before it can touch the filesystem (defense in depth).
const isUnsafeSegment = (s: string): boolean => s.includes('/') || s.includes('\\') || s.includes('..');

export function registerCoverageUrls(family: string, variants: ManifestVariant[]): void {
  for (const variant of variants) {
    if (variant.region && variant.coverage_url) {
      coverageUrls.set(key(family, variant.region), variant.coverage_url);
    }
  }
}

/**
 * Return the on-disk path to a region's cached coverage map, fetching and caching
 * it on first request. Returns null when the URL is unknown or the fetch fails,
 * so the renderer's <img> falls back to the "map unavailable" tile.
 */
export async function getCoveragePath(family: string, region: string): Promise<string | null> {
  if (isUnsafeSegment(family) || isUnsafeSegment(region)) return null;
  const url = coverageUrls.get(key(family, region));
  if (!url) return null;
  // birda resolves Hugging Face URLs, which are always https; refuse anything
  // else so a bad manifest cannot make main read a local file or fetch cleartext.
  if (!url.startsWith('https://')) return null;

  const dir = path.join(cacheDir(), family);
  const file = path.join(dir, `${region}.svg`);
  try {
    await fs.access(file);
    return file;
  } catch {
    // Not cached yet; fetch it below.
  }

  const mapKey = key(family, region);
  const pending = inFlight.get(mapKey);
  if (pending) return pending;

  const fetchAndCache = (async (): Promise<string | null> => {
    try {
      const res = await net.fetch(url);
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.mkdir(dir, { recursive: true });
      // Unique temp name then atomic rename: an interrupted or interleaved write
      // must never leave a truncated file that fs.access then serves forever.
      const tmp = `${file}.${randomUUID()}.tmp`;
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.writeFile(tmp, buffer);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.rename(tmp, file);
      return file;
    } catch {
      return null;
    } finally {
      inFlight.delete(mapKey);
    }
  })();
  inFlight.set(mapKey, fetchAndCache);
  return fetchAndCache;
}
