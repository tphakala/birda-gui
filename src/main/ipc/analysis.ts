import { ipcMain, BrowserWindow, dialog } from 'electron';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { z } from 'zod';
import { runAnalysis, findBirda, type AnalysisHandle, type LogLevel } from '../birda/runner';
import { createRun, updateRunStatus, deleteCompletedRunsForSource } from '../db/runs';
import { createLocation, findLocationByCoords } from '../db/locations';
import { insertDetections, updateDetectionClipPath, importDetectionsFromJson } from '../db/detections';
import { getAudioMetadata, parseRecordingStart, formatIsoTimestamp } from './files';
import { createAudioFile } from '../db/audio-files';
import type { AudioFileMetadata } from '$shared/types';
import type {
  BirdaEventEnvelope,
  PipelineStartedPayload,
  FileStartedPayload,
  FileCompletedPayload,
  DetectionsPayload,
} from '../birda/types';

const LEAP_YEAR_FOR_DOY = 2024; // Used to handle Feb 29 in DOY calculation
const MAX_TRACKED_FILES = 100;
const MAX_CONCURRENT_IMPORTS = 10; // Limit concurrent JSON imports to prevent DoS

let currentAnalysis: AnalysisHandle | null = null;

// Simple semaphore for limiting concurrent operations
class Semaphore {
  private permits: number;
  private waiting: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const resolve = this.waiting.shift();
    if (resolve) {
      this.permits--;
      resolve();
    }
  }
}

function sendLog(win: BrowserWindow, level: LogLevel, source: string, message: string): void {
  if (!win.isDestroyed()) {
    win.webContents.send('app:log', { level, source, message });
  }
}

// Helper to track files with overflow warning
// Returns true if overflow warning was just triggered
function trackFileWithOverflow(
  win: BrowserWindow,
  fileArray: string[],
  file: string,
  alreadyOverflowed: boolean,
  context: string,
): boolean {
  if (fileArray.length < MAX_TRACKED_FILES) {
    fileArray.push(file);
    return false;
  } else if (!alreadyOverflowed) {
    sendLog(win, 'warn', 'analysis', `Truncated ${context} files list at ${MAX_TRACKED_FILES} entries`);
    return true;
  }
  return false;
}

async function createTempOutputDir(): Promise<string> {
  // Use mkdtemp for atomic unique directory creation
  return fs.promises.mkdtemp(path.join(tmpdir(), 'birda-'));
}

async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Failed to cleanup temp directory ${tempDir}:`, err);
  }
}

function deriveJsonPath(outputDir: string, audioFile: string): string {
  const basename = path.basename(audioFile, path.extname(audioFile));
  return path.join(outputDir, `${basename}.BirdNET.json`);
}

const AnalysisRequestSchema = z.object({
  source_path: z.string().min(1),
  model: z.string().min(1),
  min_confidence: z.number().min(0).max(1),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  month: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).optional(),
  location_name: z.string().optional(),
  timezone_offset_min: z.number().int().optional(),
});

/**
 * Parse audio file metadata for storage in audio_files table
 * Priority: AudioMoth metadata > filename parsing (defaults to UTC if no timezone set)
 */
async function parseFileMetadata(filePath: string, runTimezoneOffset: number | null): Promise<AudioFileMetadata> {
  const meta = await getAudioMetadata(filePath);

  let recordingStart: string | null = null;
  let timezoneOffset: number | null = runTimezoneOffset;

  // Priority 1: AudioMoth metadata (has timezone)
  if (meta.audiomoth?.recordedAt) {
    recordingStart = meta.audiomoth.recordedAt;
    timezoneOffset = meta.audiomoth.timezoneOffsetMin;
  }
  // Priority 2: Filename parsing (default to UTC if no timezone set)
  else {
    const basename = filePath.replace(/^.*[\\/]/, '');
    const parsed = parseRecordingStart(basename);
    if (parsed) {
      // Default to UTC (offset 0) if no timezone specified
      const offset = timezoneOffset ?? 0;
      recordingStart = formatIsoTimestamp(parsed, offset);
      timezoneOffset ??= 0;
    }
  }

  return {
    recording_start: recordingStart,
    timezone_offset_min: timezoneOffset,
    duration_sec: meta.durationSec,
    sample_rate: meta.sampleRate,
    channels: meta.channels,
    audiomoth_device_id: meta.audiomoth?.deviceId ?? null,
    audiomoth_gain: meta.audiomoth?.gain ?? null,
    audiomoth_battery_v: meta.audiomoth?.batteryV ?? null,
    audiomoth_temperature_c: meta.audiomoth?.temperatureC ?? null,
  };
}

export function registerAnalysisHandlers(): void {
  ipcMain.handle('birda:analyze', async (event, rawRequest: unknown) => {
    // Validate input
    const request = AnalysisRequestSchema.parse(rawRequest);
    if (currentAnalysis) {
      throw new Error('An analysis is already running. Cancel it first.');
    }

    // Lock immediately with placeholder to prevent race condition
    const placeholderHandle: AnalysisHandle = {
      cancel: () => {},
      promise: Promise.resolve(),
      on: () => {},
      stderrLog: () => '',
    };
    currentAnalysis = placeholderHandle;

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      currentAnalysis = null; // Release lock
      throw new Error('No window found');
    }

    try {
      // Detect if source is directory
      const sourceStat = await fs.promises.stat(request.source_path);
      const isDirectory = sourceStat.isDirectory();

      let outputDir: string | undefined;

      if (isDirectory) {
        outputDir = await createTempOutputDir();
        sendLog(win, 'info', 'analysis', `Created temp output directory: ${outputDir}`);
      }

      sendLog(
        win,
        'info',
        'analysis',
        `Starting analysis: model=${request.model}, confidence=${request.min_confidence}, source=${request.source_path}`,
      );

      // Resolve or create location
      let locationId: number | null = null;
      if (request.latitude !== undefined && request.longitude !== undefined) {
        const existing = findLocationByCoords(request.latitude, request.longitude);
        if (existing) {
          locationId = existing.id;
          sendLog(
            win,
            'info',
            'analysis',
            `Using existing location: id=${existing.id} (${request.latitude}, ${request.longitude})`,
          );
        } else {
          const loc = createLocation(request.latitude, request.longitude, request.location_name);
          locationId = loc.id;
          sendLog(
            win,
            'info',
            'analysis',
            `Created location: id=${loc.id} (${request.latitude}, ${request.longitude})`,
          );
        }
      }

      // Delete any previous completed runs for the same source+model to avoid duplicates
      const deletedCount = deleteCompletedRunsForSource(request.source_path, request.model);
      if (deletedCount > 0) {
        sendLog(win, 'info', 'analysis', `Replaced ${deletedCount} previous run(s) (same source + model)`);
      }

      // Create run record
      const run = createRun(
        request.source_path,
        request.model,
        request.min_confidence,
        locationId,
        undefined,
        request.timezone_offset_min,
      );
      sendLog(win, 'info', 'analysis', `Created analysis run: id=${run.id}`);

      // Resolve month/day: prefer values from request, then try to parse from filename
      let month = request.month;
      let day = request.day;
      if (month === undefined || day === undefined) {
        const base = path.basename(request.source_path).replace(/\.[^.]+$/, '');
        const dateMatch = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(base);
        if (dateMatch) {
          month = month ?? Number(dateMatch[2]);
          day = day ?? Number(dateMatch[3]);
          sendLog(win, 'info', 'analysis', `Parsed recording date from filename: month=${month}, day=${day}`);
        }
      }

      // Compute day-of-year from month/day for BSG SDM support.
      // BSG models use --day-of-year (1-366) instead of --month/--day.
      // We pass both so BirdNET gets month/day and BSG gets day-of-year.
      let dayOfYear: number | undefined;
      if (month !== undefined && day !== undefined) {
        const d = new Date(LEAP_YEAR_FOR_DOY, month - 1, day); // leap year to handle Feb 29
        const start = new Date(LEAP_YEAR_FOR_DOY, 0, 0);
        dayOfYear = Math.floor((d.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        sendLog(win, 'info', 'analysis', `Computed day-of-year: ${dayOfYear} (from month=${month}, day=${day})`);
      }

      // Start analysis
      const handle = runAnalysis(request.source_path, {
        model: request.model,
        minConfidence: request.min_confidence,
        latitude: request.latitude,
        longitude: request.longitude,
        month,
        day,
        dayOfYear,
        outputDir,
      });
      // Replace placeholder with real handle
      currentAnalysis = handle;

      let totalDetections = 0;
      const failedFiles: string[] = [];
      const skippedFiles: string[] = [];
      let failedFileCount = 0;
      let skippedFileCount = 0;
      let totalFiles = 0;
      const pendingImports: Promise<void>[] = [];
      let failedFilesOverflow = false;
      let skippedFilesOverflow = false;
      const importSemaphore = new Semaphore(MAX_CONCURRENT_IMPORTS);

      // Forward runner log events to renderer
      handle.on('log', (level: LogLevel, message: string) => {
        sendLog(win, level, 'runner', message);
      });

      // Forward NDJSON events to renderer and capture detections
      handle.on('data', (envelope: BirdaEventEnvelope) => {
        // Synchronously forward event to renderer
        if (!win.isDestroyed()) {
          win.webContents.send('birda:analysis-progress', envelope);
        }

        // Capture async processing as a tracked promise
        const importPromise = (async () => {
          try {
            // Directory mode events
            if (isDirectory && outputDir) {
              if (envelope.event === 'pipeline_started') {
                const payload = envelope.payload as PipelineStartedPayload;
                totalFiles = payload.total_files;
                sendLog(win, 'info', 'analysis', `Starting directory analysis: ${totalFiles} files`);
              } else if (envelope.event === 'file_started') {
                const payload = envelope.payload as FileStartedPayload;
                sendLog(win, 'info', 'analysis', `Processing file: ${payload.file}`);
              } else if (envelope.event === 'file_completed') {
                const payload = envelope.payload as FileCompletedPayload;

                if (payload.status === 'processed') {
                  // Limit concurrent imports to prevent resource exhaustion
                  await importSemaphore.acquire();
                  try {
                    const jsonPath = deriveJsonPath(outputDir, payload.file);

                    // NEW: Parse file metadata and create audio_file record
                    const fileMetadata = await parseFileMetadata(payload.file, run.timezone_offset_min);
                    const audioFileId = createAudioFile(run.id, payload.file, fileMetadata);

                    // Import detections with audio_file_id reference
                    const result = await importDetectionsFromJson(run.id, locationId, audioFileId, jsonPath);

                    totalDetections += result.detections;
                    sendLog(
                      win,
                      'info',
                      'analysis',
                      `Imported ${result.detections} detections from ${result.sourceFile}`,
                    );
                  } catch (err) {
                    sendLog(win, 'error', 'analysis', `Failed to import ${payload.file}: ${(err as Error).message}`);
                    failedFileCount++;
                    if (trackFileWithOverflow(win, failedFiles, payload.file, failedFilesOverflow, 'failed')) {
                      failedFilesOverflow = true;
                    }
                  } finally {
                    importSemaphore.release();
                  }
                } else if (payload.status === 'skipped') {
                  skippedFileCount++;
                  if (trackFileWithOverflow(win, skippedFiles, payload.file, skippedFilesOverflow, 'skipped')) {
                    skippedFilesOverflow = true;
                  }
                  sendLog(win, 'info', 'analysis', `Skipped ${payload.file}`);
                } else {
                  // Must be 'failed' - only remaining case
                  failedFileCount++;
                  if (trackFileWithOverflow(win, failedFiles, payload.file, failedFilesOverflow, 'failed')) {
                    failedFilesOverflow = true;
                  }
                  sendLog(win, 'warn', 'analysis', `Failed to process ${payload.file}`);
                }
              }
            }
            // Single file mode events (existing behavior)
            else if (envelope.event === 'detections') {
              const payload = envelope.payload as DetectionsPayload;
              if (payload.detections.length > 0) {
                try {
                  // NEW: Create audio_file record for single file
                  const fileMetadata = await parseFileMetadata(payload.file, run.timezone_offset_min);
                  const audioFileId = createAudioFile(run.id, payload.file, fileMetadata);

                  insertDetections(run.id, locationId, audioFileId, payload.detections);
                  totalDetections += payload.detections.length;
                  sendLog(
                    win,
                    'info',
                    'analysis',
                    `Inserted ${payload.detections.length} detection(s) from ${payload.file}`,
                  );
                } catch (err) {
                  sendLog(win, 'error', 'analysis', `Failed to insert detections: ${(err as Error).message}`);
                }
              }
            }
          } catch (err) {
            sendLog(win, 'error', 'analysis', `Event handler error: ${(err as Error).message}`);
          }
        })();

        pendingImports.push(importPromise);
      });

      // Track final status for conditional cleanup
      let finalStatus: 'completed' | 'completed_with_errors' | 'failed' = 'completed';

      try {
        await handle.promise;

        // Wait for all pending imports to complete before calculating status
        await Promise.allSettled(pendingImports);

        // Determine final status
        if (isDirectory) {
          const processedCount = totalFiles - skippedFileCount - failedFileCount;

          if (failedFileCount > 0) {
            finalStatus = processedCount > 0 ? 'completed_with_errors' : 'failed';
          }

          sendLog(
            win,
            'info',
            'analysis',
            `Directory analysis complete: ${processedCount} processed, ${skippedFileCount} skipped, ${failedFileCount} failed`,
          );
        }

        sendLog(win, 'info', 'analysis', `Analysis completed: ${totalDetections} total detection(s)`);
        updateRunStatus(run.id, finalStatus);
        return { runId: run.id, status: finalStatus };
      } catch (err) {
        finalStatus = 'failed';
        updateRunStatus(run.id, 'failed');
        const stderrLog = handle.stderrLog();
        const errorMsg = `Analysis failed: ${(err as Error).message}`;
        sendLog(win, 'error', 'analysis', errorMsg);
        if (stderrLog) {
          sendLog(win, 'error', 'analysis', `stderr output:\n${stderrLog}`);
        }
        throw new Error(`${errorMsg}${stderrLog ? '\n\nstderr:\n' + stderrLog : ''}`);
      } finally {
        currentAnalysis = null;

        // Cleanup temp directory on success, preserve on failure for debugging
        if (outputDir) {
          if (finalStatus === 'failed') {
            sendLog(win, 'warn', 'analysis', `Preserving temp directory for debugging: ${outputDir}`);
          } else {
            await cleanupTempDir(outputDir);
            sendLog(win, 'info', 'analysis', `Cleaned up temp directory: ${outputDir}`);
          }
        }
      }
    } catch (err) {
      // Release lock on setup error ONLY if still placeholder
      if (currentAnalysis === placeholderHandle) {
        currentAnalysis = null;
      }
      throw err;
    }
  });

  ipcMain.handle('birda:cancel-analysis', () => {
    if (currentAnalysis) {
      currentAnalysis.cancel();
      currentAnalysis = null;
      return true;
    }
    return false;
  });

  ipcMain.handle('app:get-log', () => {
    return currentAnalysis?.stderrLog() ?? '';
  });

  ipcMain.handle(
    'birda:extract-clip',
    async (_event, detectionId: number, sourceFile: string, startTime: number, endTime: number, outputDir: string) => {
      const birdaPath = await findBirda();

      // Ensure output directory exists
      await fs.promises.mkdir(outputDir, { recursive: true });

      const args = [
        'clip',
        '--audio',
        sourceFile,
        '--start',
        String(startTime),
        '--end',
        String(endTime),
        '--output',
        outputDir,
      ];

      console.log(`[extract-clip] Running: ${birdaPath} ${args.join(' ')}`);

      return new Promise<string>((resolve, reject) => {
        const _child = execFile(
          birdaPath,
          args,
          { maxBuffer: 10 * 1024 * 1024, timeout: 30000 },
          (err, stdout, stderr) => {
            if (err) {
              console.error(`[extract-clip] Failed:`, err.message, stderr);
              reject(new Error(`Clip extraction failed: ${stderr || err.message}`));
              return;
            }
            const clipPath = stdout.trim();
            console.log(`[extract-clip] Output: ${clipPath}`);
            if (!clipPath) {
              reject(new Error(`Clip extraction returned empty path. stderr: ${stderr}`));
              return;
            }
            updateDetectionClipPath(detectionId, clipPath);
            resolve(clipPath);
          },
        );
      });
    },
  );

  // Spectrogram cache: save PNG next to clip
  ipcMain.handle(
    'clip:save-spectrogram',
    async (_event, clipPath: string, freqMax: number, height: number, dataUrl: string) => {
      const dir = path.dirname(clipPath);
      const base = path.basename(clipPath, path.extname(clipPath));
      const cachePath = path.join(dir, `${base}_spec_${freqMax}_${height}.png`);
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      await fs.promises.writeFile(cachePath, Buffer.from(base64, 'base64'));
      return cachePath;
    },
  );

  // Spectrogram cache: check if cached PNG exists, return path or null
  ipcMain.handle('clip:get-spectrogram', async (_event, clipPath: string, freqMax: number, height: number) => {
    const dir = path.dirname(clipPath);
    const base = path.basename(clipPath, path.extname(clipPath));
    const cachePath = path.join(dir, `${base}_spec_${freqMax}_${height}.png`);
    try {
      await fs.promises.access(cachePath);
      return cachePath;
    } catch {
      return null;
    }
  });

  // Export audio region as WAV file
  ipcMain.handle('clip:export-region', async (event, base64Data: string, defaultName?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window found');

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Region as WAV',
      defaultPath: defaultName ?? 'region-export.wav',
      filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const wavBuffer = Buffer.from(base64Data, 'base64');
    await fs.promises.writeFile(result.filePath, wavBuffer);
    return result.filePath;
  });
}
