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
  const [editorTab, setEditorTab] = useState<'settings' | 'preview'>('settings');
  const [adFormat, setAdFormat] = useState<'meta' | 'google' | 'story'>('meta');

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Top Mode Switcher */}
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
          Creative Settings
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
          Live Multi-Channel Preview
        </button>
      </div>

      {editorTab === 'preview' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Format selector */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
            <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>Channel Format:</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setAdFormat('meta')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  backgroundColor: adFormat === 'meta' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                  color: adFormat === 'meta' ? '#818CF8' : '#94A3B8',
                  cursor: 'pointer'
                }}
              >
                Meta Feed
              </button>
              <button
                type="button"
                onClick={() => setAdFormat('google')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  backgroundColor: adFormat === 'google' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                  color: adFormat === 'google' ? '#818CF8' : '#94A3B8',
                  cursor: 'pointer'
                }}
              >
                Google Search
              </button>
              <button
                type="button"
                onClick={() => setAdFormat('story')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  backgroundColor: adFormat === 'story' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                  color: adFormat === 'story' ? '#818CF8' : '#94A3B8',
                  cursor: 'pointer'
                }}
              >
                Story/Reel
              </button>
            </div>
          </div>

          {/* Format Mockup Rendering */}
          {adFormat === 'meta' && (
            <div
              style={{
                padding: '16px',
                borderRadius: '12px',
                background: '#0B0F19',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366F1, #8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '14px', color: '#FFFFFF' }}>
                  J
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>Jourvance Verified Partner</div>
                  <div style={{ fontSize: '10px', color: '#64748B' }}>Sponsored · Paid Partnership</div>
                </div>
              </div>

              <div style={{ fontSize: '13px', color: '#E2E8F0', marginBottom: '12px', lineHeight: '1.45', whiteSpace: 'pre-wrap' }}>
                {data.body || 'Are you leaking 40% of ad clicks between your creative and your calendar? Watch how visual customer journeys double lead conversion.'}
              </div>

              <div
                style={{
                  width: '100%',
                  height: '160px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  position: 'relative'
                }}
              >
                <div style={{ textAlign: 'center', padding: '16px' }}>
                  <span style={{ fontSize: '11px', color: '#818CF8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Visual Pipeline Blueprint
                  </span>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#FFFFFF', marginTop: '6px' }}>
                    {data.headline || 'Turn Ad Clicks Into Pipeline'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <div>
                  <div style={{ fontSize: '10px', color: '#64748B', textTransform: 'uppercase' }}>JOURVANCE.APP</div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#FFFFFF', maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {data.headline || 'Claim Your Pipeline Blueprint'}
                  </div>
                </div>
                <button
                  type="button"
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '6px 12px',
                    borderRadius: '6px',
                    background: '#6366F1',
                    color: '#FFFFFF',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {data.ctaText || 'Learn More'}
                </button>
              </div>
            </div>
          )}

          {adFormat === 'google' && (
            <div
              style={{
                padding: '16px',
                borderRadius: '12px',
                background: '#0B0F19',
                border: '1px solid rgba(255, 255, 255, 0.12)'
              }}
            >
              <div style={{ fontSize: '11px', color: '#10B981', fontWeight: 700, marginBottom: '4px' }}>
                Sponsored · https://jourvance.com/lander
              </div>
              <h4 style={{ fontSize: '15px', color: '#60A5FA', fontWeight: 600, marginBottom: '6px', cursor: 'pointer' }}>
                {data.headline || 'High-Converting Customer Journey Platform | Jourvance'}
              </h4>
              <p style={{ fontSize: '12px', color: '#94A3B8', lineHeight: 1.5 }}>
                {data.body || 'Map, build, and optimize your entire customer journey from first ad to paying client on an interactive visual canvas. Zero code required.'}
              </p>
              <div style={{ display: 'flex', gap: '12px', marginTop: '10px', fontSize: '11px', color: '#818CF8' }}>
                <span>• Live Interactive Canvas</span>
                <span>• Single-Offer Landers</span>
                <span>• Flat $49/mo</span>
              </div>
            </div>
          )}

          {adFormat === 'story' && (
            <div
              style={{
                maxWidth: '260px',
                margin: '0 auto',
                height: '380px',
                borderRadius: '16px',
                background: 'linear-gradient(180deg, #1E1B4B 0%, #0F172A 100%)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '18px 14px',
                boxShadow: '0 12px 30px rgba(0,0,0,0.6)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>
                  J
                </div>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#FFFFFF' }}>jourvance.app</span>
              </div>

              <div style={{ textAlign: 'center', padding: '0 8px' }}>
                <span style={{ fontSize: '11px', color: '#F43F5E', fontWeight: 800, textTransform: 'uppercase' }}>
                  Stop The Fragmented Stack
                </span>
                <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#FFFFFF', marginTop: '8px', lineHeight: 1.25 }}>
                  {data.headline || 'Map Your Full Pipeline'}
                </h3>
                <p style={{ fontSize: '11px', color: '#CBD5E1', marginTop: '8px', lineHeight: 1.4 }}>
                  {data.body || 'Ads → Lander → Form → Drips in one view.'}
                </p>
              </div>

              <div style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '8px',
                    background: '#FFFFFF',
                    color: '#0F172A',
                    fontSize: '11px',
                    fontWeight: 800,
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  Swipe Up / {data.ctaText || 'Learn More'} ↑
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
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

      </>
      )}
    </div>
  );
};
