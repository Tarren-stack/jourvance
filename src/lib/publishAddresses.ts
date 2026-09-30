/**
 * Where each step of a journey is published, decided before anything is written.
 *
 * Publish used to check and write one step at a time, so a refusal on the second page left the
 * first one live while the reply said "Not published". The route now plans every address here
 * first and writes nothing unless every address is free.
 *
 * The server imports this file through Node's type stripping (publicRoutes.mjs does the same with
 * geoCurrency.ts), so it must stay erasable TypeScript with no value imports: no enum, no
 * namespace, no parameter properties.
 *
 * The slug derivations are copied byte for byte from the old publish loop. Changing one moves a
 * live page to a new address on its next publish.
 */

export const PUBLISHED_STEP_TYPES = ['landing-page', 'upsell', 'ab-split'] as const;
export type PublishedStepType = typeof PUBLISHED_STEP_TYPES[number];

export const NOTHING_CHANGED = 'No page was changed.';

export interface PublishNodeLike {
  id: string;
  type?: string;
  data?: Record<string, unknown> | null;
}

export interface PublishAddress {
  nodeId: string;
  type: PublishedStepType;
  slug: string;
  /** True when the user typed the path. A generated one may take a suffix; a chosen one never does. */
  isCustomSlug: boolean;
  /** Landing pages only; '' for upsells and splits. */
  customDomain: string;
  /** The publicPageCache key: the slug for a page, `split:<slug>` for a split. */
  key: string;
  url: string;
}

export interface AddressClash {
  nodeIds: string[];
  address: string;
}

export interface SlugCheckResult {
  available: boolean;
  error?: string;
  /** The owner could not be read. The address is not known to be free, and trying again can help. */
  retryable?: boolean;
}

export interface PlanOptions {
  check: (slug: string, opts: { type: 'page' | 'ab-split'; customDomain: string }) => Promise<SlugCheckResult>;
  suffix: () => string;
}

export type PublishPlan =
  | { ok: true; addresses: PublishAddress[] }
  | { ok: false; nodeIds: string[]; error: string; retryable?: boolean };

export function cleanPublishSlug(raw: unknown): string {
  return String(raw ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
}

export function cleanCustomDomain(raw: unknown): string {
  return String(raw ?? '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

const isPublishedType = (type: unknown): type is PublishedStepType =>
  (PUBLISHED_STEP_TYPES as readonly unknown[]).includes(type);

/** The address a step asks for, before any check. Null for a step that is not published. */
export function draftPublishAddress(node: PublishNodeLike): PublishAddress | null {
  if (!node || !isPublishedType(node.type)) return null;
  const d = (node.data || {}) as Record<string, unknown>;
  const id = String(node.id);
  const isCustomSlug = Boolean(d.slug && String(d.slug).trim());
  if (node.type === 'ab-split') {
    const slug = cleanPublishSlug(d.slug || `${id}-split`) || `split-${id.slice(0, 6)}`;
    return { nodeId: id, type: node.type, slug, isCustomSlug, customDomain: '', key: `split:${slug}`, url: `/p/split/${slug}` };
  }
  const slug = node.type === 'landing-page'
    ? cleanPublishSlug(d.slug || id) || `offer-${id.slice(0, 6)}`
    : cleanPublishSlug(d.slug || `${id}-upsell`) || `upsell-${id.slice(0, 6)}`;
  const customDomain = node.type === 'landing-page' ? cleanCustomDomain(d.customDomain) : '';
  return { nodeId: id, type: node.type, slug, isCustomSlug, customDomain, key: slug, url: `/p/${slug}` };
}

// The upsell editor has no path field, so the step the user can fix is listed first.
const editableFirst = (a: PublishAddress, b: PublishAddress) =>
  Number(a.type === 'upsell') - Number(b.type === 'upsell');

/**
 * Chosen URL paths that two or more steps of one journey share. Synchronous and free of I/O, so
 * an audit or the page editor can warn before Publish is pressed. Pages and splits live in
 * separate namespaces (/p/offer and /p/split/offer). Thank-you and form steps are ignored: the
 * blueprints give a thank-you step its landing page's slug and neither is published under it.
 * Custom domains are not compared.
 */
export function addressClashes(nodes: readonly PublishNodeLike[]): AddressClash[] {
  const byKey = new Map<string, PublishAddress[]>();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const a = draftPublishAddress(node);
    if (!a || !a.isCustomSlug) continue;
    const list = byKey.get(a.key);
    if (list) list.push(a);
    else byKey.set(a.key, [a]);
  }
  const clashes: AddressClash[] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    clashes.push({ nodeIds: [...list].sort(editableFirst).map(a => a.nodeId), address: list[0].url });
  }
  return clashes;
}

const refusal = (nodeIds: string[], sentence: string, retryable = false): PublishPlan =>
  retryable
    ? { ok: false, nodeIds, error: `${sentence} ${NOTHING_CHANGED}`, retryable: true }
    : { ok: false, nodeIds, error: `${sentence} ${NOTHING_CHANGED}` };

const unchecked = (r: SlugCheckResult | null) => Boolean(r && !r.available && r.retryable);

const notAvailable = (a: PublishAddress, r: SlugCheckResult) =>
  (r && r.error) || `The address ${a.url} is not available.`;

const checkOf = (a: PublishAddress) =>
  ({ type: a.type === 'ab-split' ? 'ab-split' as const : 'page' as const, customDomain: a.customDomain });

/**
 * Plans every published address of a journey without writing anything. Chosen paths are checked
 * and claimed first, in node order, so node order never decides whether a chosen path or a
 * generated one wins. A generated path that is claimed or refused takes one `-<suffix>` and is
 * checked again. A check that could not read the owner (retryable) is never suffixed around: the
 * plan fails with retryable set. Checks run one at a time, as they always have.
 */
export async function planPublishAddresses(nodes: readonly PublishNodeLike[], { check, suffix }: PlanOptions): Promise<PublishPlan> {
  const clash = addressClashes(nodes)[0];
  if (clash) {
    return refusal(clash.nodeIds, `Two steps in this journey use the address ${clash.address}. Change the Page URL Path on one of them.`);
  }

  const drafts = (Array.isArray(nodes) ? nodes : [])
    .map(draftPublishAddress)
    .filter((a): a is PublishAddress => a !== null);
  const claimed = new Set<string>();
  const planned = new Map<string, PublishAddress>();

  for (const a of drafts) {
    if (!a.isCustomSlug) continue;
    const r = await check(a.slug, checkOf(a));
    if (!r || !r.available) return refusal([a.nodeId], notAvailable(a, r), unchecked(r));
    claimed.add(a.key);
    planned.set(a.nodeId, a);
  }

  for (const a of drafts) {
    if (a.isCustomSlug) continue;
    let address = a;
    let r: SlugCheckResult | null = claimed.has(address.key) ? null : await check(address.slug, checkOf(address));
    // An address whose owner could not be read may be this user's own live page, so it is not
    // swapped for a suffixed one: that would move the page to a new URL.
    if (unchecked(r)) return refusal([a.nodeId], notAvailable(a, r as SlugCheckResult), true);
    if (!r || !r.available) {
      const slug = `${a.slug}-${suffix()}`;
      address = a.type === 'ab-split'
        ? { ...a, slug, key: `split:${slug}`, url: `/p/split/${slug}` }
        : { ...a, slug, key: slug, url: `/p/${slug}` };
      r = claimed.has(address.key)
        ? { available: false, error: `The address ${address.url} is not available.` }
        : await check(address.slug, checkOf(address));
      if (!r || !r.available) return refusal([a.nodeId], notAvailable(address, r), unchecked(r));
    }
    claimed.add(address.key);
    planned.set(a.nodeId, address);
  }

  return { ok: true, addresses: drafts.map(a => planned.get(a.nodeId) as PublishAddress) };
}
