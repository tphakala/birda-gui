# Spectrogram Annotation Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clean-room, SignaVis-inspired whole-file spectrogram annotation editor that overlays birda's detections as time/frequency boxes the user can accept, reject, edit, draw, and delete, persisting curated annotations separately from immutable detections.

**Architecture:** A new `annotations` table (immutable `detections` stay untouched), lazy materialization (rows written only on user action), a new IPC domain (`annotations:*`) following the existing handler/preload/wrapper conventions, and a full-window Svelte 5 modal editor built on the project's existing wavesurfer.js v7 + spectrogram stack with a custom absolutely-positioned box overlay (boxes positioned by computation, `box.left = time * pxPerSec - scrollLeft`, so the overlay never needs to be injected into wavesurfer's container).

**Tech Stack:** Electron, Svelte 5 runes, TypeScript (strict, exactOptionalPropertyTypes), better-sqlite3, wavesurfer.js v7 (waveform + spectrogram plugins), Tailwind v4 + daisyUI v5, Paraglide i18n.

**Source spec:** `docs/superpowers/specs/2026-06-10-spectrogram-annotation-editor-design.md`

**Testing note:** This project has no unit-test framework by convention (CLAUDE.md, spec testing section). Per-task verification uses the project's real gates: `task typecheck:main` (main process), `task lint` (ESLint + svelte-check + tsc), `task build`, and explicit manual checks via `task dev`. Do not introduce a test framework.

**Deviation from spec:** The spec says keyboard shortcuts are "wired through `shortcuts.ts`". That helper only bridges Electron menu IPC events, not keyboard input, so the editor instead attaches its own `svelte:window` `keydown` handler scoped to when the editor is open (Task 9). Behavior matches the spec; only the mechanism differs.

**Dependencies:** No new dependencies are required. Verified against the installed `wavesurfer.js` 7.12.6: `getScroll()`, `setScroll`, `zoom()`, and the spectrogram plugin are all present, so Task 9 needs no version change (the `getScroll()` fallback in Task 9 Step 4 is a safety net only). If, during execution, a task genuinely needs a dependency change, updating within the existing semver ranges (for example bumping `wavesurfer.js` to the latest 7.x) is pre-approved by the user; introducing a brand-new dependency should still be flagged first.

---

## File structure

Created:

- `src/main/db/annotations.ts` - annotations CRUD (list/upsert/delete).
- `src/main/ipc/annotations.ts` - IPC handlers for the `annotations:*` domain.
- `src/renderer/src/lib/utils/spectrogram-geometry.ts` - pure time/freq to pixel mapping.
- `src/renderer/src/lib/stores/annotation.svelte.ts` - editor state + actions with optimistic rollback.
- `src/renderer/src/lib/components/AnnotationBox.svelte` - one draggable/resizable box.
- `src/renderer/src/lib/components/AnnotationEditor.svelte` - the full-window editor modal.
- `src/renderer/src/lib/components/AnnotationSidePanel.svelte` - selected-box fields + list.

Modified:

- `src/main/db/schema.ts` - add `annotations` table + indexes to `SCHEMA_SQL`.
- `src/main/db/database.ts` - add migration version 7.
- `src/main/ipc/handlers.ts` - register annotation handlers.
- `src/preload/index.ts` - allowlist the new channels.
- `src/renderer/src/lib/utils/ipc.ts` - typed wrappers.
- `shared/types.ts` - `Annotation`, `AnnotationInput`, `AnnotationSource`, `AnnotationStatus`.
- `src/renderer/src/App.svelte` - mount `<AnnotationEditor />`.
- `src/renderer/src/lib/components/DetectionDetail.svelte` - "Annotate file" button (primary entry point).
- `src/renderer/src/lib/components/SourceFilesPanel.svelte` - "Annotate" row action (zero-detection entry point).
- `messages/en.json` - new `annotation_*` message keys.

---

## Task 1: Annotations table (schema + migration)

**Files:**

- Modify: `src/main/db/schema.ts` (append to the `SCHEMA_SQL` string)
- Modify: `src/main/db/database.ts` (add migration 7, after the `if (!applied.has(6))` block, before `runMigrations` closes)

- [ ] **Step 1: Add the table + indexes to `SCHEMA_SQL`**

In `src/main/db/schema.ts`, append the following inside the `SCHEMA_SQL` template string, after the existing `audio_files` indexes (keep it within the same backtick-delimited string):

```sql
CREATE TABLE IF NOT EXISTS annotations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    audio_file_id   INTEGER NOT NULL REFERENCES audio_files(id) ON DELETE CASCADE,
    detection_id    INTEGER REFERENCES detections(id) ON DELETE SET NULL,
    start_time      REAL NOT NULL,
    end_time        REAL NOT NULL,
    low_freq_hz     REAL,
    high_freq_hz    REAL,
    scientific_name TEXT NOT NULL,
    confidence      REAL,
    source          TEXT NOT NULL CHECK (source IN ('birda', 'manual')),
    status          TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'manual')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_annotations_audio_file ON annotations(audio_file_id);
CREATE INDEX IF NOT EXISTS idx_annotations_detection ON annotations(detection_id);
```

- [ ] **Step 2: Add migration 7**

In `src/main/db/database.ts`, immediately after the existing `if (!applied.has(6)) { ... }` block and before the end of `runMigrations`, add:

```typescript
if (!applied.has(7)) {
  db.transaction(() => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS annotations (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          audio_file_id   INTEGER NOT NULL REFERENCES audio_files(id) ON DELETE CASCADE,
          detection_id    INTEGER REFERENCES detections(id) ON DELETE SET NULL,
          start_time      REAL NOT NULL,
          end_time        REAL NOT NULL,
          low_freq_hz     REAL,
          high_freq_hz    REAL,
          scientific_name TEXT NOT NULL,
          confidence      REAL,
          source          TEXT NOT NULL CHECK (source IN ('birda', 'manual')),
          status          TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'manual')),
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_annotations_audio_file ON annotations(audio_file_id);
        CREATE INDEX IF NOT EXISTS idx_annotations_detection ON annotations(detection_id);
      `);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(7);
  })();
}
```

- [ ] **Step 3: Typecheck the main process**

Run: `task typecheck:main`
Expected: PASS (no type errors).

- [ ] **Step 4: Manual check that the table is created**

Run: `task dev`, let the app launch (this opens the catalog DB and runs migrations), then close it.
Run: `sqlite3 "$(ls -d ~/.config/*/birda-catalog.db 2>/dev/null | head -1)" ".schema annotations"` if the DB path is known, otherwise open the app's data path from Settings. Expected: the `annotations` table definition prints.
(If `sqlite3` or the path is unavailable, it is sufficient that `task dev` launches without a migration error in the log.)

- [ ] **Step 5: Commit**

```bash
git add src/main/db/schema.ts src/main/db/database.ts
git commit -m "feat(db): add annotations table and migration"
```

---

## Task 2: Shared annotation types

**Files:**

- Modify: `shared/types.ts` (add near the `Detection` / `EnrichedDetection` interfaces)

- [ ] **Step 1: Add the types**

In `shared/types.ts`, after the `EnrichedDetection` interface, add:

```typescript
export type AnnotationSource = 'birda' | 'manual';
export type AnnotationStatus = 'accepted' | 'rejected' | 'manual';

/** A human-curated annotation, stored separately from immutable detections. */
export interface Annotation {
  id: number;
  audio_file_id: number;
  detection_id: number | null;
  start_time: number;
  end_time: number;
  /** null means time-only (full spectrogram height). */
  low_freq_hz: number | null;
  high_freq_hz: number | null;
  scientific_name: string;
  confidence: number | null;
  source: AnnotationSource;
  status: AnnotationStatus;
  created_at: string;
  updated_at: string;
}

/** Upsert payload. Omit `id` to insert; provide it to update. */
export interface AnnotationInput {
  id?: number | undefined;
  audio_file_id: number;
  detection_id?: number | null | undefined;
  start_time: number;
  end_time: number;
  low_freq_hz?: number | null | undefined;
  high_freq_hz?: number | null | undefined;
  scientific_name: string;
  confidence?: number | null | undefined;
  source: AnnotationSource;
  status: AnnotationStatus;
}
```

- [ ] **Step 2: Typecheck both projects**

Run: `task typecheck:main && task check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat(types): add Annotation shared types"
```

---

## Task 3: Annotations CRUD module

**Files:**

- Create: `src/main/db/annotations.ts`

- [ ] **Step 1: Write the module**

Create `src/main/db/annotations.ts`:

```typescript
import { getDb } from './database';
import type { Annotation, AnnotationInput } from '$shared/types';

/** All annotations for an audio file, oldest first. Includes rejected rows; the renderer filters them. */
export function listAnnotations(audioFileId: number): Annotation[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, audio_file_id, detection_id, start_time, end_time, low_freq_hz, high_freq_hz,
              scientific_name, confidence, source, status, created_at, updated_at
       FROM annotations
       WHERE audio_file_id = ?
       ORDER BY start_time ASC, id ASC`,
    )
    .all(audioFileId) as Annotation[];
}

function getById(id: number): Annotation {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, audio_file_id, detection_id, start_time, end_time, low_freq_hz, high_freq_hz,
              scientific_name, confidence, source, status, created_at, updated_at
       FROM annotations WHERE id = ?`,
    )
    .get(id) as Annotation | undefined;
  if (!row) throw new Error(`Annotation ${id} not found`);
  return row;
}

/** Insert (no id) or update (id present); returns the persisted row. */
export function upsertAnnotation(input: AnnotationInput): Annotation {
  const db = getDb();
  const detectionId = input.detection_id ?? null;
  const lowFreq = input.low_freq_hz ?? null;
  const highFreq = input.high_freq_hz ?? null;
  const confidence = input.confidence ?? null;

  if (input.id != null) {
    db.prepare(
      `UPDATE annotations
       SET detection_id = ?, start_time = ?, end_time = ?, low_freq_hz = ?, high_freq_hz = ?,
           scientific_name = ?, confidence = ?, source = ?, status = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      detectionId,
      input.start_time,
      input.end_time,
      lowFreq,
      highFreq,
      input.scientific_name,
      confidence,
      input.source,
      input.status,
      input.id,
    );
    return getById(input.id);
  }

  const result = db
    .prepare(
      `INSERT INTO annotations
         (audio_file_id, detection_id, start_time, end_time, low_freq_hz, high_freq_hz,
          scientific_name, confidence, source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.audio_file_id,
      detectionId,
      input.start_time,
      input.end_time,
      lowFreq,
      highFreq,
      input.scientific_name,
      confidence,
      input.source,
      input.status,
    );
  return getById(Number(result.lastInsertRowid));
}

export function deleteAnnotation(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
}
```

- [ ] **Step 2: Typecheck the main process**

Run: `task typecheck:main`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/db/annotations.ts
git commit -m "feat(db): add annotations CRUD module"
```

---

## Task 4: IPC handlers + registration + preload allowlist

**Files:**

- Create: `src/main/ipc/annotations.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Write the handler module**

Create `src/main/ipc/annotations.ts`:

```typescript
import { ipcMain } from 'electron';
import { listAnnotations, upsertAnnotation, deleteAnnotation } from '../db/annotations';
import type { AnnotationInput } from '$shared/types';

export function registerAnnotationHandlers(): void {
  ipcMain.handle('annotations:list', (_event, audioFileId: number) => {
    return listAnnotations(audioFileId);
  });

  ipcMain.handle('annotations:upsert', (_event, input: AnnotationInput) => {
    return upsertAnnotation(input);
  });

  ipcMain.handle('annotations:delete', (_event, id: number) => {
    deleteAnnotation(id);
  });
}
```

- [ ] **Step 2: Register the handlers**

In `src/main/ipc/handlers.ts`, add the import alongside the other handler imports:

```typescript
import { registerAnnotationHandlers } from './annotations';
```

and add the call inside `registerHandlers()`, in alphabetical position (immediately after `registerAnalysisHandlers();`):

```typescript
registerAnnotationHandlers();
```

- [ ] **Step 3: Allowlist the channels**

In `src/preload/index.ts`, add these three strings to the `ALLOWED_INVOKE_CHANNELS` set (place them next to the other domain groups):

```typescript
  'annotations:list',
  'annotations:upsert',
  'annotations:delete',
```

- [ ] **Step 4: Typecheck the main process**

Run: `task typecheck:main`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/annotations.ts src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "feat(ipc): add annotations IPC handlers and channel allowlist"
```

---

## Task 5: Renderer IPC wrappers

**Files:**

- Modify: `src/renderer/src/lib/utils/ipc.ts`

- [ ] **Step 1: Add the wrappers**

In `src/renderer/src/lib/utils/ipc.ts`, add `Annotation` and `AnnotationInput` to the existing `import type { ... } from '$shared/types';` block, then add these functions (group them with the catalog wrappers):

```typescript
export function listAnnotations(audioFileId: number): Promise<Annotation[]> {
  return window.birda.invoke('annotations:list', audioFileId) as Promise<Annotation[]>;
}

export function upsertAnnotation(input: AnnotationInput): Promise<Annotation> {
  return window.birda.invoke('annotations:upsert', input) as Promise<Annotation>;
}

export function deleteAnnotation(id: number): Promise<void> {
  return window.birda.invoke('annotations:delete', id) as Promise<void>;
}
```

- [ ] **Step 2: Lint + typecheck the renderer**

Run: `task check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/utils/ipc.ts
git commit -m "feat(ipc): add renderer annotation wrappers"
```

---

## Task 6: Spectrogram geometry utility (pure functions)

**Files:**

- Create: `src/renderer/src/lib/utils/spectrogram-geometry.ts`

- [ ] **Step 1: Write the module**

Create `src/renderer/src/lib/utils/spectrogram-geometry.ts`:

```typescript
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

export function timeToX(time: number, vp: SpectrogramViewport): number {
  return time * vp.pxPerSecond - vp.scrollLeft;
}

export function xToTime(x: number, vp: SpectrogramViewport): number {
  return (x + vp.scrollLeft) / vp.pxPerSecond;
}

/** 0 Hz is at the bottom (y = height); freqMax is at the top (y = 0). */
export function freqToY(freqHz: number, vp: SpectrogramViewport): number {
  const clamped = Math.max(0, Math.min(freqHz, vp.freqMax));
  return vp.height * (1 - clamped / vp.freqMax);
}

export function yToFreq(y: number, vp: SpectrogramViewport): number {
  const clampedY = Math.max(0, Math.min(y, vp.height));
  return (1 - clampedY / vp.height) * vp.freqMax;
}

export interface AnnotationBounds {
  start_time: number;
  end_time: number;
  low_freq_hz: number | null;
  high_freq_hz: number | null;
}

/** Map an annotation's bounds to a pixel rectangle. Time-only boxes span the full height. */
export function annotationToRect(a: AnnotationBounds, vp: SpectrogramViewport): BoxRect {
  const left = timeToX(a.start_time, vp);
  const width = Math.max(1, (a.end_time - a.start_time) * vp.pxPerSecond);
  const isTimeOnly = a.low_freq_hz == null && a.high_freq_hz == null;
  if (isTimeOnly) {
    return { left, top: 0, width, height: vp.height };
  }
  const high = a.high_freq_hz ?? vp.freqMax;
  const low = a.low_freq_hz ?? 0;
  const top = freqToY(high, vp);
  const bottom = freqToY(low, vp);
  return { left, top, width, height: Math.max(1, bottom - top) };
}
```

- [ ] **Step 2: Lint + typecheck the renderer**

Run: `task check && task eslint`
Expected: PASS.

- [ ] **Step 3: Sanity-check the math manually**

Reason through one case and confirm against the code: with `freqMax = 12000`, `height = 200`, a box `high_freq_hz = 6000`, `low_freq_hz = 0` gives `top = 200 * (1 - 6000/12000) = 100`, `bottom = 200`, so `height = 100` (lower half of the spectrogram). Confirm the code yields this.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/lib/utils/spectrogram-geometry.ts
git commit -m "feat(annotation): add spectrogram geometry helpers"
```

---

## Task 7: Annotation editor store

**Files:**

- Create: `src/renderer/src/lib/stores/annotation.svelte.ts`

This store holds the editor's open state and the working set of boxes, merging immutable detections (as unsaved suggestions) with persisted annotations, and exposes actions with mandatory optimistic rollback.

- [ ] **Step 1: Write the store**

Create `src/renderer/src/lib/stores/annotation.svelte.ts`:

```typescript
import type { Annotation, AnnotationInput, AnnotationSource, EnrichedDetection } from '$shared/types';
import { listAnnotations, upsertAnnotation, deleteAnnotation, getDetections } from '$lib/utils/ipc';

/** A box in the editor: either a persisted annotation or an unsaved AI suggestion. */
export interface EditorBox {
  /** Stable key for {#each}. */
  key: string;
  /** Persisted annotation id, or null for an unsaved suggestion. */
  annotationId: number | null;
  detectionId: number | null;
  start_time: number;
  end_time: number;
  low_freq_hz: number | null;
  high_freq_hz: number | null;
  scientific_name: string;
  common_name: string;
  confidence: number | null;
  source: AnnotationSource;
  /** 'suggested' is editor-only (not yet persisted). */
  display: 'suggested' | 'accepted' | 'manual';
}

interface AnnotationEditorState {
  open: boolean;
  audioFileId: number | null;
  filePath: string | null;
  boxes: EditorBox[];
  selectedKey: string | null;
  loading: boolean;
  error: string | null;
  toast: string | null;
}

export const annotationEditor = $state<AnnotationEditorState>({
  open: false,
  audioFileId: null,
  filePath: null,
  boxes: [],
  selectedKey: null,
  loading: false,
  error: null,
  toast: null,
});

export function openAnnotationEditor(audioFileId: number, filePath: string): void {
  annotationEditor.open = true;
  annotationEditor.audioFileId = audioFileId;
  annotationEditor.filePath = filePath;
  annotationEditor.boxes = [];
  annotationEditor.selectedKey = null;
  annotationEditor.error = null;
  void loadBoxes();
}

export function closeAnnotationEditor(): void {
  annotationEditor.open = false;
  annotationEditor.audioFileId = null;
  annotationEditor.filePath = null;
  annotationEditor.boxes = [];
  annotationEditor.selectedKey = null;
}

function annotationToBox(a: Annotation, commonName: string): EditorBox {
  return {
    key: `ann-${a.id}`,
    annotationId: a.id,
    detectionId: a.detection_id,
    start_time: a.start_time,
    end_time: a.end_time,
    low_freq_hz: a.low_freq_hz,
    high_freq_hz: a.high_freq_hz,
    scientific_name: a.scientific_name,
    common_name: commonName,
    confidence: a.confidence,
    source: a.source,
    display: a.source === 'manual' ? 'manual' : 'accepted',
  };
}

async function loadBoxes(): Promise<void> {
  const audioFileId = annotationEditor.audioFileId;
  if (audioFileId == null) return;
  annotationEditor.loading = true;
  annotationEditor.error = null;
  try {
    const annotations = await listAnnotations(audioFileId);
    // Detections for this file become unsaved suggestions unless an annotation already references them.
    const { detections } = await getDetections({ audio_file_id: audioFileId, limit: 5000, offset: 0 });
    const referencedDetectionIds = new Set(
      annotations.map((a) => a.detection_id).filter((x): x is number => x != null),
    );

    const persisted = annotations
      .filter((a) => a.status !== 'rejected')
      .map((a) => annotationToBox(a, lookupCommonName(detections, a.scientific_name)));

    const suggestions: EditorBox[] = detections
      .filter((d) => !referencedDetectionIds.has(d.id))
      .map((d) => ({
        key: `sug-${d.id}`,
        annotationId: null,
        detectionId: d.id,
        start_time: d.start_time,
        end_time: d.end_time,
        low_freq_hz: null,
        high_freq_hz: null,
        scientific_name: d.scientific_name,
        common_name: d.common_name,
        confidence: d.confidence,
        source: 'birda',
        display: 'suggested',
      }));

    annotationEditor.boxes = [...persisted, ...suggestions].sort((a, b) => a.start_time - b.start_time);
  } catch (err) {
    annotationEditor.error = (err as Error).message;
  } finally {
    annotationEditor.loading = false;
  }
}

function lookupCommonName(detections: EnrichedDetection[], scientificName: string): string {
  return detections.find((d) => d.scientific_name === scientificName)?.common_name ?? scientificName;
}

function showToast(message: string): void {
  annotationEditor.toast = message;
  setTimeout(() => {
    annotationEditor.toast = null;
  }, 4000);
}

function inputFromBox(box: EditorBox, audioFileId: number, status: AnnotationInput['status']): AnnotationInput {
  return {
    ...(box.annotationId != null ? { id: box.annotationId } : {}),
    audio_file_id: audioFileId,
    detection_id: box.detectionId,
    start_time: box.start_time,
    end_time: box.end_time,
    low_freq_hz: box.low_freq_hz,
    high_freq_hz: box.high_freq_hz,
    scientific_name: box.scientific_name,
    confidence: box.confidence,
    source: box.source,
    status,
  };
}

/**
 * Persist a box (insert or update). On success, reconcile the box with the saved row.
 * On failure, restore the prior boxes snapshot and toast. `status` defaults to the
 * box's current display ('manual' -> manual, otherwise 'accepted').
 */
async function persistBox(box: EditorBox): Promise<void> {
  const audioFileId = annotationEditor.audioFileId;
  if (audioFileId == null) return;
  const snapshot = annotationEditor.boxes.map((b) => ({ ...b }));
  const status: AnnotationInput['status'] = box.source === 'manual' ? 'manual' : 'accepted';
  try {
    const saved = await upsertAnnotation(inputFromBox(box, audioFileId, status));
    const newKey = `ann-${saved.id}`;
    annotationEditor.boxes = annotationEditor.boxes.map((b) =>
      b.key === box.key
        ? { ...b, key: newKey, annotationId: saved.id, display: saved.source === 'manual' ? 'manual' : 'accepted' }
        : b,
    );
    if (annotationEditor.selectedKey === box.key) annotationEditor.selectedKey = newKey;
  } catch (err) {
    annotationEditor.boxes = snapshot;
    showToast((err as Error).message);
  }
}

export function selectBox(key: string | null): void {
  annotationEditor.selectedKey = key;
}

export function getSelectedBox(): EditorBox | null {
  return annotationEditor.boxes.find((b) => b.key === annotationEditor.selectedKey) ?? null;
}

/** Accept an AI suggestion (or re-affirm a box). Promotes a suggestion to a persisted annotation. */
export async function acceptBox(key: string): Promise<void> {
  const box = annotationEditor.boxes.find((b) => b.key === key);
  if (!box) return;
  await persistBox({ ...box, display: 'accepted' });
}

/** Update geometry/species of a box and persist. Editing a suggestion promotes it to accepted. */
export async function updateBox(key: string, patch: Partial<EditorBox>): Promise<void> {
  const idx = annotationEditor.boxes.findIndex((b) => b.key === key);
  if (idx === -1) return;
  const updated = { ...annotationEditor.boxes[idx], ...patch };
  annotationEditor.boxes[idx] = updated; // optimistic local update for snappy drag
  await persistBox(updated);
}

/** Add a brand-new manual box from a drag-draw, persist it, and select it. */
export async function createManualBox(bounds: {
  start_time: number;
  end_time: number;
  low_freq_hz: number | null;
  high_freq_hz: number | null;
}): Promise<void> {
  const audioFileId = annotationEditor.audioFileId;
  if (audioFileId == null) return;
  const tempKey = `new-${annotationEditor.boxes.length}-${annotationEditor.boxes.reduce((n, b) => n + b.start_time, 0)}`;
  const box: EditorBox = {
    key: tempKey,
    annotationId: null,
    detectionId: null,
    start_time: bounds.start_time,
    end_time: bounds.end_time,
    low_freq_hz: bounds.low_freq_hz,
    high_freq_hz: bounds.high_freq_hz,
    scientific_name: '',
    common_name: '',
    confidence: null,
    source: 'manual',
    display: 'manual',
  };
  annotationEditor.boxes = [...annotationEditor.boxes, box];
  annotationEditor.selectedKey = tempKey;
  await persistBox(box);
}

/** Reject a suggestion or delete a persisted box. Rejecting persists a 'rejected' row so it stays hidden. */
export async function removeBox(key: string): Promise<void> {
  const audioFileId = annotationEditor.audioFileId;
  if (audioFileId == null) return;
  const box = annotationEditor.boxes.find((b) => b.key === key);
  if (!box) return;
  const snapshot = annotationEditor.boxes.map((b) => ({ ...b }));
  annotationEditor.boxes = annotationEditor.boxes.filter((b) => b.key !== key);
  if (annotationEditor.selectedKey === key) annotationEditor.selectedKey = null;
  try {
    if (box.annotationId != null) {
      await deleteAnnotation(box.annotationId);
    } else if (box.detectionId != null) {
      // Unsaved AI suggestion: persist a rejected row so it does not reappear on reopen.
      await upsertAnnotation(inputFromBox(box, audioFileId, 'rejected'));
    }
    // Unsaved manual box with no id and no detection: nothing to persist.
  } catch (err) {
    annotationEditor.boxes = snapshot;
    showToast((err as Error).message);
  }
}
```

- [ ] **Step 2: Verify the `getDetections` wrapper accepts `audio_file_id`**

Run: `grep -n "audio_file_id" src/renderer/src/lib/utils/ipc.ts shared/types.ts`
Expected: `DetectionFilter` includes `audio_file_id`. If it does not, add `audio_file_id?: number | undefined;` to the `DetectionFilter` interface in `shared/types.ts` and ensure `buildWhereClause` in `src/main/db/detections.ts` filters on `d.audio_file_id` when present (mirror an existing numeric filter there). Re-run `task typecheck:main`.

- [ ] **Step 3: Lint + typecheck the renderer**

Run: `task check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/lib/stores/annotation.svelte.ts shared/types.ts src/main/db/detections.ts
git commit -m "feat(annotation): add editor store with optimistic rollback"
```

---

## Task 8: AnnotationBox component

**Files:**

- Create: `src/renderer/src/lib/components/AnnotationBox.svelte`

A presentational box positioned by a `BoxRect`, emitting pointer events for select/move/resize. The parent (editor) converts pixel deltas to time/frequency and calls the store.

- [ ] **Step 1: Write the component**

Create `src/renderer/src/lib/components/AnnotationBox.svelte`:

```svelte
<script lang="ts">
  import type { BoxRect } from '$lib/utils/spectrogram-geometry';
  import type { EditorBox } from '$lib/stores/annotation.svelte';

  const {
    box,
    rect,
    selected,
    onselect,
    onmovestart,
    onresizestart,
  }: {
    box: EditorBox;
    rect: BoxRect;
    selected: boolean;
    onselect: () => void;
    onmovestart: (e: PointerEvent) => void;
    onresizestart: (edge: 'left' | 'right' | 'top' | 'bottom', e: PointerEvent) => void;
  } = $props();

  const colorClass = $derived(
    box.display === 'suggested'
      ? 'border-warning bg-warning/10'
      : box.display === 'manual'
        ? 'border-success bg-success/10'
        : 'border-primary bg-primary/10',
  );
</script>

<div
  class="absolute box-border cursor-move border-2 {colorClass} {selected ? 'ring-2 ring-offset-1' : ''}"
  style="left: {rect.left}px; top: {rect.top}px; width: {rect.width}px; height: {rect.height}px;"
  role="button"
  tabindex="0"
  aria-label={box.common_name || box.scientific_name || 'annotation'}
  onpointerdown={(e) => {
    e.stopPropagation();
    onselect();
    onmovestart(e);
  }}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onselect();
    }
  }}
>
  <span class="bg-base-100/80 pointer-events-none absolute -top-4 left-0 truncate px-1 text-[10px] leading-tight">
    {box.common_name || box.scientific_name || '(unnamed)'}
  </span>
  {#if selected}
    {#each ['left', 'right', 'top', 'bottom'] as const as edge (edge)}
      <div
        class="bg-base-content/70 absolute"
        class:cursor-ew-resize={edge === 'left' || edge === 'right'}
        class:cursor-ns-resize={edge === 'top' || edge === 'bottom'}
        style={edge === 'left'
          ? 'left:-3px;top:0;width:6px;height:100%'
          : edge === 'right'
            ? 'right:-3px;top:0;width:6px;height:100%'
            : edge === 'top'
              ? 'top:-3px;left:0;height:6px;width:100%'
              : 'bottom:-3px;left:0;height:6px;width:100%'}
        onpointerdown={(e) => {
          e.stopPropagation();
          onresizestart(edge, e);
        }}
      ></div>
    {/each}
  {/if}
</div>
```

- [ ] **Step 2: Lint the renderer**

Run: `task check && task eslint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/components/AnnotationBox.svelte
git commit -m "feat(annotation): add AnnotationBox component"
```

---

## Task 9: AnnotationEditor component (the hard one)

**Files:**

- Create: `src/renderer/src/lib/components/AnnotationEditor.svelte`

Builds on the wavesurfer + spectrogram setup proven in `DetectionDetail.svelte`, but loads the whole file and adds the box overlay, draw-to-create, drag/resize, transport, and keyboard handling. The overlay is a sibling layer over the spectrogram; boxes are positioned by computation (`left = time * pxPerSec - scrollLeft`) and recomputed on `zoom`, `redraw`, `scroll`, control changes, and a `ResizeObserver`. **Prototype the overlay alignment first (Step 4) before wiring interactions.**

- [ ] **Step 1: Write the component shell (wavesurfer + spectrogram, no overlay yet)**

Create `src/renderer/src/lib/components/AnnotationEditor.svelte`:

```svelte
<script lang="ts">
  import { Play, Pause, LoaderCircle, ZoomIn, ZoomOut, X } from '@lucide/svelte';
  import WaveSurfer from 'wavesurfer.js';
  import SpectrogramPlugin from 'wavesurfer.js/dist/plugins/spectrogram.esm.js';
  import { onDestroy } from 'svelte';
  import { getSettings } from '$lib/utils/ipc';
  import {
    annotationEditor,
    closeAnnotationEditor,
    selectBox,
    getSelectedBox,
    acceptBox,
    updateBox,
    createManualBox,
    removeBox,
  } from '$lib/stores/annotation.svelte';
  import { annotationToRect, xToTime, yToFreq, type SpectrogramViewport } from '$lib/utils/spectrogram-geometry';
  import AnnotationBox from './AnnotationBox.svelte';
  import AnnotationSidePanel from './AnnotationSidePanel.svelte';
  import * as m from '$paraglide/messages';

  let wavesurfer: WaveSurfer | null = null;
  let spectrogramPlugin: SpectrogramPlugin | null = null;
  let waveformEl = $state<HTMLDivElement | undefined>(undefined);
  let spectrogramEl = $state<HTMLDivElement | undefined>(undefined);
  let overlayEl = $state<HTMLDivElement | undefined>(undefined);
  let loading = $state(true);
  let playing = $state(false);
  let duration = $state(0);
  let freqMax = $state(15000);
  let spectrogramHeight = $state(256);

  // Viewport state drives box geometry. Bumped via reactive reassignment to retrigger $derived.
  let pxPerSecond = $state(1);
  let scrollLeft = $state(0);

  let resizeObserver: ResizeObserver | null = null;

  const viewport = $derived<SpectrogramViewport>({
    pxPerSecond,
    scrollLeft,
    freqMax,
    height: spectrogramHeight,
  });

  function refreshViewport(): void {
    if (!wavesurfer) return;
    // wavesurfer v7 exposes getScroll() (pixels). pxPerSecond derives from rendered width / duration.
    scrollLeft = wavesurfer.getScroll();
    const wrapperWidth = waveformEl?.clientWidth ?? 0;
    // When zoomed, the rendered content width is duration * minPxPerSec; otherwise it fits the wrapper.
    pxPerSecond = duration > 0 ? Math.max(wrapperWidth, currentZoomWidth()) / duration : 1;
  }

  let zoomPxPerSec = 0; // 0 => fit to width
  function currentZoomWidth(): number {
    if (zoomPxPerSec > 0) return zoomPxPerSec * duration;
    return waveformEl?.clientWidth ?? 0;
  }

  async function init(): Promise<void> {
    const filePath = annotationEditor.filePath;
    if (!filePath || !waveformEl || !spectrogramEl) return;
    loading = true;

    const settings = await getSettings();
    freqMax = settings.default_freq_max;

    const normalizedPath = filePath.replace(/\\/g, '/');
    const urlPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath;

    spectrogramPlugin = SpectrogramPlugin.create({
      container: spectrogramEl,
      labels: true,
      labelsColor: '#9ca3af',
      labelsHzColor: '#9ca3af',
      labelsBackground: 'rgba(0,0,0,0)',
      height: spectrogramHeight,
      fftSamples: 1024,
      windowFunc: 'hann',
      frequencyMax: freqMax,
    });

    wavesurfer = WaveSurfer.create({
      container: waveformEl,
      height: 48,
      waveColor: '#93c5fd',
      progressColor: '#023E8A',
      cursorColor: '#012d65',
      sampleRate: 48000,
      url: `birda-media://${urlPath}`,
      plugins: [spectrogramPlugin],
    });

    wavesurfer.on('ready', () => {
      if (!wavesurfer) return;
      loading = false;
      duration = wavesurfer.getDuration();
      refreshViewport();
    });
    wavesurfer.on('play', () => (playing = true));
    wavesurfer.on('pause', () => (playing = false));
    wavesurfer.on('finish', () => (playing = false));
    wavesurfer.on('redraw', () => refreshViewport());
    wavesurfer.on('zoom', (px: number) => {
      zoomPxPerSec = px;
      refreshViewport();
    });
    wavesurfer.on('scroll', () => refreshViewport());

    // ResizeObserver: window resize changes effective px-per-second without a wavesurfer event.
    resizeObserver = new ResizeObserver(() => refreshViewport());
    if (waveformEl) resizeObserver.observe(waveformEl);
  }

  // Re-init whenever the editor opens with a file.
  $effect(() => {
    if (annotationEditor.open && annotationEditor.filePath && waveformEl && spectrogramEl) {
      void init();
    }
    return () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      wavesurfer?.destroy();
      wavesurfer = null;
      spectrogramPlugin = null;
    };
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    wavesurfer?.destroy();
  });

  function togglePlay(): void {
    void wavesurfer?.playPause();
  }
  function zoomIn(): void {
    const next = (zoomPxPerSec || pxPerSecond) * 1.5;
    wavesurfer?.zoom(next);
  }
  function zoomOut(): void {
    const next = Math.max(1, (zoomPxPerSec || pxPerSecond) / 1.5);
    wavesurfer?.zoom(next);
  }
</script>
```

- [ ] **Step 2: Add the template (overlay + transport + side panel)**

Append to `AnnotationEditor.svelte` after the `</script>`:

```svelte
{#if annotationEditor.open}
  <div class="bg-base-300/80 fixed inset-0 z-50 flex flex-col p-4 backdrop-blur-sm">
    <div class="bg-base-100 flex h-full flex-col overflow-hidden rounded-lg shadow-xl">
      <!-- Header -->
      <div class="border-base-300 flex items-center gap-3 border-b px-4 py-2">
        <span class="font-medium">{m.annotation_editor_title()}</span>
        <span class="text-base-content/50 truncate text-xs">{annotationEditor.filePath}</span>
        <button class="btn btn-ghost btn-sm btn-circle ml-auto" onclick={closeAnnotationEditor} aria-label={m.common_button_close()}>
          <X size={18} />
        </button>
      </div>

      <!-- Transport -->
      <div class="border-base-300 flex items-center gap-2 border-b px-4 py-2 text-xs">
        <button class="btn btn-primary btn-sm btn-circle" onclick={togglePlay} disabled={loading} aria-label={m.annotation_play()}>
          {#if loading}<LoaderCircle size={16} class="animate-spin" />{:else if playing}<Pause size={16} />{:else}<Play size={16} />{/if}
        </button>
        <button class="btn btn-ghost btn-sm" onclick={zoomOut} aria-label={m.annotation_zoomOut()}><ZoomOut size={14} /></button>
        <button class="btn btn-ghost btn-sm" onclick={zoomIn} aria-label={m.annotation_zoomIn()}><ZoomIn size={14} /></button>
        <span class="text-base-content/50 ml-2">{m.annotation_drawHint()}</span>
      </div>

      <!-- Main: spectrogram + overlay on the left, side panel on the right -->
      <div class="flex min-h-0 flex-1">
        <div class="relative min-w-0 flex-1 overflow-hidden p-2">
          <div bind:this={waveformEl} class="bg-base-100"></div>
          <div class="relative">
            <div bind:this={spectrogramEl} class="bg-base-100 overflow-hidden"></div>
            <!-- Overlay: sibling layer over the spectrogram, NOT injected into wavesurfer's container -->
            <div
              bind:this={overlayEl}
              class="absolute inset-0 overflow-hidden"
              role="application"
              aria-label={m.annotation_overlay_label()}
              onpointerdown={(e) => handleOverlayPointerDown(e)}
            >
              {#each annotationEditor.boxes as box (box.key)}
                <AnnotationBox
                  {box}
                  rect={annotationToRect(box, viewport)}
                  selected={annotationEditor.selectedKey === box.key}
                  onselect={() => selectBox(box.key)}
                  onmovestart={(e) => startMove(box.key, e)}
                  onresizestart={(edge, e) => startResize(box.key, edge, e)}
                />
              {/each}
            </div>
          </div>
        </div>
        <AnnotationSidePanel />
      </div>
    </div>

    {#if annotationEditor.toast}
      <div class="toast toast-end">
        <div class="alert alert-error text-sm">{annotationEditor.toast}</div>
      </div>
    {/if}
  </div>

  <svelte:window onkeydown={handleKeydown} />
{/if}
```

- [ ] **Step 3: Add the interaction handlers (draw, move, resize, keyboard)**

Add these functions inside the `<script>` block of `AnnotationEditor.svelte` (before the closing `</script>`):

```typescript
function overlayMetrics(e: PointerEvent): { x: number; y: number } | null {
  if (!overlayEl) return null;
  const r = overlayEl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

let drag: {
  mode: 'draw' | 'move' | 'resize';
  key?: string;
  edge?: 'left' | 'right' | 'top' | 'bottom';
  startX: number;
  startY: number;
  orig?: { s: number; e: number; lo: number | null; hi: number | null };
} | null = null;
let drawRectStart: { x: number; y: number } | null = null;

function handleOverlayPointerDown(e: PointerEvent): void {
  // Pointerdown on empty overlay starts a draw; on a box, the box handles it.
  const p = overlayMetrics(e);
  if (!p) return;
  selectBox(null);
  drawRectStart = p;
  drag = { mode: 'draw', startX: p.x, startY: p.y };
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp, { once: true });
}

function startMove(key: string, e: PointerEvent): void {
  const p = overlayMetrics(e);
  const box = annotationEditor.boxes.find((b) => b.key === key);
  if (!p || !box) return;
  drag = {
    mode: 'move',
    key,
    startX: p.x,
    startY: p.y,
    orig: { s: box.start_time, e: box.end_time, lo: box.low_freq_hz, hi: box.high_freq_hz },
  };
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp, { once: true });
}

function startResize(key: string, edge: 'left' | 'right' | 'top' | 'bottom', e: PointerEvent): void {
  const p = overlayMetrics(e);
  const box = annotationEditor.boxes.find((b) => b.key === key);
  if (!p || !box) return;
  drag = {
    mode: 'resize',
    key,
    edge,
    startX: p.x,
    startY: p.y,
    orig: { s: box.start_time, e: box.end_time, lo: box.low_freq_hz, hi: box.high_freq_hz },
  };
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp, { once: true });
}

let liveDraw = $state<{ left: number; top: number; width: number; height: number } | null>(null);

function handlePointerMove(e: PointerEvent): void {
  if (!drag || !overlayEl) return;
  const r = overlayEl.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  if (drag.mode === 'draw' && drawRectStart) {
    liveDraw = {
      left: Math.min(drawRectStart.x, x),
      top: Math.min(drawRectStart.y, y),
      width: Math.abs(x - drawRectStart.x),
      height: Math.abs(y - drawRectStart.y),
    };
  } else if (drag.mode === 'move' && drag.key && drag.orig) {
    const dt = xToTime(x, viewport) - xToTime(drag.startX, viewport);
    void updateBox(drag.key, { start_time: Math.max(0, drag.orig.s + dt), end_time: drag.orig.e + dt });
  } else if (drag.mode === 'resize' && drag.key && drag.orig) {
    const t = xToTime(x, viewport);
    const f = yToFreq(y, viewport);
    if (drag.edge === 'left') void updateBox(drag.key, { start_time: Math.min(t, drag.orig.e - 0.01) });
    else if (drag.edge === 'right') void updateBox(drag.key, { end_time: Math.max(t, drag.orig.s + 0.01) });
    else if (drag.edge === 'top') void updateBox(drag.key, { high_freq_hz: f, low_freq_hz: drag.orig.lo ?? 0 });
    else if (drag.edge === 'bottom')
      void updateBox(drag.key, { low_freq_hz: f, high_freq_hz: drag.orig.hi ?? viewport.freqMax });
  }
}

function handlePointerUp(e: PointerEvent): void {
  window.removeEventListener('pointermove', handlePointerMove);
  if (drag?.mode === 'draw' && drawRectStart && overlayEl) {
    const r = overlayEl.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const t1 = xToTime(Math.min(drawRectStart.x, x), viewport);
    const t2 = xToTime(Math.max(drawRectStart.x, x), viewport);
    const f1 = yToFreq(Math.max(drawRectStart.y, y), viewport); // bottom => low
    const f2 = yToFreq(Math.min(drawRectStart.y, y), viewport); // top => high
    if (t2 - t1 > 0.02) {
      void createManualBox({ start_time: t1, end_time: t2, low_freq_hz: f1, high_freq_hz: f2 });
    }
  }
  drag = null;
  drawRectStart = null;
  liveDraw = null;
}

function handleKeydown(e: KeyboardEvent): void {
  if (!annotationEditor.open) return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

  const boxes = annotationEditor.boxes;
  const selected = getSelectedBox();
  const idx = selected ? boxes.findIndex((b) => b.key === selected.key) : -1;

  if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'Enter' && selected) {
    e.preventDefault();
    void acceptBox(selected.key).then(() => {
      const next = boxes[idx + 1];
      if (next) selectBox(next.key);
    });
  } else if (e.key === 'Tab') {
    e.preventDefault();
    if (boxes.length === 0) return;
    const nextIdx = e.shiftKey ? (idx <= 0 ? boxes.length - 1 : idx - 1) : (idx + 1) % boxes.length;
    selectBox(boxes[nextIdx].key);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
    e.preventDefault();
    void removeBox(selected.key);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (annotationEditor.selectedKey) selectBox(null);
    else closeAnnotationEditor();
  }
}
```

Also render the live draw rectangle: add this inside the overlay `<div>` in the template, after the `{#each}` block:

```svelte
{#if liveDraw}
  <div
    class="border-success bg-success/20 pointer-events-none absolute border-2"
    style="left:{liveDraw.left}px;top:{liveDraw.top}px;width:{liveDraw.width}px;height:{liveDraw.height}px;"
  ></div>
{/if}
```

- [ ] **Step 4: Verify overlay alignment manually (the P0 risk)**

Run: `task dev`. Open the editor on a recording with detections (after Task 12 wires the entry point; until then, temporarily call `openAnnotationEditor(<id>, '<path>')` from the browser devtools console). Confirm:

- Suggestion boxes (warning color) sit at the correct horizontal positions matching the spectrogram time axis.
- Zoom in/out keeps boxes aligned.
- Horizontal scroll keeps boxes aligned (`getScroll()` wiring works). If `getScroll()` is not present in the installed wavesurfer v7 build, read `scrollLeft` from the scroll container instead: `(waveformEl?.querySelector('div')?.parentElement)`; adjust `refreshViewport()` accordingly and re-verify.
- Resizing the window keeps boxes aligned (ResizeObserver works).

Expected: boxes track the spectrogram under zoom, scroll, and resize.

- [ ] **Step 5: Lint the renderer**

Run: `task check`
Expected: PASS (resolve any svelte-check/type issues, e.g. event handler typings).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/components/AnnotationEditor.svelte
git commit -m "feat(annotation): add spectrogram annotation editor with box overlay"
```

---

## Task 10: AnnotationSidePanel component

**Files:**

- Create: `src/renderer/src/lib/components/AnnotationSidePanel.svelte`

- [ ] **Step 1: Write the component**

Create `src/renderer/src/lib/components/AnnotationSidePanel.svelte`:

```svelte
<script lang="ts">
  import { Check, Trash2 } from '@lucide/svelte';
  import {
    annotationEditor,
    getSelectedBox,
    selectBox,
    acceptBox,
    updateBox,
    removeBox,
  } from '$lib/stores/annotation.svelte';
  import SpeciesSearch from './SpeciesSearch.svelte';
  import { formatConfidence } from '$lib/utils/format';
  import type { EnrichedSpeciesSummary } from '$shared/types';
  import * as m from '$paraglide/messages';

  const selected = $derived(getSelectedBox());

  function onSpeciesSelect(key: string, species: EnrichedSpeciesSummary): void {
    void updateBox(key, { scientific_name: species.scientific_name, common_name: species.common_name });
  }
</script>

<div class="border-base-300 bg-base-200 flex w-72 shrink-0 flex-col overflow-hidden border-l">
  <div class="border-base-300 border-b px-3 py-2 text-sm font-medium">{m.annotation_panel_title()}</div>

  {#if selected}
    <div class="space-y-3 p-3 text-xs">
      <div>
        <span class="text-base-content/60 mb-1 block">{m.annotation_field_species()}</span>
        <SpeciesSearch onselect={(s) => onSpeciesSelect(selected.key, s)} onclear={() => {}} />
        <div class="text-base-content/70 mt-1">
          {selected.common_name || selected.scientific_name || m.annotation_unnamed()}
        </div>
      </div>
      <div class="text-base-content/70 tabular-nums">
        {m.annotation_field_time({ start: selected.start_time.toFixed(2), end: selected.end_time.toFixed(2) })}
      </div>
      <div class="text-base-content/70 tabular-nums">
        {#if selected.low_freq_hz == null && selected.high_freq_hz == null}
          {m.annotation_freq_full()}
        {:else}
          {m.annotation_field_freq({
            low: ((selected.low_freq_hz ?? 0) / 1000).toFixed(1),
            high: ((selected.high_freq_hz ?? 0) / 1000).toFixed(1),
          })}
        {/if}
      </div>
      {#if selected.confidence != null}
        <div class="text-base-content/50">{formatConfidence(selected.confidence)}</div>
      {/if}
      <div class="flex gap-2">
        {#if selected.display === 'suggested'}
          <button class="btn btn-primary btn-xs" onclick={() => acceptBox(selected.key)}>
            <Check size={12} />{m.annotation_accept()}
          </button>
        {/if}
        <button class="btn btn-ghost btn-xs" onclick={() => removeBox(selected.key)}>
          <Trash2 size={12} />{m.annotation_remove()}
        </button>
      </div>
    </div>
  {:else}
    <div class="text-base-content/50 p-3 text-xs">{m.annotation_panel_empty()}</div>
  {/if}

  <!-- Annotation list -->
  <div class="border-base-300 mt-auto border-t">
    <div class="text-base-content/50 px-3 py-1 text-[10px] uppercase">{m.annotation_list_title()}</div>
    <div class="max-h-48 overflow-y-auto">
      {#each annotationEditor.boxes as box (box.key)}
        <button
          class="hover:bg-base-300/50 flex w-full items-center gap-2 px-3 py-1 text-left text-xs {annotationEditor.selectedKey ===
          box.key
            ? 'bg-base-300'
            : ''}"
          onclick={() => selectBox(box.key)}
        >
          <span
            class="inline-block h-2 w-2 shrink-0 rounded-full {box.display === 'suggested'
              ? 'bg-warning'
              : box.display === 'manual'
                ? 'bg-success'
                : 'bg-primary'}"
          ></span>
          <span class="truncate">{box.common_name || box.scientific_name || m.annotation_unnamed()}</span>
          <span class="text-base-content/40 ml-auto tabular-nums">{box.start_time.toFixed(1)}s</span>
        </button>
      {/each}
    </div>
  </div>
</div>
```

- [ ] **Step 2: Lint the renderer**

Run: `task check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/components/AnnotationSidePanel.svelte
git commit -m "feat(annotation): add annotation side panel"
```

---

## Task 11: Mount the editor in App.svelte

**Files:**

- Modify: `src/renderer/src/App.svelte`

- [ ] **Step 1: Import and render the editor**

In `src/renderer/src/App.svelte`, add the import with the other component imports:

```typescript
import AnnotationEditor from '$lib/components/AnnotationEditor.svelte';
```

and render it once near the end of the root markup (after the main layout, so it overlays everything; it renders nothing unless open):

```svelte
<AnnotationEditor />
```

- [ ] **Step 2: Lint the renderer**

Run: `task check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.svelte
git commit -m "feat(annotation): mount annotation editor at app root"
```

---

## Task 12: Primary entry point (DetectionDetail "Annotate file" button)

**Files:**

- Modify: `src/renderer/src/lib/components/DetectionDetail.svelte`

- [ ] **Step 1: Add the import and handler**

In the `<script>` of `DetectionDetail.svelte`, add the store import with the other `$lib` imports:

```typescript
import { openAnnotationEditor } from '$lib/stores/annotation.svelte';
```

and add a handler:

```typescript
function annotateFile(): void {
  if (detection.audio_file) {
    openAnnotationEditor(detection.audio_file.id, detection.audio_file.file_path);
  }
}
```

- [ ] **Step 2: Add the button to the header row**

In the metadata header `<div>` (the one containing the time range, species, and confidence near `formatConfidence`), add an "Annotate" button. Place it after the closing of the timing/confidence spans, before the `{#if !loading}` time block, so it only shows when an audio file is known:

```svelte
{#if detection.audio_file}
  <button class="btn btn-ghost btn-xs" onclick={annotateFile} title={m.annotation_annotateFile()}>
    {m.annotation_annotateFile()}
  </button>
{/if}
```

- [ ] **Step 3: Lint the renderer**

Run: `task check`
Expected: PASS.

- [ ] **Step 4: Manual verification (end-to-end)**

Run: `task dev`. Go to Detections, expand a detection, click "Annotate". The editor opens on that file, suggestion boxes appear, and accept/reject/edit/draw/delete all persist (reopen the editor and confirm rejected suggestions stay hidden and accepted/manual boxes remain).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/components/DetectionDetail.svelte
git commit -m "feat(annotation): add Annotate entry point to detection detail"
```

---

## Task 13: Zero-detection entry point (SourceFilesPanel + lookup helper)

**Files:**

- Modify: `src/main/db/annotations.ts` (add `getAudioFileIdByPath`)
- Modify: `src/main/ipc/annotations.ts` (add channel)
- Modify: `src/preload/index.ts` (allowlist channel)
- Modify: `src/renderer/src/lib/utils/ipc.ts` (wrapper)
- Modify: `src/renderer/src/lib/components/SourceFilesPanel.svelte` (row action)

This covers recordings that produced zero detections (so they never appear on the Detections page). We resolve the file's `audio_files.id` by path for the current run; if it has not been analyzed (no row), the action is disabled.

- [ ] **Step 1: Add the lookup query**

In `src/main/db/annotations.ts`, add:

```typescript
/** Resolve an audio_files.id by file path (optionally scoped to a run). Returns null if unknown. */
export function getAudioFileIdByPath(filePath: string, runId?: number | null): number | null {
  const db = getDb();
  const row =
    runId != null
      ? (db
          .prepare('SELECT id FROM audio_files WHERE file_path = ? AND run_id = ? ORDER BY id DESC LIMIT 1')
          .get(filePath, runId) as { id: number } | undefined)
      : (db.prepare('SELECT id FROM audio_files WHERE file_path = ? ORDER BY id DESC LIMIT 1').get(filePath) as
          { id: number } | undefined);
  return row?.id ?? null;
}
```

- [ ] **Step 2: Add the IPC handler**

In `src/main/ipc/annotations.ts`, add the import and handler:

```typescript
import { listAnnotations, upsertAnnotation, deleteAnnotation, getAudioFileIdByPath } from '../db/annotations';
```

```typescript
ipcMain.handle('annotations:resolve-file', (_event, filePath: string, runId: number | null) => {
  return getAudioFileIdByPath(filePath, runId);
});
```

- [ ] **Step 3: Allowlist + wrapper**

In `src/preload/index.ts`, add `'annotations:resolve-file',` to `ALLOWED_INVOKE_CHANNELS`.

In `src/renderer/src/lib/utils/ipc.ts`, add:

```typescript
export function resolveAnnotationFile(filePath: string, runId: number | null): Promise<number | null> {
  return window.birda.invoke('annotations:resolve-file', filePath, runId) as Promise<number | null>;
}
```

- [ ] **Step 4: Add the row action in SourceFilesPanel**

In `src/renderer/src/lib/components/SourceFilesPanel.svelte`, add imports:

```typescript
import { openAnnotationEditor } from '$lib/stores/annotation.svelte';
import { resolveAnnotationFile } from '$lib/utils/ipc';
import { appState } from '$lib/stores/app.svelte';
```

add a handler:

```typescript
async function annotate(filePath: string): Promise<void> {
  const runId = appState.selectedRunId ?? appState.lastRunId ?? null;
  const id = await resolveAnnotationFile(filePath, runId);
  if (id != null) openAnnotationEditor(id, filePath);
}
```

and add a trailing cell to the multi-file table row (`{#each scanResult.files as file ...}`), after the last existing `<td>`:

```svelte
<td class="text-center">
  <button class="btn btn-ghost btn-xs" onclick={() => annotate(file.path)} title={m.annotation_annotateFile()}>
    {m.annotation_annotate()}
  </button>
</td>
```

Add a matching header `<th class="w-20"></th>` to the table's `<thead>` row so columns align.

- [ ] **Step 5: Typecheck both + lint**

Run: `task typecheck:main && task check`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Run: `task dev`. Analyze a folder containing at least one recording with no detections, open the source files list, click "Annotate" on that file. The editor opens with no suggestion boxes and lets you draw new annotations that persist.

- [ ] **Step 7: Commit**

```bash
git add src/main/db/annotations.ts src/main/ipc/annotations.ts src/preload/index.ts src/renderer/src/lib/utils/ipc.ts src/renderer/src/lib/components/SourceFilesPanel.svelte
git commit -m "feat(annotation): add zero-detection entry point from source files"
```

---

## Task 14: i18n keys + full validation

**Files:**

- Modify: `messages/en.json`

- [ ] **Step 1: Add the message keys**

Add these keys to `messages/en.json` (place them with the other domain groups; values are the English strings, params in `{braces}`):

```json
  "annotation_editor_title": "Annotation Editor",
  "annotation_overlay_label": "Annotation overlay",
  "annotation_play": "Play / pause",
  "annotation_zoomIn": "Zoom in",
  "annotation_zoomOut": "Zoom out",
  "annotation_drawHint": "Drag on the spectrogram to draw a new annotation",
  "annotation_panel_title": "Selected annotation",
  "annotation_panel_empty": "Select or draw an annotation to edit it",
  "annotation_field_species": "Species",
  "annotation_field_time": "Time: {start}s - {end}s",
  "annotation_field_freq": "Frequency: {low} - {high} kHz",
  "annotation_freq_full": "Frequency: full range",
  "annotation_unnamed": "(unnamed)",
  "annotation_accept": "Accept",
  "annotation_remove": "Remove",
  "annotation_list_title": "Annotations",
  "annotation_annotateFile": "Annotate file",
  "annotation_annotate": "Annotate"
```

- [ ] **Step 2: Regenerate Paraglide messages and validate everything**

Run: `task build`
Expected: PASS (the build runs the Paraglide compiler, generating the `m.annotation_*` functions; main + preload + renderer all bundle without error).

Run: `task lint`
Expected: PASS (ESLint + svelte-check + tsc clean).

Run: `npx knip` (or the project's knip task if defined)
Expected: no new unused exports reported for the annotation modules (everything is wired).

- [ ] **Step 3: Final manual smoke test**

Run: `task dev`. Exercise the full loop once more: open from a detection, accept a suggestion (Enter), draw a box (drag), set its species via the side panel search, adjust its frequency by dragging the top/bottom edges, delete one (Delete), close and reopen to confirm persistence and that rejected suggestions stay hidden.

- [ ] **Step 4: Commit**

```bash
git add messages/en.json src/renderer/src/paraglide
git commit -m "feat(annotation): add i18n strings for annotation editor"
```

---

## Self-review (completed by plan author)

**Spec coverage:**

- Whole-file editor, two entry points (detections + source files): Tasks 9, 12, 13.
- Boxes seeded from detections as time-only suggestions; accept/reject/edit/draw/delete: Tasks 7, 8, 9, 10.
- Time-only to frequency-bounded drag semantics (top sets high + pins low to 0; bottom sets low + pins high to freqMax): Task 9 Step 3 (`handlePointerMove` resize branch).
- Lazy materialization, immutable detections, `annotations` table without `run_id`: Tasks 1, 3, 7.
- Optimistic per-action autosave with mandatory rollback + toast: Task 7 (`persistBox`, `removeBox`).
- Overlay/axis sync (sibling layer, computed positions, zoom/redraw/scroll + ResizeObserver): Task 9.
- Keyboard shortcuts (Space/Enter/Tab/Delete/Escape, suspended in inputs): Task 9 (`handleKeydown`); documented mechanism deviation from spec at top.
- Species autocomplete via existing service: Task 10 (`SpeciesSearch`).
- Spectrogram controls reuse (freqMax, height, gain): freqMax + zoom wired in Task 9; height/gain reuse the same control patterns as `DetectionDetail` and can be added with the existing selectors if desired (kept minimal per YAGNI; not required by the spec's v1 must-haves).
- Edge cases (file missing, empty state, Nyquist clamp): geometry clamps freq (Task 6); empty state handled (Task 13 manual file); a missing-file error surfaces through the wavesurfer `error` event (add an `error` handler in Task 9 if not already present, mirroring `DetectionDetail`).

**Placeholder scan:** No "TBD"/"TODO"/"handle errors appropriately" placeholders; every code step contains real code. Two explicitly-bounded verification fallbacks (`getScroll()` alternative in Task 9 Step 4; `audio_file_id` filter check in Task 7 Step 2) are conditional instructions, not placeholders.

**Type consistency:** `EditorBox`, `Annotation`, `AnnotationInput`, `SpectrogramViewport`, `BoxRect`, and the store function names (`openAnnotationEditor`, `acceptBox`, `updateBox`, `createManualBox`, `removeBox`, `selectBox`, `getSelectedBox`) are used consistently across Tasks 6-13. IPC channel names (`annotations:list|upsert|delete|resolve-file`) match across handler, preload allowlist, and wrappers.

**Known assumption to verify at execution time:** `DetectionFilter` supports `audio_file_id` (Task 7 Step 2 adds it if missing), and `EnrichedDetection.audio_file` exposes `id` + `file_path` (confirmed in `shared/types.ts`).
