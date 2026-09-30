/**
 * What is live, decided by the server, and whether the canvas still matches it.
 *
 * "Published" used to be a flag the browser set with its own clock. Nothing recorded what went
 * live and nothing noticed copy that changed afterwards. Publish now stamps every public record
 * with a fingerprint of the step it was built from, GET /api/journey/:id/publication reads the
 * records that are actually live, and the canvas compares that stamp with a fingerprint of the
 * step as it is now.
 *
 * The server imports this file through Node's type stripping (publicRoutes.mjs does the same with
 * geoCurrency.ts), so it must stay erasable TypeScript: no enum, no namespace, no parameter
 * properties, and every value import carries its .ts extension.
 */
import type { JourneyProject } from '../types/journey';
import type { ServerAnswer } from './saveOutcome';
import { MEASURED_KEYS, FLOW_STAT_KEYS, PAGE_STAT_KEYS } from './liveStats.ts';
import { cleanPublishSlug, draftPublishAddress } from './publishAddresses.ts';

// ── Fingerprints ──────────────────────────────────────────────────────────────

export const FINGERPRINT_VERSION = 'c1';

/**
 * Top-level node.data keys that are not content: measurements, publish bookkeeping, view state and
 * the snapshots publish merges into a landing record. A key missing here fails toward
 * "Unpublished changes", which is the safe direction. branchAPageSlug and branchBPageSlug are
 * deliberately absent: the A/B editor lets the user type them and they route traffic.
 */
export const NON_CONTENT_KEYS: ReadonlySet<string> = new Set<string>([
  ...MEASURED_KEYS,
  ...FLOW_STAT_KEYS,
  ...PAGE_STAT_KEYS,
  // POST /api/funnel/stats also writes this, and no liveStats list names it.
  'jourvanceFlowName',
  'published', 'publishedAt', 'publishedUrl',
  'customDomainVerified', 'canvasViewMode',
  'upsell', 'downsell', 'hasDownsell', 'thankYou'
]);

export const PUBLISHABLE_STEP_TYPES = ['landing-page', 'upsell', 'ab-split', 'thank-you'] as const;

export interface StepLike {
  id: string;
  type?: string;
  data?: Record<string, unknown> | null;
}

export interface EdgeLike {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export function isPublishableStep(node: StepLike | null | undefined): boolean {
  return !!node && (PUBLISHABLE_STEP_TYPES as readonly unknown[]).includes(node.type);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** JSON with every plain object's keys sorted. Undefined drops out and non-finite numbers read null. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (!isPlainObject(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) sorted[k] = v[k];
    return sorted;
  });
}

/** cyrb53: a fast 53-bit string hash. Not a security measure; it only has to notice edits. */
function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Where an A/B split sends each branch. The same rule publish uses to resolve branch slugs. */
export function splitBranchTargets(nodeId: string, edges: readonly EdgeLike[] | null | undefined): { a: string | null; b: string | null } {
  const outgoing = (Array.isArray(edges) ? edges : []).filter(e => e && e.source === nodeId);
  const edgeA = outgoing.find(e => e.sourceHandle === 'branch-a') || outgoing[0];
  const edgeB = outgoing.find(e => e.sourceHandle === 'branch-b') || outgoing[1];
  return { a: edgeA ? edgeA.target : null, b: edgeB ? edgeB.target : null };
}

// Keyed by the node.data object, so a keystroke re-hashes only the node it edited.
const fingerprintMemo = new WeakMap<object, { type: string; fingerprint: string }>();

/** The content fingerprint of one step, or null for a step that is never published. */
export function stepFingerprint(node: StepLike | null | undefined, edges?: readonly EdgeLike[] | null): string | null {
  if (!node || !isPublishableStep(node)) return null;
  const type = String(node.type);
  const raw = isPlainObject(node.data) ? node.data : {};
  const isSplit = type === 'ab-split';
  if (!isSplit) {
    const hit = fingerprintMemo.get(raw);
    if (hit && hit.type === type) return hit.fingerprint;
  }
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!NON_CONTENT_KEYS.has(k)) data[k] = v;
  }
  const subject: Record<string, unknown> = { type, data };
  if (isSplit) subject.branches = splitBranchTargets(node.id, edges);
  const fingerprint = `${FINGERPRINT_VERSION}:${hash53(canonical(subject))}`;
  if (!isSplit) fingerprintMemo.set(raw, { type, fingerprint });
  return fingerprint;
}

// ── Publish addresses ─────────────────────────────────────────────────────────

/** The publish slug rule: lowercase, anything else becomes a dash, no dash at either end. */
export const normalizeSlug = (raw: unknown): string => cleanPublishSlug(raw);

/**
 * The public record key publish would write for a step BEFORE any collision suffix: the slug for a
 * page or upsell, `split:<slug>` for a split, null for anything else. It is publishAddresses'
 * derivation, so the two can never disagree.
 */
export function publishKey(node: StepLike | null | undefined): string | null {
  const address = node ? draftPublishAddress(node) : null;
  return address ? address.key : null;
}

/** What a successful publish reports for each step it put live, upsells included. */
export interface PublishedStep {
  nodeId: string;
  type: string;
  slug: string;
  url: string;
  publishedAt: string;
  customDomain?: string;
  branchAPageSlug?: string;
  branchBPageSlug?: string;
}

/**
 * Mirrors a publish answer onto the canvas: the slug the server actually used (lower-cased,
 * defaulted or suffixed), the split's resolved branch slugs and the publish fields. Only listed,
 * well-formed entries are applied; every other field, and updatedAt, is left alone.
 */
export function applyPublishResult(project: JourneyProject, steps: readonly PublishedStep[] | null | undefined): JourneyProject {
  const byId = new Map<string, PublishedStep>();
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || typeof s.nodeId !== 'string' || typeof s.slug !== 'string') continue;
    if (typeof s.url !== 'string' || !s.url.startsWith('/p/')) continue;
    byId.set(s.nodeId, s);
  }
  if (byId.size === 0) return project;
  let changed = false;
  const nodes = project.nodes.map(n => {
    const s = byId.get(n.id);
    if (!s) return n;
    changed = true;
    const data: Record<string, unknown> = {
      ...n.data,
      slug: s.slug,
      published: true,
      publishedAt: s.publishedAt,
      publishedUrl: s.url
    };
    if (n.type === 'landing-page') data.customDomain = s.customDomain;
    if (n.type === 'ab-split') {
      data.branchAPageSlug = s.branchAPageSlug;
      data.branchBPageSlug = s.branchBPageSlug;
    }
    return { ...n, data: data as typeof n.data };
  });
  return changed ? { ...project, nodes } : project;
}

// ── Status ────────────────────────────────────────────────────────────────────

/** One live step, as GET /api/journey/:id/publication reports it. */
export interface LiveStep {
  live: true;
  url: string;
  /** Null for a record published before fingerprints existed. */
  fingerprint: string | null;
  revisionNumber: number | null;
  publishedAt: string;
}

export interface LiveRevision {
  id: string;
  number: number;
  publishedAt: string;
}

export interface PublicationReport {
  checkedAt: string;
  steps: Record<string, LiveStep>;
  liveRevision: LiveRevision | null;
}

export type PublicationRead =
  | { kind: 'checking' }
  | { kind: 'signed-out' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'read'; report: PublicationReport };

interface LiveInfo {
  revisionNumber: number | null;
  publishedAt: string;
}

export type StepPublishState =
  | ({ kind: 'published' } & LiveInfo)
  | ({ kind: 'changed' } & LiveInfo)
  | ({ kind: 'untracked' } & LiveInfo)
  | { kind: 'not-published' }
  | { kind: 'checking' }
  | { kind: 'unknown'; reason: 'signed-out' | 'unavailable' };

const unavailable = (message: string): PublicationRead => ({ kind: 'unavailable', message });

/** Reads the answer to GET /api/journey/:id/publication. Anything short of a clean answer is "unavailable". */
export function publicationRead(answer: ServerAnswer | null | undefined): PublicationRead {
  if (!answer) return unavailable('The status check could not reach the server. Check your connection and try again.');
  if (answer.status === 401) return unavailable('Your sign-in has expired. Sign in again to see what is live.');
  const body = (answer.body && typeof answer.body === 'object' ? answer.body : {}) as Record<string, unknown>;
  if (answer.status < 200 || answer.status >= 300 || body.success !== true) {
    const said = typeof body.error === 'string' ? body.error.trim() : '';
    return unavailable(said || `The status check did not work. The server answered with status ${answer.status}.`);
  }
  if (!isPlainObject(body.steps)) return unavailable('The status check did not work. The server sent an answer it could not read.');
  const steps: Record<string, LiveStep> = {};
  for (const [nodeId, raw] of Object.entries(body.steps)) {
    if (!isPlainObject(raw) || typeof raw.url !== 'string') continue;
    if (raw.fingerprint !== null && typeof raw.fingerprint !== 'string') continue;
    steps[nodeId] = {
      live: true,
      url: raw.url,
      fingerprint: raw.fingerprint as string | null,
      revisionNumber: typeof raw.revisionNumber === 'number' && Number.isFinite(raw.revisionNumber) ? raw.revisionNumber : null,
      publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : ''
    };
  }
  const rev = body.liveRevision;
  const liveRevision = isPlainObject(rev) && typeof rev.id === 'string' && typeof rev.number === 'number'
    ? { id: rev.id, number: rev.number, publishedAt: typeof rev.publishedAt === 'string' ? rev.publishedAt : '' }
    : null;
  return {
    kind: 'read',
    report: { checkedAt: typeof body.checkedAt === 'string' ? body.checkedAt : '', steps, liveRevision }
  };
}

/** The status of one step, or null for a step that is never published (form, ad, sequence). */
export function stepPublishState(node: StepLike, edges: readonly EdgeLike[] | null | undefined, read: PublicationRead | null | undefined): StepPublishState | null {
  if (!isPublishableStep(node)) return null;
  if (!read || read.kind === 'checking') return { kind: 'checking' };
  if (read.kind === 'signed-out') {
    return node.data?.published === true ? { kind: 'unknown', reason: 'signed-out' } : { kind: 'not-published' };
  }
  if (read.kind === 'unavailable') return { kind: 'unknown', reason: 'unavailable' };
  const live = read.report.steps[node.id];
  if (!live) return { kind: 'not-published' };
  const info = { revisionNumber: live.revisionNumber, publishedAt: live.publishedAt };
  if (typeof live.fingerprint !== 'string' || !live.fingerprint.startsWith(`${FINGERPRINT_VERSION}:`)) {
    return { kind: 'untracked', ...info };
  }
  return live.fingerprint === stepFingerprint(node, edges)
    ? { kind: 'published', ...info }
    : { kind: 'changed', ...info };
}

export function stepPublishStates(
  nodes: readonly StepLike[] | null | undefined,
  edges: readonly EdgeLike[] | null | undefined,
  read: PublicationRead | null | undefined
): Map<string, StepPublishState> {
  const out = new Map<string, StepPublishState>();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const state = stepPublishState(node, edges, read);
    if (state) out.set(node.id, state);
  }
  return out;
}

export function publishStateLabel(state: StepPublishState): string {
  switch (state.kind) {
    case 'published': return 'Published';
    case 'changed': return 'Unpublished changes';
    case 'not-published': return 'Not published';
    case 'untracked': return 'Live, changes unknown';
    case 'checking': return 'Checking status';
    default: return 'Status unavailable';
  }
}

const defaultWhen = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** One or two short sentences explaining a status. An unparseable date is left out; it never throws. */
export function publishStateDetail(
  state: StepPublishState,
  nodeType?: string,
  formatWhen: (iso: string) => string = defaultWhen
): string {
  const when = (iso: string) => {
    if (!iso) return '';
    try {
      const text = formatWhen(iso);
      return typeof text === 'string' ? text.trim() : '';
    } catch {
      return '';
    }
  };
  switch (state.kind) {
    case 'published': {
      const on = when(state.publishedAt);
      const what = state.revisionNumber !== null ? `Revision ${state.revisionNumber}` : 'This step';
      return `${what} went live${on ? ` on ${on}` : ''}. Visitors see this version.`;
    }
    case 'changed': {
      const on = when(state.publishedAt);
      const what = state.revisionNumber !== null ? `revision ${state.revisionNumber}` : 'it';
      return `You changed this step after ${what} went live${on ? ` on ${on}` : ''}. Visitors still see the older version. Publish the funnel to put your changes live.`;
    }
    case 'untracked':
      return 'This step is live. It was published before Jourvance tracked changes, so it cannot tell whether you changed it since. Publish the funnel to be sure visitors see this version.';
    case 'not-published':
      return nodeType === 'thank-you'
        ? 'No live landing page shows this thank-you step. Publish the funnel to put it live.'
        : 'This step is not on the web. Publish the funnel to put it live.';
    case 'checking':
      return 'Checking what is live.';
    default:
      return state.reason === 'signed-out' ? 'Sign in to see what is live.' : 'The status check did not work. Try again.';
  }
}

// ── Revision log ──────────────────────────────────────────────────────────────

export const MAX_REVISIONS = 50;

export interface RevisionPage {
  nodeId: string;
  type: string;
  key: string;
  url: string;
}

export interface RevisionEntry {
  id: string;
  number: number;
  startedAt: string;
  finishedAt?: string;
  /** started = it did not finish (yet), live, replaced by a later one, offline = taken down. */
  status: 'started' | 'live' | 'replaced' | 'offline';
  pages: RevisionPage[];
}

export interface PublishLog {
  lastNumber: number;
  liveRevisionId: string | null;
  unpublishedAt?: string | null;
  entries: RevisionEntry[];
  /** Pages of trimmed entries that no kept entry names. One may still be live, so unpublish reads them. */
  retiredPages?: RevisionPage[];
}

const logOrEmpty = (log: PublishLog | null | undefined): PublishLog => ({
  lastNumber: Number.isFinite(log?.lastNumber) ? Number(log!.lastNumber) : 0,
  liveRevisionId: typeof log?.liveRevisionId === 'string' ? log.liveRevisionId : null,
  ...(log && 'unpublishedAt' in log ? { unpublishedAt: log.unpublishedAt ?? null } : {}),
  entries: Array.isArray(log?.entries) ? log!.entries : [],
  ...(Array.isArray(log?.retiredPages) && log!.retiredPages.length ? { retiredPages: log!.retiredPages } : {})
});

/**
 * Reserves the next revision number. The number comes from lastNumber, which only grows, so a
 * number is never reused after old entries are trimmed. The live entry is never trimmed, and a
 * trimmed entry's pages move to retiredPages unless a kept entry names the same key, because an
 * old address can still be live. `pages` are the addresses the publish is about to write, so a
 * publish that stops partway can still be taken down.
 */
export function startRevision(log: PublishLog | null | undefined, id: string, iso: string, pages: RevisionPage[] = []): PublishLog {
  const base = logOrEmpty(log);
  const number = base.lastNumber + 1;
  const entries = [...base.entries, { id, number, startedAt: iso, status: 'started' as const, pages: [...pages] }];
  const dropped: RevisionPage[] = [];
  while (entries.length > MAX_REVISIONS) {
    const drop = entries.findIndex(e => e.id !== base.liveRevisionId);
    if (drop < 0) break;
    dropped.push(...(Array.isArray(entries[drop].pages) ? entries[drop].pages : []));
    entries.splice(drop, 1);
  }
  if (!dropped.length) return { ...base, lastNumber: number, entries };
  const named = new Set(entries.flatMap(e => (Array.isArray(e.pages) ? e.pages : []).map(p => p?.key)));
  const retired = new Map((base.retiredPages || []).map(p => [p.key, p]));
  for (const p of dropped) {
    if (p && typeof p.key === 'string' && p.key && !named.has(p.key)) retired.set(p.key, p);
  }
  return { ...base, lastNumber: number, entries, ...(retired.size ? { retiredPages: [...retired.values()] } : {}) };
}

/** Marks a revision live once every record is written. The one live before it becomes "replaced". */
export function finishRevision(log: PublishLog, id: string, pages: RevisionPage[], iso: string): PublishLog {
  const base = logOrEmpty(log);
  return {
    ...base,
    liveRevisionId: id,
    unpublishedAt: null,
    entries: base.entries.map(e => {
      if (e.id === id) return { ...e, status: 'live' as const, finishedAt: iso, pages: [...pages] };
      return e.status === 'live' ? { ...e, status: 'replaced' as const } : e;
    })
  };
}

/** After "Take funnel offline": nothing is live, the retired pages included. */
export function markUnpublished(log: PublishLog | null | undefined, iso: string): PublishLog | null {
  if (!log) return null;
  const { retiredPages: _gone, ...base } = logOrEmpty(log);
  return {
    ...base,
    liveRevisionId: null,
    unpublishedAt: iso,
    entries: base.entries.map(e => (e.status === 'live' ? { ...e, status: 'offline' as const } : e))
  };
}

/**
 * Every address any revision in the log wrote or planned, the retired pages included, once each.
 * An address is not proof of a live page: the caller reads each record and checks its owner.
 */
export function everyLoggedPage(log: PublishLog | null | undefined): RevisionPage[] {
  const base = logOrEmpty(log);
  const byKey = new Map<string, RevisionPage>();
  for (const p of [...base.entries.flatMap(e => (Array.isArray(e.pages) ? e.pages : [])), ...(base.retiredPages || [])]) {
    if (p && typeof p.key === 'string' && p.key && !byKey.has(p.key)) byKey.set(p.key, p);
  }
  return [...byKey.values()];
}

export function liveRevisionEntry(log: PublishLog | null | undefined): RevisionEntry | null {
  if (!log || !log.liveRevisionId || !Array.isArray(log.entries)) return null;
  return log.entries.find(e => e.id === log.liveRevisionId) || null;
}

// ── Preview links ─────────────────────────────────────────────────────────────

export const PREVIEW_TTL_MS = 3_600_000;

/** Whole minutes a preview link still works; 0 once it has expired or the date will not parse. */
export function previewMinutesLeft(expiresAtIso: string, nowMs: number): number {
  const left = Date.parse(expiresAtIso) - nowMs;
  return Number.isFinite(left) && left > 0 ? Math.ceil(left / 60_000) : 0;
}

export function previewExpiryText(expiresAtIso: string, nowMs: number): string {
  const minutes = previewMinutesLeft(expiresAtIso, nowMs);
  if (minutes <= 0) return 'This preview link has expired. Make a new one.';
  return minutes === 1 ? 'Works for 1 more minute.' : `Works for ${minutes} more minutes.`;
}
