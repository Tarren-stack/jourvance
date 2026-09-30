import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Mail,
  Lock,
  Sparkles,
  ArrowRight,
  Info
} from 'lucide-react';
import { authHeaders } from '../../lib/firebase';
import { card, field, ghostBtn, label, readJson, solidBtn } from './emailChrome';
import { checkEmailDeliverabilityDns, type EmailDeliverabilityReport } from '../../lib/shopifyClient';

type Sender = { id: string; fromEmail?: string; domain?: string; verified?: boolean; dns?: unknown };

function recordRows(dns: unknown): { type: string; host: string; value: string }[] {
  const records = Array.isArray(dns)
    ? dns
    : (dns && typeof dns === 'object' && Array.isArray((dns as { records?: unknown[] }).records)
      ? (dns as { records: unknown[] }).records
      : []);
  return records
    .map((row) => {
      const item = row && typeof row === 'object' ? (row as Record<string, string>) : {};
      return {
        type: item.type || item.record_type || 'CNAME',
        host: item.host || item.name || '',
        value: item.value || item.data || ''
      };
    })
    .filter((row) => row.type || row.host || row.value);
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

  // Live DNS Deliverability Audit State
  const [auditDomain, setAuditDomain] = useState('');
  const [auditing, setAuditing] = useState(false);
  const [report, setReport] = useState<EmailDeliverabilityReport | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const load = async () => {
    const headers = await authHeaders();
    const [senderRes, inboundRes, eventRes, liveRes] = await Promise.all([
      readJson(await fetch('/api/email/senders', { headers })),
      readJson(await fetch('/api/email/inbound', { headers })),
      readJson(await fetch('/api/email/events-webhook', { headers })),
      readJson(await fetch('/api/email/live', { headers }))
    ]);
    const senderList = Array.isArray(senderRes?.senders) ? senderRes.senders : [];
    setSenders(senderList);
    setInbound(inboundRes?.success === false ? { error: inboundRes.error } : inboundRes);
    setEvents(eventRes?.success === false ? { error: eventRes.error } : eventRes);
    setBlocks(Array.isArray(liveRes?.blocks) ? liveRes.blocks : []);
    if (senderRes?.success === false) setNotice(senderRes.error);

    const suiteRes = await readJson(await fetch('/api/email/suite', { headers }));
    if (typeof suiteRes?.suite?.postalAddress === 'string') setAddress(suiteRes.suite.postalAddress);

    // Initial audit domain default
    if (senderList.length > 0 && senderList[0].domain) {
      setDomain(senderList[0].domain);
      setAuditDomain(senderList[0].domain);
      runAudit(senderList[0].domain);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runAudit = async (targetDomain?: string) => {
    const d = (targetDomain || auditDomain || domain).trim();
    if (!d || !d.includes('.')) return;
    setAuditing(true);
    try {
      const res = await checkEmailDeliverabilityDns(d);
      setReport(res);
    } finally {
      setAuditing(false);
    }
  };

  const post = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body)
    });
    const data = await readJson(res);
    setNotice(data?.error || data?.note || 'Saved.');
    if (data?.dns) setDnsNote(typeof data.dns === 'string' ? data.dns : JSON.stringify(data.dns, null, 2));
    await load();
    return data;
  };

  const copyToClipboard = (key: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      {/* Header Banner */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={22} color="#10B981" />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#f3f4f6' }}>
            Email Deliverability & DNS Verification
          </h2>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#9ca3af', lineHeight: 1.5 }}>
          Authenticate your sending domain with <strong>SPF</strong>, <strong>DKIM</strong>, <strong>DMARC</strong>, and <strong>MX</strong> records. Google and Yahoo strictly enforce these authentication protocols to prevent automated store emails from landing in customer Spam folders.
        </p>
      </div>

      {/* 1. Live DNS Deliverability Audit Tool */}
      <div style={{ ...card, border: '1px solid rgba(16, 185, 129, 0.25)', background: 'rgba(15, 23, 42, 0.8)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color="#34D399" />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#F1F5F9' }}>
              Live Deliverability & Spam Defense Audit
            </span>
          </div>
          <span style={{ fontSize: 11, color: '#64748B' }}>
            Real-time DNS standard probe ($0 cost)
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            style={{ ...field, flex: 1, fontFamily: 'monospace', fontSize: 13 }}
            aria-label="Audit domain"
            placeholder="e.g. yourbrand.com or mail.yourbrand.com"
            value={auditDomain}
            onChange={(e) => setAuditDomain(e.target.value.toLowerCase().trim())}
            onKeyDown={(e) => { if (e.key === 'Enter') runAudit(); }}
          />
          <button
            type="button"
            style={{ ...solidBtn, display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => runAudit()}
            disabled={auditing || !auditDomain.trim()}
          >
            <RefreshCw size={14} className={auditing ? 'spin' : ''} />
            <span>{auditing ? 'Probing DNS…' : 'Audit DNS Records'}</span>
          </button>
        </div>

        {/* Deliverability Health Report Card */}
        {report && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Score Banner */}
            <div
              style={{
                padding: '14px 18px',
                borderRadius: 10,
                backgroundColor:
                  report.score >= 90
                    ? 'rgba(16, 185, 129, 0.15)'
                    : report.score >= 60
                    ? 'rgba(245, 158, 11, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                border: `1px solid ${
                  report.score >= 90
                    ? 'rgba(16, 185, 129, 0.4)'
                    : report.score >= 60
                    ? 'rgba(245, 158, 11, 0.4)'
                    : 'rgba(239, 68, 68, 0.4)'
                }`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 800,
                      color:
                        report.score >= 90
                          ? '#34D399'
                          : report.score >= 60
                          ? '#FBBF24'
                          : '#F87171'
                    }}
                  >
                    {report.score}% Deliverability Health
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 9999,
                      backgroundColor: 'rgba(0, 0, 0, 0.3)',
                      color: '#E2E8F0'
                    }}
                  >
                    {report.score >= 90
                      ? 'Inbox Ready'
                      : report.score >= 60
                      ? 'Spam Risk • Action Recommended'
                      : 'High Rejection Risk'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#CBD5E1', marginTop: 4 }}>
                  Audited domain: <strong style={{ color: '#FFFFFF' }}>{report.domain}</strong>
                </div>
              </div>

              <div style={{ textAlign: 'right', fontSize: 11, color: '#94A3B8' }}>
                <div>Google & Yahoo Compliance:</div>
                <div style={{ fontWeight: 700, color: report.dmarc.valid && report.spf.valid ? '#34D399' : '#FBBF24' }}>
                  {report.dmarc.valid && report.spf.valid ? '✓ Compliant' : '⚠️ Missing Records'}
                </div>
              </div>
            </div>

            {/* 4 Protocol Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              {/* SPF Card */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${report.spf.valid ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#F1F5F9' }}>SPF Record</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: report.spf.valid ? '#34D399' : '#F87171' }}>
                    {report.spf.valid ? '✓ Active' : '✕ Missing'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.4 }}>
                  {report.spf.valid
                    ? `Authorized policy: ${report.spf.policy}`
                    : 'Authorizes mail servers to send on your behalf.'}
                </div>
              </div>

              {/* DKIM Card */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${report.dkim.valid ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#F1F5F9' }}>DKIM Signature</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: report.dkim.valid ? '#34D399' : '#FBBF24' }}>
                    {report.dkim.valid ? '✓ Verified' : '⚠️ Pending'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.4 }}>
                  {report.dkim.valid
                    ? `Selector: ${report.dkim.selector}`
                    : 'Cryptographic signature proving message authenticity.'}
                </div>
              </div>

              {/* DMARC Card */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${report.dmarc.valid ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#F1F5F9' }}>DMARC Policy</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: report.dmarc.valid ? '#34D399' : '#F87171' }}>
                    {report.dmarc.valid ? `✓ ${report.dmarc.policy?.toUpperCase()}` : '✕ Missing'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.4 }}>
                  {report.dmarc.valid
                    ? `Policy: p=${report.dmarc.policy}`
                    : 'Mandatory by Google & Yahoo to prevent spam rejection.'}
                </div>
              </div>

              {/* MX Card */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${report.mx.valid ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#F1F5F9' }}>MX Routing</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: report.mx.valid ? '#34D399' : '#F87171' }}>
                    {report.mx.valid ? '✓ Receiving' : '✕ No Server'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.4 }}>
                  {report.mx.valid
                    ? `${report.mx.records?.length || 0} mail host(s) configured`
                    : 'Needed so inboxes know your domain accepts replies.'}
                </div>
              </div>
            </div>

            {/* Suggested DNS Records Table with 1-Click Copy */}
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0', marginBottom: 6 }}>
                Recommended DNS Records (Copy & Paste to Cloudflare, GoDaddy, or Namecheap):
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#E2E8F0' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: '#94A3B8', fontSize: 11 }}>
                      <th align="left" style={{ padding: '8px 10px' }}>Record Type</th>
                      <th align="left" style={{ padding: '8px 10px' }}>Host / Name</th>
                      <th align="left" style={{ padding: '8px 10px' }}>Value / Target</th>
                      <th align="left" style={{ padding: '8px 10px' }}>Purpose</th>
                      <th align="right" style={{ padding: '8px 10px' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.suggestedRecords.map((rec, i) => (
                      <tr
                        key={i}
                        style={{
                          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                          backgroundColor: i % 2 === 0 ? 'rgba(255, 255, 255, 0.02)' : 'transparent'
                        }}
                      >
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: '#38BDF8' }}>{rec.type}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#F472B6' }}>{rec.name}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', maxWidth: 300 }}>
                          {rec.value}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 11, color: '#94A3B8' }}>{rec.purpose}</td>
                        <td align="right" style={{ padding: '8px 10px' }}>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(`rec-${i}`, rec.value)}
                            style={{
                              padding: '4px 8px',
                              borderRadius: 4,
                              backgroundColor: copiedKey === `rec-${i}` ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                              border: copiedKey === `rec-${i}` ? '1px solid #10B981' : '1px solid rgba(255, 255, 255, 0.12)',
                              color: copiedKey === `rec-${i}` ? '#34D399' : '#FFFFFF',
                              fontSize: 11,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                          >
                            {copiedKey === `rec-${i}` ? <Check size={11} /> : <Copy size={11} />}
                            <span>{copiedKey === `rec-${i}` ? 'Copied' : 'Copy'}</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. Sender Identity & Sending Domain Configuration */}
      <div style={card}>
        <div style={label}>From Address & Postal Compliance</div>
        <p style={{ margin: '4px 0 10px', fontSize: 12, color: '#94A3B8', lineHeight: 1.4 }}>
          Under CAN-SPAM and international deliverability regulations, every marketing message must include a valid physical address in the footer.
        </p>

        <div style={{ display: 'grid', gap: 8 }}>
          <input
            style={field}
            aria-label="Sending domain"
            placeholder="yourdomain.com"
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value);
              if (!auditDomain) setAuditDomain(e.target.value);
            }}
          />
          <input
            style={field}
            aria-label="From email"
            placeholder="support@yourdomain.com"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
          />
          <input
            style={field}
            aria-label="From name"
            placeholder="Your Brand Name"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
          />
          <input
            style={field}
            aria-label="Physical address"
            placeholder="Postal address for CAN-SPAM footer (e.g. 123 Main St, Suite 400, Austin, TX 78701)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button
              type="button"
              style={solidBtn}
              onClick={() => post('/api/email/postal', { physicalAddress: address })}
            >
              Save Postal Footer
            </button>
            <button
              type="button"
              style={ghostBtn}
              onClick={() => post('/api/email/senders', { type: 'domain', domain, fromEmail, fromName, physicalAddress: address })}
            >
              Register Domain Identity
            </button>
            <button
              type="button"
              style={ghostBtn}
              onClick={() => post('/api/email/domain-connect', { domain, fromEmail })}
            >
              Auto-Connect (Namecheap / API)
            </button>
          </div>
        </div>

        {/* Existing Senders List */}
        {senders.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F1F5F9', marginBottom: 8 }}>
              Configured Sending Identities ({senders.length}):
            </div>
            {senders.map((sender) => {
              const rows = recordRows(sender.dns);
              return (
                <div
                  key={sender.id}
                  style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ color: '#f3f4f6', fontWeight: 700 }}>
                      {sender.fromEmail || sender.domain || sender.id}
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: sender.verified ? '#34D399' : '#FBBF24',
                        backgroundColor: sender.verified ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                        padding: '2px 8px',
                        borderRadius: 4
                      }}
                    >
                      {sender.verified ? '✓ Verified by ESP' : '⏳ DNS Verification Pending'}
                    </span>
                  </div>

                  {!!rows.length && (
                    <div style={{ marginTop: 8, overflowX: 'auto' }}>
                      <table style={{ width: '100%', fontSize: 11, color: '#e5e7eb' }}>
                        <thead>
                          <tr style={{ color: '#94A3B8' }}>
                            <th align="left">Type</th>
                            <th align="left">Host</th>
                            <th align="left">Target</th>
                            <th align="right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, index) => (
                            <tr key={index}>
                              <td style={{ color: '#38BDF8', fontWeight: 700 }}>{row.type}</td>
                              <td style={{ fontFamily: 'monospace', color: '#F472B6' }}>{row.host}</td>
                              <td style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{row.value}</td>
                              <td align="right">
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(`s-${sender.id}-${index}`, row.value)}
                                  style={{
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    fontSize: 11,
                                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                    border: 'none',
                                    color: '#FFFFFF',
                                    cursor: 'pointer'
                                  }}
                                >
                                  {copiedKey === `s-${sender.id}-${index}` ? 'Copied' : 'Copy'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      style={ghostBtn}
                      onClick={() => post(`/api/email/senders/${sender.id}/verify`, {})}
                    >
                      Re-Check Verification
                    </button>
                    <button
                      type="button"
                      style={ghostBtn}
                      onClick={() => runAudit(sender.domain)}
                    >
                      Run DNS Audit
                    </button>
                    <button
                      type="button"
                      style={{ ...ghostBtn, color: '#F87171' }}
                      onClick={async () => {
                        await fetch(`/api/email/senders/${sender.id}`, { method: 'DELETE', headers: await authHeaders() });
                        await load();
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Reply Receiving (Inbound Parse) */}
      <div style={card}>
        <div style={label}>Receiving Customer Replies</div>
        <p style={{ margin: '8px 0', fontSize: 13, color: '#d1d5db' }}>
          {inbound?.error ? String(inbound.error) : inbound?.receiving ? `Receiving on ${String(inbound.hostname || '')}.` : 'Receiving is not confirmed.'}
          {inbound?.accountAddress ? ` Mail for this account: ${String(inbound.accountAddress)}` : ''}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={field}
            aria-label="Reply hostname"
            placeholder="reply.yourdomain.com"
            value={inboundHost}
            onChange={(e) => setInboundHost(e.target.value)}
          />
          <button type="button" style={ghostBtn} onClick={() => post('/api/email/inbound', { hostname: inboundHost })}>
            Set Up Reply Receiving
          </button>
        </div>
      </div>

      {/* Notice Banner */}
      {notice && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            color: '#38BDF8',
            fontSize: 12
          }}
        >
          {notice}
        </div>
      )}
    </div>
  );
};
