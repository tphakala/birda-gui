import type { Attachment } from 'svelte/attachments';

/**
 * Opens a <dialog> as a modal when it mounts: the browser puts it in the top
 * layer, makes the rest of the page inert, and closes it on Escape, which fires
 * the dialog's close event. Use as `<dialog {@attach showModal} onclose={...}>`.
 *
 * Closing through the close event (Escape, the backdrop) returns focus to the
 * element that opened the dialog. Unmounting an open dialog does not, so when
 * the dialog is removed and focus has fallen to the body, the cleanup returns
 * it to that element.
 */
export const showModal: Attachment<HTMLDialogElement> = (dialog) => {
  const opener = document.activeElement;
  dialog.showModal();
  return () => {
    const focused = document.activeElement;
    if (opener instanceof HTMLElement && opener.isConnected && (focused === null || focused === document.body)) {
      opener.focus();
    }
  };
};

/**
 * For a modal-style overlay that is not a <dialog>: focuses the element when it
 * mounts (give it tabindex="-1") and returns focus to the previously focused
 * element when it unmounts.
 */
export const focusWhileMounted: Attachment<HTMLElement> = (element) => {
  const opener = document.activeElement;
  element.focus();
  return () => {
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };
};
