import { describe, expect, it } from 'vitest';
import { flattenConfig } from './config-view';

describe('flattenConfig', () => {
  it('flattens nested sections into dotted keys', () => {
    expect(flattenConfig({ defaults: { model: 'birdnet' }, inference: { device: 'auto' } })).toEqual([
      { key: 'defaults.model', value: 'birdnet' },
      { key: 'inference.device', value: 'auto' },
    ]);
  });

  it('rounds float noise', () => {
    const entries = flattenConfig({
      defaults: { min_confidence: 0.10000000149011612, range_threshold: 0.009999999776482582, overlap: 0 },
    });
    expect(entries).toEqual([
      { key: 'defaults.min_confidence', value: '0.1' },
      { key: 'defaults.range_threshold', value: '0.01' },
      { key: 'defaults.overlap', value: '0' },
    ]);
  });

  it('marks nulls, empty strings, empty arrays and empty sections as not set', () => {
    expect(
      flattenConfig({ defaults: { latitude: null, label: '', formats: [], csv_columns: { include: [] } }, models: {} }),
    ).toEqual([
      { key: 'defaults.latitude', value: null },
      { key: 'defaults.label', value: null },
      { key: 'defaults.formats', value: null },
      { key: 'defaults.csv_columns.include', value: null },
      { key: 'models', value: null },
    ]);
  });

  it('joins arrays and prints booleans', () => {
    expect(flattenConfig({ defaults: { formats: ['csv', 'json'] }, output: { color: true } })).toEqual([
      { key: 'defaults.formats', value: 'csv, json' },
      { key: 'output.color', value: 'true' },
    ]);
  });
});
