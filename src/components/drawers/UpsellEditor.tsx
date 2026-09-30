import React, { useState } from 'react';
import { Zap, ArrowDownRight, Clock, Plus, Trash2, ExternalLink, ShoppingBag, ShieldCheck } from 'lucide-react';
import type { UpsellNodeData, Workspace } from '../../types/journey';
import { ShopifyProductPickerModal, type SelectedProductPayload } from '../modals/ShopifyProductPickerModal';
import { useFieldIds } from '../../lib/a11yHooks';
import { ownCopy, ownCopyList, timerMinutesFromInput } from '../../lib/stepDefaults';

interface Props {
  data: UpsellNodeData;
  onChange: (updated: UpsellNodeData) => void;
  workspace?: Workspace | null;
  onOpenShopifyConnect?: () => void;
}

// The yes button text a product pick writes, so a later pick can tell it from the person's own words.
const PICKED_BUTTON = /^⚡ Yes, Add .+ to My Order$/;

export const UpsellEditor: React.FC<Props> =({ data, onChange, workspace, onOpenShopifyConnect }) => {
  const [editorTab, setEditorTab] = useState<'settings' | 'preview'>('settings');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  // Ties each label to its control, unique per mounted editor.
  const fid = useFieldIds();

  const handleFieldChange = (field: keyof UpsellNodeData, val: any) => {
    onChange({ ...data, [field]: val });
  };

  const isDownsell = data.offerType === 'downsell';
  const accentColor = isDownsell ? '#F59E0B' : '#10B981';

  // Only the points the person wrote. An empty list used to show three skincare claims as if they
  // were saved, and editing one saved all three; Add Point wrote a claim of its own (R19).
  const benefits = Array.isArray(data.benefits) ? data.benefits : [];

  const handleBenefitChange = (index: number, val: string) => {
    const updated = [...benefits];
    updated[index] = val;
    handleFieldChange('benefits', updated);
  };

  const handleAddBenefit = () => {
    handleFieldChange('benefits', [...benefits, '']);
  };

  const handleRemoveBenefit = (index: number) => {
    const updated = benefits.filter((_, i) => i !== index);
    handleFieldChange('benefits', updated);
  };

  const handleProductPicked = ({ product, variant }: SelectedProductPayload) => {
    const variantTitleSuffix = variant.title && variant.title !== 'Default' ? ` (${variant.title})` : '';

    // The regular price stays what the user entered: the store gives no compare-at price here, and
    // a pick used to write one at 1.6 times the offer price as the strikethrough (R14).
    // The headline stays the person's own: an empty one used to become "Special Allocation: <title>
    // with VIP Savings", an invented offer that also silenced Check design's 'Add a headline.' (R20).
    // The yes button names the product only while it holds no words of the person's own: the new-step
    // default, a blank, or what an earlier pick wrote. A pick used to overwrite whatever they typed.
    const buttonText = (data.acceptButtonText || '').trim();
    const buttonIsOurs = !buttonText || buttonText === 'Yes, add this to my order' || PICKED_BUTTON.test(buttonText);
    onChange({
      ...data,
      shopifyProductId: product.id,
      shopifyVariantId: variant.id,
      productTitle: `${product.title}${variantTitleSuffix}`,
      productPrice: variant.price || product.price,
      productImage: product.imageUrl || data.productImage,
      acceptButtonText: buttonIsOurs ? `⚡ Yes, Add ${product.title} to My Order` : data.acceptButtonText,
      headline: data.headline
    });
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
          aria-pressed={editorTab === 'settings'}
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
          aria-pressed={editorTab === 'preview'}
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
            <div id={fid('offer-type')} style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94A3B8', marginBottom: '6px', textTransform: 'uppercase' }}>
              Offer Funnel Position
            </div>
            <div role="group" aria-labelledby={fid('offer-type')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                aria-pressed={!isDownsell}
                onClick={() => {
                  // Switching position changes only the position and its label. It used to fill an empty
                  // headline, badge and prices with a made-up offer that then published as the step's own.
                  onChange({
                    ...data,
                    offerType: 'upsell',
                    label: 'Post-Purchase Upsell (OTO)'
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
                aria-pressed={isDownsell}
                onClick={() => {
                  onChange({
                    ...data,
                    offerType: 'downsell',
                    label: 'Downsell Step'
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
              <label htmlFor={fid('headline')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                Offer Headline
              </label>
              <input
                id={fid('headline')}
                type="text"
                value={data.headline || ''}
                onChange={e => handleFieldChange('headline', e.target.value)}
                placeholder="Write the headline for this offer"
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
              <label htmlFor={fid('subhead')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                Subhead Reassurance
              </label>
              <textarea
                id={fid('subhead')}
                rows={2}
                value={data.subhead || ''}
                onChange={e => handleFieldChange('subhead', e.target.value)}
                placeholder="Say what the add-on is and why it suits this order. Leave it blank if you do not have a line."
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', alignItems: 'end' }}>
              <div>
                <label htmlFor={fid('badge-text')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                  Badge Callout
                </label>
                <input
                  id={fid('badge-text')}
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
                <label htmlFor={fid('urgency-minutes')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                  Countdown timer (optional, minutes)
                </label>
                {/* Empty or 0 is no countdown: the field never puts back a timer the person removed. */}
                <input
                  id={fid('urgency-minutes')}
                  type="number"
                  min={0}
                  max={60}
                  value={data.urgencyMinutes || ''}
                  placeholder="Off"
                  onChange={e => handleFieldChange('urgencyMinutes', timerMinutesFromInput(e.target.value))}
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#CBD5E1', textTransform: 'uppercase' }}>
                Product & 1-Tap Checkout Setup
              </div>
              <button
                type="button"
                onClick={() => setIsPickerOpen(true)}
                style={{
                  backgroundColor: 'rgba(244, 114, 182, 0.15)',
                  border: '1px solid rgba(244, 114, 182, 0.35)',
                  color: '#f472b6',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <ShoppingBag size={12} />
                Browse Catalog
              </button>
            </div>

            {data.productTitle && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  marginBottom: '10px'
                }}
              >
                {data.productImage ? (
                  <img
                    src={data.productImage}
                    alt=""
                    style={{ width: '36px', height: '36px', borderRadius: '4px', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(244, 114, 182, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#f472b6'
                    }}
                  >
                    <ShoppingBag size={16} />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {data.productTitle}
                  </div>
                  <div style={{ fontSize: '11px', color: '#10B981', fontWeight: 600 }}>
                    {data.productPrice || '$0.00'} • <span style={{ color: '#94A3B8', fontFamily: 'monospace' }}>Variant: {data.shopifyVariantId || 'Not Set'}</span>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '8px', marginBottom: '10px' }}>
              <div>
                <label htmlFor={fid('product-title')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                  Offer Product Title
                </label>
                <input
                  id={fid('product-title')}
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

              <div>
                <label htmlFor={fid('shopify-variant-id')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                  Shopify Variant ID
                </label>
                <input
                  id={fid('shopify-variant-id')}
                  type="text"
                  value={data.shopifyVariantId || ''}
                  onChange={e => handleFieldChange('shopifyVariantId', e.target.value)}
                  placeholder="e.g. 42109840101"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#FFFFFF',
                    fontFamily: 'monospace',
                    fontSize: '12px'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
              <div>
                <label htmlFor={fid('product-price')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                  Offer Price ($)
                </label>
                <input
                  id={fid('product-price')}
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
                <label htmlFor={fid('regular-price')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                  Regular Price ($)
                </label>
                <input
                  id={fid('regular-price')}
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
                <label htmlFor={fid('discount-code')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                  Promo Code
                </label>
                <input
                  id={fid('discount-code')}
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
              <label htmlFor={fid('product-image')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                Product Image URL
              </label>
              <input
                id={fid('product-image')}
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
                    aria-label={`Value point ${idx + 1}`}
                    value={b}
                    onChange={e => handleBenefitChange(idx, e.target.value)}
                    placeholder="A point you can stand behind"
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
                  <button
                    type="button"
                    onClick={() => handleRemoveBenefit(idx)}
                    aria-label={`Remove value point ${idx + 1}`}
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
                </div>
              ))}
              {benefits.length === 0 && (
                <div style={{ fontSize: '11px', color: '#94A3B8' }}>No value points yet.</div>
              )}
            </div>
          </div>

          {/* Section: Action Buttons */}
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#CBD5E1', marginBottom: '8px', textTransform: 'uppercase' }}>
              Action Buttons & Routing
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label htmlFor={fid('accept-button-text')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                Primary Accept Button
              </label>
              <input
                id={fid('accept-button-text')}
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
              <label htmlFor={fid('decline-button-text')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
                Secondary Decline Link
              </label>
              <input
                id={fid('decline-button-text')}
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
          {/* Countdown banner: only when the step sets a timer, worded like the live page (C22). */}
          {(data.urgencyMinutes ?? 0) > 0 && (
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
              This offer timer runs for {String(data.urgencyMinutes).padStart(2, '0')}:00.
            </span>
          </div>
          )}

          {/* Headline & Subhead */}
          <div style={{ textAlign: 'center' }}>
            {data.badgeText && (
            <span
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: '9999px',
                background: isDownsell ? 'rgba(245, 158, 11, 0.18)' : 'rgba(16, 185, 129, 0.18)',
                color: accentColor,
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.05em',
                marginBottom: '6px'
              }}
            >
              {data.badgeText}
            </span>
            )}
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#F8FAFC' }}>
              {data.headline || 'Another offer'}
            </h3>
            {/* Mirrors the published page (publicRoutes.mjs): a blank or an instruction shows no line. */}
            {ownCopy(data.subhead) && (
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#94A3B8', lineHeight: '1.4' }}>
              {ownCopy(data.subhead)}
            </p>
            )}
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
                alt=""
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
              {/* Empty fields show a hint, never a stand-in product, price or saving (the live page shows none). */}
              <div style={{ fontSize: '12px', fontWeight: 700, color: data.productTitle ? '#FFFFFF' : '#94A3B8', fontStyle: data.productTitle ? 'normal' : 'italic' }}>
                {data.productTitle || 'No product title yet'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                {data.productPrice ? (
                  <span style={{ fontSize: '15px', fontWeight: 800, color: accentColor }}>
                    {data.productPrice}
                  </span>
                ) : (
                  <span style={{ fontSize: '11px', color: '#94A3B8', fontStyle: 'italic' }}>No price yet</span>
                )}
                {data.regularPrice && (
                  <span style={{ fontSize: '11px', color: '#94A3B8', textDecoration: 'line-through' }}>
                    {data.regularPrice}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
                {ownCopyList(data.benefits).slice(0, 2).map((b, idx) => (
                  <div key={idx} style={{ fontSize: '11px', color: '#CBD5E1', display: 'flex', alignItems: 'center', gap: '5px' }}>
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
              <span>{data.acceptButtonText || 'Continue'}</span>
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
                {data.declineButtonText || (isDownsell ? 'No thanks, continue to my order confirmation' : 'No thanks, skip this offer')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Shopify Product Picker Modal */}
      <ShopifyProductPickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onSelectProduct={handleProductPicked}
        workspace={workspace}
        onOpenShopifyConnect={onOpenShopifyConnect}
        title={isDownsell ? 'Select Downsell Product Offer' : 'Select Post-Purchase Upsell Product'}
        subtitle="Choose a product or variant from your catalog to connect directly to 1-tap post-purchase checkout."
        selectedVariantId={data.shopifyVariantId}
      />
    </div>
  );
};
