import type { JourneyNode, JourneyProject } from '../types/journey';
import { draftPublishAddress } from './publishAddresses.ts';

/**
 * The page addresses a journey made from a blueprint asks for.
 *
 * Every shipped blueprint carries fixed paths (bp1 publishes /p/product-flagship-drop), so two
 * journeys made from one blueprint asked for the same address and the second publish was refused.
 * "Create as New Journey" now keeps the blueprint's path while nothing else holds it and gives
 * the step the path plus a short suffix when something does: another journey in this browser, or
 * a live page the account's address check reports as taken.
 *
 * Pure, and every value import carries its .ts extension, so `node --test` loads it directly.
 */

/** What the account's address check said about one address. */
export type AddressAnswer = 'free' | 'taken' | 'unknown';

export interface FreshAddressOptions {
  /** Publish keys (`slug`, or `split:slug` for a split) other journeys already ask for. */
  taken: ReadonlySet<string>;
  /**
   * Asks the account whether the address is free for a new journey. Absent when there is no
   * account to ask (signed out): then only `taken` decides, and publish checks again.
   */
  check?: (slug: string, type: 'page' | 'ab-split') => Promise<AddressAnswer>;
  /** A short random suffix, such as journeyToken(). */
  suffix: () => string;
}

const MAX_TRIES = 5;

/** The chosen paths the given journeys ask for, as publish keys. Generated paths are not listed. */
export function chosenAddressKeys(journeys: readonly JourneyProject[]): Set<string> {
  const keys = new Set<string>();
  for (const journey of Array.isArray(journeys) ? journeys : []) {
    for (const node of Array.isArray(journey?.nodes) ? journey.nodes : []) {
      const draft = draftPublishAddress({ id: String(node.id), type: node.type, data: node.data as Record<string, unknown> });
      if (draft && draft.isCustomSlug) keys.add(draft.key);
    }
  }
  return keys;
}

/**
 * A copy of the blueprint's nodes in which every chosen path nothing else holds is kept and every
 * other one takes `-<suffix>`. An address the check could not answer for is not known to be free,
 * so it takes a suffix too; a suffixed one is kept unless the check says it is taken. An A/B split
 * that names a page by path, and a thank-you step that shows its landing page's path, follow the
 * page. Generated paths are left alone: publish already suffixes those when they are taken.
 */
export async function withFreshAddresses(nodes: readonly JourneyNode[], { taken, check, suffix }: FreshAddressOptions): Promise<JourneyNode[]> {
  const out: JourneyNode[] = structuredClone(Array.isArray(nodes) ? [...nodes] : []);
  const claimed = new Set(taken);
  const moved = new Map<string, string>();

  for (const node of out) {
    const data = (node.data || {}) as Record<string, unknown>;
    const draft = draftPublishAddress({ id: String(node.id), type: node.type, data });
    if (!draft || !draft.isCustomSlug) continue;
    const type = draft.type === 'ab-split' ? 'ab-split' as const : 'page' as const;
    const keyOf = (slug: string) => (type === 'ab-split' ? `split:${slug}` : slug);

    let slug = draft.slug;
    const keep = !claimed.has(keyOf(slug)) && (!check || (await check(slug, type)) === 'free');
    if (!keep) {
      for (let i = 0; i < MAX_TRIES; i++) {
        const candidate = `${draft.slug}-${suffix()}`;
        if (claimed.has(keyOf(candidate))) continue;
        slug = candidate;
        if (!check || (await check(candidate, type)) !== 'taken') break;
      }
    }
    claimed.add(keyOf(slug));
    if (slug === draft.slug) continue;
    if (type === 'page') {
      moved.set(draft.slug, slug);
      if (typeof data.slug === 'string') moved.set(data.slug, slug);
    }
    node.data = { ...data, slug } as JourneyNode['data'];
  }

  if (moved.size) {
    for (const node of out) {
      const data = node.data as Record<string, unknown> | undefined;
      if (!data) continue;
      const follow = (key: string) => {
        const old = data[key];
        return typeof old === 'string' && moved.has(old) ? { [key]: moved.get(old) } : {};
      };
      if (node.type === 'ab-split') node.data = { ...data, ...follow('branchAPageSlug'), ...follow('branchBPageSlug') } as JourneyNode['data'];
      if (node.type === 'thank-you') node.data = { ...data, ...follow('slug') } as JourneyNode['data'];
    }
  }
  return out;
}
