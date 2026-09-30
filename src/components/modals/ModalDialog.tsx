import React, { useEffect, useRef } from 'react';
import { useDialogFocus } from '../../lib/a11yHooks';

/**
 * A modal on the native <dialog> element, ported from Aura's JourneyDialog. Native modality keeps
 * keyboard and assistive technology out of the page behind it. useDialogFocus puts it on the one
 * dialog stack, so Escape closes only the top dialog, Tab stays inside, and focus goes back to
 * whatever opened it.
 *
 * index.css's `* { margin: 0 }` pins a dialog to the top-left corner, so the margin is set here.
 * The backdrop colour and the focus ring live in index.css as `.jv-dialog` rules.
 */

const FIRST_CONTROL = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

interface ModalDialogProps {
  /** The id of the visible heading that names the dialog. */
  labelledBy: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
  /**
   * The child draws its own panel (the header overlays), so the dialog adds no box of its own: a
   * click on the dialog itself is a click beside that panel. The child keeps its own max-height.
   */
  bare?: boolean;
  /** Where focus goes on close when the opener is gone, tried in order (see useDialogFocus). */
  fallbackFocusSelectors?: string[];
}

export const ModalDialog: React.FC<ModalDialogProps> = ({ labelledBy, onClose, children, maxWidth = 640, bare = false, fallbackFocusSelectors }) => {
  // A press of Escape reaches both the stack's keydown handler and the dialog's own cancel
  // event. Either may close, never both. The guard lifts after that press, because an onClose
  // may close something inside the dialog (a confirm step) and leave the dialog open.
  const closedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const requestClose = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCloseRef.current();
    setTimeout(() => { closedRef.current = false; }, 0);
  };

  // Declared before the effect below on purpose: effects run in order, so the hook remembers the
  // opener before showModal() moves focus into the dialog.
  const ref = useDialogFocus<HTMLDialogElement>(true, requestClose, { modal: true, initialFocus: false, fallbackFocusSelectors });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    closedRef.current = false;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // Not connected, or already open as a non-modal: show it anyway rather than nothing.
        dialog.setAttribute('open', '');
      }
    }
    dialog.querySelector<HTMLElement>(FIRST_CONTROL)?.focus({ preventScroll: true });
    // Closing here also covers StrictMode's second run: the next run opens it again.
    return () => {
      if (dialog.open) dialog.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={ref}
      className="jv-dialog"
      aria-labelledby={labelledBy}
      onCancel={event => {
        event.preventDefault();
        requestClose();
      }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        if (bare) {
          requestClose();
          return;
        }
        const box = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
        if (outside) requestClose();
      }}
      style={bare ? {
        margin: 'auto',
        background: 'transparent',
        color: 'var(--color-text-main)',
        border: 'none',
        padding: 0,
        width: `min(${maxWidth}px, calc(100vw - 32px))`,
        maxWidth: 'none',
        maxHeight: 'none',
        overflow: 'visible',
        boxSizing: 'border-box',
        textAlign: 'left'
      } : {
        margin: 'auto',
        background: 'var(--color-surface-1)',
        color: 'var(--color-text-main)',
        border: '1px solid var(--color-border)',
        borderRadius: '12px',
        width: `min(${maxWidth}px, calc(100vw - 32px))`,
        maxWidth: 'none',
        maxHeight: '85dvh',
        overflowY: 'auto',
        padding: '20px',
        boxSizing: 'border-box',
        textAlign: 'left'
      }}
    >
      {children}
    </dialog>
  );
};

export default ModalDialog;
