import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { findBirda } from './runner';

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

export async function readRegistry(): Promise<Registry> {
  const configPath = await getConfigPath();
  const configDir = path.dirname(configPath);
  const registryPath = path.join(configDir, 'registry.json');
  const raw = await fs.promises.readFile(registryPath, 'utf-8');
  return JSON.parse(raw) as Registry;
}

export async function getRegistryLanguages(modelId: string): Promise<RegistryLanguage[]> {
  const registry = await readRegistry();
  const model = registry.models.find((m) => m.id === modelId);
  return model?.files.labels?.languages ?? [];
}

export async function getConfig(): Promise<Record<string, unknown>> {
  const birdaPath = await findBirda();

  return new Promise((resolve, reject) => {
    execFile(birdaPath, ['--output-mode', 'json', 'config', 'show'], (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Failed to get birda config: ${stderr || err.message}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        reject(new Error(`Failed to parse birda config output: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

export async function getConfigPath(): Promise<string> {
  const birdaPath = await findBirda();

  return new Promise((resolve, reject) => {
    execFile(birdaPath, ['config', 'path'], (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Failed to get birda config path: ${stderr || err.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
