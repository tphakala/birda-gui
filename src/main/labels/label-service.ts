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
  const ext = path.extname(labelsPath);
  const basename = path.basename(labelsPath, ext);

  const parts = basename.split('-');
  if (parts.length < 2) return labelsPath;

  const lastPart = parts[parts.length - 1];
  const secondToLastPart = parts.length >= 3 ? parts[parts.length - 2] : '';
  let langParts: number;

  if (parts.length >= 3 && /^[a-z]{2}$/.test(secondToLastPart) && /^[A-Za-z]+$/.test(lastPart)) {
    langParts = 2;
  } else if (/^[a-z]{2}$/.test(lastPart)) {
    langParts = 1;
  } else {
    return labelsPath; // Doesn't match pattern
  }

  const prefixStr = parts.slice(0, parts.length - langParts).join('-');
  return path.join(dir, `${prefixStr}-${language}${ext}`);
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
