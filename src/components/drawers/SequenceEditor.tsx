import React, { useState } from 'react';
import { Sparkles, RefreshCw, Plus, Trash2, Clock, Mail, MessageSquare } from 'lucide-react';
import type { SequenceNodeData, SequenceStep } from '../../types/journey';
import { requestAICopy } from '../../lib/hubClient';

interface Props {
  data: SequenceNodeData;
  onChange: (updated: SequenceNodeData) => void;
  offerHeadline: string;
  businessType: string;
}

export const SequenceEditor: React.FC<Props> = ({ data, onChange, offerHeadline, businessType }) => {
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [loadingAI, setLoadingAI] = useState(false);

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
      subject: 'Follow-up regarding your consultation',
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

  const generateStepCopy = async () => {
    setLoadingAI(true);
    try {
      const copy = await requestAICopy({
        nodeType: 'email',
        businessType,
        offerHeadline: currentStep?.subject || offerHeadline,
        goal: `Follow up letter for lead after ${currentStep?.delay || 'initial contact'}`
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Sequence Header */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Sequence Flow Title
        </label>
        <input
          type="text"
          value={data.sequenceTitle}
          onChange={e => onChange({ ...data, sequenceTitle: e.target.value })}
          placeholder="e.g. New Client Nurture Flow"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#FFFFFF',
            fontSize: '13px',
            outline: 'none'
          }}
        />
      </div>

      {/* Step Tabs */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0' }}>
            Follow-Up Timeline Steps ({steps.length})
          </label>
          <button
            type="button"
            onClick={addStep}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: '#818CF8', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
          >
            <Plus size={12} /> Add Step
          </button>
        </div>
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
          {steps.map((s, idx) => (
            <button
              key={s.id || idx}
              type="button"
              onClick={() => setActiveStepIdx(idx)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 12px',
                borderRadius: '8px',
                background: activeStepIdx === idx ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                border: activeStepIdx === idx ? '1.5px solid #6366F1' : '1px solid rgba(255, 255, 255, 0.08)',
                color: activeStepIdx === idx ? '#FFFFFF' : '#94A3B8',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              <Mail size={12} color={activeStepIdx === idx ? '#818CF8' : '#64748B'} />
              <span>Letter #{idx + 1}</span>
            </button>
          ))}
        </div>
      </div>

      {currentStep && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px', borderRadius: '10px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
          {/* Timing & Channel */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8' }}>Delivery Delay:</div>
              <select
                value={currentStep.delay}
                onChange={e => handleStepChange('delay', e.target.value)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  background: '#0F172A',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#FBBF24',
                  fontSize: '12px',
                  fontWeight: 600,
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="Instant (0m)">Instant (0m)</option>
                <option value="2 Hours">2 Hours</option>
                <option value="24 Hours">24 Hours</option>
                <option value="48 Hours">48 Hours</option>
                <option value="72 Hours">72 Hours</option>
                <option value="7 Days">7 Days</option>
              </select>
            </div>
            {steps.length > 1 && (
              <button
                type="button"
                onClick={() => removeStep(activeStepIdx)}
                style={{ background: 'transparent', border: 'none', color: '#EF4444', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
              >
                <Trash2 size={13} /> Remove
              </button>
            )}
          </div>

          {/* AI Helper for this Step */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={generateStepCopy}
              disabled={loadingAI}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                background: 'rgba(99, 102, 241, 0.2)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                color: '#A5B4FC',
                fontSize: '11px',
                fontWeight: 600,
                cursor: loadingAI ? 'not-allowed' : 'pointer'
              }}
            >
              {loadingAI ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {loadingAI ? 'Drafting…' : 'AI Draft Letter'}
            </button>
          </div>

          {/* Subject Line */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
              Subject Line
            </label>
            <input
              type="text"
              value={currentStep.subject}
              onChange={e => handleStepChange('subject', e.target.value)}
              placeholder="e.g. Your VIP Consultation Pass is confirmed"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#FFFFFF',
                fontSize: '13px',
                outline: 'none'
              }}
            />
          </div>

          {/* Email Body */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0' }}>
                Letter Body (Personalized)
              </label>
              <span style={{ fontSize: '10px', color: '#64748B', fontFamily: 'monospace' }}>
                Tags: [First Name], [Phone]
              </span>
            </div>
            <textarea
              rows={8}
              value={currentStep.body}
              onChange={e => handleStepChange('body', e.target.value)}
              placeholder="Hi [First Name], thank you for reaching out..."
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#FFFFFF',
                fontSize: '13px',
                lineHeight: '1.6',
                fontFamily: 'inherit',
                outline: 'none',
                resize: 'vertical'
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
