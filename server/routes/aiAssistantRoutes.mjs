// Ask Jourvance: the assistant's five routes (ASK_JOURVANCE_PLAN.md section 3).
//
//   GET    /api/ai/assistant/thread    the signed-in user's conversation, notes and hub state
//   POST   /api/ai/assistant/ask       one question, answered by the hub brain on this user's FACTS
//   POST   /api/ai/assistant/notes     the user's notes, then their private profile on the hub
//   POST   /api/ai/assistant/feedback  Helpful / Not helpful; Helpful shares the QUESTION, cut down
//                                       to words of the Jourvance guide, never the answer
//   DELETE /api/ai/assistant/thread    clears the conversation (notes and daily counts stay)
//   POST   /api/ai/assistant/admin/train  operator only: send each account's what-worked.md to its
//                                       private corpus, and optionally the app patterns (W2.S S3, S3b)
//
// Every hub chat goes through brainChat (server/aiCall.mjs), which owns the bound, the account-scope
// fallback and its one memory for the process. `ask` and `thread` read the screen the user is on
// (W2.S S2); a journey it names is kept only when it is one of the user's journeys.
//
// Training (W2.S S3): after GET thread has answered, the user's what-worked.md is compiled from the
// last 90 days and sent to their private corpus when its sha changed, at most once per user per day,
// in the background and bounded, so it never delays the answer and never throws. The outcome is
// recorded on the thread document as trainingOnHub.
//
// The thread is one hub app-store document per user, `assistant.u.<safeAccountId(uid)>`, and every
// read checks document.userId === uid. A document that is not this user's is treated as missing and
// is never saved over. A local file (assistant-threads.json under dataDir) caches every thread, the
// way workspaces are cached, so a hub-less server still holds a conversation and a failed hub read
// falls back to it. A save after a failed read stays on this server rather than replacing the stored
// copy with an older one.
//
// The assistant has its OWN per-user sliding hour (ASSISTANT_PER_HOUR, default 40), so a long chat
// never blocks a journey draft and the reverse. Refusals are the shapes /api/ai/builder-rewrite uses.
// Every hub call is bounded (TIMEOUTS): a call that never settles is a failed call, and the per-user
// lock is released in a finally, so one hung put can never hold a user's thread.
// Express 4 does not catch a rejected async handler, so every handler catches its own faults.
// This file carries no em dash and no en dash.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { safeAccountId } from '../../hub-storage.mjs';
import { limitMessage, limitWaitSeconds } from './aiJourneyRoutes.mjs';
import { brainChat, bounded, accountScopeRefused, ACCOUNT_REFUSAL, ACCOUNT_REFUSAL_MS, isAccountRefusal } from '../aiCall.mjs';
// W3.A: a reply may propose a few actions; only the vocabulary in assistantActions.mjs is kept.
import { cleanModelStrings } from '../aiCall.mjs';
import { readReply, cleanStoredActions, relabelStoredActions } from '../assistantActions.mjs';
import {
  LIMITS,
  readMessage,
  readNotes,
  readScreen,
  ownScreen,
  buildContextPack,
  businessProfileMarkdown,
  assistantSystem,
  capAnswer,
  hourlyBudget,
  assistantPerHour,
  underDailyCap,
  countDaily,
  dayKey
} from '../assistantContext.mjs';
import { loadGuideSections, guideSectionsFor, loadShareAllowlist, shareableQuestion } from '../assistantGuide.mjs';
import {
  WHAT_WORKED_FILE,
  TRAINING_PER_DAY,
  trainingWindow,
  compileWhatWorked,
  compileAppPatterns,
  activeAccounts,
  // W3.C: journey shapes sent to the shared brain.
  SHAPE_LEARNS_PER_DAY,
  SHAPE_RESEND_DAYS,
  BUSINESS_TYPES,
  compileShapeLearns,
  cleanShapeLearns,
  shapeSentRecently,
  recordShapeLearn,
  shapeSlotsLeft,
  claimShapeDays,
  SHAPE_LEARNS_APP_PER_DAY,
  eventsPartial
} from '../assistantTraining.mjs';

// The account-scope memory and the bound live in server/aiCall.mjs now (one memory for the process);
// they are exported from here too, so every existing import keeps working.
export { bounded, ACCOUNT_REFUSAL, ACCOUNT_REFUSAL_MS, isAccountRefusal };

export const THREAD_FILE = 'assistant-threads.json';
export const PROFILE_PATH = '/api/brain/studio/profile';
/** The hub route that replaces one named file in this user's studio corpus (W2.H H3). */
export const REPLACE_PATH = '/api/brain/studio/replace';
/** The app-store document that records the month whose app patterns were sent (one file a month). */
export const PATTERNS_DOC = 'assistant.patterns';
/** The app-store document that holds today's app-wide count of journey shapes sent (W3.C). */
export const SHAPES_DAY_DOC = 'assistant.shapes-day';
/** The local cache keeps at most this many users; the oldest by updatedAt go first. */
export const THREAD_CACHE_USERS = 500;
/**
 * How long each kind of hub call may take, in ms. A test hands in shorter ones. `train` bounds one
 * background training job from GET thread: past it nothing more is sent for that job.
 */
export const TIMEOUTS = Object.freeze({ store: 10000, profile: 15000, learn: 15000, chat: 50000, train: 15000 });
/** One operator run trains at most this many accounts; `limit` defaults to 200. */
export const TRAIN_RUN_MAX = 500;
export const TRAIN_LIMIT_DEFAULT = 200;
/** One operator run stops starting new accounts after this long, and says which it did not reach. */
export const TRAIN_RUN_MS = 4 * 60 * 1000;
/** Accounts one operator run trains at the same time. */
export const TRAIN_CONCURRENCY = 4;

const UNAVAILABLE = {
  success: false,
  error: 'The assistant is not set up on this server, so it cannot answer yet.',
  reason: 'ai-unavailable',
  retryable: false
};
const NO_ANSWER = { success: false, error: 'The assistant did not answer. Nothing changed. Try again in a minute.', retryable: true };
const UNREADABLE = { success: false, error: 'The assistant answered with something Jourvance could not read. Try again.', retryable: true };
// Every `reason` an answer carries is ONE bare cause: one plain sentence, no advice, no variable name.
// The client wraps it in its own sentence ("... did not take them. {reason} Try saving again later."),
// so a second sentence or a "Try again" here repeats itself. The hub's own wording goes to the log.
export const REASONS = Object.freeze({
  noHub: 'The AI service is not connected on this server.',
  timeout: 'The AI service did not answer in time.',
  noAnswer: 'The AI service did not answer.',
  saveUnconfirmed: 'The AI service did not confirm the save.',
  foreignThread: 'The stored conversation belongs to another account.',
  unreadableThread: 'The stored conversation could not be read.',
  workspacesIncomplete: 'The workspace list could not be read in full.',
  journeysIncomplete: 'The journey list could not be read in full.',
  nothingToSend: 'There is nothing to send yet.',
  notSentYet: 'Nothing has been sent yet.',
  profileCap: `The assistant's memory takes ${LIMITS.PROFILE_SYNC_PER_DAY} updates a day.`,
  profileRefused: 'The AI service did not take the update.',
  shareCap: `You have shared ${LIMITS.FEEDBACK_PER_DAY} answers today.`,
  shareRefused: 'The AI service did not take the answer.',
  accountScopeRefused: 'The AI service cannot read your notes back yet.',
  dataIncomplete: "Some of this account's data could not be read.",
  dataTooSlow: 'The account data took too long to read.',
  trainingUnchanged: 'Nothing changed since the last send.',
  trainingSentToday: 'This account was already sent today.',
  trainingRefused: 'The AI service did not take the file.',
  trainingBusy: 'A send for this account was already running.',
  trainingNotReached: 'The run ended before this account.',
  dryRun: 'This was a dry run.',
  patternsNone: 'No group had enough accounts to share.',
  patternsSentThisMonth: "This month's patterns were already sent.",
  patternsUnchecked: "Whether this month's patterns were sent could not be checked.",
  patternsClaimed: "Another run holds this month's patterns.",
  trainingStaleCopy: 'The AI service kept an old copy of the file.',
  recordUnread: 'The saved record could not be read.',
  shapesNone: 'No journey had enough visits and orders to share.',
  shapeSentRecently: `This journey shape was shared in the last ${SHAPE_RESEND_DAYS} days.`,
  shapeCap: `This account shares at most ${SHAPE_LEARNS_PER_DAY} journey shapes a day.`,
  shapeRefused: 'The AI service did not take the journey shape.',
  claimTaken: 'Another run claimed this account first.',
  shapeAppCap: `Jourvance shares at most ${SHAPE_LEARNS_APP_PER_DAY} journey shapes a day.`,
  shapeAppClaimed: "Another run holds today's journey shape budget.",
  shapeAppUnchecked: "Today's journey shape budget could not be checked."
});
const NO_HUB = REASONS.noHub;
/** The bare cause for a hub call that threw: a timeout says so, anything else did not answer. */
const failedCall = (err) => (err?.timedOut ? REASONS.timeout : REASONS.noAnswer);

/** The hub app-store name of one user's thread. */
export const threadDocName = (uid) => `assistant.u.${safeAccountId(uid)}`;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isMessage = (m) => isPlainObject(m) && typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && (m.actions === undefined || Array.isArray(m.actions));
/** A stored message with its actions checked again by shape (W3.A); the key goes when none is left. */
const withCleanActions = (m) => {
  if (m.actions === undefined) return m;
  const { actions, ...rest } = m;
  const kept = cleanStoredActions(actions);
  return kept.length ? { ...rest, actions: kept } : rest;
};

export function emptyThread(uid) {
  return {
    userId: uid,
    messages: [],
    notes: '',
    profileSha: '',
    profileOnHub: null,
    feedbackDays: {},
    profileDays: {},
    trainingSha: '',
    trainingOnHub: null,
    trainingDays: {},
    shapeLearns: {},
    shapeDays: {},
    claimSeq: 0,
    updatedAt: ''
  };
}

/** A stored thread cleaned to its shape, or null when it is not this user's (the workspace loader's rule). */
export function cleanThread(doc, uid) {
  if (!isPlainObject(doc) || !uid || doc.userId !== uid) return null;
  return {
    userId: uid,
    messages: (Array.isArray(doc.messages) ? doc.messages.filter(isMessage).map(withCleanActions) : []).slice(-LIMITS.THREAD_KEEP),
    notes: typeof doc.notes === 'string' ? doc.notes : '',
    profileSha: typeof doc.profileSha === 'string' ? doc.profileSha : '',
    profileOnHub: isPlainObject(doc.profileOnHub) ? doc.profileOnHub : null,
    feedbackDays: isPlainObject(doc.feedbackDays) ? doc.feedbackDays : {},
    profileDays: isPlainObject(doc.profileDays) ? doc.profileDays : {},
    trainingSha: typeof doc.trainingSha === 'string' ? doc.trainingSha : '',
    trainingOnHub: isPlainObject(doc.trainingOnHub) ? doc.trainingOnHub : null,
    trainingDays: isPlainObject(doc.trainingDays) ? doc.trainingDays : {},
    // W3.C: sha to the day a journey shape was sent ('YYYY-MM-DD' only), and the shapes sent per day.
    shapeLearns: cleanShapeLearns(doc.shapeLearns),
    // Kept as stored when it is not a plain object, so a broken count reads as a full day, never zero.
    shapeDays: doc.shapeDays === undefined ? {} : doc.shapeDays,
    // How many claims this document has taken: the stamp of the next conditional claim (saveThreadClaim).
    claimSeq: Number.isSafeInteger(doc.claimSeq) && doc.claimSeq >= 0 && doc.claimSeq <= 1e9 ? doc.claimSeq : 0,
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : ''
  };
}

/** { answerId, rating } from a feedback body, or { error } in one sentence. */
export function readFeedback(raw) {
  const b = isPlainObject(raw) ? raw : {};
  const answerId = typeof b.answerId === 'string' ? b.answerId.trim() : '';
  if (!answerId || answerId.length > 100) return { error: 'Name the answer you are rating.' };
  if (b.rating !== 'up' && b.rating !== 'down') return { error: 'Rate the answer as helpful or not helpful.' };
  return { answerId, rating: b.rating };
}

/**
 * One writer per user. The chain only ever holds promises that resolve, and each holder releases in
 * a finally, so a write that throws or times out never holds the next one.
 */
export function threadLocks() {
  const locks = new Map();
  return {
    held: () => locks.size,
    async run(uid, fn) {
      const prev = locks.get(uid) || Promise.resolve();
      let release;
      const mine = new Promise((resolve) => { release = resolve; });
      const tail = prev.then(() => mine);
      locks.set(uid, tail);
      await prev;
      try {
        return await fn();
      } finally {
        release();
        if (locks.get(uid) === tail) locks.delete(uid);
      }
    }
  };
}

/** True only for a store put that answered a document revision. */
export const putLanded = (r) => isPlainObject(r) && !r.error && r.rev !== undefined && r.rev !== null;
/** True only for a profile post the hub answered with success: true. */
export const profileLanded = (r) => isPlainObject(r) && !r.error && r.success === true;
/**
 * True only for a replace that took the new file AND removed every old copy. The hub answers
 * `undeleted: n` when an old copy could not be removed; that copy would still be retrieved, so it
 * is not landed and a later day sends again.
 */
export const replaceLanded = (r) => profileLanded(r) && !(Number(r.undeleted) > 0);

/** `cache` without its oldest users (by updatedAt) beyond `max`. Changes the object in place. */
export function capThreadCache(cache, max = THREAD_CACHE_USERS) {
  const ids = Object.keys(cache);
  if (ids.length <= max) return cache;
  const at = (id) => Date.parse(cache[id]?.updatedAt || '') || 0;
  ids.sort((a, b) => at(a) - at(b));
  for (const id of ids.slice(0, ids.length - max)) delete cache[id];
  return cache;
}

const newId = () => `m_${crypto.randomBytes(9).toString('base64url')}`;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * The id an operator answer names an account by: a salted sha256, cut to 16 hex characters. Never the
 * uid itself, so an operator answer pasted anywhere carries no account id or email.
 */
export const hashedUid = (uid) => `u_${sha256(`jourvance-assistant-train:${uid}`).slice(0, 16)}`;

/** { userIds?, limit, dryRun, patterns } from an operator body, or { error } in one sentence. */
export function readTrainBody(raw) {
  const b = isPlainObject(raw) ? raw : {};
  let limit = TRAIN_LIMIT_DEFAULT;
  if (b.limit !== undefined) {
    const n = b.limit;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > TRAIN_RUN_MAX) return { error: `Set limit to a whole number from 1 to ${TRAIN_RUN_MAX}.` };
    limit = n;
  }
  let userIds = null;
  if (b.userIds !== undefined) {
    if (!Array.isArray(b.userIds) || b.userIds.some((u) => typeof u !== 'string' || !u.trim() || u.trim().length > 128)) {
      return { error: 'Send userIds as a list of account ids.' };
    }
    userIds = [...new Set(b.userIds.map((u) => u.trim()))];
  }
  return { userIds, limit, dryRun: b.dryRun === true, patterns: b.patterns === true };
}

export function setupAiAssistantRoutes(app, {
  requireUser,
  requireOperator,
  hub,
  hubReady,
  hubAppId,
  listWorkspacesDetailed,
  listJourneys,
  loadEvents,
  loadOrders,
  contactsForUser,
  messageStatsFor,
  publicPageCache,
  guidePath,
  dataDir,
  now = () => Date.now(),
  timeouts = TIMEOUTS
}) {
  const ms = { ...TIMEOUTS, ...(isPlainObject(timeouts) ? timeouts : {}) };
  const isoNow = () => new Date(now()).toISOString();
  const aiReady = () => Boolean(hubReady) && typeof hub?.brain?.chat === 'function';
  const trainReady = () => Boolean(hubReady) && typeof hub?.api?.post === 'function';
  // A server that mounts no operator guard serves the operator route to nobody.
  const operatorOnly = typeof requireOperator === 'function'
    ? requireOperator
    : (req, res) => res.status(404).json({ success: false, error: 'Not found.' });
  const docsReady = () => Boolean(hubReady) && typeof hub?.store?.docs?.get === 'function' && typeof hub?.store?.docs?.put === 'function';
  // publicPageCache is a const declared below this mount in server.mjs, so it may arrive as a getter.
  const pagesNow = () => {
    try {
      const pages = typeof publicPageCache === 'function' ? publicPageCache() : publicPageCache;
      return isPlainObject(pages) ? pages : null;
    } catch {
      return null;
    }
  };
  const budget = hourlyBudget(assistantPerHour(process.env), now);

  // ---- The local cache, the way workspaces.json is kept ----
  const cacheFile = dataDir ? path.join(dataDir, THREAD_FILE) : '';
  let cache = {};
  try {
    if (cacheFile && fs.existsSync(cacheFile)) {
      const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (isPlainObject(parsed)) cache = parsed;
    }
  } catch (e) {
    console.warn(`[Jourvance] Failed to read ${THREAD_FILE}, starting empty:`, e.message);
  }
  const persist = () => {
    if (!cacheFile) return;
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
    } catch (e) {
      console.error(`[Jourvance] Failed to persist ${THREAD_FILE}:`, e.message);
    }
  };

  // ---- One user's thread: read, save, and one writer at a time per user ----

  // hub: 'off' (no hub), 'ok', 'missing' (a 404), 'foreign' (a document that is not this user's),
  // 'unreadable' (the hub did not answer with a document or a 404).
  async function readThread(uid) {
    const local = cleanThread(cache[uid], uid);
    const fallback = local || emptyThread(uid);
    if (!docsReady()) return { doc: fallback, hub: 'off' };
    let r;
    try {
      r = await bounded(hub.store.docs.get(threadDocName(uid)), ms.store, 'The app store');
    } catch (err) {
      r = { error: err?.message || 'The hub did not answer.' };
    }
    if (r && !r.error && Object.hasOwn(r, 'document')) {
      const own = cleanThread(r.document, uid);
      if (!own) {
        console.warn('[Jourvance] Ask Jourvance: the stored thread under this name is not this user’s, so it is treated as missing and never saved over.');
        return { doc: fallback, hub: 'foreign' };
      }
      // A save whose hub put failed is only on this server, and it is the newer copy. This server
      // writes its cache before every put, so on a tie its copy is at least as new.
      const newer = local && Date.parse(local.updatedAt) >= Date.parse(own.updatedAt);
      return { doc: newer ? local : own, hub: 'ok' };
    }
    if (Number(r?.status) === 404) return { doc: fallback, hub: 'missing' };
    console.warn('[Jourvance] Ask Jourvance: the thread could not be read from the hub, so this server’s copy is used:', r?.status ?? '', r?.error ?? '');
    return { doc: fallback, hub: 'unreadable' };
  }

  // { doc, durable, reason? }. Never claims durable when the hub was not written.
  async function saveThread(uid, doc, read) {
    const next = {
      ...emptyThread(uid),
      ...doc,
      userId: uid,
      messages: (Array.isArray(doc.messages) ? doc.messages.filter(isMessage) : []).slice(-LIMITS.THREAD_KEEP),
      updatedAt: isoNow()
    };
    cache[uid] = next;
    capThreadCache(cache);
    persist();
    if (read.hub === 'off') return { doc: next, durable: false, reason: NO_HUB };
    // Both keep the conversation on this server only, so the stored copy is never saved over.
    if (read.hub === 'foreign') return { doc: next, durable: false, reason: REASONS.foreignThread };
    if (read.hub === 'unreadable') return { doc: next, durable: false, reason: REASONS.unreadableThread };
    try {
      const r = await bounded(hub.store.docs.put(threadDocName(uid), next), ms.store, 'The app store');
      if (!putLanded(r)) {
        console.warn('[Jourvance] Ask Jourvance: the thread put was not confirmed:', r?.status ?? '', r?.error ?? JSON.stringify(r)?.slice(0, 120));
        return { doc: next, durable: false, reason: REASONS.saveUnconfirmed };
      }
      return { doc: next, durable: true };
    } catch (e) {
      console.warn('[Jourvance] Ask Jourvance: the thread put failed:', e?.message || e);
      return { doc: next, durable: false, reason: failedCall(e) };
    }
  }

  // W3.C: the claim save behind trainingDays and shapeDays. saveThread's write made conditional: the
  // document counts its claims in claimSeq, and a claim is stamped one past the claimSeq it was decided
  // on and put with onlyIfNewer, so of two runs (two servers during a deploy) that read the same copy
  // only the first claim lands and the hub answers the other 409 stale: another run claimed it. Only a
  // confirmed claim reaches this server's cache. Residual: an unconditional save between a read and a
  // claim (a question, a notes save) clears the hub's stamp, so a claim decided before it is not refused.
  const CLAIM_EPOCH_MS = Date.UTC(2000, 0, 1);
  async function saveThreadClaim(uid, doc, read) {
    if (read.hub !== 'ok' && read.hub !== 'missing') return { durable: false, reason: REASONS.recordUnread };
    const seq = Number.isSafeInteger(read.doc?.claimSeq) && read.doc.claimSeq >= 0 && read.doc.claimSeq <= 1e9 ? read.doc.claimSeq : 0;
    const next = {
      ...emptyThread(uid),
      ...doc,
      userId: uid,
      messages: (Array.isArray(doc.messages) ? doc.messages.filter(isMessage) : []).slice(-LIMITS.THREAD_KEEP),
      claimSeq: seq + 1,
      updatedAt: isoNow()
    };
    let r;
    try {
      r = await bounded(hub.store.docs.put(threadDocName(uid), next, { onlyIfNewer: true, sourceUpdatedAt: new Date(CLAIM_EPOCH_MS + seq + 1).toISOString() }), ms.store, 'The app store');
    } catch (e) {
      console.warn('[Jourvance] Ask Jourvance: a claim put failed:', e?.message || e);
      return { durable: false, reason: REASONS.recordUnread };
    }
    if (!putLanded(r)) {
      const stale = isPlainObject(r) && (r.stale === true || Number(r.status) === 409);
      if (!stale) console.warn('[Jourvance] Ask Jourvance: a claim put was not confirmed:', r?.status ?? '', r?.error ?? '');
      return { durable: false, reason: stale ? REASONS.claimTaken : REASONS.recordUnread };
    }
    cache[uid] = next;
    capThreadCache(cache);
    persist();
    return { doc: next, durable: true };
  }

  const locks = threadLocks();
  const withThreadLock = (uid, fn) => locks.run(uid, fn);

  // ---- What the assistant reads ----

  async function settle(label, read) {
    try {
      return await read();
    } catch (err) {
      console.warn(`[Jourvance] Ask Jourvance could not read ${label}:`, err?.message || err);
      return null;
    }
  }

  // Every injected loader is bounded, so one that never settles answers null (not read) instead of
  // holding the request, or a training job's place in inFlight, forever.
  const load = (label, read) => settle(label, () => bounded(read(), ms.store, `The ${label} read`));

  // Workspaces and journeys: the business facts. A workspace list that was not read in full is
  // unavailable, never the placeholder a failed read would otherwise make.
  async function journeyFacts(uid) {
    const listed = await settle('journeys', () => bounded(listJourneys(uid), ms.store, 'The journey list'));
    if (Array.isArray(listed)) return { journeys: listed, journeysComplete: true };
    if (isPlainObject(listed) && Array.isArray(listed.journeys)) return { journeys: listed.journeys, journeysComplete: listed.complete !== false };
    return { journeys: null, journeysComplete: false };
  }

  async function businessFacts(uid) {
    const ws = await settle('workspaces', () => bounded(listWorkspacesDetailed(uid), ms.store, 'The workspace list'));
    const workspacesComplete = isPlainObject(ws) && Array.isArray(ws.workspaces) && ws.complete === true;
    const { journeys, journeysComplete } = await journeyFacts(uid);
    return { workspaces: workspacesComplete ? ws.workspaces : null, workspacesComplete, journeys, journeysComplete };
  }

  async function contextPack(uid, facts, focusJourneyId = '') {
    const events = await load('the event log', () => loadEvents());
    const orders = await load('orders', () => loadOrders());
    const contacts = await load('contacts', () => contactsForUser(uid));
    const emailStats = await load('email stats', () => messageStatsFor(uid, () => true));
    return buildContextPack({
      uid,
      workspaces: facts.workspaces,
      journeys: facts.journeys,
      journeysComplete: facts.journeysComplete,
      events: Array.isArray(events) ? events : null,
      orders: Array.isArray(orders) ? orders : null,
      contacts: Array.isArray(contacts) ? contacts : null,
      emailStats: isPlainObject(emailStats) ? emailStats : null,
      publicPages: pagesNow(),
      focusJourneyId,
      now: now()
    });
  }

  // ---- Account scope on the hub (plan 3.4a) ----
  // brainChat (server/aiCall.mjs) holds the one memory of a refused account scope for the process.
  const accountBrain = () => (
    !aiReady()
      ? { readable: false, reason: REASONS.noHub }
      : accountScopeRefused(now())
        ? { readable: false, reason: REASONS.accountScopeRefused }
        : { readable: true }
  );

  // ---- The private profile (plan 3.4) ----

  async function syncBusinessProfile(uid, doc, facts) {
    const at = isoNow();
    if (!Boolean(hubReady) || typeof hub?.api?.post !== 'function') return { profileOnHub: { durable: false, reason: NO_HUB, at } };
    if (!facts.workspacesComplete) return { profileOnHub: { durable: false, reason: REASONS.workspacesIncomplete, at } };
    if (!facts.journeys || !facts.journeysComplete) return { profileOnHub: { durable: false, reason: REASONS.journeysIncomplete, at } };
    const pack = buildContextPack({
      uid,
      workspaces: facts.workspaces,
      journeys: facts.journeys,
      journeysComplete: facts.journeysComplete,
      events: [],
      orders: [],
      contacts: [],
      emailStats: {},
      publicPages: pagesNow() || {},
      now: now()
    });
    const content = businessProfileMarkdown(pack, doc.notes);
    if (!content) return { profileOnHub: { durable: false, reason: REASONS.nothingToSend, at } };
    const sha = sha256(content);
    // Aura's hash-skip rule: an unchanged profile is not sent again.
    if (sha === doc.profileSha && doc.profileOnHub?.durable === true) return { unchanged: true, profileOnHub: doc.profileOnHub };
    if (!underDailyCap(doc, 'profileDays', LIMITS.PROFILE_SYNC_PER_DAY, now())) {
      return { profileOnHub: { durable: false, reason: REASONS.profileCap, at } };
    }
    const profileDays = countDaily(doc, 'profileDays', now());
    let r;
    try {
      r = await bounded(hub.api.post(PROFILE_PATH, { appId: hubAppId, accountId: uid, content }), ms.profile, 'The profile post');
    } catch (err) {
      console.warn('[Jourvance] Ask Jourvance: the profile post failed:', err?.message || err);
      return { profileDays, profileOnHub: { durable: false, reason: err?.timedOut ? REASONS.timeout : REASONS.profileRefused, at } };
    }
    if (!profileLanded(r)) {
      console.warn('[Jourvance] Ask Jourvance: the profile post was refused:', r?.status ?? '', r?.error ?? JSON.stringify(r)?.slice(0, 120));
      return { profileDays, profileOnHub: { durable: false, reason: REASONS.profileRefused, at } };
    }
    return { profileDays, profileSha: sha, profileOnHub: { durable: true, at, sha } };
  }

  // ---- Training off this account's own data (W2.S S3) ----

  // The jobs running now, one per user, and the UTC day each user was last checked by GET thread,
  // so opening the panel all day compiles the file at most once a day per user on this server.
  const inFlight = new Map();
  const checkedOn = new Map();

  async function trainingInputs(uid) {
    const { inWindow } = trainingWindow(now());
    const facts = await journeyFacts(uid);
    const events = await load('the event log', () => loadEvents());
    const orders = await load('orders', () => loadOrders());
    const contacts = await load('contacts', () => contactsForUser(uid));
    // The same window for email as for the journeys: a send, an open or an order touch inside it.
    const emailStats = await load('email stats', () => messageStatsFor(uid, (item) => inWindow(item?.at)));
    return {
      journeys: facts.journeys,
      journeysComplete: facts.journeysComplete,
      events: Array.isArray(events) ? events : null,
      orders: Array.isArray(orders) ? orders : null,
      contacts: Array.isArray(contacts) ? contacts : null,
      emailStats: isPlainObject(emailStats) ? emailStats : null,
      publicPages: pagesNow()
    };
  }

  // { sent, outcome, reason?, row }. outcome: 'sent', 'would-send', 'unchanged', 'skipped', 'failed'.
  // Nothing is sent unless the saved record was read (ok, or missing for a first send) and the day was
  // claimed by a save the hub confirmed: a failed read or a refused save would let two servers, or a
  // retry after a refused save, send twice in one day.
  const recordRead = (read) => read.hub === 'ok' || read.hub === 'missing';
  async function sendWhatWorked(uid, thread, compiled, { dryRun, deadline }) {
    const row = compiled.row;
    if (!compiled.content) return { sent: false, outcome: 'skipped', reason: REASONS.nothingToSend, row };
    // A file built from a partial read would replace a complete one on the hub.
    if (compiled.unavailable.length) return { sent: false, outcome: 'skipped', reason: REASONS.dataIncomplete, row: null };
    if (!recordRead(thread)) return { sent: false, outcome: 'skipped', reason: REASONS.recordUnread, row };
    // Aura's hash-skip rule: an unchanged file is not sent again.
    const unchanged = (doc) => compiled.sha === doc.trainingSha && doc.trainingOnHub?.durable === true;
    if (unchanged(thread.doc)) return { sent: false, outcome: 'unchanged', reason: REASONS.trainingUnchanged, row };
    if (!underDailyCap(thread.doc, 'trainingDays', TRAINING_PER_DAY, now())) return { sent: false, outcome: 'skipped', reason: REASONS.trainingSentToday, row };
    if (dryRun) return { sent: false, outcome: 'would-send', reason: REASONS.dryRun, row };
    if (!trainReady()) return { sent: false, outcome: 'skipped', reason: NO_HUB, row };
    if (Date.now() > deadline) return { sent: false, outcome: 'skipped', reason: REASONS.dataTooSlow, row };

    // Claim the day first, under the lock, on a fresh read, with a save the hub must confirm.
    const claim = await withThreadLock(uid, async () => {
      const fresh = await readThread(uid);
      if (!recordRead(fresh)) return { reason: REASONS.recordUnread, outcome: 'skipped' };
      if (unchanged(fresh.doc)) return { reason: REASONS.trainingUnchanged, outcome: 'unchanged' };
      if (!underDailyCap(fresh.doc, 'trainingDays', TRAINING_PER_DAY, now())) return { reason: REASONS.trainingSentToday, outcome: 'skipped' };
      const saved = await saveThreadClaim(uid, { ...fresh.doc, trainingDays: countDaily(fresh.doc, 'trainingDays', now()) }, fresh);
      return saved.durable ? { ok: true } : { reason: saved.reason, outcome: 'skipped' };
    });
    if (!claim.ok) return { sent: false, outcome: claim.outcome, reason: claim.reason, row };

    const at = isoNow();
    let r;
    let threw = null;
    try {
      r = await bounded(hub.api.post(REPLACE_PATH, { appId: hubAppId, accountId: uid, filename: WHAT_WORKED_FILE, content: compiled.content }), ms.profile, 'The training send');
    } catch (err) {
      threw = err;
    }
    const landed = !threw && replaceLanded(r);
    if (!landed) console.warn('[Jourvance] Ask Jourvance: what-worked.md was not taken:', threw?.message || r?.status || '', threw ? '' : (r?.error ?? JSON.stringify(r)?.slice(0, 120)));
    const reason = threw ? failedCall(threw) : profileLanded(r) ? REASONS.trainingStaleCopy : REASONS.trainingRefused;
    const record = landed ? { durable: true, at, sha: compiled.sha } : { durable: false, at, reason };
    // The outcome is recorded under the lock on a fresh read, so a question or a notes save made
    // meanwhile is kept. The day was already counted by the claim.
    await withThreadLock(uid, async () => {
      const fresh = await readThread(uid);
      if (!recordRead(fresh)) {
        console.warn('[Jourvance] Ask Jourvance: the training outcome was not recorded: the saved record could not be read.');
        return;
      }
      const saved = await saveThread(uid, { ...fresh.doc, ...(landed ? { trainingSha: compiled.sha } : {}), trainingOnHub: record }, fresh);
      if (!saved.durable) console.warn('[Jourvance] Ask Jourvance: the training record was kept on this server only:', saved.reason);
    });
    return landed ? { sent: true, outcome: 'sent', row } : { sent: false, outcome: 'failed', reason, row };
  }

  // ---- Journey shapes to the shared brain (W3.C) ----
  // Each journey with enough visits and orders teaches its SHAPE (fixed words and a band, built by
  // compileShapeLearns) through hub.brain.learn on the APP's own account: the hub's learn route
  // refuses a per-user accountId, and the shared pattern is the point. Guarded like the what-worked
  // send: nothing leaves unless the saved record was read, a shape this spoke sent in the last
  // SHAPE_RESEND_DAYS days is not sent again, and today's SHAPE_LEARNS_PER_DAY slots are claimed by
  // a save the hub confirmed BEFORE any send (the cap counts attempts, like the feedback cap).
  const learnReady = () => Boolean(hubReady) && typeof hub?.brain?.learn === 'function';
  // The feedback route's rule (an answer the hub took), plus the hub's duplicate: it answers
  // { success: true, ingested: false, reason: 'duplicate' } for a pattern it already holds, which is
  // landed for this spoke too, so its sha is recorded and it is not sent again.
  const learnLanded = (r) => isPlainObject(r) && !r.error && r.success === true && (r.ingested === true || (r.ingested === false && r.reason === 'duplicate'));

  // The app-wide day budget (SHAPE_LEARNS_APP_PER_DAY), claimed the way sendPatterns claims its month:
  // read SHAPES_DAY_DOC, then put today's raised count with onlyIfNewer, stamped one millisecond per
  // shape already counted past the day's first instant. Two runs that read the same count send the
  // same stamp and the hub answers the second 409 stale; a run that read an older count sends an older
  // stamp and is refused too; the previous day's stamps all sit before today's. Answers { granted }
  // or { granted: 0, reason }: a read that is neither a document nor a 404, a count that will not
  // parse (read as a full day) and any put that did not land all grant nothing this pass.
  async function claimAppShapes(n) {
    if (!docsReady()) return { granted: 0, reason: REASONS.shapeAppUnchecked };
    const day = dayKey(now());
    const dayStartMs = Date.parse(`${day}T00:00:00.000Z`);
    let seen;
    try {
      seen = await bounded(hub.store.docs.get(SHAPES_DAY_DOC), ms.store, 'The app store');
    } catch (err) {
      seen = { error: err?.message || 'The hub did not answer.' };
    }
    let used = 0;
    if (isPlainObject(seen) && !seen.error && Object.hasOwn(seen, 'document')) {
      const doc = isPlainObject(seen.document) ? seen.document : {};
      if (doc.day === day) used = Number.isSafeInteger(doc.count) && doc.count >= 0 ? doc.count : SHAPE_LEARNS_APP_PER_DAY;
    } else if (!(isPlainObject(seen) && Number(seen.status) === 404)) {
      return { granted: 0, reason: REASONS.shapeAppUnchecked };
    }
    const granted = Math.min(n, SHAPE_LEARNS_APP_PER_DAY - used);
    if (!(granted > 0)) return { granted: 0, reason: REASONS.shapeAppCap };
    let put;
    try {
      put = await bounded(hub.store.docs.put(SHAPES_DAY_DOC, { day, count: used + granted }, { onlyIfNewer: true, sourceUpdatedAt: new Date(dayStartMs + used + 1).toISOString() }), ms.store, 'The app store');
    } catch (err) {
      put = { error: err?.message || 'The hub did not answer.' };
    }
    if (!putLanded(put)) return { granted: 0, reason: REASONS.shapeAppClaimed };
    return { granted };
  }

  // { sent, skipped, failed, reason?, rows? }: counts of the qualifying shapes, a bare cause when one
  // explains the outcome, and on a dry run the rows that would be sent, prompts included, so the
  // operator can read what would leave. Never throws past trainUser's catch.
  async function sendShapes(uid, thread, inputs, compiled, { dryRun, deadline }) {
    const done = (counts, reason, rows) => ({ sent: 0, skipped: 0, failed: 0, ...counts, ...(reason ? { reason } : {}), ...(dryRun ? { rows: rows || [] } : {}) });
    // A shape from a partial read could teach a rate that is not this journey's.
    if (!Array.isArray(inputs.journeys) || inputs.journeysComplete === false || !inputs.events || !inputs.orders || !inputs.publicPages) {
      return done({}, REASONS.dataIncomplete);
    }
    // A capped event log drops visits but keeps every order, so its rates run high: no shape from it.
    if (eventsPartial(inputs.events, uid, trainingWindow(now()).cutoff)) return done({}, REASONS.dataIncomplete);
    const { rows } = compileShapeLearns({ uid, journeys: inputs.journeys, figures: compiled.figures, businessTypes: BUSINESS_TYPES });
    if (!rows.length) return done({}, REASONS.shapesNone);
    // With no hub the record cannot be read either; the missing hub is the cause worth naming.
    if (!dryRun && !learnReady()) return done({ skipped: rows.length }, NO_HUB);
    if (!recordRead(thread)) return done({ skipped: rows.length }, REASONS.recordUnread);
    const due = rows.filter((r) => !shapeSentRecently(thread.doc.shapeLearns, r.sha, now()));
    const take = due.slice(0, shapeSlotsLeft(thread.doc, now()));
    if (!take.length) return done({ skipped: rows.length }, due.length ? REASONS.shapeCap : REASONS.shapeSentRecently);
    if (dryRun) return done({ skipped: rows.length - take.length }, REASONS.dryRun, take);
    if (Date.now() > deadline) return done({ skipped: rows.length }, REASONS.dataTooSlow);

    // Claim today's slots first, under the lock, on a fresh read, with a save the hub must confirm.
    const claim = await withThreadLock(uid, async () => {
      const fresh = await readThread(uid);
      if (!recordRead(fresh)) return { reason: REASONS.recordUnread };
      const pending = take.filter((r) => !shapeSentRecently(fresh.doc.shapeLearns, r.sha, now()));
      const want = Math.min(pending.length, shapeSlotsLeft(fresh.doc, now()));
      if (!want) return { reason: pending.length ? REASONS.shapeCap : REASONS.shapeSentRecently };
      // The app's budget for the day first, then this account's slots for as many as it granted.
      const app = await claimAppShapes(want);
      if (!app.granted) return { reason: app.reason };
      const saved = await saveThreadClaim(uid, { ...fresh.doc, shapeDays: claimShapeDays(fresh.doc, app.granted, now()) }, fresh);
      if (!saved.durable) return { reason: saved.reason };
      return { rows: pending.slice(0, app.granted), short: app.granted < want ? REASONS.shapeAppCap : '' };
    });
    if (!claim.rows) return done({ skipped: rows.length }, claim.reason);

    let sent = 0;
    let failed = 0;
    let reason = '';
    const landedShas = [];
    for (const row of claim.rows) {
      let r;
      let threw = null;
      try {
        r = await bounded(hub.brain.learn({ accountId: hubAppId, kind: row.kind, niche: row.niche, prompt: row.prompt, rating: row.rating }), ms.learn, 'The shape learn');
      } catch (err) {
        threw = err;
      }
      if (!threw && learnLanded(r)) {
        sent += 1;
        landedShas.push(row.sha);
        continue;
      }
      failed += 1;
      reason = threw ? failedCall(threw) : REASONS.shapeRefused;
      console.warn('[Jourvance] Ask Jourvance: a journey shape was not taken:', threw?.message || r?.status || '', threw ? '' : (r?.error ?? r?.reason ?? JSON.stringify(r)?.slice(0, 120)));
      // A hub that did not answer is not asked again in this job; the claimed slots stay spent.
      if (threw) break;
    }
    // Only a landed shape is recorded, under the lock on a fresh read, so a question or a notes save
    // made meanwhile is kept. A failed one is not recorded, so a later day may send it again.
    if (landedShas.length) {
      await withThreadLock(uid, async () => {
        const fresh = await readThread(uid);
        if (!recordRead(fresh)) {
          console.warn('[Jourvance] Ask Jourvance: the journey shapes sent were not recorded: the saved record could not be read.');
          return;
        }
        let shapeLearns = fresh.doc.shapeLearns;
        for (const sha of landedShas) shapeLearns = recordShapeLearn(shapeLearns, sha, now());
        const saved = await saveThread(uid, { ...fresh.doc, shapeLearns }, fresh);
        if (!saved.durable) console.warn('[Jourvance] Ask Jourvance: the journey shape record was kept on this server only:', saved.reason);
      });
    }
    return done({ sent, failed, skipped: rows.length - sent - failed }, failed ? reason : claim.short);
  }

  // { sent, outcome, reason?, row, shapes }. The what-worked file first, then the journey shapes,
  // whatever the file's outcome; a fault in either is that part's failed outcome, never the other's.
  async function trainUser(uid, { dryRun, deadline }) {
    const thread = await readThread(uid);
    const inputs = await trainingInputs(uid);
    const compiled = compileWhatWorked({ uid, ...inputs, now: now() });
    let result;
    try {
      result = await sendWhatWorked(uid, thread, compiled, { dryRun, deadline });
    } catch (err) {
      console.warn('[Jourvance] Ask Jourvance training failed:', err?.message || err);
      result = { sent: false, outcome: 'failed', reason: REASONS.noAnswer, row: null };
    }
    let shapes;
    try {
      shapes = await sendShapes(uid, thread, inputs, compiled, { dryRun, deadline });
    } catch (err) {
      console.warn('[Jourvance] Ask Jourvance: the journey shapes failed:', err?.message || err);
      shapes = { sent: 0, skipped: 0, failed: 0, reason: REASONS.noAnswer, ...(dryRun ? { rows: [] } : {}) };
    }
    return { ...result, shapes };
  }

  // One job per user at a time. Never throws: a fault is a failed outcome.
  async function trainOne(uid, { dryRun = false, deadline = Date.now() + ms.train } = {}) {
    if (inFlight.has(uid)) return { uid, sent: false, outcome: 'skipped', reason: REASONS.trainingBusy, row: null };
    const job = (async () => {
      try {
        return await trainUser(uid, { dryRun, deadline });
      } catch (err) {
        console.warn('[Jourvance] Ask Jourvance training failed:', err?.message || err);
        return { sent: false, outcome: 'failed', reason: REASONS.noAnswer, row: null };
      }
    })();
    inFlight.set(uid, job);
    try {
      return { uid, ...(await job) };
    } finally {
      inFlight.delete(uid);
    }
  }

  // After GET thread has answered: at most one check a day per user on this server, in the
  // background, bounded, and nothing it does can reach the answer or throw.
  function trainLater(uid) {
    try {
      if (!trainReady()) return;
      const today = dayKey(now());
      if (checkedOn.get(uid) === today || inFlight.has(uid)) return;
      checkedOn.set(uid, today);
      if (checkedOn.size > THREAD_CACHE_USERS * 10) {
        for (const [id, day] of checkedOn) if (day !== today) checkedOn.delete(id);
      }
      bounded(trainOne(uid, { deadline: Date.now() + ms.train }), ms.train, 'The training job').catch((err) => {
        console.warn('[Jourvance] Ask Jourvance training job:', err?.message || err);
      });
    } catch (err) {
      console.warn('[Jourvance] Ask Jourvance could not start training:', err?.message || err);
    }
  }

  // The screen from the request, with a journey id kept only when it is one of this user's journeys.
  async function screenOf(uid, raw, journeys, query = false) {
    const screen = readScreen(raw, { query });
    if (!screen?.journeyId) return screen;
    const list = journeys !== undefined ? journeys : (await journeyFacts(uid)).journeys;
    return ownScreen(screen, list, uid);
  }

  // ---- Routes ----

  app.get('/api/ai/assistant/thread', requireUser, async (req, res) => {
    try {
      const uid = req.user.uid;
      const { doc } = await readThread(uid);
      // W3.A: a stored action's label is never sent as stored. Each is built again from this user's
      // current journey list, and a journey action whose journey is gone (or a list that could not
      // be read) is dropped. The list is read only when a stored journey action needs it.
      const needsJourneys = doc.messages.some((m) => Array.isArray(m.actions) && m.actions.some((a) => a?.kind !== 'open'));
      const journeys = needsJourneys ? (await journeyFacts(uid)).journeys : undefined;
      const owned = Array.isArray(journeys) ? journeys.filter((j) => isPlainObject(j) && j.userId === uid) : null;
      const messages = doc.messages.map((m) => {
        if (!Array.isArray(m.actions)) return m;
        const { actions, ...rest } = m;
        const kept = relabelStoredActions(actions, owned);
        return kept.length ? { ...rest, actions: kept } : rest;
      });
      const screen = await screenOf(uid, req.query?.screen, journeys, true);
      const available = aiReady();
      res.json({
        success: true,
        available,
        ...(available ? {} : { reason: 'ai-unavailable' }),
        messages,
        notes: doc.notes,
        profileOnHub: doc.profileOnHub || { durable: false, reason: REASONS.notSentYet },
        trainingOnHub: doc.trainingOnHub || { durable: false, reason: REASONS.notSentYet },
        accountBrain: accountBrain(),
        screen: screen || null
      });
      // Only once the answer has gone: the send never delays it.
      trainLater(uid);
      return undefined;
    } catch (err) {
      console.warn('[Jourvance] Ask Jourvance thread read failed:', err?.message || err);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'The conversation could not be loaded. Try again.', retryable: true });
    }
  });

  app.post('/api/ai/assistant/ask', requireUser, async (req, res) => {
    try {
      const read = readMessage(req.body);
      if (read.error) return res.status(400).json({ success: false, error: read.error });
      if (!aiReady()) return res.status(503).json(UNAVAILABLE);

      const uid = req.user.uid;
      // Pressing Retry at once cannot help, so the answer is not retryable and says when instead.
      if (!budget.left(uid)) {
        const wait = limitWaitSeconds(budget.retryAfter(uid));
        res.set('Retry-After', String(wait));
        return res.status(429).json({ success: false, error: limitMessage(wait), retryable: false, reason: 'hourly-ai-limit', retryAfterSeconds: wait });
      }

      const thread = await readThread(uid);
      const facts = await businessFacts(uid);
      // A screen in a bad shape is dropped silently; a journey id that is not this user's is dropped.
      const screen = await screenOf(uid, req.body?.screen, facts.journeys);
      const pack = await contextPack(uid, facts, screen?.journeyId || '');
      const guide = guideSectionsFor(read.message, loadGuideSections(guidePath));
      const system = assistantSystem(pack, guide, thread.doc.messages, thread.doc.notes, screen);

      // brainChat names this user as the account, and on the hub's account refusal asks again with
      // app grounding and remembers the refusal for ACCOUNT_REFUSAL_MS (plan 3.4a).
      // The reply is asked for as JSON { answer, actions } (W3.A). brainChat hands a json answer back
      // as the hub sent it, so the answer is read, cut and cleaned here, and a reply that is not JSON
      // is the answer whole with no actions.
      const answer = await brainChat({ hub, hubReady, uid, prompt: read.message, system, json: true, topK: 4, timeouts: { chat: ms.chat }, now, label: 'Ask Jourvance' });
      if (!answer.ok) {
        if (answer.kind === 'unavailable') return res.status(503).json(UNAVAILABLE);
        return res.status(502).json(NO_ANSWER);
      }
      const grounding = answer.grounding;
      // A journey action is kept only for the journey on the canvas (screen.journeyId, which screenOf
      // kept only when it is this user's), and its label names it from this user's own list.
      const ownJourneys = Array.isArray(facts.journeys) ? facts.journeys.filter((j) => isPlainObject(j) && j.userId === uid) : [];
      const replied = readReply(answer.text, screen, { journeys: ownJourneys, clean: cleanModelStrings });
      // readReply has already cut the hub's text to its cap before parsing it.
      const text = capAnswer(cleanModelStrings(replied.answer));
      if (!text) return res.status(502).json(UNREADABLE);

      const at = isoNow();
      const asked = { id: newId(), role: 'user', text: read.message, at };
      const reply = { id: newId(), role: 'assistant', text, at, grounding, ...(replied.actions.length ? { actions: replied.actions } : {}) };
      // Read again under the lock, so a notes save or a rating made while the hub answered is kept.
      await withThreadLock(uid, async () => {
        const fresh = await readThread(uid);
        const saved = await saveThread(uid, { ...fresh.doc, messages: [...fresh.doc.messages, asked, reply] }, fresh);
        if (!saved.durable) console.warn('[Jourvance] Ask Jourvance: the conversation was kept on this server only:', saved.reason);
      });
      return res.json({ success: true, answer: reply, source: 'hub-brain' });
    } catch (err) {
      console.warn('[Jourvance] Ask Jourvance failed:', err?.message || err);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'The assistant failed on the server. Nothing changed. Try again.', retryable: true });
    }
  });

  app.post('/api/ai/assistant/notes', requireUser, async (req, res) => {
    try {
      const read = readNotes(req.body);
      if (read.error) return res.status(400).json({ success: false, error: read.error });
      const uid = req.user.uid;
      const out = await withThreadLock(uid, async () => {
        const thread = await readThread(uid);
        // The notes are saved first, so a slow or failed sync never loses them.
        const first = await saveThread(uid, { ...thread.doc, notes: read.notes }, thread);
        const sync = await syncBusinessProfile(uid, first.doc, await businessFacts(uid));
        let saved = first;
        if (!sync.unchanged) {
          saved = await saveThread(uid, {
            ...first.doc,
            ...(sync.profileDays ? { profileDays: sync.profileDays } : {}),
            ...(sync.profileSha ? { profileSha: sync.profileSha } : {}),
            profileOnHub: sync.profileOnHub
          }, thread);
        }
        return { notes: saved.doc.notes, profileOnHub: sync.profileOnHub, saved: saved.durable ? { durable: true } : { durable: false, reason: saved.reason } };
      });
      return res.json({ success: true, notes: out.notes, profileOnHub: out.profileOnHub, saved: out.saved });
    } catch (err) {
      console.warn('[Jourvance] Ask Jourvance notes save failed:', err?.message || err);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Your notes could not be saved on the server. Try again.', retryable: true });
    }
  });

  app.post('/api/ai/assistant/feedback', requireUser, async (req, res) => {
    try {
      const read = readFeedback(req.body);
      if (read.error) return res.status(400).json({ success: false, error: read.error });
      const uid = req.user.uid;
      const out = await withThreadLock(uid, async () => {
        const thread = await readThread(uid);
        const messages = thread.doc.messages.map((m) => ({ ...m }));
        const at = messages.findIndex((m) => m.id === read.answerId && m.role === 'assistant');
        if (at < 0) return { status: 404, body: { success: false, error: 'That answer is not in your conversation.' } };
        const msg = messages[at];
        msg.rating = read.rating;
        let shared = false;
        let reason = '';
        let feedbackDays = thread.doc.feedbackDays;
        if (read.rating === 'up') {
          if (msg.shared === true) {
            // Once per message: a second Helpful never sends it again. A failed send is not stamped,
            // so a later Helpful may try again; the daily cap counts every attempt.
            shared = true;
          } else if (!Boolean(hubReady) || typeof hub?.brain?.learn !== 'function') {
            reason = REASONS.noHub;
          } else if (!underDailyCap(thread.doc, 'feedbackDays', LIMITS.FEEDBACK_PER_DAY, now())) {
            reason = REASONS.shareCap;
          } else {
            // Only the question is shared, cut down to words of the Jourvance guide. The answer,
            // which repeats this account's FACTS, never leaves this server.
            const question = [...messages.slice(0, at)].reverse().find((m) => m.role === 'user')?.text || '';
            const share = shareableQuestion(question, loadShareAllowlist(guidePath));
            if (!share.ok) {
              reason = share.reason;
            } else {
              feedbackDays = countDaily(thread.doc, 'feedbackDays', now());
              let r;
              let threw = null;
              try {
                r = await bounded(hub.brain.learn({ accountId: hubAppId, kind: 'assistant-question', niche: 'general', prompt: share.text, rating: 5 }), ms.learn, 'The learn call');
              } catch (err) {
                threw = err;
              }
              shared = !threw && isPlainObject(r) && r.ingested === true;
              if (shared) msg.shared = true;
              else {
                console.warn('[Jourvance] Ask Jourvance: the answer was not shared:', threw?.message || r?.error || r?.reason || JSON.stringify(r)?.slice(0, 120));
                reason = threw ? failedCall(threw) : REASONS.shareRefused;
              }
            }
          }
        }
        const saved = await saveThread(uid, { ...thread.doc, messages, feedbackDays }, thread);
        if (!saved.durable) console.warn('[Jourvance] Ask Jourvance: the rating was kept on this server only:', saved.reason);
        return { status: 200, body: { success: true, shared, ...(reason ? { reason } : {}) } };
      });
      return res.status(out.status).json(out.body);
    } catch (err) {
      console.warn('[Jourvance] Ask Jourvance feedback failed:', err?.message || err);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Your rating could not be saved on the server. Try again.', retryable: true });
    }
  });

  app.delete('/api/ai/assistant/thread', requireUser, async (req, res) => {
    try {
      const uid = req.user.uid;
      const saved = await withThreadLock(uid, async () => {
        const thread = await readThread(uid);
        // Only the conversation goes: the notes, the profile state and today's counts stay.
        return saveThread(uid, { ...thread.doc, messages: [] }, thread);
      });
      return res.json({ success: true, ...(saved.durable ? { durable: true } : { durable: false, reason: saved.reason }) });
    } catch (err) {
      console.warn('[Jourvance] Ask Jourvance clear failed:', err?.message || err);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'The conversation could not be cleared. Try again.', retryable: true });
    }
  });

  // ---- The operator's training run (W2.S S3 and S3b) ----

  // The app patterns: one dated file a month, appended to the app corpus (2 credits), so a second
  // send in the same month is refused rather than stacked beside the first.
  async function sendPatterns(rows, { dryRun, at }) {
    const compiled = compileAppPatterns(rows, { now: at });
    const out = { filename: compiled.filename, groups: compiled.groups, accounts: compiled.accounts, sent: false };
    if (!compiled.content) return { ...out, reason: REASONS.patternsNone };
    if (dryRun) return { ...out, reason: REASONS.dryRun, content: compiled.content };
    if (!Boolean(hubReady) || typeof hub?.brain?.ingest !== 'function') return { ...out, reason: NO_HUB };
    // One file a month, claimed BEFORE the send: a conditional put stamped with the first instant of
    // the month succeeds once per month (the hub answers 409 stale to a second claim), so two
    // overlapping runs cannot both send. A read or a claim that answers anything else sends nothing.
    const filename = compiled.filename;
    const monthStart = `${filename.slice('jourvance-patterns-'.length, -'.md'.length)}-01T00:00:00.000Z`;
    if (!docsReady()) return { ...out, reason: REASONS.patternsUnchecked };
    let seen;
    try {
      seen = await bounded(hub.store.docs.get(PATTERNS_DOC), ms.store, 'The app store');
    } catch (err) {
      seen = { error: err?.message || 'The hub did not answer.' };
    }
    if (isPlainObject(seen) && !seen.error && Object.hasOwn(seen, 'document')) {
      const doc = isPlainObject(seen.document) ? seen.document : {};
      if (doc.filename === filename && doc.state === 'sent') return { ...out, reason: REASONS.patternsSentThisMonth };
      if (doc.filename === filename) return { ...out, reason: REASONS.patternsClaimed };
    } else if (!(isPlainObject(seen) && Number(seen.status) === 404)) {
      return { ...out, reason: REASONS.patternsUnchecked };
    }
    const iso = new Date(at).toISOString();
    let claim;
    try {
      claim = await bounded(hub.store.docs.put(PATTERNS_DOC, { filename, state: 'claimed', at: iso }, { onlyIfNewer: true, sourceUpdatedAt: monthStart }), ms.store, 'The app store');
    } catch (err) {
      claim = { error: err?.message || 'The hub did not answer.' };
    }
    if (!putLanded(claim)) {
      return { ...out, reason: isPlainObject(claim) && (claim.stale === true || Number(claim.status) === 409) ? REASONS.patternsClaimed : REASONS.patternsUnchecked };
    }
    let r;
    let threw = null;
    try {
      r = await bounded(hub.brain.ingest({ scope: 'app', filename, content: compiled.content }), ms.profile, 'The patterns send');
    } catch (err) {
      threw = err;
    }
    const record = async (document, sourceUpdatedAt) => {
      try {
        const put = await bounded(hub.store.docs.put(PATTERNS_DOC, document, { sourceUpdatedAt }), ms.store, 'The app store');
        if (!putLanded(put)) console.warn('[Jourvance] Ask Jourvance: the patterns record was not saved:', put?.status ?? '', put?.error ?? '');
      } catch (err) {
        console.warn('[Jourvance] Ask Jourvance: the patterns record was not saved:', err?.message || err);
      }
    };
    if (threw || !profileLanded(r)) {
      console.warn('[Jourvance] Ask Jourvance: the app patterns were not taken:', threw?.message || r?.status || '', threw ? '' : (r?.error ?? ''));
      // A refusal is released, stamped just before the month, so a later run this month may claim it.
      // A send that threw or timed out may still have landed, so its claim is kept.
      if (!threw) await record({ filename: '', state: 'released', at: iso }, new Date(Date.parse(monthStart) - 1).toISOString());
      return { ...out, reason: threw ? failedCall(threw) : REASONS.trainingRefused };
    }
    await record({ filename, state: 'sent', sha: sha256(compiled.content), at: iso }, monthStart);
    return { ...out, sent: true };
  }

  /** A journey id in an operator answer: a salted sha256 cut to 16 hex characters, as hashedUid does. */
  const hashedJourneyId = (id) => `j_${sha256(`jourvance-assistant-train-journey:${id}`).slice(0, 16)}`;

  app.post('/api/ai/assistant/admin/train', operatorOnly, async (req, res) => {
    try {
      const read = readTrainBody(req.body);
      if (read.error) return res.status(400).json({ success: false, error: read.error });
      const at = now();
      let ids = read.userIds;
      if (!ids) {
        const events = await load('the event log', () => loadEvents());
        const orders = await load('orders', () => loadOrders());
        if (!Array.isArray(events)) {
          return res.status(503).json({ success: false, error: 'The event log could not be read, so there is no list of accounts to train. Name them in userIds or try again.', retryable: true });
        }
        ids = activeAccounts({ events, orders: Array.isArray(orders) ? orders : [], now: at });
      }
      ids = ids.slice(0, read.limit);

      const started = Date.now();
      const results = new Array(ids.length);
      let next = 0;
      const worker = async () => {
        while (next < ids.length) {
          const i = next++;
          if (Date.now() - started > TRAIN_RUN_MS) {
            results[i] = { uid: ids[i], sent: false, outcome: 'skipped', reason: REASONS.trainingNotReached, row: null };
            continue;
          }
          results[i] = await trainOne(ids[i], { dryRun: read.dryRun, deadline: Date.now() + ms.train });
        }
      };
      await Promise.all(Array.from({ length: Math.min(TRAIN_CONCURRENCY, ids.length) }, worker));

      const counts = { accounts: ids.length, sent: 0, wouldSend: 0, unchanged: 0, skipped: 0, failed: 0 };
      const key = { sent: 'sent', 'would-send': 'wouldSend', unchanged: 'unchanged', skipped: 'skipped', failed: 'failed' };
      for (const r of results) counts[key[r.outcome] || 'failed'] += 1;
      // Never a raw uid or an email in an operator answer: each account is named by its hash, and on a
      // dry run each journey shape by a hash of its journey id (W3.C), beside the prompt that would leave.
      const tally = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
      const shapesOf = (r) => {
        const s = isPlainObject(r.shapes) ? r.shapes : {};
        return {
          sent: tally(s.sent),
          skipped: tally(s.skipped),
          failed: tally(s.failed),
          ...(s.reason ? { reason: s.reason } : {}),
          ...(read.dryRun
            ? { rows: (Array.isArray(s.rows) ? s.rows : []).map((row) => ({ prompt: row.prompt, niche: row.niche, rating: row.rating, journeyId: hashedJourneyId(row.journeyId) })) }
            : {})
        };
      };
      const users = results.map((r) => ({ uid: hashedUid(r.uid), sent: r.sent === true, ...(r.reason ? { reason: r.reason } : {}), shapes: shapesOf(r) }));
      // The shape totals sit beside `counts`, which keeps its shape.
      const shapes = users.reduce((t, u) => ({ sent: t.sent + u.shapes.sent, skipped: t.skipped + u.shapes.skipped, failed: t.failed + u.shapes.failed }), { sent: 0, skipped: 0, failed: 0 });
      const patterns = read.patterns
        ? await sendPatterns(results.map((r) => r.row).filter(Boolean), { dryRun: read.dryRun, at })
        : undefined;
      return res.json({ success: true, dryRun: read.dryRun, users, counts, shapes, ...(patterns ? { patterns } : {}) });
    } catch (err) {
      console.warn('[Jourvance] Ask Jourvance training run failed:', err?.message || err);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'The training run failed on the server. Try again.', retryable: true });
    }
  });
}
