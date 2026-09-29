/** The id when an item with that id is still listed, otherwise null. */
export function keepIfPresent(id: number | null, items: readonly { id: number }[]): number | null {
  return id !== null && items.some((item) => item.id === id) ? id : null;
}

/**
 * The run to select after the run list reloaded. The selected run stays selected
 * while it is listed. When it is gone, for example replaced by a newer analysis of
 * the same source and model, the newest run of that source and model is selected,
 * or none when there is no such run or the previous run was never known.
 */
export function reconcileSelectedRun(
  selectedId: number | null,
  previous: { source_path: string; model: string } | undefined,
  runs: readonly { id: number; source_path: string; model: string }[],
): number | null {
  if (selectedId === null) return null;
  if (runs.some((run) => run.id === selectedId)) return selectedId;
  if (!previous) return null;
  let replacement: number | null = null;
  for (const run of runs) {
    if (run.source_path === previous.source_path && run.model === previous.model) {
      if (replacement === null || run.id > replacement) replacement = run.id;
    }
  }
  return replacement;
}
