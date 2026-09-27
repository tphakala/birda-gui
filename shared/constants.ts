/**
 * Application-wide constants
 */

export const BIRDA_GITHUB_URL = 'https://github.com/tphakala/birda';
export const BIRDA_RELEASES_URL = 'https://github.com/tphakala/birda/releases/latest';
export const BIRDA_REPO = 'tphakala/birda';
export const CUDA_LIBS_DIR_NAME = 'cuda-libs';
/** Every analysis run status. The catalog's status CHECK constraint is built from this list. */
export const RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'completed_with_errors',
  'cancelled',
] as const;
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
