import type { JourneyProject } from '../types/journey';
import { requestAnswer, type ServerAnswer } from './saveOutcome';
import { authHeaders } from './firebase';
import { repairJourneyHandles } from './stepHandles';
import { WRITE_DIVERGED, WRITE_UNREAD, isSaveConflict, readSyncRecord, writeKeepsAccountCopy, writeSyncRecord } from './accountSync';

/**
 * The journey library's calls to this app's own server. Each one answers what came back, or null
 * when no answer came at all, and never decides what it means: callers read the answer with
 * saveOutcome, renameRefusal, readJourneyList, openRefusal and fromServerJourney.
 */

/** GET /api/journeys: {success, journeys, complete, reason?}. */
export async function listAccountJourneys(): Promise<ServerAnswer | null> {
  return requestAnswer('/api/journeys', { headers: await authHeaders() });
}

/**
 * The latest read of each journey's account copy in this tab, per signed-in user: null when the read
 * failed, else the copy (null when the account has none). saveAccountJourney checks a write against
 * it (C00), and every save names its revision as the one it replaces (F1).
 */
type AccountRead = { copy: (JourneyProject & { updatedAt: string }) | null } | null;
const accountReads = new Map<string, AccountRead>();
const readKey = (uid: string, id: string) => JSON.stringify([uid, id]);
/** Per signed-in user and journey, the base a save named when it was refused as a conflict (refusedBase). */
const refusedBases = new Map<string, string>();

/**
 * Record what a read of `uid`'s account copy of journey `id` found: the journey, null when the
 * account has none, or undefined when the read failed. App's sign-in load reads without this module.
 * The copy goes through the same load repair as the browser's (repairJourneyHandles, R25), so two
 * copies of one save compare as the same content.
 */
export function noteAccountRead(uid: string, id: string, journey: unknown): void {
  const j = journey as JourneyProject | null | undefined;
  accountReads.set(readKey(uid, id), journey === undefined ? null
    : { copy: j && Array.isArray(j.nodes) && Array.isArray(j.edges) ? repairJourneyHandles({ ...j, updatedAt: String(j.updatedAt) }) : null });
}

/** GET /api/journey/:id. A success with `journey: null` means the account has no such journey. */
export async function getAccountJourney(id: string, uid: string): Promise<ServerAnswer | null> {
  const answer = await requestAnswer(`/api/journey/${encodeURIComponent(id)}`, { headers: await authHeaders() });
  const body = answer?.body as { success?: unknown; journey?: unknown } | undefined;
  const ok = !!answer && answer.status >= 200 && answer.status < 300 && body?.success === true;
  noteAccountRead(uid, id, ok ? (body!.journey ?? null) : undefined);
  return answer;
}

/**
 * Why writing `project` would replace an account copy it does not come from, or null. The library
 * reads a journey, keeps the newer of the two copies and writes it back, so a browser copy that never
 * came from the account copy (the starter map, or edits made while its load failed) was saved over
 * it. A journey never read in this tab is one this tab made, so it has nothing to replace.
 */
function writeRefusal(uid: string, project: JourneyProject): ServerAnswer | null {
  const key = readKey(uid, project.id);
  if (!accountReads.has(key)) return null;
  const read = accountReads.get(key);
  // Refused here, before any request, in the shape of an answer so callers read it as any other.
  if (!read) return { status: 503, body: { success: false, error: WRITE_UNREAD } };
  if (read.copy && !writeKeepsAccountCopy(project, read.copy, readSyncRecord(uid, project.id))) {
    return { status: 409, body: { success: false, error: WRITE_DIVERGED } };
  }
  return null;
}

/** The account revision a save landed as, or null when it did not land. */
function landedAt(answer: ServerAnswer | null): string | null {
  const body = answer?.body as { success?: unknown; journey?: { updatedAt?: unknown } } | undefined;
  const savedAt = body?.journey?.updatedAt;
  return answer && answer.status >= 200 && answer.status < 300 && body?.success === true && typeof savedAt === 'string' ? savedAt : null;
}

/**
 * POST /api/user/:uid/journey/:id with the whole journey: the one place the save request is built,
 * for App's save and the library's writes alike. It refuses nothing, so a caller checks first
 * (App holds a journey until its load is reconciled; the library uses saveAccountJourney). A save
 * that landed records which account revision `project` now is, so the next load keeps it (C00).
 * It names the account revision it replaces as `baseUpdatedAt`, and the server answers 409 when
 * the stored copy is another one, so a save made on another device since is never replaced (F1).
 */
export async function postAccountJourney(uid: string, project: JourneyProject): Promise<ServerAnswer | null> {
  const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
  const base = accountReads.get(readKey(uid, project.id))?.copy?.updatedAt;
  const answer = await requestAnswer(`/api/user/${encodeURIComponent(uid)}/journey/${encodeURIComponent(project.id)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(base ? { ...project, baseUpdatedAt: base } : project)
  });
  const savedAt = landedAt(answer);
  if (savedAt) {
    writeSyncRecord(uid, project.id, savedAt, project.updatedAt);
    accountReads.set(readKey(uid, project.id), { copy: { ...project, updatedAt: savedAt } });
    refusedBases.delete(readKey(uid, project.id));
  }
  if (base && isSaveConflict(answer)) refusedBases.set(readKey(uid, project.id), base);
  return answer;
}

/**
 * The base the latest save of `uid`'s journey `id` named when the server refused it as a conflict,
 * or null. The sync record is shared by every tab of this browser, so after a conflict it may be
 * another tab's, written for the revision that tab saved; only this tab's own base says which
 * revision this tab's copy was made on (accountSync.recordAfterConflict).
 */
export function refusedBase(uid: string, id: string): string | null {
  return refusedBases.get(readKey(uid, id)) ?? null;
}

/**
 * The library's write: postAccountJourney, refused unsent when it would replace an account copy it
 * does not come from (C00).
 */
export async function saveAccountJourney(uid: string, project: JourneyProject): Promise<ServerAnswer | null> {
  const refused = writeRefusal(uid, project);
  if (refused) return refused;
  return postAccountJourney(uid, project);
}
