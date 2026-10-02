import { listAvailableModels } from './ipc';

let names: Promise<Map<string, string>> | undefined;

/** Display name of a model id, loaded once from the catalog of available models; the id when it is unknown or the list cannot be read. */
export async function modelDisplayName(id: string): Promise<string> {
  names ??= listAvailableModels().then((models) => new Map(models.map((model) => [model.id, model.name])));
  try {
    return (await names).get(id) ?? id;
  } catch {
    names = undefined; // retry on the next call
    return id;
  }
}
