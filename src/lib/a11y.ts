// The accessibility rules the journey map, its panels and its dialogs share, decided in one place.
// Pure: no imports, no React, and the DOM only by duck typing, so `node --test` loads it directly.
// The React glue that applies these rules lives in a11yHooks.ts. The map's key handling
// (canvasKeyAction) lives in stepNavigation.ts, so there is one rule for what a key on a step does.

/** The smallest text the app renders anywhere on the map, its panels, editors and drawers. */
export const MIN_TEXT_PX = 11;

/** What Tab can reach inside a modal. A tabIndex of -1 (a dialog heading) is focusable but not tabbable. */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ---- The dialog stack ----
// Every open dialog or panel registers here, so Escape closes only the one on top. Without it a
// picker inside the step panel and the panel itself both closed on one press.

let dialogStack: number[] = [];
let nextDialogId = 1;

/** Registers a dialog as the new top of the stack and returns its id. */
export function openDialog(): number {
  const id = nextDialogId++;
  dialogStack.push(id);
  return id;
}

/** Removes a dialog wherever it sits, so a lower dialog closing first never strands the top one. */
export function closeDialog(id: number): void {
  dialogStack = dialogStack.filter(d => d !== id);
}

export function isTopDialog(id: number): boolean {
  return dialogStack.length > 0 && dialogStack[dialogStack.length - 1] === id;
}

/** For tests only: empties the stack. */
export function resetDialogStackForTest(): void {
  dialogStack = [];
  nextDialogId = 1;
}

export interface EscapeContext {
  key: string;
  /** True when something inside already handled this key (a menu, a combobox). */
  defaultPrevented: boolean;
  isTop: boolean;
  modal: boolean;
  /** True when keyboard focus is inside the dialog. */
  focusInside: boolean;
}

/**
 * Escape closes only the top dialog. A modal owns every key while it is open. A non-modal panel
 * sits beside a map that stays usable, so it closes only when focus is inside it.
 */
export function shouldCloseOnEscape({ key, defaultPrevented, isTop, modal, focusInside }: EscapeContext): boolean {
  return key === 'Escape' && !defaultPrevented && isTop && (modal || focusInside);
}

/**
 * Where Tab moves inside a modal, or null to let the browser move. count is the number of tabbable
 * items and index the focused one (-1 when focus is on the dialog itself or outside it). Only the
 * two ends wrap; everything in between is the browser's normal order.
 */
export function nextTrapIndex(count: number, index: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (index === -1) return shift ? count - 1 : 0;
  if (!shift && index === count - 1) return 0;
  if (shift && index === 0) return count - 1;
  return null;
}

interface Connectable {
  isConnected?: boolean;
}

/**
 * Where focus goes when a dialog closes: back to what opened it, or to the fallback (the map
 * region) when that is gone or was the page body. Null when neither can take focus.
 */
export function pickReturnTarget<T extends Connectable>(saved: T | null | undefined, body: unknown, fallback: T | null | undefined): T | null {
  if (saved && saved.isConnected && saved !== body) return saved;
  if (fallback && fallback.isConnected) return fallback;
  return null;
}

export interface RestoreContext {
  active: unknown;
  body: unknown;
  /** True when the focused element is inside the dialog that is closing. */
  insidePanel: boolean;
}

/**
 * A dialog puts focus back only when focus would otherwise be lost: nothing is focused, the body is,
 * or the focused element is inside the dialog that is closing. When the person already moved focus
 * somewhere else on purpose, it stays there.
 */
export function shouldRestoreFocus({ active, body, insidePanel }: RestoreContext): boolean {
  return !active || active === body || insidePanel;
}
