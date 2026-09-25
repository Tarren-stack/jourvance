import React, { useEffect, useState } from 'react';
import { authHeaders } from '../../lib/firebase';
import { card, field, ghostBtn, label, readJson, solidBtn } from './emailChrome';

type SmsStatus = {
  configured?: boolean;
  live?: boolean;
  provider?: string;
  from?: string;
  mode?: string;
  stats?: { optedIn?: number; optedOut?: number };
};

export const SmsPanel: React.FC = () => {
  const [status, setStatus] = useState<SmsStatus | null>(null);
  const [audience, setAudience] = useState<number | null>(null);
  const [history, setHistory] = useState<string>('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [phones, setPhones] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [notice, setNotice] = useState('');
  const [countLine, setCountLine] = useState('');

  const load = async () => {
    const headers = await authHeaders();
    const [state, people, log] = await Promise.all([
      readJson(await fetch('/api/sms/status', { headers })),
      readJson(await fetch('/api/sms/audience', { headers })),
      readJson(await fetch('/api/sms/history', { headers }))
    ]);
    if (state?.success === false) setNotice(state.error || 'Texting is not connected.');
    setStatus(state?.success === false ? null : state);
    setAudience(Array.isArray(people?.audience) ? people.audience.length : null);
    const blasts = Array.isArray(log?.blasts) ? log.blasts.length : 0;
    const messages = Array.isArray(log?.messages) ? log.messages.length : 0;
    setHistory(log?.success === false ? '' : `${blasts} sends recorded · ${messages} messages in the log`);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const handle = setTimeout(async () => {
      const res = await fetch('/api/sms/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ message })
      });
      const data = await readJson(res);
      if (!data || data.success === false) {
        setCountLine('');
        return;
      }
      const bits = [`${data.units} / ${data.limit}`];
      if (data.prefixNote) bits.push(data.prefixNote);
      if (data.warning) bits.push(data.warning);
      if (data.quietUntil) bits.push(`Quiet hours until ${data.quietUntil}. Nothing sends until then.`);
      setCountLine(bits.join(' '));
    }, 250);
    return () => clearTimeout(handle);
  }, [message]);

  const consent = async (next: 'opted_in' | 'opted_out') => {
    const res = await fetch('/api/sms/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ email, phone, consent: next })
    });
    const data = await readJson(res);
    setNotice(data?.error || (next === 'opted_in' ? 'Opt-in recorded.' : 'Opt-out recorded.'));
    await load();
  };

  const send = async () => {
    const recipients = phones.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean).map((item) => ({ phone: item }));
    const res = await fetch('/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        message,
        ...(recipients.length ? { recipients } : {}),
        ...(confirmAll ? { confirm: 'opted-in' } : {})
      })
    });
    const data = await readJson(res);
    const blast = data?.blast;
    setNotice(data?.error || (blast ? `Delivered ${blast.sent || 0}. Sandbox ${blast.sandbox || 0}. Waiting ${blast.deferred || 0}. Failed ${blast.failed || 0}.` : 'The text service answered.'));
    await load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, color: '#f3f4f6' }}>Texts</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af' }}>
          Texts use this app’s sending number. A number is texted only after an opt-in is on file. This text is SMS. Pictures, contact cards, and RCS are not part of this send. Quiet hours block 8:00 p.m. to 11:00 a.m. in the account timezone.
        </p>
      </div>
      <div style={card}>
        <div style={label}>Channel</div>
        <p style={{ margin: '8px 0 0', color: '#e5e7eb', fontSize: 14 }}>
          {status?.configured ? `${status.provider || 'Provider'} · ${status.from || 'no from number'} · ${status.live ? 'Live' : (status.mode || 'not live')}` : 'No sending number is connected.'}
        </p>
        <p style={{ margin: '6px 0 0', color: '#9ca3af', fontSize: 12 }}>
          {audience == null ? 'Audience not loaded.' : `${audience} opted-in numbers on this app.`} {history}
        </p>
      </div>
      <div style={card}>
        <div style={label}>Consent</div>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <input style={field} aria-label="Email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input style={field} aria-label="Phone" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={solidBtn} onClick={() => consent('opted_in')}>Record opt-in</button>
            <button type="button" style={ghostBtn} onClick={() => consent('opted_out')}>Record opt-out</button>
          </div>
        </div>
      </div>
      <div style={card}>
        <div style={label}>Send</div>
        <textarea style={{ ...field, minHeight: 80, marginTop: 8 }} aria-label="Text message" placeholder="Message" value={message} onChange={(e) => setMessage(e.target.value)} />
        {countLine && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#d1d5db' }}>{countLine}</p>}
        <textarea style={{ ...field, minHeight: 60, marginTop: 8 }} aria-label="Phone numbers" placeholder="Phone numbers, one per line. Leave blank only if you confirm the full opted-in list." value={phones} onChange={(e) => setPhones(e.target.value)} />
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, color: '#e5e7eb', fontSize: 13 }}>
          <input type="checkbox" checked={confirmAll} onChange={(e) => setConfirmAll(e.target.checked)} />
          Send to every number that has already opted in
        </label>
        <button type="button" style={{ ...solidBtn, marginTop: 8 }} onClick={send}>Send text</button>
      </div>
      {notice && <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>{notice}</p>}
    </div>
  );
};
