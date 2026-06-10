/**
 * Build a birda-media:// URL from a native file path.
 * Windows paths like D:\clips\file.wav become birda-media:///D:/clips/file.wav.
 */
export function toBirdaMediaUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const withLeadingSlash = normalized.startsWith('/') ? normalized : '/' + normalized;
  // Percent-encode each segment so #, ?, % and unicode in file names survive URL
  // parsing; the main-process handler decodes the pathname before serving.
  const encoded = withLeadingSlash.split('/').map(encodeURIComponent).join('/');
  return `birda-media://${encoded}`;
}
