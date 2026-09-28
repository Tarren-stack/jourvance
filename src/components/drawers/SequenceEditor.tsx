import React, { useEffect, useState } from 'react';
import {
  Sparkles, RefreshCw, Plus, Trash2, Clock, Mail, MessageSquare,
  Copy, Check, Send, ShoppingBag, ExternalLink, CheckCircle2
} from 'lucide-react';
import type { SequenceNodeData, SequenceStep, Workspace } from '../../types/journey';
import { requestAICopy } from '../../lib/hubClient';
import { authHeaders } from '../../lib/firebase';

interface Props {
  data: SequenceNodeData;
  onChange: (updated: SequenceNodeData) => void;
  offerHeadline: string;
  businessType: string;
  workspace?: Workspace | null;
  journeyId?: string;
  nodeId?: string;
}

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
  nodeId
}) => {
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [loadingAI, setLoadingAI] = useState(false);
  const [editorTab, setEditorTab] = useState<'settings' | 'preview' | 'export'>('settings');

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
  const [jourvanceFlows, setJourvanceFlows] = useState<{ id: string; name: string; enabled: boolean }[]>([]);

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
        const map = await fetch('/api/email/flow-map', { headers: await authHeaders() });
        const flows = await map.json().catch(() => ({}));
        if (!cancelled) {
          const rows = Array.isArray(flows?.flows) ? flows.flows : [];
          setJourvanceFlows(rows.filter((flow: { kind?: string }) => flow.kind === 'flow').map((flow: { id: string; name: string; enabled: boolean }) => ({
            id: flow.id, name: flow.name, enabled: flow.enabled === true
          })));
        }
      } catch { /* the picker stays empty */ }
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

  const handleStepChange = (field: keyof SequenceStep, val: any) => {
    const updated = [...steps];
    updated[activeStepIdx] = { ...updated[activeStepIdx], [field]: val };
    onChange({ ...data, steps: updated });
  };

  const addStep = () => {
    const newStep: SequenceStep = {
      id: `step-${Date.now()}`,
      channel: 'email',
      delay: '48 Hours',
      subject: 'Follow-up regarding your order & routine',
      previewText: 'Checking in with you...',
      body: `Hi [First Name],\n\nWanted to quickly follow up to see if you had any questions regarding ${offerHeadline}.\n\nBest,\nThe Team`
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

  const loadEcommerceTemplate = (type: 'vip-welcome' | 'cart-recovery' | 'upsell-recovery' | 'winback' | 'review-request') => {
    if (type === 'review-request') {
      const reviewSteps: SequenceStep[] = [
        {
          id: `step-${Date.now()}-1`,
          channel: 'email',
          delay: '7 Days (168h)',
          subject: 'How is your new ritual feeling? (A $10 treat inside)',
          previewText: 'We would love your thoughts on your recent order',
          body: `Hi [First Name],\n\nIt has been a week since your order arrived, and we hope your new ritual is already treating you wonderfully.\n\nCould you take 60 seconds to share your honest thoughts? As a thank you for helping fellow beauty lovers, we will instantly gift you $10 toward your next restock.\n\nLeave your review & claim your $10 treat:\n[Review Link]\n\nWith gratitude,\nCustomer Care`
        },
        {
          id: `step-${Date.now()}-2`,
          channel: 'email',
          delay: '3 Days (72h)',
          subject: 'Quick reminder: Your $10 beauty treat is waiting',
          previewText: 'A fast 60 seconds to claim your courtesy voucher',
          body: `Hi [First Name],\n\nJust a gentle reminder that your private $10 courtesy gift is still waiting for you.\n\nWhenever you have a quiet moment, let us know how your formulas are working for your skin:\n\nShare your review & get $10:\n[Review Link]\n\nWarmly,\nCustomer Care`
        }
      ];
      onChange({
        ...data,
        sequenceTitle: 'Post-Purchase Review & Social Proof Engine',
        sequenceType: 'fulfillment_review',
        isRetentionBranch: true,
        delayHours: 168,
        voucherCode: data.voucherCode || 'REVIEW10',
        smartExitOnPurchase: false,
        steps: reviewSteps
      });
      setActiveStepIdx(0);
    } else if (type === 'upsell-recovery') {
      const rescueSteps: SequenceStep[] = [
        {
          id: `step-${Date.now()}-1`,
          channel: 'email',
          delay: '18 Hours',
          subject: 'A private courtesy reservation for your recent order',
          previewText: 'We held a private reservation on your companion formula',
          body: `Hi [First Name],\n\nThank you again for your recent order! When preparing your allocation, our clinical team noticed you passed on the companion formula.\n\nBecause pairing the ritual together accelerates visible results, we held a private 24-hour courtesy reservation for your account with an extra 10% privilege.\n\nUse code [Voucher Code] at checkout:\n[Offer Link]\n\nWarmly,\nThe Concierge Team`
        },
        {
          id: `step-${Date.now()}-2`,
          channel: 'email',
          delay: '36 Hours',
          subject: 'Final reminder: Your courtesy reservation releases tonight',
          previewText: 'Your reserved 10% privilege code is expiring',
          body: `Hi [First Name],\n\nJust a gentle reminder that your private reservation and courtesy code [Voucher Code] expire tonight at midnight.\n\nIf you would like to complete your daily ritual with your reserved allocation, you can finalize it here:\n[Offer Link]\n\nWarmly,\nCustomer Concierge`
        }
      ];
      onChange({
        ...data,
        sequenceTitle: '24h Courtesy Rescue (Upsell Decline)',
        sequenceType: 'upsell_recovery',
        isRetentionBranch: true,
        delayHours: 18,
        voucherCode: data.voucherCode || 'SAVE10',
        smartExitOnPurchase: true,
        steps: rescueSteps
      });
      setActiveStepIdx(0);
    } else if (type === 'winback') {
      const winbackSteps: SequenceStep[] = [
        {
          id: `step-${Date.now()}-1`,
          channel: 'email',
          delay: '72 Hours',
          subject: 'We miss you — a special VIP invitation inside',
          previewText: 'A personalized replenishment privilege for your routine',
          body: `Hi [First Name],\n\nIt has been a little while since your last replenishment ritual, and we wanted to make sure your results are continuing smoothly.\n\nTo welcome you back, we added an exclusive 15% VIP credit to your account with code [Voucher Code].\n\nExplore your replenishment:\n[Offer Link]\n\nWarmly,\nThe Care Team`
        }
      ];
      onChange({
        ...data,
        sequenceTitle: 'VIP Winback & Re-Engagement',
        sequenceType: 'at_risk_winback',
        isRetentionBranch: true,
        delayHours: 72,
        voucherCode: data.voucherCode || 'WELCOMEBACK15',
        smartExitOnPurchase: true,
        steps: winbackSteps
      });
      setActiveStepIdx(0);
    } else if (type === 'vip-welcome') {
      const vipSteps: SequenceStep[] = [
        {
          id: `step-${Date.now()}-1`,
          channel: 'email',
          delay: 'Instant (0m)',
          subject: 'Welcome to our inner circle',
          previewText: 'Your welcome privilege and ritual guide',
          body: `Hi [First Name],\n\nWelcome to our community. We are delighted to have you with us.\n\nBest,\nThe Team`
        },
        {
          id: `step-${Date.now()}-2`,
          channel: 'email',
          delay: '24 Hours',
          subject: 'A guide to ' + offerHeadline,
          previewText: 'How to maximize your everyday results',
          body: `Hi [First Name],\n\nHere are the top three principles to keep in mind when starting your ritual with ${offerHeadline}.\n\nWarmly,\nThe Team`
        },
        {
          id: `step-${Date.now()}-3`,
          channel: 'email',
          delay: '48 Hours',
          subject: 'Still deciding on your selection?',
          previewText: 'Our concierge is here to help with any questions',
          body: `Hi [First Name],\n\nIf you have any questions about choosing the right formula or routine, reply directly to this email.\n\nWarmly,\nThe Team`
        }
      ];
      onChange({
        ...data,
        sequenceTitle: 'VIP Welcome Sequence',
        sequenceType: 'lead_nurture',
        isRetentionBranch: false,
        steps: vipSteps
      });
      setActiveStepIdx(0);
    } else {
      const abandonSteps: SequenceStep[] = [
        {
          id: `step-${Date.now()}-1`,
          channel: 'email',
          delay: '1 Hour',
          subject: 'Your selections are waiting for you',
          previewText: 'We held your cart so you do not lose your items',
          body: `Hi [First Name],\n\nWe noticed you started your checkout but did not get to finish. Your items are temporarily held for you.\n\nYou can return directly to your cart here:\n[Checkout Link]\n\nWarmly,\nThe Team`
        },
        {
          id: `step-${Date.now()}-2`,
          channel: 'email',
          delay: '24 Hours',
          subject: 'A courtesy gift to complete your routine',
          previewText: 'Enjoy a courtesy discount on your reserved cart',
          body: `Hi [First Name],\n\nWe would love to help you get started. Enjoy courtesy code [Voucher Code] for extra savings on your order:\n\nReturn to checkout:\n[Checkout Link]\n\nBest,\nThe Team`
        }
      ];
      onChange({
        ...data,
        sequenceTitle: 'Abandoned Checkout Recovery',
        sequenceType: 'checkout_recovery',
        isRetentionBranch: true,
        delayHours: 1,
        voucherCode: data.voucherCode || 'COMPLETE10',
        smartExitOnPurchase: true,
        steps: abandonSteps
      });
      setActiveStepIdx(0);
    }
  };

  const generateStepCopy = async () => {
    setLoadingAI(true);
    try {
      const copy = await requestAICopy({
        nodeType: 'email',
        businessType: businessType || 'E-Commerce Store',
        offerHeadline: currentStep?.subject || offerHeadline,
        goal: `E-commerce customer journey email step for lead after ${currentStep?.delay || 'initial contact'}`
      });
      if (copy) {
        handleStepChange('subject', copy.subject || currentStep.subject);
        handleStepChange('previewText', copy.preview || currentStep.previewText);
        handleStepChange('body', copy.body || currentStep.body);
      }
    } finally {
      setLoadingAI(false);
    }
  };

  const copyForKlaviyo = () => {
    const vCode = data.voucherCode || 'SAVE10';
    const text = steps
      .map(
        (s, i) =>
          `EMAIL #${i + 1} (${s.delay})\nSubject: ${s.subject.replace(/\[Voucher Code\]/g, vCode)}\nPreview: ${(s.previewText || '').replace(/\[Voucher Code\]/g, vCode)}\n\n${s.body
            .replace(/\[First Name\]/g, "{{ first_name|default:'there' }}")
            .replace(/\[Voucher Code\]/g, vCode)
            .replace(/\[Offer Link\]/g, '{{ event.extra.offer_url|default:shop.url }}')
            .replace(/\[Checkout Link\]/g, '{{ event.checkout_url }}')}\n-----------------------------------\n`
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopiedKlaviyo(true);
    setTimeout(() => setCopiedKlaviyo(false), 2200);
  };

  const copyForShopify = () => {
    const vCode = data.voucherCode || 'SAVE10';
    const html = steps
      .map(
        (s, i) =>
          `<!-- EMAIL #${i + 1} (${s.delay}) -->\n<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">\n  <h2>${s.subject.replace(/\[Voucher Code\]/g, vCode)}</h2>\n  <p>${s.body
            .replace(/\n/g, '<br/>')
            .replace(/\[First Name\]/g, '{{ customer.first_name }}')
            .replace(/\[Voucher Code\]/g, vCode)
            .replace(/\[Offer Link\]/g, '<a href="{{ offer_url }}">Claim Courtesy Reservation</a>')
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
            ? 'Klaviyo is the sender, so the handoff below runs. This flow link stays saved until you choose Jourvance on the Klaviyo tab.'
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
        {jourvanceFlows.length === 0 && <p style={{ margin: 0, fontSize: '12px', color: '#d1d5db' }}>Build a flow in Email Studio. This node waits until one is chosen.</p>}
      </div>
      <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.28)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#f3f4f6' }}>Hand this email to Klaviyo</div>
        <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af', lineHeight: 1.45 }}>
          {klaviyoConnected
            ? (klaviyoSendWith === 'klaviyo'
              ? 'Klaviyo is the sender. When someone reaches this node, Jourvance adds them to that flow’s list or sends the event that starts it. It does not subscribe them, and it does not turn the flow on.'
              : 'Jourvance is the sender. This link is saved and waits until you choose Klaviyo on the Klaviyo tab.')
            : 'Connect Klaviyo on the Klaviyo tab, then choose the flow this node should start.'}
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
      {/* Tab Switcher */}
      <div
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
          {/* Step Selector for Preview */}
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
            {steps.map((step, idx) => (
              <button
                key={step.id}
                type="button"
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
              <span style={{ fontSize: '10px', color: '#64748B', fontFamily: 'monospace' }}>
                {currentStep.delay}
              </span>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#FFFFFF', marginBottom: '4px' }}>
                {currentStep.subject.replace(/\[Voucher Code\]/g, data.voucherCode || 'SAVE10')}
              </div>
              {currentStep.previewText && (
                <div style={{ fontSize: '12px', color: '#94A3B8', fontStyle: 'italic' }}>
                  Preview: {currentStep.previewText.replace(/\[Voucher Code\]/g, data.voucherCode || 'SAVE10')}
                </div>
              )}
            </div>

            <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', color: '#E2E8F0', lineHeight: 1.6, padding: '12px', backgroundColor: 'rgba(0, 0, 0, 0.25)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              {currentStep.body
                .replace(/\[First Name\]/g, 'Sophia')
                .replace(/\[Voucher Code\]/g, data.voucherCode || 'SAVE10')
                .replace(/\[Offer Link\]/g, 'https://yourstore.com/p/courtesy-ritual')
                .replace(/\[Checkout Link\]/g, 'https://yourstore.com/checkout/c8f2a1')}
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS TAB */}
      {editorTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* E-Commerce Flow Presets Grid */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', marginBottom: '6px' }}>
              Pre-built Sequence Blueprints
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
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
                ✦ 7-Day Review & VIP Reward ($10 Gift)
              </button>
            </div>
          </div>

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
                  fontSize: '9px',
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
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8', marginBottom: '3px' }}>
                  Sequence Branch Role
                </label>
                <select
                  value={data.sequenceType || 'lead_nurture'}
                  onChange={e => {
                    const nextType = e.target.value as SequenceNodeData['sequenceType'];
                    const isRet = nextType !== 'lead_nurture';
                    onChange({
                      ...data,
                      sequenceType: nextType,
                      isRetentionBranch: isRet,
                      delayHours: data.delayHours || (nextType === 'upsell_recovery' ? 18 : nextType === 'checkout_recovery' ? 1 : nextType === 'fulfillment_review' ? 168 : 24)
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
                  <option value="fulfillment_review">7-Day Review & VIP Reward (Fulfillment)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8', marginBottom: '3px' }}>
                  Trigger Delay Hours
                </label>
                <input
                  type="number"
                  min="0"
                  max="720"
                  value={data.delayHours ?? 18}
                  onChange={e => onChange({ ...data, delayHours: parseInt(e.target.value, 10) || 0 })}
                  placeholder="e.g. 18"
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
                <label style={{ display: 'block', fontSize: '10px', color: '#94A3B8', marginBottom: '3px' }}>
                  Discount Voucher Code
                </label>
                <input
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
            <p style={{ margin: 0, fontSize: '10px', color: '#94A3B8', lineHeight: 1.4 }}>
              Clients automatically exit this sequence the moment Shopify records an order.
            </p>
          </div>

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

          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
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
                type="button"
                onClick={generateStepCopy}
                disabled={loadingAI}
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
                {loadingAI ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                <span>AI Polish</span>
              </button>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>
                Delivery Delay
              </label>
              <input
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
              <label style={{ display: 'block', fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>
                Subject Line
              </label>
              <input
                type="text"
                value={currentStep.subject}
                onChange={e => handleStepChange('subject', e.target.value)}
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
              <label style={{ display: 'block', fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>
                Letter Body (Supports [First Name], [Checkout Link])
              </label>
              <textarea
                rows={6}
                value={currentStep.body}
                onChange={e => handleStepChange('body', e.target.value)}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
                <span style={{ fontSize: '10px', color: '#64748B' }}>Insert Tag:</span>
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
                      fontSize: '10px',
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
