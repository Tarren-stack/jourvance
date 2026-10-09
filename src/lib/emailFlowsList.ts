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
  nodes?: { id: string; type: string }[];
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
  /** What the server measured, or null. Printed through statText, so null reads Unavailable. */
  enrolled: number | null;
  /** The step the row opens on (D3: its first email), or '' for a flow with no email. */
  firstEmailId: string;
  /**
   * How the list turns this flow on or off: 'flow' through POST /api/email/flows/:id (an account's own
   * flow), the other two as the kind POST /api/email/programs/:id takes. Null for a starter flow, which
   * has no switch (the server sends it as always on).
   */
  toggleKind: 'flow' | 'automation' | 'transactional' | null;
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
      // A starter flow has no switch until Wave 2, and the server sends it as on.
      on: kind === 'sequence' ? flow.enabled !== false : flow.enabled === true,
      emails: emailCount(nodes),
      enrolled: typeof flow.enrolled === 'number' && Number.isFinite(flow.enrolled) ? flow.enrolled : null,
      firstEmailId: nodes.find((node) => node && SENDS_AN_EMAIL.has(node.type))?.id || '',
      toggleKind: kind === 'flow' ? 'flow' : kind === 'automation' ? 'automation' : kind === 'order' ? 'transactional' : null
    });
  }
  return rows;
}

/** Said where a starter row's switch would be, so the rows that cannot be turned off say why. */
export const STARTER_NO_SWITCH = 'Always on. A starter flow cannot be turned off.';

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
export const FLOWS_NOT_CONNECTED = 'Email sending is not connected on this server, so nothing in these flows sends yet. Your changes still save.';

export type FlowsListLoad =
  | { state: 'loaded' }
  | { state: 'failed'; text: string; retry: boolean };

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
