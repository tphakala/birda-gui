/**
 * Gate for overlapping async loads. Each call starts a load and returns a check
 * that stays true only until the next load starts, so a slow, older response
 * can be dropped instead of overwriting newer state.
 */
export function latestRequest(): () => () => boolean {
  let current = 0;
  return () => {
    const mine = ++current;
    return () => mine === current;
  };
}
