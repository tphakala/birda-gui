import type { Attachment } from 'svelte/attachments';

/**
 * Opens a <dialog> as a modal when it mounts: the browser puts it in the top
 * layer, makes the rest of the page inert, and closes it on Escape, which fires
 * the dialog's close event. Use as `<dialog {@attach showModal} onclose={...}>`.
 */
export const showModal: Attachment<HTMLDialogElement> = (dialog) => {
  dialog.showModal();
};
