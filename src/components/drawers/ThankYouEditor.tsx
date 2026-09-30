import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Gift, CheckCircle2, Copy, ExternalLink, Plus, Trash2, ArrowRight } from 'lucide-react';
import type { ThankYouNodeData, Workspace } from '../../types/journey';
import { thankYouView } from '../../lib/stepDefaults';
import { useFieldIds } from '../../lib/a11yHooks';
import { copyText, copyLabel, copyAnnouncement, type CopyResult } from '../../lib/copyText';

interface Props {
  data: ThankYouNodeData;
  onChange: (updated: ThankYouNodeData) => void;
  workspace?: Workspace | null;
}

export const ThankYouEditor: React.FC<Props> = ({ data, onChange, workspace }) => {
  const [editorTab, setEditorTab] = useState<'settings' | 'preview'>('settings');
  // What the voucher's Copy button last did, for two seconds. 'ok' only once the clipboard took it.
  const [copied, setCopied] = useState<CopyResult | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  // Ties each label to its control, unique per mounted editor.
  const fid = useFieldIds();

  const handleFieldChange = (field: keyof ThankYouNodeData, val: any) => {
    onChange({ ...data, [field]: val });
  };

  const steps = Array.isArray(data.usageGuideSteps) ? data.usageGuideSteps : [];
  // The connected store, as the published page reads it: a store button shows with a store link
  // or with this domain. The server sends '' for a demo store.
  const storeDomain = (workspace?.shopifyConfig?.storeDomain || '').trim().toLowerCase();
  // What the published page shows, part by part, so the Live Customer View matches it.
  const view = thankYouView(data, storeDomain);
  // Only a web address becomes a live link in the editor; anything else draws as a plain button.
  const webLink = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);

  const handleCopyVoucher = async (code: string) => {
    const result = await copyText(code);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopied(result);
    copyTimer.current = setTimeout(() => setCopied(null), 2000);
  };

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
          aria-pressed={editorTab === 'settings'}
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
          aria-pressed={editorTab === 'preview'}
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
                <label htmlFor={fid('badge-text')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>VIP Badge Text</label>
                <input
                  id={fid('badge-text')}
                  type="text"
                  value={data.badgeText || ''}
                  placeholder="No badge"
                  onChange={e => handleFieldChange('badgeText', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
              <div>
                <label htmlFor={fid('headline')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Headline</label>
                <input
                  id={fid('headline')}
                  type="text"
                  value={data.headline || ''}
                  placeholder="Thank you"
                  onChange={e => handleFieldChange('headline', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
              <div>
                <label htmlFor={fid('subhead')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Subhead Description</label>
                <textarea
                  id={fid('subhead')}
                  rows={2}
                  value={data.subhead || ''}
                  placeholder="What happens next, in one line"
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
                <label htmlFor={fid('bounce-back-discount-code')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Discount Code</label>
                <input
                  id={fid('bounce-back-discount-code')}
                  type="text"
                  value={data.bounceBackDiscountCode || ''}
                  placeholder="No code"
                  onChange={e => handleFieldChange('bounceBackDiscountCode', e.target.value.toUpperCase())}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px', fontFamily: 'monospace' }}
                />
              </div>
              <div>
                <label htmlFor={fid('bounce-back-discount-text')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Perk Description</label>
                <input
                  id={fid('bounce-back-discount-text')}
                  type="text"
                  value={data.bounceBackDiscountText || ''}
                  placeholder="No perk yet"
                  onChange={e => handleFieldChange('bounceBackDiscountText', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
            </div>
          </div>

          {/* SECTION 3: 3-Step Onboarding Guide */}
          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#F472B6', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                3. Product Onboarding / Quick Start Guide
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
              <label htmlFor={fid('usage-guide-title')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Section Title</label>
              <input
                id={fid('usage-guide-title')}
                type="text"
                value={data.usageGuideTitle || ''}
                placeholder="No section title"
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
                    aria-label={`Step ${i + 1}`}
                    value={st}
                    onChange={e => handleStepChange(i, e.target.value)}
                    style={{ flex: 1, boxSizing: 'border-box', padding: '6px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '11px' }}
                  />
                  {steps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveStep(i)}
                      aria-label={`Remove step ${i + 1}`}
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
                <label htmlFor={fid('store-return-text')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Shopify Store Return Button Text</label>
                <input
                  id={fid('store-return-text')}
                  type="text"
                  value={data.storeReturnText || ''}
                  placeholder="Back to the store"
                  onChange={e => handleFieldChange('storeReturnText', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
              <div>
                <label htmlFor="jv-ty-store-url" style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Store Link</label>
                <input
                  id="jv-ty-store-url"
                  type="url"
                  value={data.storeReturnUrl || ''}
                  placeholder={storeDomain ? `https://${storeDomain}` : 'No store link'}
                  onChange={e => handleFieldChange('storeReturnUrl', e.target.value.trim())}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
              <div>
                <label htmlFor={fid('community-invite-text')} style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>VIP Community Invite Text</label>
                <input
                  id={fid('community-invite-text')}
                  type="text"
                  value={data.communityInviteText || ''}
                  placeholder="Open the link"
                  onChange={e => handleFieldChange('communityInviteText', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
              <div>
                <label htmlFor="jv-ty-community-url" style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>Community Link</label>
                <input
                  id="jv-ty-community-url"
                  type="url"
                  value={data.communityInviteUrl || ''}
                  placeholder="No community link"
                  onChange={e => handleFieldChange('communityInviteUrl', e.target.value.trim())}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '12px' }}
                />
              </div>
              <p style={{ fontSize: '11px', color: '#94A3B8', margin: 0, lineHeight: '1.4' }}>
                Each button shows only with its link. The store button also shows when a store is connected.
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* LIVE INTERACTIVE PREVIEW TAB: drawn from thankYouView, the published page's own rules */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ backgroundColor: '#0B0F19', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.12)', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Header */}
            <div style={{ textAlign: 'center', padding: '6px 0' }}>
              <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)', border: '1.5px solid #10B981', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#10B981', fontSize: '24px', marginBottom: '12px' }}>
                ✓
              </div>
              {view.badge && (
                <div style={{ display: 'block', width: 'fit-content', margin: '0 auto 8px', background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.3)', color: '#F472B6', padding: '3px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>
                  {view.badge}
                </div>
              )}
              <h4 style={{ fontSize: '18px', fontWeight: 800, color: '#FFFFFF', margin: '0 0 6px' }}>
                {view.headline}
              </h4>
              {view.subhead && (
                <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0, lineHeight: '1.4' }}>
                  {view.subhead}
                </p>
              )}
            </div>

            {/* Voucher: only with a code */}
            {view.voucher && <div style={{ border: '1px dashed rgba(236, 72, 153, 0.4)', background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.1), rgba(15, 23, 42, 0.6))', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#F472B6', textTransform: 'uppercase' }}>Next order</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF', margin: '3px 0 10px' }}>
                {view.voucher.title}
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(0, 0, 0, 0.5)', padding: '6px 14px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.15)' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '16px', fontWeight: 800, color: '#FFFFFF' }}>
                  {view.voucher.code}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyVoucher(view.voucher!.code)}
                  style={{ background: 'rgba(236, 72, 153, 0.25)', border: '1px solid rgba(236, 72, 153, 0.5)', color: '#F472B6', fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', cursor: 'pointer' }}
                >
                  {copyLabel(copied)}
                </button>
              </div>
              <span role="status" className="jv-sr-only">{copyAnnouncement(copied, 'Code')}</span>
            </div>}

            {/* Guide: only with written lines, and its title only when written */}
            {view.guide && <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', padding: '14px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              {view.guide.title && (
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#FFFFFF', marginBottom: '10px' }}>
                  {view.guide.title}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {view.guide.steps.map((st, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <span style={{ width: '20px', height: '20px', borderRadius: '6px', background: 'rgba(236, 72, 153, 0.15)', color: '#F472B6', fontSize: '11px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: '11px', color: '#CBD5E1', lineHeight: '1.4' }}>{st}</span>
                  </div>
                ))}
              </div>
            </div>}

            {/* Buttons: each only with its link, as on the published page. A link opens in a new tab. */}
            {(view.store || view.community) && <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {view.store && (
                <a
                  href={webLink(view.store.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'block', textAlign: 'center', textDecoration: 'none', padding: '12px', borderRadius: '10px', background: 'linear-gradient(135deg, #EC4899, #DB2777)', color: '#FFFFFF', fontSize: '12px', fontWeight: 700 }}
                >
                  {view.store.text}
                </a>
              )}
              {view.community && (
                <a
                  href={webLink(view.community.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'block', textAlign: 'center', textDecoration: 'none', padding: '10px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.15)', color: '#CBD5E1', fontSize: '11px', fontWeight: 600 }}
                >
                  {view.community.text}
                </a>
              )}
            </div>}
          </div>
          {!view.store && !view.community && (
            <p style={{ fontSize: '11px', color: '#94A3B8', margin: 0, lineHeight: '1.4' }}>
              No buttons on this page yet. Add a store link or a community link in the settings.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
