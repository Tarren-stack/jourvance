import React, { useState } from 'react';
import { Zap, ArrowDownRight, Clock, Plus, Trash2, ExternalLink, ShoppingBag, ShieldCheck } from 'lucide-react';
import type { UpsellNodeData, Workspace } from '../../types/journey';

interface Props {
  data: UpsellNodeData;
  onChange: (updated: UpsellNodeData) => void;
  workspace?: Workspace | null;
}

export const UpsellEditor: React.FC<Props> = ({ data, onChange, workspace }) => {
  const [editorTab, setEditorTab] = useState<'settings' | 'preview'>('settings');

  const handleFieldChange = (field: keyof UpsellNodeData, val: any) => {
    onChange({ ...data, [field]: val });
  };

  const isDownsell = data.offerType === 'downsell';
  const accentColor = isDownsell ? '#F59E0B' : '#10B981';

  const benefits = Array.isArray(data.benefits) && data.benefits.length
    ? data.benefits
    : [
        'Direct batch allocation from master cosmetic formulation',
        'Full 90-day cellular renewal supply',
        'Includes free complimentary expedited priority shipping'
      ];

  const handleBenefitChange = (index: number, val: string) => {
    const updated = [...benefits];
    updated[index] = val;
    handleFieldChange('benefits', updated);
  };

  const handleAddBenefit = () => {
    handleFieldChange('benefits', [...benefits, 'Exclusive one-time VIP savings not available in store.']);
  };

  const handleRemoveBenefit = (index: number) => {
    const updated = benefits.filter((_, i) => i !== index);
    handleFieldChange('benefits', updated);
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
            backgroundColor: editorTab === 'settings' ? accentColor : 'transparent',
            color: editorTab === 'settings' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          {isDownsell ? 'Downsell Settings' : 'Upsell (OTO) Settings'}
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
            backgroundColor: editorTab === 'preview' ? accentColor : 'transparent',
            color: editorTab === 'preview' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Live Customer Mockup
        </button>
      </div>

      {editorTab === 'settings' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Offer Type Switcher */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94A3B8', marginBottom: '6px', textTransform: 'uppercase' }}>
              Offer Funnel Position
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  onChange({
                    ...data,
                    offerType: 'upsell',
                    label: 'Post-Purchase Upsell (OTO)',
                    headline: data.headline || 'Special VIP Allocation: Complete Your Routine with 40% Off',
                    badgeText: data.badgeText || 'SAVE 40% VIP OFFER',
                    productPrice: data.productPrice || '$38.00',
                    regularPrice: data.regularPrice || '$64.00'
                  });
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: !isDownsell ? '1.5px solid #10B981' : '1px solid rgba(255, 255, 255, 0.1)',
                  backgroundColor: !isDownsell ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                  color: !isDownsell ? '#34D399' : '#94A3B8',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <Zap size={14} />
                <span>Upsell (OTO)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onChange({
                    ...data,
                    offerType: 'downsell',
                    label: 'Downsell Step',
                    headline: 'Wait! Try The Travel Ritual Mini at 50% Off',
                    badgeText: 'SAVE 50% DOWNSELL',
                    productPrice: '$24.00',
                    regularPrice: '$48.00'
                  });
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: isDownsell ? '1.5px solid #F59E0B' : '1px solid rgba(255, 255, 255, 0.1)',
                  backgroundColor: isDownsell ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                  color: isDownsell ? '#FBBF24' : '#94A3B8',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <ArrowDownRight size={14} />
                <span>Downsell Step</span>
              </button>
            </div>
          </div>

          {/* Section: Reassurance & Headline */}
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#CBD5E1', marginBottom: '8px', textTransform: 'uppercase' }}>
              Psychological Reassurance & Hooks
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                Offer Headline
              </label>
              <input
                type="text"
                value={data.headline || ''}
                onChange={e => handleFieldChange('headline', e.target.value)}
                placeholder="Wait! Add 3-Pack Replenishment for 40% Off"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#FFFFFF',
                  fontSize: '12px'
                }}
              />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                Subhead Reassurance
              </label>
              <textarea
                rows={2}
                value={data.subhead || ''}
                onChange={e => handleFieldChange('subhead', e.target.value)}
                placeholder="Your initial order is confirmed and being prepped. Add this exclusive VIP batch to your parcel with 1-click."
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  resize: 'vertical'
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                  Badge Callout
                </label>
                <input
                  type="text"
                  value={data.badgeText || ''}
                  onChange={e => handleFieldChange('badgeText', e.target.value)}
                  placeholder="SAVE 40% VIP OFFER"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#FFFFFF',
                    fontSize: '12px'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                  Reservation Timer (Mins)
                </label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={data.urgencyMinutes || 5}
                  onChange={e => handleFieldChange('urgencyMinutes', parseInt(e.target.value) || 5)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#FFFFFF',
                    fontSize: '12px'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Section: Product & Pricing */}
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#CBD5E1', marginBottom: '8px', textTransform: 'uppercase' }}>
              Product & 1-Tap Checkout Setup
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                Offer Product Title
              </label>
              <input
                type="text"
                value={data.productTitle || ''}
                onChange={e => handleFieldChange('productTitle', e.target.value)}
                placeholder="Bioactive Triple Barrier Replenishment Reserve"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#FFFFFF',
                  fontSize: '12px'
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                  Offer Price ($)
                </label>
                <input
                  type="text"
                  value={data.productPrice || ''}
                  onChange={e => handleFieldChange('productPrice', e.target.value)}
                  placeholder="$38.00"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#10B981',
                    fontWeight: 700,
                    fontSize: '12px'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                  Regular Price ($)
                </label>
                <input
                  type="text"
                  value={data.regularPrice || ''}
                  onChange={e => handleFieldChange('regularPrice', e.target.value)}
                  placeholder="$64.00"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#94A3B8',
                    textDecoration: 'line-through',
                    fontSize: '12px'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                  Promo Code
                </label>
                <input
                  type="text"
                  value={data.discountCode || ''}
                  onChange={e => handleFieldChange('discountCode', e.target.value.toUpperCase())}
                  placeholder="VIPOTO40"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#F472B6',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    fontSize: '12px'
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                Product Image URL
              </label>
              <input
                type="text"
                value={data.productImage || ''}
                onChange={e => handleFieldChange('productImage', e.target.value)}
                placeholder="https://images.unsplash.com/..."
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#FFFFFF',
                  fontSize: '12px'
                }}
              />
            </div>
          </div>

          {/* Section: Benefit Bullets */}
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#CBD5E1', textTransform: 'uppercase' }}>
                Key Value Points ({benefits.length})
              </div>
              <button
                type="button"
                onClick={handleAddBenefit}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: accentColor,
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Plus size={12} /> Add Point
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {benefits.map((b, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="text"
                    value={b}
                    onChange={e => handleBenefitChange(idx, e.target.value)}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: '6px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#FFFFFF',
                      fontSize: '11px'
                    }}
                  />
                  {benefits.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveBenefit(idx)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#EF4444',
                        cursor: 'pointer',
                        padding: '4px'
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Section: Action Buttons */}
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#CBD5E1', marginBottom: '8px', textTransform: 'uppercase' }}>
              Action Buttons & Routing
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                Primary Accept Button
              </label>
              <input
                type="text"
                value={data.acceptButtonText || ''}
                onChange={e => handleFieldChange('acceptButtonText', e.target.value)}
                placeholder="⚡ Yes, Upgrade My Order (1-Tap Checkout)"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#FFFFFF',
                  fontSize: '12px'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                Secondary Decline Link
              </label>
              <input
                type="text"
                value={data.declineButtonText || ''}
                onChange={e => handleFieldChange('declineButtonText', e.target.value)}
                placeholder="No thanks, continue to my order confirmation"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#FFFFFF',
                  fontSize: '12px'
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        /* Live Mockup View */
        <div
          style={{
            background: 'linear-gradient(145deg, #0B0F19, #131B2E)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '20px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            color: '#FFFFFF'
          }}
        >
          {/* Reservation Banner */}
          <div
            style={{
              background: 'rgba(234, 179, 8, 0.12)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              borderRadius: '8px',
              padding: '10px 12px',
              textAlign: 'center',
              fontSize: '11px',
              color: '#FACC15',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Clock size={13} />
            <span>
              <strong>Wait! Order #9812 Reserved.</strong> This one-time offer expires in 04:59.
            </span>
          </div>

          {/* Headline & Subhead */}
          <div style={{ textAlign: 'center' }}>
            <span
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: '9999px',
                background: isDownsell ? 'rgba(245, 158, 11, 0.18)' : 'rgba(16, 185, 129, 0.18)',
                color: accentColor,
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.05em',
                marginBottom: '6px'
              }}
            >
              {data.badgeText || (isDownsell ? 'EXCLUSIVE DOWNSELL' : 'SPECIAL VIP ALLOCATION')}
            </span>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#F8FAFC' }}>
              {data.headline || 'Complete Your Routine with 40% Off'}
            </h3>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#94A3B8', lineHeight: '1.4' }}>
              {data.subhead || 'Add this replenishment reserve to your order with 1-click before shipment.'}
            </p>
          </div>

          {/* Product Presentation Card */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '10px',
              padding: '12px',
              display: 'flex',
              gap: '12px'
            }}
          >
            {data.productImage ? (
              <img
                src={data.productImage}
                alt="Product"
                style={{ width: '70px', height: '70px', borderRadius: '8px', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: '70px',
                  height: '70px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#94A3B8'
                }}
              >
                <ShoppingBag size={24} />
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#FFFFFF' }}>
                {data.productTitle || 'Bioactive Triple Barrier Reserve'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <span style={{ fontSize: '15px', fontWeight: 800, color: accentColor }}>
                  {data.productPrice || '$38.00'}
                </span>
                {data.regularPrice && (
                  <span style={{ fontSize: '11px', color: '#64748B', textDecoration: 'line-through' }}>
                    {data.regularPrice}
                  </span>
                )}
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    padding: '2px 5px',
                    borderRadius: '4px',
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#34D399'
                  }}
                >
                  SAVE 40%
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
                {benefits.slice(0, 2).map((b, idx) => (
                  <div key={idx} style={{ fontSize: '10px', color: '#CBD5E1', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <ShieldCheck size={11} color="#34D399" />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Action Buttons Mockup */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              type="button"
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                background: `linear-gradient(135deg, ${accentColor}, ${isDownsell ? '#D97706' : '#059669'})`,
                border: 'none',
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <Zap size={14} />
              <span>{data.acceptButtonText || '⚡ Yes, Upgrade My Order (1-Tap Checkout)'}</span>
            </button>

            <div style={{ textAlign: 'center' }}>
              <span
                style={{
                  fontSize: '11px',
                  color: '#94A3B8',
                  textDecoration: 'underline',
                  cursor: 'pointer'
                }}
              >
                {data.declineButtonText || 'No thanks, continue to my order confirmation'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
