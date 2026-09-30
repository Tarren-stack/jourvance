// What a line on the journey map means, decided in one place (Aura's edge palette).
// The line's colour and dash say which branch a visitor took; the pill on the line says how well
// that step converts. The dash differs as well as the colour, so "declined" (red, dashed) and
// "retention" (amber, dotted) stay apart for readers who cannot tell red from amber.
// Every colour is at least 4.5:1 against the canvas background (#0B0F19).

export type EdgeKind = 'main' | 'accepted' | 'declined' | 'retention' | 'split-a' | 'split-b';

export interface EdgeKindStyle {
  label: string;
  color: string;
  dash?: string;
  round?: boolean;
}

export const EDGE_KINDS: Record<EdgeKind, EdgeKindStyle> = {
  main: { label: 'Next step', color: '#818CF8' },
  accepted: { label: 'Accepted', color: '#34D399' },
  declined: { label: 'Declined or left', color: '#F87171', dash: '8 5' },
  retention: { label: 'Retention flow', color: '#FBBF24', dash: '1 5', round: true },
  'split-a': { label: 'Split A', color: '#8B5CF6' },
  'split-b': { label: 'Split B', color: '#EC4899' }
};

export const EDGE_KIND_ORDER: EdgeKind[] = ['main', 'accepted', 'declined', 'retention', 'split-a', 'split-b'];

export const EDGE_WIDTH = 2.2;
export const EDGE_WIDTH_SELECTED = 3.5;

const RETENTION_SEQUENCES = new Set(['upsell_recovery', 'checkout_recovery', 'at_risk_winback']);

/** A step that only exists to win back someone who said no or left. */
export function isRetentionStep(data: unknown): boolean {
  const d = data as { isRetentionBranch?: unknown; sequenceType?: unknown } | null | undefined;
  return Boolean(d?.isRetentionBranch || RETENTION_SEQUENCES.has(String(d?.sequenceType)));
}

/** A line into or out of a retention or rescue flow. The label pill reads this. */
export function isRetentionLink(
  sourceHandle: string | null | undefined,
  targetData: unknown,
  sourceData?: unknown
): boolean {
  return (
    sourceHandle === 'declined' ||
    sourceHandle === 'rescue' ||
    sourceHandle === 'abandon' ||
    isRetentionStep(targetData) ||
    isRetentionStep(sourceData)
  );
}

/** The wait happens before a follow-up sends, so only the line into one can show it. */
export function lineShowsDelay(isRetention: boolean, targetType: unknown): boolean {
  return isRetention && targetType === 'follow-up-sequence';
}

/**
 * The hub's generic edge stat divides the next step's count by flow enrolments. That is not a
 * click or a rescue rate, so a line out of a sequence shows no rate until it has a real measure (#9).
 */
export function lineRateMeasured(sourceType: unknown): boolean {
  return sourceType !== 'follow-up-sequence';
}

/**
 * The branch a line carries. The source handle decides first, because it is what the visitor
 * did (accepted, declined, left, split A or B); a plain handle leading into a retention step is
 * a retention flow; anything else is the main path.
 */
export function edgeKind(
  sourceHandle: string | null | undefined,
  targetData?: unknown,
  isRetentionEdge?: boolean
): EdgeKind {
  if (sourceHandle === 'accepted') return 'accepted';
  if (sourceHandle === 'declined' || sourceHandle === 'abandon') return 'declined';
  if (sourceHandle === 'branch-a') return 'split-a';
  if (sourceHandle === 'branch-b') return 'split-b';
  if (sourceHandle === 'rescue' || isRetentionEdge || isRetentionStep(targetData)) return 'retention';
  return 'main';
}

/** Inline style for a branch handle, so the dot matches the line that leaves it. */
export function branchHandleStyle(kind: EdgeKind): { background: string; borderColor: string } {
  return { background: EDGE_KINDS[kind].color, borderColor: '#0F172A' };
}
