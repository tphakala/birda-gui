import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { Annotation, AnnotationInput, AnnotationSource } from '$shared/types';
import { listAnnotations, upsertAnnotation, deleteAnnotation, getDetections, resolveAllLabels } from '$lib/utils/ipc';
import { showToast } from '$lib/stores/toast.svelte';

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
}

const MAX_DETECTION_SUGGESTIONS = 5000;

export const annotationEditor = $state<AnnotationEditorState>({
  open: false,
  audioFileId: null,
  filePath: null,
  boxes: [],
  selectedKey: null,
  loading: false,
  error: null,
});

let manualBoxSeq = 0;
/** Keys with a persist in flight; blocks duplicate INSERTs from rapid repeat actions on the same box. */
const persistInFlight = new SvelteSet<string>();
/** Keys whose latest state still needs persisting once the in-flight call for that key finishes. */
const pendingPersistKeys = new SvelteSet<string>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
  annotationEditor.error = null;
  annotationEditor.loading = false;
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
  if (audioFileId === null) return;
  annotationEditor.loading = true;
  annotationEditor.error = null;
  try {
    // Detections for this file become unsaved suggestions unless an annotation already references them.
    const [annotations, { detections }] = await Promise.all([
      listAnnotations(audioFileId),
      getDetections({ audio_file_id: audioFileId, limit: MAX_DETECTION_SUGGESTIONS, offset: 0 }),
    ]);
    const referencedDetectionIds = new Set(
      annotations.map((a) => a.detection_id).filter((x): x is number => x !== null),
    );

    const commonNames = new SvelteMap(detections.map((d) => [d.scientific_name, d.common_name]));
    // Manual annotations may name species birda never detected in this file; resolve those labels too.
    const unresolved = [
      ...new Set(annotations.map((a) => a.scientific_name).filter((n) => n !== '' && !commonNames.has(n))),
    ];
    if (unresolved.length > 0) {
      const resolved = await resolveAllLabels(unresolved);
      for (const [scientific, common] of Object.entries(resolved)) {
        if (common) commonNames.set(scientific, common);
      }
    }

    const persisted = annotations
      .filter((a) => a.status !== 'rejected')
      .map((a) => annotationToBox(a, commonNames.get(a.scientific_name) ?? a.scientific_name));

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
        display: 'suggested' as const,
      }));

    annotationEditor.boxes = [...persisted, ...suggestions].sort((a, b) => a.start_time - b.start_time);
  } catch (err) {
    annotationEditor.error = errorMessage(err);
  } finally {
    annotationEditor.loading = false;
  }
}

function inputFromBox(box: EditorBox, audioFileId: number, status: AnnotationInput['status']): AnnotationInput {
  return {
    ...(box.annotationId !== null ? { id: box.annotationId } : {}),
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
 * On failure, roll back only the affected box (concurrent edits to other boxes survive)
 * and toast. Status follows the box's source ('manual' -> manual, otherwise 'accepted').
 * Re-entrant calls for the same key are dropped while a persist is in flight, so a
 * not-yet-persisted box can never insert twice.
 */
async function persistBox(box: EditorBox): Promise<void> {
  const audioFileId = annotationEditor.audioFileId;
  if (audioFileId === null) return;
  if (persistInFlight.has(box.key)) {
    // Queue instead of dropping: the latest state is re-persisted when the in-flight call finishes.
    pendingPersistKeys.add(box.key);
    return;
  }
  persistInFlight.add(box.key);
  let reconciledKey = box.key;
  const current = annotationEditor.boxes.find((b) => b.key === box.key);
  const prior = current ? { ...current } : null;
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
    reconciledKey = newKey;
  } catch (err) {
    if (prior !== null && (prior.annotationId !== null || prior.detectionId !== null)) {
      annotationEditor.boxes = annotationEditor.boxes.map((b) => (b.key === box.key ? prior : b));
    } else {
      // Unsaved manual box that never persisted: drop it.
      annotationEditor.boxes = annotationEditor.boxes.filter((b) => b.key !== box.key);
      if (annotationEditor.selectedKey === box.key) annotationEditor.selectedKey = null;
    }
    showToast(errorMessage(err), { severity: 'error' });
  } finally {
    persistInFlight.delete(box.key);
    if (pendingPersistKeys.delete(box.key)) {
      // The boxes array already holds the latest local state (updates are applied
      // optimistically before persisting); re-persist it under the possibly rekeyed entry.
      const live = annotationEditor.boxes.find((b) => b.key === reconciledKey);
      if (live) void persistBox(live);
    }
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

/** Update a box locally without persisting; used for live drag geometry. Commit with commitBox. */
export function updateBoxLocal(key: string, patch: Partial<EditorBox>): void {
  const idx = annotationEditor.boxes.findIndex((b) => b.key === key);
  if (idx === -1) return;
  annotationEditor.boxes[idx] = { ...annotationEditor.boxes[idx], ...patch };
}

/** Persist a box's current state; called once at drag end after updateBoxLocal calls. */
export async function commitBox(key: string): Promise<void> {
  const box = annotationEditor.boxes.find((b) => b.key === key);
  if (!box) return;
  await persistBox(box);
}

/** Update geometry/species of a box and persist. Editing a suggestion promotes it to accepted. */
export async function updateBox(key: string, patch: Partial<EditorBox>): Promise<void> {
  const idx = annotationEditor.boxes.findIndex((b) => b.key === key);
  if (idx === -1) return;
  const updated = { ...annotationEditor.boxes[idx], ...patch };
  annotationEditor.boxes[idx] = updated; // optimistic local update
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
  if (audioFileId === null) return;
  const tempKey = `new-${++manualBoxSeq}`;
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
  if (audioFileId === null) return;
  const box = annotationEditor.boxes.find((b) => b.key === key);
  if (!box) return;
  const removed = { ...box };
  annotationEditor.boxes = annotationEditor.boxes.filter((b) => b.key !== key);
  if (annotationEditor.selectedKey === key) annotationEditor.selectedKey = null;
  try {
    if (box.annotationId !== null) {
      await deleteAnnotation(box.annotationId);
    } else if (box.detectionId !== null) {
      // Unsaved AI suggestion: persist a rejected row so it does not reappear on reopen.
      await upsertAnnotation(inputFromBox(box, audioFileId, 'rejected'));
    }
    // Unsaved manual box with no id and no detection: nothing to persist.
  } catch (err) {
    // Re-insert only the removed box so concurrent edits to other boxes survive.
    annotationEditor.boxes = [...annotationEditor.boxes, removed].sort((a, b) => a.start_time - b.start_time);
    showToast(errorMessage(err), { severity: 'error' });
  }
}
