// Walks the lines on a journey map, one visitor choice at a time (Test Lead Flow, #22).
// The old test modal took the FIRST node of each type and claimed a delivery it never made, so
// it skipped forms, never reached an upsell or a split, and ended on "Delivered". This file walks
// the lines instead: it says what each line means for a visitor (from the source step's type and
// handle), lists the choices a visitor has at a step and where each one leads, and builds the
// visited path. Every effect is a plain "Simulated ..." sentence; nothing here sends or saves.
// It walks the MAP, not the published runtime. Where the two are known to differ, pageButtonNote
// says so. Pure; the one value import carries its .ts extension, so `node --test` can load it directly.

import type {
  JourneyProject,
  JourneyNode,
  JourneyEdge,
  NodeType,
  FormFieldConfig,
  PageNodeData,
  AbSplitNodeData
} from '../types/journey';
import type { EdgeKind } from './edgeKinds';
import { stepName } from './stepNavigation.ts';
import { nameInSentence } from './stepNames.ts';

/** What a visitor does to leave a step. */
export type WalkAction = 'next' | 'abandon' | 'accepted' | 'declined' | 'branch-a' | 'branch-b';

/** A path longer than this almost certainly loops. Aura's funnelAi.ts uses the same cap. */
export const WALK_STEP_LIMIT = 40;

export const WALK_INTRO = 'Walks the lines on this map. Nothing is sent, charged or saved.';

/** The line colour and dash a choice button takes, so it matches the line it follows. */
export const ACTION_KIND: Record<WalkAction, EdgeKind> = {
  next: 'main',
  abandon: 'declined',
  accepted: 'accepted',
  declined: 'declined',
  'branch-a': 'split-a',
  'branch-b': 'split-b'
};

/**
 * The handle a line leaves from. React Flow draws from the top-level field and the canvas colour
 * reads the data field (JourneyCanvas spreads e.data after it). Blueprints and the forecaster set both.
 */
export function lineHandle(edge: Pick<JourneyEdge, 'sourceHandle' | 'data'>): string | null {
  if (typeof edge.sourceHandle === 'string') return edge.sourceHandle;
  const fromData = edge.data?.sourceHandle;
  return typeof fromData === 'string' ? fromData : null;
}

/**
 * What a line means for a visitor, from its source step's type and handle. An unnamed handle
 * follows the handle React Flow draws it from (getHandle returns the first source handle):
 * Accepted on an upsell, A on a split, the main handle on a page. A handle name the step does not
 * have (the legacy 'accepted' on a page, #31) counts as the main line. Lines out of a follow-up
 * sequence or a thank-you page are not walked (#30), so they answer null.
 */
export function lineAction(sourceType: NodeType | undefined, handle: string | null): WalkAction | null {
  switch (sourceType) {
    case 'ad-source':
    case 'lead-form':
      return 'next';
    case 'landing-page':
      return handle === 'abandon' ? 'abandon' : 'next';
    case 'upsell':
      // The rescue flow fires on a decline (UpsellNode's rescue handle).
      return handle === 'declined' || handle === 'rescue' ? 'declined' : 'accepted';
    case 'ab-split':
      return handle === 'branch-b' ? 'branch-b' : 'branch-a';
    default:
      return null;
  }
}

const WALKABLE_ENTRY_TYPES = new Set<NodeType>(['ad-source', 'landing-page', 'ab-split', 'lead-form', 'upsell']);

function nodeMap(project: Pick<JourneyProject, 'nodes'>): Map<string, JourneyNode> {
  return new Map((project.nodes || []).map(n => [n.id, n]));
}

/** The step's name by the finder's and the panel heading's one rule (stepNavigation.stepName). */
const labelOf = (node: JourneyNode | undefined): string => stepName(node);

/**
 * The steps a visitor can start on: walkable steps with no walkable line coming in. A line out of
 * a sequence is not walkable, so it does not hide a page from the test. Ads come first. When every
 * step has a line in (a loop), the first ad, else the first page, else the first step that is not
 * a sequence or a thank-you page.
 */
export function walkEntries(project: Pick<JourneyProject, 'nodes' | 'edges'>): JourneyNode[] {
  const nodes = project.nodes || [];
  const byId = nodeMap(project);
  const reached = new Set<string>();
  for (const e of project.edges || []) {
    const src = byId.get(e.source);
    if (!src) continue;
    if (lineAction(src.type, lineHandle(e)) !== null) reached.add(e.target);
  }
  const open = nodes.filter(n => n.type && WALKABLE_ENTRY_TYPES.has(n.type) && !reached.has(n.id));
  const entries = [...open.filter(n => n.type === 'ad-source'), ...open.filter(n => n.type !== 'ad-source')];
  if (entries.length) return entries;
  const fallback =
    nodes.find(n => n.type === 'ad-source') ||
    nodes.find(n => n.type === 'landing-page') ||
    nodes.find(n => n.type !== 'follow-up-sequence' && n.type !== 'thank-you');
  return fallback ? [fallback] : [];
}

/** One choice a visitor has at a step. */
export interface WalkExit {
  action: WalkAction;
  label: string;
  kind: EdgeKind;
  /** The lines this choice follows, in edge order. */
  edgeIds: string[];
  /** The step the visitor moves to, or null when no page follows. */
  nextNodeId: string | null;
  /** Other steps a second line on the same choice points at. The test follows the first. */
  skippedNodeIds: string[];
  /** Follow-up sequences this choice starts. A sequence is not a screen the visitor moves to. */
  startsNodeIds: string[];
  outcome: string;
}

/**
 * The live traffic share of an A/B split. Mirrors server/routes/publicRoutes.mjs (the winner and
 * 100/0 lock, then the clamped splitRatio with a default of 50).
 */
export function splitShares(
  data: Pick<AbSplitNodeData, 'splitRatio' | 'winner'>
): { a: number; b: number; lockedTo: 'a' | 'b' | null } {
  if (data.winner === 'a' || data.splitRatio === 100) return { a: 100, b: 0, lockedTo: 'a' };
  if (data.winner === 'b' || data.splitRatio === 0) return { a: 0, b: 100, lockedTo: 'b' };
  const ratio = typeof data.splitRatio === 'number' && Number.isFinite(data.splitRatio)
    ? Math.max(0, Math.min(100, data.splitRatio))
    : 50;
  const a = Math.round(ratio);
  return { a, b: 100 - a, lockedTo: null };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasLinkedProduct(data: Record<string, unknown>): boolean {
  return Boolean(text(data.shopifyProductId) || text(data.shopifyVariantId) || text(data.checkoutUrl));
}

/** The plain sentence for what a choice would have done. Nothing is claimed as done. */
export function exitOutcome(node: Pick<JourneyNode, 'type' | 'data'>, action: WalkAction): string {
  const data = (node.data || {}) as Record<string, unknown>;
  switch (action) {
    case 'next':
      if (node.type === 'ad-source') return 'Simulated click. Nothing was recorded.';
      if (node.type === 'lead-form') return 'Simulated submission. No lead was saved and no notice was sent.';
      if (node.type === 'landing-page' && data.checkoutMode !== 'lead-gate' && hasLinkedProduct(data)) {
        return 'Simulated checkout. No order was placed and nothing was charged.';
      }
      return 'Simulated click.';
    case 'abandon':
      return 'Simulated exit.';
    case 'accepted':
      return 'Simulated yes. Nothing was charged.';
    case 'declined':
      return 'Simulated no.';
    case 'branch-a':
      return 'Simulated assignment to variant A. No visit was counted.';
    case 'branch-b':
      return 'Simulated assignment to variant B. No visit was counted.';
  }
}

function choicesFor(node: JourneyNode): Array<{ action: WalkAction; label: string }> {
  const d = (node.data || {}) as Record<string, unknown>;
  switch (node.type) {
    case 'ad-source':
      return [{ action: 'next', label: text(d.ctaText) || 'Click the ad' }];
    case 'landing-page':
      return [
        { action: 'next', label: text(d.buttonText) || 'Continue' },
        { action: 'abandon', label: 'Leave without finishing' }
      ];
    case 'lead-form':
      return [{ action: 'next', label: text(d.submitButtonText) || 'Submit' }];
    case 'upsell':
      return [
        { action: 'accepted', label: text(d.acceptButtonText) || 'Accept the offer' },
        { action: 'declined', label: text(d.declineButtonText) || 'Decline' }
      ];
    case 'ab-split': {
      const shares = splitShares(d as Pick<AbSplitNodeData, 'splitRatio' | 'winner'>);
      return [
        { action: 'branch-a', label: `${text(d.branchALabel) || 'Variant A'} (${shares.a}%)` },
        { action: 'branch-b', label: `${text(d.branchBLabel) || 'Variant B'} (${shares.b}%)` }
      ];
    }
    default:
      return [];
  }
}

/** The choices a visitor has at a step, each with where it leads and what it starts. */
export function walkExits(project: Pick<JourneyProject, 'nodes' | 'edges'>, nodeId: string): WalkExit[] {
  const byId = nodeMap(project);
  const node = byId.get(nodeId);
  if (!node) return [];
  const outgoing = (project.edges || []).filter(e => e.source === nodeId);
  return choicesFor(node).map(({ action, label }) => {
    const edgeIds: string[] = [];
    const targets: string[] = [];
    const starts: string[] = [];
    for (const e of outgoing) {
      if (lineAction(node.type, lineHandle(e)) !== action) continue;
      const target = byId.get(e.target);
      if (!target) continue; // a line to a deleted step goes nowhere
      edgeIds.push(e.id);
      if (target.type === 'follow-up-sequence') {
        if (!starts.includes(target.id)) starts.push(target.id);
      } else {
        targets.push(target.id);
      }
    }
    return {
      action,
      label,
      kind: ACTION_KIND[action],
      edgeIds,
      nextNodeId: targets[0] ?? null,
      skippedNodeIds: targets.slice(1),
      startsNodeIds: starts,
      outcome: exitOutcome(node, action)
    };
  });
}

/**
 * Says when the published page does something other than its line on the map. The labels are
 * the page settings' own (Direct to Checkout, 2-Step Lead Gate), and the rule matches the
 * published button in publicRoutes.mjs. A lead-form step is never published: the live lead gate
 * is a fixed name, email and phone form, which a direct page with no store opens too (R18).
 */
export function pageButtonNote(
  page: Pick<PageNodeData, 'checkoutMode'>,
  nextNodeType: NodeType | undefined
): string | null {
  const leadGate = page.checkoutMode === 'lead-gate';
  if (!leadGate && nextNodeType === 'lead-form') {
    return 'This page is set to Direct to Checkout, so its published button skips this form: it goes to checkout, or to a name, email and phone form when no store is connected. Choose 2-Step Lead Gate in the page settings if the form should come first.';
  }
  if (leadGate && nextNodeType === 'lead-form') {
    return 'On the published page, the 2-Step Lead Gate asks for name, email and phone. It does not use the fields on this form step.';
  }
  if (leadGate) {
    return 'This page is set to 2-Step Lead Gate, so its published button opens a sign-up form first.';
  }
  return null;
}

/** One step on the visited path. The first visit has no `via`; a dead end has nodeId null. */
export interface WalkVisit {
  nodeId: string | null;
  fromNodeId?: string;
  via?: WalkAction;
  exitLabel?: string;
  outcome?: string;
  startedNodeIds: string[];
  endSentence?: string;
}

export function beginWalk(project: Pick<JourneyProject, 'nodes' | 'edges'>, entryId?: string): WalkVisit[] {
  return [{ nodeId: entryId ?? walkEntries(project)[0]?.id ?? null, startedNodeIds: [] }];
}

export function walkAtLimit(path: WalkVisit[]): boolean {
  return path.length >= WALK_STEP_LIMIT;
}

/** Take a choice. Answers the SAME array when the path has ended or hit the step limit. */
export function takeExit(
  path: WalkVisit[],
  exit: WalkExit,
  project: Pick<JourneyProject, 'nodes' | 'edges'>
): WalkVisit[] {
  const last = path[path.length - 1];
  if (!last || last.nodeId === null || walkAtLimit(path)) return path;
  const visit: WalkVisit = {
    nodeId: exit.nextNodeId,
    fromNodeId: last.nodeId,
    via: exit.action,
    exitLabel: exit.label,
    outcome: exit.outcome,
    startedNodeIds: [...exit.startsNodeIds]
  };
  if (exit.nextNodeId === null) {
    const byId = nodeMap(project);
    if (exit.startsNodeIds.length) {
      const names = exit.startsNodeIds.map(id => nameInSentence(labelOf(byId.get(id)))).join(' and ');
      visit.endSentence = `No page follows this choice. This visitor is now in ${names} (simulated).`;
    } else {
      visit.endSentence = `No line leaves "${exit.label}" on ${nameInSentence(labelOf(byId.get(last.nodeId)))}, so the map ends here.`;
    }
  }
  return [...path, visit];
}

/** Every sequence started along the path, first start first. */
export function startedSequenceIds(path: WalkVisit[]): string[] {
  const out: string[] = [];
  for (const v of path) for (const id of v.startedNodeIds || []) if (!out.includes(id)) out.push(id);
  return out;
}

const NAME_LABEL = /^(your )?(first |full )?name$/i;

/** The first name a tester typed, or '' when none was. Never guesses one. */
export function firstNameFrom(fields: FormFieldConfig[], values: Record<string, string>): string {
  const enabled = (fields || []).filter(f => f && f.enabled);
  const byId = enabled.find(f => f.id === 'f_name');
  const byLabel = enabled.find(f => f.type === 'text' && NAME_LABEL.test((f.label || '').trim()));
  for (const field of [byId, byLabel]) {
    const value = field ? (values[field.id] || '').trim() : '';
    if (value) return value.split(/\s+/)[0];
  }
  return '';
}

/** Fill [First Name] only with a name the tester typed. Other tags stay visible. */
export function fillMerge(text: string, firstName: string): string {
  if (!firstName) return text;
  return text.replace(/\[first name\]/gi, () => firstName); // a function, so a '$' in the name stays literal
}

// ---- A whole walk from a set of choices (#25) ----
// Test Lead Flow above takes one choice at a time. The AI journey builder's walk-through picks
// every choice up front (which version, pays or leaves, accepts or declines) and wants the whole
// path at once. walkJourney is a thin loop over walkExits, so both walk the same lines.

/** The choices a simulated visitor makes. Anything unset takes the main line. */
export interface WalkChoices {
  variant?: 'a' | 'b';
  checkout?: 'paid' | 'left';
  upsell?: 'accepted' | 'declined';
  form?: 'submitted' | 'left';
}

export interface WalkStep {
  nodeId: string;
  type: NodeType | undefined;
  label: string;
  /** How the visitor got here, or null for the first step. */
  via: WalkAction | null;
  /** 'side' is a follow-up sequence the visitor joins while the path goes on elsewhere. */
  branch: 'main' | 'side';
}

export type WalkStop = 'end' | 'left' | 'loop' | 'no-entry' | 'limit';

export interface JourneyWalkResult {
  steps: WalkStep[];
  stopped: WalkStop;
}

/** The first ad with no line in, else any step with no line in, else null. */
export function journeyEntry(nodes: JourneyNode[], edges: JourneyEdge[]): JourneyNode | null {
  const reached = new Set((edges || []).map(e => e.target));
  const open = (nodes || []).filter(n => !reached.has(n.id));
  return open.find(n => n.type === 'ad-source') ?? open[0] ?? null;
}

/**
 * The handle a visitor leaves a step by: a branch name, null for the main line, or 'stop' when
 * they leave the journey there (a form they do not fill in).
 */
export function handleFor(node: Pick<JourneyNode, 'type'>, choices: WalkChoices): string | null | 'stop' {
  switch (node.type) {
    case 'ab-split':
      return choices.variant === 'b' ? 'branch-b' : 'branch-a';
    case 'landing-page':
      return choices.checkout === 'left' ? 'abandon' : null;
    case 'upsell':
      return choices.upsell === 'declined' ? 'declined' : 'accepted';
    case 'lead-form':
      return choices.form === 'left' ? 'stop' : null;
    default:
      return null;
  }
}

/**
 * Walks from the entry along the lines the choices pick. A follow-up sequence the visitor joins
 * is a side step, and the walk goes on to the first step that is not a sequence. When a choice
 * leads only into sequences, the walk goes into the first one. Stops at a revisit, a dead end, a
 * 'stop' choice or the step cap. Nothing is sent or saved.
 */
export function walkJourney(
  nodes: JourneyNode[],
  edges: JourneyEdge[],
  choices: WalkChoices,
  limit: number = WALK_STEP_LIMIT
): JourneyWalkResult {
  const project = { nodes: nodes || [], edges: edges || [] };
  const byId = nodeMap(project);
  const entry = journeyEntry(project.nodes, project.edges);
  if (!entry) return { steps: [], stopped: 'no-entry' };
  const steps: WalkStep[] = [];
  const visited = new Set<string>();
  const joined = new Set<string>();
  const visit = (node: JourneyNode, via: WalkAction | null, branch: 'main' | 'side') =>
    steps.push({ nodeId: node.id, type: node.type, label: labelOf(node), via, branch });

  let current: JourneyNode = entry;
  let via: WalkAction | null = null;
  for (;;) {
    if (steps.length >= limit) return { steps, stopped: 'limit' };
    visited.add(current.id);
    visit(current, via, 'main');
    const handle = handleFor(current, choices);
    if (handle === 'stop') return { steps, stopped: 'left' };
    const action = lineAction(current.type, handle);
    const exit = action ? walkExits(project, current.id).find(x => x.action === action) : undefined;
    if (!exit) return { steps, stopped: 'end' };
    let next: string | null = exit.nextNodeId;
    const starts = [...exit.startsNodeIds];
    if (!next && starts.length) next = starts.shift() ?? null;
    for (const id of starts) {
      const seq = byId.get(id);
      if (!seq || joined.has(id)) continue;
      if (steps.length >= limit) return { steps, stopped: 'limit' };
      joined.add(id);
      visit(seq, exit.action, 'side');
    }
    if (!next) return { steps, stopped: 'end' };
    if (visited.has(next)) return { steps, stopped: 'loop' };
    const target = byId.get(next);
    if (!target) return { steps, stopped: 'end' };
    current = target;
    via = exit.action;
  }
}
