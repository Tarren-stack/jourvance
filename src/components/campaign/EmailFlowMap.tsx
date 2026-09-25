import React, { useEffect, useMemo, useState } from 'react';
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { authHeaders } from '../../lib/firebase';
import { card, field, ghostBtn, label, readJson, solidBtn } from './emailChrome';

type FlowPath = { id: string; label?: string; else?: boolean; clauses?: { kind: string; field?: string; op?: string; value?: string; event?: string; since?: string; done?: boolean; note?: string }[]; note?: string };
type FlowNode = {
  id: string;
  type: 'trigger' | 'delay' | 'email' | 'condition' | 'sms' | 'ab' | 'profile' | 'list' | 'alert' | 'webhook' | 'restock';
  delayMinutes?: number;
  delayHours?: number;
  mode?: 'duration' | 'clock';
  clockHour?: number;
  clockMinute?: number;
  weekdays?: number[];
  timezone?: 'account' | 'profile';
  subject?: string;
  previewText?: string;
  fromName?: string;
  replyTo?: string;
  blocks?: { id: string; kind: string; text?: string }[];
  message?: string;
  status?: 'draft' | 'review' | 'live';
  transactional?: boolean;
  quietHours?: boolean;
  coupon?: { name?: string; discountType?: string; value?: number; prefix?: string };
  smartSkip?: boolean;
  sendTime?: 'smart' | '';
  fallbackHour?: number | null;
  holdout?: { enabled?: boolean; percent?: number } | null;
  paths?: FlowPath[];
  variations?: { id: string; weight?: number; subject?: string; previewText?: string }[];
  update?: 'set' | 'clear' | 'add' | 'remove';
  key?: string;
  value?: string | number | boolean;
  listId?: string;
  to?: string;
  url?: string;
  template?: string;
  variantId?: string;
  minimum?: number;
  capDays?: number;
  klaviyoFlowId?: string;
};

type FlowEdge = { id: string; source: string; target: string; branch?: string };
type TriggerChoice = { id: string; label: string; help: string; events?: boolean };

type FlowView = {
  id: string;
  name: string;
  kind: 'flow' | 'automation' | 'sequence';
  editable: boolean;
  enabled: boolean;
  trigger: string;
  quietAfterDays?: number | null;
  reentry?: 'once' | 'whenever' | 'after';
  reentryDays?: number;
  exitOnOrder?: boolean;
  dateField?: string;
  dateOffsetDays?: number;
  dateRepeat?: 'once' | 'yearly' | 'monthly';
  lookbackDays?: number | null;
  dropMode?: string;
  dropValue?: number | null;
  stockThreshold?: number | null;
  stockMinimum?: number | null;
  variantId?: string;
  sunset?: boolean;
  enrolled?: number | null;
  stats?: { sent: number | null; delivered: number | null; opened: number | null; clicked: number | null; unsubscribed: number | null; revenue: number | null; prefetchOpens: number | null } | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  note?: string;
  klaviyoFlowId?: string;
  active?: number;
  stepCount?: number;
  compileError?: string;
};

const FALLBACK_TRIGGERS: TriggerChoice[] = [
  { id: 'lead_capture', label: 'New lead', help: 'Starts when someone joins from a page or signup form.', events: true },
  { id: 'exit_intent', label: 'Exit offer', help: 'Starts when someone submits an exit offer.', events: true },
  { id: 'checkout_abandonment', label: 'Left checkout', help: 'Starts from an unfinished checkout. It can stop if an order is recorded after that.', events: true },
  { id: 'order_paid', label: 'Order paid', help: 'Starts when a paid order is recorded.', events: true },
  { id: 'quiet_buyer', label: 'Quiet buyer', help: 'Starts when their last recorded order is older than the quiet period.', events: true },
  { id: 'manual', label: 'By hand', help: 'Starts only when you enroll an email on a flow that is turned on.', events: true }
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MailNode = ({ data }: { data: { title: string; detail: string; kind: string; paths?: FlowPath[] } }) => (
  <div style={{ padding: '8px 10px', borderRadius: 10, background: '#121217', border: '1px solid rgba(255,255,255,0.16)', color: '#f3f4f6', width: 190, fontSize: 12 }}>
    <Handle type="target" position={Position.Top} />
    <div style={{ fontSize: 10, letterSpacing: '0.04em', color: '#9ca3af', fontWeight: 700 }}>{data.title}</div>
    <div style={{ marginTop: 4, lineHeight: 1.35 }}>{data.detail}</div>
    {data.kind === 'condition' ? (
      (data.paths || [{ id: 'yes' }, { id: 'no' }]).map((path, index, all) => (
        <Handle key={path.id} type="source" position={Position.Bottom} id={path.id} style={{ left: `${((index + 1) / (all.length + 1)) * 100}%` }} />
      ))
    ) : (
      <Handle type="source" position={Position.Bottom} />
    )}
  </div>
);

const nodeTypes = { mail: MailNode };

function titleOf(node: FlowNode) {
  if (node.type === 'trigger') return 'Start';
  if (node.type === 'delay') return 'Wait';
  if (node.type === 'email') return 'Email';
  if (node.type === 'sms') return 'Text';
  if (node.type === 'ab') return 'A/B';
  if (node.type === 'profile') return 'Profile';
  if (node.type === 'list') return 'List';
  if (node.type === 'alert') return 'Alert';
  if (node.type === 'webhook') return 'Webhook';
  if (node.type === 'restock') return 'Restock';
  return 'Check';
}

function detailOf(node: FlowNode) {
  if (node.type === 'delay') {
    if (node.mode === 'clock') {
      const hour = String(node.clockHour || 0).padStart(2, '0');
      const minute = String(node.clockMinute || 0).padStart(2, '0');
      const days = (node.weekdays || []).map((day) => WEEKDAYS[day]).filter(Boolean).join(', ');
      return `${hour}:${minute}${days ? ` · ${days}` : ''}`;
    }
    const minutes = node.delayMinutes ?? (node.delayHours || 0) * 60;
    return minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} minutes`;
  }
  if (node.type === 'email') return `${node.subject || 'No subject yet'}${node.status && node.status !== 'live' ? ` · ${node.status}` : ''}${node.klaviyoFlowId ? ' · Klaviyo' : ''}`;
  if (node.type === 'sms') return node.message || 'No message yet';
  if (node.type === 'condition') return (node.paths || []).map((path) => path.label || path.id).join(' · ') || 'Check';
  if (node.type === 'ab') return `${node.variations?.length || 0} variations`;
  if (node.type === 'profile') return node.update === 'clear' ? `Clear ${node.key || 'field'}` : `Set ${node.key || 'field'}`;
  if (node.type === 'list') return `${node.update === 'remove' ? 'Remove from' : 'Add to'} ${node.listId || 'list'}`;
  if (node.type === 'alert') return node.to || 'No address yet';
  if (node.type === 'webhook') return node.url || 'No address yet';
  if (node.type === 'restock') return node.variantId ? `Variant ${node.variantId}` : 'Wait for stock';
  return 'When the trigger happens';
}

function layout(flow: FlowView): { nodes: Node[]; edges: Edge[] } {
  const depth = new Map<string, number>();
  const shift = new Map<string, number>();
  const trigger = flow.nodes.find((node) => node.type === 'trigger');
  if (!trigger) return { nodes: [], edges: [] };
  const queue: { id: string; d: number; x: number }[] = [{ id: trigger.id, d: 0, x: 0 }];
  const seen = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    depth.set(cur.id, cur.d);
    shift.set(cur.id, cur.x);
    const source = flow.nodes.find((node) => node.id === cur.id);
    const outs = flow.edges.filter((item) => item.source === cur.id);
    outs.forEach((edge, index) => {
      const count = source?.type === 'condition' ? (source.paths?.length || outs.length) : 1;
      const slot = source?.paths?.findIndex((path) => path.id === edge.branch) ?? index;
      const dx = count > 1 ? (slot - (count - 1) / 2) * 210 : 0;
      queue.push({ id: edge.target, d: cur.d + 1, x: cur.x + dx });
    });
  }
  return {
    nodes: flow.nodes.map((node) => ({
      id: node.id,
      type: 'mail',
      position: { x: 280 + (shift.get(node.id) || 0), y: 16 + (depth.get(node.id) || 0) * 128 },
      data: { title: titleOf(node), detail: detailOf(node), kind: node.type, paths: node.paths },
      draggable: false,
      selectable: true
    })),
    edges: flow.edges.map((edge) => {
      const source = flow.nodes.find((node) => node.id === edge.source);
      const path = source?.paths?.find((item) => item.id === edge.branch);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.branch || undefined,
        label: path?.label || (edge.branch === 'yes' ? 'Yes' : edge.branch === 'no' ? 'No' : undefined),
        style: { stroke: '#9ca3af' }
      };
    })
  };
}

const SmsCount: React.FC<{ message: string }> = ({ message }) => {
  const [line, setLine] = useState('');
  useEffect(() => {
    const handle = setTimeout(async () => {
      const res = await fetch('/api/sms/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ message })
      });
      const data = await readJson(res);
      if (!data || data.success === false) {
        setLine('');
        return;
      }
      const bits = [`${data.units ?? ''} / ${data.limit ?? ''}`.trim()];
      if (data.prefixNote) bits.push(data.prefixNote);
      if (data.warning) bits.push(data.warning);
      if (data.quietUntil) bits.push(`Quiet hours until ${data.quietUntil}.`);
      setLine(bits.filter(Boolean).join(' '));
    }, 250);
    return () => clearTimeout(handle);
  }, [message]);
  return line ? <p style={{ margin: 0, fontSize: 12, color: '#d1d5db' }}>{line}</p> : null;
};

export const EmailFlowMap: React.FC = () => {
  const [flows, setFlows] = useState<FlowView[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [draft, setDraft] = useState<FlowView | null>(null);
  const [selected, setSelected] = useState('');
  const [notice, setNotice] = useState('');
  const [enrollEmail, setEnrollEmail] = useState('');
  const [pathBranch, setPathBranch] = useState('yes');
  const [joinTarget, setJoinTarget] = useState('');
  const [timezone, setTimezone] = useState('');
  const [triggers, setTriggers] = useState<TriggerChoice[]>(FALLBACK_TRIGGERS);
  const [klaviyoOn, setKlaviyoOn] = useState(false);
  const [klaviyoSends, setKlaviyoSends] = useState(false);
  const [klaviyoFlows, setKlaviyoFlows] = useState<{ id: string; name: string; status: string; handoff: string }[]>([]);

  const load = async (prefer?: string) => {
    const data = await readJson(await fetch('/api/email/flow-map', { headers: await authHeaders() }));
    const list: FlowView[] = Array.isArray(data?.flows) ? data.flows : [];
    setFlows(list);
    if (Array.isArray(data?.triggers) && data.triggers.length) setTriggers(data.triggers);
    if (typeof data?.timezone === 'string') setTimezone(data.timezone);
    const id = prefer && list.some((flow) => flow.id === prefer) ? prefer : (list[0]?.id || '');
    setCurrentId(id);
    setDraft(list.find((flow) => flow.id === id) || null);
  };

  useEffect(() => {
    load();
    (async () => {
      const data = await readJson(await fetch('/api/klaviyo', { headers: await authHeaders() }));
      setKlaviyoOn(Boolean(data?.klaviyo?.connected));
      setKlaviyoSends(data?.klaviyo?.sendWith === 'klaviyo');
      setKlaviyoFlows(Array.isArray(data?.klaviyo?.flows) ? data.klaviyo.flows : []);
    })();
  }, []);

  const current = draft && draft.id === currentId ? draft : flows.find((flow) => flow.id === currentId) || null;
  const graph = useMemo(() => current ? layout(current) : { nodes: [], edges: [] }, [current]);
  const selectedNode = current?.nodes.find((node) => node.id === selected) || null;
  const triggerHelp = triggers.find((trigger) => trigger.id === current?.trigger);

  const choose = (id: string) => {
    setCurrentId(id);
    setSelected('');
    setNotice('');
    setDraft(flows.find((flow) => flow.id === id) || null);
  };

  const save = async (next: FlowView) => {
    setNotice('');
    const res = await fetch(`/api/email/flows/${next.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        name: next.name,
        enabled: next.enabled,
        trigger: next.trigger,
        quietAfterDays: next.quietAfterDays,
        reentry: next.reentry || 'once',
        reentryDays: next.reentryDays || 30,
        exitOnOrder: next.exitOnOrder === true,
        dateField: next.dateField || '',
        dateOffsetDays: next.dateOffsetDays || 0,
        dateRepeat: next.dateRepeat || 'once',
        lookbackDays: next.lookbackDays || 30,
        dropMode: next.dropMode || 'percent',
        dropValue: next.dropValue ?? 10,
        stockThreshold: next.stockThreshold || 5,
        stockMinimum: next.stockMinimum || 1,
        variantId: next.variantId || '',
        sunset: next.sunset === true,
        nodes: next.nodes,
        edges: next.edges
      })
    });
    const data = await readJson(res);
    if (!res.ok || !data?.success) {
      setNotice(data?.error || 'That flow was not saved.');
      return;
    }
    setNotice('Saved. It sends only after you turn it on and the queue reaches a due step.');
    await load(next.id);
  };

  const saveTimezone = async () => {
    const res = await fetch('/api/email/timezone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ timezone })
    });
    const data = await readJson(res);
    setNotice(data?.error || (res.ok ? 'Timezone saved. An empty value uses UTC.' : 'The timezone was not saved.'));
  };

  const create = async () => {
    const res = await fetch('/api/email/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ name: 'New flow', trigger: 'manual' })
    });
    const data = await readJson(res);
    if (!res.ok || !data?.flow?.id) {
      setNotice(data?.error || 'A flow was not created.');
      return;
    }
    await load(data.flow.id);
  };

  const remove = async () => {
    if (!current?.editable) return;
    const res = await fetch(`/api/email/flows/${current.id}`, { method: 'DELETE', headers: await authHeaders() });
    if (!res.ok) {
      setNotice('That flow was not deleted.');
      return;
    }
    setSelected('');
    await load();
  };

  const patchNode = (id: string, patch: Partial<FlowNode>) => {
    if (!current?.editable) return;
    setDraft({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) });
  };

  const attach = (type: FlowNode['type']) => {
    if (!current?.editable) return;
    const source = current.nodes.find((node) => node.id === selected) || current.nodes.find((node) => node.type === 'trigger');
    if (!source) return;
    const branch = source.type === 'condition'
      ? (source.paths?.some((path) => path.id === pathBranch) ? pathBranch : (source.paths?.[0]?.id || 'yes'))
      : '';
    if (current.edges.some((edge) => edge.source === source.id && (edge.branch || '') === branch)) {
      setNotice('That step already has this connection.');
      return;
    }
    const id = `n_${Date.now().toString(36)}`;
    const node: FlowNode = { id, type };
    if (type === 'delay') {
      node.mode = 'duration';
      node.delayMinutes = 1440;
    }
    if (type === 'email') {
      node.subject = 'A note from the store';
      node.status = 'live';
      node.blocks = [{ id: `${id}_b`, kind: 'text', text: '' }];
    }
    if (type === 'sms') {
      node.message = '';
      node.status = 'draft';
    }
    if (type === 'condition') {
      node.paths = [
        { id: 'yes', label: 'Ordered after joining', clauses: [{ kind: 'did', event: 'order', since: 'enroll' }] },
        { id: 'no', label: 'Everyone else', else: true, clauses: [] }
      ];
    }
    if (type === 'ab') {
      node.status = 'live';
      node.variations = [
        { id: 'a', weight: 1, subject: 'A note from the store' },
        { id: 'b', weight: 1, subject: 'Another note from the store' }
      ];
    }
    if (type === 'profile') {
      node.update = 'set';
      node.key = 'note';
      node.value = '';
    }
    if (type === 'list') {
      node.update = 'add';
      node.listId = 'main';
    }
    if (type === 'restock') {
      node.minimum = 1;
      node.capDays = 30;
    }
    setDraft({
      ...current,
      nodes: [...current.nodes, node],
      edges: [...current.edges, { id: `e_${id}`, source: source.id, target: id, branch }]
    });
    setSelected(id);
    setNotice('');
  };

  const joinSelected = () => {
    if (!current?.editable || !selectedNode || !joinTarget || joinTarget === selectedNode.id) return;
    const branch = selectedNode.type === 'condition'
      ? (selectedNode.paths?.some((path) => path.id === pathBranch) ? pathBranch : (selectedNode.paths?.[0]?.id || 'yes'))
      : '';
    if (current.edges.some((edge) => edge.source === selectedNode.id && (edge.branch || '') === branch)) {
      setNotice('That step already has this connection.');
      return;
    }
    setDraft({
      ...current,
      edges: [...current.edges, { id: `e_${selectedNode.id}_${joinTarget}`, source: selectedNode.id, target: joinTarget, branch }]
    });
    setNotice('Connected. Save to keep it. A loop is rejected.');
  };

  const deleteSelected = () => {
    if (!current?.editable || !selectedNode || selectedNode.type === 'trigger') return;
    const incoming = current.edges.filter((edge) => edge.target === selectedNode.id);
    const outgoing = current.edges.filter((edge) => edge.source === selectedNode.id);
    let edges = current.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id);
    if (incoming.length === 1 && outgoing.length === 1 && !outgoing[0].branch) {
      edges = [...edges, { ...incoming[0], id: `e_${incoming[0].source}_${outgoing[0].target}`, target: outgoing[0].target }];
    }
    setDraft({ ...current, nodes: current.nodes.filter((node) => node.id !== selectedNode.id), edges });
    setSelected('');
  };

  const enroll = async () => {
    if (!current) return;
    const res = await fetch(`/api/email/flows/${current.id}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ email: enrollEmail })
    });
    const data = await readJson(res);
    setNotice(data?.error || (data?.viaKlaviyo && data?.enrolled
      ? 'Handed to the linked Klaviyo flow. Klaviyo sends only if that flow is live. They were not subscribed.'
      : data?.enrolled
        ? 'Enrolled. The queue sends the first due step.'
        : 'They are already in this flow, or it is off.'));
    if (data?.enrolled) setEnrollEmail('');
  };

  const readyTriggers = triggers.filter((trigger) => trigger.events !== false);
  const waitingTriggers = triggers.filter((trigger) => trigger.events === false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: '#f3f4f6' }}>Flow map</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af', maxWidth: 760 }}>
            Each account can build its own flow. A step runs only when the queue is run and the flow is on. A new flow stays off. A text goes only to a number that has already opted in. When Klaviyo is the sender, an email step linked to a Klaviyo flow is handed there instead.
          </p>
        </div>
        <button type="button" style={solidBtn} onClick={create}>New flow</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 720, overflow: 'auto' }}>
          {flows.map((flow) => (
            <button key={flow.id} type="button" onClick={() => choose(flow.id)} style={{ ...card, textAlign: 'left', cursor: 'pointer', borderColor: flow.id === currentId ? 'rgba(244,114,182,0.7)' : undefined }}>
              <div style={{ fontWeight: 700, color: '#f3f4f6' }}>{flow.name}</div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{flow.kind === 'flow' ? (flow.enabled ? 'On' : 'Off') : flow.kind} · {flow.trigger.replace(/_/g, ' ')}</div>
            </button>
          ))}
        </div>
        <div style={{ ...card, flex: '3 1 340px', minHeight: 560, minWidth: 0 }}>
          {current && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#f3f4f6' }}>{current.name}</div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>{current.compileError || current.note || `${current.active || 0} active · ${current.stepCount || 0} send steps`}</div>
                {current.stats && (
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: '#d1d5db' }}>
                    Enrolled {current.enrolled == null ? '—' : current.enrolled} · Sent {current.stats.sent == null ? '—' : current.stats.sent} · Delivered {current.stats.delivered == null ? '—' : current.stats.delivered} · Opened {current.stats.opened == null ? '—' : current.stats.opened} · Clicked {current.stats.clicked == null ? '—' : current.stats.clicked} · Unsubscribed {current.stats.unsubscribed == null ? '—' : current.stats.unsubscribed} · Revenue {current.stats.revenue == null ? '—' : `$${current.stats.revenue.toFixed(2)}`}
                    {current.stats.prefetchOpens ? ` · ${current.stats.prefetchOpens} opens included an Apple Mail prefetch flag.` : ''}
                  </p>
                )}
              </div>
              {current.editable && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={current.enabled ? solidBtn : ghostBtn} onClick={() => save({ ...current, enabled: !current.enabled })}>{current.enabled ? 'Turn off' : 'Turn on'}</button>
                  <button type="button" style={ghostBtn} onClick={() => save(current)}>Save</button>
                  <button type="button" style={ghostBtn} onClick={remove}>Delete</button>
                </div>
              )}
            </div>
          )}
          <div style={{ height: 420, background: '#0b0b10', borderRadius: 10 }}>
            <ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} fitView onNodeClick={(_, node) => setSelected(node.id)} proOptions={{ hideAttribution: true }}>
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          {current?.editable && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              <label style={label}>Name</label>
              <input style={field} value={current.name} onChange={(e) => setDraft({ ...current, name: e.target.value })} />
              <label style={label}>Starts when</label>
              <select style={field} value={current.trigger} onChange={(e) => setDraft({ ...current, trigger: e.target.value })}>
                <optgroup label="Recording now">
                  {readyTriggers.map((trigger) => <option key={trigger.id} value={trigger.id}>{trigger.label}</option>)}
                </optgroup>
                {waitingTriggers.length > 0 && (
                  <optgroup label="No events yet">
                    {waitingTriggers.map((trigger) => <option key={trigger.id} value={trigger.id}>{trigger.label}</option>)}
                  </optgroup>
                )}
              </select>
              <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>{triggerHelp?.help}</p>
              <label style={label}>Re-entry</label>
              <select style={field} value={current.reentry || 'once'} onChange={(e) => setDraft({ ...current, reentry: e.target.value as FlowView['reentry'] })}>
                <option value="once">Once</option>
                <option value="whenever">Whenever they qualify again</option>
                <option value="after">After a number of days</option>
              </select>
              {current.reentry === 'after' && (
                <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                  Days before they can start again
                  <input style={{ ...field, marginTop: 4 }} type="number" min={1} max={3650} value={current.reentryDays || 30} onChange={(e) => setDraft({ ...current, reentryDays: Number(e.target.value) })} />
                </label>
              )}
              <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Someone already moving through this flow is not started a second time. Once is the default for a new or imported flow.</p>
              {(current.trigger === 'quiet_buyer' || current.trigger === 'checkout_abandonment' || current.exitOnOrder) && (
                <label style={{ fontSize: 13, color: '#e5e7eb', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={current.exitOnOrder !== false && (current.exitOnOrder === true || current.trigger === 'quiet_buyer' || current.trigger === 'checkout_abandonment')} onChange={(e) => setDraft({ ...current, exitOnOrder: e.target.checked })} />
                  Stop if an order is recorded after they join
                </label>
              )}
              {current.trigger === 'quiet_buyer' && (
                <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                  Quiet days
                  <input style={{ ...field, marginTop: 4 }} type="number" min={1} max={365} value={current.quietAfterDays || 45} onChange={(e) => setDraft({ ...current, quietAfterDays: Number(e.target.value) })} />
                </label>
              )}
              {current.trigger === 'date_property' && (
                <>
                  <label style={label}>Date field on the contact</label>
                  <input style={field} value={current.dateField || ''} onChange={(e) => setDraft({ ...current, dateField: e.target.value })} />
                  <label style={label}>Days before that date</label>
                  <input style={field} type="number" min={0} max={364} value={current.dateOffsetDays || 0} onChange={(e) => setDraft({ ...current, dateOffsetDays: Number(e.target.value) })} />
                  <label style={label}>Repeat</label>
                  <select style={field} value={current.dateRepeat || 'once'} onChange={(e) => setDraft({ ...current, dateRepeat: e.target.value as FlowView['dateRepeat'] })}>
                    <option value="once">Once</option>
                    <option value="yearly">Yearly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>The queue starts them at 8:00 in the account timezone. A predicted next order is not used. Yearly and monthly start again only when re-entry allows it.</p>
                </>
              )}
              {(current.trigger === 'price_drop' || current.trigger === 'low_inventory') && (
                <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                  Look back this many days
                  <input style={{ ...field, marginTop: 4 }} type="number" min={1} max={365} value={current.lookbackDays || 30} onChange={(e) => setDraft({ ...current, lookbackDays: Number(e.target.value) })} />
                </label>
              )}
              {current.trigger === 'price_drop' && (
                <>
                  <label style={label}>Drop by</label>
                  <select style={field} value={current.dropMode || 'percent'} onChange={(e) => setDraft({ ...current, dropMode: e.target.value })}>
                    <option value="percent">Percent</option>
                    <option value="amount">Amount</option>
                  </select>
                  <input style={field} type="number" min={0} value={current.dropValue ?? 10} onChange={(e) => setDraft({ ...current, dropValue: Number(e.target.value) })} />
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>A missing stored price does not count. The variant must be published and in stock.</p>
                </>
              )}
              {current.trigger === 'low_inventory' && (
                <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                  Stock at or below
                  <input style={{ ...field, marginTop: 4 }} type="number" min={1} max={100000} value={current.stockThreshold || 5} onChange={(e) => setDraft({ ...current, stockThreshold: Number(e.target.value) })} />
                </label>
              )}
              {current.trigger === 'back_in_stock' && (
                <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                  Available at least
                  <input style={{ ...field, marginTop: 4 }} type="number" min={1} max={100000} value={current.stockMinimum || 1} onChange={(e) => setDraft({ ...current, stockMinimum: Number(e.target.value) })} />
                </label>
              )}
              {(current.trigger === 'price_drop' || current.trigger === 'low_inventory' || current.trigger === 'back_in_stock') && (
                <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                  Limit to variant id
                  <input style={{ ...field, marginTop: 4 }} value={current.variantId || ''} placeholder="Any variant" onChange={(e) => setDraft({ ...current, variantId: e.target.value })} />
                </label>
              )}
              <label style={label}>Account timezone</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input style={{ ...field, flex: '1 1 180px' }} value={timezone} placeholder="America/New_York" onChange={(e) => setTimezone(e.target.value)} />
                <button type="button" style={ghostBtn} onClick={saveTimezone}>Save timezone</button>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Waits that name the account timezone use this. Leave it empty to use UTC. A profile timezone is used only when that contact has one stored.</p>
              {selectedNode?.type === 'condition' && (
                <label style={label}>
                  Connect a new step to
                  <select style={{ ...field, marginTop: 4 }} value={pathBranch} onChange={(e) => setPathBranch(e.target.value)}>
                    {(selectedNode.paths || []).map((path) => <option key={path.id} value={path.id}>{path.label || path.id}</option>)}
                  </select>
                </label>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" style={ghostBtn} onClick={() => attach('delay')}>Add wait</button>
                <button type="button" style={ghostBtn} onClick={() => attach('email')}>Add email</button>
                <button type="button" style={ghostBtn} onClick={() => attach('sms')}>Add text</button>
                <button type="button" style={ghostBtn} onClick={() => attach('condition')}>Add check</button>
                <button type="button" style={ghostBtn} onClick={() => attach('ab')}>Add A/B</button>
                <button type="button" style={ghostBtn} onClick={() => attach('profile')}>Add profile update</button>
                <button type="button" style={ghostBtn} onClick={() => attach('list')}>Add list change</button>
                <button type="button" style={ghostBtn} onClick={() => attach('alert')}>Add alert</button>
                <button type="button" style={ghostBtn} onClick={() => attach('webhook')}>Add webhook</button>
                <button type="button" style={ghostBtn} onClick={() => attach('restock')}>Add restock wait</button>
                <button type="button" style={ghostBtn} onClick={deleteSelected}>Remove step</button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select style={{ ...field, flex: '1 1 180px' }} value={joinTarget} onChange={(e) => setJoinTarget(e.target.value)} aria-label="Existing step to connect to">
                  <option value="">Connect to an existing step</option>
                  {(current.nodes || []).filter((node) => node.id !== selected).map((node) => (
                    <option key={node.id} value={node.id}>{titleOf(node)} · {detailOf(node)}</option>
                  ))}
                </select>
                <button type="button" style={ghostBtn} onClick={joinSelected}>Connect</button>
              </div>
              {current.klaviyoFlowId && (
                <p style={{ margin: 0, fontSize: 12, color: '#d1d5db' }}>
                  Copied from Klaviyo flow {current.klaviyoFlowId}. It stays off until you turn it on. While Klaviyo is the sender and this flow is on, the trigger hands the person to that Klaviyo flow once. The copied letters are not sent from here.
                </p>
              )}
              {selectedNode?.type === 'email' && (
                <>
                  <label style={label}>Subject</label>
                  <input style={field} value={selectedNode.subject || ''} onChange={(e) => patchNode(selectedNode.id, { subject: e.target.value })} />
                  <label style={label}>Preview text</label>
                  <input style={field} value={selectedNode.previewText || ''} onChange={(e) => patchNode(selectedNode.id, { previewText: e.target.value })} />
                  <label style={label}>Status</label>
                  <select style={field} value={selectedNode.status || 'live'} onChange={(e) => patchNode(selectedNode.id, { status: e.target.value as FlowNode['status'] })}>
                    <option value="draft">Draft, skipped</option>
                    <option value="review">Review, skipped and recorded</option>
                    <option value="live">Live</option>
                  </select>
                  <label style={{ fontSize: 13, color: '#e5e7eb', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={selectedNode.smartSkip === true} onChange={(e) => patchNode(selectedNode.id, { smartSkip: e.target.checked })} />
                    Skip if this account emailed them in the last 16 hours
                  </label>
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>This skip is off unless you check it. A skipped message is not rescheduled. A transactional message ignores the window.</p>
                  <label style={{ fontSize: 13, color: '#e5e7eb', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={selectedNode.sendTime === 'smart'} onChange={(e) => patchNode(selectedNode.id, { sendTime: e.target.checked ? 'smart' : '' })} />
                    Send at their hour
                  </label>
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Their hour after 5 opens or clicks, otherwise the store hour after 200 opens or clicks in 90 days, otherwise the hour below. If none of those apply, the next send takes it. A stored timezone on the contact is used when there is one.</p>
                  {selectedNode.sendTime === 'smart' && (
                    <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                      Fallback hour, 0 through 23. Leave empty for the next send.
                      <input aria-label="Fallback hour" style={{ ...field, marginTop: 4 }} type="number" min={0} max={23} value={selectedNode.fallbackHour ?? ''} onChange={(e) => patchNode(selectedNode.id, { fallbackHour: e.target.value === '' ? null : Number(e.target.value) })} />
                    </label>
                  )}
                  <label style={{ fontSize: 13, color: '#e5e7eb', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={selectedNode.transactional === true} onChange={(e) => patchNode(selectedNode.id, { transactional: e.target.checked })} />
                    Transactional, no marketing unsubscribe
                  </label>
                  <label style={{ fontSize: 13, color: '#e5e7eb', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input aria-label="Holdout" type="checkbox" checked={selectedNode.holdout?.enabled === true} onChange={(e) => patchNode(selectedNode.id, { holdout: e.target.checked ? { enabled: true, percent: selectedNode.holdout?.percent || 10 } : { enabled: false } })} />
                    Hold out a percent of people. They receive nothing from this email.
                  </label>
                  {selectedNode.holdout?.enabled === true && (
                    <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                      Percent who receive nothing, 1 to 90
                      <input aria-label="Holdout percent" style={{ ...field, marginTop: 4 }} type="number" min={1} max={90} value={selectedNode.holdout?.percent || 10} onChange={(e) => patchNode(selectedNode.id, { holdout: { enabled: true, percent: Number(e.target.value) } })} />
                    </label>
                  )}
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Holdout stays off until you turn it on. After it runs, the report shows revenue per person for the people who received this email and the people who were held out, with both sample sizes.</p>
                  {selectedNode.blocks?.[0]?.kind === 'html' ? (
                    <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>This letter was copied from a Klaviyo template. When Jourvance sends it, if, else, for, default, lookup, catalog, and coupon tags are filled. Any other tag is removed and listed on this flow as not translated. When Klaviyo is the sender, Klaviyo fills the template.</p>
                  ) : (
                    <>
                      <label style={label}>Body</label>
                      <textarea style={{ ...field, minHeight: 80 }} value={selectedNode.blocks?.[0]?.text || ''} onChange={(e) => patchNode(selectedNode.id, { blocks: [{ id: selectedNode.blocks?.[0]?.id || `${selectedNode.id}_b`, kind: 'text', text: e.target.value }] })} />
                    </>
                  )}
                  <label style={label}>From name</label>
                  <input style={field} value={selectedNode.fromName || ''} onChange={(e) => patchNode(selectedNode.id, { fromName: e.target.value })} />
                  <label style={label}>Reply-to</label>
                  <input style={field} value={selectedNode.replyTo || ''} onChange={(e) => patchNode(selectedNode.id, { replyTo: e.target.value })} />
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>From name and reply-to are saved on this step. Sending still uses the connected sender.</p>
                  <label style={label}>Klaviyo flow for this email</label>
                  <select style={field} aria-label="Klaviyo flow for this email step" value={selectedNode.klaviyoFlowId || ''} disabled={!klaviyoOn} onChange={(e) => patchNode(selectedNode.id, { klaviyoFlowId: e.target.value })}>
                    <option value="">{current.klaviyoFlowId ? 'Use the copied Klaviyo flow' : 'Do not hand this email to Klaviyo'}</option>
                    {klaviyoFlows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name} · {flow.status || 'status unknown'}</option>)}
                  </select>
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>
                    {klaviyoSends
                      ? (klaviyoFlows.find((flow) => flow.id === selectedNode.klaviyoFlowId)?.handoff || 'Save the flow after choosing. Reaching this step adds the person to that live flow. It does not subscribe them.')
                      : 'Jourvance is the sender, so this step still sends from here. The link is used when you choose Klaviyo on the Klaviyo tab.'}
                  </p>
                </>
              )}
              {selectedNode?.type === 'delay' && (
                <>
                  <label style={label}>Wait</label>
                  <select style={field} value={selectedNode.mode || 'duration'} onChange={(e) => patchNode(selectedNode.id, { mode: e.target.value as FlowNode['mode'] })}>
                    <option value="duration">A length of time</option>
                    <option value="clock">Until a time of day</option>
                  </select>
                  <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                    Minutes
                    <input style={{ ...field, marginTop: 4 }} type="number" min={0} value={selectedNode.delayMinutes ?? (selectedNode.delayHours || 0) * 60} onChange={(e) => patchNode(selectedNode.id, { delayMinutes: Number(e.target.value) })} />
                  </label>
                  {selectedNode.mode === 'clock' && (
                    <>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <label style={{ fontSize: 13, color: '#e5e7eb', flex: 1 }}>
                          Hour
                          <input style={{ ...field, marginTop: 4 }} type="number" min={0} max={23} value={selectedNode.clockHour || 0} onChange={(e) => patchNode(selectedNode.id, { clockHour: Number(e.target.value) })} />
                        </label>
                        <label style={{ fontSize: 13, color: '#e5e7eb', flex: 1 }}>
                          Minute
                          <input style={{ ...field, marginTop: 4 }} type="number" min={0} max={59} value={selectedNode.clockMinute || 0} onChange={(e) => patchNode(selectedNode.id, { clockMinute: Number(e.target.value) })} />
                        </label>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {WEEKDAYS.map((day, index) => (
                          <label key={day} style={{ fontSize: 12, color: '#e5e7eb' }}>
                            <input type="checkbox" checked={(selectedNode.weekdays || []).includes(index)} onChange={(e) => {
                              const days = new Set(selectedNode.weekdays || []);
                              if (e.target.checked) days.add(index); else days.delete(index);
                              patchNode(selectedNode.id, { weekdays: [...days] });
                            }} /> {day}
                          </label>
                        ))}
                      </div>
                      <label style={label}>Timezone</label>
                      <select style={field} value={selectedNode.timezone || 'account'} onChange={(e) => patchNode(selectedNode.id, { timezone: e.target.value as FlowNode['timezone'] })}>
                        <option value="account">Account timezone</option>
                        <option value="profile">Profile timezone, then account</option>
                      </select>
                    </>
                  )}
                </>
              )}
              {selectedNode?.type === 'sms' && (
                <>
                  <label style={label}>Text</label>
                  <textarea style={{ ...field, minHeight: 70 }} value={selectedNode.message || ''} onChange={(e) => patchNode(selectedNode.id, { message: e.target.value })} />
                  <label style={label}>Status</label>
                  <select style={field} value={selectedNode.status || 'live'} onChange={(e) => patchNode(selectedNode.id, { status: e.target.value as FlowNode['status'] })}>
                    <option value="draft">Draft, skipped</option>
                    <option value="review">Review, skipped and recorded</option>
                    <option value="live">Live</option>
                  </select>
                  <label style={{ fontSize: 13, color: '#e5e7eb', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={selectedNode.smartSkip === true} onChange={(e) => patchNode(selectedNode.id, { smartSkip: e.target.checked })} />
                    Skip if this account texted them in the last 24 hours
                  </label>
                  <label style={{ fontSize: 13, color: '#e5e7eb', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={selectedNode.transactional === true} onChange={(e) => patchNode(selectedNode.id, { transactional: e.target.checked, quietHours: e.target.checked ? false : true })} />
                    Transactional text
                  </label>
                  <label style={{ fontSize: 13, color: '#e5e7eb', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input aria-label="Quiet hours" type="checkbox" checked={selectedNode.quietHours === true || (selectedNode.quietHours !== false && selectedNode.transactional !== true)} onChange={(e) => patchNode(selectedNode.id, { quietHours: e.target.checked })} />
                    Hold during quiet hours, 8:00 p.m. to 11:00 a.m.
                  </label>
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>A blocked text waits until 11:00 a.m. in the account timezone, and then the 24-hour skip is checked. A transactional text leaves this off until you turn it on. The store name is added in front when one is saved. One link is rewritten to this site and one coupon tag is created at send. This text is SMS.</p>
                  <label style={label}>Coupon name</label>
                  <input style={field} aria-label="Text coupon name" value={selectedNode.coupon?.name || ''} onChange={(e) => patchNode(selectedNode.id, { coupon: { ...(selectedNode.coupon || {}), name: e.target.value } })} />
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Put {'{% coupon_code \'Name\' %}'} in the text, using the name above. Preview shows the word Code. A code is created once when the text sends.</p>
                  <SmsCount message={selectedNode.message || ''} />
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Sent only if this person already opted in to texts. A live text needs a message before the flow can be saved.</p>
                </>
              )}
              {selectedNode?.type === 'condition' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(selectedNode.paths || []).map((path) => (
                    <p key={path.id} style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>
                      {path.label || path.id}{path.else ? ' (everyone else)' : ''}{path.note ? ` — ${path.note}` : ''}
                    </p>
                  ))}
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>The first matching path wins. An empty path is skipped. Everyone else stays and cannot be removed. A predicted value or predicted next order matches only after this store has computed it.</p>
                </div>
              )}
              {selectedNode?.type === 'ab' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(selectedNode.variations || []).map((variation, index) => (
                    <label key={variation.id} style={{ fontSize: 13, color: '#e5e7eb' }}>
                      Variation {index + 1} subject
                      <input style={{ ...field, marginTop: 4 }} value={variation.subject || ''} onChange={(e) => {
                        const variations = (selectedNode.variations || []).map((item) => item.id === variation.id ? { ...item, subject: e.target.value } : item);
                        patchNode(selectedNode.id, { variations });
                      }} />
                    </label>
                  ))}
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Each person keeps the variation they were given. This step does not choose a winner.</p>
                </div>
              )}
              {selectedNode?.type === 'profile' && (
                <>
                  <label style={label}>Field</label>
                  <input style={field} value={selectedNode.key || ''} onChange={(e) => patchNode(selectedNode.id, { key: e.target.value })} />
                  <label style={label}>Value</label>
                  <input style={field} value={String(selectedNode.value ?? '')} onChange={(e) => patchNode(selectedNode.id, { value: e.target.value, update: 'set' })} />
                  <button type="button" style={ghostBtn} onClick={() => patchNode(selectedNode.id, { update: 'clear' })}>Clear this field instead</button>
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>This writes a field on the contact. Predicted value, churn, and expected next order are refused. It does not subscribe them.</p>
                </>
              )}
              {selectedNode?.type === 'list' && (
                <>
                  <label style={label}>List id</label>
                  <input style={field} value={selectedNode.listId || ''} onChange={(e) => patchNode(selectedNode.id, { listId: e.target.value })} />
                  <select style={field} value={selectedNode.update === 'remove' ? 'remove' : 'add'} onChange={(e) => patchNode(selectedNode.id, { update: e.target.value as FlowNode['update'] })}>
                    <option value="add">Add</option>
                    <option value="remove">Remove</option>
                  </select>
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Adding someone who is not already on the list can start “Added to a list”. Removing them does not unsubscribe them, and it does not subscribe them in Klaviyo.</p>
                </>
              )}
              {selectedNode?.type === 'alert' && (
                <>
                  <label style={label}>Send the alert to</label>
                  <input style={field} value={selectedNode.to || ''} onChange={(e) => patchNode(selectedNode.id, { to: e.target.value })} />
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>One email to the address you type here when someone reaches this step.</p>
                </>
              )}
              {selectedNode?.type === 'webhook' && (
                <>
                  <label style={label}>HTTPS address</label>
                  <input style={field} value={selectedNode.url || ''} onChange={(e) => patchNode(selectedNode.id, { url: e.target.value })} />
                  <label style={label}>JSON body</label>
                  <textarea style={{ ...field, minHeight: 70 }} value={selectedNode.template || ''} onChange={(e) => patchNode(selectedNode.id, { template: e.target.value })} />
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>One POST. The address has to be public https. Headers are not copied and secrets are not logged.</p>
                </>
              )}
              {selectedNode?.type === 'restock' && (
                <>
                  <label style={label}>Variant id</label>
                  <input style={field} value={selectedNode.variantId || ''} onChange={(e) => patchNode(selectedNode.id, { variantId: e.target.value })} />
                  <label style={label}>Minimum available</label>
                  <input style={field} type="number" min={1} value={selectedNode.minimum || 1} onChange={(e) => patchNode(selectedNode.id, { minimum: Number(e.target.value) })} />
                  <label style={label}>Stop waiting after days</label>
                  <input style={field} type="number" min={1} max={90} value={selectedNode.capDays || 30} onChange={(e) => patchNode(selectedNode.id, { capDays: Number(e.target.value) })} />
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>This step waits until a later inventory update releases it. Until then it holds, then continues when the cap is reached. It does not email anyone by itself.</p>
                </>
              )}
              {current.sunset && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                    Quiet period in days
                    <input aria-label="Sunset quiet period" style={{ ...field, marginTop: 4 }} type="number" min={1} max={365} value={current.quietAfterDays ?? ''} onChange={(e) => setDraft({ ...current, quietAfterDays: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </label>
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>After this many days, someone who was sent mail and did not open or click is marked unengaged. This flow sends nothing. The button below is the only suppress action.</p>
                  <button type="button" style={ghostBtn} onClick={async () => {
                    const res = await fetch(`/api/email/flows/${current.id}/suppress`, { method: 'POST', headers: await authHeaders() });
                    const data = await readJson(res);
                    setNotice(data?.message || data?.error || 'Nobody was suppressed.');
                  }}>Suppress people marked unengaged</button>
                </div>
              )}
              {current.trigger === 'manual' && !current.sunset && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input style={{ ...field, flex: '1 1 180px' }} value={enrollEmail} placeholder="Email to enroll" onChange={(e) => setEnrollEmail(e.target.value)} />
                  <button type="button" style={ghostBtn} onClick={enroll}>Enroll</button>
                </div>
              )}
            </div>
          )}
          {notice && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#d1d5db' }}>{notice}</p>}
        </div>
      </div>
    </div>
  );
};
