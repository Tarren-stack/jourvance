// Which lines the journey map accepts, decided in one place (#13).
// A line is refused only when the map cannot give it a meaning: a step joined to itself, a line
// into an ad or out of a thank-you page, a handle the step does not have, a message branch into a
// page, a split branch into a step that is not published at /p/<slug>, or an exact duplicate.
// Each named branch carries one line, so a second one asks to replace the first. The unnamed main
// handle carries one routing line plus any number of lines into follow-up sequences, the shape
// bp1 to bp4 ship (page -> sequence + thank-you). Loops are allowed and only flagged.
// Pure: no React, no DOM. The handle table is stepHandles.ts's (#31) and the type names are
// stepNavigation's, so neither is typed a second time. The explicit .ts extensions on the value
// imports let `node --test` load this file directly.

import type { NodeType } from '../types/journey';
import { SOURCE_HANDLES, TARGET_HANDLES } from './stepHandles.ts';
import { stepKindLabel, stepLabel } from './stepNavigation.ts';
import { endSentence, nameInSentence, stepShortName } from './stepNames.ts';

export { SOURCE_HANDLES, TARGET_HANDLES };

/** A step as the rules read it. JourneyNode fits without a cast. */
export interface RuleNode {
  id: string;
  type?: string | null;
  data?: { type?: unknown; label?: unknown; offerType?: unknown } | null;
}

/** A line as the rules read it. JourneyEdge fits without a cast. */
export interface RuleEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** A line someone is asking for: React Flow's Connection, or one built by code. */
export interface ConnectionLike {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export type RefusalReason =
  | 'missing-step'
  | 'self'
  | 'no-way-in'
  | 'no-way-out'
  | 'unknown-handle'
  | 'needs-message'
  | 'needs-page'
  | 'duplicate';

export type Verdict<E extends RuleEdge = RuleEdge> =
  | { kind: 'refuse'; reason: RefusalReason; message: string }
  | { kind: 'add' }
  | { kind: 'replace'; existing: E[] };

const NODE_TYPES = Object.keys(SOURCE_HANDLES) as NodeType[];

/** The plain name of each step type, used when a step has no label of its own. */
export const TYPE_NAMES: Readonly<Record<NodeType, string>> = Object.freeze(
  Object.fromEntries(NODE_TYPES.map(t => [t, stepKindLabel({ type: t })])) as Record<NodeType, string>
);

/** The step's type: the node's own, which picks the card, else its data's. */
export function typeOf(node: RuleNode | null | undefined): string | undefined {
  const t = node?.type ?? node?.data?.type;
  return typeof t === 'string' ? t : undefined;
}

/**
 * The handle a line leaves from. React Flow draws the TOP-LEVEL sourceHandle (data.sourceHandle
 * is a copy the canvas keeps for labels), and an empty name is the main handle.
 */
export function handleOf(h: string | null | undefined): string | null {
  return typeof h === 'string' && h !== '' ? h : null;
}

function handlesOn(table: Readonly<Record<NodeType, readonly (string | null)[]>>, type: string | undefined): readonly (string | null)[] {
  return type && Object.prototype.hasOwnProperty.call(table, type) ? table[type as NodeType] : [];
}

const BRANCH_NAMES: Record<string, string> = {
  accepted: 'accepted',
  declined: 'declined',
  rescue: 'rescue',
  abandon: 'abandoned',
  'branch-a': 'split A',
  'branch-b': 'split B'
};

/** A branch in words: the main handle is the 'next step'. */
export function branchName(handle: string | null | undefined): string {
  const h = handleOf(handle);
  if (h === null) return 'next step';
  return BRANCH_NAMES[h] ?? h;
}

/** The step's own label (stepNavigation's one label rule), else its type's name, else 'This step'. */
export function stepName(node: RuleNode | null | undefined): string {
  const label = stepLabel(node);
  if (label) return label;
  const type = typeOf(node);
  if (!type) return 'This step';
  const kind = stepKindLabel({ type, offerType: node?.data?.offerType });
  return kind === 'Step' ? 'This step' : kind;
}

/**
 * The step's name as its card reads ('Upsell /vip-bundle-upsell/upsell'), the name the map shows
 * and speaks. The loop notice uses it so it names a step exactly as Check design's loop row does
 * (R27). journeyGraph.stepName delegates here, so the map, Check design and this notice share one
 * rule; connection-rules.test.mjs pins the two equal.
 */
export function stepCardName(node: RuleNode | null | undefined): string {
  if (!node) return 'A missing step';
  const d = (node.data || {}) as Record<string, unknown>;
  // stepShortName reads data.type; the node's own type picks the card, so it wins.
  return stepShortName({ ...d, type: typeOf(node) });
}

/**
 * A line from the main handle into a follow-up sequence. It enrols the visitor in messages and
 * never decides where they go next, so it sits beside the one routing line (Aura's rule that
 * parallel email lines never replace Next).
 */
export function isFollowUpLine(sourceHandle: string | null | undefined, targetType: string | undefined): boolean {
  return handleOf(sourceHandle) === null && targetType === 'follow-up-sequence';
}

// abandon and rescue reach someone who left or declined. The only way back to them is a message:
// the card titles say so, isRetentionLink treats them as retention lines and funnelForecaster
// wires them into sequences. This rests on what the branch means, not on server code.
const MESSAGE_BRANCHES = new Set(['abandon', 'rescue']);

// A split sends each visitor to a published page. journeyRoutes.mjs:218-231 resolves each branch
// to the target's data.slug and publicRoutes.mjs:4474-4487 redirects to /p/<slug>; only landing
// pages and upsells publish there. Widen this in the same commit if another step ever does.
const SPLIT_BRANCHES = new Set(['branch-a', 'branch-b']);
const SPLIT_TARGETS = new Set(['landing-page', 'upsell']);

const NO_WAY_OUT: Record<string, string> = {
  'thank-you': 'A thank-you page ends the path. No line can leave it.',
  'follow-up-sequence': 'A follow-up sequence sends messages. It does not lead to another step.'
};

function refuse(reason: RefusalReason, message: string): Verdict<never> {
  return { kind: 'refuse', reason, message };
}

function byId(nodes: readonly RuleNode[], id: string): RuleNode | undefined {
  for (const n of nodes) if (n && n.id === id) return n;
  return undefined;
}

/**
 * What happens to a line someone asks for: refused with a reason and one plain sentence, added,
 * or put to the person as a Replace of the lines already on that branch. The checks run in a
 * fixed order and the first match wins. Replace and a loop are both allowed.
 */
export function checkConnection<E extends RuleEdge>(
  c: ConnectionLike,
  nodes: readonly RuleNode[],
  edges: readonly E[]
): Verdict<E> {
  const source = byId(nodes, c.source);
  const target = byId(nodes, c.target);
  if (!source || !target) return refuse('missing-step', 'That step is no longer on the map.');
  if (c.source === c.target) return refuse('self', 'A step cannot lead to itself.');

  const sourceType = typeOf(source);
  const targetType = typeOf(target);
  const outs = handlesOn(SOURCE_HANDLES, sourceType);
  const ins = handlesOn(TARGET_HANDLES, targetType);
  if (ins.length === 0) {
    return refuse('no-way-in', targetType === 'ad-source'
      ? 'An ad is where visitors start. Nothing can lead into it.'
      : `${nameInSentence(stepName(target))} cannot take a line.`);
  }
  if (outs.length === 0) {
    return refuse('no-way-out', (sourceType && NO_WAY_OUT[sourceType]) || `${nameInSentence(stepName(source))} cannot lead to another step.`);
  }

  const h = handleOf(c.sourceHandle);
  const th = handleOf(c.targetHandle);
  if (!outs.includes(h)) return refuse('unknown-handle', `${nameInSentence(stepName(source))} has no ${branchName(h)} branch.`);
  if (!ins.includes(th)) return refuse('unknown-handle', `${nameInSentence(stepName(target))} cannot take a line there.`);

  if (h !== null && MESSAGE_BRANCHES.has(h) && targetType !== 'follow-up-sequence') {
    return refuse('needs-message', 'This branch reaches people by message. Connect it to a follow-up sequence.');
  }
  if (h !== null && SPLIT_BRANCHES.has(h) && !SPLIT_TARGETS.has(targetType ?? '')) {
    return refuse('needs-page', 'A split sends each visitor to a published page. Connect it to a landing page or an upsell.');
  }

  const sameBranch = edges.filter(e => e && e.source === c.source && handleOf(e.sourceHandle) === h);
  if (sameBranch.some(e => e.target === c.target)) {
    return refuse('duplicate', 'These steps are already joined by this line.');
  }

  if (!isFollowUpLine(h, targetType)) {
    const existing = sameBranch.filter(e => !isFollowUpLine(e.sourceHandle, typeOf(byId(nodes, e.target))));
    if (existing.length > 0) return { kind: 'replace', existing };
  }
  return { kind: 'add' };
}

/**
 * The one way to add or replace a line. Kept lines come back as the same objects, in order, and
 * the new line is last, so a Replace is one change to the edge list (one history step).
 */
export function withConnection<E extends RuleEdge>(edges: readonly E[], added: E, replaced: readonly E[] = []): E[] {
  const gone = new Set(replaced.map(e => e.id));
  return [...edges.filter(e => !gone.has(e.id)), added];
}

function adjacency(edges: readonly RuleEdge[]): Map<string, string[]> {
  const next = new Map<string, string[]>();
  for (const e of edges) {
    if (!e) continue;
    const list = next.get(e.source);
    if (list) list.push(e.target);
    else next.set(e.source, [e.target]);
  }
  return next;
}

function reaches(next: Map<string, string[]>, from: string, to: string): boolean {
  if (from === to) return true;
  const seen = new Set<string>([from]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    for (const n of next.get(queue[i]) ?? []) {
      if (n === to) return true;
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return false;
}

/** True when a line from source to target closes a loop: target can already lead back to source. */
export function createsLoop(edges: readonly RuleEdge[], source: string, target: string): boolean {
  return reaches(adjacency(edges), target, source);
}

/**
 * The ids of every line on a loop. A line is on a loop exactly when its target leads back to its
 * source, so every line of the loop is flagged, not only the one that closed it.
 */
export function findLoopEdges(edges: readonly RuleEdge[]): Set<string> {
  const next = adjacency(edges);
  const ids = new Set<string>();
  for (const e of edges) if (e && reaches(next, e.target, e.source)) ids.add(e.id);
  return ids;
}

/** 'X', 'X and Y', or 'X, Y and Z'. */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export interface ReplacePrompt {
  title: string;
  body: string;
  confirm: string;
}

/**
 * The words of the Replace dialog. Names the step, the branch, the current and the new target,
 * each placed with nameInSentence so a label that is a question never reads "?." (T09).
 */
export function replacePrompt(c: ConnectionLike, nodes: readonly RuleNode[], existing: readonly RuleEdge[]): ReplacePrompt {
  const named = (id: string) => nameInSentence(stepName(byId(nodes, id)));
  const targets = [...new Set(existing.map(e => e.target))].map(named);
  return {
    title: 'Replace this line?',
    body: `${endSentence(`${named(c.source)} already sends its ${branchName(c.sourceHandle)} line to ${listNames(targets)}`)} Send it to ${named(c.target)} instead?`,
    confirm: 'Replace line'
  };
}

/**
 * The status line after a line closes a loop, naming each step as its card and Check design do,
 * placed in the sentence with nameInSentence so a form titled with a question never reads "?." (T09).
 */
export function loopMessage(c: ConnectionLike, nodes: readonly RuleNode[]): string {
  const named = (id: string) => nameInSentence(stepCardName(byId(nodes, id)));
  return `This line makes a loop. ${endSentence(`${named(c.target)} can lead back to ${named(c.source)}`)} The loop is marked on the map.`;
}

/** The status line after a refused line. */
export function refusalNotice(message: string): string {
  return `Line not added. ${message}`;
}

/** The parts of React Flow's FinalConnectionState the rules read. */
export interface ConnectionStateLike {
  fromNode?: { id: string } | null;
  fromHandle?: { id?: string | null; type?: string | null } | null;
  toNode?: { id: string } | null;
  toHandle?: { id?: string | null; type?: string | null } | null;
}

/**
 * A finished drag as a line, whichever end it started from. Null when either end is missing or
 * both ends are the same kind of handle (that is not a line anyone can draw, so not a refusal).
 */
export function connectionFromState(state: ConnectionStateLike | null | undefined): ConnectionLike | null {
  const { fromNode, fromHandle, toNode, toHandle } = state ?? {};
  if (!fromNode || !fromHandle || !toNode || !toHandle) return null;
  if (!fromHandle.type || !toHandle.type || fromHandle.type === toHandle.type) return null;
  const from = { node: fromNode.id, handle: fromHandle.id ?? null };
  const to = { node: toNode.id, handle: toHandle.id ?? null };
  const [s, t] = fromHandle.type === 'source' ? [from, to] : [to, from];
  return { source: s.node, sourceHandle: s.handle, target: t.node, targetHandle: t.handle };
}
