import React, { useEffect, useState } from 'react';
import { authHeaders } from '../../lib/firebase';
import { card, field, ghostBtn, label, readJson, solidBtn } from './emailChrome';

type Sender = { id: string; fromEmail?: string; domain?: string; verified?: boolean; dns?: unknown };

function recordRows(dns: unknown): { type: string; host: string; value: string }[] {
  const records = Array.isArray(dns) ? dns : (dns && typeof dns === 'object' && Array.isArray((dns as { records?: unknown[] }).records) ? (dns as { records: unknown[] }).records : []);
  return records.map((row) => {
    const item = row && typeof row === 'object' ? row as Record<string, string> : {};
    return { type: item.type || item.record_type || '', host: item.host || item.name || '', value: item.value || item.data || '' };
  }).filter((row) => row.type || row.host || row.value);
}

export const SendingSetup: React.FC = () => {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [domain, setDomain] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [address, setAddress] = useState('');
  const [inboundHost, setInboundHost] = useState('');
  const [inbound, setInbound] = useState<Record<string, unknown> | null>(null);
  const [events, setEvents] = useState<Record<string, unknown> | null>(null);
  const [blocks, setBlocks] = useState<unknown[]>([]);
  const [liveName, setLiveName] = useState('');
  const [beforeUrl, setBeforeUrl] = useState('');
  const [afterUrl, setAfterUrl] = useState('');
  const [deadline, setDeadline] = useState('');
  const [notice, setNotice] = useState('');
  const [dnsNote, setDnsNote] = useState('');

  const load = async () => {
    const headers = await authHeaders();
    const [senderRes, inboundRes, eventRes, liveRes] = await Promise.all([
      readJson(await fetch('/api/email/senders', { headers })),
      readJson(await fetch('/api/email/inbound', { headers })),
      readJson(await fetch('/api/email/events-webhook', { headers })),
      readJson(await fetch('/api/email/live', { headers }))
    ]);
    setSenders(Array.isArray(senderRes?.senders) ? senderRes.senders : []);
    setInbound(inboundRes?.success === false ? { error: inboundRes.error } : inboundRes);
    setEvents(eventRes?.success === false ? { error: eventRes.error } : eventRes);
    setBlocks(Array.isArray(liveRes?.blocks) ? liveRes.blocks : []);
    if (senderRes?.success === false) setNotice(senderRes.error);
    const suiteRes = await readJson(await fetch('/api/email/suite', { headers }));
    if (typeof suiteRes?.suite?.postalAddress === 'string') setAddress(suiteRes.suite.postalAddress);
  };

  useEffect(() => { load(); }, []);

  const post = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body)
    });
    const data = await readJson(res);
    setNotice(data?.error || data?.note || 'Saved.');
    if (data?.dns) setDnsNote(JSON.stringify(data.dns, null, 2));
    await load();
    return data;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 820 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, color: '#f3f4f6' }}>Sending</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af' }}>
          Domain authentication, reply receiving, and open tracking come from the email service. A domain is ready only when that service says it is verified. The postal address saved here is added to the bottom of each letter. Marketing letters also get an unsubscribe link for that person.
        </p>
      </div>
      <div style={card}>
        <div style={label}>From address</div>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <input style={field} aria-label="Sending domain" placeholder="yourdomain.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <input style={field} aria-label="From email" placeholder="From email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
          <input style={field} aria-label="From name" placeholder="From name" value={fromName} onChange={(e) => setFromName(e.target.value)} />
          <input style={field} aria-label="Physical address" placeholder="Postal address for the footer" value={address} onChange={(e) => setAddress(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={solidBtn} onClick={() => post('/api/email/postal', { physicalAddress: address })}>Save postal address</button>
            <button type="button" style={ghostBtn} onClick={() => post('/api/email/senders', { type: 'domain', domain, fromEmail, fromName, physicalAddress: address })}>Add domain</button>
            <button type="button" style={ghostBtn} onClick={() => post('/api/email/domain-connect', { domain, fromEmail })}>Write DNS where the service can</button>
          </div>
        </div>
        {dnsNote && <pre style={{ whiteSpace: 'pre-wrap', color: '#d1d5db', fontSize: 12 }}>{dnsNote}</pre>}
        {!senders.length && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#9ca3af' }}>No sending domain is on file for this account.</p>}
        {senders.map((sender) => {
          const rows = recordRows(sender.dns);
          return (
            <div key={sender.id} style={{ marginTop: 12 }}>
              <div style={{ color: '#f3f4f6', fontWeight: 700 }}>{sender.fromEmail || sender.domain || sender.id}</div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>{sender.verified ? 'Verified' : 'Not verified yet'}</div>
              {!!rows.length && (
                <table style={{ width: '100%', marginTop: 8, fontSize: 12, color: '#e5e7eb' }}>
                  <thead><tr><th align="left">Type</th><th align="left">Host</th><th align="left">Value</th></tr></thead>
                  <tbody>
                    {rows.map((row, index) => <tr key={index}><td>{row.type}</td><td>{row.host}</td><td style={{ wordBreak: 'break-all' }}>{row.value}</td></tr>)}
                  </tbody>
                </table>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" style={ghostBtn} onClick={() => post(`/api/email/senders/${sender.id}/verify`, {})}>Check verification</button>
                <button type="button" style={ghostBtn} onClick={async () => {
                  const data = await readJson(await fetch(`/api/email/senders/${sender.id}/auth`, { headers: await authHeaders() }));
                  setDnsNote(JSON.stringify(data?.auth || data, null, 2));
                }}>Authentication report</button>
                <button type="button" style={ghostBtn} onClick={async () => {
                  await fetch(`/api/email/senders/${sender.id}`, { method: 'DELETE', headers: await authHeaders() });
                  await load();
                }}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={card}>
        <div style={label}>Receiving replies</div>
        <p style={{ margin: '8px 0', fontSize: 13, color: '#d1d5db' }}>
          {inbound?.error ? String(inbound.error) : inbound?.receiving ? `Receiving on ${String(inbound.hostname || '')}.` : 'Receiving is not confirmed.'}
          {inbound?.accountAddress ? ` Mail for this account: ${String(inbound.accountAddress)}` : ''}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={field} aria-label="Reply hostname" placeholder="reply.yourdomain.com" value={inboundHost} onChange={(e) => setInboundHost(e.target.value)} />
          <button type="button" style={ghostBtn} onClick={() => post('/api/email/inbound', { hostname: inboundHost })}>Set up receiving</button>
        </div>
      </div>
      <div style={card}>
        <div style={label}>Opens and clicks</div>
        <p style={{ margin: '8px 0', fontSize: 13, color: '#d1d5db' }}>
          {events?.error ? String(events.error) : events?.configured ? 'The event webhook is configured.' : 'Opens and clicks are not being recorded yet.'}
        </p>
        <button type="button" style={ghostBtn} onClick={() => post('/api/email/events-webhook', {})}>Turn on event recording</button>
      </div>
      <div style={card}>
        <div style={label}>Live at open</div>
        <p style={{ margin: '8px 0', fontSize: 13, color: '#9ca3af' }}>
          An image or link that points at one address before a deadline and another after it. The flip happens when the message is opened. {blocks.length} block{blocks.length === 1 ? '' : 's'} on the email service.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          <input style={field} aria-label="Block name" placeholder="Name" value={liveName} onChange={(e) => setLiveName(e.target.value)} />
          <input style={field} aria-label="Before URL" placeholder="https:// address before the deadline" value={beforeUrl} onChange={(e) => setBeforeUrl(e.target.value)} />
          <input style={field} aria-label="After URL" placeholder="https:// address after the deadline" value={afterUrl} onChange={(e) => setAfterUrl(e.target.value)} />
          <input style={field} aria-label="Deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <button type="button" style={solidBtn} onClick={() => post('/api/email/live', { name: liveName, kind: 'image', beforeUrl, afterUrl, deadline: deadline ? new Date(deadline).toISOString() : '' })}>Create live block</button>
        </div>
      </div>
      {notice && <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>{notice}</p>}
    </div>
  );
};
