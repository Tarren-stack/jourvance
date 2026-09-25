import React, { useEffect, useState } from 'react';
import { authHeaders } from '../../lib/firebase';
import { card, field, ghostBtn, label, readJson, solidBtn } from './emailChrome';

type KlaviyoFlow = {
  id: string;
  name: string;
  status: string;
  triggerKind: string;
  listName?: string;
  metricName?: string;
  canEnter: boolean;
  handoff: string;
};

type KlaviyoState = {
  connected: boolean;
  keyOnFile: boolean;
  accountName?: string;
  lastSyncAt?: string;
  lastError?: string;
  catalogError?: string;
  sendWith?: 'jourvance' | 'klaviyo';
  moreProfiles?: boolean;
  lists?: { id: string; name: string }[];
  flows?: KlaviyoFlow[];
  lastHandoffs?: { at: string; email: string; flowName?: string; detail: string; entered: boolean }[];
  lastResult?: {
    profilesRead: number;
    imported: number;
    updated: number;
    suppressed: number;
    lists: number;
    flowsSeen: number;
    flowsImported: number;
    flowsLeftOn: number;
    templatesCopied?: number;
    pushed: number;
    pushFailed: number;
    moreProfiles: boolean;
    notes?: string[];
  } | null;
};

export const KlaviyoSync: React.FC = () => {
  const [state, setState] = useState<KlaviyoState | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const data = await readJson(await fetch('/api/klaviyo', { headers: await authHeaders() }));
    if (data?.klaviyo) setState(data.klaviyo);
  };

  useEffect(() => { load(); }, []);

  const connect = async () => {
    setBusy(true);
    setNotice('');
    try {
      const res = await fetch('/api/klaviyo/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ apiKey })
      });
      const data = await readJson(res);
      if (!res.ok || !data?.success) {
        setNotice(data?.error || 'Klaviyo did not accept that key.');
        return;
      }
      setApiKey('');
      setState(data.klaviyo);
      setNotice(data.klaviyo?.accountName ? `Connected to ${data.klaviyo.accountName}.` : 'Connected.');
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setNotice('');
    try {
      const res = await fetch('/api/klaviyo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({})
      });
      const data = await readJson(res);
      if (data?.klaviyo) setState(data.klaviyo);
      if (!res.ok || !data?.success) {
        setNotice(data?.error || 'Sync did not finish.');
        return;
      }
      const result = data.result || {};
      setNotice(`Read ${result.profilesRead || 0} profiles. Imported ${result.imported || 0}. Updated ${result.updated || 0}. Pushed ${result.pushed || 0}.`);
    } finally {
      setBusy(false);
    }
  };

  const chooseSender = async (sendWith: 'jourvance' | 'klaviyo') => {
    setBusy(true);
    setNotice('');
    try {
      const res = await fetch('/api/klaviyo/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ sendWith })
      });
      const data = await readJson(res);
      if (data?.klaviyo) setState(data.klaviyo);
      setNotice(data?.error || (sendWith === 'klaviyo'
        ? 'Klaviyo will send. Jourvance keeps the pages and the map.'
        : 'Jourvance will send the letters you turn on here.'));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/klaviyo/disconnect', { method: 'POST', headers: await authHeaders() });
      const data = await readJson(res);
      setState(data?.klaviyo || { connected: false, keyOnFile: false });
      setNotice('Disconnected. People already imported stay in this account.');
    } finally {
      setBusy(false);
    }
  };

  const result = state?.lastResult;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, color: '#f3f4f6' }}>Klaviyo</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af', maxWidth: 680 }}>
          Jourvance already has its own email suite. Klaviyo is optional. Connect a private key from Klaviyo → Settings → API keys when you want to copy that account in. Sync rebuilds each flow here and leaves it off. Waits stay waits. Both sides of a split are kept. A tag or a predictive split that could not be translated is named in the flow note. A profile push does not subscribe anyone, and the Klaviyo flow is left as it is.
        </p>
      </div>
      <div style={card}>
        <div style={label}>Private key</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input
            style={{ ...field, flex: 1, minWidth: 220 }}
            type="password"
            autoComplete="off"
            aria-label="Klaviyo private API key"
            placeholder={state?.keyOnFile ? 'A key is on file. Paste a new one to replace it.' : 'pk_…'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button type="button" style={solidBtn} disabled={busy} onClick={connect}>{busy ? 'Checking…' : 'Connect'}</button>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#e5e7eb' }}>
          {state?.connected ? `Connected${state.accountName ? ` · ${state.accountName}` : ''}.` : 'Not connected.'}
          {state?.lastSyncAt ? ` Last sync ${state.lastSyncAt}.` : ''}
        </p>
        {state?.connected && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" style={solidBtn} disabled={busy} onClick={sync}>{state.moreProfiles ? 'Continue sync' : 'Sync and rebuild'}</button>
            <button type="button" style={ghostBtn} disabled={busy} onClick={disconnect}>Disconnect</button>
          </div>
        )}
      </div>
      {state?.connected && (
        <div style={card}>
          <div style={label}>Who sends email</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" style={state.sendWith === 'klaviyo' ? ghostBtn : solidBtn} disabled={busy} onClick={() => chooseSender('jourvance')}>Send with Jourvance</button>
            <button type="button" style={state.sendWith === 'klaviyo' ? solidBtn : ghostBtn} disabled={busy} onClick={() => chooseSender('klaviyo')}>Send with Klaviyo</button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#9ca3af' }}>
            {state.sendWith === 'klaviyo'
              ? 'This is the extra choice. An email node linked to a live Klaviyo flow adds the person to that flow’s list, or sends the event that starts it. Jourvance does not also send that sequence. Letters already waiting here stay waiting.'
              : 'This is the normal choice. Jourvance sends the flows you turn on, including ones rebuilt from Klaviyo. People who start on a page can still be pushed to Klaviyo as profiles, without being subscribed.'}
          </p>
          {state.catalogError && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#d1d5db' }}>{state.catalogError}</p>}
        </div>
      )}
      {!!state?.flows?.length && (
        <div style={card}>
          <div style={label}>Klaviyo flows</div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#e5e7eb', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {state.flows.map((flow) => (
              <li key={flow.id}>
                <span style={{ fontWeight: 650 }}>{flow.name}</span>
                {' · '}{flow.status || 'status unknown'}
                {flow.listName ? ` · list ${flow.listName}` : ''}
                {flow.metricName ? ` · event ${flow.metricName}` : ''}
                <div style={{ color: '#9ca3af', fontSize: 12 }}>{flow.handoff}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!state?.lastHandoffs?.length && (
        <div style={card}>
          <div style={label}>Recent handoffs</div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#e5e7eb', fontSize: 13 }}>
            {state.lastHandoffs.slice(0, 8).map((item) => (
              <li key={`${item.at}-${item.email}`}>{item.email}: {item.detail}</li>
            ))}
          </ul>
        </div>
      )}
      {result && (
        <div style={card}>
          <div style={label}>Last sync</div>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: '#e5e7eb' }}>
            {result.profilesRead} profiles read · {result.imported} new · {result.updated} updated · {result.suppressed} suppressed · {result.lists} lists · {result.flowsImported} of {result.flowsSeen} flows copied · {result.templatesCopied || 0} templates · {result.pushed} pushed
          </p>
          {result.moreProfiles && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9ca3af' }}>More profiles remain. Sync again to continue.</p>}
          {result.flowsLeftOn > 0 && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9ca3af' }}>{result.flowsLeftOn} flow{result.flowsLeftOn === 1 ? ' is' : 's are'} turned on here, so those steps were not replaced.</p>}
          {(result.notes || []).map((note) => <p key={note} style={{ margin: '6px 0 0', fontSize: 12, color: '#d1d5db' }}>{note}</p>)}
        </div>
      )}
      {!!state?.lists?.length && (
        <div style={card}>
          <div style={label}>Lists copied as tags</div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#e5e7eb', fontSize: 13 }}>
            {state.lists.map((list) => <li key={list.id}>{list.name}</li>)}
          </ul>
        </div>
      )}
      {(notice || state?.lastError) && <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>{notice || state?.lastError}</p>}
    </div>
  );
};
