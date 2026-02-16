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
  // Database values may be full ISO datetimes (e.g. "2026-02-16T10:37:23Z");
  // parseLocalDate only handles "YYYY-MM-DD", so use the Date constructor for
  // anything longer than a plain date string.
  const d = dateStr.length === 10 ? parseLocalDate(dateStr) : new Date(dateStr);
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
 * Format detection date from recording_start + offset
 * Returns: "01-15" (MM-DD) for current year, "25-01-15" (YY-MM-DD) for other years, or "--" if no timestamp
 */
export function formatDetectionDate(detection: {
  audio_file: { recording_start: string | null };
  start_time: number;
}): string {
  if (!detection.audio_file.recording_start) return '--';

  const recordingStart = new Date(detection.audio_file.recording_start);
  const actualTime = new Date(recordingStart.getTime() + detection.start_time * 1000);
  const now = new Date();

  const month = (actualTime.getMonth() + 1).toString().padStart(2, '0');
  const day = actualTime.getDate().toString().padStart(2, '0');

  // Include year if different from current year
  if (actualTime.getFullYear() !== now.getFullYear()) {
    const year = actualTime.getFullYear().toString().slice(-2);
    return `${year}-${month}-${day}`;
  }

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
