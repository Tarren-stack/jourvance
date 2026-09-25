import React, { useEffect, useState } from 'react';
import { authHeaders } from '../../lib/firebase';
import { BlockEditor, type LibraryRow, type MailBlock } from './EmailBlocks';

type Block = MailBlock;
type Step = { id: string; delayHours: number; subject: string; blocks: Block[] };
type Automation = {
  id: string;
  name: string;
  trigger: string;
  description: string;
  enabled: boolean;
  quietAfterDays?: number | null;
  steps: Step[];
  activeEnrollments: number;
};
type Letter = {
  id: string;
  name: string;
  shopifyNotification: string;
  shopifyTopic: string;
  enabled: boolean;
  subject: string;
  blocks: Block[];
};
type Suite = {
  hubConnected: boolean;
  installed: { id: string; name: string; trigger: string; steps: number }[];
  automations: Automation[];
  transactional: Letter[];
  library?: LibraryRow[];
};

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: 16
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

export const EmailPrograms: React.FC<{ mode: 'automations' | 'transactional' | 'builder' }> = ({ mode }) => {
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

  const load = async () => {
    const headers = await authHeaders();
    const data = await readJson(await fetch('/api/email/suite', { headers }));
    if (data?.suite) {
      setSuite(data.suite);
      if (Array.isArray(data.suite.library)) setLibrary(data.suite.library);
    }
    if (mode === 'builder') {
      const segs = await readJson(await fetch('/api/email/segments', { headers }));
      if (Array.isArray(segs?.segments)) setSegments(segs.segments);
      const audience = await readJson(await fetch('/api/email/audience', { headers }));
      if (Array.isArray(audience?.subscribers)) {
        setPeople(audience.subscribers.map((row: { email?: string; name?: string }) => ({ email: row.email || '', name: row.name || row.email || '' })).filter((row: { email: string }) => row.email));
      }
    }
  };

  useEffect(() => { load(); }, [mode]);

  const saveProgram = async (id: string, kind: 'automation' | 'transactional', patch: Record<string, unknown>) => {
    setNotice('');
    const res = await fetch(`/api/email/programs/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ kind, ...patch })
    });
    const data = await readJson(res);
    if (!res.ok || !data?.success) {
      setNotice(data?.error || 'That change was not saved.');
      return;
    }
    setSuite(data.suite);
    setNotice('Saved. A letter sends only after you turn it on and the email service accepts it.');
  };

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

  if (!suite) {
    return <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading the email suite…</p>;
  }

  if (mode === 'automations') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: '#f3f4f6' }}>Automations</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af' }}>
            Welcome and abandoned checkout already run from the queue below. These two stay off until you turn them on. The queue tick is what sends the next due step.
          </p>
        </div>
        {suite.installed.map((row) => (
          <div key={row.id} style={card}>
            <div style={{ fontWeight: 700, color: '#f3f4f6' }}>{row.name}</div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>On for new {row.trigger.replace(/_/g, ' ')} events · {row.steps} steps · queue sequence</div>
          </div>
        ))}
        {suite.automations.map((row) => (
          <AutomationCard key={row.id} row={row} onSave={saveProgram} />
        ))}
        {notice && <p style={{ margin: 0, fontSize: 12, color: '#d1d5db' }}>{notice}</p>}
      </div>
    );
  }

  if (mode === 'transactional') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: '#f3f4f6' }}>Transactional letters</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af', maxWidth: 720 }}>
            These are the customer letters Shopify sends for an order, a fulfillment, a cancellation, and a refund. Each one here stays off until you turn it on.
            Shopify keeps sending its own copy until you turn that notification off in Shopify admin. Jourvance does not change those Shopify settings.
            {!suite.hubConnected && ' Email sending is not connected on this server, so turning a letter on will not deliver it.'}
          </p>
        </div>
        {suite.transactional.map((row) => (
          <LetterCard key={row.id} row={row} onSave={saveProgram} onPreview={preview} />
        ))}
        {previewHtml && (
          <div style={card}>
            <div style={label}>Sample preview · not a real order</div>
            <iframe title="Email preview" sandbox="" srcDoc={previewHtml} style={{ width: '100%', height: 280, marginTop: 8, background: '#fff', border: 0, borderRadius: 8 }} />
          </div>
        )}
        {notice && <p style={{ margin: 0, fontSize: 12, color: '#d1d5db' }}>{notice}</p>}
      </div>
    );
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

const AutomationCard: React.FC<{ row: Automation; onSave: (id: string, kind: 'automation', patch: Record<string, unknown>) => void }> = ({ row, onSave }) => {
  const [steps, setSteps] = useState(row.steps);
  useEffect(() => setSteps(row.steps), [row.id, row.enabled]);
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, color: '#f3f4f6' }}>{row.name}</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{row.description}</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{row.enabled ? 'On' : 'Off'} · {row.activeEnrollments} active</div>
        </div>
        <button type="button" style={row.enabled ? solidBtn : ghostBtn} onClick={() => onSave(row.id, 'automation', { enabled: !row.enabled, steps })}>
          {row.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      {steps.map((step, index) => (
        <div key={step.id} style={{ marginTop: 10 }}>
          <div style={label}>Step {index + 1} · wait {step.delayHours} hours</div>
          <input style={{ ...field, marginTop: 6 }} value={step.subject} onChange={(e) => setSteps(steps.map((s, i) => i === index ? { ...s, subject: e.target.value } : s))} />
          <textarea
            style={{ ...field, minHeight: 72, marginTop: 6 }}
            value={step.blocks.filter((b) => b.kind === 'text' || b.kind === 'heading').map((b) => b.text).join('\n\n')}
            onChange={(e) => setSteps(steps.map((s, i) => i === index ? { ...s, blocks: [{ id: s.blocks[0]?.id || `t_${i}`, kind: 'text', text: e.target.value }] } : s))}
          />
        </div>
      ))}
      <button type="button" style={{ ...ghostBtn, marginTop: 8 }} onClick={() => onSave(row.id, 'automation', { enabled: row.enabled, steps })}>Save steps</button>
    </div>
  );
};

const LetterCard: React.FC<{
  row: Letter;
  onSave: (id: string, kind: 'transactional', patch: Record<string, unknown>) => void;
  onPreview: (subject: string, blocks: Block[]) => void;
}> = ({ row, onSave, onPreview }) => {
  const [subject, setSubject] = useState(row.subject);
  const [blocks, setBlocks] = useState(row.blocks);
  useEffect(() => { setSubject(row.subject); setBlocks(row.blocks); }, [row.id, row.enabled]);
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, color: '#f3f4f6' }}>{row.name}</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
            Same job as Shopify’s “{row.shopifyNotification}” notification. Shopify still sends its own until you turn it off there. Webhook topic {row.shopifyTopic}. {row.enabled ? 'On.' : 'Off.'}
          </div>
        </div>
        <button type="button" style={row.enabled ? solidBtn : ghostBtn} onClick={() => onSave(row.id, 'transactional', { enabled: !row.enabled, subject, blocks })}>
          {row.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <label style={{ ...label, display: 'block', marginTop: 10 }}>Subject</label>
      <input style={{ ...field, marginTop: 6 }} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <div style={{ marginTop: 8 }}>
        <BlockEditor blocks={blocks} onChange={setBlocks} library={[]} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" style={ghostBtn} onClick={() => onPreview(subject, blocks)}>Preview sample</button>
        <button type="button" style={ghostBtn} onClick={() => onSave(row.id, 'transactional', { enabled: row.enabled, subject, blocks })}>Save letter</button>
      </div>
    </div>
  );
};
