// "Rewrite with AI" for one piece of text in the inspector (LANDING_BUILDER_PLAN.md, Wave 3): the
// current text and an optional one-line brief go to POST /api/ai/builder-rewrite, and the answer is
// handed to `onApply`, which the inspector turns into one ordinary, undoable setProps. Nothing is
// applied without the merchant pressing Rewrite, and nothing is invented here: when AI copy is off on
// this server the route's own sentence is shown as it came, and a failed call changes nothing.

import React, { useId, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { rewriteBuilderText, type RewriteKind } from '../../lib/builderRewriteClient';
import { inputStyle, labelStyle, smallButton } from './BuilderFields';

/** Which widget props offer a rewrite, and what kind of text each is. */
export const REWRITABLE: Readonly<Record<string, Readonly<Record<string, RewriteKind>>>> = Object.freeze({
  heading: Object.freeze({ text: 'heading' as RewriteKind }),
  text: Object.freeze({ text: 'text' as RewriteKind }),
  button: Object.freeze({ label: 'button' as RewriteKind }),
  iconList: Object.freeze({ items: 'list' as RewriteKind })
});

/** The brief the route accepts (server/routes/aiJourneyRoutes.mjs caps it at 300). */
const BRIEF_MAX = 300;

export interface RewriteControlProps {
  kind: RewriteKind;
  /** What the field holds now. A list's points joined by new lines. */
  text: string;
  /** Names the control for assistive technology: "Rewrite Text with AI". */
  name: string;
  /** Hands back the new words: a string, or the points of a list. */
  onApply: (value: string | string[]) => void;
  /** Says an outcome in the builder's live region as well as showing it here. */
  onSay: (text: string) => void;
}

export const RewriteControl: React.FC<RewriteControlProps> = ({ kind, text, name, onApply, onSay }) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const empty = !text.trim() && !brief.trim();

  const run = async () => {
    if (busy || empty) return;
    setBusy(true);
    setMessage(null);
    const r = await rewriteBuilderText(kind, text, brief.trim() || undefined);
    setBusy(false);
    if (r.ok) {
      onApply('items' in r ? r.items : r.text);
      const done = `${name} rewritten. Undo brings back the old words.`;
      setMessage({ text: done, tone: 'ok' });
      onSay(done);
      return;
    }
    // The route's own sentence, except when the AI is off: readRewriteAnswer then says so in the
    // merchant's words (REWRITE_UNAVAILABLE), since the route's sentence names the hub key.
    setMessage({ text: r.message, tone: 'bad' });
    onSay(r.message);
  };

  return (
    <div style={{ margin: '-4px 0 12px' }}>
      <button
        type="button"
        data-rewrite-toggle={kind}
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        aria-label={`Rewrite with AI: ${name}`}
        onClick={() => setOpen(o => !o)}
        style={smallButton}
      >
        <Sparkles size={12} aria-hidden="true" />
        <span>Rewrite with AI</span>
      </button>
      {open && (
        <div id={`${id}-panel`} style={{ marginTop: '6px', padding: '8px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <label htmlFor={`${id}-brief`} style={labelStyle}>What should it do? One line, optional</label>
          <input
            id={`${id}-brief`}
            type="text"
            value={brief}
            maxLength={BRIEF_MAX}
            onChange={e => setBrief(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void run();
              }
            }}
            style={{ ...inputStyle, marginBottom: '6px' }}
          />
          <button
            type="button"
            data-rewrite-run={kind}
            aria-disabled={busy || empty}
            onClick={() => void run()}
            style={{ ...smallButton, backgroundColor: '#4338CA', borderColor: '#4338CA', color: '#FFFFFF', opacity: busy || empty ? 0.6 : 1 }}
          >
            {busy ? 'Rewriting' : 'Rewrite'}
          </button>
          {empty && <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#94A3B8' }}>Write the text, or say what it should do.</p>}
          {message && (
            <p data-rewrite-message="" role={message.tone === 'bad' ? 'alert' : 'status'} style={{ margin: '6px 0 0', fontSize: '11px', color: message.tone === 'bad' ? '#FCA5A5' : '#A7F3D0' }}>
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
