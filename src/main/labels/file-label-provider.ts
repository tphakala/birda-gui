import fs from 'fs';
import path from 'path';
import type { LabelProvider } from './label-service';

/**
 * Loads labels from BirdNET-style TXT files where each line is:
 *   Scientific Name_Common Name
 *
 * Also handles CSV files (Perch format) with scientific names only (no common name mapping).
 */
export class FileLabelProvider implements LabelProvider {
  private sciToCommon = new Map<string, string>();
  private lowerIndex = new Map<string, string[]>(); // lowercase common name fragment → scientific names
  private loaded = false;

  async load(filePath: string): Promise<void> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.csv') {
      this.parseCsv(content);
    } else {
      this.parseBirdnetTxt(content);
    }

    this.loaded = true;
  }

  private parseBirdnetTxt(content: string): void {
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const sepIndex = trimmed.indexOf('_');
      if (sepIndex === -1) continue;

      // Format: "Genus species_Common Name"
      const scientific = trimmed.slice(0, sepIndex);
      const common = trimmed.slice(sepIndex + 1);
      if (!scientific || !common) continue;

      this.sciToCommon.set(scientific, common);
      this.indexCommonName(scientific, common);
    }
  }

  private parseCsv(content: string): void {
    // Perch CSV: one scientific name per line, first line is header
    const lines = content.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      // No common name available for CSV-only models
      this.sciToCommon.set(trimmed, trimmed);
    }
  }

  private indexCommonName(scientific: string, common: string): void {
    // Index by lowercase words for substring search
    const lower = common.toLowerCase();
    const existing = this.lowerIndex.get(lower);
    if (existing) {
      existing.push(scientific);
    } else {
      this.lowerIndex.set(lower, [scientific]);
    }
  }

  getCommonName(scientificName: string): string | null {
    return this.sciToCommon.get(scientificName) ?? null;
  }

  searchByCommonName(query: string): string[] {
    const lowerQuery = query.toLowerCase();
    const results: string[] = [];
    for (const [lowerCommon, sciNames] of this.lowerIndex) {
      if (lowerCommon.includes(lowerQuery)) {
        results.push(...sciNames);
      }
    }
    return results;
  }

  resolveAll(scientificNames: string[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const sci of scientificNames) {
      const common = this.sciToCommon.get(sci);
      if (common) result.set(sci, common);
    }
    return result;
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}
