import React, { useState } from 'react';
import { Sparkles, RefreshCw, Megaphone, ExternalLink } from 'lucide-react';
import type { AdNodeData } from '../../types/journey';
import { requestAICopy } from '../../lib/hubClient';

interface Props {
  data: AdNodeData;
  onChange: (updated: AdNodeData) => void;
  offerHeadline: string;
  businessType: string;
}

export const AdEditor: React.FC<Props> = ({ data, onChange, offerHeadline, businessType }) => {
  const [loadingAI, setLoadingAI] = useState(false);

  const handleFieldChange = (field: keyof AdNodeData, val: any) => {
    onChange({ ...data, [field]: val });
  };

  const generateAICopy = async () => {
    setLoadingAI(true);
    try {
      const copy = await requestAICopy({
        nodeType: 'ad',
        businessType,
        offerHeadline: data.headline || offerHeadline,
        goal: 'Generate qualified inbound client leads'
      });
      if (copy) {
        onChange({
          ...data,
          headline: copy.headline || data.headline,
          body: copy.body || data.body,
          ctaText: copy.cta || data.ctaText
        });
      }
    } finally {
      setLoadingAI(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* AI Header Card */}
      <div
        style={{
          padding: '14px',
          borderRadius: '10px',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(59, 130, 246, 0.05))',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles size={14} color="#818CF8" /> Hub Brain Copy Assistant
          </div>
          <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>
            Draft high-converting ad copy matched to your offer
          </div>
        </div>
        <button
          onClick={generateAICopy}
          disabled={loadingAI}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 12px',
            borderRadius: '8px',
            background: '#6366F1',
            border: 'none',
            color: '#FFFFFF',
            fontSize: '12px',
            fontWeight: 600,
            cursor: loadingAI ? 'not-allowed' : 'pointer',
            opacity: loadingAI ? 0.7 : 1
          }}
        >
          {loadingAI ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {loadingAI ? 'Writing…' : 'Generate'}
        </button>
      </div>

      {/* Platform Select */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Ad Channel
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {(['meta', 'google', 'organic'] as const).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => handleFieldChange('platform', p)}
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                border: data.platform === p ? '1.5px solid #6366F1' : '1px solid rgba(255, 255, 255, 0.1)',
                background: data.platform === p ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                color: data.platform === p ? '#FFFFFF' : '#94A3B8',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {p === 'meta' ? 'Meta (FB/IG)' : p === 'google' ? 'Google' : 'Organic'}
            </button>
          ))}
        </div>
      </div>

      {/* Headline */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Ad Headline
        </label>
        <input
          type="text"
          value={data.headline}
          onChange={e => handleFieldChange('headline', e.target.value)}
          placeholder="e.g. Claim Your Complimentary Strategy Session"
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

      {/* Body Copy */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Primary Text / Caption
        </label>
        <textarea
          rows={3}
          value={data.body}
          onChange={e => handleFieldChange('body', e.target.value)}
          placeholder="Explain the offer, remove friction, and describe the transformation..."
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#FFFFFF',
            fontSize: '13px',
            outline: 'none',
            resize: 'vertical'
          }}
        />
      </div>

      {/* CTA Button Text */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Call-To-Action Button
        </label>
        <input
          type="text"
          value={data.ctaText}
          onChange={e => handleFieldChange('ctaText', e.target.value)}
          placeholder="e.g. Claim Offer Now"
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

      {/* UTM Campaign */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          UTM Campaign Tag
        </label>
        <input
          type="text"
          value={data.utmCampaign}
          onChange={e => handleFieldChange('utmCampaign', e.target.value)}
          placeholder="e.g. lead-gen-spring"
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#94A3B8',
            fontFamily: 'monospace',
            fontSize: '12px',
            outline: 'none'
          }}
        />
      </div>

      {/* Live Card Preview */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#64748B', marginBottom: '8px' }}>
          Live Ad Mockup Preview
        </div>
        <div
          style={{
            padding: '14px',
            borderRadius: '10px',
            background: '#0B0F19',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '14px' }}>
              J
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>Your Business Name</div>
              <div style={{ fontSize: '10px', color: '#64748B' }}>Sponsored · Paid Campaign</div>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: '#CBD5E1', marginBottom: '10px', lineHeight: '1.4' }}>
            {data.body || 'Your ad copy will appear here...'}
          </div>
          {data.imageUrl && (
            <img
              src={data.imageUrl}
              alt="Ad visual"
              style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '6px', marginBottom: '10px' }}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '6px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#F8FAFC', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {data.headline || 'Offer Headline'}
            </div>
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 8px', borderRadius: '4px', background: '#3B82F6', color: '#FFFFFF' }}>
              {data.ctaText || 'Learn More'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
