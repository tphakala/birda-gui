import { ipcMain, BrowserWindow, dialog } from 'electron';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { runAnalysis, findBirda, type AnalysisHandle, type LogLevel } from '../birda/runner';
import { createRun, updateRunStatus, findCompletedRuns, deleteRun } from '../db/runs';
import { createLocation, findLocationByCoords } from '../db/locations';
import { insertDetections, updateDetectionClipPath } from '../db/detections';
import type { AnalysisRequest } from '$shared/types';
import type { BirdaEventEnvelope, DetectionsPayload } from '../birda/types';

let currentAnalysis: AnalysisHandle | null = null;

function sendLog(win: BrowserWindow, level: LogLevel, source: string, message: string): void {
  if (!win.isDestroyed()) {
    win.webContents.send('app:log', { level, source, message });
  }
}

export function registerAnalysisHandlers(): void {
  ipcMain.handle('birda:analyze', async (event, request: AnalysisRequest) => {
    if (currentAnalysis) {
      throw new Error('An analysis is already running. Cancel it first.');
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window found');

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
        sendLog(win, 'info', 'analysis', `Created location: id=${loc.id} (${request.latitude}, ${request.longitude})`);
      }
    }

    // Delete any previous completed runs for the same source+model to avoid duplicates
    const existingRuns = findCompletedRuns(request.source_path, request.model);
    for (const existing of existingRuns) {
      sendLog(win, 'info', 'analysis', `Replacing existing run ${existing.id} (same source + model)`);
      deleteRun(existing.id);
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
      const d = new Date(2024, month - 1, day); // leap year to handle Feb 29
      const start = new Date(2024, 0, 0);
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
    });
    currentAnalysis = handle;

    let totalDetections = 0;

    // Forward runner log events to renderer
    handle.on('log', (level: LogLevel, message: string) => {
      sendLog(win, level, 'runner', message);
    });

    // Forward NDJSON events to renderer and capture detections
    handle.on('data', (envelope: BirdaEventEnvelope) => {
      if (!win.isDestroyed()) {
        win.webContents.send('birda:analysis-progress', envelope);
      }

      // Insert detections from the stream as they arrive
      if (envelope.event === 'detections') {
        const payload = envelope.payload as DetectionsPayload;
        if (payload.detections.length > 0) {
          try {
            insertDetections(run.id, locationId, payload.file, payload.detections);
            totalDetections += payload.detections.length;
            sendLog(win, 'info', 'analysis', `Inserted ${payload.detections.length} detection(s) from ${payload.file}`);
          } catch (err) {
            sendLog(win, 'error', 'analysis', `Failed to insert detections: ${(err as Error).message}`);
          }
        }
      }
    });

    try {
      await handle.promise;

      sendLog(win, 'info', 'analysis', `Analysis completed: ${totalDetections} total detection(s)`);
      updateRunStatus(run.id, 'completed');
      return { runId: run.id, status: 'completed' };
    } catch (err) {
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
