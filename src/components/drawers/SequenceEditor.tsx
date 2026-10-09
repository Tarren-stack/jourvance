import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles, RefreshCw, Plus, Trash2, Clock, Mail, MessageSquare,
  Copy, Check, Send, ShoppingBag, ExternalLink, CheckCircle2
} from 'lucide-react';
import type { SequenceNodeData, SequenceStep, Workspace } from '../../types/journey';
import { requestAICopyAnswer } from '../../lib/hubClient';
import {
  readEmailCopyAnswer,
  planEmailCopyRows,
  applyEmailCopyRows,
  emailCopyGoal,
  initialFocus,
  joinLabels,
  EMAIL_COPY_LABELS,
  type CopyField,
  type EmailCopyField,
  type SuggestedCopy
} from '../../lib/pageCopyProposal';
import { CopyProposalCard } from './CopyProposalCard';
import { authHeaders } from '../../lib/firebase';
import {
  STUDIO_NOT_OPENED, LINKED_FLOW_MISSING, LINKED_FLOW_UNREAD, FLOW_BUILDING, FLOW_NOT_BUILT_UNANSWERED, emailStudioButtonLabel, flowFromStepLetters,
  flowNotBuilt, flowStartForStep, linkedFlowEmails, linkedLettersNote, stepLettersSource, type StepFlowLink
} from '../../lib/editorReturn';
import { useFieldIds } from '../../lib/a11yHooks';
import { sequencePreset, fillVoucherCode, type SequencePresetType } from '../../lib/sequencePresets';

interface Props {
  data: SequenceNodeData;
  onChange: (updated: SequenceNodeData) => void;
  offerHeadline: string;
  businessType: string;
  workspace?: Workspace | null;
  journeyId?: string;
  nodeId?: string;
  /** Saves the journey, then opens Email Studio on this step's flow. Resolves false when the save did not land. */
  onOpenEmailStudio?: () => Promise<boolean>;
  /** True while that save is in flight. */
  openingEmailStudio?: boolean;
  /** True once, when the user came back from Email Studio to this step. */
  focusStudioButton?: boolean;
  /**
   * Build a flow (Wave 7): this editor has made the flow from the step's letters; App links the step
   * to it, saves, then opens Email Studio on it. Resolves false when the save did not land.
   */
  onBuildEmailFlow?: (flow: StepFlowLink) => Promise<boolean>;
}

/** A row of GET /api/email/flow-map that the flow picker and the linked flow's summary read. */
type FlowRow = { id: string; name: string; enabled: boolean; nodes?: unknown[]; edges?: unknown[] };

type KlaviyoChoice = {
  id: string;
  name: string;
  status: string;
  canEnter: boolean;
  handoff: string;
};

export const SequenceEditor: React.FC<Props> = ({
  data,
  onChange,
  offerHeadline,
  businessType,
  workspace,
  journeyId,
  nodeId,
  onOpenEmailStudio,
  openingEmailStudio,
  focusStudioButton,
  onBuildEmailFlow
}) => {
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [loadingAI, setLoadingAI] = useState(false);
  const [editorTab, setEditorTab] = useState<'settings' | 'preview' | 'export'>('settings');
  // Ties each label to its control (#19). Ids are unique per mounted editor.
  const fid = useFieldIds();

  // Export & Test Send state
  const [copiedKlaviyo, setCopiedKlaviyo] = useState(false);
  const [copiedShopify, setCopiedShopify] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [klaviyoFlows, setKlaviyoFlows] = useState<KlaviyoChoice[]>([]);
  const [klaviyoSendWith, setKlaviyoSendWith] = useState<'jourvance' | 'klaviyo'>('jourvance');
  const [klaviyoConnected, setKlaviyoConnected] = useState(false);
  const [klaviyoNotice, setKlaviyoNotice] = useState('');
  const [jourvanceFlows, setJourvanceFlows] = useState<FlowRow[]>([]);
  // The flow list is read once per open step. A summary is drawn only from a list that loaded, and a
  // linked flow is called missing only then (D7 rule 5).
  const [flowsLoad, setFlowsLoad] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [buildingFlow, setBuildingFlow] = useState(false);
  const studioButtonRef = useRef<HTMLButtonElement>(null);
  const [studioNotice, setStudioNotice] = useState('');
  // Which button's sentence it is: the one under the flow picker, or the one in the linked flow's summary.
  const [noticeAt, setNoticeAt] = useState<'picker' | 'summary'>('picker');
  // Set in the click itself, before any await, and held until the open settles: a second press, in the
  // same tick or while the build, the link or the save is on its way, does nothing (Wave 7 fix round).
  const busyRef = useRef(false);
  // The flow this step built, so a press after a failed link or save links it again and never posts a
  // second flow. App links the step before it saves, so the step normally reads Edit by then.
  const builtRef = useRef<StepFlowLink | null>(null);

  // Coming back from Email Studio hands focus to the button that left, once.
  useEffect(() => { if (focusStudioButton) studioButtonRef.current?.focus(); }, [focusStudioButton]);

  // Email Studio opens only after the journey saved. When it did not, focus stays on the button
  // and one sentence says why. A step with no flow builds one first (Wave 7).
  const openStudio = async (at: 'picker' | 'summary' = 'picker') => {
    if (!onOpenEmailStudio || openingEmailStudio || busyRef.current) return;
    busyRef.current = true;
    setNoticeAt(at);
    setStudioNotice('');
    try {
      if (!data.jourvanceFlowId && onBuildEmailFlow) await buildFlow(onBuildEmailFlow);
      else if (!(await onOpenEmailStudio())) setStudioNotice(STUDIO_NOT_OPENED);
    } finally {
      busyRef.current = false;
    }
  };

  // Build a flow in Email Studio: the step's letters become a flow on the account (created off),
  // then App links the step, saves the journey and opens the flow, so nobody comes back to choose it.
  // A build the server refused says why and changes nothing. A built flow is never posted twice.
  const buildFlow = async (linkAndOpen: (flow: StepFlowLink) => Promise<boolean>) => {
    let flow = builtRef.current;
    if (!flow) {
      const plan = flowFromStepLetters(data);
      if (!plan.ok) {
        setStudioNotice(plan.error);
        return;
      }
      setBuildingFlow(true);
      try {
        const res = await fetch('/api/email/flows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify(plan.flow)
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.success && typeof body.flow?.id === 'string') {
          const row: FlowRow = { id: body.flow.id, name: String(body.flow.name || plan.flow.name), enabled: body.flow.enabled === true, nodes: body.flow.nodes, edges: body.flow.edges };
          flow = { id: row.id, name: row.name };
          builtRef.current = flow;
          setJourvanceFlows(rows => [row, ...rows.filter(r => r.id !== row.id)]);
        } else {
          setStudioNotice(flowNotBuilt(res.status, body?.error));
        }
      } catch {
        setStudioNotice(FLOW_NOT_BUILT_UNANSWERED);
      }
    }
    if (!flow) {
      setBuildingFlow(false);
      return;
    }
    setBuildingFlow(true);
    try {
      if (!(await linkAndOpen(flow))) setStudioNotice(STUDIO_NOT_OPENED);
    } finally {
      setBuildingFlow(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/klaviyo', { headers: await authHeaders() });
        const body = await res.json().catch(() => ({}));
        if (!cancelled && body?.klaviyo) {
          setKlaviyoConnected(Boolean(body.klaviyo.connected));
          setKlaviyoSendWith(body.klaviyo.sendWith === 'klaviyo' ? 'klaviyo' : 'jourvance');
          setKlaviyoFlows(Array.isArray(body.klaviyo.flows) ? body.klaviyo.flows : []);
        }
      } catch { /* the Klaviyo picker stays empty */ }
      // Read on its own, so a Klaviyo read that fails never leaves the flow picker unread.
      try {
        const map = await fetch('/api/email/flow-map', { headers: await authHeaders() });
        const flows = await map.json().catch(() => ({}));
        if (cancelled) return;
        if (!map.ok || !Array.isArray(flows?.flows)) {
          setFlowsLoad('failed');
          return;
        }
        setJourvanceFlows(flows.flows.filter((flow: { kind?: string }) => flow.kind === 'flow').map((flow: FlowRow) => ({
          id: flow.id, name: flow.name, enabled: flow.enabled === true, nodes: flow.nodes, edges: flow.edges
        })));
        setFlowsLoad('loaded');
      } catch {
        if (!cancelled) setFlowsLoad('failed');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const linkKlaviyo = async (flowId: string, when: SequenceNodeData['klaviyoWhen']) => {
    const chosen = klaviyoFlows.find((flow) => flow.id === flowId);
    const nextWhen = when || 'lead_capture';
    onChange({ ...data, klaviyoFlowId: flowId, klaviyoFlowName: chosen?.name || '', klaviyoWhen: nextWhen });
    if (!journeyId || !nodeId) {
      setKlaviyoNotice('Save the map once so this journey is on the account, then choose the flow again.');
      return;
    }
    const res = await fetch('/api/klaviyo/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ journeyId, nodeId, klaviyoFlowId: flowId, when: nextWhen })
    });
    const body = await res.json().catch(() => ({}));
    setKlaviyoNotice(body?.error || (flowId ? 'Link saved. It runs when Klaviyo is the sender.' : 'This node will not hand anyone to Klaviyo.'));
  };

  const steps = data.steps || [];
  const currentStep = steps[activeStepIdx] || steps[0];

  // AI copy is a proposal until the person keeps it, as in the page editor. Anything that is not
  // real hub-brain copy (template text, the hourly limit, no answer) is one sentence and changes
  // nothing. `aiRequest` numbers each request so a reply landing after a letter switch or after
  // the inspector closed is dropped.
  const [proposal, setProposal] = useState<{ stepId: string; copy: SuggestedCopy<EmailCopyField> } | null>(null);
  const [selectedFields, setSelectedFields] = useState<CopyField[]>([]);
  const [aiNotice, setAiNotice] = useState('');
  const aiRequest = useRef(0);
  const polishButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setProposal(null);
    setAiNotice('');
    setLoadingAI(false);
    return () => { aiRequest.current++; };
  }, [currentStep?.id]);

  const handleStepChange = (field: keyof SequenceStep, val: any) => {
    const updated = [...steps];
    updated[activeStepIdx] = { ...updated[activeStepIdx], [field]: val };
    onChange({ ...data, steps: updated });
  };

  // A new letter starts empty, with the hints below saying what to write, and Check design asks for
  // its words. It used to arrive with a subject about "your order" on journeys that sell nothing (T10).
  const addStep = () => {
    const newStep: SequenceStep = {
      id: `step-${Date.now()}`,
      channel: 'email',
      delay: '48 Hours',
      subject: '',
      previewText: '',
      body: ''
    };
    const updated = [...steps, newStep];
    onChange({ ...data, steps: updated });
    setActiveStepIdx(updated.length - 1);
  };

  const removeStep = (idx: number) => {
    if (steps.length <= 1) return;
    const updated = steps.filter((_, i) => i !== idx);
    onChange({ ...data, steps: updated });
    setActiveStepIdx(Math.max(0, idx - 1));
  };

  // Presets write "Replace this" drafts and leave the voucher code as the person set it (C46).
  const loadEcommerceTemplate = (type: SequencePresetType) => {
    onChange({ ...data, ...sequencePreset(type) });
    setActiveStepIdx(0);
  };

  const generateStepCopy = async () => {
    const step = currentStep;
    if (!step) return;
    const ticket = ++aiRequest.current;
    setAiNotice('');
    setProposal(null);
    setLoadingAI(true);
    try {
      const answer = await requestAICopyAnswer({
        nodeType: 'email',
        businessType: businessType || 'E-Commerce Store',
        offerHeadline: step.subject || offerHeadline,
        goal: emailCopyGoal(step.delay)
      });
      // The letter changed or the inspector closed while this was in flight.
      if (ticket !== aiRequest.current) return;
      const read = readEmailCopyAnswer(answer as { status: number; body: any } | null);
      if (read.kind === 'unavailable') {
        setAiNotice(read.message);
        return;
      }
      const rows = planEmailCopyRows(step, read.copy);
      if (rows.length === 0) {
        setAiNotice('The suggestion matches this letter. Nothing was changed.');
        return;
      }
      setProposal({ stepId: step.id, copy: read.copy });
      setSelectedFields(rows.map(r => r.field));
    } finally {
      if (ticket === aiRequest.current) setLoadingAI(false);
    }
  };

  // Planned from the live letter on every render, so "Now" is what the field holds this moment.
  const proposalStep = proposal ? steps.find(s => s.id === proposal.stepId) : undefined;
  const proposalRows = proposal && proposalStep ? planEmailCopyRows(proposalStep, proposal.copy) : [];

  // The kept fields land in ONE onChange built from the current steps. Three field-by-field writes
  // each copied the same stale steps, so only the last one landed.
  const applyProposal = () => {
    if (!proposal) return;
    const fields = selectedFields.filter(f => proposalRows.some(r => r.field === f));
    if (fields.length > 0) onChange({ ...data, steps: applyEmailCopyRows(steps, proposal.stepId, proposal.copy, fields) });
    setProposal(null);
    setAiNotice(fields.length > 0 ? `Updated ${joinLabels(fields.map(f => EMAIL_COPY_LABELS[f as EmailCopyField]))}.` : '');
    polishButtonRef.current?.focus();
  };

  const keepCopy = () => {
    setProposal(null);
    polishButtonRef.current?.focus();
  };

  const copyForKlaviyo = () => {
    const vCode = (text: string) => fillVoucherCode(text, data.voucherCode);
    const text = steps
      .map(
        (s, i) =>
          `EMAIL #${i + 1} (${s.delay})\nSubject: ${vCode(s.subject)}\nPreview: ${vCode(s.previewText || '')}\n\n${vCode(s.body)
            .replace(/\[First Name\]/g, "{{ first_name|default:'there' }}")
            .replace(/\[Offer Link\]/g, '{{ event.extra.offer_url|default:shop.url }}')
            .replace(/\[Checkout Link\]/g, '{{ event.checkout_url }}')}\n-----------------------------------\n`
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopiedKlaviyo(true);
    setTimeout(() => setCopiedKlaviyo(false), 2200);
  };

  const copyForShopify = () => {
    const vCode = (text: string) => fillVoucherCode(text, data.voucherCode);
    const html = steps
      .map(
        (s, i) =>
          `<!-- EMAIL #${i + 1} (${s.delay}) -->\n<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">\n  <h2>${vCode(s.subject)}</h2>\n  <p>${vCode(s.body)
            .replace(/\n/g, '<br/>')
            .replace(/\[First Name\]/g, '{{ customer.first_name }}')
            .replace(/\[Offer Link\]/g, '<a href="{{ offer_url }}">View the offer</a>')
            .replace(/\[Checkout Link\]/g, '<a href="{{ checkout_url }}">Complete Checkout</a>')}</p>\n</div>\n\n`
      )
      .join('\n');
    navigator.clipboard.writeText(html);
    setCopiedShopify(true);
    setTimeout(() => setCopiedShopify(false), 2200);
  };

  const sendTestEmail = async () => {
    if (!testEmail.trim()) return;
    setSendingTest(true);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          recipients: [{ email: testEmail.trim(), name: 'Test Recipient' }],
          subject: `[Test] ${currentStep.subject}`,
          html: `<p>${currentStep.body.replace(/\n/g, '<br/>')}</p>`
        })
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        setTestSuccess(true);
        setTimeout(() => setTestSuccess(false), 3000);
      }
    } finally {
      setSendingTest(false);
    }
  };

  const linked = klaviyoFlows.find((flow) => flow.id === data.klaviyoFlowId);

  // Wave 7: a step linked to a flow sends that flow's emails. Its own letters are kept, and only
  // Build a flow reads them, so Flow Steps shows the linked flow's emails, read only.
  const linkedFlowId = String(data.jourvanceFlowId || '');
  const linkedRow = linkedFlowId ? jourvanceFlows.find((flow) => flow.id === linkedFlowId) : undefined;
  const linkedName = linkedRow?.name || data.jourvanceFlowName || 'the linked flow';
  const linkedSummary = linkedRow ? linkedFlowEmails(linkedRow) : null;

  const chooseJourvanceFlow = (flowId: string) => {
    const chosen = jourvanceFlows.find((flow) => flow.id === flowId);
    onChange({ ...data, jourvanceFlowId: flowId, jourvanceFlowName: chosen?.name || '' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.28)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#f3f4f6' }}>Jourvance flow</div>
        <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af', lineHeight: 1.45 }}>
          {klaviyoSendWith === 'klaviyo'
            ? 'Klaviyo is the sender, so the handoff below runs. This flow link stays saved until you choose Jourvance in Email Studio, under Settings, Klaviyo.'
            : 'A lead from this map and a form on its page join this flow once. The flow’s own trigger joins the same run. One person, one visitor id, one run. The flow sends after you turn it on. Enrolled, sent, clicked, and last-touch revenue here match the flow map. Opens stay blank until an open is stored.'}
        </p>
        <label style={{ fontSize: '11px', color: '#d1d5db' }}>
          Flow on this account
          <select
            aria-label="Jourvance flow for this follow-up"
            value={data.jourvanceFlowId || ''}
            onChange={(e) => chooseJourvanceFlow(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px', borderRadius: 6, background: '#0a0a0f', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <option value="">No Jourvance flow yet</option>
            {jourvanceFlows.map((flow) => (
              <option key={flow.id} value={flow.id}>{flow.name} · {flow.enabled ? 'On' : 'Off'}</option>
            ))}
          </select>
        </label>
        {onOpenEmailStudio && (
          <button
            ref={studioButtonRef}
            type="button"
            onClick={() => openStudio('picker')}
            aria-disabled={openingEmailStudio || buildingFlow || undefined}
            style={{
              alignSelf: 'flex-start',
              padding: '6px 10px',
              borderRadius: 6,
              background: 'rgba(245, 158, 11, 0.16)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              color: '#FDE68A',
              fontSize: '12px',
              fontWeight: 700,
              cursor: openingEmailStudio || buildingFlow ? 'wait' : 'pointer'
            }}
          >
            {openingEmailStudio ? 'Saving\u2026' : buildingFlow ? 'Building the flow\u2026' : emailStudioButtonLabel(Boolean(data.jourvanceFlowId))}
          </button>
        )}
        {onOpenEmailStudio && (
          <p role="status" style={{ margin: 0, fontSize: '12px', color: buildingFlow ? '#d1d5db' : '#FCA5A5' }}>
            {buildingFlow ? FLOW_BUILDING : noticeAt === 'picker' ? studioNotice : ''}
          </p>
        )}
        {jourvanceFlows.length === 0 && <p style={{ margin: 0, fontSize: '12px', color: '#d1d5db' }}>This step waits until a flow is chosen.</p>}
      </div>
      <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.28)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#f3f4f6' }}>Hand this email to Klaviyo</div>
        <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af', lineHeight: 1.45 }}>
          {klaviyoConnected
            ? (klaviyoSendWith === 'klaviyo'
              ? 'Klaviyo is the sender. When someone reaches this node, Jourvance adds them to that flow’s list or sends the event that starts it. It does not subscribe them, and it does not turn the flow on.'
              : 'Jourvance is the sender. This link is saved and waits until you choose Klaviyo in Email Studio, under Settings, Klaviyo.')
            : 'Connect Klaviyo in Email Studio, under Settings, Klaviyo, then choose the flow this node should start.'}
        </p>
        <label style={{ fontSize: '11px', color: '#d1d5db' }}>
          Klaviyo flow
          <select
            aria-label="Klaviyo flow for this email node"
            value={data.klaviyoFlowId || ''}
            disabled={!klaviyoConnected}
            onChange={(e) => linkKlaviyo(e.target.value, data.klaviyoWhen || 'lead_capture')}
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px', borderRadius: 6, background: '#0a0a0f', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <option value="">Do not hand this node to Klaviyo</option>
            {klaviyoFlows.map((flow) => (
              <option key={flow.id} value={flow.id}>{flow.name} · {flow.status || 'status unknown'}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: '11px', color: '#d1d5db' }}>
          Start it when
          <select
            aria-label="When to hand this email node to Klaviyo"
            value={data.klaviyoWhen || 'lead_capture'}
            disabled={!klaviyoConnected || !data.klaviyoFlowId}
            onChange={(e) => linkKlaviyo(data.klaviyoFlowId || '', e.target.value as SequenceNodeData['klaviyoWhen'])}
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px', borderRadius: 6, background: '#0a0a0f', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <option value="lead_capture">Someone joins from a page on this map</option>
            <option value="exit_intent">Someone submits an exit offer on this map</option>
            <option value="checkout_abandonment">Someone leaves checkout from this map</option>
            <option value="order_paid">A paid order is recorded for this map</option>
          </select>
        </label>
        {linked && <p style={{ margin: 0, fontSize: '12px', color: '#e5e7eb' }}>{linked.handoff}</p>}
        {klaviyoNotice && <p style={{ margin: 0, fontSize: '12px', color: '#d1d5db' }}>{klaviyoNotice}</p>}
      </div>
      {/* Tab Switcher: aria-pressed says which view is showing, as the header's view tabs do. */}
      <div
        role="group"
        aria-label="Editor view"
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.35)',
          padding: '4px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        <button
          type="button"
          aria-pressed={editorTab === 'settings'}
          onClick={() => setEditorTab('settings')}
          style={{
            flex: 1,
            padding: '6px 8px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: editorTab === 'settings' ? '#ec4899' : 'transparent',
            color: editorTab === 'settings' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Flow Steps
        </button>
        <button
          type="button"
          aria-pressed={editorTab === 'preview'}
          onClick={() => setEditorTab('preview')}
          style={{
            flex: 1,
            padding: '6px 8px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: editorTab === 'preview' ? '#ec4899' : 'transparent',
            color: editorTab === 'preview' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Inbox Preview
        </button>
        <button
          type="button"
          aria-pressed={editorTab === 'export'}
          onClick={() => setEditorTab('export')}
          style={{
            flex: 1,
            padding: '6px 8px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: editorTab === 'export' ? '#10b981' : 'transparent',
            color: editorTab === 'export' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Export / Klaviyo
        </button>
      </div>

      {/* EXPORT TAB */}
      {editorTab === 'export' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {linkedFlowId && <p style={{ margin: 0, fontSize: '12px', color: '#d1d5db', lineHeight: 1.45 }}>{linkedLettersNote(linkedName)}</p>}
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle2 size={16} style={{ color: '#10b981' }} />
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#f3f4f6' }}>
                Klaviyo & Shopify Email Bridge
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af', lineHeight: 1.5 }}>
              Jourvance formats all letters and delay intervals so you can paste them directly into Klaviyo Flows or Shopify Email campaigns with zero lock-in.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                onClick={copyForKlaviyo}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  backgroundColor: copiedKlaviyo ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                  border: `1px solid ${copiedKlaviyo ? '#10b981' : 'rgba(255, 255, 255, 0.15)'}`,
                  color: copiedKlaviyo ? '#34d399' : '#ffffff',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                {copiedKlaviyo ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedKlaviyo ? 'Klaviyo Flow Copied to Clipboard!' : 'Copy Formatted for Klaviyo'}</span>
              </button>

              <button
                type="button"
                onClick={copyForShopify}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  backgroundColor: copiedShopify ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                  border: `1px solid ${copiedShopify ? '#10b981' : 'rgba(255, 255, 255, 0.15)'}`,
                  color: copiedShopify ? '#34d399' : '#ffffff',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                {copiedShopify ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedShopify ? 'Shopify HTML Copied to Clipboard!' : 'Copy Responsive Shopify HTML'}</span>
              </button>
            </div>
          </div>

          {/* Test Send via Hub Email */}
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Send size={14} style={{ color: '#ec4899' }} /> Send Test via Zelus Hub
            </div>
            <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af' }}>
              Test current step #{activeStepIdx + 1} ({currentStep.delay}) directly in your inbox.
            </p>

            {testSuccess && (
              <div style={{ fontSize: '12px', color: '#34d399', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Check size={13} /> Test letter sent! Check your inbox.
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="email"
                aria-label="Test email address"
                placeholder="your.email@example.com"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: '6px',
                  backgroundColor: '#0a0a0f',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  fontSize: '12px',
                  outline: 'none'
                }}
              />
              <button
                type="button"
                onClick={sendTestEmail}
                disabled={sendingTest || !testEmail.trim()}
                style={{
                  padding: '8px 14px',
                  borderRadius: '6px',
                  backgroundColor: '#ec4899',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: sendingTest || !testEmail.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {sendingTest ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                <span>Send Test</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PREVIEW TAB */}
      {editorTab === 'preview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {linkedFlowId && <p style={{ margin: 0, fontSize: '12px', color: '#d1d5db', lineHeight: 1.45 }}>{linkedLettersNote(linkedName)}</p>}
          {/* Step Selector for Preview */}
          <div role="group" aria-label="Letter to preview" style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
            {steps.map((step, idx) => (
              <button
                key={step.id}
                type="button"
                aria-pressed={activeStepIdx === idx}
                onClick={() => setActiveStepIdx(idx)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  border: '1px solid',
                  borderColor: activeStepIdx === idx ? '#ec4899' : 'rgba(255, 255, 255, 0.08)',
                  backgroundColor: activeStepIdx === idx ? 'rgba(236, 72, 153, 0.2)' : 'transparent',
                  color: activeStepIdx === idx ? '#FFFFFF' : '#94A3B8',
                  cursor: 'pointer'
                }}
              >
                Email #{idx + 1} ({step.delay})
              </button>
            ))}
          </div>

          {/* Email Inbox Shell */}
          <div
            style={{
              backgroundColor: '#0F172A',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '12px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#ec4899', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '13px', color: '#FFFFFF' }}>
                  J
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>
                    Your store
                  </div>
                  <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                    to: client@example.com
                  </div>
                </div>
              </div>
              <span style={{ fontSize: '11px', color: '#64748B', fontFamily: 'monospace' }}>
                {currentStep.delay}
              </span>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#FFFFFF', marginBottom: '4px' }}>
                {currentStep.subject
                  ? fillVoucherCode(currentStep.subject, data.voucherCode)
                  : <span style={{ color: '#94A3B8', fontStyle: 'italic', fontWeight: 400 }}>No subject line yet</span>}
              </div>
              {currentStep.previewText && (
                <div style={{ fontSize: '12px', color: '#94A3B8', fontStyle: 'italic' }}>
                  Preview: {fillVoucherCode(currentStep.previewText, data.voucherCode)}
                </div>
              )}
            </div>

            <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', color: '#E2E8F0', lineHeight: 1.6, padding: '12px', backgroundColor: 'rgba(0, 0, 0, 0.25)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              {currentStep.body?.trim()
                ? fillVoucherCode(currentStep.body, data.voucherCode)
                  .replace(/\[First Name\]/g, 'Sophia')
                  .replace(/\[Offer Link\]/g, 'https://yourstore.com/p/courtesy-ritual')
                  .replace(/\[Checkout Link\]/g, 'https://yourstore.com/checkout/c8f2a1')
                : <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No message written yet</span>}
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS TAB */}
      {editorTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Wave 7: a linked step's Flow Steps are its flow's emails, read only, edited in Email Studio. */}
          {linkedFlowId && (
            <section
              aria-labelledby={fid('linked-flow')}
              style={{ padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(0, 0, 0, 0.25)', border: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              <div id={fid('linked-flow')} style={{ fontSize: '13px', fontWeight: 700, color: '#f3f4f6', overflowWrap: 'anywhere' }}>
                Emails in {linkedName}
              </div>
              <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: '#CBD5E1' }}>Read only here. Edit these emails in Email Studio.</p>
              {flowsLoad === 'loading' && <p style={{ margin: 0, fontSize: '12px', color: '#d1d5db' }}>{'Loading this flow’s emails.'}</p>}
              {flowsLoad === 'failed' && <p style={{ margin: 0, fontSize: '12px', color: '#FCA5A5' }}>{LINKED_FLOW_UNREAD}</p>}
              {flowsLoad === 'loaded' && !linkedRow && <p style={{ margin: 0, fontSize: '12px', color: '#FCA5A5' }}>{LINKED_FLOW_MISSING}</p>}
              {linkedRow && linkedSummary && (
                <>
                  <p style={{ margin: 0, fontSize: '12px', color: '#d1d5db', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
                    {linkedRow.enabled
                      ? `${linkedRow.name} is on. People who join from a page on this map get these emails. This step’s own letters are kept, but nothing sends them.`
                      : `${linkedRow.name} is off, so nothing sends yet. Once it is on, people who join from a page on this map get these emails. This step’s own letters are kept, but nothing sends them.`}
                  </p>
                  {linkedSummary.lines.length > 0 ? (
                    <ol aria-labelledby={fid('linked-flow')} style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {linkedSummary.lines.map(line => (
                        <li key={line.label} style={{ padding: '8px 10px', borderRadius: '6px', backgroundColor: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#CBD5E1' }}>{line.label}, {line.wait}</div>
                          <div style={{ fontSize: '12px', color: '#F8FAFC', overflowWrap: 'anywhere' }}>{line.words}</div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p style={{ margin: 0, fontSize: '12px', color: '#d1d5db' }}>This flow has no emails yet.</p>
                  )}
                  {linkedSummary.branches && <p style={{ margin: 0, fontSize: '12px', color: '#d1d5db' }}>This flow has more than one path. Email Studio shows each one.</p>}
                </>
              )}
              {onOpenEmailStudio && (
                <button
                  type="button"
                  onClick={() => openStudio('summary')}
                  aria-disabled={openingEmailStudio || buildingFlow || undefined}
                  style={{
                    alignSelf: 'flex-start',
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: 'rgba(245, 158, 11, 0.16)',
                    border: '1px solid rgba(245, 158, 11, 0.45)',
                    color: '#FDE68A',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: openingEmailStudio ? 'wait' : 'pointer'
                  }}
                >
                  {openingEmailStudio ? 'Saving\u2026' : 'Edit in Email Studio'}
                </button>
              )}
              {onOpenEmailStudio && <p role="status" style={{ margin: 0, fontSize: '12px', color: '#FCA5A5' }}>{noticeAt === 'summary' ? studioNotice : ''}</p>}
            </section>
          )}

          {/* E-Commerce Flow Presets Grid: they write letters, so a linked step, whose letters nothing sends, does not offer them. */}
          {!linkedFlowId && (
          <div>
            <div id={fid('blueprints')} style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', marginBottom: '6px' }}>
              Pre-built Sequence Blueprints
            </div>
            <div role="group" aria-labelledby={fid('blueprints')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                onClick={() => loadEcommerceTemplate('upsell-recovery')}
                style={{
                  padding: '7px 10px',
                  borderRadius: '6px',
                  backgroundColor: data.sequenceType === 'upsell_recovery' ? 'rgba(245, 158, 11, 0.25)' : 'rgba(245, 158, 11, 0.1)',
                  border: `1px solid ${data.sequenceType === 'upsell_recovery' ? '#F59E0B' : 'rgba(245, 158, 11, 0.3)'}`,
                  color: '#FBBF24',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                ✦ 24h Courtesy Rescue
              </button>
              <button
                type="button"
                onClick={() => loadEcommerceTemplate('cart-recovery')}
                style={{
                  padding: '7px 10px',
                  borderRadius: '6px',
                  backgroundColor: data.sequenceType === 'checkout_recovery' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.1)',
                  border: `1px solid ${data.sequenceType === 'checkout_recovery' ? '#10B981' : 'rgba(16, 185, 129, 0.3)'}`,
                  color: '#34d399',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                ✦ Cart Recovery
              </button>
              <button
                type="button"
                onClick={() => loadEcommerceTemplate('vip-welcome')}
                style={{
                  padding: '7px 10px',
                  borderRadius: '6px',
                  backgroundColor: data.sequenceType === 'lead_nurture' && !data.isRetentionBranch ? 'rgba(236, 72, 153, 0.25)' : 'rgba(236, 72, 153, 0.1)',
                  border: `1px solid ${data.sequenceType === 'lead_nurture' && !data.isRetentionBranch ? '#ec4899' : 'rgba(236, 72, 153, 0.3)'}`,
                  color: '#f472b6',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                ✦ VIP Welcome Series
              </button>
              <button
                type="button"
                onClick={() => loadEcommerceTemplate('winback')}
                style={{
                  padding: '7px 10px',
                  borderRadius: '6px',
                  backgroundColor: data.sequenceType === 'at_risk_winback' ? 'rgba(139, 92, 246, 0.25)' : 'rgba(139, 92, 246, 0.1)',
                  border: `1px solid ${data.sequenceType === 'at_risk_winback' ? '#8B5CF6' : 'rgba(139, 92, 246, 0.3)'}`,
                  color: '#C4B5FD',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                ✦ VIP Winback Series
              </button>
              <button
                type="button"
                onClick={() => loadEcommerceTemplate('review-request')}
                style={{
                  padding: '7px 10px',
                  borderRadius: '6px',
                  backgroundColor: data.sequenceType === 'fulfillment_review' ? 'rgba(236, 72, 153, 0.25)' : 'rgba(236, 72, 153, 0.1)',
                  border: `1px solid ${data.sequenceType === 'fulfillment_review' ? '#ec4899' : 'rgba(236, 72, 153, 0.3)'}`,
                  color: '#f472b6',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  gridColumn: 'span 2'
                }}
              >
                ✦ 7-Day Review Request
              </button>
            </div>
          </div>
          )}

          {/* Retention & Recovery Controls Card */}
          <div
            style={{
              padding: '12px',
              borderRadius: '10px',
              backgroundColor: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#F8FAFC' }}>
                <Clock size={13} color="#FBBF24" />
                <span>Retention & Recovery Branch Settings</span>
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: '9999px',
                  background: 'rgba(245, 158, 11, 0.2)',
                  color: '#FBBF24'
                }}
              >
                Active Branch
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label htmlFor={fid('role')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '3px' }}>
                  Sequence Branch Role
                </label>
                <select
                  id={fid('role')}
                  value={data.sequenceType || 'lead_nurture'}
                  onChange={e => {
                    const nextType = e.target.value as SequenceNodeData['sequenceType'];
                    const isRet = nextType !== 'lead_nurture';
                    onChange({
                      ...data,
                      sequenceType: nextType,
                      isRetentionBranch: isRet,
                      delayHours: data.delayHours ?? (nextType === 'upsell_recovery' ? 18 : nextType === 'checkout_recovery' ? 1 : nextType === 'fulfillment_review' ? 168 : 24)
                    });
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    backgroundColor: '#0a0a0f',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: '11px',
                    outline: 'none'
                  }}
                >
                  <option value="lead_nurture">Standard Lead Nurture</option>
                  <option value="upsell_recovery">24h Courtesy Rescue (Decline)</option>
                  <option value="checkout_recovery">Cart Abandon Recovery</option>
                  <option value="at_risk_winback">VIP Winback Series</option>
                  <option value="fulfillment_review">7-Day Review Request (Fulfillment)</option>
                </select>
              </div>

              <div>
                <label htmlFor={fid('delay-hours')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '3px' }}>
                  Trigger Delay Hours
                </label>
                <input
                  id={fid('delay-hours')}
                  type="number"
                  min="0"
                  max="720"
                  value={data.delayHours ?? ''}
                  onChange={e => {
                    // Blank is 'Wait not set' on the map, not a wait of 0 or 18 hours.
                    const v = e.target.value;
                    onChange({ ...data, delayHours: v === '' ? undefined : Math.max(0, parseInt(v, 10) || 0) });
                  }}
                  placeholder="Not set"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    backgroundColor: '#0a0a0f',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: '11px',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', alignItems: 'center' }}>
              <div>
                <label htmlFor={fid('voucher')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '3px' }}>
                  Discount Voucher Code
                </label>
                <input
                  id={fid('voucher')}
                  type="text"
                  value={data.voucherCode || ''}
                  onChange={e => onChange({ ...data, voucherCode: e.target.value.toUpperCase() })}
                  placeholder="e.g. SAVE10"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    backgroundColor: '#0a0a0f',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#FBBF24',
                    fontWeight: 700,
                    fontSize: '11px',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ paddingTop: '14px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '11px', color: '#E2E8F0' }}>
                  <input
                    type="checkbox"
                    checked={data.smartExitOnPurchase !== false}
                    onChange={e => onChange({ ...data, smartExitOnPurchase: e.target.checked })}
                    style={{ accentColor: '#10B981', cursor: 'pointer' }}
                  />
                  <span>Smart Exit on Purchase</span>
                </label>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: '11px', color: '#94A3B8', lineHeight: 1.4 }}>
              Clients automatically exit this sequence the moment Shopify records an order.
            </p>
          </div>

          {/* Wave 7 fix round: what Build does with these letters, and what starts the flow it makes. */}
          {!linkedFlowId && onOpenEmailStudio && onBuildEmailFlow && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {stepLettersSource(flowStartForStep(data.sequenceType).label).map(line => (
                <p key={line} style={{ margin: 0, fontSize: '12px', color: '#d1d5db', lineHeight: 1.45 }}>{line}</p>
              ))}
            </div>
          )}

          {/* Sequence Steps Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0' }}>
              Sequence Letters ({steps.length})
            </span>
            <button
              type="button"
              onClick={addStep}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'transparent',
                border: 'none',
                color: '#ec4899',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <Plus size={12} /> Add Letter
            </button>
          </div>

          <div role="group" aria-label="Letters in this sequence" style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
            {steps.map((step, idx) => (
              <div
                key={step.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  backgroundColor: activeStepIdx === idx ? 'rgba(236, 72, 153, 0.2)' : 'rgba(0,0,0,0.3)',
                  border: `1px solid ${activeStepIdx === idx ? '#ec4899' : 'rgba(255,255,255,0.08)'}`
                }}
              >
                <button
                  type="button"
                  aria-label={`Letter ${idx + 1}`}
                  aria-pressed={activeStepIdx === idx}
                  onClick={() => setActiveStepIdx(idx)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: activeStepIdx === idx ? '#FFFFFF' : '#94A3B8',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  #{idx + 1}
                </button>
                {steps.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove letter ${idx + 1}`}
                    onClick={() => removeStep(idx)}
                    style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '0 2px' }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Current Step Editor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: 'rgba(0,0,0,0.2)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#ec4899' }}>
                Editing Email #{activeStepIdx + 1}
              </span>
              <button
                ref={polishButtonRef}
                type="button"
                onClick={generateStepCopy}
                disabled={loadingAI}
                aria-busy={loadingAI}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  backgroundColor: '#ec4899',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: loadingAI ? 'not-allowed' : 'pointer'
                }}
              >
                {loadingAI ? <RefreshCw size={11} className="animate-spin" aria-hidden="true" /> : <Sparkles size={11} aria-hidden="true" />}
                <span>AI Polish</span>
              </button>
            </div>
            <p
              role="status"
              style={{
                margin: aiNotice ? '-4px 0 0' : '-12px 0 0',
                fontSize: '12px',
                lineHeight: 1.45,
                color: aiNotice.endsWith('Nothing was changed.') ? '#FBBF24' : '#34D399',
                overflowWrap: 'anywhere'
              }}
            >
              {aiNotice}
            </p>

            {proposal && proposal.stepId === currentStep?.id && proposalRows.length > 0 && (
              <CopyProposalCard
                rows={proposalRows}
                heading={`Suggested copy for email #${activeStepIdx + 1}`}
                selected={selectedFields}
                onToggle={field => setSelectedFields(cur => cur.includes(field) ? cur.filter(f => f !== field) : [...cur, field])}
                onUse={applyProposal}
                onKeep={keepCopy}
                focusFirst={initialFocus(proposalRows)}
              />
            )}

            <div>
              <label htmlFor={fid('delay')} style={{ display: 'block', fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>
                Delivery Delay
              </label>
              <input
                id={fid('delay')}
                type="text"
                value={currentStep.delay}
                onChange={e => handleStepChange('delay', e.target.value)}
                placeholder="e.g. Instant, 24 Hours, 3 Days"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  backgroundColor: '#0a0a0f',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  fontSize: '12px',
                  outline: 'none'
                }}
              />
            </div>

            <div>
              <label htmlFor={fid('subject')} style={{ display: 'block', fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>
                Subject Line
              </label>
              <input
                id={fid('subject')}
                type="text"
                value={currentStep.subject || ''}
                onChange={e => handleStepChange('subject', e.target.value)}
                placeholder="What this email is about, in a few words"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  backgroundColor: '#0a0a0f',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  fontSize: '12px',
                  outline: 'none'
                }}
              />
            </div>

            {/* The inbox line under the subject. It had no field here, so the starter's draft could not be replaced (T10). */}
            {currentStep.channel !== 'sms' && (
              <div>
                <label htmlFor={fid('preview-text')} style={{ display: 'block', fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>
                  Preview Text
                </label>
                <input
                  id={fid('preview-text')}
                  type="text"
                  value={currentStep.previewText || ''}
                  onChange={e => handleStepChange('previewText', e.target.value)}
                  placeholder="The line an inbox shows after the subject"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    backgroundColor: '#0a0a0f',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                />
              </div>
            )}

            <div>
              <label htmlFor={fid('body')} style={{ display: 'block', fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>
                Letter Body (Supports [First Name], [Checkout Link])
              </label>
              <textarea
                id={fid('body')}
                rows={6}
                value={currentStep.body || ''}
                onChange={e => handleStepChange('body', e.target.value)}
                placeholder="Hi [First Name], then the one next step you want this person to take"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px',
                  borderRadius: '6px',
                  backgroundColor: '#0a0a0f',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  outline: 'none',
                  resize: 'vertical'
                }}
              />
              {/* Merge Tag Helpers */}
              <div role="group" aria-labelledby={fid('tags')} style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
                <span id={fid('tags')} style={{ fontSize: '11px', color: '#64748B' }}>Insert Tag:</span>
                {[
                  ['First Name', '[First Name]'],
                  ['Voucher Code', '[Voucher Code]'],
                  ['Offer Link', '[Offer Link]'],
                  ['Checkout Link', '[Checkout Link]']
                ].map(([lbl, tag]) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleStepChange('body', `${currentStep.body}${currentStep.body ? ' ' : ''}${tag}`)}
                    style={{
                      padding: '2px 7px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#E2E8F0',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    title={`Insert ${tag} into message body`}
                  >
                    +{lbl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
