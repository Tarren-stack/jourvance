import React, { useEffect, useState } from 'react';
import { authHeaders } from '../../lib/firebase';
import { BlockEditor, type LibraryRow, type MailBlock } from './EmailBlocks';

type Block = MailBlock;
// The Builder reads only the saved-block library off the suite. The starter, built-in and order
// email lists that used to be drawn here are the Flows list now (EmailFlowsList.tsx, Wave 4).
type Suite = {
  library?: LibraryRow[];
};

const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' };
const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(0,0,0,0.35)',
  color: '#f3f4f6',
  fontSize: 13
};

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

export const EmailPrograms: React.FC<{
  mode: 'builder';
}> = ({ mode }) => {
  const [suite, setSuite] = useState<Suite | null>(null);
  const [notice, setNotice] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [segments, setSegments] = useState<{ id: string; name: string; count: number }[]>([]);
  const [draftSubject, setDraftSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [draftBlocks, setDraftBlocks] = useState<Block[]>([
    { id: 'b1', kind: 'heading', text: '' },
    { id: 'b2', kind: 'text', text: '' }
  ]);
  const [segmentId, setSegmentId] = useState('all');
  const [sending, setSending] = useState(false);
  const [previewLabel, setPreviewLabel] = useState('');
  const [untranslated, setUntranslated] = useState<string[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [people, setPeople] = useState<{ email: string; name: string }[]>([]);
  const [personEmail, setPersonEmail] = useState('');
  const [library, setLibrary] = useState<LibraryRow[]>([]);
  const [loadError, setLoadError] = useState(false);

  const load = async () => {
    setLoadError(false);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/email/suite', { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await readJson(res);
      if (data?.suite) {
        setSuite(data.suite);
        if (Array.isArray(data.suite.library)) setLibrary(data.suite.library);
      } else {
        setLoadError(true);
      }
      if (mode === 'builder') {
        const segs = await readJson(await fetch('/api/email/segments', { headers }));
        if (Array.isArray(segs?.segments)) setSegments(segs.segments);
        const audience = await readJson(await fetch('/api/email/audience', { headers }));
        if (Array.isArray(audience?.subscribers)) {
          setPeople(audience.subscribers.map((row: { email?: string; name?: string }) => ({ email: row.email || '', name: row.name || row.email || '' })).filter((row: { email: string }) => row.email));
        }
      }
    } catch (err) {
      console.warn('[Jourvance] Email suite load error:', err);
      setLoadError(true);
    }
  };

  useEffect(() => { load(); }, [mode]);

  const preview = async (subject: string, blocks: Block[], merge: 'sample' | 'person' | 'keep' = 'sample', email = '', line = '') => {
    const data = await readJson(await fetch('/api/email/programs/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ subject, blocks, merge, email, previewText: line })
    }));
    if (data?.html) setPreviewHtml(data.html);
    setPreviewLabel(data?.label || '');
    setUntranslated(Array.isArray(data?.untranslated) ? data.untranslated : []);
    setHiddenCount(Number(data?.hidden) || 0);
  };

  const saveCopy = async (block: Block) => {
    const data = await readJson(await fetch('/api/email/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ name: block.kind, block })
    }));
    if (Array.isArray(data?.library)) setLibrary(data.library);
    setNotice(data?.error || 'Saved a copy of that block.');
  };

  const deleteCopy = async (id: string) => {
    const data = await readJson(await fetch(`/api/email/library/${id}`, { method: 'DELETE', headers: await authHeaders() }));
    if (Array.isArray(data?.library)) setLibrary(data.library);
  };

  if (loadError && !suite) {
    return (
      <div style={{
        padding: '32px 24px',
        textAlign: 'center',
        background: 'rgba(239, 68, 68, 0.05)',
        border: '1px solid rgba(239, 68, 68, 0.15)',
        borderRadius: '12px',
        margin: '16px 0'
      }}>
        <p style={{ color: '#f87171', fontSize: '13px', margin: '0 0 16px', fontWeight: 600 }}>
          Unable to load the email suite at this moment.
        </p>
        <button
          onClick={load}
          style={{
            background: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
            color: '#ffffff',
            border: 'none',
            padding: '8px 18px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          Retry Loading
        </button>
      </div>
    );
  }

  if (!suite) {
    return <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading the email suite…</p>;
  }

  const sendDraft = async () => {
    setSending(true);
    setNotice('');
    try {
      const previewData = await readJson(await fetch('/api/email/programs/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ subject: draftSubject, blocks: draftBlocks, merge: 'keep' })
      }));
      const res = await fetch('/api/email/campaign/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          subject: draftSubject,
          previewText,
          blocks: draftBlocks,
          segmentId,
          sendMode: 'direct'
        })
      });
      const data = await readJson(res);
      setNotice(data?.message || data?.error || (res.ok ? 'Sent.' : 'The send did not go out.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 820 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, color: '#f3f4f6' }}>Email builder</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af' }}>
          Add columns, a product, a coupon, or HTML. A coupon preview shows the word Code and does not create a Shopify discount. A postal address and an unsubscribe link are added on send. A send counts only when the email service accepts it.
        </p>
      </div>
      <label style={label}>Subject</label>
      <input style={field} value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} placeholder="Subject line" />
      <label style={label}>Preview text</label>
      <input style={field} value={previewText} onChange={(e) => setPreviewText(e.target.value)} placeholder="The line inbox apps show before the letter is opened" />
      <BlockEditor blocks={draftBlocks} onChange={setDraftBlocks} library={library} onSaveCopy={saveCopy} onDeleteCopy={deleteCopy} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={label}>Audience</label>
        <select style={{ ...field, width: 'auto' }} value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
          {(segments.length ? segments : [{ id: 'all', name: 'All active subscribers', count: 0 }]).map((seg) => (
            <option key={seg.id} value={seg.id}>{seg.name} ({seg.count})</option>
          ))}
        </select>
        <button type="button" onClick={() => preview(draftSubject, draftBlocks, 'sample', '', previewText)} style={ghostBtn}>Preview sample</button>
        <label style={label}>Person
          <select style={{ ...field, width: 'auto', marginLeft: 6 }} aria-label="Person to preview" value={personEmail} onChange={(e) => setPersonEmail(e.target.value)}>
            <option value="">Choose a person</option>
            {people.map((person) => <option key={person.email} value={person.email}>{person.name} · {person.email}</option>)}
          </select>
        </label>
        <button type="button" style={ghostBtn} disabled={!personEmail} onClick={() => preview(draftSubject, draftBlocks, 'person', personEmail, previewText)}>Preview as this person</button>
        <button type="button" style={ghostBtn} aria-pressed={previewWidth === 'desktop'} onClick={() => setPreviewWidth('desktop')}>Desktop width</button>
        <button type="button" style={ghostBtn} aria-pressed={previewWidth === 'mobile'} onClick={() => setPreviewWidth('mobile')}>Mobile width</button>
        <button type="button" style={ghostBtn} onClick={async () => {
          const previewData = await readJson(await fetch('/api/email/programs/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body: JSON.stringify({ subject: draftSubject, blocks: draftBlocks, merge: 'keep', previewText })
          }));
          const checked = await readJson(await fetch('/api/email/lint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body: JSON.stringify({ subject: draftSubject, html: previewData?.html || '' })
          }));
          const warnings = Array.isArray(checked?.warnings) ? checked.warnings.join(' ') : '';
          setNotice(checked?.error || warnings || (checked?.score != null ? `Check score ${checked.score}.` : 'The check finished.'));
        }}>Check this letter</button>
        <button type="button" onClick={sendDraft} disabled={sending || !draftSubject.trim()} style={solidBtn}>{sending ? 'Sending…' : 'Send'}</button>
      </div>
      {previewLabel && <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>{previewLabel}</p>}
      {untranslated.length > 0 && <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>Not translated: {untranslated.join(', ')}. These tags were removed.</p>}
      {hiddenCount > 0 && <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>Some blocks are hidden for this preview.</p>}
      {previewHtml && <iframe title="Builder preview" sandbox="" srcDoc={previewHtml} style={{ width: previewWidth === 'mobile' ? 375 : '100%', maxWidth: '100%', height: 420, background: '#fff', border: 0, borderRadius: 8 }} />}
      {notice && <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>{notice}</p>}
    </div>
  );
};

const ghostBtn: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#e5e7eb', cursor: 'pointer', fontSize: 12, fontWeight: 600
};
const solidBtn: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(236,72,153,0.4)', background: 'rgba(236,72,153,0.18)', color: '#f9a8d4', cursor: 'pointer', fontSize: 12, fontWeight: 700
};
