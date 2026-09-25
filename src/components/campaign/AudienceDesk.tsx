import React, { useEffect, useState } from 'react';
import { authHeaders } from '../../lib/firebase';
import { card, field, ghostBtn, label, readJson } from './emailChrome';

type Segment = { id: string; name: string; definition?: string; description?: string; count: number; builtin?: boolean };
type List = { id: string; name: string; count: number };
type Clause = { kind: 'profile'; field: string; op: string; value: string };

export const AudienceDesk: React.FC = () => {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [notice, setNotice] = useState('');
  const [listName, setListName] = useState('');
  const [memberEmail, setMemberEmail] = useState<Record<string, string>>({});
  const [segmentName, setSegmentName] = useState('');
  const [clauses, setClauses] = useState<Clause[]>([{ kind: 'profile', field: 'email', op: 'eq', value: '' }]);

  const load = async () => {
    const headers = await authHeaders();
    const [segmentData, listData] = await Promise.all([
      readJson(await fetch('/api/email/segments', { headers })),
      readJson(await fetch('/api/email/lists', { headers }))
    ]);
    setSegments(Array.isArray(segmentData?.segments) ? segmentData.segments : []);
    setLists(Array.isArray(listData?.lists) ? listData.lists : []);
  };

  useEffect(() => { load(); }, []);

  const createList = async () => {
    const data = await readJson(await fetch('/api/email/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ name: listName || 'List' })
    }));
    setNotice(data?.error || 'List saved. Nobody was added.');
    setListName('');
    await load();
  };

  const changeMember = async (list: List, update: 'add' | 'remove') => {
    const email = (memberEmail[list.id] || '').trim();
    if (!email) return;
    const data = await readJson(await fetch(`/api/email/lists/${list.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ email, update })
    }));
    if (data?.error) setNotice(data.error);
    else if (update === 'remove') setNotice(`${email} was removed from ${list.name}. Marketing consent was not changed.`);
    else setNotice(data?.added ? `${email} was added to ${list.name}.` : `${email} was already on ${list.name}.`);
    await load();
  };

  const createSegment = async () => {
    const data = await readJson(await fetch('/api/email/segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        name: segmentName || 'Segment',
        join: 'all',
        groups: [{ join: 'all', clauses: clauses.filter((clause) => clause.field && clause.value) }]
      })
    }));
    setNotice(data?.error || `Segment saved. ${data?.entered || 0} newly matched.`);
    if (!data?.error) {
      setSegmentName('');
      setClauses([{ kind: 'profile', field: 'email', op: 'eq', value: '' }]);
    }
    await load();
  };

  const refresh = async (segment: Segment) => {
    const data = await readJson(await fetch(`/api/email/segments/${segment.id}/refresh`, {
      method: 'POST',
      headers: await authHeaders()
    }));
    setNotice(data?.error || `${data?.entered || 0} newly matched ${segment.name}.`);
    await load();
  };

  const removeSegment = async (segment: Segment) => {
    await fetch(`/api/email/segments/${segment.id}`, { method: 'DELETE', headers: await authHeaders() });
    await load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 16, color: '#f3f4f6' }}>Lists and segments</h3>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af', maxWidth: 720 }}>
          Adding someone to a list can start a flow once. Removing them does not unsubscribe them. A segment records an entry when someone newly matches. Klaviyo list names already stored as tags are not turned into lists.
        </p>
      </div>
      <div style={card}>
        <div style={label}>Built-in segments</div>
        {segments.filter((segment) => segment.builtin !== false && !segment.id.startsWith('seg_')).map((segment) => (
          <p key={segment.id} style={{ margin: '8px 0 0', fontSize: 13, color: '#e5e7eb' }}>
            <strong>{segment.name}</strong> · {segment.count} · {segment.definition || segment.description}
          </p>
        ))}
      </div>
      <div style={card}>
        <div style={label}>New list</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input style={field} aria-label="List name" placeholder="List name" value={listName} onChange={(e) => setListName(e.target.value)} />
          <button type="button" style={ghostBtn} onClick={createList}>Create list</button>
        </div>
        {lists.map((list) => (
          <div key={list.id} style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, color: '#f3f4f6' }}>{list.name} · {list.count} · {list.id}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input style={field} aria-label={`Email for ${list.name}`} placeholder="Email on this account" value={memberEmail[list.id] || ''} onChange={(e) => setMemberEmail({ ...memberEmail, [list.id]: e.target.value })} />
              <button type="button" style={ghostBtn} onClick={() => changeMember(list, 'add')}>Add</button>
              <button type="button" style={ghostBtn} onClick={() => changeMember(list, 'remove')}>Remove</button>
            </div>
          </div>
        ))}
        {!lists.length && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#9ca3af' }}>No lists on this account yet.</p>}
      </div>
      <div style={card}>
        <div style={label}>New segment</div>
        <input style={{ ...field, marginTop: 8 }} aria-label="Segment name" placeholder="Segment name" value={segmentName} onChange={(e) => setSegmentName(e.target.value)} />
        {clauses.map((clause, index) => (
          <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
            <input style={field} aria-label="Field" value={clause.field} onChange={(e) => setClauses(clauses.map((row, i) => i === index ? { ...row, field: e.target.value } : row))} />
            <select style={field} aria-label="Comparison" value={clause.op} onChange={(e) => setClauses(clauses.map((row, i) => i === index ? { ...row, op: e.target.value } : row))}>
              <option value="eq">is</option>
              <option value="neq">is not</option>
              <option value="contains">contains</option>
              <option value="gt">is above</option>
              <option value="lt">is below</option>
            </select>
            <input style={field} aria-label="Value" value={clause.value} onChange={(e) => setClauses(clauses.map((row, i) => i === index ? { ...row, value: e.target.value } : row))} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" style={ghostBtn} onClick={() => clauses.length < 100 && setClauses([...clauses, { kind: 'profile', field: 'email', op: 'eq', value: '' }])}>Add check</button>
          <button type="button" style={ghostBtn} onClick={createSegment}>Save segment</button>
        </div>
        {segments.filter((segment) => segment.id.startsWith('seg_')).map((segment) => (
          <div key={segment.id} style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, color: '#f3f4f6' }}>{segment.name} · {segment.count}</div>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9ca3af' }}>{segment.definition || segment.description}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button type="button" style={ghostBtn} onClick={() => refresh(segment)}>Refresh</button>
              <button type="button" style={ghostBtn} onClick={() => removeSegment(segment)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {notice && <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }} role="status">{notice}</p>}
    </div>
  );
};
