import { execBirda } from './exec';
import { listModels } from './models';
import type { BirdaSpeciesResponse, InstalledModel, SpeciesFetchRequest } from '$shared/types';

interface BirdaJsonEnvelope {
  spec_version: string;
  timestamp: string;
  event: string;
  payload?: Record<string, unknown>;
}

/**
 * The installed model whose range (meta) model to use for Fetch Species:
 * the requested model if it has one, else the default model, else the first
 * BirdNET model, else any model that has one. birda lists has_meta_model per
 * model; when it lists none (an older birda) every model qualifies, so the
 * order is requested, default, first. Null when no model qualifies.
 */
export function pickRangeModel(models: InstalledModel[], preferred?: string): InstalledModel | null {
  const known = models.some((m) => m.has_meta_model !== undefined);
  const usable = models.filter((m) => !known || m.has_meta_model === true);
  return (
    usable.find((m) => m.id === preferred) ??
    usable.find((m) => m.is_default) ??
    usable.find((m) => /^birdnet/i.test(m.model_type)) ??
    (usable.length > 0 ? usable[0] : null)
  );
}

export async function fetchSpecies(
  latitude: number,
  longitude: number,
  week: number,
  threshold?: number,
  model?: string,
): Promise<BirdaSpeciesResponse> {
  const args = [
    '--output-mode',
    'json',
    'species',
    ...(model ? ['--model', model] : []),
    '--lat',
    String(latitude),
    '--lon',
    String(longitude),
    '--week',
    String(week),
  ];
  if (threshold !== undefined) {
    args.push('--threshold', String(threshold));
  }

  const stdout = await execBirda(args, { errorPrefix: 'birda species command failed: ' });
  let envelope: BirdaJsonEnvelope;
  try {
    envelope = JSON.parse(stdout) as BirdaJsonEnvelope;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse birda species output: ${detail}. Output: ${stdout.slice(0, 200)}`, { cause: e });
  }
  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object' || !('species' in payload)) {
    throw new Error('Unexpected payload format from birda species command');
  }
  return payload as unknown as BirdaSpeciesResponse;
}

/** Message of the error thrown when no installed model has a range (meta) model; speciesFetchProblem recognises it. */
const NO_RANGE_MODEL_MESSAGE = 'No installed model has a range filter (meta model)';

/**
 * Fetch Species with the best range model for the request: birda needs a model
 * with its own meta model and does not borrow another's. When the model list
 * cannot be read, birda is called without a model and left to report what is wrong.
 * The result names the model used.
 */
export async function fetchSpeciesForRequest(request: SpeciesFetchRequest): Promise<BirdaSpeciesResponse> {
  let models: InstalledModel[] | null = null;
  try {
    models = await listModels();
  } catch {
    // Fall through to birda's own error.
  }
  if (models === null) {
    return fetchSpecies(request.latitude, request.longitude, request.week, request.threshold);
  }
  const picked = pickRangeModel(models, request.model);
  if (!picked) throw new Error(NO_RANGE_MODEL_MESSAGE);
  const response = await fetchSpecies(request.latitude, request.longitude, request.week, request.threshold, picked.id);
  return { ...response, model_used: picked.id };
}
