import { shell, type Session, type WebContents } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * True when url is the app's own page: the same origin as a dev server URL, or
 * the same file as a packaged index.html (query and hash are ignored). A URL
 * that cannot be parsed is not the app; this never throws.
 */
export function isAppUrl(url: string | undefined | null, appUrl: string): boolean {
  if (!url) return false;
  const target = parse(url);
  const app = parse(appUrl);
  if (!target || !app) return false;

  if (app.protocol === 'file:') {
    if (target.protocol !== 'file:') return false;
    try {
      return path.relative(fileURLToPath(app), fileURLToPath(target)) === '';
    } catch {
      return false;
    }
  }
  if (app.protocol !== 'http:' && app.protocol !== 'https:') return false;
  return (target.protocol === 'http:' || target.protocol === 'https:') && target.origin === app.origin;
}

/** Links that leave the app open in the system browser only when they are https. */
export function isAllowedExternalUrl(url: string): boolean {
  return parse(url)?.protocol === 'https:';
}

/** The app only needs to write sanitized text to the clipboard, and only from its own page. */
export function isPermissionAllowed(
  permission: string,
  requestingUrl: string | undefined | null,
  appUrl: string,
): boolean {
  return permission === 'clipboard-sanitized-write' && isAppUrl(requestingUrl, appUrl);
}

function openExternally(url: string): void {
  if (isAllowedExternalUrl(url)) void shell.openExternal(url);
}

/**
 * Keeps a window on the app's page: new windows are never opened (https links
 * go to the system browser instead), navigation away from the app is blocked
 * the same way, and webviews cannot be attached.
 */
export function hardenWebContents(contents: WebContents, appUrl: string): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, appUrl)) return;
    event.preventDefault();
    openExternally(url);
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

/** The URL asking for a permission: the one Electron reports, else the page's own; an empty one falls through. */
function requestingUrlOf(webContents: WebContents | null, details: { requestingUrl?: string }): string | undefined {
  if (details.requestingUrl) return details.requestingUrl;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty URL must fall through
  return webContents?.getURL() || undefined;
}

/** Denies every permission except the clipboard write from the app's own page. */
export function applyPermissionPolicy(ses: Session, appUrl: string): void {
  ses.setPermissionCheckHandler((webContents, permission, _origin, details) =>
    isPermissionAllowed(permission, requestingUrlOf(webContents, details), appUrl),
  );
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isPermissionAllowed(permission, requestingUrlOf(webContents, details), appUrl));
  });
}
