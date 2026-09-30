import React, { useEffect, useState } from 'react';
import type { JourneyNode } from '../../types/journey';
import {
  previewExpiryText,
  publishStateDetail,
  publishStateLabel,
  stepPublishState,
  type StepPublishState
} from '../../lib/publishState';
import type { PreviewOutcome } from '../../lib/usePublication';
import { publishTone, revisionOf, usePublishStatus } from '../canvas/PublishStatus';

/**
 * The "Publish status" section at the top of the inspector: what is live for this step, read from
 * the server, plus a one-hour preview link for landing and upsell pages. The preview shows the
 * copy SAVED to the account, so asking for one saves first.
 */

interface Props {
  node: JourneyNode;
  /** Saves, then asks the server for a preview link. Absent: no preview button. */
  onPreview?: (nodeId: string) => Promise<PreviewOutcome>;
}

const PREVIEWABLE = new Set(['landing-page', 'upsell']);

const buttonStyle: React.CSSProperties = {
  minHeight: '32px',
  padding: '6px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'rgba(255, 255, 255, 0.06)',
  color: '#F1F5F9',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer'
};

const linkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '32px',
  color: '#7DD3FC',
  fontSize: '13px',
  fontWeight: 600,
  textDecoration: 'underline',
  textUnderlineOffset: '2px'
};

export const StepPublishPanel: React.FC<Props> = ({ node, onPreview }) => {
  const { states, read, refresh } = usePublishStatus();
  const state: StepPublishState = states.get(node.id) ?? stepPublishState(node, [], read) ?? { kind: 'checking' };
  const tone = publishTone(state);
  const revision = revisionOf(state);
  const unavailable = state.kind === 'unknown' && state.reason === 'unavailable';
  // The read's own sentence says why (offline, sign-in expired); the generic one is the fallback.
  const detail = unavailable && read?.kind === 'unavailable' ? read.message : publishStateDetail(state, node.type);

  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PreviewOutcome | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Recount the minutes as they pass, and flip to the expired sentence at expiry without a reload.
  const expiresAt = outcome?.kind === 'ready' ? outcome.expiresAt : '';
  useEffect(() => {
    if (!expiresAt) return;
    const left = Date.parse(expiresAt) - nowMs;
    if (!(left > 0)) return;
    const toNextMinute = left % 60_000 || 60_000;
    const t = window.setTimeout(() => setNowMs(Date.now()), Math.min(left, toNextMinute) + 50);
    return () => window.clearTimeout(t);
  }, [expiresAt, nowMs]);
  const expired = !!expiresAt && !(Date.parse(expiresAt) > nowMs);

  const ask = async () => {
    if (busy || !onPreview) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await onPreview(node.id);
      setNowMs(Date.now());
      setOutcome(result);
    } finally {
      setBusy(false);
    }
  };

  const d = (node.data || {}) as Record<string, unknown>;
  const hasVariantB = Boolean(d.abTestingEnabled && d.variantB);
  const showPreview = PREVIEWABLE.has(String(node.type)) && !!onPreview;
  const previewLabel = busy
    ? 'Saving, then making a preview link'
    : expired ? 'Make a new preview' : 'Preview changes';

  return (
    <section
      aria-label="Publish status"
      style={{
        marginBottom: '20px',
        padding: '14px 16px',
        borderRadius: '12px',
        background: 'rgba(15, 23, 42, 0.6)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderTop: tone.dashed ? '1px dashed rgba(148, 163, 184, 0.45)' : `3px solid ${tone.color}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minWidth: 0
      }}
    >
      <p role="status" style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: tone.color }}>
        {publishStateLabel(state)}
        {revision !== null && <span style={{ color: '#94A3B8', fontWeight: 500 }}> · Rev {revision}</span>}
      </p>
      <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: '#CBD5E1' }}>{detail}</p>

      {(unavailable || showPreview) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '2px' }}>
          {unavailable && (
            <button type="button" onClick={refresh} style={buttonStyle}>
              Check again
            </button>
          )}
          {showPreview && (
            <button
              type="button"
              onClick={ask}
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              style={{ ...buttonStyle, cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.75 : 1 }}
            >
              {previewLabel}
            </button>
          )}
        </div>
      )}

      {outcome?.kind === 'ready' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {!expired && (
            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '16px' }}>
              {hasVariantB ? (
                <>
                  <a href={outcome.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    Open version A (opens in a new tab)
                  </a>
                  <a href={`${outcome.url}?variant=b`} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    Open version B (opens in a new tab)
                  </a>
                </>
              ) : (
                <a href={outcome.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                  Open preview (opens in a new tab)
                </a>
              )}
            </div>
          )}
          <p style={{ margin: 0, fontSize: '12px', color: '#94A3B8' }}>{previewExpiryText(outcome.expiresAt, nowMs)}</p>
        </div>
      )}

      {outcome?.kind === 'refused' && (
        <p role="alert" style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: '#FCA5A5' }}>
          {outcome.message}
        </p>
      )}
    </section>
  );
};
