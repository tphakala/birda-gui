import { app } from 'electron';
import { spawn } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { GpuCapabilities } from '$shared/types';

const execAsync = promisify(exec);

// Nvidia GPU vendor ID (PCI vendor ID for Nvidia Corporation)
const NVIDIA_VENDOR_ID = 0x10de;

async function checkNvidiaSmi(): Promise<boolean> {
  try {
    const cmd = process.platform === 'win32' ? 'where nvidia-smi' : 'which nvidia-smi';
    await execAsync(cmd);
    return true;
  } catch {
    return false;
  }
}

async function getBirdaProviders(birdaPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(birdaPath, ['providers']);
    let stdout = '';
    let stderr = '';
    let resolved = false;

    const cleanup = () => {
      if (!resolved && !proc.killed) {
        proc.kill('SIGTERM');
      }
    };

    // Add 10 second timeout for birda providers command
    const timeout = setTimeout(() => {
      cleanup();
      if (!resolved) {
        resolved = true;
        reject(new Error('birda providers command timed out after 10 seconds'));
      }
    }, 10000);

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (resolved) return;
      resolved = true;

      if (code !== 0) {
        reject(new Error(`birda providers failed: ${stderr}`));
        return;
      }

      // Parse output (format: "CPU\nCUDA\nTensorRT\n")
      const providers = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      resolve(providers);
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      cleanup();
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
}

export async function detectGpuCapabilities(birdaPath?: string): Promise<GpuCapabilities> {
  // 1. Check GPU hardware
  const info = (await app.getGPUInfo('basic')) as {
    gpuDevice?: { vendorId: number; deviceId: number }[];
  };
  const hasNvidiaGpu = info.gpuDevice?.some((d: { vendorId: number }) => d.vendorId === NVIDIA_VENDOR_ID) ?? false;

  // 2. Check CUDA libraries via nvidia-smi
  const cudaLibrariesFound = hasNvidiaGpu && (await checkNvidiaSmi());

  // 3. Get available providers from birda
  let availableProviders: string[] = ['CPU']; // Always available
  if (birdaPath) {
    try {
      availableProviders = await getBirdaProviders(birdaPath);
    } catch (err) {
      console.error('[gpu] Failed to get birda providers:', err);
    }
  }

  return {
    hasNvidiaGpu,
    cudaLibrariesFound,
    availableProviders,
    platform: process.platform,
  };
}
