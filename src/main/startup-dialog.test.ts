import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  answers: [] as number[],
  dbExists: true,
  exit: vi.fn(),
  showMessageBoxSync: vi.fn(),
  showItemInFolder: vi.fn(),
  openPath: vi.fn(() => Promise.resolve('')),
}));

vi.mock('electron', () => ({
  app: { exit: h.exit, getPath: () => '/data/user' },
  dialog: { showMessageBoxSync: h.showMessageBoxSync },
  shell: { showItemInFolder: h.showItemInFolder, openPath: h.openPath },
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const patched = { ...actual, existsSync: () => h.dbExists };
  return { ...patched, default: patched };
});

const { reportCatalogOpenFailure } = await import('./startup-dialog');

beforeEach(() => {
  vi.clearAllMocks();
  h.showMessageBoxSync.mockImplementation(() => h.answers.shift() ?? 1);
  h.answers = [];
  h.dbExists = true;
});

describe('reportCatalogOpenFailure', () => {
  it('exits with code 1 when the user chooses Quit', () => {
    h.answers = [1];
    reportCatalogOpenFailure(new Error('locked'));
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.showItemInFolder).not.toHaveBeenCalled();
  });

  it('shows the database and asks again until the user quits', () => {
    h.answers = [0, 0, 1];
    reportCatalogOpenFailure(new Error('locked'));
    expect(h.showMessageBoxSync).toHaveBeenCalledTimes(3);
    expect(h.showItemInFolder).toHaveBeenCalledTimes(2);
    expect(h.showItemInFolder).toHaveBeenCalledWith('/data/user/birda-catalog.db');
    expect(h.exit).toHaveBeenCalledTimes(1);
  });

  it('opens the folder when the database file does not exist', () => {
    h.dbExists = false;
    h.answers = [0, 1];
    reportCatalogOpenFailure('x');
    expect(h.showItemInFolder).not.toHaveBeenCalled();
    expect(h.openPath).toHaveBeenCalledWith('/data/user');
  });

  it('names the database file, the log file and the error in the dialog', () => {
    h.answers = [1];
    reportCatalogOpenFailure(new Error('SQLITE_BUSY'));
    const options = (h.showMessageBoxSync.mock.calls[0] as unknown[])[0] as {
      detail: string;
      buttons: string[];
    };
    expect(options.buttons).toEqual(['Show in Folder', 'Quit']);
    expect(options.detail).toContain('Database file: /data/user/birda-catalog.db');
    expect(options.detail).toContain('Log file: /data/user/logs/main.log');
    expect(options.detail).toContain('Error: SQLITE_BUSY');
  });
});
