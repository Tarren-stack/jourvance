import React, { useState } from 'react';
import { Sparkles, Gift, CheckCircle2, Copy, ExternalLink, Plus, Trash2, ArrowRight } from 'lucide-react';
import type { ThankYouNodeData, Workspace } from '../../types/journey';

interface Props {
  data: ThankYouNodeData;
  onChange: (updated: ThankYouNodeData) => void;
  workspace?: Workspace | null;
}

export const ThankYouEditor: React.FC<Props> = ({ data, onChange, workspace }) => {
  const [editorTab, setEditorTab] = useState<'settings' | 'preview'>('settings');
  const [copied, setCopied] = useState(false);

  const handleFieldChange = (field: keyof ThankYouNodeData, val: any) => {
    onChange({ ...data, [field]: val });
  };

  const steps = Array.isArray(data.usageGuideSteps) ? data.usageGuideSteps : [];

  const handleStepChange = (index: number, val: string) => {
    const updated = [...steps];
    updated[index] = val;
    handleFieldChange('usageGuideSteps', updated);
  };

  const handleAddStep = () => {
    handleFieldChange('usageGuideSteps', [...steps, '']);
  };

  const handleRemoveStep = (index: number) => {
    const updated = steps.filter((_, i) => i !== index);
    handleFieldChange('usageGuideSteps', updated);
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
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: editorTab === 'settings' ? '#EC4899' : 'transparent',
            color: editorTab === 'settings' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          VIP Portal Settings
        </button>
        <button
          type="button"
          onClick={() => setEditorTab('preview')}
          style={{
            flex: 1,
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: editorTab === 'preview' ? '#EC4899' : 'transparent',
            color: editorTab === 'preview' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Live Customer View
        </button>
      </div>

      {editorTab === 'settings' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* SECTION 1: VIP Header & Confirmation Copy */}
          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#F472B6', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              1. VIP Confirmation Banner
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>VIP Badge Text</label>
                <input
                  type="text"
                  value={data.badgeText || 'VIP Member Privilege'}
                  onChange={e => handleFieldChange('badgeText', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Headline</label>
                <input
                  type="text"
                  value={data.headline || 'Your VIP Allocation & Order is Confirmed'}
                  onChange={e => handleFieldChange('headline', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Subhead Description</label>
                <textarea
                  rows={2}
                  value={data.subhead || 'Thank you for choosing our bioactive formulation ritual. Your parcel is currently being prepared with care.'}
                  onChange={e => handleFieldChange('subhead', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: Next-Order Bounce-Back Voucher */}
          <div style={{ backgroundColor: 'rgba(236, 72, 153, 0.04)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(236, 72, 153, 0.2)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#F472B6', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Gift size={13} /> 2. Next-Order Bounce-Back Voucher
            </div>
            <p style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '10px', lineHeight: '1.4' }}>
              Incentivize an immediate second purchase or subscription replenishment before they leave.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Discount Code</label>
                <input
                  type="text"
                  value={data.bounceBackDiscountCode || 'VIPRETURN'}
                  onChange={e => handleFieldChange('bounceBackDiscountCode', e.target.value.toUpperCase())}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px', fontFamily: 'monospace' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Perk Description</label>
                <input
                  type="text"
                  value={data.bounceBackDiscountText || '$15 Off Next Order'}
                  onChange={e => handleFieldChange('bounceBackDiscountText', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
            </div>
          </div>

          {/* SECTION 3: 3-Step Beauty Ritual Guide */}
          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#F472B6', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                3. Product Ritual / Usage Guide
              </div>
              <button
                type="button"
                onClick={handleAddStep}
                style={{ background: 'none', border: 'none', color: '#F472B6', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
              >
                <Plus size={12} /> Add Step
              </button>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Section Title</label>
              <input
                type="text"
                value={data.usageGuideTitle || 'The 3-Step Botanical Ritual Guide'}
                onChange={e => handleFieldChange('usageGuideTitle', e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px', marginBottom: '10px' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {steps.map((st, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ width: '22px', height: '22px', borderRadius: '6px', background: 'rgba(236, 72, 153, 0.2)', color: '#F472B6', fontSize: '11px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={st}
                    onChange={e => handleStepChange(i, e.target.value)}
                    style={{ flex: 1, boxSizing: 'border-box', padding: '6px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '11px' }}
                  />
                  {steps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveStep(i)}
                      style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', padding: '4px' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* SECTION 4: Store & Community Links */}
          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#F472B6', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              4. Return & Community Actions
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Shopify Store Return Button Text</label>
                <input
                  type="text"
                  value={data.storeReturnText || 'Browse Complimentary Formulations'}
                  onChange={e => handleFieldChange('storeReturnText', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>VIP Community Invite Text</label>
                <input
                  type="text"
                  value={data.communityInviteText || 'Join The Private VIP Beauty Circle'}
                  onChange={e => handleFieldChange('communityInviteText', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* LIVE INTERACTIVE PREVIEW TAB */
        <div style={{ backgroundColor: '#0B0F19', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.12)', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', padding: '6px 0' }}>
            <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)', border: '1.5px solid #10B981', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#10B981', fontSize: '24px', marginBottom: '12px' }}>
              ✓
            </div>
            <div style={{ display: 'inline-block', background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.3)', color: '#F472B6', padding: '3px 10px', borderRadius: '9999px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>
              ✨ {data.badgeText || 'VIP Member Privilege'}
            </div>
            <h4 style={{ fontSize: '18px', fontWeight: 800, color: '#FFFFFF', margin: '0 0 6px' }}>
              {data.headline || 'Your VIP Allocation & Order is Confirmed'}
            </h4>
            <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0, lineHeight: '1.4' }}>
              {data.subhead || 'Thank you for choosing our bioactive formulation ritual. Your parcel is currently being prepared with care.'}
            </p>
          </div>

          {/* Voucher */}
          <div style={{ border: '1px dashed rgba(236, 72, 153, 0.4)', background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.1), rgba(15, 23, 42, 0.6))', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#F472B6', textTransform: 'uppercase' }}>Exclusive VIP Bounce-Back Perk</div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF', margin: '3px 0 10px' }}>
              {data.bounceBackDiscountText || '$15 Off Your Next Renewal Formulation'}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(0, 0, 0, 0.5)', padding: '6px 14px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.15)' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '16px', fontWeight: 800, color: '#FFFFFF' }}>
                {data.bounceBackDiscountCode || 'VIPRETURN'}
              </span>
              <button
                type="button"
                onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                style={{ background: 'rgba(236, 72, 153, 0.25)', border: '1px solid rgba(236, 72, 153, 0.5)', color: '#F472B6', fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', cursor: 'pointer' }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Ritual Steps */}
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', padding: '14px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#FFFFFF', marginBottom: '10px' }}>
              ✦ {data.usageGuideTitle || 'The 3-Step Botanical Ritual Guide'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {steps.map((st, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ width: '20px', height: '20px', borderRadius: '6px', background: 'rgba(236, 72, 153, 0.15)', color: '#F472B6', fontSize: '10px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <span style={{ fontSize: '11px', color: '#CBD5E1', lineHeight: '1.4' }}>{st}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              type="button"
              style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #EC4899, #DB2777)', color: '#FFFFFF', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              {data.storeReturnText || 'Browse Complimentary Formulations'} →
            </button>
            <button
              type="button"
              style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.15)', background: 'transparent', color: '#94A3B8', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
            >
              {data.communityInviteText || 'Join The Private VIP Beauty Circle'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
