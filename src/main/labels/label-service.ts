import path from 'path';
import { FileLabelProvider } from './file-label-provider';

export interface LabelProvider {
  getCommonName(scientificName: string): string | null;
  searchByCommonName(query: string): string[];
  resolveAll(scientificNames: string[]): Map<string, string>;
  isLoaded(): boolean;
}

let activeProvider: LabelProvider | null = null;

function setLabelProvider(provider: LabelProvider): void {
  activeProvider = provider;
}

export function searchByCommonName(query: string): string[] {
  return activeProvider?.searchByCommonName(query) ?? [];
}

export function resolveAll(scientificNames: string[]): Map<string, string> {
  return activeProvider?.resolveAll(scientificNames) ?? new Map<string, string>();
}

// --- Language reload ---

/**
 * Build the labels file path for a given language.
 * @param labelsPath The model's default labels_path (e.g., .../birdnet-v24-en.txt)
 * @param language The language code (e.g., "fi")
 * @returns The language-specific path, or the original labelsPath if it can't be derived
 */
export function buildLabelsPath(labelsPath: string, language: string): string {
  const dir = path.dirname(labelsPath);
  const basename = path.basename(labelsPath);
  // Match model prefix before the language suffix (e.g., "birdnet-v24" from "birdnet-v24-en.txt")
  // Language codes can be "en", "pt-BR", etc.
  const match = /^(.+)-[a-z]{2}(?:-[A-Za-z]+)?\.\w+$/.exec(basename);
  if (!match) return labelsPath;
  return path.join(dir, `${match[1]}-${language}.txt`);
}

/**
 * Reload the label provider with a new labels file.
 */
export async function reloadLabels(labelsPath: string): Promise<void> {
  const provider = new FileLabelProvider();
  await provider.load(labelsPath);
  setLabelProvider(provider);
  console.log(`[labels] Reloaded labels from ${labelsPath}`);
}
