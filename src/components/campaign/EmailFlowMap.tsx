import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { authHeaders } from '../../lib/firebase';
import { card, field, ghostBtn, label, readJson, solidBtn } from './emailChrome';
import { chooseFlowId, LINKED_FLOW_MISSING } from '../../lib/editorReturn';
import { moneyText, statText, withNote } from '../../lib/emailStats';
import { BlockEditor, type MailBlock } from './EmailBlocks';
import { FLOW_MAP_UNREACHABLE, FLOW_MAP_WRITE_UNREACHABLE, retryFlowMapArgs, sendFlowWrite, settleRead } from '../../lib/flowMapLoad';
import { FLOWS_NOT_CONNECTED, STARTER_DRAFT_NOTE, flowStepName, flowStepOrder, flowsListLoad, starterOffNotice, startsWhenText } from '../../lib/emailFlowsList';
import { retryLabel } from '../../lib/studioLoad';
import { FLOW_UNSAVED_LEAVE, noteFlowUnsaved, warnBeforeUnload } from '../../lib/studioLeave';
import { EmailStepPreview } from './EmailStepPreview';

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
  blocks?: MailBlock[];
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
  /** Wave 2: the server reports this starter email as still the seeded draft, which the sender skips. */
  starterDraft?: boolean;
};

type FlowEdge = { id: string; source: string; target: string; branch?: string };
type TriggerChoice = { id: string; label: string; help: string; events?: boolean };

type FlowView = {
  id: string;
  name: string;
  /** 'order' is an order email, a one-email flow (Wave 4): its subject and blocks are edited here. */
  kind: 'flow' | 'automation' | 'sequence' | 'order';
  editable: boolean;
  /** A starter or built-in flow: its emails and waits can be edited, its steps and its start cannot. */
  contentEditable?: boolean;
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

// The flow picker's groups, in the Flows list's order (emailFlowsList.ts FLOW_GROUPS, open list: starter
// flows before built-in flows). A kind the map does not know is the account's own.
const FLOW_PICKER_GROUPS: { kind: FlowView['kind']; label: string }[] = [
  { kind: 'flow', label: 'Your flows' },
  { kind: 'sequence', label: 'Starter flows' },
  { kind: 'automation', label: 'Built-in flows' },
  { kind: 'order', label: 'Order emails' }
];
const pickerKind = (flow: FlowView): FlowView['kind'] => (FLOW_PICKER_GROUPS.some((group) => group.kind === flow.kind) ? flow.kind : 'flow');

// D3: the step panel sits beside the map from 900px wide, below it on a narrower screen.
const BESIDE_QUERY = '(min-width: 900px)';
const matchesBeside = () => {
  try {
    return window.matchMedia(BESIDE_QUERY).matches;
  } catch {
    return true;
  }
};
function usePanelBeside() {
  const [beside, setBeside] = useState(matchesBeside);
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia(BESIDE_QUERY);
    } catch {
      return;
    }
    const update = () => setBeside(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return beside;
}

// The selected step draws a 2px pink border; the padding gives back the extra pixel so nothing moves.
const MailNode = ({ data, selected }: { data: { title: string; detail: string; kind: string; paths?: FlowPath[] }; selected?: boolean }) => (
  <div style={{ padding: selected ? '7px 9px' : '8px 10px', borderRadius: 10, background: '#121217', border: selected ? '2px solid #f472b6' : '1px solid rgba(255,255,255,0.16)', color: '#f3f4f6', width: 190, fontSize: 12 }}>
    <Handle type="target" position={Position.Top} />
    <div style={{ fontSize: 11, letterSpacing: '0.04em', color: '#9ca3af', fontWeight: 700 }}>{data.title}</div>
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
  // Wave 8: a starter email still in its seeded words says so on the map, so the ones left to replace are
  // seen without opening each (the server marks it, emailFlowsList.ts STARTER_DRAFT_NOTE says why).
  if (node.type === 'email') return `${node.subject || 'No subject yet'}${node.status && node.status !== 'live' ? ` · ${node.status}` : ''}${node.klaviyoFlowId ? ' · Klaviyo' : ''}${node.starterDraft === true ? ' · starter draft' : ''}`;
  if (node.type === 'sms') return node.message || 'No message yet';
  if (node.type === 'condition') return (node.paths || []).map((path) => path.label || path.id).join(' · ') || 'Check';
  if (node.type === 'ab') return `${node.variations?.length || 0} variations`;
  if (node.type === 'profile') return node.update === 'clear' ? `Clear ${node.key || 'field'}` : `Set ${node.key || 'field'}`;
  if (node.type === 'list') return `${node.update === 'remove' ? 'Remove from' : 'Add to'} ${node.listId || 'list'}`;
  if (node.type === 'alert') return node.to || 'No address yet';
  if (node.type === 'webhook') return node.url || 'No address yet';
  if (node.type === 'restock') return node.variantId ? `Variant ${node.variantId}` : 'Wait for stock';
  return 'When the flow starts';
}

/** The step panel's heading: "Email 2 of 3", "Wait before email 2", or the step's name. */
function stepHeadingText(flow: FlowView, node: FlowNode) {
  const emails = flow.nodes.filter((item) => item.type === 'email');
  if (node.type === 'email') return `Email ${emails.findIndex((item) => item.id === node.id) + 1} of ${emails.length}`;
  if (node.type === 'delay') {
    const next = flow.nodes.find((item) => item.id === flow.edges.find((edge) => edge.source === node.id)?.target);
    if (next?.type === 'email') return `Wait before email ${emails.findIndex((item) => item.id === next.id) + 1}`;
    return 'Wait';
  }
  if (node.type === 'sms') {
    const texts = flow.nodes.filter((item) => item.type === 'sms');
    return `Text ${texts.findIndex((item) => item.id === node.id) + 1} of ${texts.length}`;
  }
  return titleOf(node);
}

/**
 * Open list: a step's name, on the map (its node's aria-label) and in the step list beside it: "Email 2 of
 * 3: <subject>", "Wait 24 hours" (emailFlowsList.ts flowStepName), or the step's kind and what its box says.
 */
function stepNameOf(flow: FlowView, node: FlowNode, startsWhen: string) {
  return flowStepName(node, flow.nodes, startsWhen) || `${titleOf(node)}: ${detailOf(node)}`;
}

/**
 * A button in the step list: the chosen one carries a 4px bar where the others have a 1px edge, and a heavier
 * weight, as well as a tint, so it is never told by colour alone. The padding takes up the 3px, so nothing moves.
 */
const stepButton = (chosen: boolean): React.CSSProperties => {
  const side = '1px solid rgba(255,255,255,0.14)';
  return {
    width: '100%', minHeight: 44, padding: chosen ? '8px 12px' : '8px 12px 8px 15px', borderRadius: 8, textAlign: 'left', overflowWrap: 'anywhere', cursor: 'pointer',
    borderTop: side, borderRight: side, borderBottom: side, borderLeft: chosen ? '4px solid #f472b6' : side,
    background: chosen ? 'rgba(244,114,182,0.08)' : 'transparent', color: '#e5e7eb', fontSize: 12, fontWeight: chosen ? 700 : 500
  };
};

/** A whole number of hours from 1 to 2160. The sender reads 0 as 24, so 0 is refused. */
function waitHoursOk(hours: number | undefined) {
  return typeof hours === 'number' && Number.isInteger(hours) && hours >= 1 && hours <= 2160;
}

const WAIT_RANGE = 'Enter a whole number of hours from 1 to 2160.';

type NodeSize = { width: number; height: number };

function layout(flow: FlowView, selectedId = '', sizes?: Map<string, NodeSize>, startsWhen = ''): { nodes: Node[]; edges: Edge[] } {
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
      // A step is named by what it is and where it sits, never by its subject alone (open list).
      ariaLabel: stepNameOf(flow, node, startsWhen),
      draggable: false,
      selectable: true,
      selected: node.id === selectedId,
      measured: sizes?.get(`${flow.id}\n${node.id}`)
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
      const read = await settleRead(async () => readJson(await fetch('/api/sms/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ message })
      })));
      const data = read.answered ? read.data : null;
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

export const EmailFlowMap: React.FC<{
  initialFlowId?: string;
  /** A step to select once the list loads, when the chosen flow has it. */
  initialNodeId?: string;
  /** True when a step on the funnel asked for the flow; false for a button inside Email Studio. */
  fromStep?: boolean;
  /** Called after a starter or built-in flow's emails were saved, so lists outside the map can read them again. */
  onContentSaved?: (flowId: string) => void;
}> = ({ initialFlowId, initialNodeId, fromStep = true, onContentSaved }) => {
  const [flows, setFlows] = useState<FlowView[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [draft, setDraft] = useState<FlowView | null>(null);
  const [selected, setSelected] = useState('');
  const [notice, setNotice] = useState('');
  // True while a starter or built-in flow's emails are being sent to the server: Save reads Saving.
  const [saving, setSaving] = useState(false);
  // Wave 2: a starter flow's Turn on or Turn off as the server stored it, by flow id, until the next
  // load reads it. Kept apart from the flows so an unsaved email edit is neither lost nor marked saved.
  const [switched, setSwitched] = useState<Record<string, boolean>>({});
  const [switchingFlow, setSwitchingFlow] = useState(false);
  const [loadError, setLoadError] = useState('');
  // D6: Retry only where retrying can help (never for a signed-out reader).
  const [loadRetry, setLoadRetry] = useState(true);
  // D6: the flow-map read says whether email sending is connected on this server.
  const [hubConnected, setHubConnected] = useState(true);
  const retried = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The step panel's heading takes focus each time a step is selected, so the fields that follow
  // are where a keyboard or screen reader user already is.
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  // The map's own box, brought on screen before the heading so the step just chosen is seen too.
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const [stepFocus, setStepFocus] = useState(0);
  const initialPick = useRef(true);
  // React Flow hides a step until it knows the step's size, and a new node object starts unmeasured.
  // The map is rebuilt on every selection and every edit, so each step carries its last measured
  // size; without it every step blanked for a frame, long enough to refuse keyboard focus.
  const nodeSizes = useRef(new Map<string, NodeSize>());
  const [enrollEmail, setEnrollEmail] = useState('');
  const [pathBranch, setPathBranch] = useState('yes');
  const [joinTarget, setJoinTarget] = useState('');
  const [timezone, setTimezone] = useState('');
  const [triggers, setTriggers] = useState<TriggerChoice[]>(FALLBACK_TRIGGERS);
  const [klaviyoOn, setKlaviyoOn] = useState(false);
  const [klaviyoSends, setKlaviyoSends] = useState(false);
  const [klaviyoFlows, setKlaviyoFlows] = useState<{ id: string; name: string; status: string; handoff: string }[]>([]);
  const beside = usePanelBeside();

  // `asked` is true when this read is for the flow the map was opened on. A missing flow is said
  // only when a step on the funnel asked for it (fromStep), never for a button inside Email
  // Studio, and only when the list really loaded.
  const load = async (prefer?: string, asked = false) => {
    // The status is kept beside the body, so a signed-out read says so (D6, Wave 6).
    let status = 0;
    const read = await settleRead(async () => readJson(await fetch('/api/email/flow-map', { headers: await authHeaders() }).then((res) => { status = res.status; return res; })));
    // No answer is not an empty account: keep the last list and say so, with Retry.
    if (!read.answered) {
      // Retry is still on screen and still holds focus, so there is nothing to hand on.
      retried.current = false;
      setLoadRetry(true);
      setLoadError(FLOW_MAP_UNREACHABLE);
      return;
    }
    // D6: an answer that holds no list (a 401, a 500, a body without flows) is not an account with no
    // flows either: keep the last list and say which it was, the way the Flows list does.
    const outcome = flowsListLoad({ answered: true, status, data: read.data });
    if (outcome.state === 'failed') {
      retried.current = false;
      setLoadRetry(outcome.retry);
      setLoadError(outcome.text);
      return;
    }
    setLoadError('');
    const data = read.data;
    setHubConnected(data?.hubConnected !== false);
    const loaded = Array.isArray(data?.flows);
    const list: FlowView[] = loaded ? data.flows : [];
    setFlows(list);
    setSwitched({});
    if (Array.isArray(data?.triggers) && data.triggers.length) setTriggers(data.triggers);
    if (typeof data?.timezone === 'string') setTimezone(data.timezone);
    const pick = chooseFlowId(loaded ? list.map((flow) => flow.id) : null, prefer);
    setCurrentId(pick.id);
    setDraft(list.find((flow) => flow.id === pick.id) || null);
    if (asked && fromStep && pick.missing) setNotice(LINKED_FLOW_MISSING);
    // Once, on the first list that loads: the step the opener asked for, or, for a starter or
    // built-in flow opened from inside Email Studio, its first email.
    if (loaded && initialPick.current) {
      initialPick.current = false;
      const chosen = initialFlowId && pick.id === initialFlowId ? list.find((flow) => flow.id === pick.id) : undefined;
      const node = chosen?.nodes.find((item) => item.id === initialNodeId)
        || (!fromStep && chosen?.contentEditable ? chosen.nodes.find((item) => item.type === 'email') : undefined);
      if (node) selectNode(node.id);
    }
  };

  useEffect(() => {
    load(initialFlowId, fromStep);
    (async () => {
      // No answer leaves Klaviyo off, which already disables its picker.
      const read = await settleRead(async () => readJson(await fetch('/api/klaviyo', { headers: await authHeaders() })));
      if (!read.answered) return;
      const data = read.data;
      setKlaviyoOn(Boolean(data?.klaviyo?.connected));
      setKlaviyoSends(data?.klaviyo?.sendWith === 'klaviyo');
      setKlaviyoFlows(Array.isArray(data?.klaviyo?.flows) ? data.klaviyo.flows : []);
    })();
  }, []);

  // A retry that answers removes the alert and the Retry button that held focus; hand focus to
  // the Flow map heading rather than letting it fall to the page.
  useEffect(() => {
    if (!retried.current || loadError) return;
    retried.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus();
  }, [loadError]);

  useEffect(() => {
    const heading = stepHeadingRef.current;
    if (!stepFocus || !heading) return;
    heading.focus({ preventScroll: true });
    // 'nearest' moves the page only as far as each box needs: first the map, so the step just chosen
    // is on screen (the studio keeps its scroll position from the tab it was opened from), then the
    // heading that holds focus, which wins when both do not fit.
    mapBoxRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    heading.scrollIntoView({ behavior: 'auto', block: 'nearest' });
  }, [stepFocus]);

  // A notice is about the last action. Choosing another step or editing one is a new action, so the
  // old sentence (a Saved that no longer covers the fields on screen) goes.
  const selectNode = (id: string) => {
    setSelected(id);
    setNotice('');
    setStepFocus((count) => count + 1);
  };

  const current = draft && draft.id === currentId ? draft : flows.find((flow) => flow.id === currentId) || null;
  const startsWhen = current ? startsWhenText(current.trigger, triggers) : '';
  const graph = useMemo(() => current ? layout(current, selected, nodeSizes.current, startsWhen) : { nodes: [], edges: [] }, [current, selected, startsWhen]);
  const selectedNode = current?.nodes.find((node) => node.id === selected) || null;
  const triggerHelp = triggers.find((trigger) => trigger.id === current?.trigger);
  // Open list: the flow's steps in the order a person meets them, for the keyboard list beside the map.
  const orderedSteps = useMemo(() => current ? flowStepOrder(current.nodes, current.edges) : [], [current]);
  // The flow on screen is not the one last loaded: an edit that is not saved yet. Every load and
  // every choice puts the loaded object itself back in draft.
  const unsaved = Boolean(draft && draft.id === currentId && flows.find((flow) => flow.id === draft.id) !== draft);
  // Wave 8: every way out of the editor asks before it drops this edit, not only the picker below
  // (src/lib/studioLeave.ts: Email Studio's tabs and App's view switch read it). Cleared on unmount.
  useEffect(() => { noteFlowUnsaved(unsaved); }, [unsaved]);
  useEffect(() => () => noteFlowUnsaved(false), []);
  // Open list: a reload or a closed tab drops the edit too, so the browser asks first while there is one,
  // the way the broadcast composer already does (studioLeave.ts warnBeforeUnload).
  useEffect(() => {
    if (!unsaved) return;
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [unsaved]);

  const choose = (id: string) => {
    // Choosing another flow drops the edits on screen, so it asks first.
    if (unsaved && id !== currentId && !window.confirm(FLOW_UNSAVED_LEAVE)) return;
    setCurrentId(id);
    setSelected('');
    setNotice('');
    setDraft(flows.find((flow) => flow.id === id) || null);
  };

  const save = async (next: FlowView) => {
    setNotice('');
    const sent = await sendFlowWrite(async () => fetch(`/api/email/flows/${next.id}`, {
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
    }));
    if (!sent.answered) {
      setNotice(FLOW_MAP_WRITE_UNREACHABLE.save);
      return;
    }
    const data = sent.data;
    if (!sent.ok || !data?.success) {
      setNotice(data?.error || 'That flow was not saved.');
      return;
    }
    setNotice('Saved. It sends only after you turn it on, and each email only once it comes due.');
    await load(next.id);
  };

  // A starter or built-in flow: only its emails and waits are sent. The server matches them to
  // the flow's own steps and refuses a graph whose steps changed.
  const saveContent = async (next: FlowView) => {
    if (saving) return;
    setNotice('');
    if (next.nodes.some((node) => node.type === 'delay' && !waitHoursOk(node.delayHours))) {
      setNotice('Nothing was saved, because a wait is not a whole number of hours from 1 to 2160.');
      return;
    }
    // Saved is said only once the server has answered; until then Save reads Saving and the status
    // region says so.
    setSaving(true);
    setNotice(next.kind === 'order' ? 'Saving this email.' : 'Saving these emails.');
    try {
      const sent = await sendFlowWrite(async () => fetch(`/api/email/flow-content/${next.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ nodes: next.nodes, edges: next.edges })
      }));
      if (!sent.answered) {
        setNotice(FLOW_MAP_WRITE_UNREACHABLE.content);
        return;
      }
      const data = sent.data;
      if (!sent.ok || !data?.success) {
        setNotice(data?.error || 'These emails were not saved.');
        return;
      }
      // An order email is read when Shopify reports the order event (server.mjs sendTransactional), so
      // nobody is part way through it.
      setNotice(next.kind === 'order'
        ? 'Saved. Every order email sent from now on uses this version.'
        : 'Saved. Every email sent from now on uses this version, including for people already in this flow.');
      onContentSaved?.(next.id);
      await load(next.id);
    } finally {
      setSaving(false);
    }
  };

  // Wave 2: Turn on or Turn off for a starter flow, on this account only. Only `enabled` is sent; the
  // server keeps the emails, and an unsaved edit on screen stays unsaved.
  const switchStarter = async (flow: FlowView, on: boolean) => {
    if (switchingFlow) return;
    const next = !on;
    const word = next ? 'on' : 'off';
    setSwitchingFlow(true);
    setNotice('');
    try {
      const sent = await sendFlowWrite(async () => fetch(`/api/email/flow-content/${flow.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ enabled: next })
      }));
      if (!sent.answered) {
        setNotice(FLOW_MAP_WRITE_UNREACHABLE.enabled);
        return;
      }
      const data = sent.data;
      if (!sent.ok || !data?.success || typeof data?.flow?.enabled !== 'boolean') {
        setNotice(data?.error || `${flow.name} was not turned ${word}.`);
        return;
      }
      const stored = data.flow.enabled === true;
      setSwitched((was) => ({ ...was, [flow.id]: stored }));
      setNotice(stored ? `${flow.name} is on. An email from it sends only when the email service accepts it.` : starterOffNotice(flow.name));
    } finally {
      setSwitchingFlow(false);
    }
  };

  const saveTimezone = async () => {
    setNotice('');
    const sent = await sendFlowWrite(async () => fetch('/api/email/timezone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ timezone })
    }));
    if (!sent.answered) {
      setNotice(FLOW_MAP_WRITE_UNREACHABLE.timezone);
      return;
    }
    const data = sent.data;
    setNotice(data?.error || (sent.ok ? 'Timezone saved. An empty value uses UTC.' : 'The timezone was not saved.'));
  };

  const create = async () => {
    setNotice('');
    const sent = await sendFlowWrite(async () => fetch('/api/email/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ name: 'New flow', trigger: 'manual' })
    }));
    if (!sent.answered) {
      setNotice(FLOW_MAP_WRITE_UNREACHABLE.create);
      return;
    }
    const data = sent.data;
    if (!sent.ok || !data?.flow?.id) {
      setNotice(data?.error || 'A flow was not created.');
      return;
    }
    await load(data.flow.id);
    // A new flow is made with one email (server.mjs POST /api/email/flows), so it opens on that email in
    // the builder: designing an email from scratch is New flow and nothing else.
    const first = Array.isArray(data.flow.nodes) ? data.flow.nodes.find((node: FlowNode) => node?.type === 'email') : undefined;
    if (first) selectNode(first.id);
  };

  // Delete asks first, naming the flow as it is saved (an unsaved new name is not the one being deleted).
  const remove = async () => {
    if (!current?.editable) return;
    const savedName = flows.find((flow) => flow.id === current.id)?.name || current.name;
    if (!window.confirm(`Delete the flow "${savedName}"? It is removed for good, and anyone still in it stops getting its emails.`)) return;
    setNotice('');
    const sent = await sendFlowWrite(async () => fetch(`/api/email/flows/${current.id}`, { method: 'DELETE', headers: await authHeaders() }));
    if (!sent.answered) {
      setNotice(FLOW_MAP_WRITE_UNREACHABLE.remove);
      return;
    }
    if (!sent.ok) {
      setNotice('That flow was not deleted.');
      return;
    }
    setSelected('');
    await load();
    // The Delete button went with the flow, so focus goes to the Flow map heading rather than the page,
    // and the status region says what happened.
    headingRef.current?.focus();
    setNotice(`The flow "${savedName}" was deleted.`);
  };

  const patchNode = (id: string, patch: Partial<FlowNode>) => {
    if (!current?.editable && !current?.contentEditable) return;
    setDraft({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) });
    setNotice('');
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
    setNotice('');
    const sent = await sendFlowWrite(async () => fetch(`/api/email/flows/${current.id}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ email: enrollEmail })
    }));
    if (!sent.answered) {
      setNotice(FLOW_MAP_WRITE_UNREACHABLE.enroll);
      return;
    }
    const data = sent.data;
    setNotice(data?.error || (data?.viaKlaviyo && data?.enrolled
      ? 'Handed to the linked Klaviyo flow. Klaviyo sends only if that flow is live. They were not subscribed.'
      : data?.enrolled
        ? 'Enrolled. Their first email sends once it comes due.'
        : 'They are already in this flow, or it is off.'));
    if (data?.enrolled) setEnrollEmail('');
  };

  const readyTriggers = triggers.filter((trigger) => trigger.events !== false);
  const waitingTriggers = triggers.filter((trigger) => trigger.events === false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 ref={headingRef} tabIndex={-1} style={{ margin: 0, fontSize: 18, color: '#f3f4f6' }}>Flow map</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af', maxWidth: 760 }}>
            Each account can build its own flow. A step runs only when the flow is on and the step comes due. A new flow stays off. A text goes only to a number that has already opted in. When Klaviyo is the sender, an email step linked to a Klaviyo flow is handed there instead.
          </p>
        </div>
        <button type="button" style={solidBtn} onClick={create}>New flow</button>
      </div>
      {loadError && (
        <div role="alert" data-studio-state="failed" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#fca5a5' }}>{loadError}</p>
          {loadRetry && <button type="button" aria-label={retryLabel(loadError)} style={ghostBtn} onClick={() => { retried.current = true; load(...retryFlowMapArgs(currentId, initialFlowId)); }}>Retry</button>}
        </div>
      )}
      {!loadError && !hubConnected && <p role="status" style={{ margin: 0, fontSize: 13, color: '#fbbf24' }}>{FLOWS_NOT_CONNECTED}</p>}
      {/* Wave 4: one editor. The list of every flow is All flows; here a picker switches flows (and asks
          first when the flow on screen has unsaved edits), then the map, with the step panel beside it
          from 900px wide and below it on a narrower screen. */}
      <div>
        <div style={{ ...card, minWidth: 0 }}>
          {flows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12, maxWidth: 420 }}>
              <label style={label} htmlFor="flow-picker">Flow to edit</label>
              <select id="flow-picker" style={field} value={currentId} onChange={(e) => choose(e.target.value)}>
                {FLOW_PICKER_GROUPS.map((group) => {
                  const items = flows.filter((flow) => pickerKind(flow) === group.kind);
                  return items.length ? (
                    <optgroup key={group.kind} label={group.label}>
                      {items.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </div>
          )}
          {current && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#f3f4f6' }}>{current.name}</div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>{current.compileError || current.note || `${current.active || 0} active · ${current.stepCount || 0} send steps`}</div>
                {current.stats && (
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: '#d1d5db' }}>
                    Enrolled {statText(current.enrolled)} · Sent {statText(current.stats.sent)} · Delivered {statText(current.stats.delivered)} · Opened {statText(current.stats.opened)} · Clicked {statText(current.stats.clicked)} · Unsubscribed {statText(current.stats.unsubscribed)} · Revenue {moneyText(current.stats.revenue)}
                    {current.stats.prefetchOpens ? ` · ${current.stats.prefetchOpens} opens included an Apple Mail prefetch flag.` : ''}
                  </p>
                )}
              </div>
              {/* Wave 8: one rule in both headers. Save is the one filled button; Turn on or Turn off is an
                  outline beside the state said in words; Delete is an outline, set apart. Each is 44px tall. */}
              {current.editable && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {unsaved && <span style={{ fontSize: 12, color: '#fbbf24' }}>Unsaved changes</span>}
                  <span data-flow-header-state={current.id} style={{ fontSize: 12, fontWeight: 700, color: current.enabled ? '#6ee7b7' : '#d1d5db' }}>{current.enabled ? 'On' : 'Off'}</span>
                  <button type="button" data-flow-header-switch={current.id} style={{ ...ghostBtn, minHeight: 44 }} onClick={() => save({ ...current, enabled: !current.enabled })}>{current.enabled ? 'Turn off' : 'Turn on'}</button>
                  <button type="button" data-flow-header-save={current.id} style={{ ...solidBtn, minHeight: 44 }} onClick={() => save(current)}>Save</button>
                  <button type="button" style={{ ...ghostBtn, minHeight: 44, marginLeft: 12 }} onClick={remove}>Delete</button>
                </div>
              )}
              {!current.editable && current.contentEditable && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {unsaved && !saving && <span style={{ fontSize: 12, color: '#fbbf24' }}>Unsaved changes</span>}
                  {current.kind === 'sequence' && (() => {
                    // Wave 2: a starter flow turns on and off here and on All flows, for this account only.
                    const on = switched[current.id] ?? current.enabled !== false;
                    const text = switchingFlow ? 'Saving' : on ? 'Turn off' : 'Turn on';
                    // The state stays said in words beside the button, which names only the action.
                    return (
                      <>
                        <span data-flow-header-state={current.id} style={{ fontSize: 12, fontWeight: 700, color: on ? '#6ee7b7' : '#d1d5db' }}>{on ? 'On for this account' : 'Off for this account'}</span>
                        <button type="button" data-flow-header-switch={current.id} style={{ ...ghostBtn, minHeight: 44, opacity: switchingFlow ? 0.6 : 1 }} aria-disabled={switchingFlow} onClick={() => switchStarter(current, on)}>{text}</button>
                      </>
                    );
                  })()}
                  {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page. */}
                  <button type="button" data-flow-header-save={current.id} style={{ ...solidBtn, minHeight: 44, opacity: saving ? 0.6 : 1 }} aria-disabled={saving} onClick={() => saveContent(current)}>{saving ? 'Saving' : 'Save'}</button>
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: beside ? 'row' : 'column', gap: beside ? 16 : 0, alignItems: beside ? 'flex-start' : 'stretch' }}>
          {/* Beside the panel the map stays in view while the panel scrolls. */}
          <div ref={mapBoxRef} data-flow-map="map" style={{ height: 420, background: '#0b0b10', borderRadius: 10, minWidth: 0, ...(beside ? { flex: '1 1 0', position: 'sticky', top: 8, marginTop: 12 } : {}) }}>
            {/* Fitted to the box it is drawn in: a new key when the panel moves beside or below fits it again. */}
            <ReactFlow
              key={beside ? 'beside' : 'below'}
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              fitView
              onNodeClick={(_, node) => selectNode(node.id)}
              // Enter or Space on a focused step selects it too, through the same path as a click. A
              // measured size is kept for the next rebuild of the map (nodeSizes above).
              onNodesChange={(changes) => {
                for (const change of changes) {
                  if (change.type === 'dimensions' && change.dimensions && current) nodeSizes.current.set(`${current.id}\n${change.id}`, change.dimensions);
                  if (change.type === 'select' && change.selected) selectNode(change.id);
                }
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          {/* Beside the map the panel's column is there from the first frame, before a flow has loaded, so the
              map is fitted to the width it keeps (it was fitted full width, then halved, and drawn off its edge). */}
          {(beside || current?.editable || current?.contentEditable) && (
          <div data-flow-map="panel" style={{ minWidth: 0, ...(beside ? { flex: '1 1 0' } : {}) }}>
          {(current?.editable || current?.contentEditable) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {/* Open list: every step of the flow as a named button, in order, so a keyboard user chooses an
                  email without walking the map's boxes. Enter or a click selects it, the same as on the map,
                  and moves focus to the step heading below; the chosen one is marked aria-current and by a
                  bar and a heavier weight, never by colour alone. */}
              {orderedSteps.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <p id="flow-steps-label" style={{ ...label, margin: 0 }}>Steps in this flow</p>
                  <ol aria-labelledby="flow-steps-label" data-flow-steps={current.id} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {orderedSteps.map((node) => {
                      const chosen = node.id === selected;
                      return (
                        <li key={node.id}>
                          <button
                            type="button"
                            data-flow-step={node.id}
                            aria-current={chosen ? 'step' : undefined}
                            onClick={() => selectNode(node.id)}
                            // Four longhand sides, not ghostBtn's border shorthand: the left side changes with the choice.
                            style={stepButton(chosen)}
                          >
                            {stepNameOf(current, node, startsWhen)}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
              {current.editable && (
              <>
              {/* Wave 4: the flow's own settings stay closed until asked for, so the step being edited
                  comes first. A native disclosure: Enter or Space opens it, and its state is announced. */}
              <details style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '0 12px' }}>
              <summary style={{ display: 'list-item', cursor: 'pointer', padding: '12px 0', fontSize: 13, fontWeight: 700, color: '#e5e7eb' }}>Flow settings</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 12 }}>
              <label style={label} htmlFor="flow-settings-name">Name</label>
              <input id="flow-settings-name" style={field} value={current.name} onChange={(e) => setDraft({ ...current, name: e.target.value })} />
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
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>They start at 8:00 in the account timezone. A predicted next order is not used. Yearly and monthly start again only when re-entry allows it.</p>
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
              </div>
              </details>
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
                  Copied from Klaviyo flow {current.klaviyoFlowId}. It stays off until you turn it on. While Klaviyo is the sender and this flow is on, its start hands the person to that Klaviyo flow once. The copied emails are not sent from here.
                </p>
              )}
              </>
              )}
              {selectedNode && (
                <h3 ref={stepHeadingRef} tabIndex={-1} style={{ margin: '8px 0 0', fontSize: 15, color: '#f3f4f6' }}>{stepHeadingText(current, selectedNode)}</h3>
              )}
              {!current.editable && current.note && (
                // D3: the panel says whose emails these are. The heading above takes focus, so this is read next.
                <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>{current.note}</p>
              )}
              {selectedNode?.type === 'email' && selectedNode.starterDraft === true && (
                // D6 (Wave 2): the server says this email is still the seeded draft, which is skipped and never
                // sent. It goes once an edit is saved, because the next load no longer marks it.
                <p data-starter-draft="" style={{ margin: 0, fontSize: 13, color: '#fbbf24' }}>{STARTER_DRAFT_NOTE}</p>
              )}
              {!selectedNode && !current.editable && (
                <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>Choose an email or a wait on the map to edit it.</p>
              )}
              {selectedNode?.type === 'trigger' && !current.editable && (
                <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>
                  Starts when: {startsWhenText(current.trigger, triggers)}. The start and the order of the steps stay as they are. {current.kind === 'order' ? 'Its email can be edited.' : 'Its emails and its waits can be edited.'}
                </p>
              )}
              {selectedNode?.type === 'email' && (
                <>
                  <label style={label} htmlFor="flow-step-subject">Subject</label>
                  <input id="flow-step-subject" style={field} value={selectedNode.subject || ''} onChange={(e) => patchNode(selectedNode.id, { subject: e.target.value })} />
                  {/* An order email keeps no preview text (the programs record stores its subject and blocks), so it has no field for one. */}
                  {current.kind !== 'order' && (
                  <>
                  <label style={label} htmlFor="flow-step-preview">Preview text</label>
                  <input id="flow-step-preview" style={field} value={selectedNode.previewText || ''} onChange={(e) => patchNode(selectedNode.id, { previewText: e.target.value })} />
                  </>
                  )}
                  {selectedNode.blocks?.[0]?.kind === 'html' ? (
                    <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>This email was copied from a Klaviyo template. When Jourvance sends it, if, else, for, default, lookup, catalog, and coupon tags are filled. Any other tag is removed and listed on this flow as not translated. When Klaviyo is the sender, Klaviyo fills the template.</p>
                  ) : (
                    <div role="group" aria-labelledby="flow-step-content" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span id="flow-step-content" style={label}>Email content</span>
                      <BlockEditor blocks={selectedNode.blocks || []} onChange={(blocks) => patchNode(selectedNode.id, { blocks })} />
                    </div>
                  )}
                  {current.kind === 'order' && <EmailStepPreview key={current.id} subject={selectedNode.subject || ''} blocks={selectedNode.blocks || []} />}
                  {current.editable && (
                  <>
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
                      : 'Jourvance is the sender, so this step still sends from here. The link is used when you choose Send with Klaviyo in Settings, Klaviyo.'}
                  </p>
                  </>
                  )}
                </>
              )}
              {selectedNode?.type === 'delay' && !current.editable && (
                <>
                  <label style={label} htmlFor="flow-step-wait">Wait, in hours</label>
                  <input
                    id="flow-step-wait"
                    style={field}
                    type="number"
                    min={1}
                    max={2160}
                    step={1}
                    aria-invalid={!waitHoursOk(selectedNode.delayHours)}
                    aria-describedby="flow-step-wait-help"
                    value={Number.isFinite(selectedNode.delayHours) ? selectedNode.delayHours : ''}
                    onChange={(e) => patchNode(selectedNode.id, { delayHours: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
                  />
                  <p id="flow-step-wait-help" style={{ margin: 0, fontSize: 12, color: waitHoursOk(selectedNode.delayHours) ? '#9ca3af' : '#fca5a5' }}>
                    {waitHoursOk(selectedNode.delayHours)
                      ? 'The next email sends this many hours after the step before it. From 1 to 2160 hours, which is 90 days.'
                      : WAIT_RANGE}
                  </p>
                </>
              )}
              {selectedNode?.type === 'delay' && current.editable && (
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
                      {withNote(`${path.label || path.id}${path.else && !/everyone else/i.test(path.label || '') ? ' (everyone else)' : ''}`, path.note)}
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
              {current.editable && current.sunset && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                    Quiet period in days
                    <input aria-label="Sunset quiet period" style={{ ...field, marginTop: 4 }} type="number" min={1} max={365} value={current.quietAfterDays ?? ''} onChange={(e) => setDraft({ ...current, quietAfterDays: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </label>
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>After this many days, someone who was sent mail and did not open or click is marked unengaged. This flow sends nothing. The button below is the only suppress action.</p>
                  <button type="button" style={ghostBtn} onClick={async () => {
                    setNotice('');
                    const sent = await sendFlowWrite(async () => fetch(`/api/email/flows/${current.id}/suppress`, { method: 'POST', headers: await authHeaders() }));
                    if (!sent.answered) {
                      setNotice(FLOW_MAP_WRITE_UNREACHABLE.suppress);
                      return;
                    }
                    setNotice(sent.data?.message || sent.data?.error || 'Nobody was suppressed.');
                  }}>Suppress people marked unengaged</button>
                </div>
              )}
              {current.editable && current.trigger === 'manual' && !current.sunset && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input style={{ ...field, flex: '1 1 180px' }} value={enrollEmail} placeholder="Email to enroll" onChange={(e) => setEnrollEmail(e.target.value)} />
                  <button type="button" style={ghostBtn} onClick={enroll}>Enroll</button>
                </div>
              )}
            </div>
          )}
          </div>
          )}
          </div>
          {/* Always mounted, so a screen reader hears each outcome, the failures included. Sticky at the
              foot of the studio's scroller, so the outcome of Save at the top of a long panel is on
              screen too, not only heard. */}
          <p role="status" style={{ margin: notice ? '8px 0 0' : 0, fontSize: 13, color: '#d1d5db', position: 'sticky', bottom: 0, zIndex: 10, background: notice ? '#16161d' : 'transparent', padding: notice ? '8px 10px' : 0, borderRadius: 8, border: notice ? '1px solid rgba(244,114,182,0.5)' : 'none' }}>{notice}</p>
        </div>
      </div>
    </div>
  );
};
