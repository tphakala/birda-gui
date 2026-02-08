import { getDb } from './database';
import type { SpeciesList, SpeciesListEntry, BirdaSpeciesResult } from '$shared/types';

export function createSpeciesList(
  name: string,
  source: 'fetched' | 'custom',
  species: BirdaSpeciesResult[],
  opts?: {
    description?: string;
    latitude?: number;
    longitude?: number;
    week?: number;
    threshold?: number;
  },
): SpeciesList {
  const db = getDb();
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO species_lists (name, description, source, latitude, longitude, week, threshold, species_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        opts?.description ?? null,
        source,
        opts?.latitude ?? null,
        opts?.longitude ?? null,
        opts?.week ?? null,
        opts?.threshold ?? null,
        species.length,
      );

    const listId = result.lastInsertRowid as number;
    const stmt = db.prepare(
      `INSERT INTO species_list_entries (list_id, scientific_name, common_name, frequency)
       VALUES (?, ?, ?, ?)`,
    );
    for (const s of species) {
      stmt.run(listId, s.scientific_name, s.common_name, s.frequency);
    }

    return getSpeciesListById(listId)!;
  })();
}

export function getSpeciesLists(): SpeciesList[] {
  const db = getDb();
  return db.prepare('SELECT * FROM species_lists ORDER BY created_at DESC').all() as SpeciesList[];
}

export function getSpeciesListById(id: number): SpeciesList | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM species_lists WHERE id = ?').get(id) as SpeciesList | undefined;
}

export function getSpeciesListEntries(listId: number): SpeciesListEntry[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM species_list_entries
       WHERE list_id = ?
       ORDER BY frequency DESC, scientific_name ASC`,
    )
    .all(listId) as SpeciesListEntry[];
}

export function deleteSpeciesList(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM species_lists WHERE id = ?').run(id);
}

export function getSpeciesListScientificNames(listId: number): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT scientific_name FROM species_list_entries WHERE list_id = ?').all(listId) as {
    scientific_name: string;
  }[];
  return rows.map((r) => r.scientific_name);
}

export function createCustomSpeciesList(name: string, scientificNames: string[], description?: string): SpeciesList {
  const db = getDb();
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO species_lists (name, description, source, species_count)
         VALUES (?, ?, 'custom', ?)`,
      )
      .run(name, description ?? null, scientificNames.length);

    const listId = result.lastInsertRowid as number;
    const stmt = db.prepare(
      `INSERT INTO species_list_entries (list_id, scientific_name)
       VALUES (?, ?)`,
    );
    for (const sn of scientificNames) {
      stmt.run(listId, sn);
    }

    return getSpeciesListById(listId)!;
  })();
}
