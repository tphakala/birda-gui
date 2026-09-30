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

export async function getConfig(): Promise<Record<string, unknown>> {
  const stdout = await execBirda(['--output-mode', 'json', 'config', 'show'], {
    errorPrefix: 'Failed to get birda config: ',
  });
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse birda config output: ${stdout.slice(0, 200)}`);
  }
}

export async function setDefaultModel(modelId: string): Promise<void> {
  await execBirda(['config', 'set', 'defaults.model', modelId], { errorPrefix: 'Failed to set default model: ' });
}

export async function getConfigPath(): Promise<string> {
  const stdout = await execBirda(['config', 'path'], { errorPrefix: 'Failed to get birda config path: ' });
  return stdout.trim();
}
