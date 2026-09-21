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
  const [editorTab, setEditorTab] = useState<'settings' | 'preview'>('settings');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Tab Switcher: Settings vs Live Preview */}
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
            backgroundColor: editorTab === 'settings' ? '#6366F1' : 'transparent',
            color: editorTab === 'settings' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Page Builder Settings
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
            backgroundColor: editorTab === 'preview' ? '#6366F1' : 'transparent',
            color: editorTab === 'preview' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Live Interactive Preview
        </button>
      </div>

      {editorTab === 'preview' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Device Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
            <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>Device Viewport:</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setPreviewDevice('desktop')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  backgroundColor: previewDevice === 'desktop' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                  color: previewDevice === 'desktop' ? '#818CF8' : '#94A3B8',
                  cursor: 'pointer'
                }}
              >
                Desktop
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice('mobile')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  backgroundColor: previewDevice === 'mobile' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                  color: previewDevice === 'mobile' ? '#818CF8' : '#94A3B8',
                  cursor: 'pointer'
                }}
              >
                Mobile
              </button>
            </div>
          </div>

          {/* Rendered Live Page Mockup */}
          <div
            style={{
              backgroundColor: '#070A12',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              overflow: 'hidden',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
              maxWidth: previewDevice === 'mobile' ? '300px' : '100%',
              margin: '0 auto',
              width: '100%'
            }}
          >
            {/* Browser chrome */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 12px',
                backgroundColor: '#1E293B',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#EF4444' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} />
              <span style={{ fontSize: '10px', color: '#64748B', marginLeft: '6px', fontFamily: 'monospace' }}>
                jourvance.app/p/{data.slug || 'offer'}
              </span>
            </div>

            <div style={{ padding: previewDevice === 'mobile' ? '16px' : '24px', textAlign: 'center' }}>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: '10px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: '#818CF8',
                  backgroundColor: 'rgba(99, 102, 241, 0.12)',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  marginBottom: '10px'
                }}
              >
                Exclusive Intake
              </span>
              <h2
                style={{
                  fontSize: previewDevice === 'mobile' ? '16px' : '20px',
                  fontWeight: 800,
                  color: '#FFFFFF',
                  lineHeight: 1.3,
                  marginBottom: '8px'
                }}
              >
                {data.headline || 'Your High-Converting Offer Headline'}
              </h2>
              <p
                style={{
                  fontSize: previewDevice === 'mobile' ? '11px' : '12px',
                  color: '#94A3B8',
                  lineHeight: 1.5,
                  marginBottom: '16px'
                }}
              >
                {data.subhead || 'Clear, concise subheadline addressing customer pain.'}
              </p>

              {/* Value Bullets */}
              <div
                style={{
                  textAlign: 'left',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px'
                }}
              >
                {(data.bullets || []).map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#E2E8F0', marginBottom: '6px' }}>
                    <span style={{ color: '#10B981', fontWeight: 800 }}>✓</span>
                    <span>{b}</span>
                  </div>
                ))}
              </div>

              {/* CTA Button */}
              <button
                type="button"
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)'
                }}
              >
                {data.buttonText || 'Claim Offer Now'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
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
      </>
      )}
    </div>
  );
};
