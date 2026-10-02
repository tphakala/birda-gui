import { parseRecordingName } from '$shared/recording-name';
import { parseStoredInstant, wallClockAt, type ClockZone, type Wall } from '$shared/time-zone';
export function formatDuration(seconds: number | null): string {
  if (seconds === null || isNaN(seconds)) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatConfidence(confidence: number): string {
  return `${(confidence * 100).toFixed(1)}%`;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '--';
  // Database values may be full ISO datetimes (e.g. "2026-02-16T10:37:23Z");
  // parseLocalDate only handles "YYYY-MM-DD", so use the Date constructor for
  // anything longer than a plain date string.
  const d = dateStr.length === 10 ? parseLocalDate(dateStr) : new Date(dateStr);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Parse YYYY-MM-DD as local date (avoids UTC midnight shift from new Date()). */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Local recording start from an AudioMoth-style name, YYYYMMDD_HHMMSS, or null.
 * By default this is the rule the main process applies to a source, so the date shown is the one birda gets.
 * With allowSuffix a name such as 20240501_053000_A also counts, the rule the
 * per-file recording start and the detection hours use; birda is not given that date for the source.
 */
export function parseRecordingStart(filename: string, options: { allowSuffix?: boolean } = {}): Date | null {
  const parsed = parseRecordingName(filename, options);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute, parsed.second);
}

/** The detection's wall clock in a zone: recording start plus its offset into the file, or null without a start. */
function detectionWall(
  detection: { audio_file: { recording_start: string | null } | null; start_time: number },
  zone: ClockZone,
): Wall | null {
  const start = parseStoredInstant(detection.audio_file?.recording_start ?? null);
  if (start === null) return null;
  return wallClockAt(start + detection.start_time * 1000, zone);
}

const two = (n: number): string => n.toString().padStart(2, '0');

/**
 * Format detection date from recording_start + offset, in the run's zone
 * Returns: "01-15" (MM-DD) for the current year on the zone's clock, "25-01-15" (YY-MM-DD) for other years, or "--" if no timestamp
 */
export function formatDetectionDate(
  detection: { audio_file: { recording_start: string | null } | null; start_time: number },
  zone: ClockZone,
): string {
  const wall = detectionWall(detection, zone);
  if (!wall) return '--';
  // Include the year when it differs from the current year on the same clock
  if (wall.year !== wallClockAt(Date.now(), zone).year) {
    return `${two(wall.year % 100)}-${two(wall.month)}-${two(wall.day)}`;
  }
  return `${two(wall.month)}-${two(wall.day)}`;
}

/**
 * Format detection time from recording_start + offset, in the run's zone
 * Returns: "14:30:22" (HH:MM:SS) or "--" if no timestamp
 */
export function formatDetectionTime(
  detection: { audio_file: { recording_start: string | null } | null; start_time: number },
  zone: ClockZone,
): string {
  const wall = detectionWall(detection, zone);
  if (!wall) return '--';
  return `${two(wall.hour)}:${two(wall.minute)}:${two(wall.second)}`;
}
