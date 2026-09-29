/** What a combobox input should do in response to a key press. */
export type ComboboxAction =
  { kind: 'move'; active: number } | { kind: 'select'; index: number } | { kind: 'close' } | { kind: 'ignore' };

/**
 * Keyboard model for a listbox combobox. `active` is the highlighted option
 * index (-1 for none) and `count` the number of options. Anything other than
 * 'ignore' means the key was handled and its default action should be blocked.
 */
export function comboboxKey(key: string, state: { open: boolean; active: number }, count: number): ComboboxAction {
  switch (key) {
    case 'ArrowDown':
      if (count <= 0) return { kind: 'ignore' };
      if (!state.open) return { kind: 'move', active: 0 };
      return { kind: 'move', active: (state.active + 1) % count };
    case 'ArrowUp':
      if (count <= 0) return { kind: 'ignore' };
      if (!state.open || state.active <= 0) return { kind: 'move', active: count - 1 };
      return { kind: 'move', active: state.active - 1 };
    case 'Enter':
      if (state.open && state.active >= 0 && state.active < count) {
        return { kind: 'select', index: state.active };
      }
      return { kind: 'ignore' };
    case 'Escape':
      return state.open ? { kind: 'close' } : { kind: 'ignore' };
    default:
      return { kind: 'ignore' };
  }
}
