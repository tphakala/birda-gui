import { describe, it, expect } from 'vitest';
import {
  variantKey,
  licenseKey,
  foldText,
  dedupeRegionVariants,
  pickGlobalVariant,
  groupVariants,
  searchRegions,
  hasUpdate,
  variantForModel,
  installedTitle,
} from './logic';
import type { ModelManifest, ManifestVariant, InstalledModel } from '$shared/types';

function variant(partial: Partial<ManifestVariant> & { id: string }): ManifestVariant {
  return {
    model_url: 'https://x/model.onnx',
    labels_url: 'https://x/labels.txt',
    group_order: 0,
    ...partial,
  };
}

function manifest(variants: ManifestVariant[], extra: Partial<ModelManifest> = {}): ModelManifest {
  return {
    id: 'birdnet-v30',
    name: 'BirdNET v3.0',
    version: '3.0',
    model_type: 'birdnet-v30',
    license: {
      type: 'CC-BY-NC-SA-4.0',
      url: 'https://x/license',
      commercial_use: false,
      attribution_required: true,
      share_alike: true,
    },
    selection: {},
    variants,
    ...extra,
  };
}

function installed(partial: Partial<InstalledModel> & { id: string }): InstalledModel {
  return { model_type: 'birdnet-v30', is_default: false, ...partial };
}

describe('variantKey', () => {
  it('keys a region', () => {
    expect(variantKey('birdnet-v30', 'nordic')).toBe('birdnet-v30:nordic');
  });
  it('keys the global variant when region is absent', () => {
    expect(variantKey('birdnet-v30')).toBe('birdnet-v30:global');
    expect(variantKey('birdnet-v30', undefined)).toBe('birdnet-v30:global');
  });
});

describe('licenseKey', () => {
  it('combines family and license id', () => {
    expect(licenseKey('perch-v2', 'CC-BY-NC-SA-4.0')).toBe('perch-v2:CC-BY-NC-SA-4.0');
  });
});

describe('foldText', () => {
  it('lowercases and strips diacritics', () => {
    expect(foldText('Åland')).toBe('aland');
    expect(foldText('Curaçao')).toBe('curacao');
    expect(foldText('NORDIC')).toBe('nordic');
  });
});

describe('dedupeRegionVariants', () => {
  it('collapses hardware variants to one entry per region and drops the global one', () => {
    const m = manifest(
      [
        variant({ id: 'fp32', region: 'nordic' }),
        variant({ id: 'fp16', region: 'nordic' }),
        variant({ id: 'fp32', region: 'iberia' }),
        variant({ id: 'fp32' }), // global (no region)
      ],
      { default_variant: 'fp16' },
    );
    const result = dedupeRegionVariants(m);
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.region).sort()).toEqual(['iberia', 'nordic']);
    // Prefers the default_variant as the representative for a region.
    expect(result.find((v) => v.region === 'nordic')?.id).toBe('fp16');
  });
});

describe('pickGlobalVariant', () => {
  it('prefers the no-region default variant, falling back to any no-region', () => {
    const m = manifest([variant({ id: 'fp32' }), variant({ id: 'fp16' }), variant({ id: 'fp32', region: 'nordic' })], {
      default_variant: 'fp16',
    });
    expect(pickGlobalVariant(m)?.id).toBe('fp16');

    const noDefault = manifest([variant({ id: 'fp32' }), variant({ id: 'fp32', region: 'nordic' })]);
    expect(pickGlobalVariant(noDefault)?.id).toBe('fp32');
    expect(pickGlobalVariant(noDefault)?.region).toBeUndefined();
  });
});

describe('groupVariants', () => {
  it('groups by continent and orders by group_order', () => {
    const variants = [
      variant({ id: 'a', region: 'japan', group: 'asia', group_name: 'Asia', group_order: 1 }),
      variant({ id: 'b', region: 'nordic', group: 'europe', group_name: 'Europe', group_order: 0 }),
      variant({ id: 'c', region: 'iberia', group: 'europe', group_name: 'Europe', group_order: 0 }),
    ];
    const groups = groupVariants(variants);
    expect(groups.map((g) => g.slug)).toEqual(['europe', 'asia']);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items.map((v) => v.region)).toEqual(['japan']);
  });
});

describe('searchRegions', () => {
  const variants = [
    variant({
      id: 'nordic',
      region: 'nordic',
      region_name: 'Nordic',
      group_name: 'Europe',
      countries: { core: ['Finland', 'Sweden', 'Åland'], partial: [] },
    }),
    variant({
      id: 'iberia',
      region: 'iberia',
      region_name: 'Iberia',
      group_name: 'Europe',
      countries: { core: ['Spain'], partial: ['France'] },
    }),
  ];

  it('returns nothing for an empty query', () => {
    expect(searchRegions(variants, '  ')).toEqual([]);
  });

  it('matches a core country and records the hint', () => {
    const results = searchRegions(variants, 'finland');
    expect(results).toHaveLength(1);
    expect(results[0].variant.region).toBe('nordic');
    expect(results[0].rank).toBe(1);
    expect(results[0].hint).toEqual({ kind: 'core', country: 'Finland' });
  });

  it('matches a partial country at a lower rank than core', () => {
    const results = searchRegions(variants, 'france');
    expect(results[0].variant.region).toBe('iberia');
    expect(results[0].hint).toEqual({ kind: 'partial', country: 'France' });
  });

  it('folds diacritics so "aland" finds Åland', () => {
    const results = searchRegions(variants, 'aland');
    expect(results.map((r) => r.variant.region)).toContain('nordic');
  });

  it('ranks a region-name match above a country match', () => {
    const results = searchRegions(variants, 'iberia');
    expect(results[0].rank).toBe(0);
    expect(results[0].variant.region).toBe('iberia');
  });
});

describe('hasUpdate', () => {
  it('is true only when the manifest build is newer', () => {
    expect(hasUpdate(installed({ id: 'x', installed_build: 2 }), manifest([], { build: 3 }))).toBe(true);
    expect(hasUpdate(installed({ id: 'x', installed_build: 3 }), manifest([], { build: 3 }))).toBe(false);
    expect(hasUpdate(installed({ id: 'x', installed_build: 4 }), manifest([], { build: 3 }))).toBe(false);
  });

  it('is false when either build is unknown or the manifest is missing', () => {
    expect(hasUpdate(installed({ id: 'x' }), manifest([], { build: 3 }))).toBe(false);
    expect(hasUpdate(installed({ id: 'x', installed_build: 2 }), manifest([]))).toBe(false);
    expect(hasUpdate(installed({ id: 'x', installed_build: 2 }), undefined)).toBe(false);
  });
});

describe('searchRegions ranking and edge cases', () => {
  it('orders a name match ahead of a country match for the same query, regardless of input order', () => {
    const fixture = [
      // input order is deliberately country-match first, so a passing result
      // proves the comparator ran, not just input order.
      variant({ id: 'b', region: 'baltics', region_name: 'Baltics', countries: { core: ['Finland'], partial: [] } }),
      variant({ id: 'f', region: 'finland', region_name: 'Finland', countries: { core: [], partial: [] } }),
    ];
    const results = searchRegions(fixture, 'finland');
    expect(results.map((r) => r.variant.region)).toEqual(['finland', 'baltics']);
    expect(results[0].rank).toBe(0);
    expect(results[1].rank).toBe(1);
  });

  it('matches by continent name at rank 3 (ties keep all matches)', () => {
    const fixture = [
      variant({ id: 'n', region: 'nordic', region_name: 'Nordic', group_name: 'Europe' }),
      variant({ id: 'i', region: 'iberia', region_name: 'Iberia', group_name: 'Europe' }),
    ];
    const results = searchRegions(fixture, 'europe');
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.rank === 3)).toBe(true);
  });

  it('does not throw when a variant has no countries and still matches by name', () => {
    const fixture = [variant({ id: 'x', region: 'x', region_name: 'Xland' })];
    expect(() => searchRegions(fixture, 'zzz')).not.toThrow();
    expect(searchRegions(fixture, 'xland')[0].variant.region).toBe('x');
  });
});

describe('dedupe / global / group edge cases', () => {
  it('keeps the first-seen variant per region when no default_variant is set', () => {
    const m = manifest([variant({ id: 'fp32', region: 'nordic' }), variant({ id: 'fp16', region: 'nordic' })]);
    const result = dedupeRegionVariants(m);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('fp32');
  });

  it('pickGlobalVariant returns undefined when there is no region-less variant', () => {
    expect(pickGlobalVariant(manifest([variant({ id: 'a', region: 'nordic' })]))).toBeUndefined();
  });

  it("groupVariants buckets a variant with no group under 'other'", () => {
    const groups = groupVariants([variant({ id: 'a', region: 'a' })]);
    expect(groups[0].slug).toBe('other');
  });
});

describe('variantForModel / installedTitle', () => {
  const man = manifest([variant({ id: 'fp32', region: 'nordic', region_name: 'Nordic' }), variant({ id: 'g' })]);

  it('finds the variant matching an installed model region', () => {
    expect(variantForModel(installed({ id: 'm', region: 'nordic' }), man)?.region_name).toBe('Nordic');
    expect(variantForModel(installed({ id: 'm' }), man)?.id).toBe('g');
  });

  it('builds a friendly title, falling back to the id without a manifest', () => {
    expect(installedTitle(installed({ id: 'm', region: 'nordic' }), man)).toBe('BirdNET v3.0 · Nordic');
    expect(installedTitle(installed({ id: 'm2' }), man)).toBe('BirdNET v3.0');
    expect(installedTitle(installed({ id: 'raw-id', region: 'x' }), undefined)).toBe('raw-id');
  });
});
