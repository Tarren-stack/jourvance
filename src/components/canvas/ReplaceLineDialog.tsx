import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ReplacePrompt } from '../../lib/connectionRules';
import { useDialogFocus } from '../../lib/a11yHooks';

// "Replace this line?" (#13): asked when a line is drawn from a branch that already has one.
// A native modal <dialog>, so the map behind it is inert, and it sits on the shared dialog stack
// (useDialogFocus, #19), so Escape closes this and never the docked step panel under it. Cancel
// has focus. On close by any route, focus goes where the caller says (the step the line leaves),
// because a drag leaves nothing sensible focused to return to. Reusable for other confirms.

interface ReplaceLineDialogProps {
  /** The words to show, from replacePrompt(). Null keeps the dialog closed. */
  prompt: ReplacePrompt | null;
  onReplace: () => void;
  /** Cancel, Escape. Called once per opening. */
  onCancel: () => void;
  /** Runs after the dialog has closed, by either route. */
  returnFocus?: () => void;
}

export const ReplaceLineDialog: React.FC<ReplaceLineDialogProps> = ({ prompt, onReplace, onCancel, returnFocus }) => {
  const open = prompt !== null;
  const titleId = useId();
  const bodyId = useId();
  // One answer per opening, however many ways the close arrives (Escape reaches both the stack
  // handler and the native cancel event) and however fast the button is pressed twice.
  const settled = useRef(false);

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };
  const replace = () => {
    if (settled.current) return;
    settled.current = true;
    onReplace();
  };

  // Registers on the dialog stack, handles Escape as the top dialog and keeps Tab inside.
  const dialogRef = useDialogFocus<HTMLDialogElement>(open, cancel, { modal: true });

  // A layout effect, so the dialog is open before useDialogFocus moves focus into it.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      settled.current = false;
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, dialogRef]);

  // Declared after useDialogFocus, so its focus restore has already run and this one wins.
  const wasOpen = useRef(false);
  const returnFocusRef = useRef(returnFocus);
  returnFocusRef.current = returnFocus;
  useEffect(() => {
    if (wasOpen.current && !open) returnFocusRef.current?.();
    wasOpen.current = open;
  }, [open]);

  // Closing the page while it is open must not leave a modal behind.
  useEffect(() => () => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
  }, [dialogRef]);

  return (
    <dialog
      ref={dialogRef}
      className="jv-replace-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={e => {
        e.preventDefault();
        cancel();
      }}
      style={{
        background: '#0F172A',
        color: '#F8FAFC',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 12,
        padding: 20,
        width: 'min(440px, calc(100vw - 32px))',
        maxWidth: 'calc(100vw - 32px)',
        boxSizing: 'border-box',
        boxShadow: '0 20px 48px rgba(0, 0, 0, 0.6)'
      }}
    >
      <h2 id={titleId} style={{ margin: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.3, color: '#F8FAFC' }}>
        {prompt?.title ?? ''}
      </h2>
      <p id={bodyId} style={{ margin: '8px 0 20px', fontSize: 14, lineHeight: 1.5, color: '#CBD5E1' }}>
        {prompt?.body ?? ''}
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          autoFocus
          data-dialog-start
          onClick={cancel}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.24)',
            background: 'transparent',
            color: '#E2E8F0',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={replace}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #4F46E5',
            background: '#4F46E5',
            color: '#FFFFFF',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          {prompt?.confirm ?? 'Replace line'}
        </button>
      </div>
    </dialog>
  );
};

export default ReplaceLineDialog;
