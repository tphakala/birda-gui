/**
 * Application-wide constants
 */

export const BIRDA_GITHUB_URL = 'https://github.com/tphakala/birda';
export const BIRDA_RELEASES_URL = 'https://github.com/tphakala/birda/releases/latest';
export const BIRDA_REPO = 'tphakala/birda';
export const CUDA_LIBS_DIR_NAME = 'cuda-libs';
export const CUDA_VERSION_FILE = '.cuda-version';
/**
 * Must match the birda CLI release whose CUDA assets we download, which is the
 * bundled CLI version in package.json birdaCli.version (fetched by
 * scripts/fetch-birda-cli.ts); src/main/birda/cli-version.test.ts checks they agree.
 * Used by: SettingsPanel.svelte (which release to download), cuda/manager.ts (installed check),
 * birda/runner.ts (LD_LIBRARY_PATH), gpu/detection.ts (availability).
 */
export const BIRDA_CLI_VERSION = '1.8.1';

/** Nvidia PCI vendor ID */
export const NVIDIA_VENDOR_ID = 0x10de;

/**
 * Every analysis run status. SCHEMA_SQL and migration 8 build the catalog's
 * status CHECK from this list, but a catalog that already ran migration 8 keeps
 * its CHECK: adding a status also needs a new migration that rebuilds the table.
 */
export const RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'completed_with_errors',
  'cancelled',
] as const;

/** A run whose results are complete; a completed re-analysis replaces earlier results with them. */
export const COMPLETE_RUN_STATUSES = ['completed', 'completed_with_errors'] as const;
/** A run that ended with partial results. */
export const PARTIAL_RUN_STATUSES = ['cancelled', 'failed'] as const;
/** A run that has not finished. Its detections are left out of catalog-wide counts. */
export const UNFINISHED_RUN_STATUSES = ['pending', 'running'] as const;
