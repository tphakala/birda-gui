import { app, net, protocol } from 'electron';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { mediaUrlToPath } from '$shared/media-url';
import { getCoveragePath } from './birda/coverageCache';
import { getAnalysisSourcePaths } from './db/runs';
import { clipRoots, isInside } from './media-access';
import { AUDIO_EXTENSIONS } from './ipc/files';
import { settingsStore } from './settings/store';

const ALLOWED_EXTS = new Set([...AUDIO_EXTENSIONS, '.png']);

/** Serves a local file, with extraHeaders set over the headers of the file response. */
async function serveFile(file: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  // pathToFileURL encodes special characters (#, ?) that manual file:/// string
  // building would misparse as a fragment/query.
  const response = await net.fetch(pathToFileURL(file).href);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  // With corsEnabled the renderer's cross-origin fetch performs a CORS check;
  // the response must carry an explicit allow-origin header.
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(response.body, { status: response.status, headers });
}

/**
 * True when resolved is inside a clip folder, or is (or is inside) a source the
 * catalog analysed. A catalog that cannot be read allows nothing.
 */
async function isMediaPathAllowed(resolved: string): Promise<boolean> {
  const settings = await settingsStore.get();
  if (clipRoots(settings, app.getPath('userData')).some((root) => isInside(root, resolved, { allowEqual: false }))) {
    return true;
  }
  try {
    return getAnalysisSourcePaths().some(
      (source) => path.isAbsolute(source) && isInside(path.resolve(source), resolved, { allowEqual: true }),
    );
  } catch {
    return false;
  }
}

/**
 * Serves birda-media:///D%3A/clips/file.wav from the local file, but only for
 * audio and image files in a clip folder or in something the app analysed.
 */
export async function handleBirdaMediaRequest(request: { url: string }): Promise<Response> {
  let resolved: string;
  try {
    // The same resolved path is checked, opened and fetched, so a path that is
    // allowed cannot differ from the file that is served.
    resolved = path.resolve(mediaUrlToPath(request.url, process.platform));
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  if (!ALLOWED_EXTS.has(path.extname(resolved).toLowerCase())) {
    return new Response('Forbidden', { status: 403 });
  }
  if (!(await isMediaPathAllowed(resolved))) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    await fs.promises.access(resolved, fs.constants.R_OK);
  } catch {
    return new Response('Not Found', { status: 404 });
  }

  return serveFile(resolved);
}

export function registerBirdaMediaProtocol(): void {
  protocol.handle('birda-media', handleBirdaMediaRequest);
}

export function registerBirdaMapProtocol(): void {
  protocol.handle('birda-map', async (request) => {
    // birda-map://<family>/<region> -> the cached region coverage map (SVG).
    // The URL comes from the renderer, but only family/region pairs that birda
    // reported a coverage_url for are fetchable (see coverageCache), so this
    // never fetches an arbitrary URL.
    const url = new URL(request.url);
    const family = url.hostname;
    const region = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!family || !region) {
      return new Response('Not Found', { status: 404 });
    }
    const file = await getCoveragePath(family, region);
    if (!file) {
      return new Response('Not Found', { status: 404 });
    }
    return serveFile(file, { 'content-type': 'image/svg+xml' });
  });
}
