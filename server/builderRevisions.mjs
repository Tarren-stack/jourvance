// Page builder revisions (LANDING_BUILDER_PLAN.md, wave 3): the builder document each publish
// of a landing page sent live, kept so a merchant can look back at it.
//
// Pure functions over one plain object, the "revisions log". It is stored through the same
// store as the publish log, under its own id (REVISIONS_LOG_SUFFIX), so it needs nothing on the
// server context. `lastNumber` is the publish revision number of the newest entry: the publish
// log store keeps the copy with the higher lastNumber when two copies exist, and this log
// follows the same rule.
//
//   { lastNumber, pages: { [nodeId]: [ { rev, nodeId, publishedAt, fingerprint, userId,
//                                          document, documentB? }, ... newest first ] } }

export const MAX_BUILDER_REVISIONS = 20;
export const REVISIONS_LOG_SUFFIX = '#builder-revisions';

/** The id the revisions log is stored under in the publish log store. */
export const revisionsLogId = (journeyId) => `${journeyId}${REVISIONS_LOG_SUFFIX}`;

/**
 * True for a journey id that names another journey's revisions log. Journey ids are chosen by the
 * client, so a journey called 'X#builder-revisions' would share its publish log with X's history;
 * the publish routes refuse such an id rather than let one overwrite the other.
 */
export const isRevisionsLogJourneyId = (journeyId) => typeof journeyId === 'string' && journeyId.endsWith(REVISIONS_LOG_SUFFIX);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Node ids come from the journey, so they can be any string, '__proto__' and 'constructor'
// included. `pages` therefore has no prototype, and every read goes through rowsOf, which looks
// at own keys only: a plain {} answered 'constructor' with a function and threw on .map.
const rowsOf = (pages, nodeId) => (Object.hasOwn(pages, nodeId) && Array.isArray(pages[nodeId]) ? pages[nodeId] : []);

/** A well-formed log from whatever was stored (or nothing). `pages` has no prototype. */
export function normalizeRevisionsLog(log) {
  const pages = Object.create(null);
  if (isObj(log) && isObj(log.pages)) {
    for (const [nodeId, list] of Object.entries(log.pages)) {
      if (Array.isArray(list)) pages[nodeId] = list.filter(isObj);
    }
  }
  return { lastNumber: Number.isFinite(log?.lastNumber) ? Number(log.lastNumber) : 0, pages };
}

/**
 * Adds one revision per entry ({ nodeId, document, documentB?, fingerprint }) for the publish
 * numbered `number`. Per page: newest first, at most `cap`, the oldest dropped. Returns a new log.
 */
export function addRevisions(log, { number, publishedAt, userId, entries, cap = MAX_BUILDER_REVISIONS }) {
  const base = normalizeRevisionsLog(log);
  const pages = Object.assign(Object.create(null), base.pages);
  for (const e of entries) {
    if (!e || typeof e.nodeId !== 'string' || !isObj(e.document)) continue;
    const row = {
      rev: number,
      nodeId: e.nodeId,
      publishedAt,
      fingerprint: typeof e.fingerprint === 'string' ? e.fingerprint : null,
      userId,
      document: e.document,
      ...(isObj(e.documentB) ? { documentB: e.documentB } : {})
    };
    pages[e.nodeId] = [row, ...rowsOf(pages, e.nodeId).filter(r => r.rev !== number)].slice(0, cap);
  }
  return { lastNumber: Math.max(base.lastNumber, number), pages };
}

/** The list a merchant sees: every field but the documents. */
export function listRevisions(log, nodeId) {
  const rows = rowsOf(normalizeRevisionsLog(log).pages, nodeId);
  return rows.map(r => ({
    rev: r.rev,
    nodeId: r.nodeId,
    publishedAt: r.publishedAt,
    fingerprint: r.fingerprint ?? null,
    userId: r.userId,
    hasB: isObj(r.documentB)
  }));
}

/** One full revision (documents included), or null. */
export function getRevision(log, nodeId, rev) {
  const rows = rowsOf(normalizeRevisionsLog(log).pages, nodeId);
  return rows.find(r => r.rev === rev) || null;
}
