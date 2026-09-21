import React, { useState } from 'react';
import { Sparkles, RefreshCw, Plus, Trash2, Globe, ExternalLink } from 'lucide-react';
import type { PageNodeData } from '../../types/journey';
import { requestAICopy } from '../../lib/hubClient';

interface Props {
  data: PageNodeData;
  onChange: (updated: PageNodeData) => void;
  offerHeadline: string;
  businessType: string;
}

export const PageEditor: React.FC<Props> = ({ data, onChange, offerHeadline, businessType }) => {
  const [loadingAI, setLoadingAI] = useState(false);

  const handleFieldChange = (field: keyof PageNodeData, val: any) => {
    onChange({ ...data, [field]: val });
  };

  const handleBulletChange = (idx: number, val: string) => {
    const updated = [...(data.bullets || [])];
    updated[idx] = val;
    handleFieldChange('bullets', updated);
  };

  const addBullet = () => {
    handleFieldChange('bullets', [...(data.bullets || []), 'New value point']);
  };

  const removeBullet = (idx: number) => {
    handleFieldChange('bullets', (data.bullets || []).filter((_, i) => i !== idx));
  };

  const generateAICopy = async () => {
    setLoadingAI(true);
    try {
      const copy = await requestAICopy({
        nodeType: 'page',
        businessType,
        offerHeadline: data.headline || offerHeadline,
        goal: 'High-converting single-offer landing page'
      });
      if (copy) {
        onChange({
          ...data,
          headline: copy.headline || data.headline,
          subhead: copy.subhead || data.subhead,
          buttonText: copy.cta || data.buttonText
        });
      }
    } finally {
      setLoadingAI(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* AI Assistant */}
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
            <Sparkles size={14} color="#818CF8" /> Hub Brain Page Optimizer
          </div>
          <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>
            Optimize headlines for single-offer conversion
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
            cursor: loadingAI ? 'not-allowed' : 'pointer'
          }}
        >
          {loadingAI ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {loadingAI ? 'Writing…' : 'Generate'}
        </button>
      </div>

      {/* URL Slug */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Page URL Path
        </label>
        <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '8px', padding: '0 10px' }}>
          <span style={{ fontSize: '12px', color: '#64748B', fontFamily: 'monospace' }}>jourvance.app/p/</span>
          <input
            type="text"
            value={data.slug}
            onChange={e => handleFieldChange('slug', e.target.value)}
            placeholder="vip-consultation"
            style={{
              flex: 1,
              padding: '10px 4px',
              background: 'transparent',
              border: 'none',
              color: '#FFFFFF',
              fontSize: '13px',
              outline: 'none'
            }}
          />
        </div>
      </div>

      {/* Headline */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Main Landing Headline
        </label>
        <input
          type="text"
          value={data.headline}
          onChange={e => handleFieldChange('headline', e.target.value)}
          placeholder="e.g. Experience Premium Results Tailored to You"
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

      {/* Subhead */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Subheadline & Value Description
        </label>
        <textarea
          rows={3}
          value={data.subhead}
          onChange={e => handleFieldChange('subhead', e.target.value)}
          placeholder="Clarify who this is for and what makes your approach different..."
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

      {/* Value Bullets */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0' }}>
            Core Benefit Bullets ({data.bullets?.length || 0})
          </label>
          <button
            type="button"
            onClick={addBullet}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: '#818CF8', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
          >
            <Plus size={12} /> Add Point
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(data.bullets || []).map((b, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="text"
                value={b}
                onChange={e => handleBulletChange(idx, e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  outline: 'none'
                }}
              />
              <button
                type="button"
                onClick={() => removeBullet(idx)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '4px' }}
                title="Remove bullet"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Trust Badge */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Social Proof / Trust Badge
        </label>
        <input
          type="text"
          value={data.trustBadge}
          onChange={e => handleFieldChange('trustBadge', e.target.value)}
          placeholder="e.g. Rated 4.9/5 stars by over 450+ verified clients"
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

      {/* Button Text */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Primary Button Text
        </label>
        <input
          type="text"
          value={data.buttonText}
          onChange={e => handleFieldChange('buttonText', e.target.value)}
          placeholder="e.g. Claim Your Free Consultation"
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
    </div>
  );
};
