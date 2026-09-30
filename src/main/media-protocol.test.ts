/* eslint-disable security/detect-non-literal-fs-filename -- tests work on temp paths they create */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBirdaMediaUrl } from '$shared/media-url';

const h = vi.hoisted(() => ({
  userData: '',
  clipDir: '',
  sources: [] as string[],
  sourcesThrow: false,
  fetched: [] as string[],
}));

vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  protocol: { handle: vi.fn() },
  net: {
    fetch: vi.fn((url: string) => {
      h.fetched.push(url);
      return Promise.resolve(new Response('audio-bytes', { status: 200, headers: { 'content-type': 'audio/wav' } }));
    }),
  },
}));
vi.mock('./settings/store', () => ({
  settingsStore: { get: () => Promise.resolve({ clip_output_dir: h.clipDir }) },
}));
vi.mock('./db/runs', () => ({
  getAnalysisSourcePaths: () => {
    if (h.sourcesThrow) throw new Error('catalog closed');
    return h.sources;
  },
}));
vi.mock('./birda/coverageCache', () => ({ getCoveragePath: vi.fn() }));

const { handleBirdaMediaRequest } = await import('./media-protocol');

let root = '';

function touch(rel: string): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  return file;
}

function request(filePath: string): Promise<Response> {
  return handleBirdaMediaRequest({ url: toBirdaMediaUrl(filePath) });
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'birda-media-')));
  h.userData = path.join(root, 'userData');
  h.clipDir = path.join(root, 'clips');
  h.sources = [];
  h.sourcesThrow = false;
  h.fetched = [];
  fs.mkdirSync(h.clipDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('handleBirdaMediaRequest', () => {
  it('serves a clip whose name has # and ?, fetching the file that was checked', async () => {
    const clip = touch('clips/a #1 ?x.wav');
    const access = vi.spyOn(fs.promises, 'access');

    const res = await request(clip);

    expect(res.status).toBe(200);
    expect(h.fetched).toHaveLength(1);
    expect(fileURLToPath(h.fetched[0])).toBe(clip);
    expect(access.mock.calls[0][0]).toBe(fileURLToPath(h.fetched[0]));
    access.mockRestore();
  });

  it('serves audio inside an analysed folder and the analysed file itself', async () => {
    const audio = touch('rec/site/a.wav');
    h.sources = [path.join(root, 'rec')];
    expect((await request(audio)).status).toBe(200);

    h.sources = [audio];
    expect((await request(audio)).status).toBe(200);
  });

  it('refuses a file outside the clip folders and analysed sources', async () => {
    const other = touch('private/secret.wav');
    h.sources = [path.join(root, 'rec')];
    expect((await request(other)).status).toBe(403);
    expect(h.fetched).toEqual([]);
  });

  it('refuses everything when the catalog cannot list its sources', async () => {
    const audio = touch('rec/a.wav');
    h.sourcesThrow = true;
    expect((await request(audio)).status).toBe(403);
  });

  it('refuses a path that climbs out of an allowed folder with encoded dots', async () => {
    touch('private/secret.wav');
    const url = `birda-media://${encodeURI(h.clipDir)}/%2e%2e/private/secret.wav`;
    const res = await handleBirdaMediaRequest({ url });
    expect(res.status).toBe(403);
    const encodedSlash = `birda-media://${encodeURI(h.clipDir)}/..%2Fprivate%2Fsecret.wav`;
    expect((await handleBirdaMediaRequest({ url: encodedSlash })).status).toBe(403);
  });

  it('refuses a disallowed extension even inside a clip folder', async () => {
    expect((await request(touch('clips/notes.txt'))).status).toBe(403);
  });

  it('refuses the analysed folder itself, which has no media extension', async () => {
    h.sources = [path.join(root, 'rec')];
    expect((await request(path.join(root, 'rec'))).status).toBe(403);
  });

  it('answers 404 for a missing file in an allowed folder', async () => {
    expect((await request(path.join(h.clipDir, 'gone.wav'))).status).toBe(404);
  });

  it('answers 400 for a malformed URL path', async () => {
    expect((await handleBirdaMediaRequest({ url: 'birda-media:///%E0%A4%A.wav' })).status).toBe(400);
  });

  it('sets the CORS allow-origin header on served files', async () => {
    const res = await request(touch('clips/a.wav'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
