import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import type { AudioFileInfo, AudioMothMeta, SourceScanResult } from '$shared/types';

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a']);

function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Parse a timezone suffix like "+3", "-5", "+5:30" into minutes offset from UTC. */
function parseTimezoneOffset(tz: string | undefined): number {
  if (!tz) return 0; // bare "(UTC)" → offset 0
  const m = /^([+-])(\d{1,2})(?::(\d{2}))?$/.exec(tz);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  const hours = parseInt(m[2], 10);
  const minutes = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + minutes);
}

/** Format a minutes offset as an ISO 8601 timezone suffix (e.g. "Z", "+03:00", "-05:30"). */
function formatIsoOffset(offsetMin: number): string {
  if (offsetMin === 0) return 'Z';
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

/**
 * Parse AudioMoth metadata from comment and artist tags.
 * Comment format: "Recorded at HH:MM:SS DD/MM/YYYY (UTC) by AudioMoth XXXX at GAIN gain
 * while battery was greater than X.XV and temperature was X.XC. ..."
 * Supports timezone variants: (UTC), (UTC+1), (UTC-5), (UTC+5:30), etc.
 */
function parseAudioMothComment(comment: string | undefined, artist: string | undefined): AudioMothMeta | null {
  // Check if it's an AudioMoth recording (from artist or comment)
  const deviceFromArtist = artist ? /AudioMoth\s+([A-Fa-f0-9]+)/.exec(artist)?.[1] : undefined;
  const deviceFromComment = comment ? /by AudioMoth\s+([A-Fa-f0-9]+)/.exec(comment)?.[1] : undefined;
  const deviceId = deviceFromArtist ?? deviceFromComment;
  if (!deviceId) return null;

  let gain = 'unknown';
  let batteryV: number | null = null;
  let temperatureC: number | null = null;
  let recordedAt: string | null = null;
  let timezoneOffsetMin: number | null = null;

  if (comment) {
    // "Recorded at 11:38:05 01/01/2025 (UTC)" or "(UTC+3)" or "(UTC-5:30)"
    const timeMatch = /Recorded at (\d{2}:\d{2}:\d{2}) (\d{2})\/(\d{2})\/(\d{4}) \(UTC([+-]\d{1,2}(?::\d{2})?)?\)/.exec(
      comment,
    );
    if (timeMatch) {
      const [, time, dd, mm, yyyy, tz] = timeMatch;
      timezoneOffsetMin = parseTimezoneOffset(tz);
      recordedAt = `${yyyy}-${mm}-${dd}T${time}${formatIsoOffset(timezoneOffsetMin)}`;
    }

    // "at medium-high gain" or "at low gain"
    const gainMatch = /at ([\w-]+) gain/.exec(comment);
    if (gainMatch) gain = gainMatch[1];

    // "battery was greater than 4.9V" or "battery was 4.9V"
    const batteryMatch = /battery was (?:greater than |less than )?([\d.]+)V/.exec(comment);
    if (batteryMatch) batteryV = parseFloat(batteryMatch[1]);

    // "temperature was 16.1C" or "temperature was -0.7C"
    const tempMatch = /temperature was (-?[\d.]+)C/.exec(comment);
    if (tempMatch) temperatureC = parseFloat(tempMatch[1]);
  }

  return { deviceId, gain, batteryV, temperatureC, recordedAt, timezoneOffsetMin };
}

interface AudioMeta {
  durationSec: number | null;
  sampleRate: number | null;
  channels: number | null;
  audiomoth: AudioMothMeta | null;
}

async function getAudioMetadata(filePath: string): Promise<AudioMeta> {
  try {
    const { parseFile } = await import('music-metadata');
    const metadata = await parseFile(filePath, { duration: true, skipCovers: true });

    // Extract comment — music-metadata stores it in common.comment as an array
    const commentArr = metadata.common.comment;
    const comment = Array.isArray(commentArr) ? (commentArr[0]?.text ?? commentArr[0]) : undefined;
    const artist = metadata.common.artist ?? metadata.common.albumartist;

    return {
      durationSec: metadata.format.duration ?? null,
      sampleRate: metadata.format.sampleRate ?? null,
      channels: metadata.format.numberOfChannels ?? null,
      audiomoth: parseAudioMothComment(comment as string | undefined, artist),
    };
  } catch {
    return { durationSec: null, sampleRate: null, channels: null, audiomoth: null };
  }
}

export function registerFileHandlers(): void {
  ipcMain.handle('fs:scan-source', async (_event, sourcePath: string): Promise<SourceScanResult> => {
    const stat = await fs.promises.stat(sourcePath);
    const isFolder = stat.isDirectory();

    let filePaths: string[];
    if (isFolder) {
      const entries = await fs.promises.readdir(sourcePath, { withFileTypes: true });
      filePaths = entries
        .filter((e) => e.isFile() && isAudioFile(e.name))
        .map((e) => path.join(sourcePath, e.name))
        .sort();
    } else {
      filePaths = [sourcePath];
    }

    const CONCURRENCY = 4;
    const files: AudioFileInfo[] = [];
    for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
      const batch = filePaths.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (fp) => {
          const [fileStat, meta] = await Promise.all([fs.promises.stat(fp), getAudioMetadata(fp)]);
          return {
            path: fp,
            name: path.basename(fp),
            size: fileStat.size,
            durationSec: meta.durationSec,
            sampleRate: meta.sampleRate,
            channels: meta.channels,
            format: path.extname(fp).slice(1).toLowerCase(),
            audiomoth: meta.audiomoth,
          } satisfies AudioFileInfo;
        }),
      );
      files.push(...results);
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const totalDuration = files.reduce((sum, f) => sum + (f.durationSec ?? 0), 0);

    return { isFolder, files, totalSize, totalDuration };
  });
}
