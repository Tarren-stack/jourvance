// Adding a step where the person is working, decided in one place (Aura's "add next step").
// + Next and + Before on a selected step, + Step on a selected line, a line dragged into empty
// map, and a loose step dropped onto a line all come here, so each of them offers the same
// choices, refuses for the same reasons and edits the map the same way.
//
// The rules, in short:
// - An exit's ROUTING lines decide what a new step does there. None: it connects. Exactly one: it
//   goes in between, and the picker says so before anything is chosen. Two or more (an old
//   fan-out): it is refused, so nothing is ever fanned out further. A line from the MAIN exit into
//   follow-up emails is not a routing line, because those emails run alongside the next step
//   rather than instead of it. On a named exit (Accepted, Left at checkout, Split A) every line is
//   the one way on, emails included. This is #13's isFollowUpLine, imported, not typed again.
// - + Step on one line of an old fan-out puts the step on that line only. The exit keeps the same
//   number of routing lines, so the fan-out is kept as it was, never widened and never pruned.
// - Only a step with a way on can go between two steps. An upsell sends both answers to the old
//   destination; a thank-you page, an A/B split and follow-up emails are refused with a sentence.
// - Choices that can never apply are left out. Choices this map rules out stay listed, with the
//   one-sentence reason, so a person learns why rather than wondering where a step went.
//
// Every function is pure and returns new arrays. The caller commits a plan as ONE map edit (one
// undo step): plan.edges is the whole edge list after it. checkPlan is the one #13 check for a
// plan. Running checkConnection on each added line instead is wrong on an old fan-out: it answers
// Replace for the line + Step puts back, and passing that Replace's lines to withConnection would
// delete the other branch. The handle ids come from stepHandles.ts, the one handle table; this
// file adds only where each handle sits on the card and what it is called.
// Value imports carry .ts so `node --test` loads this file directly.

import type { JourneyEdge, JourneyNode, NodeType } from '../types/journey';
import { SOURCE_HANDLES, TARGET_HANDLES } from './stepHandles.ts';
import { isRetentionLink } from './edgeKinds.ts';
import { stepName } from './stepNavigation.ts';
import { endSentence, nameInSentence } from './stepNames.ts';
import { checkConnection, isFollowUpLine } from './connectionRules.ts';
import { STEP_SIZE, makeStep } from './stepDefaults.ts';

export interface XY { x: number; y: number }
export interface Size { width: number; height: number }

// ---- Ports ----

export type PortSide = 'left' | 'right' | 'top' | 'bottom';
export interface Port { handle: string | null; side: PortSide; label: string }
export interface StepPorts {
  inputs: Port[];
  exits: Port[];
  /** The exits that take over the old destination when this step goes between two steps. */
  insertExits: (string | null)[];
}

const NODE_TYPES: NodeType[] = ['ad-source', 'landing-page', 'lead-form', 'follow-up-sequence', 'thank-you', 'upsell', 'ab-split'];

// Where each handle sits on its card. A bottom exit is a second chance (left at checkout, said no),
// and the top input is where a retention flow comes in. add-step.test.mjs pins these to the cards.
const EXIT_SIDE: Record<string, PortSide> = { abandon: 'bottom', rescue: 'bottom' };
const INPUT_SIDE: Record<string, PortSide> = { 'retention-in': 'top' };

const EXIT_LABEL: Record<string, string> = {
  main: 'Next step',
  abandon: 'Left at checkout',
  accepted: 'Accepted',
  declined: 'Declined',
  rescue: 'Rescue flow',
  'branch-a': 'Split A',
  'branch-b': 'Split B'
};
const INPUT_LABEL: Record<string, string> = { main: 'Main entry', 'retention-in': 'Retention entry' };

const INSERT_EXITS: Record<NodeType, (string | null)[]> = {
  'ad-source': [],
  'landing-page': [null],
  'lead-form': [null],
  'follow-up-sequence': [],
  'thank-you': [],
  upsell: ['accepted', 'declined'],
  'ab-split': []
};

const portKey = (handle: string | null) => handle ?? 'main';

function buildPorts(type: NodeType): StepPorts {
  return {
    inputs: TARGET_HANDLES[type].map(handle => ({
      handle,
      side: INPUT_SIDE[portKey(handle)] ?? 'left',
      label: INPUT_LABEL[portKey(handle)] ?? 'Entry'
    })),
    exits: SOURCE_HANDLES[type].map(handle => ({
      handle,
      side: EXIT_SIDE[portKey(handle)] ?? 'right',
      label: EXIT_LABEL[portKey(handle)] ?? 'Exit'
    })),
    insertExits: INSERT_EXITS[type]
  };
}

/** Each step type's inputs and exits in card order (null = the unnamed main handle). */
export const STEP_PORTS: Record<NodeType, StepPorts> = Object.fromEntries(
  NODE_TYPES.map(type => [type, buildPorts(type)])
) as Record<NodeType, StepPorts>;

function portsOf(node: JourneyNode | undefined): StepPorts | undefined {
  return node ? STEP_PORTS[node.type as NodeType] : undefined;
}

function hasMainInput(type: NodeType): boolean {
  return STEP_PORTS[type].inputs.some(p => p.handle === null);
}

function hasMainExit(type: NodeType): boolean {
  return STEP_PORTS[type].exits.some(p => p.handle === null);
}

// ---- Choices ----

export interface StepChoice {
  key: string;
  type: NodeType;
  label: string;
  detail: string;
  patch?: Record<string, unknown>;
}

/** What the picker offers, in the order "All steps" lists them. */
export const STEP_CHOICES: StepChoice[] = [
  { key: 'ad-source', type: 'ad-source', label: 'Ad or traffic source', detail: 'Where visitors come from.' },
  { key: 'landing-page', type: 'landing-page', label: 'Landing page', detail: 'Your offer and one button.' },
  { key: 'lead-form', type: 'lead-form', label: 'Lead form', detail: 'Collects a name and email.' },
  { key: 'ab-split', type: 'ab-split', label: 'A/B split', detail: 'Sends visitors to two pages to compare them.' },
  { key: 'upsell', type: 'upsell', label: 'Upsell offer', detail: 'A one-time offer after checkout.' },
  {
    key: 'downsell',
    type: 'upsell',
    label: 'Downsell offer',
    detail: 'A smaller offer after a no.',
    patch: { offerType: 'downsell', label: 'Downsell Offer' }
  },
  { key: 'thank-you', type: 'thank-you', label: 'Thank-you page', detail: 'Ends the journey.' },
  { key: 'follow-up', type: 'follow-up-sequence', label: 'Follow-up emails', detail: 'Runs alongside the next step.' },
  {
    key: 'checkout-recovery',
    type: 'follow-up-sequence',
    label: 'Checkout recovery emails',
    detail: 'For visitors who leave at checkout.',
    patch: {
      label: 'Checkout Recovery',
      sequenceTitle: 'Checkout recovery',
      sequenceType: 'checkout_recovery',
      isRetentionBranch: true,
      delayHours: 1,
      smartExitOnPurchase: true,
      steps: [{
        id: 'step-1',
        channel: 'email',
        delay: '1 Hour',
        subject: 'You left something at checkout',
        body: 'Hi [First Name],\n\nYour checkout is still open if you want to finish it.\n[Checkout Link]'
      }]
    }
  },
  {
    key: 'upsell-rescue',
    type: 'follow-up-sequence',
    label: 'Upsell rescue emails',
    detail: 'For buyers who said no to the offer.',
    patch: {
      label: 'Upsell Rescue',
      sequenceTitle: 'Upsell rescue',
      sequenceType: 'upsell_recovery',
      isRetentionBranch: true,
      delayHours: 18,
      smartExitOnPurchase: true,
      steps: [{
        id: 'step-1',
        channel: 'email',
        delay: '18 Hours',
        subject: 'Still thinking it over?',
        body: 'Hi [First Name],\n\nHere is the link again if you want it.\n[Offer Link]'
      }]
    }
  }
];

const RETENTION_PRESETS = new Set(['checkout-recovery', 'upsell-rescue']);
const MESSAGE_EXITS = new Set(['abandon', 'rescue']);
const SPLIT_EXITS = new Set(['branch-a', 'branch-b']);
const SPLIT_TARGETS = new Set<NodeType>(['landing-page', 'upsell']);

/** Recommended choices after an exit, keyed `${type}:${handle ?? 'main'}`, best first. */
export const RECOMMENDED_NEXT: Record<string, string[]> = {
  'ad-source:main': ['landing-page', 'ab-split', 'lead-form'],
  'landing-page:main': ['lead-form', 'upsell', 'thank-you', 'follow-up'],
  'landing-page:abandon': ['checkout-recovery'],
  'lead-form:main': ['follow-up', 'thank-you', 'landing-page'],
  // #30 gave follow-up emails an exit: the page their links lead to.
  'follow-up-sequence:main': ['landing-page', 'thank-you'],
  'upsell:accepted': ['upsell', 'thank-you'],
  'upsell:declined': ['downsell', 'thank-you'],
  'upsell:rescue': ['upsell-rescue'],
  'ab-split:branch-a': ['landing-page'],
  'ab-split:branch-b': ['landing-page']
};

/** Recommended choices before a step, by that step's type, best first. */
export const RECOMMENDED_BEFORE: Partial<Record<NodeType, string[]>> = {
  'landing-page': ['ad-source'],
  'lead-form': ['landing-page'],
  'thank-you': ['landing-page', 'lead-form'],
  'follow-up-sequence': ['lead-form', 'landing-page'],
  upsell: ['landing-page']
};

// ---- Requests and plans ----

export type AddRequest =
  | { direction: 'next'; anchorId: string; handle: string | null; at?: XY }
  | { direction: 'before'; anchorId: string; at?: XY }
  | { direction: 'between'; edgeId: string };

export type AddPlan =
  | {
      ok: true;
      /** The new step, or for a step dropped onto a line the same step, unmoved. */
      node?: JourneyNode;
      /** The whole edge list after the edit. Commit this as it is, after checkPlan. */
      edges: JourneyEdge[];
      /**
       * The lines this edit adds, in order, and the ids of the lines it removes. For checkPlan and
       * for history labels. Not for withConnection: on an old fan-out #13 would call one of these a
       * Replace of lines this edit keeps.
       */
      added: JourneyEdge[];
      removed: string[];
      summary: string;
    }
  | { ok: false; reason: string };

export type ChoiceRow = StepChoice & { refusal?: string };

const refuse = (reason: string): AddPlan => ({ ok: false, reason });

// A step's name inside a sentence: a label that ends in its own "?" or "!" is quoted, and a
// sentence that ends on a name goes through endSentence, so nothing reads "wins?." (T09).
const named = (node: JourneyNode | undefined): string => nameInSentence(stepName(node));

/**
 * Why a step of this type cannot follow this exit, or ''. The same rule as #13's checkConnection
 * (MESSAGE_BRANCHES and SPLIT_TARGETS in connectionRules.ts), so the picker and a dropped step
 * never propose a line the canvas would then refuse.
 */
function exitRefusal(handle: string | null, type: NodeType): string {
  if (handle !== null && MESSAGE_EXITS.has(handle) && type !== 'follow-up-sequence') {
    return 'This exit reaches people by message, so only follow-up emails can come next.';
  }
  if (handle !== null && SPLIT_EXITS.has(handle) && !SPLIT_TARGETS.has(type)) {
    return 'A split sends each visitor to a published page, so only a landing page or an upsell can come next.';
  }
  return '';
}
const sameHandle = (a: unknown, b: string | null) => ((typeof a === 'string' && a) ? a : null) === b;

/**
 * The lines from one exit that decide where a visitor goes next. A MAIN-exit line into follow-up
 * emails is left out: those emails run alongside, so they never make the exit "taken". On a named
 * exit every line counts, emails included, the same as #13's checkConnection.
 */
export function routingLines(nodes: JourneyNode[], edges: JourneyEdge[], sourceId: string, handle: string | null): JourneyEdge[] {
  const typeOf = new Map(nodes.map(n => [n.id, n.type]));
  return edges.filter(e =>
    e.source === sourceId && sameHandle(e.sourceHandle, handle) && !isFollowUpLine(e.sourceHandle, typeOf.get(e.target))
  );
}

/** The lines from one exit that run alongside it: main-exit lines into follow-up emails. */
function alongsideLines(nodes: JourneyNode[], edges: JourneyEdge[], sourceId: string, handle: string | null): JourneyEdge[] {
  const typeOf = new Map(nodes.map(n => [n.id, n.type]));
  return edges.filter(e =>
    e.source === sourceId && sameHandle(e.sourceHandle, handle) && isFollowUpLine(e.sourceHandle, typeOf.get(e.target))
  );
}

/**
 * The exit + Next uses: the first right-side exit with no routing line, else the first right-side
 * exit. Never a bottom exit (those are chosen in "Connect from" or by dragging from the dot).
 * Undefined when the step has no exit at all.
 */
export function defaultExit(anchor: JourneyNode, nodes: JourneyNode[], edges: JourneyEdge[]): string | null | undefined {
  const ports = portsOf(anchor);
  if (!ports || ports.exits.length === 0) return undefined;
  const right = ports.exits.filter(p => p.side === 'right');
  const pool = right.length > 0 ? right : ports.exits;
  const free = pool.find(p => routingLines(nodes, edges, anchor.id, p.handle).length === 0);
  return (free ?? pool[0]).handle;
}

export interface ExitOption { handle: string | null; label: string }

/** The "Connect from" options for a step: each exit and where it leads now. */
export function exitOptions(anchor: JourneyNode, nodes: JourneyNode[], edges: JourneyEdge[]): ExitOption[] {
  const ports = portsOf(anchor);
  if (!ports) return [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  return ports.exits.map(p => {
    const lines = routingLines(nodes, edges, anchor.id, p.handle);
    if (lines.length === 0) {
      // Free, but say so when emails already leave here: they stay, beside the new step.
      const beside = alongsideLines(nodes, edges, anchor.id, p.handle);
      if (beside.length === 1) return { handle: p.handle, label: `${p.label} (free, ${named(byId.get(beside[0].target))} runs alongside)` };
      if (beside.length > 1) return { handle: p.handle, label: `${p.label} (free, ${beside.length} email flows run alongside)` };
      return { handle: p.handle, label: `${p.label} (free)` };
    }
    if (lines.length === 1) return { handle: p.handle, label: `${p.label} (now goes to ${named(byId.get(lines[0].target))})` };
    return { handle: p.handle, label: `${p.label} (now goes to ${lines.length} steps)` };
  });
}

function exitPort(anchor: JourneyNode | undefined, handle: string | null): Port | undefined {
  return portsOf(anchor)?.exits.find(p => p.handle === handle);
}

/** The exit a request adds from: its own exit for 'next', the line's source exit for 'between'. */
function requestExit(request: AddRequest, nodes: JourneyNode[], edges: JourneyEdge[]): { anchor?: JourneyNode; port?: Port } {
  if (request.direction === 'next') {
    const anchor = nodes.find(n => n.id === request.anchorId);
    return { anchor, port: exitPort(anchor, request.handle) };
  }
  if (request.direction === 'between') {
    const line = edges.find(e => e.id === request.edgeId);
    const anchor = line ? nodes.find(n => n.id === line.source) : undefined;
    return { anchor, port: line ? exitPort(anchor, line.sourceHandle || null) : undefined };
  }
  return {};
}

/**
 * True when a choice can never apply to this kind of request, whatever the map holds: those are
 * left out of the picker, not shown as unavailable.
 */
function neverApplies(request: AddRequest, choice: StepChoice, exit: Port | undefined, anchor: JourneyNode | undefined): boolean {
  if (request.direction === 'before') {
    // Only a step with a main exit can lead into another. Follow-up emails have one since #30, but
    // it is a link inside an email, not a step a visitor walks through, so it is not offered here.
    return !hasMainExit(choice.type) || choice.type === 'follow-up-sequence';
  }
  if (!hasMainInput(choice.type)) return true;
  if (RETENTION_PRESETS.has(choice.key) && exit?.side !== 'bottom') return true;
  // What an exit may lead to, the same rule as #13's checkConnection (MESSAGE_BRANCHES and
  // SPLIT_TARGETS in connectionRules.ts): someone who left or said no is reached only by message,
  // and a split sends each visitor to a published page. The canvas still commits every new line
  // through checkConnection; this only keeps the picker from offering what it would refuse.
  if (exitRefusal(exit?.handle ?? null, choice.type)) return true;
  // Emails do not send more emails: a follow-up exit leads to a page or an offer.
  if (anchor?.type === 'follow-up-sequence' && choice.type === 'follow-up-sequence') return true;
  return false;
}

function recommendedKeys(request: AddRequest, nodes: JourneyNode[], edges: JourneyEdge[]): string[] {
  if (request.direction === 'before') {
    const anchor = nodes.find(n => n.id === request.anchorId);
    return anchor ? RECOMMENDED_BEFORE[anchor.type as NodeType] ?? [] : [];
  }
  const { anchor, port } = requestExit(request, nodes, edges);
  if (!anchor || !port) return [];
  return RECOMMENDED_NEXT[`${anchor.type}:${portKey(port.handle)}`] ?? [];
}

/**
 * The picker's rows: recommended first (best first), then every other choice that could apply.
 * A row this map rules out carries `refusal`, the sentence planAdd would answer.
 */
export function choicesFor(request: AddRequest, nodes: JourneyNode[], edges: JourneyEdge[]): { recommended: ChoiceRow[]; other: ChoiceRow[] } {
  const { anchor, port } = request.direction === 'before'
    ? { anchor: nodes.find(n => n.id === request.anchorId), port: undefined }
    : requestExit(request, nodes, edges);
  const rows: ChoiceRow[] = STEP_CHOICES
    .filter(choice => !neverApplies(request, choice, port, anchor))
    .map(choice => {
      const plan = planAdd(request, choice.key, nodes, edges, 'dry-run');
      return plan.ok ? { ...choice } : { ...choice, refusal: plan.reason };
    });
  const keys = recommendedKeys(request, nodes, edges);
  const recommended = keys.map(k => rows.find(r => r.key === k)).filter((r): r is ChoiceRow => !!r);
  const other = rows.filter(r => !keys.includes(r.key));
  return { recommended, other };
}

/** The sentence the picker shows before anything is chosen, or '' when there is nothing to warn. */
export function exitNote(request: AddRequest, nodes: JourneyNode[], edges: JourneyEdge[]): string {
  if (request.direction === 'between') {
    // + Step on one line of an old fan-out: say that the other lines stay, since + Next sent the
    // person here and nothing on the map shows which lines leave the same exit.
    const line = edges.find(e => e.id === request.edgeId);
    if (!line) return '';
    const handle = line.sourceHandle || null;
    const ways = routingLines(nodes, edges, line.source, handle);
    if (ways.length < 2 || !ways.some(e => e.id === line.id)) return '';
    const others = ways.length - 1;
    const source = named(nodes.find(n => n.id === line.source));
    return `${source} leads to ${ways.length} steps from this exit. The new step goes on this line only, and the other ${others === 1 ? 'line stays' : `${others} lines stay`}.`;
  }
  if (request.direction !== 'next') return '';
  const anchor = nodes.find(n => n.id === request.anchorId);
  if (!anchor) return '';
  const lines = routingLines(nodes, edges, anchor.id, request.handle);
  if (lines.length !== 1) return '';
  const target = nodes.find(n => n.id === lines[0].target);
  // A message exit takes only emails, and emails cannot go in between, so nothing can be added.
  if (request.handle !== null && MESSAGE_EXITS.has(request.handle)) {
    return `${named(anchor)} leads to ${named(target)} from this exit now. An exit like this carries one line.`;
  }
  return `${named(anchor)} leads to ${named(target)} now. The new step goes in between.`;
}

/** The picker's heading for a request. */
export function pickerTitle(request: AddRequest): string {
  if (request.direction === 'next') return 'Add next step';
  if (request.direction === 'before') return 'Add a step before';
  return 'Add a step on this line';
}

/** The line under the heading that names where the step goes. */
export function pickerAnchorLabel(request: AddRequest, nodes: JourneyNode[], edges: JourneyEdge[]): string {
  if (request.direction === 'between') {
    const line = edges.find(e => e.id === request.edgeId);
    if (!line) return 'This line is no longer on the map.';
    return `Between ${named(nodes.find(n => n.id === line.source))} and ${named(nodes.find(n => n.id === line.target))}`;
  }
  const anchor = nodes.find(n => n.id === request.anchorId);
  return `${request.direction === 'next' ? 'After' : 'Before'} ${named(anchor)}`;
}

/**
 * The one shape of a new line. Also used by JourneyCanvas.handleConnect, so a line drawn by hand
 * and a line the picker adds are saved the same way. Measured numbers start at 0: a new line has
 * carried no visitors yet. sourceData lets a line out of a retention step read as retention (#30).
 */
export function makeLine(
  source: string,
  sourceHandle: string | null,
  target: string,
  targetHandle: string | null,
  targetData: unknown,
  stamp: string,
  sourceData?: unknown
): JourneyEdge {
  const data: NonNullable<JourneyEdge['data']> = {
    sourceThroughput: 0,
    targetCount: 0,
    rate: 0,
    isRetentionEdge: isRetentionLink(sourceHandle, targetData, sourceData)
  };
  // Left out rather than set to undefined: a saved journey is JSON, and Firestore rejects undefined.
  if (sourceHandle) data.sourceHandle = sourceHandle;
  if (targetHandle) data.targetHandle = targetHandle;
  return {
    id: `e-${source}-${sourceHandle ?? 'main'}-${target}-${stamp}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: 'conversion',
    data
  };
}

const INSERT_REFUSALS: Partial<Record<NodeType, string>> = {
  'thank-you': 'A thank-you page ends the journey, so it cannot go between {A} and {B}',
  'ab-split': 'An A/B split needs two pages of its own, so it cannot go between {A} and {B}',
  'follow-up-sequence': 'Follow-up emails run alongside a step, so they cannot go between {A} and {B}',
  'ad-source': 'An ad or traffic source starts the journey, so it cannot go between {A} and {B}'
};

/**
 * The one insert rule: put `node` on line L. L is removed, the old source leads into the new step,
 * and every exit in insertExits leads on to L's old destination, keeping its input handle.
 */
export function insertLine(nodes: JourneyNode[], edges: JourneyEdge[], edgeId: string, node: JourneyNode, stamp: string): AddPlan {
  const line = edges.find(e => e.id === edgeId);
  if (!line) return refuse('That line is no longer on the map.');
  const source = nodes.find(n => n.id === line.source);
  const target = nodes.find(n => n.id === line.target);
  const a = named(source);
  const b = named(target);
  const exits = STEP_PORTS[node.type as NodeType]?.insertExits ?? [];
  if (exits.length === 0) {
    const template = INSERT_REFUSALS[node.type as NodeType] ?? 'This step cannot go between {A} and {B}';
    // A function, so a "$" in a step's name is never read as a replacement pattern.
    return refuse(endSentence(template.replace('{A}', () => a).replace('{B}', () => b)));
  }
  const sourceHandle = line.sourceHandle || null;
  const targetHandle = line.targetHandle || null;
  const blocked = exitRefusal(sourceHandle, node.type as NodeType);
  if (blocked) return refuse(blocked);
  // A line into emails that run alongside is not the exit's way on. Putting a step on it makes the
  // source lead to that step, so when the exit already leads somewhere that is a second way on:
  // a fan-out, which #13 would answer with Replace. Point at the line that is the way on instead.
  if (isFollowUpLine(sourceHandle, target?.type)) {
    const ways = routingLines(nodes, edges, line.source, sourceHandle);
    if (ways.length === 1) {
      return refuse(`${a} already leads to ${named(nodes.find(n => n.id === ways[0].target))}, so put the new step on that line instead.`);
    }
    if (ways.length > 1) return refuse(`${a} already leads to ${ways.length} steps, so put the new step on one of those lines instead.`);
  }
  const added = [
    makeLine(line.source, sourceHandle, node.id, null, node.data, stamp, source?.data),
    ...exits.map(x => makeLine(node.id, x, line.target, targetHandle, target?.data, stamp, node.data))
  ];
  return {
    ok: true,
    node,
    edges: [...edges.filter(e => e.id !== line.id), ...added],
    added,
    removed: [line.id],
    summary: endSentence(`Added ${named(node)} between ${a} and ${b}`)
  };
}

// ---- Placement ----

type Measurable = Pick<JourneyNode, 'position'> & { measured?: { width?: number; height?: number }; width?: number; height?: number };

/** A card's size: measured by React Flow when it has been drawn, else the estimate. */
export function sizeOf(n: Measurable): Size {
  return {
    width: n.measured?.width ?? n.width ?? STEP_SIZE.width,
    height: n.measured?.height ?? n.height ?? STEP_SIZE.height
  };
}

const GAP_X = 140;
const GAP_Y = 48;
const MARGIN = 32;

/** Where a new step would like to sit for this request, before avoiding other cards. */
export function preferredSlot(request: AddRequest, anchor: Measurable, exitSide: PortSide | undefined, exitIndex: number, size: Size = STEP_SIZE): XY {
  const { width: W, height: H } = size;
  const at = request.direction === 'between' ? undefined : request.at;
  const a = sizeOf(anchor);
  if (request.direction === 'before') {
    return at ? { x: at.x - W, y: at.y - H / 2 } : { x: anchor.position.x - W - GAP_X, y: anchor.position.y };
  }
  if (exitSide === 'bottom') {
    return at ? { x: at.x - W / 2, y: at.y } : { x: anchor.position.x, y: anchor.position.y + a.height + 100 };
  }
  return at ? { x: at.x, y: at.y - H / 2 } : { x: anchor.position.x + a.width + GAP_X, y: anchor.position.y + exitIndex * (H + GAP_Y) };
}

function overlaps(x: number, y: number, size: Size, other: XY, otherSize: Size, margin: number): boolean {
  return x < other.x + otherSize.width + margin && x + size.width + margin > other.x
    && y < other.y + otherSize.height + margin && y + size.height + margin > other.y;
}

/**
 * The first spot near `preferred` where a card of `size` overlaps no other card by less than 32px:
 * down the preferred column first, then up to two columns further in direction dirX. Past that, a
 * spot below the lowest card. Whole pixels.
 */
export function freeSlot(
  preferred: XY,
  nodes: Measurable[],
  size: Size = STEP_SIZE,
  dirX: 1 | -1 = 1,
  measure: (n: Measurable) => Size = sizeOf
): XY {
  const boxes = nodes.map(n => ({ at: n.position, size: measure(n) }));
  const clear = (x: number, y: number) => boxes.every(b => !overlaps(x, y, size, b.at, b.size, MARGIN));
  for (let col = 0; col <= 2; col++) {
    const x = preferred.x + dirX * col * (size.width + GAP_X);
    for (let row = 0; row <= 40; row++) {
      const y = preferred.y + row * 40;
      if (clear(x, y)) return { x: Math.round(x), y: Math.round(y) };
    }
  }
  const bottom = boxes.reduce((max, b) => Math.max(max, b.at.y + b.size.height), preferred.y);
  return { x: Math.round(preferred.x), y: Math.round(bottom + MARGIN + 1) };
}

export interface CanvasView {
  /** The centre of the visible map, in flow coordinates. */
  center?: XY | null;
  /** A drawn card's measured size, by node id. */
  sizeOf?: (id: string) => { width?: number; height?: number } | undefined;
}

/**
 * Where the header's Add Step puts an unconnected step: a free slot at the centre of the visible
 * map, else right of everything, else a fixed start for an empty map.
 */
export function slotForNewStep(nodes: JourneyNode[], view: CanvasView | null | undefined): XY {
  const measure = (n: Measurable): Size => {
    const m = view?.sizeOf && 'id' in n ? view.sizeOf((n as JourneyNode).id) : undefined;
    const base = sizeOf(n);
    return { width: m?.width ?? base.width, height: m?.height ?? base.height };
  };
  const { width: W, height: H } = STEP_SIZE;
  let preferred: XY;
  if (view?.center) {
    preferred = { x: view.center.x - W / 2, y: view.center.y - H / 2 };
  } else if (nodes.length > 0) {
    preferred = {
      x: Math.max(...nodes.map(n => n.position.x + measure(n).width)) + GAP_X,
      y: Math.min(...nodes.map(n => n.position.y))
    };
  } else {
    preferred = { x: 100, y: 180 };
  }
  return freeSlot(preferred, nodes, STEP_SIZE, 1, measure);
}

function centreOf(n: Measurable): XY {
  const s = sizeOf(n);
  return { x: n.position.x + s.width / 2, y: n.position.y + s.height / 2 };
}

/**
 * The step the picker adds, and where. Every rule for a request lives here; choicesFor dry-runs
 * this to explain a row it cannot offer.
 */
export function planAdd(request: AddRequest, choiceKey: string, nodes: JourneyNode[], edges: JourneyEdge[], stamp: string): AddPlan {
  const choice = STEP_CHOICES.find(c => c.key === choiceKey);
  if (!choice) return refuse('Choose a step to add.');
  const size: Size = STEP_SIZE;
  const build = (at: XY, dirX: 1 | -1) => makeStep(choice.type, freeSlot(at, nodes, size, dirX), stamp, choice.patch);

  if (request.direction === 'between') {
    const line = edges.find(e => e.id === request.edgeId);
    if (!line) return refuse('That line is no longer on the map.');
    const source = nodes.find(n => n.id === line.source);
    const target = nodes.find(n => n.id === line.target);
    if (!source || !target) return refuse('That line is no longer on the map.');
    const port = exitPort(source, line.sourceHandle || null);
    if (neverApplies(request, choice, port, source)) {
      return refuse(exitRefusal(port?.handle ?? null, choice.type) || endSentence(`${choice.label} cannot go between ${named(source)} and ${named(target)}`));
    }
    const a = centreOf(source);
    const b = centreOf(target);
    const node = build({ x: (a.x + b.x) / 2 - size.width / 2, y: (a.y + b.y) / 2 - size.height / 2 }, 1);
    return insertLine(nodes, edges, line.id, node, stamp);
  }

  const anchor = nodes.find(n => n.id === request.anchorId);
  if (!anchor) return refuse('That step is no longer on the map.');
  const anchorName = named(anchor);

  if (request.direction === 'before') {
    if (!hasMainInput(anchor.type as NodeType)) return refuse(`${anchorName} starts the journey, so nothing can go before it.`);
    if (neverApplies(request, choice, undefined, anchor)) return refuse(endSentence(`${choice.label} cannot lead into ${anchorName}`));
    const node = build(preferredSlot(request, anchor, undefined, 0, size), -1);
    const line = makeLine(node.id, null, anchor.id, null, anchor.data, stamp, node.data);
    return {
      ok: true,
      node,
      edges: [...edges, line],
      added: [line],
      removed: [],
      summary: endSentence(`Added ${named(node)} before ${anchorName}`)
    };
  }

  const ports = STEP_PORTS[anchor.type as NodeType];
  const port = exitPort(anchor, request.handle);
  if (!port) return refuse(`${anchorName} has no exit like that.`);
  if (neverApplies(request, choice, port, anchor)) {
    if (RETENTION_PRESETS.has(choice.key)) return refuse('Recovery emails start from the bottom dot of a page or an offer.');
    return refuse(exitRefusal(port.handle, choice.type) || endSentence(`${choice.label} cannot come after ${anchorName}`));
  }
  const sameSide = ports.exits.filter(p => p.side === port.side);
  const node = build(preferredSlot(request, anchor, port.side, Math.max(0, sameSide.indexOf(port)), size), 1);
  const isFollowUp = choice.type === 'follow-up-sequence';
  // Only from the main exit do emails run alongside the next step (#13's isFollowUpLine).
  const alongside = isFollowUpLine(request.handle, choice.type);
  const lines = routingLines(nodes, edges, anchor.id, request.handle);

  if (alongside || lines.length === 0) {
    const targetHandle = isFollowUp && port.side === 'bottom' ? 'retention-in' : null;
    const line = makeLine(anchor.id, request.handle, node.id, targetHandle, node.data, stamp, anchor.data);
    return {
      ok: true,
      node,
      edges: [...edges, line],
      added: [line],
      removed: [],
      summary: alongside && lines.length > 0
        ? `${endSentence(`Added ${named(node)}`)} It runs alongside the next step.`
        : endSentence(`Added ${named(node)} after ${anchorName}`)
    };
  }
  if (lines.length === 1 && isFollowUp) {
    // A named exit carries one line, and emails cannot go in between: say which line holds it.
    const target = named(nodes.find(n => n.id === lines[0].target));
    return refuse(`${anchorName} already leads to ${target} from its ${port.label} exit, so ${choice.label.toLowerCase()} cannot go there too.`);
  }
  if (lines.length === 1) return insertLine(nodes, edges, lines[0].id, node, stamp);
  return refuse(`${anchorName} already leads to ${lines.length} steps from this exit. Select one of its lines and use + Step instead.`);
}

export type PlanCheck = { ok: true; keptFanOut: string[] } | { ok: false; message: string };

/**
 * The one #13 check for a plan, before it is committed. Each added line goes through
 * checkConnection on the map without the lines the plan removes. A refusal stops the plan. A
 * Replace is accepted only for an old fan-out the plan keeps as it was: the exit had two or more
 * routing lines, has no more after the plan, and the lines the Replace names were on the map
 * before it. Those lines are listed in keptFanOut and must stay: never pass them to withConnection.
 * Any other Replace means the plan would fan an exit out, and it is refused.
 */
export function checkPlan(plan: AddPlan, nodes: JourneyNode[], edges: JourneyEdge[]): PlanCheck {
  if (!plan.ok) return { ok: false, message: plan.reason };
  const all = plan.node && !nodes.some(n => n.id === plan.node!.id) ? [...nodes, plan.node] : nodes;
  const removed = new Set(plan.removed);
  const addedIds = new Set(plan.added.map(e => e.id));
  const kept = new Set<string>();
  let current = edges.filter(e => !removed.has(e.id));
  for (const line of plan.added) {
    const verdict = checkConnection(line, all, current);
    if (verdict.kind === 'refuse') return { ok: false, message: verdict.message };
    if (verdict.kind === 'replace') {
      const handle = line.sourceHandle || null;
      const before = routingLines(all, edges, line.source, handle).length;
      const after = routingLines(all, plan.edges, line.source, handle).length;
      if (before < 2 || after > before || verdict.existing.some(e => addedIds.has(e.id))) {
        return { ok: false, message: `${named(all.find(n => n.id === line.source))} would lead to more than one step from this exit.` };
      }
      for (const e of verdict.existing) kept.add(e.id);
    }
    current = [...current, line];
  }
  return { ok: true, keptFanOut: [...kept] };
}

/**
 * A loose step dropped onto a line. A step that already has any line is only moved, never
 * rewired: that answers ok false with an empty reason. Positions are never changed here.
 */
export function dropOnLine(nodes: JourneyNode[], edges: JourneyEdge[], edgeId: string, nodeId: string, stamp: string): AddPlan {
  const node = nodes.find(n => n.id === nodeId);
  const line = edges.find(e => e.id === edgeId);
  if (!node || !line) return refuse('');
  if (edges.some(e => e.source === nodeId || e.target === nodeId)) return refuse('');
  const plan = insertLine(nodes, edges, edgeId, node, stamp);
  if (!plan.ok) return plan;
  const a = named(nodes.find(n => n.id === line.source));
  const b = named(nodes.find(n => n.id === line.target));
  return { ...plan, summary: endSentence(`Inserted ${named(node)} between ${a} and ${b}`) };
}

// ---- Hit testing and reveal ----

function distanceToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The id of the polyline nearest to `point` within maxDistance, else null. */
export function nearestLine(point: XY, samples: Record<string, XY[]>, maxDistance: number): string | null {
  let best: string | null = null;
  let bestDistance = maxDistance;
  for (const [id, points] of Object.entries(samples)) {
    if (!points || points.length === 0) continue;
    let d = points.length === 1 ? Math.hypot(point.x - points[0].x, point.y - points[0].y) : Infinity;
    for (let i = 1; i < points.length; i++) d = Math.min(d, distanceToSegment(point, points[i - 1], points[i]));
    if (d <= bestDistance) {
      best = id;
      bestDistance = d;
    }
  }
  return best;
}

export interface FlowRectangle { x: number; y: number; width: number; height: number }

/**
 * The part of the map a person can see, in flow coordinates, leaving out an overlay insetRight
 * screen pixels wide on the right (the step panel). Screen = flow * zoom + offset.
 */
export function visibleFlowRect(viewport: { x: number; y: number; zoom: number }, size: Size, insetRight = 0): FlowRectangle {
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
  return {
    x: -viewport.x / zoom,
    y: -viewport.y / zoom,
    width: Math.max(0, size.width - insetRight) / zoom,
    height: Math.max(0, size.height) / zoom
  };
}

/** True unless `rect` lies fully inside `view`. */
export function needsReveal(rect: FlowRectangle, view: FlowRectangle): boolean {
  return !(rect.x >= view.x && rect.y >= view.y
    && rect.x + rect.width <= view.x + view.width
    && rect.y + rect.height <= view.y + view.height);
}
