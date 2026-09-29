/**
 * birda-media:// URLs for local audio and image files.
 *
 * toBirdaMediaUrl runs in the renderer, mediaUrlToPath in the main-process
 * protocol handler. They live together so the round trip stays consistent.
 */

/**
 * Build a birda-media:// URL from a native file path.
 * Windows paths like D:\clips\file.wav become birda-media:///D%3A/clips/file.wav.
 * A path that already starts with / is POSIX, so its backslashes stay part of the
 * file name.
 */
export function toBirdaMediaUrl(filePath: string): string {
  const normalized = filePath.startsWith('/') ? filePath : filePath.replace(/\\/g, '/');
  const withLeadingSlash = normalized.startsWith('/') ? normalized : '/' + normalized;
  // Percent-encode each segment so #, ?, % and unicode in file names survive URL
  // parsing; mediaUrlToPath decodes the pathname again.
  const encoded = withLeadingSlash.split('/').map(encodeURIComponent).join('/');
  return `birda-media://${encoded}`;
}

/**
 * Recover the file path from a birda-media:// URL. Paths come back with forward
 * slashes; on Windows the leading slash before a drive letter is dropped
 * (/D:/clips/x.wav -> D:/clips/x.wav).
 */
export function mediaUrlToPath(url: string, platform: string): string {
  let filePath = decodeURIComponent(new URL(url).pathname);
  if (platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1);
  }
  return filePath;
}
