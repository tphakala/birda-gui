import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, resetIpc } from '../test-support/ipc-harness';

const h = vi.hoisted(() => ({ active: false, activeRun: null as number | null }));

vi.mock('electron', async () => (await import('../test-support/ipc-harness')).electronMock);
vi.mock('./analysis', () => ({
  isAnalysisActive: () => h.active,
  activeRunId: () => h.activeRun,
}));
vi.mock('../db/database', () => ({
  clearDatabase: vi.fn(() => ({ runs: 0, detections: 0, annotations: 0 })),
  checkDatabaseHealth: vi.fn(),
  optimizeDatabase: vi.fn(),
  vacuumDatabase: vi.fn(),
}));
vi.mock('../db/runs', () => ({ getRunsWithStats: vi.fn(), deleteRun: vi.fn() }));
vi.mock('../db/detections', () => ({}));
vi.mock('../db/locations', () => ({}));
vi.mock('../labels/label-service', () => ({}));

const { registerCatalogHandlers } = await import('./catalog');
const { clearDatabase } = await import('../db/database');
const { deleteRun } = await import('../db/runs');
registerCatalogHandlers();

beforeEach(() => {
  vi.clearAllMocks();
  resetIpc();
  h.active = false;
  h.activeRun = null;
});

describe('catalog:clear-database', () => {
  it('clears the catalog when no analysis is running', () => {
    invoke('catalog:clear-database');
    expect(clearDatabase).toHaveBeenCalledOnce();
  });

  it('refuses while an analysis runs or is stopping', () => {
    h.active = true;
    expect(() => invoke('catalog:clear-database')).toThrow('Stop the analysis');
    expect(clearDatabase).not.toHaveBeenCalled();
  });
});

describe('catalog:delete-run', () => {
  it('deletes a run that no analysis is writing to', () => {
    h.activeRun = 3;
    invoke('catalog:delete-run', 2);
    expect(deleteRun).toHaveBeenCalledWith(2);
  });

  it('refuses to delete the run of the running analysis', () => {
    h.activeRun = 3;
    expect(() => invoke('catalog:delete-run', 3)).toThrow('Stop the analysis');
    expect(deleteRun).not.toHaveBeenCalled();
  });
});
