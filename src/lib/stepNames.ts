// What a screen reader hears for a step or a line on the journey map, decided in one place.
// A step is named the way its card reads (its kind, its address or title, and its status), never
// by its node id and never with traffic numbers. A line is one sentence in words instead of React
// Flow's "Edge from node-ad-1 to node-page-1". Later work that names a step or a line (issue rows,
// the leak finder, the walkthrough) calls these rather than building names again.
// Pure: no React, no DOM. stepNavigation.ts re-exports stepSpokenName and STEP_ARIA_LABELS, so the
// finder, the dock and the map share one naming rule.
// Type imports are separate `import type` lines on purpose: Node keeps an inline `{ type X }`
// specifier as a side-effect import and fails on an extensionless path.

import { EDGE_KINDS } from './edgeKinds.ts';
import type { EdgeKind } from './edgeKinds.ts';
import { PUBLISHABLE_STEP_TYPES, publishStateLabel } from './publishState.ts';
import type { StepPublishState } from './publishState.ts';
import type { JourneyNodeData } from '../types/journey';
import type { AriaLabelConfig } from '@xyflow/react';

/** A step, or a step's data. Either reads the same, so callers holding a node need not unwrap it. */
export type StepOrData = { data?: unknown } | JourneyNodeData | Record<string, unknown> | null | undefined;

type LooseStepData = {
  type?: unknown;
  platform?: unknown;
  slug?: unknown;
  offerType?: unknown;
  formTitle?: unknown;
  sequenceTitle?: unknown;
  sequenceType?: unknown;
  isRetentionBranch?: unknown;
  utmCampaign?: unknown;
  abTestingEnabled?: unknown;
  fields?: unknown;
  steps?: unknown;
  splitRatio?: unknown;
  winner?: unknown;
};

function dataOf(step: StepOrData): LooseStepData {
  if (!step || typeof step !== 'object') return {};
  const inner = (step as { data?: unknown }).data;
  if (inner && typeof inner === 'object') return inner as LooseStepData;
  return step as LooseStepData;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A page address as the card shows it: one leading slash, or empty when there is none. */
function address(slug: unknown): string {
  const s = text(slug).replace(/^\/+/, '');
  return s ? `/${s}` : '';
}

const AD_NAMES: Record<string, string> = {
  meta: 'Meta ad',
  google: 'Google search ad',
  tiktok: 'TikTok ad',
  organic: 'Organic traffic'
};

const SEQUENCE_NAMES: Record<string, string> = {
  upsell_recovery: 'Courtesy rescue sequence',
  checkout_recovery: 'Cart recovery sequence',
  at_risk_winback: 'Winback sequence',
  fulfillment_review: 'Review request sequence',
  lead_nurture: 'Nurture sequence'
};

function sequenceKind(d: LooseStepData): string {
  const t = d.sequenceType;
  if (t === undefined || t === null || t === '') return d.isRetentionBranch ? 'Retention sequence' : 'Nurture sequence';
  return SEQUENCE_NAMES[String(t)] ?? 'Follow-up sequence';
}

// The kinds stepShortName writes as "Kind: title". nameInSentence reads the name back by these.
const TITLED_KINDS = [...new Set(['Lead form', 'Retention sequence', 'Nurture sequence', 'Follow-up sequence', ...Object.values(SEQUENCE_NAMES)])];

/** Ends a sentence with a full stop unless it already ends in its own (a name like "Where should we reach you?"). */
export function endSentence(s: string): string {
  return /[.?!…]['"’”)\]]*$/.test(s) ? s : `${s}.`;
}

/**
 * A step's name as it sits inside a sentence (T09). A form or sequence title is often a question
 * ("Lead form: Where should we reach you?"), which read "you?." before a full stop and "you?,"
 * before a clause, so a titled step is its kind with the title in quotes: Lead form "Where should
 * we reach you?". Any other name that ends in its own punctuation is quoted whole. Every other
 * name comes back unchanged. Pair it with endSentence when the name closes the sentence.
 */
export function nameInSentence(name: string): string {
  for (const kind of TITLED_KINDS) {
    const prefix = `${kind}: `;
    if (name.startsWith(prefix) && name.length > prefix.length) return `${kind} "${name.slice(prefix.length)}"`;
  }
  return /[.?!…]$/.test(name) ? `"${name}"` : name;
}

/** The kind followed by an address, or ', no address yet' when the step has none. */
function addressed(kind: string, where: string): string {
  return where ? `${kind} ${where}` : `${kind}, no address yet`;
}

/**
 * The address a step's card shows ("/vip-consultation", "/glow/upsell"), or '' when the step has
 * no saved address or is not a page. The card, its spoken name and the step panel all read it here
 * (T11), so a card never shows a default path such as "/upsell" while its name says "no address yet".
 */
export function stepAddress(step: StepOrData): string {
  const d = dataOf(step);
  switch (d.type) {
    case 'landing-page':
    case 'thank-you':
    case 'ab-split':
      return address(d.slug);
    case 'upsell': {
      const where = address(d.slug);
      return where ? `${where}/${d.offerType === 'downsell' ? 'downsell' : 'upsell'}` : '';
    }
    default:
      return '';
  }
}

/** The step's name as its card reads, with no status: "Landing page /vip-consultation". */
export function stepShortName(step: StepOrData): string {
  const d = dataOf(step);
  switch (d.type) {
    case 'ad-source':
      return AD_NAMES[String(d.platform)] ?? 'Traffic source';
    case 'landing-page':
      return addressed('Landing page', stepAddress(step));
    case 'thank-you':
      return addressed('Thank-you page', stepAddress(step));
    case 'upsell':
      return addressed(d.offerType === 'downsell' ? 'Downsell' : 'Upsell', stepAddress(step));
    case 'ab-split':
      return addressed('A/B split', stepAddress(step));
    case 'lead-form': {
      const title = text(d.formTitle);
      return title ? `Lead form: ${title}` : 'Lead form';
    }
    case 'follow-up-sequence': {
      const title = text(d.sequenceTitle);
      const kind = sequenceKind(d);
      return title ? `${kind}: ${title}` : kind;
    }
    default:
      return 'Step';
  }
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The share the card shows for branch A: a number clamped to 0 to 100, or 50. */
function splitShareA(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;
}

/**
 * The publish status in the card's own words, lower-cased to sit mid-name ("status unavailable",
 * "unpublished changes"), or '' when the card shows none: a step that is never published, or no
 * status to hand. Never read from data.published, which is a flag the browser sets and not what is
 * live (U07): the card reads publishState, so the name reads the same state.
 */
function spokenPublishStatus(d: LooseStepData, publish: StepPublishState | null | undefined): string {
  if (!publish || !(PUBLISHABLE_STEP_TYPES as readonly unknown[]).includes(d.type)) return '';
  const label = publishStateLabel(publish);
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * The step's accessible name on the map: the short name plus its status, for example
 * "Landing page /vip-consultation, not published". No node id and no traffic numbers.
 *
 * `publish` is the status the card's strip shows for this step (usePublishStatus().states.get(id)),
 * so the card and its name always agree (U07). Without one the name carries no publish word, as a
 * card with no status shows none. A titled step is placed with nameInSentence, since a comma
 * always follows it: Lead form "Where should we reach you?", 4 fields, never "you?," (T09).
 */
export function stepSpokenName(step: StepOrData, publish?: StepPublishState | null): string {
  const d = dataOf(step);
  const name = stepShortName(step);
  const parts: string[] = [];
  const status = spokenPublishStatus(d, publish);
  if (status) parts.push(status);
  switch (d.type) {
    case 'ad-source': {
      const campaign = text(d.utmCampaign);
      if (campaign) parts.push(`campaign ${campaign}`);
      break;
    }
    case 'landing-page':
      if (d.abTestingEnabled === true) parts.push('A/B test on');
      break;
    case 'ab-split': {
      if (d.winner === 'a' || d.winner === 'b') {
        parts.push(`winner ${d.winner.toUpperCase()}`);
      } else {
        const a = splitShareA(d.splitRatio);
        parts.push(`${a}/${100 - a} split`);
      }
      break;
    }
    case 'lead-form': {
      const fields = Array.isArray(d.fields) ? d.fields : [];
      const enabled = fields.filter(f => Boolean((f as { enabled?: unknown } | null)?.enabled)).length;
      parts.push(count(enabled, 'field', 'fields'));
      break;
    }
    case 'follow-up-sequence': {
      const steps = Array.isArray(d.steps) ? d.steps.length : 0;
      parts.push(count(steps, 'message', 'messages'));
      break;
    }
  }
  return parts.length ? [nameInSentence(name), ...parts].join(', ') : name;
}

export interface EdgeDescriptionInput {
  kind: EdgeKind;
  /** stepShortName of the step the line leaves. */
  from: string;
  /** stepShortName of the step the line reaches. */
  to: string;
  /** Visitors measured at the step the line leaves. */
  visitors?: number | null;
  /** Of those, how many reached the next step. */
  reached?: number | null;
  /**
   * The figure the line's pill shows (#9). When given, the counts come from it and visitors and
   * reached are ignored, so the sentence never disagrees with what is drawn. Null means the map
   * has no figure for the line.
   */
  figure?: LineFigureLike | null;
}

/**
 * What describeEdge reads from a line's figure (journeyMetrics.EdgeFigure), written structurally so
 * this module stays free of the metrics code.
 */
export interface LineFigureLike {
  def: { id: string };
  /** 'Measured', 'Estimated', or null when a figure the line needs was not measured. */
  basis: string | null;
  count: number | null;
  denominator: number | null;
}

function finite(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/**
 * A line in words: "Accepted: from Upsell /glow/upsell to Thank-you page /thanks. 41 of 340 visitors
 * went on." A line with no measured visits says so rather than reading out a zero rate. from and
 * to are stepShortName strings; each is placed with nameInSentence, so a title that is a question
 * never reads "?." (T09).
 */
export function describeEdge(input: EdgeDescriptionInput): string {
  const { kind, from, to } = input;
  const label = (EDGE_KINDS[kind] ?? EDGE_KINDS.main).label;
  const head = endSentence(`${label}: from ${nameInSentence(from)} to ${nameInSentence(to)}`);
  let visitors = input.visitors;
  let reached = input.reached;
  if ('figure' in input) {
    // Counts only when the line's own flow was measured. An estimate or a visit count is shown on
    // the pill, but "N of M went on" would claim the same people moved and "No visits measured
    // yet" would be untrue, so those lines are named with no closing sentence.
    const f = input.figure;
    const counted = f?.def.id === 'ad-visits' || f?.def.id === 'retention';
    const flowMeasured = f?.basis === 'Measured' && !counted && f.count !== null && f.denominator !== null;
    if (f?.basis && !flowMeasured) return head;
    visitors = flowMeasured ? f.denominator : null;
    reached = flowMeasured ? f.count : null;
  }
  const v = finite(visitors);
  const r = finite(reached);
  const tail = v > 0 ? `${r.toLocaleString()} of ${v.toLocaleString()} visitors went on.` : 'No visits measured yet.';
  return `${head} ${tail}`;
}

// Names the panel by its label ("Step panel") and never by where it sits: it is beside the map
// from 768px up and under it below that (src/index.css), and this text is the same at every width.
const STEP_DESCRIPTION = 'Press Enter to open this step in the step panel. Backspace deletes the selected step.';

/**
 * React Flow's aria-describedby text for a step. Both keys carry it because React Flow 12.11.6
 * shows the keyboardDisabled text while keyboard access is on.
 */
export const STEP_ARIA_LABELS = {
  'node.a11yDescription.default': STEP_DESCRIPTION,
  'node.a11yDescription.keyboardDisabled': STEP_DESCRIPTION
} as const;

/** Every React Flow 12.11 label in plain words, for <ReactFlow ariaLabelConfig>. */
export const JOURNEY_ARIA_LABELS: Partial<AriaLabelConfig> = {
  ...STEP_ARIA_LABELS,
  'node.a11yDescription.ariaLiveMessage': ({ direction }: { direction: string }) => `Moved the step ${direction}.`,
  'edge.a11yDescription.default': 'Each line has a button that opens its details.',
  'controls.ariaLabel': 'Map controls',
  'controls.zoomIn.ariaLabel': 'Zoom in',
  'controls.zoomOut.ariaLabel': 'Zoom out',
  'controls.fitView.ariaLabel': 'Fit the journey',
  'controls.interactive.ariaLabel': 'Lock the map',
  'minimap.ariaLabel': 'Map overview',
  'handle.ariaLabel': 'Connection point'
};

const DECORATIONS = ['ariaLabel', 'domAttributes', 'focusable'] as const;

/**
 * A step or line without what the canvas adds for assistive tech (ariaLabel, domAttributes,
 * focusable and the line's data.description), so none of it reaches App or a saved journey.
 * Returns a shallow copy and never changes its input. Running it twice changes nothing more.
 * data.description is removed from a line only (it has a source and a target): the canvas never
 * sets it on a step, so a step's own data keeps any field of that name.
 */
export function stripA11yDecorations<T extends object>(item: T): T {
  const copy = { ...item } as Record<string, unknown>;
  for (const key of DECORATIONS) delete copy[key];
  const data = copy.data;
  const isLine = 'source' in copy && 'target' in copy;
  if (isLine && data && typeof data === 'object' && 'description' in data) {
    const { description: _description, ...rest } = data as Record<string, unknown>;
    copy.data = rest;
  }
  return copy as T;
}
