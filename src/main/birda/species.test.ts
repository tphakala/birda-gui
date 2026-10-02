import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledModel } from '$shared/types';

vi.mock('./exec', () => ({ execBirda: vi.fn() }));
vi.mock('./models', () => ({ listModels: vi.fn() }));

const { fetchSpecies, fetchSpeciesForRequest, pickRangeModel } = await import('./species');
const { listModels } = await import('./models');
const { speciesFetchProblem } = await import('$shared/birda-error');
const { execBirda } = await import('./exec');

const model = (id: string, extra: Partial<InstalledModel> = {}): InstalledModel => ({
  id,
  model_type: 'perch',
  is_default: false,
  ...extra,
});

describe('pickRangeModel', () => {
  it('prefers the requested model when it has a meta model', () => {
    const models = [model('a', { has_meta_model: true, is_default: true }), model('b', { has_meta_model: true })];
    expect(pickRangeModel(models, 'b')?.id).toBe('b');
  });

  it('falls back to the default, then a BirdNET model, then any model with a meta model', () => {
    const noMeta = model('req', { has_meta_model: false });
    expect(
      pickRangeModel(
        [noMeta, model('x', { has_meta_model: true }), model('def', { has_meta_model: true, is_default: true })],
        'req',
      )?.id,
    ).toBe('def');
    expect(
      pickRangeModel(
        [
          noMeta,
          model('x', { has_meta_model: true }),
          model('bn', { has_meta_model: true, model_type: 'birdnet-v24' }),
        ],
        'req',
      )?.id,
    ).toBe('bn');
    expect(pickRangeModel([noMeta, model('x', { has_meta_model: true })], 'req')?.id).toBe('x');
  });

  it('skips a default model without a meta model', () => {
    const models = [model('def', { has_meta_model: false, is_default: true }), model('x', { has_meta_model: true })];
    expect(pickRangeModel(models)?.id).toBe('x');
  });

  it('returns null when no model has a meta model', () => {
    expect(pickRangeModel([model('a', { has_meta_model: false })], 'a')).toBeNull();
    expect(pickRangeModel([])).toBeNull();
  });

  it('uses requested, default, first when birda does not report has_meta_model', () => {
    const models = [model('a'), model('b'), model('c', { is_default: true })];
    expect(pickRangeModel(models, 'b')?.id).toBe('b');
    expect(pickRangeModel(models)?.id).toBe('c');
    expect(pickRangeModel([model('a'), model('b')])?.id).toBe('a');
  });
});

describe('fetchSpecies', () => {
  beforeEach(() => {
    vi.mocked(execBirda).mockReset();
    vi.mocked(execBirda).mockResolvedValue(JSON.stringify({ payload: { species: [] } }));
  });

  it('passes --model right after species', async () => {
    await fetchSpecies(60, 25, 20, 0.05, 'birdnet-v24');
    const args = vi.mocked(execBirda).mock.calls[0]?.[0] ?? [];
    const at = args.indexOf('species');
    expect(args.slice(at, at + 3)).toEqual(['species', '--model', 'birdnet-v24']);
    expect(args).toContain('--threshold');
  });

  it('omits --model when none is given', async () => {
    await fetchSpecies(60, 25, 20);
    expect(vi.mocked(execBirda).mock.calls[0]?.[0]).not.toContain('--model');
  });
});

describe('fetchSpeciesForRequest', () => {
  const request = { latitude: 60, longitude: 25, week: 20, model: 'req' };
  beforeEach(() => {
    vi.mocked(execBirda).mockReset();
    vi.mocked(execBirda).mockResolvedValue(JSON.stringify({ payload: { species: [] } }));
    vi.mocked(listModels).mockReset();
  });
  const modelArg = () => {
    const args = vi.mocked(execBirda).mock.calls[0]?.[0] ?? [];
    return args[args.indexOf('--model') + 1];
  };

  it('uses the requested model when it has a meta model', async () => {
    vi.mocked(listModels).mockResolvedValue([model('req', { has_meta_model: true })]);
    const result = await fetchSpeciesForRequest(request);
    expect(modelArg()).toBe('req');
    expect(result.model_used).toBe('req');
  });

  it("falls back to another model's meta model and names it", async () => {
    vi.mocked(listModels).mockResolvedValue([
      model('req', { has_meta_model: false }),
      model('other', { has_meta_model: true }),
    ]);
    expect((await fetchSpeciesForRequest(request)).model_used).toBe('other');
    expect(modelArg()).toBe('other');
  });

  it('throws a message that classifies as no range model when none qualifies', async () => {
    vi.mocked(listModels).mockResolvedValue([model('req', { has_meta_model: false })]);
    const err = await fetchSpeciesForRequest(request).catch((e: unknown) => e as Error);
    expect(speciesFetchProblem((err as Error).message)).toBe('no_range_model');
    expect(execBirda).not.toHaveBeenCalled();
  });

  it('calls birda without a model when the model list cannot be read', async () => {
    vi.mocked(listModels).mockRejectedValue(new Error('boom'));
    const result = await fetchSpeciesForRequest(request);
    expect(vi.mocked(execBirda).mock.calls[0]?.[0]).not.toContain('--model');
    expect(result.model_used).toBeUndefined();
  });
});
