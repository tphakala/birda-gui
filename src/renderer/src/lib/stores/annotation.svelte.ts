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
  if (audioFileId === null) return;
  annotationEditor.loading = true;
  annotationEditor.error = null;
  try {
    const annotations = await listAnnotations(audioFileId);
    // Detections for this file become unsaved suggestions unless an annotation already references them.
    const { detections } = await getDetections({ audio_file_id: audioFileId, limit: 5000, offset: 0 });
    const referencedDetectionIds = new Set(
      annotations.map((a) => a.detection_id).filter((x): x is number => x !== null),
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
        display: 'suggested' as const,
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
 * On failure, restore the prior boxes snapshot and toast. Status defaults to the
 * box's current display ('manual' -> manual, otherwise 'accepted').
 */
async function persistBox(box: EditorBox): Promise<void> {
  const audioFileId = annotationEditor.audioFileId;
  if (audioFileId === null) return;
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
  if (audioFileId === null) return;
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
  if (audioFileId === null) return;
  const box = annotationEditor.boxes.find((b) => b.key === key);
  if (!box) return;
  const snapshot = annotationEditor.boxes.map((b) => ({ ...b }));
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
    annotationEditor.boxes = snapshot;
    showToast((err as Error).message);
  }
}
