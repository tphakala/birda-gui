/** Current spectrogram viewport parameters used to map data coordinates to pixels. */
export interface SpectrogramViewport {
  /** Horizontal scale: pixels per second of audio. */
  pxPerSecond: number;
  /** Horizontal scroll offset in pixels (left edge of the visible area). */
  scrollLeft: number;
  /** Top of the spectrogram frequency axis, in Hz. */
  freqMax: number;
  /** Spectrogram pixel height. */
  height: number;
}

export interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function timeToX(time: number, vp: SpectrogramViewport): number {
  return time * vp.pxPerSecond - vp.scrollLeft;
}

export function xToTime(x: number, vp: SpectrogramViewport): number {
  return (x + vp.scrollLeft) / vp.pxPerSecond;
}

/** 0 Hz is at the bottom (y = height); freqMax is at the top (y = 0). */
function freqToY(freqHz: number, vp: SpectrogramViewport): number {
  const clamped = Math.max(0, Math.min(freqHz, vp.freqMax));
  return vp.height * (1 - clamped / vp.freqMax);
}

export function yToFreq(y: number, vp: SpectrogramViewport): number {
  const clampedY = Math.max(0, Math.min(y, vp.height));
  return (1 - clampedY / vp.height) * vp.freqMax;
}

interface AnnotationBounds {
  start_time: number;
  end_time: number;
  low_freq_hz: number | null;
  high_freq_hz: number | null;
}

/** Map an annotation's bounds to a pixel rectangle. Time-only boxes span the full height. */
export function annotationToRect(a: AnnotationBounds, vp: SpectrogramViewport): BoxRect {
  const left = timeToX(a.start_time, vp);
  const width = Math.max(1, (a.end_time - a.start_time) * vp.pxPerSecond);
  const isTimeOnly = a.low_freq_hz === null && a.high_freq_hz === null;
  if (isTimeOnly) {
    return { left, top: 0, width, height: vp.height };
  }
  const high = a.high_freq_hz ?? vp.freqMax;
  const low = a.low_freq_hz ?? 0;
  const top = freqToY(high, vp);
  const bottom = freqToY(low, vp);
  return { left, top, width, height: Math.max(1, bottom - top) };
}
