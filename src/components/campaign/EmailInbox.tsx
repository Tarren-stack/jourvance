import React, { useEffect, useState } from 'react';
import { authHeaders } from '../../lib/firebase';
import { card, field, ghostBtn, label, readJson, solidBtn } from './emailChrome';
import { INBOX_HOLDS, LIST_LOADING, REPLIES_LIST, REPLIES_READ, REPLY_POLICY_HOLDS, REPLY_POLICY_READ, listLine, readOutcome, studioRead, type ListState } from '../../lib/studioLoad';
import { StudioListLine } from './StudioListLine';

type InboxMessage = {
  id: string;
  from?: string;
  subject?: string;
  text?: string;
  snippet?: string;
  status?: string;
  receivedAt?: string;
  aiDraft?: { text?: string };
};

export const EmailInbox: React.FC = () => {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [policy, setPolicy] = useState('off');
  const [notice, setNotice] = useState('');
  const [reply, setReply] = useState<Record<string, string>>({});
  const [open, setOpen] = useState('');
  // D6 (Wave 6): each read has its own state. "No replies have arrived" is said only of an inbox the
  // server answered with; a failed read says it failed, with Retry where retrying can help.
  const [boxLoad, setBoxLoad] = useState<ListState>(LIST_LOADING);
  const [policyLoad, setPolicyLoad] = useState<ListState>(LIST_LOADING);
  const [reading, setReading] = useState(false);

  const load = async () => {
    setReading(true);
    try {
      const headers = await authHeaders();
      const [box, pol] = await Promise.all([
        studioRead('/api/email/inbox', headers),
        studioRead('/api/email/inbox/policy', headers)
      ]);
      // Only a body that says success: one with no messages field is an inbox with none, as before (INBOX_HOLDS).
      const boxOutcome = readOutcome(box, REPLIES_READ, INBOX_HOLDS);
      setBoxLoad(boxOutcome);
      if (boxOutcome.state === 'loaded' && box.answered) {
        setMessages(Array.isArray(box.data.messages) ? box.data.messages : []);
        setCounts(box.data.counts && typeof box.data.counts === 'object' ? box.data.counts : {});
      }
      const policyOutcome = readOutcome(pol, REPLY_POLICY_READ, REPLY_POLICY_HOLDS);
      setPolicyLoad(policyOutcome);
      const mode = policyOutcome.state === 'loaded' && pol.answered ? pol.data.policy?.autopilot : undefined;
      if (mode === 'off' || mode === 'draft' || mode === 'auto') setPolicy(mode);
    } finally {
      setReading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const setAutopilot = async (next: string) => {
    const res = await fetch('/api/email/inbox/policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ autopilot: next })
    });
    const data = await readJson(res);
    setNotice(data?.error || 'Reply policy saved.');
    if (!data?.error) {
      setPolicy(next);
      // The server took this policy, so it is known even when the first read of it failed.
      setPolicyLoad({ state: 'loaded' });
    }
  };

  const act = async (id: string, path: string, body?: Record<string, unknown>) => {
    const res = await fetch(`/api/email/inbox/${id}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body || {})
    });
    const data = await readJson(res);
    setNotice(data?.error || (path === 'reply' ? 'Reply sent.' : path === 'draft' ? 'Draft ready. It is not sent until you reply.' : 'Updated.'));
    await load();
  };

  const countLine = Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, color: '#f3f4f6' }}>Inbox</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af', maxWidth: 720 }}>
          Replies that arrive for this account. A draft is a suggestion. Nothing goes out until you send the reply.
        </p>
      </div>
      <div style={card}>
        <div style={label}>Reply policy</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {[
            ['off', 'Off'],
            ['draft', 'Draft only'],
            ['auto', 'Send when confident']
          ].map(([id, name]) => (
            // Marked only from a policy the server answered with: a failed read chooses nothing.
            <button key={id} type="button" style={policyLoad.state === 'loaded' && policy === id ? solidBtn : ghostBtn} onClick={() => setAutopilot(id)}>{name}</button>
          ))}
        </div>
        {/* One cause, one alert: when the replies read failed too, its alert below says so (as AudienceDesk does). */}
        {policyLoad.state === 'failed' && boxLoad.state !== 'failed' && <p role="alert" data-studio-state="failed" style={{ margin: '8px 0 0', fontSize: 13, color: '#fecaca' }}>{policyLoad.text}</p>}
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9ca3af' }}>
          Off does not draft or send. Draft only prepares a reply for you. Send when confident lets the email service reply on its own when it clears its own bar.
        </p>
      </div>
      {countLine && <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>{countLine}</p>}
      <StudioListLine line={listLine(boxLoad, messages.length, REPLIES_LIST)} onRetry={load} busy={reading} />
      {messages.map((message) => (
        <article key={message.id} style={card}>
          <button type="button" onClick={() => setOpen(open === message.id ? '' : message.id)} style={{ ...ghostBtn, width: '100%', textAlign: 'left' }}>
            <strong>{message.subject || 'No subject'}</strong>
            <span style={{ display: 'block', color: '#9ca3af', marginTop: 4 }}>{message.from || 'Unknown sender'} · {message.status || 'new'} · {message.receivedAt || ''}</span>
          </button>
          {open === message.id && (
            <div style={{ marginTop: 10 }}>
              <p style={{ whiteSpace: 'pre-wrap', color: '#e5e7eb', fontSize: 14 }}>{message.text || message.snippet || 'This message has no text stored.'}</p>
              {message.aiDraft?.text && <p style={{ whiteSpace: 'pre-wrap', color: '#d1d5db', fontSize: 13 }}>Draft: {message.aiDraft.text}</p>}
              <label style={label} htmlFor={`reply-${message.id}`}>Your reply</label>
              <textarea id={`reply-${message.id}`} style={{ ...field, minHeight: 80, marginTop: 6 }} value={reply[message.id] || ''} onChange={(e) => setReply({ ...reply, [message.id]: e.target.value })} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" style={solidBtn} onClick={() => act(message.id, 'reply', { text: reply[message.id] || '' })}>Send reply</button>
                <button type="button" style={ghostBtn} onClick={() => act(message.id, 'draft')}>Draft a reply</button>
                <button type="button" style={ghostBtn} onClick={() => act(message.id, 'reply', { useDraft: true })}>Send the draft</button>
                <button type="button" style={ghostBtn} onClick={() => act(message.id, 'status', { status: 'archived' })}>Archive</button>
              </div>
            </div>
          )}
        </article>
      ))}
      {notice && <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>{notice}</p>}
    </div>
  );
};
