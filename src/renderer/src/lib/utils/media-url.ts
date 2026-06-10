/**
 * Build a birda-media:// URL from a native file path.
 * Windows paths like D:\clips\file.wav become birda-media:///D:/clips/file.wav.
 */
export function toBirdaMediaUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const urlPath = normalized.startsWith('/') ? normalized : '/' + normalized;
  return `birda-media://${urlPath}`;
}
