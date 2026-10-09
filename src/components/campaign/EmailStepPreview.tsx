import React, { useState } from 'react';
import { authHeaders } from '../../lib/firebase';
import { ghostBtn, label, readJson } from './emailChrome';
import { settleRead } from '../../lib/flowMapLoad';
import type { MailBlock } from './EmailBlocks';

/**
 * An order email's sample preview, in the flow editor's step panel (EMAIL_STUDIO_PLAN.md Wave 4).
 * The order letter cards had "Preview sample" before the order emails moved into the Flows list, so
 * the move keeps it: POST /api/email/programs/preview with the sample order, for the subject and
 * blocks on screen, saved or not. Nothing is sent. Wave 5 brings a preview to every email.
 */
export const EmailStepPreview: React.FC<{ subject: string; blocks: MailBlock[] }> = ({ subject, blocks }) => {
  const [html, setHtml] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const show = async () => {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      const read = await settleRead(async () => readJson(await fetch('/api/email/programs/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        // marketing: false, as sendTransactional sends an order email (server.mjs), so the preview has its footer.
        body: JSON.stringify({ subject, blocks, merge: 'sample', marketing: false })
      })));
      if (!read.answered) {
        setNote('The server did not answer, so there is no preview.');
        return;
      }
      if (typeof read.data?.html !== 'string' || !read.data.html) {
        setNote(read.data?.error || 'The preview could not be made.');
        return;
      }
      setHtml(read.data.html);
      setNote(read.data.label || 'Sample preview. Nothing was sent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page. */}
      <button type="button" style={{ ...ghostBtn, alignSelf: 'flex-start', minHeight: 44 }} aria-disabled={busy} onClick={show}>
        {busy ? 'Making the preview' : 'Preview sample'}
      </button>
      <p role="status" style={{ margin: 0, fontSize: 12, color: '#d1d5db' }}>{note}</p>
      {html && (
        <>
          <span style={label}>Sample preview · not a real order</span>
          <iframe title="Order email preview" sandbox="" srcDoc={html} style={{ width: '100%', height: 320, background: '#fff', border: 0, borderRadius: 8 }} />
        </>
      )}
    </div>
  );
};
