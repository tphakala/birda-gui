// Pure, framework-free gallery logic, extracted from the Svelte components so it
// can be unit tested. Nothing here touches runes, the DOM, or IPC.
import type { ManifestVariant, ModelManifest, InstalledModel } from '$shared/types';

/** Stable key for a variant's install/download state (region, or "global"). */
export function variantKey(family: string, region?: string): string {
  return `${family}:${region ?? 'global'}`;
}

/** Key for remembered license acceptance (per family + license id). */
export function licenseKey(family: string, licenseType: string): string {
  return `${family}:${licenseType}`;
}

/** Lowercase and strip diacritics so "aland" matches "Aland" / "Åland". */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Collapse hardware variants (fp32/fp16/...) to one entry per region. birda
 * auto-selects the hardware variant at install time, so the gallery installs by
 * region only; the manifest's default_variant is the preferred representative.
 */
export function dedupeRegionVariants(manifest: ModelManifest): ManifestVariant[] {
  const byRegion = new Map<string, ManifestVariant>();
  for (const v of manifest.variants) {
    if (!v.region) continue;
    const existing = byRegion.get(v.region);
    if (!existing || v.id === manifest.default_variant) byRegion.set(v.region, v);
  }
  return [...byRegion.values()];
}

/** The family's global/full variant (no region), preferring default_variant. */
export function pickGlobalVariant(manifest: ModelManifest): ManifestVariant | undefined {
  return (
    manifest.variants.find((v) => !v.region && v.id === manifest.default_variant) ??
    manifest.variants.find((v) => !v.region)
  );
}

export interface RegionGroup {
  slug: string;
  name: string;
  order: number;
  items: ManifestVariant[];
}

/** Group region variants by continent, ordered by the manifest's group_order. */
export function groupVariants(variants: ManifestVariant[]): RegionGroup[] {
  const byGroup = new Map<string, RegionGroup>();
  for (const v of variants) {
    const slug = v.group ?? 'other';
    let group = byGroup.get(slug);
    if (!group) {
      group = { slug, name: v.group_name ?? slug, order: v.group_order, items: [] };
      byGroup.set(slug, group);
    }
    group.items.push(v);
  }
  return [...byGroup.values()].sort((a, b) => a.order - b.order);
}

export interface RegionMatch {
  variant: ManifestVariant;
  rank: number;
  hint?: { kind: 'core' | 'partial'; country: string };
}

/**
 * Rank region variants against a country/region query: region-name matches
 * first, then core-country, then partial-country, then continent-name.
 */
export function searchRegions(variants: ManifestVariant[], query: string): RegionMatch[] {
  const q = foldText(query.trim());
  if (!q) return [];
  return variants
    .map((v): RegionMatch => {
      const name = foldText(v.region_name ?? '');
      const core = (v.countries?.core ?? []).find((c) => foldText(c).includes(q));
      const partial = (v.countries?.partial ?? []).find((c) => foldText(c).includes(q));
      if (name.includes(q)) return { variant: v, rank: 0 };
      if (core) return { variant: v, rank: 1, hint: { kind: 'core', country: core } };
      if (partial) return { variant: v, rank: 2, hint: { kind: 'partial', country: partial } };
      if (foldText(v.group_name ?? '').includes(q)) return { variant: v, rank: 3 };
      return { variant: v, rank: 99 };
    })
    .filter((r) => r.rank < 99)
    .sort((a, b) => a.rank - b.rank);
}

/**
 * An installed model has an update when the manifest's conversion build is newer
 * than the installed one. build is our monotonic revision, so it is the reliable
 * signal; a missing build on either side means "no update known".
 */
export function hasUpdate(model: InstalledModel, manifest: ModelManifest | undefined): boolean {
  return manifest?.build !== undefined && model.installed_build !== undefined && manifest.build > model.installed_build;
}
