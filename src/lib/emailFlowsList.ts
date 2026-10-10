/**
 * Email Studio's Flows list (EMAIL_STUDIO_PLAN.md Wave 4, decisions D1 to D3): one list of every
 * flow, drawn from one read of GET /api/email/flow-map. That read holds the account's own flows, the
 * two built-in flows, the five starter flows and, last, the four order emails as one-email flows.
 * Hub flows (export only) are not here: they come from GET /api/email/flows and sit in a collapsed
 * group under this list.
 *
 * This is the row model: pure data and pure words, no React and no fetch, so node tests import this
 * file straight from the .ts (email-flows-list.test.mjs). Every figure a row shows is read from the
 * flow itself, never written in: the number of emails is counted from its steps, its start is worded
 * by the server's own TRIGGER_META, and On or Off is the flow's own `enabled`.
 */
import { FLOW_MAP_UNREACHABLE } from './flowMapLoad.ts';

export type FlowListKind = 'flow' | 'automation' | 'sequence' | 'order';

/** D2's row tags. An account's own flow has none. */
export type FlowTag = 'Starter' | 'Built in' | 'Order email' | '';

export const FLOW_TAGS: Readonly<Record<FlowListKind, FlowTag>> = {
  flow: '',
  automation: 'Built in',
  sequence: 'Starter',
  order: 'Order email'
};

/** One start, as the server words it (email-flows.mjs TRIGGER_META). */
export interface TriggerWord {
  id: string;
  label: string;
}

/** The parts of a flow-map row the list reads. */
export interface FlowListInput {
  id: string;
  name: string;
  kind: string;
  enabled?: boolean;
  trigger?: string;
  /** Wave 2: `starterDraft` marks a starter email the server reports as still the seeded draft. */
  nodes?: { id: string; type: string; starterDraft?: boolean }[];
  enrolled?: number | null;
}

export interface FlowRow {
  id: string;
  name: string;
  kind: FlowListKind;
  tag: FlowTag;
  /** The order emails are their own group at the foot of the list (D1). */
  group: 'flows' | 'order';
  /** "Starts when", in words. */
  startsWhen: string;
  on: boolean;
  /** Counted from the flow's own steps. */
  emails: number;
  /**
   * Wave 2: how many of its emails the server marks as still the starter draft, which the sender skips.
   * Counted from the marks, so the list never reads an email's words.
   */
  drafts: number;
  /** What the server measured, or null. Printed through statText, so null reads Unavailable. */
  enrolled: number | null;
  /** The step the row opens on (D3: its first email), or '' for a flow with no email. */
  firstEmailId: string;
  /**
   * How the list turns this flow on or off (switchRequest): 'flow' through POST /api/email/flows/:id (an
   * account's own flow), 'sequence' through POST /api/email/flow-content/:id (a starter flow, on this
   * account only, Wave 2), the other two as the kind POST /api/email/programs/:id takes.
   */
  toggleKind: 'flow' | 'automation' | 'transactional' | 'sequence';
}

/**
 * Starts TRIGGER_META has no entry for: three of the starter flows' own trigger types
 * (server.mjs INITIAL_DRIP_SEQUENCES). The review request is enrolled from the Shopify fulfillment
 * webhook (shopifyRoutes.mjs), the event TRIGGER_META words as order_fulfilled, so it reads that.
 * The other two have no TRIGGER_META event at all and are worded from where they are enrolled.
 */
export const START_ALIASES: Readonly<Record<string, string>> = {
  fulfillment_review: 'order_fulfilled'
};
export const START_WORDS: Readonly<Record<string, string>> = {
  // publicRoutes.mjs: enrolled when someone declines the offer on an upsell page.
  upsell_recovery: 'Declined an upsell offer',
  // server.mjs, the automatic winback: enrolled when a buyer crosses the at-risk mark.
  at_risk_inactivity: 'Became at risk'
};

const own = (table: Readonly<Record<string, string>>, key: string) =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : '';

/** "Starts when", in words: TRIGGER_META's label, then an alias of it, then the starters' own words. */
export function startsWhenText(trigger: string | undefined | null, triggers: readonly TriggerWord[]): string {
  const id = String(trigger || '');
  if (!id) return 'Not set';
  const label = (key: string) => triggers.find((row) => row && row.id === key)?.label || '';
  return label(id) || label(own(START_ALIASES, id)) || own(START_WORDS, id) || id.replace(/_/g, ' ');
}

/** An email on a flow map: an Email step, or an A/B step, which sends one of its variations (email-flows.mjs). */
export const SENDS_AN_EMAIL = new Set(['email', 'ab']);

export function emailCount(nodes: FlowListInput['nodes']): number {
  return (Array.isArray(nodes) ? nodes : []).filter((node) => node && SENDS_AN_EMAIL.has(node.type)).length;
}

export function emailCountText(count: number): string {
  if (count === 0) return 'No emails';
  return count === 1 ? '1 email' : `${count} emails`;
}

const KINDS = new Set<FlowListKind>(['flow', 'automation', 'sequence', 'order']);

/**
 * The rows of the Flows list, from a flow-map payload. Each flow is listed once (the first row with
 * an id wins), in the order the server sends them; a row without an id or a name is dropped, and so
 * is a kind this list does not know, rather than shown as an account's own flow. Once by id is enough:
 * the editor opens a flow by its id alone, and the four kinds' ids cannot meet (an account flow's id
 * is flow_ and letters, email-flows.mjs cleanFlow; a starter's drip_seq_; the built-in and order ids
 * are fixed).
 */
export function flowRows(flows: unknown, triggers: unknown): FlowRow[] {
  const words: TriggerWord[] = Array.isArray(triggers) ? triggers.filter((row) => row && typeof row.id === 'string') : [];
  const seen = new Set<string>();
  const rows: FlowRow[] = [];
  for (const raw of Array.isArray(flows) ? flows : []) {
    const flow = raw as FlowListInput;
    if (!flow || typeof flow.id !== 'string' || !flow.id || typeof flow.name !== 'string' || !flow.name) continue;
    if (!KINDS.has(flow.kind as FlowListKind)) continue;
    if (seen.has(flow.id)) continue;
    seen.add(flow.id);
    const kind = flow.kind as FlowListKind;
    const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    rows.push({
      id: flow.id,
      name: flow.name,
      kind,
      tag: FLOW_TAGS[kind],
      group: kind === 'order' ? 'order' : 'flows',
      startsWhen: startsWhenText(flow.trigger, words),
      // A starter flow is on unless this account turned it off (the server sends its own switch).
      on: kind === 'sequence' ? flow.enabled !== false : flow.enabled === true,
      emails: emailCount(nodes),
      drafts: nodes.filter((node) => node && SENDS_AN_EMAIL.has(node.type) && node.starterDraft === true).length,
      enrolled: typeof flow.enrolled === 'number' && Number.isFinite(flow.enrolled) ? flow.enrolled : null,
      firstEmailId: nodes.find((node) => node && SENDS_AN_EMAIL.has(node.type))?.id || '',
      toggleKind: kind === 'flow' ? 'flow' : kind === 'automation' ? 'automation' : kind === 'order' ? 'transactional' : 'sequence'
    });
  }
  return rows;
}

/**
 * Where a row's Turn on or Turn off is sent and what it sends: only whether the flow is on, plus the
 * kind POST /api/email/programs/:id needs, never its steps, so a stale list cannot overwrite an edit
 * made in the editor. A starter flow is switched for this account only (Wave 2).
 */
export function switchRequest(row: Pick<FlowRow, 'id' | 'toggleKind'>, next: boolean): { url: string; body: Record<string, unknown> } {
  const id = encodeURIComponent(row.id);
  if (row.toggleKind === 'flow') return { url: `/api/email/flows/${id}`, body: { enabled: next } };
  if (row.toggleKind === 'sequence') return { url: `/api/email/flow-content/${id}`, body: { enabled: next } };
  return { url: `/api/email/programs/${id}`, body: { kind: row.toggleKind, enabled: next } };
}

// ---- Open list (2026-10-09): All flows in groups, a row's state, the figures it shows ----

/**
 * All flows in groups, each its own list under its own heading, in this order: the account's own flows
 * (with New flow), the starter flows, the built-in flows, then the order emails. The hub's flows (export
 * only) are not rows: HubEmailSuite draws them as a closed group under this list. Within a group the rows
 * keep the order the server sent them in, so every row is in exactly one group, once.
 */
export const FLOW_GROUPS: readonly { kind: FlowListKind; heading: string }[] = [
  { kind: 'flow', heading: 'Your flows' },
  { kind: 'sequence', heading: 'Starter flows' },
  { kind: 'automation', heading: 'Built-in flows' },
  { kind: 'order', heading: 'Order emails' }
];

export function groupFlowRows<T extends Pick<FlowRow, 'kind'>>(rows: readonly T[]): { kind: FlowListKind; heading: string; rows: T[] }[] {
  return FLOW_GROUPS.map((group) => ({ ...group, rows: rows.filter((row) => row.kind === group.kind) }));
}

/**
 * A row's state in words. On alone is said only when the sender would send its emails: a starter flow
 * that is on while every email in it is still the seeded draft sends nothing, and the row says so, and
 * one with some drafts says how many. Off says the drafts too, so turning it on is not a surprise.
 */
export function flowStateText(row: Pick<FlowRow, 'on' | 'emails' | 'drafts'>): string {
  const word = row.on ? 'On' : 'Off';
  const drafts = Math.max(0, Math.min(row.drafts, row.emails));
  if (!drafts) return word;
  if (drafts === row.emails) return row.on ? 'On, nothing sends yet: every email is still a draft' : 'Off, and every email is still a draft';
  const part = drafts === 1 ? `1 of ${row.emails} emails is still a draft` : `${drafts} of ${row.emails} emails are still drafts`;
  return row.on ? `On, ${part} and ${drafts === 1 ? 'is' : 'are'} not sent` : `Off, ${part}`;
}

/** True when the sender skips at least one of a row's emails while the row reads On. */
export function stateWarns(row: Pick<FlowRow, 'on' | 'drafts'>): boolean {
  return row.on && row.drafts > 0;
}

/**
 * Said once under All flows, never per row: a row shows Enrolled and Last-touch revenue only when the
 * server sent a number. The flow map sends an enrolled count for an account's own flows only, and null
 * there until someone has joined (email-map.mjs enrollmentCount); a starter flow's revenue is null until
 * an order is traced to one of its emails (server.mjs sequenceRevenue).
 */
export const FLOWS_FIGURES_UNCOUNTED = "A figure shows on a row only once it is counted. Enrolled counts the people in your own flows; Last-touch revenue shows once an order is traced to a starter flow's email.";

/** Whether the list leaves out a figure on any row, so FLOWS_FIGURES_UNCOUNTED is said. */
export function figuresLeftOut(rows: readonly Pick<FlowRow, 'id' | 'kind' | 'group' | 'enrolled'>[], revenueOf: (id: string) => number | null | undefined): boolean {
  const counted = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  return rows.some((row) => (row.group === 'flows' && !counted(row.enrolled)) || (row.kind === 'sequence' && !counted(revenueOf(row.id))));
}

// ---- The steps of one flow, named (the editor's step list and the map's steps) ----

/** The fields of a flow step its name is made from (email-flows.mjs node shape). */
export interface FlowStepInput {
  id: string;
  type: string;
  subject?: string;
  message?: string;
  status?: string;
  klaviyoFlowId?: string;
  starterDraft?: boolean;
  delayHours?: number;
  delayMinutes?: number | null;
  mode?: string;
  clockHour?: number;
  clockMinute?: number;
  weekdays?: number[];
}

const WEEKDAY_WORDS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const clip = (text: unknown, max = 80): string => {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim();
  return words.length > max ? `${words.slice(0, max - 1).trimEnd()}…` : words;
};

/** How long a Wait step waits, in words: "24 hours", "1 hour", "90 minutes", or "until 09:00 on Monday". */
export function waitWords(node: Pick<FlowStepInput, 'mode' | 'delayHours' | 'delayMinutes' | 'clockHour' | 'clockMinute' | 'weekdays'>): string {
  if (node.mode === 'clock') {
    const time = `${String(node.clockHour || 0).padStart(2, '0')}:${String(node.clockMinute || 0).padStart(2, '0')}`;
    const days = (Array.isArray(node.weekdays) ? node.weekdays : []).map((day) => WEEKDAY_WORDS[day]).filter(Boolean).join(', ');
    return `until ${time}${days ? ` on ${days}` : ''}`;
  }
  const minutes = typeof node.delayMinutes === 'number' && Number.isFinite(node.delayMinutes) ? node.delayMinutes : (Number(node.delayHours) || 0) * 60;
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * One step's name, the same on the map and in the step list: "Email 2 of 3: <subject>" (with what the
 * map box also says: its status, Klaviyo, starter draft), "Wait 24 hours", "Text 1 of 2: <message>",
 * "Starts when: <start>". Counted the way the step panel's heading counts ("Email 2 of 3"), so the
 * button and the heading it moves focus to agree. Any other kind answers '' and the editor names it.
 */
export function flowStepName(node: FlowStepInput, nodes: readonly FlowStepInput[], startsWhen = ''): string {
  const list = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
  const nth = (type: string): [number, number] => {
    const same = list.filter((item) => item.type === type);
    return [same.findIndex((item) => item.id === node.id) + 1, same.length];
  };
  if (node.type === 'trigger') return startsWhen ? `Starts when: ${startsWhen}` : 'Start';
  if (node.type === 'email') {
    const [at, of] = nth('email');
    const marks = [node.status && node.status !== 'live' ? node.status : '', node.klaviyoFlowId ? 'Klaviyo' : '', node.starterDraft === true ? 'starter draft' : ''].filter(Boolean);
    return `Email ${at} of ${of}: ${clip(node.subject) || 'No subject yet'}${marks.length ? `, ${marks.join(', ')}` : ''}`;
  }
  if (node.type === 'delay') return `Wait ${waitWords(node)}`;
  if (node.type === 'sms') {
    const [at, of] = nth('sms');
    return `Text ${at} of ${of}: ${clip(node.message) || 'No message yet'}`;
  }
  return '';
}

/**
 * The steps in the order a person meets them: from the start along each step's edges, each branch in
 * the order its edges are listed, then any step nothing leads to, in the order the flow lists them.
 * Each step once.
 */
export function flowStepOrder<T extends { id: string; type: string }>(nodes: readonly T[], edges: readonly { source: string; target: string }[]): T[] {
  const list = (Array.isArray(nodes) ? nodes : []).filter((node) => node && typeof node.id === 'string');
  const byId = new Map(list.map((node) => [node.id, node]));
  const out: T[] = [];
  const seen = new Set<string>();
  const start = list.find((node) => node.type === 'trigger');
  const queue = start ? [start.id] : [];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    out.push(byId.get(id) as T);
    for (const edge of Array.isArray(edges) ? edges : []) if (edge && edge.source === id) queue.push(edge.target);
  }
  for (const node of list) if (!seen.has(node.id)) { seen.add(node.id); out.push(node); }
  return out;
}

/** D6: what the step panel says on a starter email the server reports as still the seeded draft. */
export const STARTER_DRAFT_NOTE = 'This email is still the starter draft, so it is skipped and not sent. Edit it and save to send it.';

/**
 * Wave 2: what Turn off says for a starter flow. Nobody new joins it (every enrollment point asks), and
 * the sender takes out anyone whose next email comes due while it is off (server.mjs
 * processUserAutomationsTick, the drip enrolments and the cart reminders), so Turn on sends no backlog.
 */
export function starterOffNotice(name: string): string {
  return `${name} is off. Nobody new joins it, and anyone already in it whose next email comes due while it is off leaves it, so turning it back on sends nothing they missed.`;
}

/**
 * A row's Turn on or Turn off: the word on the button, and its accessible name, which begins with
 * that word in every state, Saving included (WCAG 2.5.3, Label in Name).
 */
export function switchText(row: Pick<FlowRow, 'name' | 'on'>, busy: boolean): { text: string; label: string } {
  const text = busy ? 'Saving' : row.on ? 'Turn off' : 'Turn on';
  return { text, label: `${text} ${row.name}` };
}

// ---- What the list says when its read did not give it a list (D6) ----

export const FLOWS_SIGN_IN = "Sign in to see this account's flows.";
export const FLOWS_FAILED = 'The flows could not be loaded. Try again in a minute.';
/** D6: a list that loaded with no flow of the account's own (starter, built-in and order rows do not count). */
export const FLOWS_EMPTY = 'No flows of your own yet. New flow starts one that stays off until you turn it on.';
export const FLOWS_NOT_CONNECTED = 'Email sending is not connected on this server, so nothing in these flows sends yet. Your changes still save.';

export type FlowsListLoad =
  | { state: 'loaded' }
  | { state: 'failed'; text: string; retry: boolean };

/** True when a loaded list holds no flow of the account's own, so the D6 empty sentence is said. */
export function noOwnFlows(rows: readonly Pick<FlowRow, 'kind'>[]): boolean {
  return !rows.some((row) => row.kind === 'flow');
}

/**
 * The outcome of one flow-map read: unanswered (`answered: false`), or answered with an HTTP status
 * and a body. Never "no flows" from a read that failed.
 */
export function flowsListLoad(read: { answered: false } | { answered: true; status: number; data: unknown }): FlowsListLoad {
  if (!read.answered) return { state: 'failed', text: FLOW_MAP_UNREACHABLE, retry: true };
  if (read.status === 401) return { state: 'failed', text: FLOWS_SIGN_IN, retry: false };
  const data = read.data as { success?: unknown; flows?: unknown } | null;
  if (read.status >= 400 || !data || data.success === false || !Array.isArray(data.flows)) {
    return { state: 'failed', text: FLOWS_FAILED, retry: true };
  }
  return { state: 'loaded' };
}
