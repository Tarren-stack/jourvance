/**
 * The signed-in user's journeys, for GET /api/journeys and GET /api/user/:userId/journeys.
 *
 * The list used to report a hub refusal as an empty list (the SDK answers {error, status} rather
 * than throwing, so the catch never ran) and stopped at 50 journeys. It now says whether it is
 * complete, and why not, so the client never shows a failed read as "you have no journeys".
 */

/** Names per batchGet call. The SDK allows at most 50; smaller slices keep one answer small. */
export const JOURNEY_BATCH = 20;

export const LIST_UNREACHABLE = 'The journey store did not answer, so this list shows what this server has cached.';
export const LIST_PARTIAL = 'The journey store answered only part of the list.';

/** One list row. 'Untitled Journey' is the wording the client uses too (journeyLibrary.ts). */
export function summarizeJourney(j) {
  return {
    id: j.id,
    name: j.name || j.metadata?.name || 'Untitled Journey',
    updatedAt: j.updatedAt,
    nodeCount: j.nodes?.length || 0
  };
}

/**
 * Every journey document under `prefix` that belongs to `uid`.
 * Answers {journeys, complete, reason?}. `cached` is what this server holds locally for the user:
 * the record itself on a hub-less server, the fallback when the hub cannot be read, and merged into
 * a hub list so a journey the hub refused to store is still listed.
 */
export async function listJourneyDocs({ hub, hubReady, uid, prefix, cached }) {
  const local = Array.isArray(cached) ? cached : [];
  if (!hubReady) return { journeys: local, complete: true };

  let names;
  try {
    const listed = await hub.store.docs.list();
    if (!listed || listed.error || !Array.isArray(listed.documents)) {
      throw new Error(listed?.error || 'No document list in the answer.');
    }
    names = listed.documents
      .map((d) => d && d.name)
      .filter((n) => typeof n === 'string' && n.startsWith(prefix));
  } catch {
    return { journeys: local, complete: false, reason: LIST_UNREACHABLE };
  }

  const journeys = [];
  let complete = true;
  for (let i = 0; i < names.length; i += JOURNEY_BATCH) {
    const slice = names.slice(i, i + JOURNEY_BATCH);
    try {
      const got = await hub.store.docs.batchGet(slice);
      if (!got || got.error || !Array.isArray(got.documents)) {
        complete = false;
        continue;
      }
      for (const d of got.documents) {
        if (d && d.found && d.document && d.document.userId === uid) journeys.push(d.document);
      }
    } catch {
      complete = false;
    }
  }
  // A save the hub refused is kept only in this server's cache (saveJourney answers durable:false),
  // so the hub list alone left it out while still saying complete. Merge by id; the newer copy wins.
  const byId = new Map(journeys.map((j) => [j.id, j]));
  for (const c of local) {
    if (!c || c.userId !== uid) continue;
    const h = byId.get(c.id);
    if (!h || String(c.updatedAt || '') > String(h.updatedAt || '')) byId.set(c.id, c);
  }
  const merged = [...byId.values()];
  return complete ? { journeys: merged, complete: true } : { journeys: merged, complete: false, reason: LIST_PARTIAL };
}
