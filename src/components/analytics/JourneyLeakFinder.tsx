import React, { useEffect, useMemo, useState } from 'react';
import type { JourneyNode, JourneyEdge } from '../../types/journey';
import { authHeaders } from '../../lib/firebase';
import {
  buildJourneyFunnel,
  funnelStats,
  funnelStatsRequest,
  leakSummary,
  readFunnelAnswer,
  timeframeDays,
  unavailableReason,
  type FunnelAnswer,
  type FunnelStats,
  type FunnelTimeframe
} from '../../lib/leakFinder';
import { rangeLabel, shortDate } from '../../lib/journeyMetrics';

interface Props {
  journeyId: string;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  timeframe: FunnelTimeframe;
  /** Selects the step and returns to the map. */
  onSelectStep?: (nodeId: string) => void;
}

const LEAK = '#F59E0B';

const lineStyle: React.CSSProperties = { fontSize: '13px', color: '#CBD5E1', margin: 0, lineHeight: 1.5 };

/**
 * Where this journey loses people: its own steps in path order, each with its measured count,
 * and the biggest measured drop called out with a way back to that step on the map.
 */
export const JourneyLeakFinder: React.FC<Props> = ({ journeyId, nodes, edges, timeframe, onSelectStep }) => {
  const [answer, setAnswer] = useState<FunnelAnswer | null>(null);
  const [retry, setRetry] = useState(0);

  // Moving a card replaces the nodes array, so the request keys on the journey's shape, not on
  // the arrays themselves.
  const shapeKey = useMemo(() => JSON.stringify([
    nodes.map(n => {
      const d = n.data as Record<string, unknown>;
      return [n.id, n.type, d.slug, d.utmCampaign, d.offerType, d.jourvanceFlowId];
    }),
    edges.map(e => [e.id, e.source, e.target, e.sourceHandle, Boolean(e.data?.isRetentionEdge)])
  ]), [nodes, edges]);

  useEffect(() => {
    let cancelled = false;
    setAnswer(null);
    // Without a journey the server would count every journey this account owns.
    if (!journeyId) {
      setAnswer({ kind: 'failed', message: 'Unavailable. Open a journey to see its steps.', retryable: false });
      return;
    }
    (async () => {
      let reply: { status: number; body: unknown } | null = null;
      try {
        const res = await fetch('/api/funnel/stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify(funnelStatsRequest(journeyId, nodes, edges, timeframe))
        });
        reply = { status: res.status, body: await res.json().catch(() => null) };
      } catch {
        reply = null;
      }
      if (!cancelled) setAnswer(readFunnelAnswer(reply, journeyId, timeframeDays(timeframe)));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyId, timeframe, shapeKey, retry]);

  const snapshot = answer?.kind === 'ok' ? answer.snapshot : null;
  const stats: FunnelStats | null = useMemo(() => (snapshot ? funnelStats(nodes, edges, snapshot) : null), [nodes, edges, snapshot]);
  const funnel = useMemo(() => (stats ? buildJourneyFunnel(nodes, edges, stats) : null), [nodes, edges, stats]);
  const summary = funnel && funnel.hasData ? leakSummary(funnel.rows, funnel.leakIndex) : null;
  const maxCount = funnel ? Math.max(0, ...funnel.rows.map(r => r.count ?? 0)) : 0;

  let body: React.ReactNode;
  if (!answer) {
    body = <p style={lineStyle}>Loading this journey's steps...</p>;
  } else if (answer.kind !== 'ok') {
    body = (
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <p style={lineStyle}>{answer.message}</p>
        {answer.kind === 'failed' && answer.retryable && (
          <button
            type="button"
            onClick={() => setRetry(r => r + 1)}
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#E0E7FF',
              backgroundColor: 'rgba(99, 102, 241, 0.18)',
              border: '1px solid rgba(129, 140, 248, 0.45)',
              borderRadius: '8px',
              padding: '6px 12px',
              cursor: 'pointer'
            }}
          >
            Try again
          </button>
        )}
      </div>
    );
  } else if (!funnel || funnel.rows.length === 0) {
    body = <p style={lineStyle}>This journey has no steps yet.</p>;
  } else if (!funnel.hasData) {
    body = <p style={lineStyle}>No visits measured for this journey in this range yet.</p>;
  } else {
    body = (
      <>
        <ol aria-label="Steps in this journey" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {funnel.rows.map((row, i) => {
            const isLeak = i === funnel.leakIndex;
            const width = row.count !== null && row.count > 0 && maxCount > 0 ? Math.max(3, (row.count / maxCount) * 100) : 0;
            return (
              <li
                key={row.nodeId}
                data-step-id={row.nodeId}
                data-leak={isLeak ? 'true' : undefined}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  paddingLeft: isLeak ? '10px' : '0px',
                  borderLeft: isLeak ? `3px solid ${LEAK}` : '3px solid transparent'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                    <span style={{ fontSize: '13px', color: '#F8FAFC', fontWeight: 600, overflowWrap: 'anywhere' }}>{row.label}</span>
                    <span style={{ fontSize: '11px', color: '#94A3B8' }}>{row.kindLabel}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', textAlign: 'right', flexShrink: 0, maxWidth: '55%' }}>
                    {row.count !== null ? (
                      <span style={{ fontSize: '13px', color: '#F8FAFC', fontWeight: 700 }}>
                        {row.count.toLocaleString('en-US')} <span style={{ fontWeight: 500, color: '#CBD5E1' }}>{row.unit}</span>
                      </span>
                    ) : (
                      <>
                        <span style={{ fontSize: '13px', color: '#94A3B8', fontWeight: 600 }}>Unavailable</span>
                        <span style={{ fontSize: '11px', color: '#94A3B8' }}>{unavailableReason(row.why)}</span>
                      </>
                    )}
                  </div>
                </div>
                {row.count !== null && (
                  <div aria-hidden="true" style={{ height: '6px', backgroundColor: 'rgba(255, 255, 255, 0.06)', borderRadius: '9999px' }}>
                    {width > 0 && (
                      <div
                        data-bar-fill=""
                        style={{ height: '100%', width: `${width}%`, backgroundColor: isLeak ? LEAK : '#6366F1', borderRadius: '9999px' }}
                      />
                    )}
                  </div>
                )}
                {(row.conversion !== null && row.conversion <= 1) || (row.drop !== null && row.drop > 0) ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    {row.conversion !== null && row.conversion <= 1 ? (
                      <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                        {`${Math.round(row.conversion * 100)}% of ${row.fromLabel}`}
                      </span>
                    ) : <span />}
                    {row.drop !== null && row.drop > 0 && (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        borderRadius: '9999px',
                        padding: '2px 8px',
                        color: isLeak ? '#FBBF24' : '#94A3B8',
                        backgroundColor: isLeak ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.06)'
                      }}>
                        <span aria-hidden="true">▼</span> {Math.round(row.drop * 100)}% drop-off{isLeak ? ' · biggest leak' : ''}
                      </span>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        {summary && (
          <section
            aria-labelledby="jv-leak-meaning"
            style={{
              borderRadius: '10px',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              backgroundColor: 'rgba(245, 158, 11, 0.06)',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              alignItems: 'flex-start'
            }}
          >
            <h4 id="jv-leak-meaning" style={{ fontSize: '13px', fontWeight: 700, color: '#FBBF24', margin: 0 }}>What this means</h4>
            <p style={{ ...lineStyle, color: '#E2E8F0' }}>{summary.sentence}</p>
            {summary.nodeId && onSelectStep && (
              <button
                type="button"
                onClick={() => onSelectStep(summary.nodeId!)}
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#0B0F19',
                  backgroundColor: '#FBBF24',
                  border: '1px solid #FBBF24',
                  borderRadius: '8px',
                  padding: '8px 14px',
                  cursor: 'pointer'
                }}
              >
                {summary.buttonLabel}
              </button>
            )}
          </section>
        )}
      </>
    );
  }

  return (
    <div
      data-leak-finder=""
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        minWidth: 0
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: '#F8FAFC' }}>Where this journey loses people</h3>
        <span style={{ fontSize: '12px', color: '#94A3B8' }}>
          {snapshot?.partialSince
            ? `Since ${shortDate(snapshot.partialSince)}, older visits were not kept`
            : rangeLabel(timeframeDays(timeframe))} · this journey's own steps
        </span>
      </div>
      {body}
    </div>
  );
};
