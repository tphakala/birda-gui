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
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Parse recording start time from AudioMoth-style filenames: YYYYMMDD_HHMMSS
 * Returns null if the filename doesn't match the pattern.
 */
export function parseRecordingStart(filename: string): Date | null {
  // Strip path and extension, match YYYYMMDD_HHMMSS
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const match = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(base);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  // Validate the parsed date components match (catches invalid months/days)
  if (date.getFullYear() !== +y || date.getMonth() !== +mo - 1 || date.getDate() !== +d) return null;
  return date;
}

/**
 * Compute actual wall-clock time by adding offset seconds to recording start.
 * Handles day boundary crossover via Date arithmetic.
 */
export function formatClockTime(startTime: Date, offsetSeconds: number): string {
  const actual = new Date(startTime.getTime() + offsetSeconds * 1000);
  const h = actual.getHours().toString().padStart(2, '0');
  const m = actual.getMinutes().toString().padStart(2, '0');
  const s = actual.getSeconds().toString().padStart(2, '0');
  // Show date prefix if it rolled past the start date
  if (actual.toDateString() !== startTime.toDateString()) {
    const mo = (actual.getMonth() + 1).toString().padStart(2, '0');
    const d = actual.getDate().toString().padStart(2, '0');
    return `${mo}-${d} ${h}:${m}:${s}`;
  }
  return `${h}:${m}:${s}`;
}

/**
 * Format detection date from recording_start + offset
 * Returns: "01-15" (MM-DD) or "--" if no timestamp
 */
export function formatDetectionDate(detection: {
  audio_file: { recording_start: string | null };
  start_time: number;
}): string {
  if (!detection.audio_file.recording_start) return '--';

  const recordingStart = new Date(detection.audio_file.recording_start);
  const actualTime = new Date(recordingStart.getTime() + detection.start_time * 1000);

  const month = (actualTime.getMonth() + 1).toString().padStart(2, '0');
  const day = actualTime.getDate().toString().padStart(2, '0');
  return `${month}-${day}`;
}

/**
 * Format detection time from recording_start + offset
 * Returns: "14:30:22" (HH:MM:SS) or "--" if no timestamp
 */
export function formatDetectionTime(detection: {
  audio_file: { recording_start: string | null };
  start_time: number;
}): string {
  if (!detection.audio_file.recording_start) return '--';

  const recordingStart = new Date(detection.audio_file.recording_start);
  const actualTime = new Date(recordingStart.getTime() + detection.start_time * 1000);

  const h = actualTime.getHours().toString().padStart(2, '0');
  const m = actualTime.getMinutes().toString().padStart(2, '0');
  const s = actualTime.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}
