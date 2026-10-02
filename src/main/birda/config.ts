import fs from 'fs';
import path from 'path';
import { execBirda } from './exec';

export interface RegistryLanguage {
  code: string;
  name: string;
  url: string;
  filename: string;
}

interface RegistryModel {
  id: string;
  files: {
    labels?: {
      default_language: string;
      languages: RegistryLanguage[];
    };
  };
}

interface Registry {
  schema_version: string;
  models: RegistryModel[];
}

async function readRegistry(): Promise<Registry> {
  const configPath = await getConfigPath();
  const configDir = path.dirname(configPath);
  const registryPath = path.join(configDir, 'registry.json');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const raw = await fs.promises.readFile(registryPath, 'utf-8');
  return JSON.parse(raw) as Registry;
}

export async function getRegistryLanguages(modelId: string): Promise<RegistryLanguage[]> {
  const registry = await readRegistry();
  const model = registry.models.find((m) => m.id === modelId);
  return model?.files.labels?.languages ?? [];
}

/** What `birda config show` reports: where the config file is and its contents. */
export interface BirdaConfigPayload {
  config_path?: string;
  config: Record<string, unknown>;
}

export async function getConfig(): Promise<BirdaConfigPayload> {
  const stdout = await execBirda(['--output-mode', 'json', 'config', 'show'], {
    errorPrefix: 'Failed to get birda config: ',
  });
  let payload: unknown;
  try {
    payload = (JSON.parse(stdout) as { payload?: unknown }).payload;
  } catch {
    throw new Error(`Failed to parse birda config output: ${stdout.slice(0, 200)}`);
  }
  const config = (payload as { config?: unknown } | null | undefined)?.config;
  if (typeof config !== 'object' || config === null) {
    throw new Error(`Unexpected birda config output: ${stdout.slice(0, 200)}`);
  }
  const { config_path } = payload as { config_path?: unknown };
  return {
    ...(typeof config_path === 'string' && { config_path }),
    config: config as Record<string, unknown>,
  };
}

export async function setDefaultModel(modelId: string): Promise<void> {
  await execBirda(['config', 'set', 'defaults.model', modelId], { errorPrefix: 'Failed to set default model: ' });
}

export async function getConfigPath(): Promise<string> {
  const stdout = await execBirda(['config', 'path'], { errorPrefix: 'Failed to get birda config path: ' });
  return stdout.trim();
}
