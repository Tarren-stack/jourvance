import type { JourneyNode, JourneyProject, SequenceNodeData } from '../types/journey';
import { fillVoucherCode } from './sequencePresets.ts';

// The editor round trip: a step on the map opens another editor (Email Studio today), and the
// way back lands on that same step. These are the pure rules, so node tests can hold them and
// the App, the banner, Email Studio and the canvas all read one answer.
//
// The return lives in App state only. A reload lands on the map with no banner.

/** Where Back to funnel goes: one step on one journey, plus the flow that step links to. */
export interface FunnelReturn {
  journeyId: string;
  nodeId: string;
  stepName: string;
  /** The step's linked Jourvance flow id, or '' when it has none. */
  flowId: string;
}

type ProjectRef = Pick<JourneyProject, 'id'> & { nodes: Pick<JourneyNode, 'id' | 'data'>[] };

export const STUDIO_NOT_OPENED = 'Email Studio did not open, because the journey was not saved. Save it, then try again.';
export const LINKED_FLOW_MISSING = 'The flow this step links to was not found. It may have been deleted.';

export function emailStudioButtonLabel(hasFlow: boolean): string {
  return hasFlow ? 'Edit this flow in Email Studio' : 'Build a flow in Email Studio';
}

/** The return record for a follow-up sequence step, or null for any other step or a missing one. */
export function funnelReturnFor(project: ProjectRef, nodeId: string): FunnelReturn | null {
  const node = project.nodes.find((n) => n.id === nodeId);
  if (!node || node.data?.type !== 'follow-up-sequence') return null;
  const data = node.data as { label?: unknown; jourvanceFlowId?: unknown };
  return {
    journeyId: project.id,
    nodeId,
    stepName: String(data.label || '').trim() || 'this step',
    flowId: String(data.jourvanceFlowId || '').trim()
  };
}

/** The step to land on, or null when the return is gone, belongs to another journey, or its step was deleted. */
export function returnStepId(project: ProjectRef, ret: FunnelReturn | null | undefined): string | null {
  if (!ret || ret.journeyId !== project.id) return null;
  return project.nodes.some((n) => n.id === ret.nodeId) ? ret.nodeId : null;
}

/** The banner sentence. It names the step, and says plainly when the step is no longer there. */
export function returnBannerText(project: ProjectRef, ret: FunnelReturn): string {
  if (!returnStepId(project, ret)) return 'The step you came from is no longer on this journey. Back to funnel opens the map.';
  return ret.flowId
    ? `You opened Email Studio from ${ret.stepName}. Save your flow changes here before you go back.`
    : `You opened Email Studio from ${ret.stepName}. Build a flow on the Flow map and save it. Then go back and choose it on that step.`;
}

/**
 * The one save-then-navigate gate. `open` runs only after `save` resolved true. A false, a
 * rejection or any other value keeps the user where they are, and the caller says why.
 */
export async function openAfterSave(save: () => Promise<boolean>, open: () => void): Promise<boolean> {
  let ok = false;
  try { ok = (await save()) === true; } catch { ok = false; }
  if (!ok) return false;
  open();
  return true;
}

/**
 * A deep-link pick. `ids` is null when the list failed to load, and then nothing is reported
 * missing, because an unread list proves nothing about the flow.
 */
export function chooseFlowId(ids: string[] | null, prefer?: string): { id: string; missing: boolean } {
  const found = !!prefer && !!ids?.includes(prefer);
  return { id: found ? (prefer as string) : (ids?.[0] || ''), missing: !!prefer && ids !== null && !found };
}

export interface CanvasFitOptions {
  padding: number;
  nodes?: { id: string }[];
  maxZoom?: number;
}

/**
 * The canvas's initial viewport. A displayed step that is selected is framed at no more than
 * 100% zoom. Otherwise the whole map is fitted. A hidden step never frames an empty area.
 */
export function canvasFitOptions(focusNodeId: string | null | undefined, displayedIds: Iterable<string>): CanvasFitOptions {
  if (focusNodeId) {
    for (const id of displayedIds) {
      if (id === focusNodeId) return { padding: 0.2, nodes: [{ id: focusNodeId }], maxZoom: 1 };
    }
  }
  return { padding: 0.2 };
}

// ---- Build a flow in Email Studio (EMAIL_STUDIO_PLAN.md Wave 7, D3 and D7) ----
//
// A sequence step with no linked flow builds one from its own letters: each letter becomes an email
// (subject, preview text, its paragraphs as text blocks) or a text, and each letter's delay becomes a
// wait before it. The flow is created off through POST /api/email/flows, the step links it, the
// journey saves through openAfterSave, and Email Studio opens on it (rule 1 holds).

/** The flow a build made, as the step records it. */
export interface StepFlowLink {
  id: string;
  name: string;
}

/** A flow node or line as POST /api/email/flows takes it (email-flows.mjs cleanFlow). */
export type StepFlowNode = Record<string, unknown> & { id: string; type: string };
export interface StepFlowEdge {
  id: string;
  source: string;
  target: string;
  branch: '';
}
export interface StepFlowDraft {
  name: string;
  trigger: string;
  nodes: StepFlowNode[];
  edges: StepFlowEdge[];
}
export type StepFlowPlan = { ok: true; flow: StepFlowDraft } | { ok: false; error: string };

// The server's own caps (email-flows.mjs messageFields and cleanFlow, email-doc.mjs cleanBlock and
// cleanBlockList). A letter past one is refused here, by name, so the server never cuts it short.
export const STEP_FLOW_LIMITS = { subject: 200, previewText: 140, text: 480, paragraph: 4000, paragraphs: 24, nodes: 60, waitMinutes: 90 * 24 * 60 };

/**
 * What starts a flow built from a step: the step's own kind where a flow start matches it, otherwise
 * By hand. A lead or an exit offer from a page on the map joins a linked flow whatever its start
 * (email-map.mjs linkedFlowIds, server.mjs enrollLinkedMapFlows), so a lead step's flow is By hand:
 * "New lead" would also take every lead from every other page on the account. A declined upsell has
 * no flow start. The labels are TRIGGER_META's (email-flows.mjs); flow-from-step.test.mjs holds them equal.
 */
const STEP_STARTS: Record<string, { trigger: string; label: string }> = {
  checkout_recovery: { trigger: 'checkout_abandonment', label: 'Left checkout' },
  at_risk_winback: { trigger: 'quiet_buyer', label: 'Quiet buyer' },
  fulfillment_review: { trigger: 'order_fulfilled', label: 'Order fulfilled' }
};
const BY_HAND = { trigger: 'manual', label: 'By hand' };

export function flowStartForStep(sequenceType: unknown): { trigger: string; label: string } {
  const key = String(sequenceType || '');
  return Object.prototype.hasOwnProperty.call(STEP_STARTS, key) ? STEP_STARTS[key] : BY_HAND;
}

const UNIT_MINUTES: Record<string, number> = { m: 1, h: 60, d: 24 * 60, w: 7 * 24 * 60 };

/**
 * A letter's delay in minutes, or null when its words cannot be read as a wait. "Instant (0m)",
 * "24 Hours", "3 Days (72h)" and "90 minutes" read; blank or "soon" does not, because a delay that
 * will not parse is not a delay of zero.
 */
export function letterDelayMinutes(delay: unknown): number | null {
  const text = String(delay ?? '').trim().toLowerCase();
  if (!text) return null;
  if (/^(instant|immediately|right away|no delay|none)\b/.test(text)) return 0;
  const m = /^(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?)\b/.exec(text);
  if (!m) return null;
  const minutes = Math.round(Number(m[1]) * UNIT_MINUTES[m[2][0]]);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

// The canvas letters' merge tags, in the flow sender's words (server.mjs fillMailTokens). A voucher
// code is filled only when the step has one, through the editor's own helper.
const STEP_TAGS: [RegExp, string][] = [
  [/\[First Name\]/g, '{{first_name}}'],
  [/\[Checkout Link\]/g, '{{checkout_url}}'],
  [/\[Offer Link\]/g, '{{offer_url}}'],
  [/\[Review Link\]/g, '{{review_url}}']
];

type StepLetters = Pick<SequenceNodeData, 'label' | 'sequenceTitle' | 'steps' | 'sequenceType' | 'voucherCode'>;

/** The flow a step's letters make, or the one sentence that says which letter stops it. */
export function flowFromStepLetters(data: StepLetters): StepFlowPlan {
  const L = STEP_FLOW_LIMITS;
  const letters = Array.isArray(data?.steps) ? data.steps : [];
  const name = (String(data?.label || '').trim() || String(data?.sequenceTitle || '').trim() || 'Flow from the funnel map').slice(0, 80);
  const fill = (text: unknown) => STEP_TAGS.reduce((out, [re, to]) => out.replace(re, to), fillVoucherCode(String(text ?? ''), data?.voucherCode));
  const nodes: StepFlowNode[] = [{ id: 'n_start', type: 'trigger' }];
  const edges: StepFlowEdge[] = [];
  let last = 'n_start';
  const add = (node: StepFlowNode) => {
    nodes.push(node);
    edges.push({ id: `e_${edges.length + 1}`, source: last, target: node.id, branch: '' });
    last = node.id;
  };
  const emailNode = (id: string, subject: string, previewText: string, paragraphs: string[]): StepFlowNode => ({
    id, type: 'email', subject, previewText,
    blocks: (paragraphs.length ? paragraphs : ['']).map((text, b) => ({ id: `${id}_b${b + 1}`, kind: 'text', text }))
  });
  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i];
    const sms = letter?.channel === 'sms';
    const what = `${sms ? 'Text' : 'Email'} ${i + 1}`;
    const delay = String(letter?.delay ?? '').trim();
    const minutes = letterDelayMinutes(delay);
    if (!delay) return { ok: false, error: `${what} has no delay. Write one, such as Instant, 24 Hours or 3 Days.` };
    if (minutes === null) return { ok: false, error: `${what}'s delay "${delay}" could not be read as a wait. Write it as Instant, or in minutes, hours or days, such as 24 Hours or 3 Days.` };
    if (minutes > L.waitMinutes) return { ok: false, error: `${what} waits longer than 90 days, the longest wait a flow can hold.` };
    if (minutes > 0) add({ id: `n_wait_${i + 1}`, type: 'delay', mode: 'duration', delayMinutes: minutes });
    if (sms) {
      const message = fill(letter?.body).trim();
      if (message.length > L.text) return { ok: false, error: `${what} is longer than ${L.text} characters, the most a text can hold.` };
      add({ id: `n_text_${i + 1}`, type: 'sms', message, status: message ? 'live' : 'draft' });
      continue;
    }
    const subject = fill(letter?.subject).trim();
    const previewText = fill(letter?.previewText).trim();
    const paragraphs = fill(letter?.body).split(/\n[ \t]*\n/).map(p => p.trim()).filter(Boolean);
    if (subject.length > L.subject) return { ok: false, error: `${what}'s subject is longer than ${L.subject} characters, the most a flow email can hold.` };
    if (previewText.length > L.previewText) return { ok: false, error: `${what}'s preview text is longer than ${L.previewText} characters, the most a flow email can hold.` };
    if (paragraphs.length > L.paragraphs) return { ok: false, error: `${what} has more than ${L.paragraphs} paragraphs, the most a flow email can hold.` };
    if (paragraphs.some(p => p.length > L.paragraph)) return { ok: false, error: `${what} has a paragraph longer than ${L.paragraph} characters, the most one text block can hold.` };
    add(emailNode(`n_mail_${i + 1}`, subject, previewText, paragraphs));
  }
  // A step with no letters makes what New flow makes: one empty email to write in Email Studio.
  if (letters.length === 0) add(emailNode('n_mail_1', '', '', []));
  if (nodes.length > L.nodes) return { ok: false, error: `This step has too many letters for one flow. A flow can have ${L.nodes} steps, and a letter with a delay takes two.` };
  return { ok: true, flow: { name, trigger: flowStartForStep(data?.sequenceType).trigger, nodes, edges } };
}

/** The journey with one sequence step linked to a flow, or null when that step is not a sequence step on it. */
export function linkStepToFlow<P extends { nodes: JourneyNode[]; updatedAt: string }>(project: P, nodeId: string, flow: StepFlowLink, stamp: string): P | null {
  const node = project.nodes.find(n => n.id === nodeId);
  if (!node || node.data?.type !== 'follow-up-sequence') return null;
  return {
    ...project,
    nodes: project.nodes.map(n => (n.id === nodeId
      ? { ...n, data: { ...n.data, jourvanceFlowId: flow.id, jourvanceFlowName: flow.name } as JourneyNode['data'] }
      : n)),
    updatedAt: stamp
  };
}

/** Said in the step's status region while a build is on its way (the button's own label changes too). */
export const FLOW_BUILDING = 'Building a flow from this step’s letters. Email Studio opens on it once the journey is saved.';
export const FLOW_NOT_BUILT_SIGN_IN = 'Sign in to build a flow from this step.';
export const FLOW_NOT_BUILT_UNANSWERED = 'The flow was not built, because the server did not answer. Try again in a minute.';

/** The sentence for a build the server refused: its own reason when it gave one. */
export function flowNotBuilt(status: number, error?: unknown): string {
  if (status === 401) return FLOW_NOT_BUILT_SIGN_IN;
  const said = typeof error === 'string' ? error.trim() : '';
  return said ? `The flow was not built. ${said}` : 'The flow was not built. Try again in a minute.';
}

/** What an unlinked step's letters are for, under Flow Steps. */
export function stepLettersSource(startLabel: string): string[] {
  return [
    'Build a flow in Email Studio turns these letters into a flow: each letter becomes an email, and each delay a wait.',
    `Starts when: ${startLabel}. People who join from a page on this map are added through this step. The flow stays off until you turn it on.`
  ];
}

/** Above a linked step's own letters, in Inbox Preview and Export: they are kept, and nothing sends them. */
export function linkedLettersNote(flowName: string): string {
  return `These are this step's own letters. They are kept, but nothing sends them. People who join from a page on this map get the emails in ${flowName} once it is on.`;
}

export const LINKED_FLOW_UNREAD = 'The emails in the linked flow could not be loaded. Close this step and open it again to try again.';

export interface LinkedFlowLine {
  /** "Email 2" or "Text 3", numbered in the order the flow reaches them. */
  label: string;
  /** "right away", "after 1 day", "at a set time". */
  wait: string;
  /** The subject, or a text's first words. */
  words: string;
}

function waitWords(minutes: number, clock: boolean): string {
  if (clock) return 'at a set time';
  if (minutes <= 0) return 'right away';
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  if (minutes % 1440 === 0) return `after ${unit(minutes / 1440, 'day')}`;
  if (minutes % 60 === 0) return `after ${unit(minutes / 60, 'hour')}`;
  return `after ${unit(minutes, 'minute')}`;
}

type FlowLike = { nodes?: unknown; edges?: unknown } | null | undefined;

/**
 * A linked flow's emails and texts in the order the flow reaches them from its start, each with the
 * wait before it, for the step's read-only summary. `branches` is true when the flow has more than one
 * path, because a list cannot show which email is on which path.
 */
export function linkedFlowEmails(flow: FlowLike): { lines: LinkedFlowLine[]; branches: boolean } {
  type N = { id?: unknown; type?: unknown; subject?: unknown; message?: unknown; delayMinutes?: unknown; mode?: unknown };
  type E = { source?: unknown; target?: unknown };
  const nodes = (Array.isArray(flow?.nodes) ? flow.nodes : []) as N[];
  const edges = (Array.isArray(flow?.edges) ? flow.edges : []) as E[];
  const byId = new Map(nodes.map(n => [String(n?.id ?? ''), n]));
  const outs = (id: string) => edges.filter(e => String(e?.source ?? '') === id).map(e => String(e?.target ?? ''));
  const branches = nodes.some(n => n?.type === 'condition' || n?.type === 'ab' || outs(String(n?.id ?? '')).length > 1);
  const start = nodes.find(n => n?.type === 'trigger');
  const lines: LinkedFlowLine[] = [];
  if (!start) return { lines, branches };
  const seen = new Set([String(start.id)]);
  const queue: { id: string; waited: number; clock: boolean }[] = [{ id: String(start.id), waited: 0, clock: false }];
  let emails = 0;
  let texts = 0;
  while (queue.length) {
    const at = queue.shift()!;
    for (const target of outs(at.id)) {
      const node = byId.get(target);
      if (!node || seen.has(target)) continue;
      seen.add(target);
      let waited = at.waited;
      let clock = at.clock;
      if (node.type === 'delay') {
        if (node.mode === 'clock') clock = true;
        else waited += Math.max(0, Number(node.delayMinutes) || 0);
      } else if (node.type === 'email' || node.type === 'ab') {
        emails += 1;
        lines.push({ label: `Email ${emails}`, wait: waitWords(waited, clock), words: String(node.subject || '').trim() || 'No subject yet' });
        waited = 0;
        clock = false;
      } else if (node.type === 'sms') {
        texts += 1;
        const words = String(node.message || '').trim();
        lines.push({ label: `Text ${texts}`, wait: waitWords(waited, clock), words: words ? (words.length > 80 ? `${words.slice(0, 79)}…` : words) : 'No message yet' });
        waited = 0;
        clock = false;
      }
      queue.push({ id: target, waited, clock });
    }
  }
  return { lines, branches };
}
