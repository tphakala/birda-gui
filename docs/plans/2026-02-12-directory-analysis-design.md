# Directory Analysis with Durable JSON Output

**Date:** 2026-02-12
**Issue:** [#10](https://github.com/tphakala/birda-gui/issues/10)
**Status:** Approved

## Overview

Add directory analysis support to birda-gui, enabling users to analyze folders containing multiple audio files with crash-resistant progress tracking and incremental database ingestion.

## Current Limitations

The GUI currently only supports single-file analysis using birda CLI's `--stdout` mode:
- Limited to one audio file per analysis run
- All detection data buffered in memory
- Complete data loss if birda crashes mid-analysis
- No batch processing capability

## Proposed Solution

Leverage birda CLI's **dual output mode** (`--output-dir` + `--output-mode ndjson`) to enable directory analysis:
- **Progress events** stream to stdout (existing NDJSON parser)
- **Detection results** written to individual JSON files on disk (crash-resistant)
- **Incremental import** as each file completes (real-time feedback)
- **Automatic cleanup** after successful ingestion

## Architecture

### 1. Enhanced Runner

Modify `runAnalysis()` in [src/main/birda/runner.ts](../../src/main/birda/runner.ts):
- Accept optional `outputDir` parameter in `AnalysisOptions`
- When `outputDir` is set: use `--output-dir {path} --output-mode ndjson`
- When `outputDir` is undefined: use existing `--stdout` mode (no breaking changes)
- Keep same NDJSON stdout parsing infrastructure

### 2. Dual-Mode IPC Handler

Update `birda:analyze` handler in [src/main/ipc/analysis.ts](../../src/main/ipc/analysis.ts):
- Detect if `source_path` is a directory via `fs.stat()`
- **For directories:**
  - Create temp output directory: `{tmpdir}/birda-{timestamp}/`
  - Enable dual output mode via `outputDir` option
  - Handle directory-specific progress events
- **For single files:**
  - Keep existing `--stdout` behavior (backward compatible)

### 3. Incremental JSON Import

Create new function in [src/main/db/detections.ts](../../src/main/db/detections.ts):

```typescript
async function importDetectionsFromJson(
  runId: number,
  locationId: number | null,
  jsonPath: string
): Promise<{ detections: number; sourceFile: string }>
```

Import logic:
- Read and parse `{outputDir}/{basename}.BirdNET.json`
- Extract `metadata.file` for `source_file` field
- Extract `detections[]` array
- Use existing `insertDetections()` (already transactional)
- Return count for progress tracking

### 4. Cleanup & Status

After `pipeline_completed` event:
- Delete temp output directory
- Set run status: `completed` | `completed_with_errors` | `failed`
- Preserve failed directories: No - simpler to accept data loss on crashes

## Execution Flow

```
1. User selects directory → birda:analyze IPC call
2. Handler detects directory, creates temp: /tmp/birda-{timestamp}/
3. Spawn: birda --output-dir /tmp/birda-xxx --output-mode ndjson {dir}
4. Progress events via stdout:
   - pipeline_started {files_total: 10}
   - file_started {file: "recording1.wav", samples: 4410000}
   - progress {percent: 15.0, current_time: 7.5}
   - file_completed {file: "recording1.wav", status: "processed", detections: 23}
     → Import JSON immediately: /tmp/birda-xxx/recording1.BirdNET.json
   - file_started {file: "recording2.wav"...}
   - ...
   - pipeline_completed {status: "success", files_processed: 10}
5. Delete temp output directory
6. Set run status based on file statuses
```

## Event Handling

**Event Handler Updates** ([src/main/ipc/analysis.ts](../../src/main/ipc/analysis.ts)):

| Event | Action |
|-------|--------|
| `pipeline_started` | Extract `files_total`, forward to renderer for progress tracking |
| `file_started` | Update UI with current filename, reset file progress to 0% |
| `progress` | Update per-file progress bar (bottom bar in UI) |
| `file_completed` | - Import JSON: `{outputDir}/{basename}.BirdNET.json`<br>- Increment files completed counter (top bar: "3/10 files")<br>- Track failed/skipped files if `status !== "processed"` |
| `pipeline_completed` | Cleanup temp directory, set final run status |

**Detection Events:** NOT emitted in dual output mode (only progress events).

## File Status Handling

`file_completed` payload includes `status` field:
- **`processed`**: Successfully analyzed, JSON file created → import immediately
- **`failed`**: Error during analysis (corrupted, unsupported format) → log warning
- **`skipped`**: Non-audio file or too small → log info

Final run status logic:
```typescript
const processedCount = totalFiles - skippedFiles.length - failedFiles.length;

if (failedFiles.length > 0) {
  status = processedCount > 0 ? 'completed_with_errors' : 'failed';
} else {
  status = 'completed';
}
```

## Database Changes

### Schema Update

Modify `analysis_runs.status` constraint in [src/main/db/schema.ts](../../src/main/db/schema.ts):

```sql
status TEXT NOT NULL CHECK(status IN (
  'pending',
  'running',
  'completed',
  'failed',
  'completed_with_errors'  -- NEW
))
```

Requires migration:
```typescript
// Migration version N
db.exec(`
  CREATE TABLE analysis_runs_new (
    -- copy schema with new status constraint
  );
  INSERT INTO analysis_runs_new SELECT * FROM analysis_runs;
  DROP TABLE analysis_runs;
  ALTER TABLE analysis_runs_new RENAME TO analysis_runs;
`);
```

### Run Structure

One run per directory:
- `source_path`: Directory path (e.g., `/home/user/recordings/`)
- `status`: Reflects overall batch status
- Detections link via `detection.source_file` (already supports multiple files)

## Type System Changes

### Shared Types ([shared/types.ts](../../shared/types.ts))

```typescript
// Update status union
export interface AnalysisRun {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'completed_with_errors';
  // ... no other changes
}
```

### Event Payload Types ([src/main/birda/types.ts](../../src/main/birda/types.ts))

```typescript
export interface PipelineStartedPayload {
  files_total: number;
}

export interface FileStartedPayload {
  file: string;
  samples: number;
}

export interface ProgressPayload {
  percent: number;
  current_time: number;
}

export interface FileCompletedPayload {
  file: string;
  status: 'processed' | 'failed' | 'skipped';
  detections: number;
  duration_ms: number;
}

export interface PipelineCompletedPayload {
  status: 'success' | 'failed';
  files_processed: number;
}
```

### Runner Options ([src/main/birda/runner.ts](../../src/main/birda/runner.ts))

```typescript
interface AnalysisOptions {
  model: string;
  minConfidence: number;
  latitude?: number | undefined;
  longitude?: number | undefined;
  month?: number | undefined;
  day?: number | undefined;
  dayOfYear?: number | undefined;
  quiet?: boolean | undefined;
  outputDir?: string | undefined;  // NEW: enables dual output mode
}
```

## Error Handling

### Crash Scenarios

| Scenario | Behavior |
|----------|----------|
| **Birda crashes mid-analysis** | Temp directory preserved with partial JSON files, run status = 'failed', no automatic recovery |
| **GUI crashes during analysis** | Birda process continues (detached), orphaned temp files remain, no recovery on restart |
| **Disk full during JSON write** | Birda returns failure status, GUI marks run as 'failed' |

### Partial Failures

```typescript
if (payload.status === 'processed') {
  // Import successful file
  const jsonPath = deriveJsonPath(outputDir, payload.file);
  await importDetectionsFromJson(runId, locationId, jsonPath);
} else if (payload.status === 'skipped') {
  skippedFiles.push(payload.file);
  sendLog(win, 'info', 'analysis', `Skipped ${payload.file}`);
} else if (payload.status === 'failed') {
  failedFiles.push(payload.file);
  sendLog(win, 'warn', 'analysis', `Failed ${payload.file}`);
}
```

### JSON Import Errors

- **File not found:** Log warning, mark file as failed, continue
- **Malformed JSON:** Log error, skip file, continue with others
- **Windows file locking:** Retry with exponential backoff (100ms, 200ms, 400ms)

```typescript
async function readJsonWithRetry(jsonPath: string, maxRetries = 3): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fs.promises.readFile(jsonPath, 'utf-8');
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, i)));
    }
  }
}
```

## Renderer Updates

The existing Analysis page UI already shows "X/Y files · N detections" progress. State tracking needs:

| State Variable | Source | Purpose |
|---------------|--------|---------|
| `totalFiles` | `pipeline_started.files_total` | Overall progress denominator |
| `completedFiles` | Increment on `file_completed` | Overall progress numerator |
| `currentFile` | `file_started.file` | Display current filename |
| `currentFileProgress` | `progress.percent` | Per-file progress bar (bottom) |
| `totalDetections` | Accumulate from `file_completed.detections` | Detection counter |

No UI changes needed - existing components support multi-file tracking.

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Add `outputDir` parameter to `AnalysisOptions` interface
- [ ] Update `runAnalysis()` to conditionally use dual output mode
- [ ] Add new event payload type definitions
- [ ] Create `importDetectionsFromJson()` function
- [ ] Add database migration for `completed_with_errors` status

### Phase 2: IPC Handler
- [ ] Detect directory vs file in `birda:analyze` handler
- [ ] Create temp output directory for directory mode
- [ ] Implement `file_completed` event handler with JSON import
- [ ] Implement `pipeline_completed` event handler with cleanup
- [ ] Track failed/skipped files
- [ ] Update final status logic

### Phase 3: Error Handling
- [ ] Add retry logic for Windows file locking
- [ ] Handle malformed JSON files
- [ ] Implement partial failure status logic
- [ ] Add comprehensive logging

### Phase 4: Testing
- [ ] Test single-file analysis (ensure no regression)
- [ ] Test directory with 10 mixed files (audio + non-audio)
- [ ] Test directory with 100+ files
- [ ] Test cancellation during directory analysis
- [ ] Test partial failures (some files corrupted)
- [ ] Test empty directory
- [ ] Test Windows file locking scenarios

## Future Enhancements

Not included in initial implementation:
- **Resume capability:** Track state in file, recover from crashes
- **Manual JSON import:** Import existing birda CLI output directories
- **Batch size limiting:** Process directories in chunks if > 1000 files
- **Progress persistence:** Save progress to database for audit trail
- **Temp directory management:** Clean up orphaned directories on app start

## Non-Goals

Explicitly out of scope:
- Recursive directory scanning (birda CLI handles this)
- File format validation (birda CLI handles this)
- Pre-flight audio file scanning (trust birda's validation)
- Custom output directory selection (always use temp directories)

## Success Criteria

- Users can analyze directories containing multiple audio files
- Progress tracking shows per-file and overall progress accurately
- Detections appear in database as each file completes
- Partial failures don't lose successful results
- Single-file analysis remains unchanged (backward compatible)
- No memory accumulation regardless of directory size
