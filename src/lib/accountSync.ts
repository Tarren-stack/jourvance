/**
 * Which copy of a journey to show when the account copy arrives at sign-in (C00).
 *
 * The load used to keep whichever copy had the later updatedAt. That compares a browser clock with
 * the server's, and it says nothing about lineage: an edit made on the starter map while the load
 * was slow, or a signed-out map nudged on a new device, carries "now", so it always won, and the
 * next autosave replaced the account's journey with it. Now the browser remembers which account
 * revision its copy was last in step with, and a copy that did not come from the account copy is
 * never saved over it: it is set aside as its own journey instead.
 *
 * No imports, so node can load it as it is.
 */

/**
 * The account revision this browser's copy was last in step with, per signed-in user and journey:
 * `jourvance_synced:<uid>:<journeyId>`, both parts URI-encoded. Every account's starter map has the
 * same id, so a record keyed by the journey alone let a second account on this browser read the
 * first one's record as its own and save the first account's map over its account copy (F1). A
 * record from before the user was in the key (`jourvance_synced:<journeyId>`) is never read: no
 * record sets a differing copy aside, which never loses anything.
 */
export const SYNC_PREFIX = 'jourvance_synced:';

export function syncKey(uid: string, id: string): string {
  return `${SYNC_PREFIX}${encodeURIComponent(uid)}:${encodeURIComponent(id)}`;
}

export interface SyncRecord {
  /** The account copy's updatedAt, as the server stamped it. */
  remoteUpdatedAt: string;
  /** This browser's updatedAt for the same content. */
  localUpdatedAt: string;
}

/**
 * keep: this browser's copy is the account copy, or edits on top of it, so it stays and saves.
 * adopt: this browser holds nothing the account copy lacks, so the account copy is shown.
 * set-aside: this browser holds edits the account copy lacks and did not come from it, so they
 * are kept as a separate journey and the account copy is shown. Neither is saved over the other.
 */
export type LoadChoice = 'keep' | 'adopt' | 'set-aside';

/** The starter map carries the epoch, and every edit stamps the current time. */
export function isUntouchedStarter(updatedAt: string): boolean {
  const ms = Date.parse(String(updatedAt));
  return Number.isFinite(ms) && ms <= 0;
}

/** The parts of a journey the sign-in load copies from the account copy (App.tsx). */
export interface JourneyContent {
  nodes: unknown;
  edges: unknown;
  forecast?: unknown;
  name?: unknown;
  businessType?: unknown;
  offerHeadline?: unknown;
  goal?: unknown;
  workspaceId?: unknown;
  shopifyStoreDomain?: unknown;
}

const MERGED_FIELDS = ['name', 'businessType', 'offerHeadline', 'goal', 'workspaceId', 'shopifyStoreDomain', 'forecast'] as const;

/** JSON with object keys sorted, so two copies that differ only in key order read the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined ? 'null' : canonical(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Showing the account copy would change nothing in this browser's copy: the same steps and lines,
 * and every field the load copies over (it keeps this browser's value where the account's is empty)
 * already reads the same. The two updatedAt stamps differ after any save, because the server
 * stamps its own, so an identical copy with no sync record must not read as edits the account lacks.
 */
export function adoptChangesNothing(local: JourneyContent, remote: JourneyContent): boolean {
  if (canonical(local.nodes) !== canonical(remote.nodes) || canonical(local.edges) !== canonical(remote.edges)) return false;
  return MERGED_FIELDS.every(f => !remote[f] || canonical(remote[f]) === canonical(local[f]));
}

/** `sameContent` is adoptChangesNothing for the two copies: with nothing to lose, the browser's stays. */
export function chooseOnLoad(localUpdatedAt: string, remoteUpdatedAt: string, record: SyncRecord | null, sameContent = false): LoadChoice {
  const local = String(localUpdatedAt);
  const remote = String(remoteUpdatedAt);
  // The same revision: an account copy this browser opened earlier and has not changed. Or the same
  // content under another stamp, such as the browser's own copy of a save made before sync records.
  if (local === remote || sameContent) return 'keep';
  if (record) {
    // This browser's copy is that account revision plus edits made here.
    if (record.remoteUpdatedAt === remote) return 'keep';
    // The account answered with a revision older than one this browser saved (both are server
    // stamps, so they compare): the account is behind, and the next save catches it up.
    if (remote < record.remoteUpdatedAt) return 'keep';
    // Nothing changed here since the last sync, so the newer account copy loses nothing.
    if (record.localUpdatedAt === local) return 'adopt';
  }
  if (isUntouchedStarter(local)) return 'adopt';
  return 'set-aside';
}

/**
 * Whether writing `local` to the account keeps what the account holds: it is edits on top of that
 * account revision (or on a later one this browser saved), or the account copy itself with at most
 * its name changed, which is what renaming a journey the account holds writes. The library's rename
 * of a journey that is not open writes without passing the sign-in load, so this is its lineage check.
 */
export function writeKeepsAccountCopy(
  local: JourneyContent & { updatedAt: string },
  remote: JourneyContent & { updatedAt: string },
  record: SyncRecord | null
): boolean {
  const remoteAt = String(remote.updatedAt);
  if (record && (record.remoteUpdatedAt === remoteAt || remoteAt < record.remoteUpdatedAt)) return true;
  return adoptChangesNothing({ ...local, name: remote.name }, remote);
}

export function readSyncRecord(uid: string, id: string): SyncRecord | null {
  if (!uid || !id) return null;
  try {
    const raw = localStorage.getItem(syncKey(uid, id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncRecord> | null;
    if (!parsed || typeof parsed.remoteUpdatedAt !== 'string' || typeof parsed.localUpdatedAt !== 'string') return null;
    return { remoteUpdatedAt: parsed.remoteUpdatedAt, localUpdatedAt: parsed.localUpdatedAt };
  } catch {
    return null;
  }
}

/**
 * This browser keeps one copy of each journey whoever is signed in, so once `uid` has it open, any
 * other account's record for that journey no longer describes it: signing that account in again
 * would otherwise keep `uid`'s copy as edits on its own and save it over its account copy.
 */
export function forgetOtherAccounts(uid: string, id: string): void {
  if (!uid || !id) return;
  try {
    const own = syncKey(uid, id);
    const tail = `:${encodeURIComponent(id)}`;
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k === own || !k.startsWith(SYNC_PREFIX) || !k.endsWith(tail)) continue;
      // Exactly <uid>:<id>, both encoded, so a record from before the user was in the key never matches.
      if (k.slice(SYNC_PREFIX.length).split(':').length === 2) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch { /* blocked: the other account's next load reads its record, which is why the load also forgets */ }
}

/** Remember that this browser's `localUpdatedAt` is `uid`'s account revision `remoteUpdatedAt`. */
export function writeSyncRecord(uid: string, id: string, remoteUpdatedAt: string, localUpdatedAt: string): void {
  if (!uid || !id || !remoteUpdatedAt || !localUpdatedAt) return;
  try {
    localStorage.setItem(syncKey(uid, id), JSON.stringify({ remoteUpdatedAt, localUpdatedAt }));
  } catch { /* full or blocked: the next load sets the copy aside rather than guessing */ }
  forgetOtherAccounts(uid, id);
}

/** The name the set-aside copy is kept under. */
export function setAsideName(name: string): string {
  return `${String(name || 'Untitled journey').trim()} (this browser)`;
}

export const LOAD_FAILED = 'Your account copy of this journey could not be loaded, so changes stay in this browser until it loads.';
export const LOAD_PENDING = 'Your account copy of this journey is still loading, so it was not saved yet.';
export const SET_ASIDE_FAILED = "This browser's copy differs from your account copy and there was no room to keep both, so nothing is saved to your account.";

/** Why a write from the journey library was refused before it was sent (journeyClient.ts). */
export const WRITE_UNREAD = 'Your account copy of this journey could not be loaded, so nothing was changed there.';
export const WRITE_DIVERGED = "This browser's copy differs from your account copy, so open the journey to keep both.";
/**
 * A save refused because the account copy changed after this browser read it (another device or
 * tab saved). The server answers POST /api/user/:uid/journey/:id with 409 and this sentence
 * (server/routes/journeySaveRoutes.mjs), and the load then runs again and keeps both copies.
 */
export const SAVE_CONFLICT = 'Your account copy of this journey was changed somewhere else, so this copy was not saved over it.';

/**
 * The sync record the load after a refused save may use. Every tab of this browser writes the same
 * record, so after another tab saved it names that tab's revision, and chooseOnLoad read it as this
 * tab's copy being edits on top of the account copy: the load kept it and saved it over the other
 * tab's save, the one the 409 had just refused. The record is this tab's only when it names the
 * revision this tab's refused save was made on (`sentBase`), or this tab's own copy; otherwise the
 * load weighs no record, and a differing copy is set aside.
 */
export function recordAfterConflict(record: SyncRecord | null, sentBase: string | null, localUpdatedAt: string): SyncRecord | null {
  if (!record) return null;
  if (sentBase && record.remoteUpdatedAt === sentBase) return record;
  return record.localUpdatedAt === String(localUpdatedAt) ? record : null;
}

/** The server's answer to a save whose `baseUpdatedAt` is no longer the stored revision. */
export function isSaveConflict(answer: { status: number; body: unknown } | null): boolean {
  return !!answer && answer.status === 409 && (answer.body as { conflict?: unknown } | null)?.conflict === true;
}

export function setAsideNotice(name: string): string {
  return `This browser had changes your account copy did not, so they are kept as a separate journey, "${name}".`;
}
