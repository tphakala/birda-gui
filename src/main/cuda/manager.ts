import https from 'node:https';
import type { IncomingMessage, ClientRequest } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { CudaStatus, CudaDownloadResult, BirdaManifest } from '$shared/types';
import {
  BIRDA_CLI_VERSION,
  BIRDA_REPO,
  CUDA_LIBS_DIR_NAME,
  CUDA_VERSION_FILE,
  NVIDIA_VENDOR_ID,
} from '$shared/constants';

const execFileAsync = promisify(execFileCallback);

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SAFE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;

/** Active download request, used for cancellation */
let activeRequest: ClientRequest | null = null;
let downloadInProgress = false;
let downloadCancelled = false;

function validateVersion(version: string): void {
  if (!VERSION_RE.test(version)) {
    throw new Error(`Invalid version format: ${version}`);
  }
}

function validateAssetName(name: string): void {
  if (!SAFE_FILENAME_RE.test(name) || name.includes('..')) {
    throw new Error(`Invalid asset name: ${name}`);
  }
}

export function getCudaLibsDir(): string {
  return path.join(app.getPath('userData'), CUDA_LIBS_DIR_NAME);
}

function calculateDirSize(dirPath: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return 0; // Directory doesn't exist or can't be read
  }
  for (const entry of entries) {
    try {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += calculateDirSize(fullPath);
      } else {
        total += fs.statSync(fullPath).size;
      }
    } catch {
      // Skip inaccessible files
    }
  }
  return total;
}

export async function getCudaStatus(): Promise<CudaStatus> {
  const platformSupported = process.platform === 'linux' || process.platform === 'win32';

  // Check NVIDIA GPU presence
  let hasNvidiaGpu = false;
  try {
    const info = (await app.getGPUInfo('basic')) as {
      gpuDevice?: { vendorId: number; deviceId: number }[];
    };
    hasNvidiaGpu = info.gpuDevice?.some((d) => d.vendorId === NVIDIA_VENDOR_ID) ?? false;
  } catch {
    // GPU info not available
  }

  const cudaDir = getCudaLibsDir();
  const versionFile = path.join(cudaDir, CUDA_VERSION_FILE);

  let installed = false;
  let version: string | null = null;
  let diskUsageBytes = 0;

  try {
    fs.accessSync(versionFile);
    version = fs.readFileSync(versionFile, 'utf-8').trim();
    // Only consider installed if version matches the expected CLI version
    installed = version === BIRDA_CLI_VERSION;
    diskUsageBytes = calculateDirSize(cudaDir);
  } catch {
    // Not installed
  }

  return {
    hasNvidiaGpu,
    installed,
    version,
    diskUsageBytes,
    platformSupported,
    downloadInProgress,
  };
}

function httpsGet(
  url: string,
  options?: { headers?: Record<string, string> },
): Promise<{ res: IncomingMessage; req: ClientRequest }> {
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl: string, redirectCount: number) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      if (!requestUrl.startsWith('https:')) {
        reject(new Error(`Refusing non-HTTPS URL: ${requestUrl}`));
        return;
      }

      const req = https.get(requestUrl, { timeout: 30_000, headers: options?.headers }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (!res.headers.location.startsWith('https:')) {
            reject(new Error(`Redirect to non-HTTPS URL refused: ${res.headers.location}`));
            return;
          }
          doRequest(res.headers.location, redirectCount + 1);
          return;
        }

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`));
          return;
        }

        resolve({ res, req });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Request timed out: ${requestUrl}`));
      });
      req.on('error', reject);
    };

    doRequest(url, 0);
  });
}

async function fetchManifest(version: string): Promise<BirdaManifest> {
  validateVersion(version);
  const url = `https://github.com/${BIRDA_REPO}/releases/download/v${version}/manifest.json`;
  const { res } = await httpsGet(url);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => {
      try {
        const manifest = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as BirdaManifest;
        resolve(manifest);
      } catch (err) {
        reject(new Error(`Failed to parse manifest: ${(err as Error).message}`));
      }
    });
    res.on('error', reject);
  });
}

function getPlatformKey(): 'windows-x64' | 'linux-x64' {
  if (process.platform === 'win32') return 'windows-x64';
  if (process.platform === 'linux') return 'linux-x64';
  throw new Error(`CUDA libraries are not supported on platform: ${process.platform}`);
}

function cleanupArchive(archivePath: string): void {
  try {
    fs.unlinkSync(archivePath);
  } catch {
    // File may not exist or already deleted
  }
}

export async function downloadCudaLibs(
  version: string,
  onProgress: (downloaded: number, total: number, phase: string) => void,
): Promise<CudaDownloadResult> {
  validateVersion(version);

  if (downloadInProgress) {
    throw new Error('A CUDA download is already in progress');
  }

  downloadInProgress = true;
  downloadCancelled = false;
  let archivePath: string | null = null;
  let extractionStarted = false;

  try {
    const manifest = await fetchManifest(version);
    // downloadCancelled may be set by cancelDownload() during the await above
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (downloadCancelled) throw new Error('Download cancelled by user');

    const platformKey = getPlatformKey();
    const assetName = manifest.assets.cuda_libs[platformKey];

    if (!assetName) {
      throw new Error(`No CUDA library asset found for platform: ${platformKey}`);
    }

    validateAssetName(assetName);

    const downloadUrl = `https://github.com/${BIRDA_REPO}/releases/download/v${version}/${assetName}`;
    const cudaDir = getCudaLibsDir();
    fs.mkdirSync(cudaDir, { recursive: true });

    archivePath = path.join(cudaDir, assetName);

    // Download the archive
    onProgress(0, 0, 'downloading');
    const { res, req } = await httpsGet(downloadUrl);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- may be set during async httpsGet
    if (downloadCancelled) {
      res.resume();
      req.destroy();
      throw new Error('Download cancelled by user');
    }
    activeRequest = req;

    const total = parseInt(res.headers['content-length'] ?? '0', 10);
    let downloaded = 0;
    const progress = new PassThrough();
    progress.on('data', (chunk: Buffer) => {
      downloaded += chunk.length;
      onProgress(downloaded, total, 'downloading');
    });

    const fileStream = fs.createWriteStream(archivePath);
    await pipeline(res, progress, fileStream);
    activeRequest = null;

    // Extract asynchronously to avoid blocking the main thread
    extractionStarted = true;
    onProgress(0, 0, 'extracting');
    if (assetName.endsWith('.zip')) {
      const psArchive = archivePath.replaceAll("'", "''");
      const psOutput = cudaDir.replaceAll("'", "''");
      await execFileAsync('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${psArchive}' -DestinationPath '${psOutput}' -Force`,
      ]);
    } else {
      await execFileAsync('tar', ['xzf', archivePath, '-C', cudaDir]);
    }

    // Remove archive after extraction
    cleanupArchive(archivePath);
    archivePath = null;

    // Write version file
    onProgress(0, 0, 'verifying');
    const versionFile = path.join(cudaDir, CUDA_VERSION_FILE);
    fs.writeFileSync(versionFile, version, 'utf-8');

    const diskUsageBytes = calculateDirSize(cudaDir);

    return {
      success: true,
      version,
      diskUsageBytes,
    };
  } catch (err) {
    activeRequest = null;
    if (archivePath) {
      cleanupArchive(archivePath);
    }
    // If extraction started but failed, wipe the entire directory to prevent
    // corrupted partial extraction from persisting
    if (extractionStarted) {
      try {
        fs.rmSync(getCudaLibsDir(), { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }
    throw err;
  } finally {
    downloadInProgress = false;
  }
}

/**
 * Cancels an in-progress CUDA download.
 * Sets a flag checked between async phases (manifest fetch, HTTP connect)
 * and destroys the active HTTP request if one exists.
 * Returns true if a download was in progress, false otherwise.
 */
export function cancelDownload(): boolean {
  downloadCancelled = true;
  if (activeRequest) {
    activeRequest.destroy(new Error('Download cancelled by user'));
    activeRequest = null;
    return true;
  }
  return downloadInProgress;
}

export function removeCudaLibs(): void {
  fs.rmSync(getCudaLibsDir(), { recursive: true, force: true });
}

export async function getCudaDownloadSize(version: string): Promise<number> {
  validateVersion(version);
  try {
    const manifest = await fetchManifest(version);
    const platformKey = getPlatformKey();
    const assetName = manifest.assets.cuda_libs[platformKey];

    if (!assetName) return 0;

    // Use GitHub API to get asset size (User-Agent required by GitHub API)
    const apiUrl = `https://api.github.com/repos/${BIRDA_REPO}/releases/tags/v${version}`;
    const { res } = await httpsGet(apiUrl, {
      headers: { 'User-Agent': 'birda-gui', Accept: 'application/vnd.github.v3+json' },
    });

    const body = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });
      res.on('error', reject);
    });

    const release = JSON.parse(body) as { assets: { name: string; size: number }[] };
    const asset = release.assets.find((a) => a.name === assetName);
    return asset?.size ?? 0;
  } catch {
    return 0;
  }
}
