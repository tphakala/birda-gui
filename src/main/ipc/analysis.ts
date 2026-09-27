import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { z } from 'zod';
import { runAnalysis, findBirda, registerProcess, unregisterProcess, type LogLevel } from '../birda/runner';
import { AnalysisCancelledError, AnalysisLock, type AnalysisSession } from '../birda/analysis-session';
import { createRun, finishRun } from '../db/runs';
import { createLocation, findLocationByCoords } from '../db/locations';
import { insertDetections, updateDetectionClipPath, importDetectionsFromJson } from '../db/detections';
import { getAudioMetadata, parseRecordingStart, formatIsoTimestamp } from './files';
import { createAudioFile } from '../db/audio-files';
import { settingsStore } from '../settings/store';
import { sendToWindows } from './broadcast';
import type {
  AnalysisResult,
  AudioFileMetadata,
  BirdaEventEnvelope,
  DetectionsPayload,
  FileCompletedPayload,
  FileStartedPayload,
  FinishedRunStatus,
  PipelineStartedPayload,
} from '$shared/types';
import { applyProgressEvent } from '$shared/analysis-progress';
import { parseRecordingName } from '$shared/recording-name';

const LEAP_YEAR_FOR_DOY = 2024; // Used to handle Feb 29 in DOY calculation
const MAX_CONCURRENT_IMPORTS = 10; // Limit concurrent JSON imports to prevent DoS

const analysisLock = new AnalysisLock();

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

function sendLog(level: LogLevel, source: string, message: string): void {
  sendToWindows('app:log', { level, source, message });
}

function sendAnalysisStatus(finished?: AnalysisResult & { error?: string }): void {
  const status = analysisLock.status();
  sendToWindows(
    'birda:analysis-status-changed',
    status.state === 'idle' && finished ? { ...status, finished } : status,
  );
}

async function createTempOutputDir(): Promise<string> {
  // Use mkdtemp for atomic unique directory creation
  return fs.promises.mkdtemp(path.join(tmpdir(), 'birda-'));
}

async function hasEntries(dir: string): Promise<boolean> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return (await fs.promises.readdir(dir)).length > 0;
  } catch {
    return false;
  }
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

type AnalysisRequestInput = z.infer<typeof AnalysisRequestSchema>;

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
    const parsed = parseRecordingStart(filePath);
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

function resolveLocation(request: AnalysisRequestInput): number | null {
  if (request.latitude === undefined || request.longitude === undefined) return null;
  const existing = findLocationByCoords(request.latitude, request.longitude);
  if (existing) {
    sendLog(
      'info',
      'analysis',
      `Using existing location: id=${existing.id} (${request.latitude}, ${request.longitude})`,
    );
    return existing.id;
  }
  const loc = createLocation(request.latitude, request.longitude, request.location_name);
  sendLog('info', 'analysis', `Created location: id=${loc.id} (${request.latitude}, ${request.longitude})`);
  return loc.id;
}

/**
 * Month and day for the range filter: the request's values, else parsed from a
 * YYYYMMDD_HHMMSS source name. dayOfYear is for BSG models, which take
 * --day-of-year instead of --month/--day; both are passed.
 */
function resolveDate(request: AnalysisRequestInput): {
  month: number | undefined;
  day: number | undefined;
  dayOfYear: number | undefined;
} {
  let month = request.month;
  let day = request.day;
  if (month === undefined || day === undefined) {
    // The same rule the analysis page uses to show the date.
    const parsed = parseRecordingName(request.source_path);
    if (parsed) {
      month ??= parsed.month;
      day ??= parsed.day;
      sendLog('info', 'analysis', `Parsed recording date from filename: month=${month}, day=${day}`);
    }
  }
  if (month === undefined || day === undefined) return { month, day, dayOfYear: undefined };
  const d = new Date(LEAP_YEAR_FOR_DOY, month - 1, day); // leap year to handle Feb 29
  const start = new Date(LEAP_YEAR_FOR_DOY, 0, 0);
  const dayOfYear = Math.floor((d.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  sendLog('info', 'analysis', `Computed day-of-year: ${dayOfYear} (from month=${month}, day=${day})`);
  return { month, day, dayOfYear };
}

/** Keeps the session's progress snapshot, for a window that joins mid-run. */
function trackProgress(session: AnalysisSession, envelope: BirdaEventEnvelope): void {
  applyProgressEvent(session.progress, envelope);
  if (envelope.event === 'file_completed') {
    const payload = envelope.payload as FileCompletedPayload;
    session.progress.completedFiles.push({ file: payload.file, status: payload.status });
  }
}

/** Records a failed run without letting a catalog error replace the error being reported. */
function recordFailure(runId: number): void {
  try {
    finishRun(runId, 'failed');
  } catch (err) {
    sendLog('error', 'analysis', `Could not record run ${runId} as failed: ${(err as Error).message}`);
  }
}

/** Runs one analysis for a session that holds the lock. */
async function analyze(session: AnalysisSession, request: AnalysisRequestInput): Promise<AnalysisResult> {
  // Detect if source is directory
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sourceStat = await fs.promises.stat(request.source_path);
  const isDirectory = sourceStat.isDirectory();

  let outputDir: string | undefined;
  // birda's output is kept for debugging when the run failed and birda wrote something.
  let keepOutput = false;

  try {
    if (isDirectory) {
      outputDir = await createTempOutputDir();
      session.outputDir = outputDir;
      sendLog('info', 'analysis', `Created temp output directory: ${outputDir}`);
    }

    sendLog(
      'info',
      'analysis',
      `Starting analysis: model=${request.model}, confidence=${request.min_confidence}, source=${request.source_path}`,
    );

    // Load settings to get execution provider
    const settings = await settingsStore.get();

    // Stopped during setup: leave nothing in the catalog. Nothing below awaits
    // until the session is attached to the runner, which honours a Stop from
    // then on, including one while birda is being located.
    if (session.cancelRequested) {
      sendLog('info', 'analysis', 'Analysis cancelled before it started');
      return { runId: null, status: 'cancelled', discardedPartial: false };
    }

    const locationId = resolveLocation(request);
    const run = createRun(
      request.source_path,
      request.model,
      request.min_confidence,
      locationId,
      undefined,
      request.timezone_offset_min,
    );
    session.runId = run.id;
    sendLog('info', 'analysis', `Created analysis run: id=${run.id}`);

    // Records the run's final status. session.runId goes back to null once the
    // status is recorded, so a quit after this does not record it again.
    const record = (status: FinishedRunStatus, replaceEarlier = true) => {
      const effect = finishRun(run.id, status, replaceEarlier);
      session.runId = null;
      return effect;
    };
    const recordFailedRun = () => {
      recordFailure(run.id);
      session.runId = null;
    };

    try {
      const { month, day, dayOfYear } = resolveDate(request);
      const handle = runAnalysis(request.source_path, {
        model: request.model,
        minConfidence: request.min_confidence,
        executionProvider: settings.default_execution_provider,
        latitude: request.latitude,
        longitude: request.longitude,
        month,
        day,
        dayOfYear,
        outputDir,
      });
      session.attach(handle);

      let totalDetections = 0;
      let failedFileCount = 0;
      let skippedFileCount = 0;
      // A property, not a let: TypeScript would treat a let set only in the event callback as always false.
      const pipeline = { started: false };
      const pendingImports = new Set<Promise<void>>();
      const importSemaphore = new Semaphore(MAX_CONCURRENT_IMPORTS);

      const track = (work: () => Promise<void>) => {
        const importPromise = work().catch((err: unknown) => {
          sendLog('error', 'analysis', `Event handler error: ${(err as Error).message}`);
        });
        pendingImports.add(importPromise);
        void importPromise.finally(() => pendingImports.delete(importPromise));
      };

      // Forward runner log events to renderer
      handle.on('log', (level: LogLevel, message: string) => {
        sendLog(level, 'runner', message);
      });

      // Forward NDJSON events to renderer and capture detections
      handle.on('data', (envelope: BirdaEventEnvelope) => {
        trackProgress(session, envelope);
        sendToWindows('birda:analysis-progress', envelope);
        // After a quit the run is recorded and the catalog is closing.
        if (session.quitting) return;

        // birda reports pipeline and per-file events for a single file too, so
        // both modes count files the same way. A directory run imports each
        // processed file's JSON; a single file sends its detections inline.
        if (envelope.event === 'pipeline_started') {
          pipeline.started = true;
          sendLog(
            'info',
            'analysis',
            `Starting analysis of ${(envelope.payload as PipelineStartedPayload).total_files} file(s)`,
          );
        } else if (envelope.event === 'file_started') {
          sendLog('info', 'analysis', `Processing file: ${(envelope.payload as FileStartedPayload).file}`);
        } else if (envelope.event === 'file_completed') {
          const payload = envelope.payload as FileCompletedPayload;
          if (payload.status === 'processed') {
            if (outputDir) {
              const jsonDir = outputDir;
              track(async () => {
                // Limit concurrent imports to prevent resource exhaustion
                await importSemaphore.acquire();
                try {
                  const fileMetadata = await parseFileMetadata(payload.file, run.timezone_offset_min);
                  if (session.quitting) return;
                  const audioFileId = createAudioFile(run.id, payload.file, fileMetadata);
                  const result = await importDetectionsFromJson(
                    run.id,
                    locationId,
                    audioFileId,
                    deriveJsonPath(jsonDir, payload.file),
                    () => session.quitting,
                  );
                  totalDetections += result.detections;
                  sendLog('info', 'analysis', `Imported ${result.detections} detections from ${result.sourceFile}`);
                } catch (err) {
                  sendLog('error', 'analysis', `Failed to import ${payload.file}: ${(err as Error).message}`);
                  failedFileCount++;
                } finally {
                  importSemaphore.release();
                }
              });
            }
          } else if (payload.status === 'skipped' || payload.status === 'locked') {
            // A locked file was claimed by another worker in a distributed
            // run; birda reports it as a skip, not a failure, so count it
            // as one here too rather than inflating the failed total.
            skippedFileCount++;
            const reason = payload.status === 'locked' ? 'Locked by another worker, skipped' : 'Skipped';
            sendLog('info', 'analysis', `${reason} ${payload.file}`);
          } else {
            // The remaining status is 'failed'
            failedFileCount++;
            sendLog('warn', 'analysis', `Failed to process ${payload.file}`);
          }
        } else if (envelope.event === 'detections' && !outputDir) {
          const payload = envelope.payload as DetectionsPayload;
          if (payload.detections.length > 0) {
            track(async () => {
              try {
                const fileMetadata = await parseFileMetadata(payload.file, run.timezone_offset_min);
                if (session.quitting) return;
                const audioFileId = createAudioFile(run.id, payload.file, fileMetadata);
                insertDetections(run.id, locationId, audioFileId, payload.detections);
                totalDetections += payload.detections.length;
                sendLog('info', 'analysis', `Inserted ${payload.detections.length} detection(s) from ${payload.file}`);
              } catch (err) {
                sendLog('error', 'analysis', `Failed to insert detections: ${(err as Error).message}`);
                failedFileCount++;
              }
            });
          }
        }
      });

      let runError: unknown = null;
      try {
        await handle.promise;
      } catch (err) {
        runError = err;
      }

      // Wait for all pending imports so none writes to the run after its status is set.
      // On a quit the status was set earlier; imports check session.quitting before writing.
      await Promise.allSettled(Array.from(pendingImports));

      // stopAnalysisForQuit has recorded the run and the catalog is closing.
      if (session.quitting) {
        return { runId: run.id, status: 'cancelled', discardedPartial: false };
      }

      if (runError instanceof AnalysisCancelledError) {
        const { discardedPartial } = record('cancelled');
        sendLog(
          'info',
          'analysis',
          discardedPartial
            ? `Analysis cancelled: its partial results were discarded; the earlier complete results for this source and model are kept`
            : `Analysis cancelled: ${totalDetections} detection(s) kept in run ${run.id}`,
        );
        return { runId: run.id, status: 'cancelled', discardedPartial };
      }

      if (runError !== null) {
        // Keep birda's output for debugging unless it wrote nothing.
        keepOutput = outputDir !== undefined && (await hasEntries(outputDir));
        // The runner's error already carries birda's stderr.
        const errorMsg = `Analysis failed: ${(runError as Error).message}`;
        sendLog('error', 'analysis', errorMsg);
        // A quit during the await above has already recorded the run.
        if (session.runPending) recordFailedRun();
        throw new Error(errorMsg, { cause: runError });
      }

      // Determine final status. Without a pipeline_started event (an older
      // birda) a single-file run is assumed to have processed its one file.
      const processedCount = pipeline.started
        ? session.progress.totalFiles - skippedFileCount - failedFileCount
        : isDirectory
          ? 0
          : 1;
      let finalStatus: FinishedRunStatus = 'completed';
      if (failedFileCount > 0) {
        finalStatus = processedCount > 0 ? 'completed_with_errors' : 'failed';
      }
      sendLog(
        'info',
        'analysis',
        `Analysis complete: ${processedCount} processed, ${skippedFileCount} skipped, ${failedFileCount} failed`,
      );
      if (finalStatus === 'failed') keepOutput = true;

      sendLog('info', 'analysis', `Analysis completed: ${totalDetections} total detection(s)`);
      // A run that analysed no files (all skipped, locked or failed) does not replace earlier results.
      const { replaced, discardedPartial } = record(finalStatus, processedCount > 0);
      if (replaced > 0) {
        sendLog('info', 'analysis', `Replaced ${replaced} previous run(s) (same source + model)`);
      }
      return { runId: run.id, status: finalStatus, discardedPartial };
    } catch (err) {
      // Anything that failed after the run was created, before its status was recorded.
      if (session.runPending && !session.quitting) recordFailedRun();
      throw err;
    }
  } finally {
    if (outputDir && session.quitting) {
      // stopAnalysisForQuit may have removed it already; this covers a quit during mkdtemp.
      await cleanupTempDir(outputDir);
    } else if (outputDir) {
      if (keepOutput) {
        sendLog('warn', 'analysis', `Preserving temp directory for debugging: ${outputDir}`);
      } else {
        await cleanupTempDir(outputDir);
        sendLog('info', 'analysis', `Cleaned up temp directory: ${outputDir}`);
      }
    }
  }
}

/**
 * Called before the app quits: stops a running analysis and, unless its run
 * was already recorded, records it as cancelled now, since the catalog closes
 * before birda's exit is handled. Later calls do nothing.
 */
/** Whether an analysis holds the lock, running or stopping. */
export function isAnalysisActive(): boolean {
  return analysisLock.active !== null;
}

export function stopAnalysisForQuit(): void {
  const session = analysisLock.active;
  if (!session || session.quitting) return;
  session.quitting = true;
  session.cancel();
  if (session.runId !== null) {
    try {
      finishRun(session.runId, 'cancelled');
    } catch (err) {
      console.error(`Could not record run ${session.runId} as cancelled:`, err);
    }
    session.runId = null;
  }
  if (session.outputDir) {
    try {
      fs.rmSync(session.outputDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Could not remove ${session.outputDir}:`, err);
    }
  }
}

export function registerAnalysisHandlers(): void {
  ipcMain.handle('birda:analyze', async (_event, rawRequest: unknown): Promise<AnalysisResult> => {
    const request = AnalysisRequestSchema.parse(rawRequest);
    // Taken synchronously, before the first await, so two requests cannot both start
    const session = analysisLock.acquire(request.source_path);
    let finished: (AnalysisResult & { error?: string }) | undefined;
    try {
      sendAnalysisStatus();
      const result = await analyze(session, request);
      finished = result;
      return result;
    } catch (err) {
      // A throw is reported as failed, even after a Stop; analyze has recorded
      // the run as failed unless the app is quitting. runId is null: the
      // renderer uses it only to show a completed or cancelled run.
      finished = {
        runId: null,
        status: 'failed',
        discardedPartial: false,
        error: (err as Error).message,
      };
      throw err;
    } finally {
      analysisLock.release(session);
      sendAnalysisStatus(finished);
    }
  });

  // Stop keeps the lock: it is released when the analysis has finished, so a
  // new analysis cannot start while the stopped one is still winding down.
  ipcMain.handle('birda:cancel-analysis', () => {
    const session = analysisLock.active;
    if (!session) return false;
    if (!session.cancelRequested) {
      session.cancel();
      sendAnalysisStatus();
    }
    return true;
  });

  ipcMain.handle('birda:analysis-status', () => analysisLock.status());

  ipcMain.handle(
    'birda:extract-clip',
    async (_event, detectionId: number, sourceFile: string, startTime: number, endTime: number, outputDir: string) => {
      const birdaPath = await findBirda();

      // Ensure output directory exists
      // eslint-disable-next-line security/detect-non-literal-fs-filename
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
        // Registered so killAll stops it at quit, like any birda process.
        const child = execFile(
          birdaPath,
          args,
          { maxBuffer: 10 * 1024 * 1024, timeout: 30000 },
          (err, stdout, stderr) => {
            unregisterProcess(child);
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
            try {
              updateDetectionClipPath(detectionId, clipPath);
            } catch (dbErr) {
              // The catalog can be closed if this finishes while the app quits.
              reject(dbErr instanceof Error ? dbErr : new Error(String(dbErr)));
              return;
            }
            resolve(clipPath);
          },
        );
        registerProcess(child);
      });
    },
  );

  // Renderer-supplied clip paths may only point inside the clip output directory
  // (configured or default); blocks arbitrary filesystem writes from a compromised renderer.
  async function isClipPathAllowed(normalizedClipPath: string): Promise<boolean> {
    const settings = await settingsStore.get();
    const allowedRoots = [path.resolve(settings.clip_output_dir), path.join(app.getPath('userData'), 'clips')];
    return allowedRoots.some((root) => {
      const rel = path.relative(root, normalizedClipPath);
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    });
  }

  // Spectrogram cache: save PNG next to clip
  ipcMain.handle(
    'clip:save-spectrogram',
    async (_event, clipPath: string, freqMax: number, height: number, dataUrl: string) => {
      if (!path.isAbsolute(clipPath)) throw new Error('clipPath must be absolute');
      const normalizedClipPath = path.normalize(clipPath);
      if (!(await isClipPathAllowed(normalizedClipPath))) {
        throw new Error('clipPath must be inside the clip output directory');
      }
      const dir = path.dirname(normalizedClipPath);
      const base = path.basename(normalizedClipPath, path.extname(normalizedClipPath));
      const cachePath = path.join(dir, `${base}_spec_${freqMax}_${height}.png`);
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.promises.writeFile(cachePath, Buffer.from(base64, 'base64'));
      return cachePath;
    },
  );

  // Spectrogram cache: check if cached PNG exists, return path or null
  ipcMain.handle('clip:get-spectrogram', async (_event, clipPath: string, freqMax: number, height: number) => {
    if (!path.isAbsolute(clipPath)) return null;
    const normalizedClipPath = path.normalize(clipPath);
    if (!(await isClipPathAllowed(normalizedClipPath))) return null;
    const dir = path.dirname(normalizedClipPath);
    const base = path.basename(normalizedClipPath, path.extname(normalizedClipPath));
    const cachePath = path.join(dir, `${base}_spec_${freqMax}_${height}.png`);
    try {
      await fs.promises.access(cachePath);
      return cachePath;
    } catch {
      return null;
    }
  });

  // Export audio region as WAV file
  ipcMain.handle('clip:export-region', async (event, wavBytes: Uint8Array, defaultName?: string) => {
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

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.promises.writeFile(result.filePath, wavBytes);
    return result.filePath;
  });
}
