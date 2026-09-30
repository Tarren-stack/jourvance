import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw, Megaphone, ExternalLink } from 'lucide-react';
import type { AdNodeData } from '../../types/journey';
import { requestAICopyAnswer } from '../../lib/hubClient';
import {
  readAdCopyAnswer,
  planAdCopyRows,
  applyAdCopyRows,
  initialFocus,
  joinLabels,
  AD_COPY_GOAL,
  AD_COPY_LABELS,
  type AdCopyField,
  type CopyField,
  type SuggestedCopy
} from '../../lib/pageCopyProposal';
import { CopyProposalCard } from './CopyProposalCard';
import { useFieldIds } from '../../lib/a11yHooks';
import { ownCopy } from '../../lib/stepDefaults';

interface Props {
  data: AdNodeData;
  onChange: (updated: AdNodeData) => void;
  offerHeadline: string;
  businessType: string;
}

/** What the Ad Spend field stores for what was typed: dollars to the cent, or 0 for not entered. */
export function spendFromInput(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

export const AdEditor: React.FC<Props> = ({ data, onChange, offerHeadline, businessType }) => {
  const [loadingAI, setLoadingAI] = useState(false);
  const [editorTab, setEditorTab] = useState<'settings' | 'preview'>('settings');
  const [adFormat, setAdFormat] = useState<'meta' | 'google' | 'story'>('meta');
  // Ties each label to its control, unique per mounted editor.
  const fid = useFieldIds();

  const handleFieldChange = (field: keyof AdNodeData, val: any) => {
    onChange({ ...data, [field]: val });
  };

  // Spend is the one figure on the ad card the person types in, so the field is the only writer
  // of it. Blank means not entered (stored as 0). A draft keeps "12." or "0.5" typeable.
  const storedSpend = typeof data.spend === 'number' && data.spend > 0 ? String(data.spend) : '';
  const [spendDraft, setSpendDraft] = useState(storedSpend);
  useEffect(() => {
    // Only an outside change (undo, another ad step) resyncs the draft.
    if (spendFromInput(spendDraft) !== spendFromInput(storedSpend)) setSpendDraft(storedSpend);
  }, [storedSpend]);
  const handleSpendChange = (raw: string) => {
    setSpendDraft(raw);
    handleFieldChange('spend', spendFromInput(raw));
  };

  // AI copy is a proposal until the person keeps it, as in the page editor. Anything that is not
  // real hub-brain copy (template text, the hourly limit, no answer) is one sentence and changes
  // nothing. `aiRequest` numbers each request so a reply landing after the inspector closed is
  // dropped (the inspector remounts per step).
  const [proposal, setProposal] = useState<SuggestedCopy<AdCopyField> | null>(null);
  const [selectedFields, setSelectedFields] = useState<CopyField[]>([]);
  const [aiNotice, setAiNotice] = useState('');
  const aiRequest = useRef(0);
  const generateButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { aiRequest.current++; }, []);

  const generateAICopy = async () => {
    const ticket = ++aiRequest.current;
    setAiNotice('');
    setProposal(null);
    setLoadingAI(true);
    try {
      const answer = await requestAICopyAnswer({
        nodeType: 'ad',
        businessType,
        offerHeadline: data.headline || offerHeadline,
        goal: AD_COPY_GOAL
      });
      if (ticket !== aiRequest.current) return;
      const read = readAdCopyAnswer(answer as { status: number; body: any } | null);
      if (read.kind === 'unavailable') {
        setAiNotice(read.message);
        return;
      }
      const rows = planAdCopyRows(data, read.copy);
      if (rows.length === 0) {
        setAiNotice('The suggestion matches your current copy. Nothing was changed.');
        return;
      }
      setProposal(read.copy);
      setSelectedFields(rows.map(r => r.field));
    } finally {
      if (ticket === aiRequest.current) setLoadingAI(false);
    }
  };

  // Planned from the live data on every render, so "Now" is what the field holds this moment.
  const proposalRows = proposal ? planAdCopyRows(data, proposal) : [];

  // Applies the kept rows onto the CURRENT data in one onChange, so text typed meanwhile survives.
  const applyProposal = () => {
    if (!proposal) return;
    const fields = selectedFields.filter(f => proposalRows.some(r => r.field === f));
    if (fields.length > 0) onChange(applyAdCopyRows(data, proposal, fields));
    setProposal(null);
    setAiNotice(fields.length > 0 ? `Updated ${joinLabels(fields.map(f => AD_COPY_LABELS[f as AdCopyField]))}.` : '');
    generateButtonRef.current?.focus();
  };

  const keepCopy = () => {
    setProposal(null);
    generateButtonRef.current?.focus();
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
          aria-pressed={editorTab === 'settings'}
          style={{
            flex: 1,
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: editorTab === 'settings' ? '#4F46E5' : 'transparent',
            color: editorTab === 'settings' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Creative Settings
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
            backgroundColor: editorTab === 'preview' ? '#4F46E5' : 'transparent',
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
            <span id={fid('format')} style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>Channel Format:</span>
            <div role="group" aria-labelledby={fid('format')} style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setAdFormat('meta')}
                aria-pressed={adFormat === 'meta'}
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
                aria-pressed={adFormat === 'google'}
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
                aria-pressed={adFormat === 'story'}
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
                <div aria-hidden="true" style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366F1, #8B5CF6)' }} />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#94A3B8', fontStyle: 'italic' }}>Your page name</div>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>Sponsored</div>
                </div>
              </div>

              <div style={{ fontSize: '13px', color: '#E2E8F0', marginBottom: '12px', lineHeight: '1.45', whiteSpace: 'pre-wrap' }}>
                {ownCopy(data.body) || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No ad copy written yet</span>}
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
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#FFFFFF' }}>
                    {data.headline || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No headline written yet</span>}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#FFFFFF', maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {data.headline || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No headline yet</span>}
                  </div>
                </div>
                <button
                  type="button"
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '6px 12px',
                    borderRadius: '6px',
                    background: '#4F46E5',
                    color: '#FFFFFF',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {data.ctaText || <span style={{ fontStyle: 'italic', opacity: 0.8 }}>No button text yet</span>}
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
                Sponsored
              </div>
              <h4 style={{ fontSize: '15px', color: '#60A5FA', fontWeight: 600, marginBottom: '6px', cursor: 'pointer' }}>
                {data.headline || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No headline written yet</span>}
              </h4>
              <p style={{ fontSize: '12px', color: '#94A3B8', lineHeight: 1.5 }}>
                {ownCopy(data.body) || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No ad copy written yet</span>}
              </p>
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
                <div aria-hidden="true" style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#6366F1' }} />
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', fontStyle: 'italic' }}>Your page name</span>
              </div>

              <div style={{ textAlign: 'center', padding: '0 8px' }}>
                <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#FFFFFF', lineHeight: 1.25 }}>
                  {data.headline || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No headline written yet</span>}
                </h3>
                <p style={{ fontSize: '11px', color: '#CBD5E1', marginTop: '8px', lineHeight: 1.4 }}>
                  {ownCopy(data.body) || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No ad copy written yet</span>}
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
                  {data.ctaText ? <>Swipe Up / {data.ctaText} ↑</> : <span style={{ fontStyle: 'italic', color: '#64748B' }}>No button text yet</span>}
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
          ref={generateButtonRef}
          type="button"
          onClick={generateAICopy}
          disabled={loadingAI}
          aria-busy={loadingAI}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 12px',
            borderRadius: '8px',
            background: '#4F46E5',
            border: 'none',
            color: '#FFFFFF',
            fontSize: '12px',
            fontWeight: 600,
            cursor: loadingAI ? 'not-allowed' : 'pointer',
            opacity: loadingAI ? 0.7 : 1
          }}
        >
          {loadingAI ? <RefreshCw size={13} className="animate-spin" aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
          {loadingAI ? 'Writing…' : 'Generate'}
        </button>
      </div>
      <p
        role="status"
        style={{
          margin: aiNotice ? '-8px 0 0' : '-16px 0 0',
          fontSize: '12px',
          lineHeight: 1.45,
          color: aiNotice.endsWith('Nothing was changed.') ? '#FBBF24' : '#34D399',
          overflowWrap: 'anywhere'
        }}
      >
        {aiNotice}
      </p>

      {proposal && proposalRows.length > 0 && (
        <CopyProposalCard
          rows={proposalRows}
          heading="Suggested ad copy"
          selected={selectedFields}
          onToggle={field => setSelectedFields(cur => cur.includes(field) ? cur.filter(f => f !== field) : [...cur, field])}
          onUse={applyProposal}
          onKeep={keepCopy}
          focusFirst={initialFocus(proposalRows)}
        />
      )}

      {/* Platform Select */}
      <div>
        <div id={fid('platform')} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Ad Channel
        </div>
        <div role="group" aria-labelledby={fid('platform')} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {(['meta', 'google', 'organic'] as const).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => handleFieldChange('platform', p)}
              aria-pressed={data.platform === p}
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
        <label htmlFor={fid('headline')} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Ad Headline
        </label>
        <input
          id={fid('headline')}
          type="text"
          value={data.headline || ''}
          onChange={e => handleFieldChange('headline', e.target.value)}
          placeholder="The first line people read, in words you can stand behind"
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
        <label htmlFor={fid('body')} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Primary Text / Caption
        </label>
        <textarea
          id={fid('body')}
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
        <label htmlFor={fid('cta-text')} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Call-To-Action Button
        </label>
        <input
          id={fid('cta-text')}
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
        <label htmlFor={fid('utm-campaign')} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          UTM Campaign Tag
        </label>
        <input
          id={fid('utm-campaign')}
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

      {/* Ad Spend: the only place spend is entered */}
      <div>
        <label htmlFor={fid('spend')} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Ad Spend ($)
        </label>
        <input
          id={fid('spend')}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={spendDraft}
          onChange={e => handleSpendChange(e.target.value)}
          placeholder="Not entered"
          aria-describedby={fid('spend-hint')}
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
        <div id={fid('spend-hint')} style={{ fontSize: '11px', color: '#94A3B8', marginTop: '6px', lineHeight: 1.4 }}>
          What this ad cost over the date range you are viewing. Leave it blank if you have not spent anything. The card uses it for the estimated cost per visit and ROAS.
        </div>
      </div>

      </>
      )}
    </div>
  );
};
