/**
 * Application-wide constants
 */

export const BIRDA_GITHUB_URL = 'https://github.com/tphakala/birda';
export const BIRDA_RELEASES_URL = 'https://github.com/tphakala/birda/releases/latest';
export const BIRDA_REPO = 'tphakala/birda';
export const CUDA_LIBS_DIR_NAME = 'cuda-libs';
export const CUDA_VERSION_FILE = '.cuda-version';
/**
 * Must match the birda CLI release whose CUDA assets we download.
 * Update this when bumping the bundled CLI version (see scripts/fetch-birda-cli.sh).
 * Used by: cuda/manager.ts (download), birda/runner.ts (LD_LIBRARY_PATH), gpu/detection.ts (availability).
 */
export const BIRDA_CLI_VERSION = '1.7.0';

/** Nvidia PCI vendor ID */
export const NVIDIA_VENDOR_ID = 0x10de;
