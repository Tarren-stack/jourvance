import React, { useState } from 'react';
import { GitFork, Trophy, ExternalLink, Copy, Check, RotateCcw, TrendingUp, AlertCircle, Sparkles } from 'lucide-react';
import type { AbSplitNodeData } from '../../types/journey';
import { measureValue, splitTest, MIN_SPLIT_BRANCH_SAMPLE, type NodeMeasure } from '../../lib/journeyMetrics';
import { useFieldIds } from '../../lib/a11yHooks';

interface Props {
  data: AbSplitNodeData;
  onChange: (updated: AbSplitNodeData) => void;
  /** This split's figures from the map's stats snapshot (#9); null when it was not measured. */
  measure?: NodeMeasure | null;
}

export const AbSplitEditor: React.FC<Props> = ({ data, onChange, measure = null }) => {
  const [copiedLink, setCopiedLink] = useState(false);
  // Ties each label to its control (#19). Ids are unique per mounted editor.
  const fid = useFieldIds();

  const splitRatio = typeof data.splitRatio === 'number' ? Math.max(0, Math.min(100, data.splitRatio)) : 50;
  const ratioA = splitRatio;
  const ratioB = 100 - splitRatio;

  // Branch figures come from the stats snapshot, never from counts saved on the step. The
  // confidence test is journeyMetrics' splitTest, the same rule the split card reads (C23), so a
  // test that did not run reads 'Unavailable' here while the card names no leader.
  const visA = measureValue(measure, 'branchAVisitors');
  const convA = measureValue(measure, 'branchAConversions');
  const visB = measureValue(measure, 'branchBVisitors');
  const convB = measureValue(measure, 'branchBConversions');
  const test = splitTest(visA, convA, visB, convB);
  const stats = test.ran ? test : null;

  const handleCopyRouterUrl = () => {
    const slug = data.slug || 'split-test';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}/p/split/${slug}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleDeclareWinner = (winner: 'a' | 'b') => {
    onChange({
      ...data,
      winner,
      splitRatio: winner === 'a' ? 100 : 0
    });
  };

  const handleResetSplit = () => {
    onChange({
      ...data,
      winner: null,
      splitRatio: 50
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Overview Card */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(236, 72, 153, 0.08) 100%)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: '12px',
          padding: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(139, 92, 246, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#C4B5FD'
            }}
          >
            <GitFork size={18} />
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#F8FAFC' }}>
              A/B Traffic Split Router
            </div>
            <div style={{ fontSize: '11px', color: '#94A3B8' }}>
              Divide incoming funnel visitors deterministically with sticky cookies.
            </div>
          </div>
        </div>

        {/* Public Router Link & QA Links */}
        <div style={{ marginTop: '12px', background: 'rgba(0, 0, 0, 0.3)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>
            <span>Traffic Router URL:</span>
            <button
              type="button"
              onClick={handleCopyRouterUrl}
              style={{
                background: 'transparent',
                border: 'none',
                color: copiedLink ? '#34D399' : '#C4B5FD',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {copiedLink ? <Check size={12} /> : <Copy size={12} />}
              {copiedLink ? 'Copied URL' : 'Copy Public Link'}
            </button>
          </div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#F1F5F9', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            /p/split/{data.slug || 'split-test'}
          </div>

          <div style={{ marginTop: '8px', display: 'flex', gap: '8px', fontSize: '11px' }}>
            <a
              href={`/p/split/${data.slug || 'split-test'}?jv_var=a`}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#A78BFA', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}
            >
              <ExternalLink size={10} /> Test Force Branch A
            </a>
            <span style={{ color: '#475569' }}>•</span>
            <a
              href={`/p/split/${data.slug || 'split-test'}?jv_var=b`}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#F472B6', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}
            >
              <ExternalLink size={10} /> Test Force Branch B
            </a>
          </div>
        </div>
      </div>

      {/* Basic Settings: Label & Slug */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <label htmlFor={fid('label')} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
            Split Test Label
          </label>
          <input
            id={fid('label')}
            type="text"
            value={data.label || ''}
            onChange={e => onChange({ ...data, label: e.target.value })}
            placeholder="e.g. Summer Offer vs Discount Test"
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: '8px',
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#FFFFFF',
              fontSize: '13px',
              outline: 'none'
            }}
          />
        </div>

        <div>
          <label htmlFor={fid('slug')} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
            Router URL Slug
          </label>
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0, 0, 0, 0.3)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)', overflow: 'hidden' }}>
            <span style={{ padding: '9px 10px', fontSize: '12px', color: '#64748B', background: 'rgba(255, 255, 255, 0.04)' }}>
              /p/split/
            </span>
            <input
              id={fid('slug')}
              type="text"
              value={data.slug || ''}
              onChange={e => onChange({ ...data, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '') })}
              placeholder="promo-split"
              style={{
                flex: 1,
                padding: '9px 10px',
                background: 'transparent',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '13px',
                outline: 'none'
              }}
            />
          </div>
        </div>

        <div>
          <label htmlFor={fid('goal')} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
            Primary Optimization Goal
          </label>
          <select
            id={fid('goal')}
            value={data.goal || 'conversion_rate'}
            onChange={e => onChange({ ...data, goal: e.target.value as any })}
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: '8px',
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#FFFFFF',
              fontSize: '13px',
              outline: 'none'
            }}
          >
            <option value="conversion_rate">Conversion Rate % (Lead/Sale Volume)</option>
            <option value="revenue">Gross Funnel Revenue ($ Total Sales)</option>
            <option value="aov">Average Order Value ($ Per Customer)</option>
          </select>
        </div>
      </div>

      {/* Traffic Distribution Controls */}
      <div style={{ background: 'rgba(0, 0, 0, 0.25)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <label htmlFor={fid('ratio')} style={{ fontSize: '13px', fontWeight: 700, color: '#F1F5F9' }}>
            Traffic Distribution
          </label>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#A78BFA' }}>
            {ratioA}% A / {ratioB}% B
          </span>
        </div>

        {/* Visual Split Distribution Bar */}
        <div style={{ height: '10px', width: '100%', borderRadius: '9999px', overflow: 'hidden', display: 'flex', marginBottom: '14px', background: 'rgba(255, 255, 255, 0.1)' }}>
          <div style={{ width: `${ratioA}%`, background: '#8B5CF6', transition: 'width 0.15s ease' }} title={`Branch A: ${ratioA}%`} />
          <div style={{ width: `${ratioB}%`, background: '#EC4899', transition: 'width 0.15s ease' }} title={`Branch B: ${ratioB}%`} />
        </div>

        {/* Range Slider */}
        <input
          id={fid('ratio')}
          type="range"
          min="0"
          max="100"
          step="5"
          value={splitRatio}
          aria-valuetext={`${ratioA}% A, ${ratioB}% B`}
          onChange={e => onChange({ ...data, splitRatio: parseInt(e.target.value, 10), winner: null })}
          style={{
            width: '100%',
            cursor: 'pointer',
            accentColor: '#8B5CF6',
            marginBottom: '14px'
          }}
        />

        {/* Preset Quick Toggles */}
        <div role="group" aria-label="Split presets" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
          {[
            { label: '50 / 50', ratio: 50 },
            { label: '70 / 30', ratio: 70 },
            { label: '80 / 20', ratio: 80 },
            { label: '100% A', ratio: 100 },
            { label: '100% B', ratio: 0 }
          ].map(preset => {
            const isActive = splitRatio === preset.ratio;
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={isActive}
                onClick={() => onChange({ ...data, splitRatio: preset.ratio, winner: preset.ratio === 100 ? 'a' : preset.ratio === 0 ? 'b' : null })}
                style={{
                  padding: '6px 0',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: isActive ? '1px solid #8B5CF6' : '1px solid rgba(255, 255, 255, 0.08)',
                  background: isActive ? 'rgba(139, 92, 246, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                  color: isActive ? '#DDD6FE' : '#94A3B8',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Statistical Significance & Decision Engine */}
      <div style={{ background: 'rgba(0, 0, 0, 0.25)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#F1F5F9', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles size={14} color="#C4B5FD" />
            Statistical Significance
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '9999px',
              fontWeight: 700,
              background: stats?.isSignificant ? 'rgba(16, 185, 129, 0.2)' : 'rgba(139, 92, 246, 0.15)',
              color: stats?.isSignificant ? '#34D399' : '#C4B5FD',
              border: stats?.isSignificant ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(139, 92, 246, 0.3)'
            }}
          >
            {stats ? `${stats.confidence}% Confidence` : 'Confidence Unavailable'}
          </span>
        </div>

        <div style={{ fontSize: '12px', color: '#94A3B8', lineHeight: '1.5', marginBottom: '14px' }}>
          {!test.ran ? (
            test.reason === 'too_few_visits'
              ? `Too few visits in each branch to test yet. The test runs once both branches have ${MIN_SPLIT_BRANCH_SAMPLE} visitors.`
              : test.reason === 'nothing_to_compare'
              ? (convA ?? 0) + (convB ?? 0) === 0
                ? 'Neither branch has a conversion yet, so there is nothing to compare.'
                : 'Every visitor in both branches converted, so there is nothing to compare.'
              : 'Numbers for this split are unavailable.'
          ) : test.isSignificant ? (
            <span style={{ color: '#34D399', fontWeight: 600 }}>
              ✓ Statistically Significant Result (p &lt; 0.05). You have sufficient sample certainty to declare a winner.
            </span>
          ) : (
            `Currently trending at ${test.confidence}% confidence (Z: ${test.zScore}). Let the test run to reach 95%+ confidence.`
          )}
        </div>

        {/* 1-Click Winner Resolution */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div id={fid('winner')} style={{ fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Declare Winner (Route 100% Traffic)
          </div>

          {/* One name per button whatever its state: aria-pressed says whether that branch won. */}
          <div role="group" aria-labelledby={fid('winner')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button
              type="button"
              aria-label="Lock Branch A"
              aria-pressed={data.winner === 'a'}
              onClick={() => handleDeclareWinner('a')}
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                background: data.winner === 'a' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(139, 92, 246, 0.15)',
                border: data.winner === 'a' ? '1px solid #10B981' : '1px solid rgba(139, 92, 246, 0.35)',
                color: data.winner === 'a' ? '#34D399' : '#C4B5FD',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <Trophy size={13} />
              {data.winner === 'a' ? 'Winner: Branch A' : 'Lock Branch A'}
            </button>

            <button
              type="button"
              aria-label="Lock Branch B"
              aria-pressed={data.winner === 'b'}
              onClick={() => handleDeclareWinner('b')}
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                background: data.winner === 'b' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(236, 72, 153, 0.15)',
                border: data.winner === 'b' ? '1px solid #10B981' : '1px solid rgba(236, 72, 153, 0.35)',
                color: data.winner === 'b' ? '#34D399' : '#F472B6',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <Trophy size={13} />
              {data.winner === 'b' ? 'Winner: Branch B' : 'Lock Branch B'}
            </button>
          </div>

          {data.winner && (
            <button
              type="button"
              onClick={handleResetSplit}
              style={{
                marginTop: '4px',
                padding: '7px 12px',
                borderRadius: '6px',
                background: 'transparent',
                border: '1px dashed rgba(255, 255, 255, 0.15)',
                color: '#94A3B8',
                fontSize: '11px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px'
              }}
            >
              <RotateCcw size={12} />
              Reset Winner & Resume 50/50 Split
            </button>
          )}
        </div>
      </div>

      {/* Branch Naming & Destination Configuration */}
      <div style={{ background: 'rgba(0, 0, 0, 0.25)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#F1F5F9', marginBottom: '12px' }}>
          Branch Details & Destination Slugs
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Branch A */}
          <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#8B5CF6' }} />
              <label htmlFor={fid('branch-a-name')} id={fid('branch-a')} style={{ fontSize: '12px', fontWeight: 700, color: '#DDD6FE' }}>Branch A (Control)</label>
            </div>
            <input
              id={fid('branch-a-name')}
              type="text"
              value={data.branchALabel || ''}
              onChange={e => onChange({ ...data, branchALabel: e.target.value })}
              placeholder="e.g. Standard Price ($49)"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#FFFFFF',
                fontSize: '12px',
                outline: 'none',
                marginBottom: '6px'
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span id={fid('branch-a-page')} style={{ fontSize: '11px', color: '#64748B' }}>Target Page:</span>
              <input
                type="text"
                aria-labelledby={`${fid('branch-a')} ${fid('branch-a-page')}`}
                value={data.branchAPageSlug || ''}
                onChange={e => onChange({ ...data, branchAPageSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '') })}
                placeholder="offer-control (or connect edge)"
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  borderRadius: '4px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#A78BFA',
                  fontSize: '11px',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          {/* Branch B */}
          <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(236, 72, 153, 0.08)', border: '1px solid rgba(236, 72, 153, 0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#EC4899' }} />
              <label htmlFor={fid('branch-b-name')} id={fid('branch-b')} style={{ fontSize: '12px', fontWeight: 700, color: '#FBCFE8' }}>Branch B (Challenger)</label>
            </div>
            <input
              id={fid('branch-b-name')}
              type="text"
              value={data.branchBLabel || ''}
              onChange={e => onChange({ ...data, branchBLabel: e.target.value })}
              placeholder="e.g. Discounted Bundle ($39)"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#FFFFFF',
                fontSize: '12px',
                outline: 'none',
                marginBottom: '6px'
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span id={fid('branch-b-page')} style={{ fontSize: '11px', color: '#64748B' }}>Target Page:</span>
              <input
                type="text"
                aria-labelledby={`${fid('branch-b')} ${fid('branch-b-page')}`}
                value={data.branchBPageSlug || ''}
                onChange={e => onChange({ ...data, branchBPageSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '') })}
                placeholder="offer-discount (or connect edge)"
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  borderRadius: '4px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#F472B6',
                  fontSize: '11px',
                  outline: 'none'
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
