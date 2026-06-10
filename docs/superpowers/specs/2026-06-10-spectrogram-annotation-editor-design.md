# Spectrogram Annotation Editor (clean-room) - Design Spec

- Date: 2026-06-10
- Status: Draft (revised after self-review and a Gemini peer review via agy)
- Sub-project: 1 of 3 in the "Xeno-canto annotation workflow" effort
- Related future work: Annota-JSON export (sub-project 2), direct Xeno-canto publish (sub-project 3)

## Summary

Add a SignaVis-style spectrogram annotation editor to birda-gui. The editor opens on a single
recording, shows the full-file waveform and spectrogram, overlays birda's AI detections as
annotation boxes, and lets the user accept, reject, edit, move, resize, and draw annotations.
Curated annotations persist in the catalog database. This is the human-in-the-loop curation
surface that later sub-projects serialize to Xeno-canto Annota-JSON and publish.

This is a clean-room implementation. We take only the public UX description of SignaVis as
inspiration. We do not read, copy, or link any SignaVis source code. The editor is built on the
project's existing wavesurfer.js v7 stack (BSD-3-Clause), which is already a dependency.

## Goals

- Let a user review a whole recording's birda detections on one spectrogram timeline.
- Let a user accept or reject each AI suggestion, correct the species, and tighten the time and
  frequency bounds of a box.
- Let a user draw entirely new annotation boxes for vocalizations birda missed.
- Persist curated annotations durably and separately from the immutable AI detections.
- Reuse the existing audio pipeline (`birda-media://` protocol, wavesurfer, spectrogram plugin)
  rather than introducing a second audio stack.

## Non-goals (explicitly out of scope for this sub-project)

- Annota-JSON serialization and file export (sub-project 2).
- Direct Xeno-canto API publishing and API-key settings (sub-project 3).
- Undo/redo history.
- Custom label taxonomy presets.
- Bandpass playback, spectrogram colormap/contrast controls, alternative frequency scales
  (linear/log/mel). The editor reuses the current freqMax/height/gain controls only.
- Xeno-canto search and recording import.
- Multi-file batch annotation.
- Any change to the `../birda` Rust CLI (for example `--format annota-json`). The GUI generates
  everything it needs from its own catalog, so the CLI writer remains optional and deferred.

## Context and constraints

What already exists and shapes the design:

- `DetectionDetail.svelte` is a per-detection clip player. It extracts a +/-2s clip around one
  detection and renders waveform + spectrogram with wavesurfer v7, the spectrogram plugin, and
  the regions plugin (drag-to-select, loop, export region as WAV, Web Audio gain). This component
  stays as-is. The new editor is a separate, whole-file surface.
- Audio reaches the renderer through the custom `birda-media://` protocol (restricted to audio
  extensions), registered in `src/main/index.ts`.
- Navigation is tab-based (`Tab = 'analysis' | 'detections' | 'map' | 'species' | 'settings'`),
  not a router. The editor is launched as a full-window modal/overlay, not a new top-level tab.
- The catalog DB (better-sqlite3) holds `detections` with columns: `id`, `run_id`, `location_id`,
  `audio_file_id`, `start_time`, `end_time`, `scientific_name`, `confidence`. There is no
  frequency information. `audio_files` holds `file_path`, `recording_start`, and metadata.
- birda's detection output (BirdNET / Perch) emits only start time, end time, species, and
  confidence. It has no frequency bounds. This is a hard input constraint, not a gap we can fill
  from birda.

Key consequence of the no-frequency constraint: AI-seeded boxes are time-only (they span the full
visible frequency height). The frequency dimension of any box is supplied by the human when they
choose to tighten it. The division of labor is: birda provides time and species; the human
provides frequency bounds and species corrections.

## User experience

### Entry points

The editor needs two entry points, because the Detections page lists detections and so cannot
surface a recording that produced zero detections:

1. Detections page: an "Annotate" action on a detection row opens the editor for the recording
   that owns that detection.
2. Source files panel (`SourceFilesPanel`) / a run's file list: an "Annotate" action on a file
   opens the editor for that recording even when it has no AI detections, so the user can draw
   annotations on a clean file from scratch.

In both cases the editor loads the file's full audio and all of its detections (possibly none).

### Layout

A full-window modal with three zones:

1. Top: transport and view controls (play/pause, play-selection, loop-selection, zoom in/out,
   freqMax selector, spectrogram height, gain). These reuse the existing control patterns and
   message keys where possible.
2. Center: the synchronized waveform (thin, top) and spectrogram (tall, below), inside one
   horizontally scrollable, zoomable wrapper. A custom annotation overlay sits on top of the
   spectrogram.
3. Right (or bottom) side panel: the selected annotation's editable fields (species with
   autocomplete, start/end time, low/high frequency, confidence read-only for AI suggestions,
   status), plus a list of all annotations for the file with their status.

### Annotation boxes

- Each box is positioned over the spectrogram: x and width map to start/end time; y and height map
  to high/low frequency. Time-only boxes (the AI default, and any box the user has not given
  frequency bounds) span the full frequency height.
- Visual states are distinguished by color/border: AI suggested, accepted, manually drawn,
  rejected (rejected boxes are hidden by default with a toggle to reveal them).
- Interactions: click to select; drag body to move; drag edge handles to resize in time and in
  frequency; drag on empty spectrogram to draw a new box; Delete key or button to remove; species
  edited via the side panel (autocomplete backed by the existing species/label service) or an
  inline label.
- Accept turns an AI suggestion into an accepted annotation. Reject marks it rejected so it does
  not reappear as a suggestion on reopen.
- Promoting a time-only box to a frequency-bounded box has explicit semantics. A time-only box
  renders with full height and stores `low_freq_hz` and `high_freq_hz` as null. Dragging its top
  edge sets `high_freq_hz` to the cursor frequency and, if `low_freq_hz` is still null, pins it to
  0 Hz; dragging its bottom edge sets `low_freq_hz` to the cursor frequency and, if `high_freq_hz`
  is still null, pins it to the current freqMax. Once either bound is set the box is
  frequency-bounded. A control on the box reverts it to time-only (both bounds back to null).

### Playback

- Play/pause the whole file. Selecting a box and pressing play-selection plays just that time
  range; loop-selection loops it. This reuses the regions/Web-Audio gain approach already proven
  in `DetectionDetail.svelte`, but driven by the selected annotation's time bounds.

### Keyboard shortcuts

A curation surface lives or dies by keyboard throughput; curating a file with dozens of
detections by mouse alone is too slow. v1 ships these bindings, wired through the existing
`src/renderer/src/lib/utils/shortcuts.ts` helper and active only while the editor is focused:

- Space: play / pause.
- Enter: accept the selected suggestion and advance to the next.
- Tab / Shift+Tab: select next / previous annotation (in time order).
- Delete / Backspace: remove the selected annotation.
- Escape: deselect, or close the editor if nothing is selected.

Shortcuts are suspended while a text input (for example the species field) is focused.

### Unsaved changes

- Edits autosave per action (each accept/edit/draw/delete writes immediately), so there is no
  separate "save" step and closing the editor is always safe. (Alternative considered below.)

## Data model

Detections stay immutable: they are the AI's record of what was found and must not be mutated by
curation. Curated annotations live in a new table.

New table `annotations`:

- `id` INTEGER PK
- `audio_file_id` INTEGER NOT NULL REFERENCES `audio_files(id)` ON DELETE CASCADE
- `detection_id` INTEGER REFERENCES `detections(id)` ON DELETE SET NULL (nullable; set when the
  annotation originated from an AI suggestion)
- `start_time` REAL NOT NULL
- `end_time` REAL NOT NULL
- `low_freq_hz` REAL (nullable; null means time-only / full height)
- `high_freq_hz` REAL (nullable)
- `scientific_name` TEXT NOT NULL
- `confidence` REAL (nullable; carried over from the source detection, null for manual boxes)
- `source` TEXT NOT NULL CHECK in ('birda', 'manual')
- `status` TEXT NOT NULL CHECK in ('accepted', 'rejected', 'manual')
- `created_at`, `updated_at` timestamps

Indexes on `audio_file_id` and `detection_id`.

No `run_id` column. It is intentionally omitted: `audio_files.run_id` is `NOT NULL` with
`ON DELETE CASCADE`, so the analysis run is always reachable by joining through `audio_file_id`,
and a deleted run cascades to its audio files and then to their annotations. A local `run_id` on
`annotations` would be redundant and its `ON DELETE` behavior unreachable.

Future-proofing for Annota-JSON (sub-project 2): the Xeno-canto recording number (`xc_nr`) does
not need a column on `annotations`. Xeno-canto annotation maps a whole recording to one XC number,
and `audio_files.file_name` already stores the source filename (for example `XC123456.wav`), from
which the XC number parses on demand at export time. If profiling later shows the repeated parse
is worth avoiding, sub-project 2 can add a nullable parsed `xc_id` column to `audio_files`; the
editor does not need it.

### Materialization strategy: lazy

When the editor opens a file it loads (a) the file's detections and (b) any stored annotations for
that file, then merges them for display:

- A detection with no matching annotation row shows as an AI suggestion box.
- A detection whose `detection_id` matches an annotation row with status `rejected` is hidden
  (suggestion was dismissed).
- Annotation rows render with their stored bounds/species/status.

Only user actions (accept, edit, draw, reject, delete) create or update annotation rows. Untouched
files write nothing. This keeps detections authoritative, avoids row bloat, and gives later
sub-projects a clean "set of annotations to publish" = stored rows with status in
('accepted', 'manual') for the file.

## Architecture

Follows the project's existing IPC and DB conventions exactly.

- DB: new module `src/main/db/annotations.ts` with CRUD (list by audio_file, upsert, delete) and a
  sequential schema migration in `src/main/db/database.ts` that creates the `annotations` table.
- IPC main: new handler module `src/main/ipc/annotations.ts`, registered in
  `src/main/ipc/handlers.ts`. Channels: list annotations for a file, upsert an annotation, delete
  an annotation. The editor also needs the file's detections (existing channel) and audio path
  (existing `birda-media://`).
- Preload: add the new channel names to `ALLOWED_INVOKE_CHANNELS` in `src/preload/index.ts`.
- Renderer wrappers: typed async functions in `src/renderer/src/lib/utils/ipc.ts`.
- Shared types: `Annotation`, `AnnotationInput`, and an `AnnotationStatus` union in
  `shared/types.ts`.
- Renderer UI: new `AnnotationEditor.svelte` (the modal and its zones) plus small child
  components as needed (for example `AnnotationBox.svelte`, `AnnotationSidePanel.svelte`). State
  is held in a Svelte 5 runes store, for example `src/renderer/src/lib/stores/annotation.svelte.ts`,
  consistent with the existing `$state`-based stores. Species autocomplete reuses the existing
  `SpeciesSearch` component / label service.

### The one hard technical problem: overlay/axis sync

The annotation overlay must stay pixel-aligned with the wavesurfer time axis under horizontal
scroll and zoom, and with the spectrogram frequency axis under freqMax/height changes. This is the
highest-risk piece and must be prototyped before the rest of the editor is built. wavesurfer v7
makes the naive approach fail, so the design is specific:

- Do not inject the overlay into wavesurfer's own container. wavesurfer clears and rebuilds its
  internal canvases on `redraw`, `zoom`, and `destroy`, which would orphan or remove an injected
  overlay. The overlay is a sibling element in a shared parent that also holds wavesurfer's
  wrapper, layered on top with absolute positioning.
- Horizontal scroll is not shared automatically across sibling elements. Sync the overlay's
  `scrollLeft` to wavesurfer's internal scroll container on every wavesurfer `scroll` event (and
  set the overlay's scroll width to match the rendered timeline width).
- Recompute box geometry from (duration, current px-per-second, freqMax, spectrogram height).
  Box x and width come from time times px-per-second; box y and height come from frequency mapped
  against freqMax and the spectrogram pixel height (clamped to Nyquist).
- Trigger recomputation on wavesurfer `zoom` and `redraw`, on freqMax/height/zoom control changes,
  and on a `ResizeObserver` attached to the shared parent. The observer is required: if the window
  resizes while `minPxPerSec` is not forcing a scrollbar, the effective px-per-second changes and
  every box x-coordinate is invalidated even though no wavesurfer event fired.

## Data flow

1. User clicks Annotate on a detection/file. Editor opens with `audioFileId` and `filePath`.
2. Editor loads detections (existing IPC) + annotations (new IPC), merges, renders boxes.
3. wavesurfer loads `birda-media://<path>` and renders waveform + spectrogram; overlay computes
   box geometry once `ready`.
4. User acts on a box. The store updates optimistically and calls the upsert/delete IPC; main
   writes the row and returns the persisted record. Optimistic updates are mandatory-rollback: the
   store snapshots the annotation's prior state before mutating, and if the IPC call throws (for
   example `SQLITE_BUSY` or a disk error) it restores the snapshot and surfaces an error toast, so
   the in-memory state never diverges from the database. On success it reconciles with the
   returned record (for example to pick up the assigned `id` and `updated_at`).
5. Closing the editor returns to Detections. Stored annotations are the durable result.

## Alternatives considered

- Editor location: extend the inline per-detection `DetectionDetail` instead of a whole-file
  editor. Rejected: Xeno-canto annotation and SignaVis are per-recording; users need to see and
  curate all of a file's vocalizations on one timeline, which the +/-2s clip view cannot do.
- Materialization: eagerly create one annotation row per detection on open. Rejected: writes rows
  for untouched files, duplicates AI data, and muddies the "what did the human curate" question.
  Lazy materialization is cleaner.
- Box rendering: reuse the wavesurfer regions plugin. Rejected as the primary mechanism: regions
  are full-height, time-only spans, so they cannot express frequency bounds. We may still reuse
  regions for the play/loop-selection time behavior, but boxes are a custom overlay.
- Save model: explicit save button with a dirty-state guard. Rejected for v1 in favor of
  per-action autosave, which is simpler and avoids data loss; revisit if batch operations arrive.

## Edge cases and error handling

- File missing or unreadable on disk: show an error state, do not crash the editor.
- Long recordings: a multi-minute AudioMoth file produces a wide spectrogram and many boxes.
  Decode and full-file spectrogram rendering may be heavy. v1 targets the Xeno-canto use case
  (short recordings). Long-file performance (windowing/virtualized rendering) is a known risk
  noted under Open questions, not solved here.
- freqMax above Nyquist: clamp the frequency axis and box mapping to Nyquist, as the current view
  already reasons about.
- Overlapping boxes: allowed; selection picks the topmost; z-order favors smaller boxes for
  clickability.
- Empty state: a file with zero detections opens cleanly and supports drawing from scratch.
- Species not in the label set: autocomplete allows free text but flags unknown names.

## Performance considerations

- Reuse the existing spectrogram caching pattern where it helps, but the editor renders a live,
  zoomable spectrogram rather than a cached PNG.
- Box overlay updates must be cheap: position via transforms, batch on animation frames, avoid
  per-box reflow. Cap simultaneous DOM boxes and virtualize if a file has very many detections.

## Testing and validation

The project has no unit-test framework by convention. Validation relies on:

- Strict TypeScript (both tsconfigs), ESLint (type-aware + security + svelte), Prettier, knip.
- `task lint` and `task build` must pass.
- Manual verification: open a real recording, confirm boxes align with the spectrogram under
  zoom/scroll, accept/reject/edit/draw/delete, reopen and confirm persistence and that rejected
  suggestions stay hidden.

## Open questions and dependencies

- None block this sub-project. The Annota-JSON schema (Vellinga and Planque, xeno-canto.org/
  article/321) is needed for sub-project 2, not for the editor. We design the `annotations` table
  to comfortably carry time, frequency, species, and confidence so the later mapping is faithful.
- Long-file rendering performance is the main open risk and should be revisited once the editor
  works on short files.
- Exact placement of the entry point (Detections row action vs source-file panel) to be confirmed
  during implementation against the current Detections UI.
