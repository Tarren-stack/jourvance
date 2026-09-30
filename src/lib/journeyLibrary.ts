import type { JourneyEdge, JourneyNode, JourneyProject } from '../types/journey';
import type { Refusal, SaveStatus, ServerAnswer } from './saveOutcome';
import { isStale } from './saveOutcome.ts';
import { draftPublishAddress } from './publishAddresses.ts';
import { repairJourneyHandles } from './stepHandles.ts';
import { MEASURED_KEYS } from './liveStats.ts';
import { isUntouchedStarter, type SyncRecord } from './accountSync.ts';

/**
 * The journey library's rules: naming, copying, and deciding which copy of a journey is the
 * latest when this browser and the account both hold one.
 *
 * Pure, and every value import carries its .ts extension, so `node --test` loads it directly.
 * The browser calls live in journeyClient.ts and the switching in useJourneyNavigation.ts.
 */

// zeroMeasured is not used on purpose: it also rewrites copy it thinks was seeded, and a
// duplicate must keep the words the person wrote. Only the MEASURED_KEYS list is shared.

/** The same wording GET /api/journeys uses (server/journeyList.mjs summarizeJourney). */
export const UNTITLED_JOURNEY = 'Untitled Journey';
export const JOURNEY_NAME_MAX = 100;

// ---- Notices ----

export const NOT_IN_BROWSER = 'That journey is not in this browser. Sign in to open it from your account.';
export const NOT_IN_ACCOUNT = 'That journey was not found in your account or in this browser.';
export const STEP_GONE = 'That step is not in this journey any more, so the whole map is shown.';
export const SWITCH_REFUSED = 'Still on this journey, because it could not be kept in this browser or saved to your account. Try again once it is saved.';
/** Signed out there is no account to save to, and trying again does not free browser storage. */
export const SWITCH_REFUSED_LOCAL = 'Still on this journey, because this browser could not keep it. Free some space or sign in, then try again.';
export const LIST_OFFLINE = 'Your account list could not be loaded because the server could not be reached. Journeys kept in this browser are shown.';
export const LIST_SIGNED_OUT = 'Your sign-in has expired. Sign in again to see the journeys in your account.';
export const LIST_FAILED_LEAD = 'Your account list could not be loaded.';
export const LIST_PARTIAL = 'This list may be missing some journeys, because the journey store did not answer in full. Try again in a minute.';
export const RENAME_NOT_KEPT = 'Not renamed, because this browser could not keep the change. Free some space or sign in, then try again.';
export const OPEN_FAILED_LEAD = 'That journey could not be opened.';

export function switchUnsaved(name: string): string {
  return `"${name}" was not saved to your account, so its latest changes are kept in this browser only. Open it again and save to keep them.`;
}

// ---- Ids and names ----

/** A new journey id: time first, so ids sort by creation, then a random token. */
export function newJourneyId(nowMs: number, token: string): string {
  return `journey-${nowMs.toString(36)}-${token}`;
}

/** Four random base36 characters, for journey ids and duplicate slugs. */
export function journeyToken(): string {
  const n = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 36 ** 4;
  return n.toString(36).padStart(4, '0');
}

/** A renamed copy, or null when the name is blank or unchanged (nothing to save). */
export function renameJourney(p: JourneyProject, name: string, now: string): JourneyProject | null {
  const next = String(name ?? '').trim().slice(0, JOURNEY_NAME_MAX);
  if (!next || next === p.name) return null;
  return { ...p, name: next, updatedAt: now };
}

// ---- Duplicate ----

const PUBLISH_FIELDS = ['publishedAt', 'publishedUrl', 'customDomain', 'customDomainVerified'] as const;

/**
 * A copy of a journey under a new id, never published and with no counts. Node and edge ids are
 * kept: stats are already filtered by journeyId (server/routes/analyticsRoutes.mjs), so the copy
 * starts at zero without renaming anything. Every page the copy could publish gets its own path,
 * so publishing the copy never collides with the original's live pages. Copy text, ad spend,
 * UTM tags and email flow links are left as the person wrote them. The input is never changed.
 */
export function duplicateJourney(src: JourneyProject, { id, now, token }: { id: string; now: string; token: string }): JourneyProject {
  const copy = structuredClone(src);
  copy.id = id;
  copy.name = `${src.name || UNTITLED_JOURNEY} copy`.slice(0, JOURNEY_NAME_MAX);
  copy.updatedAt = now;

  const slugMap = new Map<string, string>();
  const nodes = Array.isArray(copy.nodes) ? copy.nodes : [];
  for (const node of nodes) {
    const data = (node.data || {}) as Record<string, unknown>;
    node.data = data as JourneyNode['data'];
    for (const key of MEASURED_KEYS) {
      if (key in data) data[key] = 0;
    }
    if ('published' in data || node.type === 'landing-page' || node.type === 'upsell' || node.type === 'ab-split') {
      data.published = false;
    }
    for (const key of PUBLISH_FIELDS) delete data[key];

    // The base is the path the publish route would give this step today (publishAddresses.ts,
    // the one derivation publish itself uses), fallback included.
    const draft = draftPublishAddress({ id: String(node.id), type: node.type, data });
    if (draft) {
      const next = `${draft.slug}-copy-${token}`;
      if (draft.type !== 'ab-split') {
        slugMap.set(draft.slug, next);
        if (typeof data.slug === 'string' && data.slug) slugMap.set(data.slug, next);
      }
      data.slug = next;
    }
  }
  // An A/B split names its branch pages by path, so point it at the copy's pages.
  for (const node of nodes) {
    if (node.type !== 'ab-split') continue;
    const data = node.data as Record<string, unknown>;
    for (const key of ['branchAPageSlug', 'branchBPageSlug']) {
      const old = data[key];
      if (typeof old === 'string' && slugMap.has(old)) data[key] = slugMap.get(old);
    }
  }
  copy.edges = (Array.isArray(copy.edges) ? copy.edges : []).map((e: JourneyEdge) => ({
    ...e,
    data: { ...(e.data || {}), sourceThroughput: 0, targetCount: 0, rate: 0 }
  }));
  return copy;
}

// ---- Server copies ----

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** A journey body from GET /api/journey/:id, or null when it is not one. */
export function fromServerJourney(remote: unknown): JourneyProject | null {
  const r = remote as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !Array.isArray(r.nodes) || !Array.isArray(r.edges)) {
    return null;
  }
  const project: JourneyProject = {
    id: r.id,
    name: text(r.name) || UNTITLED_JOURNEY,
    businessType: text(r.businessType),
    offerHeadline: text(r.offerHeadline),
    goal: text(r.goal),
    workspaceId: text(r.workspaceId),
    shopifyStoreDomain: text(r.shopifyStoreDomain),
    nodes: r.nodes as JourneyNode[],
    edges: r.edges as JourneyEdge[],
    updatedAt: text(r.updatedAt)
  };
  if (r.forecast && typeof r.forecast === 'object') project.forecast = r.forecast as JourneyProject['forecast'];
  // Every load path repairs handles saved before #6 (stepHandles.ts).
  return repairJourneyHandles(project);
}

/**
 * The newer of two copies of one journey. The account copy wins only when it is strictly newer,
 * the same rule as the sign-in load in App.tsx, so unsaved local edits are never thrown away.
 */
export function pickNewer<T extends { updatedAt: string }>(local: T | null, remote: T | null): T | null {
  if (!local) return remote;
  if (!remote) return local;
  return String(remote.updatedAt) > String(local.updatedAt) ? remote : local;
}

// ---- The list ----

/** One row of GET /api/journeys. */
export interface AccountJourneyRow {
  id: string;
  name: string;
  updatedAt: string;
  nodeCount: number;
}

export interface JourneySummary extends AccountJourneyRow {
  inBrowser: boolean;
  inAccount: boolean;
  /** This browser holds edits the account copy does not. */
  newerInBrowser: boolean;
}

/**
 * Every journey this browser or the account holds, once each. `accountRows` is null when the
 * account could not be read (or nobody is signed in), and then nothing is marked as in the account.
 * The open journey comes first, then the most recently edited.
 */
export function mergeLibrary(localProjects: readonly JourneyProject[], accountRows: readonly AccountJourneyRow[] | null, activeId: string): JourneySummary[] {
  const byId = new Map<string, JourneySummary>();
  for (const p of localProjects) {
    if (!p || typeof p.id !== 'string' || byId.has(p.id)) continue;
    byId.set(p.id, {
      id: p.id,
      name: p.name || UNTITLED_JOURNEY,
      updatedAt: String(p.updatedAt || ''),
      nodeCount: Array.isArray(p.nodes) ? p.nodes.length : 0,
      inBrowser: true,
      inAccount: false,
      newerInBrowser: false
    });
  }
  for (const row of accountRows || []) {
    const local = byId.get(row.id);
    if (!local) {
      byId.set(row.id, { ...row, inBrowser: false, inAccount: true, newerInBrowser: false });
      continue;
    }
    const remoteNewer = String(row.updatedAt) > local.updatedAt;
    byId.set(row.id, {
      ...(remoteNewer ? { id: row.id, name: row.name, updatedAt: row.updatedAt, nodeCount: row.nodeCount } : local),
      inBrowser: true,
      inAccount: true,
      newerInBrowser: local.updatedAt > String(row.updatedAt)
    });
  }
  return [...byId.values()].sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * True when the open journey holds edits the account may not have: a failed save, an edit since
 * the last save, or (before any save) an edit since it was opened.
 */
export function hasUnsavedEdits(status: SaveStatus, updatedAt: string, openedAt: string): boolean {
  if (status.kind === 'failed') return true;
  if (status.kind === 'saved' || status.kind === 'not-backed-up') return isStale(status, updatedAt);
  return updatedAt !== openedAt;
}

// ---- Removing a browser copy ----

export const REMOVE_OPEN = 'The journey that is open cannot be removed from this browser. Open another journey first.';

/**
 * For a journey another tab opened last (journeyStorage.ts activeSlotHold 'another-tab'). Closing
 * that tab does not free it, so the advice is to open a different journey there, not to close it.
 */
export function removeOpenElsewhere(name: string): string {
  return `"${name}" was last opened in another tab of this browser, so it is not removed. Open a different journey in that tab first.`;
}

/**
 * For a journey this tab left but could not write over (activeSlotHold 'not-saved-here'): nothing
 * says another tab exists, so none is claimed. Out of space, freeing room lets the open journey's
 * next write land, which is advised only when `canMakeRoom` (another browser copy can be removed).
 */
export function removeNotSavedHere(name: string, full: boolean, canMakeRoom: boolean): string {
  if (!full) return `"${name}" is not removed, because this browser has not saved the open journey in its place.`;
  const why = `"${name}" is not removed, because this browser ran out of space before it could save the open journey in its place.`;
  return canMakeRoom ? `${why} Remove a different journey to make room, then try again.` : why;
}
export const REMOVE_REFUSED = 'Not removed, because this browser would not change its storage.';
export const RESTORE_REFUSED = 'Not put back, because this browser would not store it. Remove another journey, then press Undo again.';

export function removedNotice(name: string): string {
  return `Removed "${name}" from this browser.`;
}

/**
 * Whether this browser's copy holds changes the account copy lacks, by lineage (accountSync.ts)
 * rather than by clock: it does not when it is the account revision itself, when nothing changed
 * here since this browser last matched the account, or when it is the untouched starter map.
 * Anything else is read as holding changes, because a removal that loses nothing is not worth
 * a warning, and one that loses work is.
 */
export function browserCopyHasOwnChanges(localUpdatedAt: string, accountUpdatedAt: string, record: SyncRecord | null): boolean {
  const local = String(localUpdatedAt);
  if (local === String(accountUpdatedAt) || isUntouchedStarter(local)) return false;
  return !(record && record.localUpdatedAt === local);
}

export interface RemovalFacts {
  signedIn: boolean;
  /** The account list was read in full, so `inAccount` can be trusted. */
  accountListed: boolean;
  inAccount: boolean;
  /** browserCopyHasOwnChanges for this journey; only read when it is in the account. */
  ownChanges: boolean;
}

/** What removing a browser copy costs, in one sentence for the confirm. */
export function removalConsequence({ signedIn, accountListed, inAccount, ownChanges }: RemovalFacts): string {
  if (!signedIn) return 'You are signed out, so this is the only copy. Once removed it cannot be opened again.';
  if (!accountListed) return 'Your account list could not be read, so this may be the only copy of it.';
  if (!inAccount) return 'It is not in your account, so this is the only copy. Once removed it cannot be opened again.';
  return ownChanges
    ? 'Your account copy is not affected, but this browser has changes your account copy does not, and those changes will be lost.'
    : 'Your account copy is not affected.';
}

const retryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

function readRow(value: unknown): AccountJourneyRow | null {
  const r = value as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
  return {
    id: r.id,
    name: text(r.name) || UNTITLED_JOURNEY,
    updatedAt: text(r.updatedAt),
    nodeCount: typeof r.nodeCount === 'number' && Number.isFinite(r.nodeCount) ? r.nodeCount : 0
  };
}

/**
 * The account's journeys from an answer to GET /api/journeys. A failed or partial answer is never
 * read as an empty or complete list: rows is null when the list could not be read, complete is true
 * only when the account answered in full, and a notice says so in one sentence.
 */
export function readJourneyList(answer: ServerAnswer | null): { rows: AccountJourneyRow[] | null; complete: boolean; notice: Refusal | null } {
  if (!answer) return { rows: null, complete: false, notice: { message: LIST_OFFLINE, retryable: true } };
  const body = (answer.body || {}) as { success?: unknown; journeys?: unknown; complete?: unknown; error?: unknown };
  const ok = answer.status >= 200 && answer.status < 300 && body.success === true && Array.isArray(body.journeys);
  if (!ok) {
    if (answer.status === 401) return { rows: null, complete: false, notice: { message: LIST_SIGNED_OUT, retryable: false } };
    // The server's own sentence already says the list failed, so it stands alone; the lead is
    // only for an answer that gave no reason.
    const said = typeof body.error === 'string' && body.error.trim() ? body.error.trim() : `${LIST_FAILED_LEAD} The server answered with status ${answer.status}.`;
    return { rows: null, complete: false, notice: { message: said, retryable: retryableStatus(answer.status) } };
  }
  const rows = (body.journeys as unknown[]).map(readRow).filter((r): r is AccountJourneyRow => r !== null);
  if (body.complete === false) return { rows, complete: false, notice: { message: LIST_PARTIAL, retryable: true } };
  return { rows, complete: true, notice: null };
}

/** Why GET /api/journey/:id could not open a journey, in one sentence. */
export function openRefusal(answer: ServerAnswer | null): Refusal {
  if (!answer) {
    return { message: `${OPEN_FAILED_LEAD} The server could not be reached. Check your connection and try again.`, retryable: true };
  }
  if (answer.status === 401) {
    return { message: `${OPEN_FAILED_LEAD} Your sign-in has expired. Sign in again, then try once more.`, retryable: false };
  }
  const error = (answer.body as { error?: unknown } | null)?.error;
  const said = typeof error === 'string' && error.trim() ? error.trim() : `The server answered with status ${answer.status}.`;
  return { message: `${OPEN_FAILED_LEAD} ${said}`, retryable: retryableStatus(answer.status) };
}
