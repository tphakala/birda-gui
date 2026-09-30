import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openExternal = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('electron', () => ({ shell: { openExternal } }));

const { applyPermissionPolicy, hardenWebContents, isAllowedExternalUrl, isAppUrl, isPermissionAllowed } =
  await import('./window-security');

const DEV = 'http://localhost:5173/';
const FILE = 'file:///opt/Birda%20GUI/resources/app.asar/out/renderer/index.html';

beforeEach(() => {
  openExternal.mockClear();
});

describe('isAppUrl', () => {
  it('matches the dev server by origin', () => {
    expect(isAppUrl('http://localhost:5173/', DEV)).toBe(true);
    expect(isAppUrl('http://localhost:5173/#/map?x=1', DEV)).toBe(true);
    expect(isAppUrl('http://localhost:5174/', DEV)).toBe(false);
    expect(isAppUrl('https://localhost:5173/', DEV)).toBe(false);
    expect(isAppUrl('http://evil.example/', DEV)).toBe(false);
    expect(isAppUrl('file:///etc/passwd', DEV)).toBe(false);
  });

  it('matches the packaged page by file, ignoring query and hash', () => {
    expect(isAppUrl(FILE, FILE)).toBe(true);
    expect(isAppUrl(FILE + '#/detections', FILE)).toBe(true);
    expect(isAppUrl(FILE + '?a=1', FILE)).toBe(true);
    expect(isAppUrl('file:///opt/Birda%20GUI/resources/app.asar/out/renderer/other.html', FILE)).toBe(false);
    expect(isAppUrl('file:///etc/passwd', FILE)).toBe(false);
    expect(isAppUrl('https://example.com/', FILE)).toBe(false);
  });

  it('is false for empty or unparseable input and never throws', () => {
    expect(isAppUrl('', FILE)).toBe(false);
    expect(isAppUrl(undefined, FILE)).toBe(false);
    expect(isAppUrl('not a url', FILE)).toBe(false);
    expect(isAppUrl(FILE, 'not a url')).toBe(false);
    expect(isAppUrl('file://remote-host/share/index.html', FILE)).toBe(false);
  });
});

describe('isAllowedExternalUrl', () => {
  it('allows https only', () => {
    expect(isAllowedExternalUrl('https://github.com/tphakala/birda-gui')).toBe(true);
    expect(isAllowedExternalUrl('http://example.com')).toBe(false);
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('ms-msdt:something')).toBe(false);
    expect(isAllowedExternalUrl('nonsense')).toBe(false);
  });
});

describe('isPermissionAllowed', () => {
  it('allows the clipboard write from the app only', () => {
    expect(isPermissionAllowed('clipboard-sanitized-write', FILE, FILE)).toBe(true);
    expect(isPermissionAllowed('clipboard-sanitized-write', 'https://example.com/', FILE)).toBe(false);
    expect(isPermissionAllowed('clipboard-sanitized-write', undefined, FILE)).toBe(false);
  });

  it.each(['clipboard-read', 'media', 'geolocation', 'fileSystem', 'fullscreen', 'notifications', 'openExternal'])(
    'denies %s even from the app',
    (permission) => {
      expect(isPermissionAllowed(permission, FILE, FILE)).toBe(false);
    },
  );
});

describe('applyPermissionPolicy', () => {
  function install() {
    let check: (...args: unknown[]) => boolean = () => true;
    let request: (...args: unknown[]) => void = () => undefined;
    applyPermissionPolicy(
      {
        setPermissionCheckHandler: (h: typeof check) => (check = h),
        setPermissionRequestHandler: (h: typeof request) => (request = h),
      } as never,
      FILE,
    );
    return { check, request };
  }

  it('checks the requesting URL, falling back to the web contents URL, and denies a null web contents', () => {
    const { check } = install();
    const wc = { getURL: () => FILE };
    expect(check(wc, 'clipboard-sanitized-write', FILE, { requestingUrl: FILE })).toBe(true);
    expect(check(wc, 'clipboard-sanitized-write', FILE, {})).toBe(true);
    expect(check(null, 'clipboard-sanitized-write', FILE, {})).toBe(false);
    expect(check(wc, 'clipboard-sanitized-write', FILE, { requestingUrl: 'https://example.com/' })).toBe(false);
    expect(check(wc, 'media', FILE, { requestingUrl: FILE })).toBe(false);
  });

  it('answers permission requests through the callback', () => {
    const { request } = install();
    const wc = { getURL: () => 'https://example.com/' };
    const allowed = vi.fn();
    const denied = vi.fn();
    request({ getURL: () => FILE }, 'clipboard-sanitized-write', allowed, { requestingUrl: FILE });
    request(wc, 'clipboard-sanitized-write', denied, {});
    expect(allowed).toHaveBeenCalledWith(true);
    expect(denied).toHaveBeenCalledWith(false);
  });
});

describe('hardenWebContents', () => {
  function fakeContents() {
    const emitter = new EventEmitter();
    let openHandler: (details: { url: string }) => { action: string } = () => ({ action: 'allow' });
    const contents = Object.assign(emitter, {
      setWindowOpenHandler: (h: typeof openHandler) => {
        openHandler = h;
      },
    });
    hardenWebContents(contents as never, DEV);
    return { contents, open: (url: string) => openHandler({ url }) };
  }

  function navigate(contents: EventEmitter, event: string, url?: string) {
    const preventDefault = vi.fn();
    contents.emit(event, { preventDefault }, url);
    return preventDefault;
  }

  it('denies every window.open and sends https links to the browser', () => {
    const { open } = fakeContents();
    expect(open('https://example.com/x')).toEqual({ action: 'deny' });
    expect(open('http://example.com/x')).toEqual({ action: 'deny' });
    expect(open('file:///etc/passwd')).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/x');
  });

  it('blocks navigation away from the app and opens only https externally', () => {
    const { contents } = fakeContents();
    expect(navigate(contents, 'will-navigate', 'https://example.com/')).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('https://example.com/');
    openExternal.mockClear();
    expect(navigate(contents, 'will-navigate', 'file:///etc/passwd')).toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('lets the app navigate within itself', () => {
    const { contents } = fakeContents();
    expect(navigate(contents, 'will-navigate', 'http://localhost:5173/#/map')).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('blocks attaching a webview', () => {
    const { contents } = fakeContents();
    expect(navigate(contents, 'will-attach-webview')).toHaveBeenCalled();
  });
});
