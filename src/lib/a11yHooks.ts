// The React glue for the rules in a11y.ts: one hook every dialog and panel uses for focus and
// Escape, and one for tying a <label> to its control. Every dialog that opens over the map (the
// step panel, the Audit, the Forecaster, the product picker, and later prompts) goes through
// useDialogFocus, because Escape can close only the top dialog if every dialog is on one stack.

import { useEffect, useId, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import {
  FOCUSABLE_SELECTOR,
  closeDialog,
  isTopDialog,
  nextTrapIndex,
  openDialog,
  pickReturnTarget,
  shouldCloseOnEscape,
  shouldRestoreFocus
} from './a11y';

export interface DialogFocusOptions {
  /** A modal owns Tab and Escape while open. A non-modal panel closes on Escape only with focus inside. */
  modal: boolean;
  /** A new key while open counts as closing one dialog and opening another (a panel showing another step). */
  key?: string | null;
  /** The element to focus when the opener is gone or was the page body, by id ('journey-map'). */
  fallbackFocusId?: string;
  /**
   * Tried in order before fallbackFocusId, for an opener with no id: a header button that was
   * disabled while it worked ('[data-publish-trigger]'), so focus was on the body when this opened.
   */
  fallbackFocusSelectors?: string[];
  /**
   * Move focus into the dialog on open (its [data-dialog-start] element, usually the heading with
   * tabIndex -1, else the panel). Default true. The docked step panel passes false: it moves focus
   * itself only when the person asked from the map, so the finder's Next can be pressed again.
   */
  initialFocus?: boolean;
}

function isVisible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

/**
 * Focus in on open, Escape for the top dialog only, a Tab trap for a modal, and focus back to the
 * opener on close. Call it before any early `return null`, and put the returned ref on the panel.
 */
export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  { modal, key = null, fallbackFocusId, fallbackFocusSelectors, initialFocus = true }: DialogFocusOptions
): RefObject<T> {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const options = useRef({ modal, fallbackFocusId, fallbackFocusSelectors, initialFocus });
  options.current = { modal, fallbackFocusId, fallbackFocusSelectors, initialFocus };

  useEffect(() => {
    if (!open) return;
    // Kept for cleanup: React clears the ref before passive cleanup runs.
    const panel = ref.current;
    if (!panel) return;
    const id = openDialog();
    const returnTo = document.activeElement as HTMLElement | null;

    if (options.current.initialFocus) {
      const start = panel.querySelector<HTMLElement>('[data-dialog-start]') ?? panel;
      start.focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const { modal: isModal } = options.current;
      if (event.key === 'Escape') {
        const close = shouldCloseOnEscape({
          key: event.key,
          defaultPrevented: event.defaultPrevented,
          isTop: isTopDialog(id),
          modal: isModal,
          focusInside: panel.contains(document.activeElement)
        });
        if (close) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key === 'Tab' && isModal && isTopDialog(id)) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = nextTrapIndex(items.length, index, event.shiftKey);
        if (next === null) {
          // No tabbable item at all: keep focus on the dialog rather than letting Tab leave it.
          if (items.length === 0) event.preventDefault();
          return;
        }
        event.preventDefault();
        items[next].focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      closeDialog(id);
      const active = document.activeElement;
      if (!shouldRestoreFocus({ active, body: document.body, insidePanel: panel.contains(active) })) return;
      const { fallbackFocusId: fallbackId, fallbackFocusSelectors: selectors = [] } = options.current;
      const fallback =
        selectors.map(selector => document.querySelector<HTMLElement>(selector)).find(el => el && isVisible(el)) ??
        (fallbackId ? document.getElementById(fallbackId) : null);
      const target = pickReturnTarget<HTMLElement>(returnTo, document.body, fallback);
      target?.focus({ preventScroll: true });
    };
  }, [open, key]);

  return ref;
}

/**
 * Ids for tying each <label htmlFor> to its control, unique per mounted editor, so two editors
 * (or two copies of one) never share an id. fid('headline') gives 'jv-r1-headline'.
 */
export function useFieldIds(): (name: string) => string {
  const base = useId().replace(/[^A-Za-z0-9_-]/g, '');
  return useMemo(() => (name: string) => `jv-${base}-${name}`, [base]);
}
