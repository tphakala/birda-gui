/**
 * Build-time script to download the birda CLI embeddable artifact.
 *
 * Reads birdaCli.version and birdaCli.repo from package.json, downloads the
 * platform-appropriate embed archive from GitHub Releases, and extracts it
 * to resources/birda-cli/.
 *
 * Supports TARGET_PLATFORM env var for cross-compilation (e.g. "windows-x64").
 * Otherwise uses process.platform + process.arch to determine the target.
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'resources', 'birda-cli');
const VERSION_FILE = path.join(OUTPUT_DIR, '.version');

interface BirdaCliConfig {
  version: string;
  repo: string;
}

interface PackageJson {
  birdaCli?: BirdaCliConfig;
}

interface PlatformInfo {
  name: string;
  ext: string;
  binaryName: string;
}

function readConfig(): BirdaCliConfig {
  const raw = fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8');
  const pkg = JSON.parse(raw) as PackageJson;
  if (!pkg.birdaCli?.version || !pkg.birdaCli.repo) {
    throw new Error('Missing birdaCli.version or birdaCli.repo in package.json');
  }
  return pkg.birdaCli;
}

function getPlatformInfo(): PlatformInfo {
  const envTarget = process.env.TARGET_PLATFORM;
  if (envTarget) {
    const isWindows = envTarget.startsWith('windows');
    return {
      name: envTarget,
      ext: isWindows ? '.zip' : '.tar.gz',
      binaryName: isWindows ? 'birda.exe' : 'birda',
    };
  }

  const platform = process.platform;
  const arch = process.arch;

  const mapping = new Map<string, PlatformInfo>([
    ['linux-x64', { name: 'linux-x64', ext: '.tar.gz', binaryName: 'birda' }],
    ['win32-x64', { name: 'windows-x64', ext: '.zip', binaryName: 'birda.exe' }],
    ['darwin-arm64', { name: 'macos-arm64', ext: '.tar.gz', binaryName: 'birda' }],
  ]);

  const key = `${platform}-${arch}`;
  const info = mapping.get(key);
  if (!info) {
    throw new Error(`Unsupported platform: ${key}. Set TARGET_PLATFORM env var for cross-compilation.`);
  }
  return info;
}

function isVersionCurrent(version: string): boolean {
  try {
    const existing = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
    return existing === version;
  } catch {
    return false;
  }
}

function download(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl: string, redirectCount: number) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      https
        .get(requestUrl, (res) => {
          // Follow redirects
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume(); // Drain response to free socket
            doRequest(res.headers.location, redirectCount + 1);
            return;
          }

          if (res.statusCode === 404) {
            res.resume();
            reject(
              new Error(
                `404 Not Found: ${requestUrl}\nCheck that birdaCli.version in package.json matches a valid release tag.`,
              ),
            );
            return;
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`));
            return;
          }

          const chunks: Buffer[] = [];
          let downloaded = 0;
          const total = parseInt(res.headers['content-length'] ?? '0', 10);

          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
            downloaded += chunk.length;
            if (total > 0) {
              const pct = Math.round((downloaded / total) * 100);
              process.stdout.write(
                `\r  Downloading: ${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB (${pct}%)`,
              );
            } else {
              process.stdout.write(`\r  Downloading: ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
            }
          });

          res.on('end', () => {
            process.stdout.write('\n');
            resolve(Buffer.concat(chunks));
          });

          res.on('error', reject);
        })
        .on('error', reject);
    };

    doRequest(url, 0);
  });
}

function extract(archivePath: string, platformInfo: PlatformInfo): void {
  if (platformInfo.ext === '.zip') {
    // Windows: use PowerShell Expand-Archive
    // Escape single quotes in paths for PowerShell ('' is the escape sequence)
    const psArchive = archivePath.replaceAll("'", "''");
    const psOutput = OUTPUT_DIR.replaceAll("'", "''");
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Path '${psArchive}' -DestinationPath '${psOutput}' -Force`],
      { stdio: 'inherit' },
    );
  } else {
    // Linux/macOS: use tar
    execFileSync('tar', ['xzf', archivePath, '-C', OUTPUT_DIR], { stdio: 'inherit' });
  }
}

async function main(): Promise<void> {
  const { version, repo } = readConfig();
  const platformInfo = getPlatformInfo();

  console.log(`[fetch-birda-cli] Target: ${platformInfo.name}, CLI version: ${version}`);

  // Check if already downloaded
  if (isVersionCurrent(version)) {
    const binaryPath = path.join(OUTPUT_DIR, platformInfo.binaryName);
    if (fs.existsSync(binaryPath)) {
      console.log(`[fetch-birda-cli] Already up to date (v${version}). Skipping.`);
      return;
    }
  }

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Clean existing files (version mismatch or missing binary)
  const existing = fs.readdirSync(OUTPUT_DIR);
  for (const file of existing) {
    const filePath = path.join(OUTPUT_DIR, file);
    fs.rmSync(filePath, { recursive: true, force: true });
  }

  // Download
  const artifactName = `birda-${platformInfo.name}-embed-v${version}${platformInfo.ext}`;
  const url = `https://github.com/${repo}/releases/download/v${version}/${artifactName}`;
  console.log(`[fetch-birda-cli] Downloading ${artifactName}...`);

  const data = await download(url);

  // Write archive to temp file
  const archivePath = path.join(OUTPUT_DIR, artifactName);
  fs.writeFileSync(archivePath, data);

  // Extract
  console.log(`[fetch-birda-cli] Extracting...`);
  extract(archivePath, platformInfo);

  // Clean up archive
  fs.unlinkSync(archivePath);

  // Verify binary exists
  const binaryPath = path.join(OUTPUT_DIR, platformInfo.binaryName);
  if (!fs.existsSync(binaryPath)) {
    // Check if files are nested in a subdirectory
    const contents = fs.readdirSync(OUTPUT_DIR);
    throw new Error(
      `Expected binary at ${binaryPath} but not found.\n` +
        `Archive contents: ${contents.join(', ')}\n` +
        `The embed artifact may have a wrapper directory. Check the archive structure.`,
    );
  }

  // Make binary executable on Unix
  if (process.platform !== 'win32') {
    fs.chmodSync(binaryPath, 0o755);
  }

  // Write version marker
  fs.writeFileSync(VERSION_FILE, version, 'utf-8');

  console.log(`[fetch-birda-cli] Done. Binary at ${binaryPath}`);
}

main().catch((err: unknown) => {
  console.error(`[fetch-birda-cli] Fatal:`, err);
  process.exit(1);
});
