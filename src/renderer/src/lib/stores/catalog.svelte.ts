import type { EnrichedDetection, DetectionFilter } from '$shared/types';
import { getDetections } from '$lib/utils/ipc';

export type SortColumn =
  | 'common_name'
  | 'scientific_name'
  | 'confidence'
  | 'start_time'
  | 'source_file'
  | 'detected_at';
export type SortDir = 'asc' | 'desc';

export const catalogState = $state({
  detections: [] as EnrichedDetection[],
  total: 0,
  filter: {
    species: '',
    location_id: undefined as number | undefined,
    min_confidence: undefined as number | undefined,
    run_id: undefined as number | undefined,
    limit: 50,
    offset: 0,
  } as DetectionFilter & { species: string },
  sortColumn: 'detected_at' as SortColumn,
  sortDir: 'desc' as SortDir,
  selectedDetection: null as EnrichedDetection | null,
  loading: false,
});

export async function loadDetections(): Promise<void> {
  catalogState.loading = true;
  try {
    // When sorting by common_name, the DB doesn't have this column.
    // Send scientific_name to DB and re-sort client-side after enrichment.
    const dbSortColumn = catalogState.sortColumn === 'common_name' ? 'scientific_name' : catalogState.sortColumn;

    const result = await getDetections({
      species: catalogState.filter.species || undefined,
      location_id: catalogState.filter.location_id,
      min_confidence: catalogState.filter.min_confidence,
      run_id: catalogState.filter.run_id,
      limit: catalogState.filter.limit,
      offset: catalogState.filter.offset,
      sort_column: dbSortColumn,
      sort_dir: catalogState.sortDir,
    });

    let detections = result.detections;

    // Client-side sort by common_name (only within the current page)
    if (catalogState.sortColumn === 'common_name') {
      const dir = catalogState.sortDir === 'asc' ? 1 : -1;
      detections = [...detections].sort((a, b) => dir * a.common_name.localeCompare(b.common_name));
    }

    catalogState.detections = detections;
    catalogState.total = result.total;
  } catch {
    catalogState.detections = [];
    catalogState.total = 0;
  } finally {
    catalogState.loading = false;
  }
}

export function resetFilters(): void {
  catalogState.filter.species = '';
  catalogState.filter.location_id = undefined;
  catalogState.filter.min_confidence = undefined;
  catalogState.filter.run_id = undefined;
  catalogState.filter.offset = 0;
}
