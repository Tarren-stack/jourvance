/**
 * Whether a modal dialog is open on the page. The content behind a modal is inert to the person
 * and to assistive tech, so a page-wide shortcut must not change it: Cmd+Z behind Check design
 * undid its fix while the drawer still offered its own Undo.
 *
 * Two kinds of modal are in use: an element marked aria-modal="true" (the drawers), and a native
 * <dialog> opened with showModal() (the step picker, ModalDialog). A browser without :modal
 * throws on the selector, and there any open <dialog> counts.
 */
export interface ModalQueryRoot {
  querySelector(selectors: string): unknown;
}

export function modalIsOpen(root: ModalQueryRoot | null | undefined): boolean {
  if (!root) return false;
  if (root.querySelector('[aria-modal="true"]')) return true;
  try {
    return !!root.querySelector('dialog:modal');
  } catch {
    return !!root.querySelector('dialog[open]');
  }
}
