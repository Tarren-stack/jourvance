import React from 'react';
import { X, TrendingUp, AlertTriangle, CheckCircle2, ArrowRight, Sparkles, DollarSign, Activity, Trash2 } from 'lucide-react';
import type { JourneyEdge, JourneyNode } from '../../types/journey';
import { calculateRevenueLeakage, getStepOptimizationTips } from '../../lib/conversionBenchmarks';
import {
  countText,
  figureForEdge,
  leakAov,
  moneyText,
  nodeMeasure,
  percentText,
  rangeText,
  retentionDelaySentence,
  edgeUnavailableReason,
  type MetricsView
} from '../../lib/journeyMetrics';
import { describeEdge, stepShortName } from '../../lib/stepNames';
import { lineKindOf } from '../../lib/stepNavigation';

interface Props {
  edge: JourneyEdge | null;
  sourceNode: JourneyNode | null;
  targetNode: JourneyNode | null;
  onClose: () => void;
  onSelectNode?: (nodeId: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  /** The map's stats snapshot (#9). Without one every figure reads Unavailable. */
  metrics?: MetricsView;
  /** The heading, which the docked panel focuses when it moves focus into the line panel (#7). */
  headingRef?: React.Ref<HTMLHeadingElement>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** describeEdge's closing words when it was given no counts. */
const NO_VISITS_TAIL = ' No visits measured yet.';

/** The label and caption of the grid's two tiles for the people who did not take this line. */
interface RestTiles { count: [string, string]; rate: [string, string] }

const DROP_OFF_TILES: RestTiles = {
  count: ['Did not go on', 'did not reach the next step'],
  rate: ['Drop-off rate', 'of the people who started here']
};

/** Lines whose other people went somewhere else on the map rather than dropping off. */
const REST_TILES: Record<string, RestTiles> = {
  'split-share': {
    count: ['Other branch', 'went down the other branch'],
    rate: ['Other branch share', 'of the people split here']
  },
  decline: {
    count: ['Did not decline', 'took the offer or left'],
    rate: ['Share that did not decline', 'of those who saw it']
  },
  take: {
    count: ['Did not take it', 'declined or left'],
    rate: ['Share that did not take it', 'of those who saw it']
  }
};

export const EdgeInspector: React.FC<Props> = ({
  edge,
  sourceNode,
  targetNode,
  onClose,
  onSelectNode,
  onDeleteEdge,
  metrics,
  headingRef
}) => {
  if (!edge) return null;

  const sourceType = sourceNode?.data?.type;
  const targetType = targetNode?.data?.type;

  // A step's own label, else its name as its card reads. Never its node id.
  const sourceLabel = sourceNode ? sourceNode.data?.label || stepShortName(sourceNode) : 'Step not found';
  const targetLabel = targetNode ? targetNode.data?.label || stepShortName(targetNode) : 'Step not found';

  // The same figure the line's pill shows, read from the one stats snapshot (#9).
  const view = metrics ?? null;
  const figure = figureForEdge(edge, sourceNode, targetNode, view);
  const { def, status, count, denominator, rate, basis } = figure;
  const range = rangeText(view);
  const isCount = def.id === 'ad-visits' || def.id === 'retention';
  const headline = isCount
    ? countText(count)
    : basis === 'Estimated' && rate !== null
    ? `Est. ${percentText(rate)}`
    : percentText(rate);
  const basisChip = basis ? `${basis}, ${range}` : 'Unavailable';

  const wentOff = count !== null && denominator !== null ? Math.max(0, denominator - count) : null;
  const dropRate = rate !== null ? round1(100 - rate) : null;
  // The people who did not take this line are drop-off only where no other line carries them. A
  // split's other branch is the split working as set, and an offer's other people took the other
  // answer or left, so those lines name what the figure is and are never shown as a heavy drop.
  const rest = REST_TILES[def.id] ?? DROP_OFF_TILES;
  const heavyDrop = rest === DROP_OFF_TILES && dropRate !== null && dropRate > 75;

  // Only a measured rate below the typical range gets a recover card, and it prices the gain with
  // the step's measured average order or its own price. There is no default order value.
  const snapshot = view?.status === 'ready' ? view.snapshot : null;
  const aov = leakAov(sourceNode ? nodeMeasure(snapshot, sourceNode.id) : null, sourceNode?.data);
  const leakage = status.status === 'needs_work' && def.bands && denominator !== null && rate !== null
    ? calculateRevenueLeakage(denominator, rate, def.bands.healthy, aov.value)
    : null;

  const tips = getStepOptimizationTips(sourceType, targetType);

  // The line in words for a screen reader, the same sentence its pill on the map points at. Counts
  // go in only when this line's own flow was measured. An estimate or a visit count is shown in the
  // panel, but "N of M went on" would claim the same people moved, and "No visits measured yet"
  // would be untrue, so those lines are named without the closing sentence.
  const flowMeasured = basis === 'Measured' && !isCount && count !== null && denominator !== null;
  const lineSentence = describeEdge({
    kind: lineKindOf(edge, targetNode),
    from: sourceNode ? stepShortName(sourceNode) : 'a step that is gone',
    to: targetNode ? stepShortName(targetNode) : 'a step that is gone',
    visitors: flowMeasured ? denominator : null,
    reached: flowMeasured ? count : null
  });
  const lineInWords = basis && !flowMeasured && lineSentence.endsWith(NO_VISITS_TAIL)
    ? lineSentence.slice(0, -NO_VISITS_TAIL.length)
    : lineSentence;

  return (
    // A panel inside the docked step panel (StepDock), beside the map rather than over it. The dock
    // puts it on the dialog stack, so this is a named region and not a second dialog (#19).
    <div
      role="region"
      aria-labelledby="jv-edge-inspector-title"
      aria-describedby="jv-edge-inspector-desc"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)'
      }}
    >
      {/* Drawer Header */}
      <div
        style={{
          padding: '18px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255, 255, 255, 0.02)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: status.bg,
              border: `1px solid ${status.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: status.color
            }}
          >
            <TrendingUp size={16} />
          </div>
          <div>
            <h3 ref={headingRef} tabIndex={-1}
              id="jv-edge-inspector-title"
              data-dialog-start
              style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.01em' }}
            >
              Step Transition Analytics
            </h3>
            {/* Never drawn: aria-describedby still reads text from a hidden element. */}
            <span id="jv-edge-inspector-desc" hidden>
              {lineInWords}
            </span>
            <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sourceLabel}</span>
              <ArrowRight size={10} color="#64748B" />
              <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{targetLabel}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close line panel"
          style={{
            background: 'none',
            border: 'none',
            color: '#94A3B8',
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.15s'
          }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <X size={18} />
        </button>
      </div>

      {/* Drawer Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {/* Step Metric Highlight Card */}
        <div
          data-edge-inspector-metric={def.id}
          style={{
            padding: '16px',
            borderRadius: '12px',
            background: status.bg,
            border: `1px solid ${status.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
            <div>
              <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: status.color }}>
                {def.name}
              </span>
              <div data-metric style={{ fontSize: headline === 'Unavailable' ? '20px' : '26px', fontWeight: 800, color: headline === 'Unavailable' ? '#CBD5E1' : '#FFFFFF', marginTop: '2px' }}>
                {headline}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
              <span
                data-basis-chip
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '3px 9px',
                  borderRadius: '9999px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  color: '#CBD5E1',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  whiteSpace: 'nowrap'
                }}
              >
                {basisChip}
              </span>
              {status.status !== 'unavailable' && (
                <span
                  data-grade={status.status}
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: '9999px',
                    background: 'rgba(0, 0, 0, 0.3)',
                    color: status.color,
                    border: `1px solid ${status.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  {status.status === 'top_performer' ? (
                    <CheckCircle2 size={12} aria-hidden="true" />
                  ) : status.status === 'needs_work' ? (
                    <AlertTriangle size={12} aria-hidden="true" />
                  ) : (
                    <Activity size={12} aria-hidden="true" />
                  )}
                  <span>{status.label}</span>
                </span>
              )}
            </div>
          </div>

          {!basis && (
            <div style={{ fontSize: '12px', color: '#CBD5E1', lineHeight: '1.4' }}>
              {edgeUnavailableReason(view, figure)}
            </div>
          )}
          {def.benchmarkDesc && (
            <div style={{ fontSize: '11px', color: '#CBD5E1', lineHeight: '1.4' }}>
              {def.benchmarkDesc}
            </div>
          )}
          {basis === 'Estimated' && (
            <div style={{ fontSize: '11px', color: '#CBD5E1', lineHeight: '1.4' }}>
              Estimated from each step's total. These totals do not show that the same people moved between these steps.
            </div>
          )}
          {figure.delayText && (
            <div style={{ fontSize: '12px', color: '#FDE68A', lineHeight: '1.4' }}>
              {retentionDelaySentence(targetNode?.data)}
            </div>
          )}
        </div>

        {/* Throughput & Drop-Off 2x2 Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
          {([
            ['Started here', countText(denominator), `at ${sourceLabel}`, '#F1F5F9', false],
            ['Went on', countText(count), `reached ${targetLabel}`, '#34D399', false],
            [rest.count[0], countText(wentOff), rest.count[1], heavyDrop ? '#FBBF24' : '#F1F5F9', heavyDrop],
            [rest.rate[0], percentText(dropRate), rest.rate[1], heavyDrop ? '#FBBF24' : '#F1F5F9', heavyDrop]
          ] as const).map(([label, value, caption, color, warn]) => (
            <div
              key={label}
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                minWidth: 0,
                backgroundColor: warn ? 'rgba(245, 158, 11, 0.06)' : 'rgba(255, 255, 255, 0.03)',
                border: warn ? '1px solid rgba(245, 158, 11, 0.25)' : '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div style={{ fontSize: '11px', color: '#94A3B8' }}>{label}</div>
              <div data-metric style={{ fontSize: value === 'Unavailable' ? '15px' : '18px', fontWeight: 800, color: value === 'Unavailable' ? '#CBD5E1' : color, marginTop: '4px' }}>
                {value}
              </div>
              <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {caption}
              </div>
            </div>
          ))}
        </div>

        {/* Recover card: only for a measured rate below the typical range */}
        {leakage && def.bands && (
          <div
            data-recover-card
            style={{
              padding: '14px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(15, 23, 42, 0.6))',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <DollarSign size={14} color="#34D399" aria-hidden="true" />
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#34D399', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                What a typical rate would add
              </span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#CBD5E1', marginLeft: 'auto' }}>Estimated</span>
            </div>
            <div style={{ fontSize: '12px', color: '#E2E8F0', lineHeight: '1.5' }}>
              Reaching a typical rate of {percentText(def.bands.healthy)} would have added about {countText(leakage.potentialRecoveredConversions)} conversions {range.startsWith('since') ? range : `in the ${range}`}.
              {aov.value !== null && leakage.potentialRevenueGain !== null && (
                <>
                  {' '}At {aov.basis === 'Measured' ? `a ${moneyText(aov.value, 2)} average order (measured)` : `${moneyText(aov.value, 2)} (the price on this step)`}, that is about {moneyText(leakage.potentialRevenueGain)}.
                </>
              )}
            </div>
          </div>
        )}

        {/* Optimization Playbook */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#F472B6', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Sparkles size={12} aria-hidden="true" /> Actionable Optimization Playbook
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {tips.map((tip, idx) => (
              <div
                key={idx}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#F1F5F9' }}>{tip.title}</span>
                  <span style={{ fontSize: '11px', fontWeight: 800, padding: '1px 6px', borderRadius: '4px', background: 'rgba(236, 72, 153, 0.15)', color: '#F472B6' }}>
                    {tip.badge}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: '1.4' }}>
                  {tip.description}
                </div>
                {tip.actionText && sourceNode && onSelectNode && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSelectNode(sourceNode.id);
                    }}
                    style={{
                      alignSelf: 'flex-start',
                      marginTop: '4px',
                      background: 'none',
                      border: 'none',
                      color: '#38BDF8',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: 0
                    }}
                  >
                    <span>{tip.actionText}</span>
                    <ArrowRight size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Delete Edge Action */}
        {onDeleteEdge && (
          <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
            <button
              type="button"
              onClick={() => {
                if (confirm('Disconnect this step in your customer journey?')) {
                  onDeleteEdge(edge.id);
                  onClose();
                }
              }}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                background: 'rgba(239, 68, 68, 0.06)',
                color: '#F87171',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <Trash2 size={13} />
              <span>Disconnect Step Connection</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
