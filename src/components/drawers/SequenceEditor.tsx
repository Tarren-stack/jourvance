import React, { useState } from 'react';
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
}

export const SequenceEditor: React.FC<Props> = ({
  data,
  onChange,
  offerHeadline,
  businessType,
  workspace
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

  const loadEcommerceTemplate = (type: 'vip-welcome' | 'cart-recovery') => {
    if (type === 'vip-welcome') {
      const vipSteps: SequenceStep[] = [
        {
          id: `step-${Date.now()}-1`,
          channel: 'email',
          delay: 'Instant (0m)',
          subject: 'Your 15% VIP code is inside 🎁',
          previewText: 'Welcome to the inner circle',
          body: `Hi [First Name],\n\nWelcome to our community! Here is your exclusive 15% discount code: VIP15.\n\nClaim your order with code auto-applied: [Checkout Link]\n\nBest,\nThe Team`
        },
        {
          id: `step-${Date.now()}-2`,
          channel: 'email',
          delay: '24 Hours',
          subject: 'How to get the best results with your routine',
          previewText: '3 simple tips from our founder',
          body: `Hi [First Name],\n\nQuick tip: to get the most radiant results from ${offerHeadline}, make sure to apply on slightly damp skin morning and night.\n\nNeed to stock up? Your VIP15 code is still active!\n\nBest,\nThe Team`
        },
        {
          id: `step-${Date.now()}-3`,
          channel: 'email',
          delay: '48 Hours',
          subject: 'Last chance: your 15% VIP discount expires tonight ⏳',
          previewText: 'Don’t leave your savings behind',
          body: `Hi [First Name],\n\nJust a quick heads-up: your VIP15 coupon expires at midnight.\n\nFinish your order now: [Checkout Link]\n\nWarmly,\nThe Team`
        }
      ];
      onChange({ ...data, sequenceTitle: 'VIP Welcome & 15% Drip', steps: vipSteps });
      setActiveStepIdx(0);
    } else {
      const abandonSteps: SequenceStep[] = [
        {
          id: `step-${Date.now()}-1`,
          channel: 'email',
          delay: '2 Hours',
          subject: 'Did you leave something behind in your bag?',
          previewText: 'Your cart is saved for 24 hours',
          body: `Hi [First Name],\n\nWe noticed you didn't finish checking out for ${offerHeadline}. We saved your cart so you can pick right back up!\n\nComplete order: [Checkout Link]\n\nBest,\nThe Team`
        },
        {
          id: `step-${Date.now()}-2`,
          channel: 'email',
          delay: '24 Hours',
          subject: 'Can we answer any questions about your order?',
          previewText: 'Reply directly to our team',
          body: `Hi [First Name],\n\nIf you have any questions about shade matching, ingredients, or shipping, reply directly to this email.\n\nBest,\nThe Team`
        }
      ];
      onChange({ ...data, sequenceTitle: 'Abandoned Checkout Recovery', steps: abandonSteps });
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
    const text = steps
      .map(
        (s, i) =>
          `EMAIL #${i + 1} (${s.delay})\nSubject: ${s.subject}\nPreview: ${s.previewText || ''}\n\n${s.body
            .replace(/\[First Name\]/g, "{{ first_name|default:'there' }}")
            .replace(/\[Checkout Link\]/g, '{{ event.checkout_url }}')}\n-----------------------------------\n`
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopiedKlaviyo(true);
    setTimeout(() => setCopiedKlaviyo(false), 2200);
  };

  const copyForShopify = () => {
    const html = steps
      .map(
        (s, i) =>
          `<!-- EMAIL #${i + 1} (${s.delay}) -->\n<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">\n  <h2>${s.subject}</h2>\n  <p>${s.body
            .replace(/\n/g, '<br/>')
            .replace(/\[First Name\]/g, '{{ customer.first_name }}')
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                    Jourvance VIP Concierge
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
                {currentStep.subject}
              </div>
              {currentStep.previewText && (
                <div style={{ fontSize: '12px', color: '#94A3B8', fontStyle: 'italic' }}>
                  Preview: {currentStep.previewText}
                </div>
              )}
            </div>

            <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', color: '#E2E8F0', lineHeight: 1.6, padding: '12px', backgroundColor: 'rgba(0, 0, 0, 0.25)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              {currentStep.body}
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS TAB */}
      {editorTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* E-Commerce Flow Presets */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => loadEcommerceTemplate('vip-welcome')}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '6px',
                backgroundColor: 'rgba(236, 72, 153, 0.1)',
                border: '1px solid rgba(236, 72, 153, 0.3)',
                color: '#f472b6',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Load VIP 15% Welcome Drip
            </button>
            <button
              type="button"
              onClick={() => loadEcommerceTemplate('cart-recovery')}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '6px',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#34d399',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Load Cart Recovery Flow
            </button>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
