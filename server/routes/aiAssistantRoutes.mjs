// Ask Jourvance: the assistant's five routes (ASK_JOURVANCE_PLAN.md section 3).
//
//   GET    /api/ai/assistant/thread    the signed-in user's conversation, notes and hub state
//   POST   /api/ai/assistant/ask       one question, answered by the hub brain on this user's FACTS
//   POST   /api/ai/assistant/notes     the user's notes, then their private profile on the hub
//   POST   /api/ai/assistant/feedback  Helpful / Not helpful; Helpful shares the QUESTION, cut down
//                                       to words of the Jourvance guide, never the answer
//   DELETE /api/ai/assistant/thread    clears the conversation (notes and daily counts stay)
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
import { cleanModelStrings, hubRefusalKind, limitMessage, limitWaitSeconds } from './aiJourneyRoutes.mjs';
import {
  LIMITS,
  readMessage,
  readNotes,
  buildContextPack,
  businessProfileMarkdown,
  assistantSystem,
  capAnswer,
  hourlyBudget,
  assistantPerHour,
  underDailyCap,
  countDaily
} from '../assistantContext.mjs';
import { loadGuideSections, guideSectionsFor, loadShareAllowlist, shareableQuestion } from '../assistantGuide.mjs';

export const THREAD_FILE = 'assistant-threads.json';
/** The hub's exact sentence when a call names an account the key does not own (plan 3.4a). */
export const ACCOUNT_REFUSAL = 'Not authorized for this account.';
/** How long a refusal of account scope is remembered before account scope is tried again. */
export const ACCOUNT_REFUSAL_MS = 10 * 60 * 1000;
export const PROFILE_PATH = '/api/brain/studio/profile';
/** The longest hub answer worth cleaning; the answer kept is ANSWER_MAX. */
const MAX_HUB_ANSWER_CHARS = 64 * 1024;
/** The local cache keeps at most this many users; the oldest by updatedAt go first. */
export const THREAD_CACHE_USERS = 500;
/** How long each kind of hub call may take, in ms. A test hands in shorter ones. */
export const TIMEOUTS = Object.freeze({ store: 10000, profile: 15000, learn: 15000, chat: 50000 });

/**
 * `promise`, or a rejection naming `label` once `ms` pass. A timeout is the same outcome as a call
 * that threw; the timer never keeps the process alive.
 */
export function bounded(promise, ms, label) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} did not answer within ${ms / 1000} seconds.`), { timedOut: true })), ms);
    timer.unref?.();
  });
  return Promise.race([Promise.resolve(promise), limit]).finally(() => clearTimeout(timer));
}

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
  accountScopeRefused: 'The AI service cannot read your notes back yet.'
});
const NO_HUB = REASONS.noHub;
/** The bare cause for a hub call that threw: a timeout says so, anything else did not answer. */
const failedCall = (err) => (err?.timedOut ? REASONS.timeout : REASONS.noAnswer);

/** The hub app-store name of one user's thread. */
export const threadDocName = (uid) => `assistant.u.${safeAccountId(uid)}`;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isMessage = (m) => isPlainObject(m) && typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string';

export function emptyThread(uid) {
  return { userId: uid, messages: [], notes: '', profileSha: '', profileOnHub: null, feedbackDays: {}, profileDays: {}, updatedAt: '' };
}

/** A stored thread cleaned to its shape, or null when it is not this user's (the workspace loader's rule). */
export function cleanThread(doc, uid) {
  if (!isPlainObject(doc) || !uid || doc.userId !== uid) return null;
  return {
    userId: uid,
    messages: (Array.isArray(doc.messages) ? doc.messages.filter(isMessage) : []).slice(-LIMITS.THREAD_KEEP),
    notes: typeof doc.notes === 'string' ? doc.notes : '',
    profileSha: typeof doc.profileSha === 'string' ? doc.profileSha : '',
    profileOnHub: isPlainObject(doc.profileOnHub) ? doc.profileOnHub : null,
    feedbackDays: isPlainObject(doc.feedbackDays) ? doc.feedbackDays : {},
    profileDays: isPlainObject(doc.profileDays) ? doc.profileDays : {},
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

/** True when the hub refused the call only because it named an account (plan 3.4a). */
export function isAccountRefusal(answer) {
  return Number(answer?.status) === 403 && answer?.error === ACCOUNT_REFUSAL;
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

export function setupAiAssistantRoutes(app, {
  requireUser,
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

  // Workspaces and journeys: the business facts. A workspace list that was not read in full is
  // unavailable, never the placeholder a failed read would otherwise make.
  async function businessFacts(uid) {
    const ws = await settle('workspaces', () => bounded(listWorkspacesDetailed(uid), ms.store, 'The workspace list'));
    const workspacesComplete = isPlainObject(ws) && Array.isArray(ws.workspaces) && ws.complete === true;
    const listed = await settle('journeys', () => bounded(listJourneys(uid), ms.store, 'The journey list'));
    let journeys = null;
    let journeysComplete = false;
    if (Array.isArray(listed)) {
      journeys = listed;
      journeysComplete = true;
    } else if (isPlainObject(listed) && Array.isArray(listed.journeys)) {
      journeys = listed.journeys;
      journeysComplete = listed.complete !== false;
    }
    return { workspaces: workspacesComplete ? ws.workspaces : null, workspacesComplete, journeys, journeysComplete };
  }

  async function contextPack(uid) {
    const facts = await businessFacts(uid);
    const events = await settle('the event log', () => loadEvents());
    const orders = await settle('orders', () => loadOrders());
    const contacts = await settle('contacts', () => contactsForUser(uid));
    const emailStats = await settle('email stats', () => messageStatsFor(uid, () => true));
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
      now: now()
    });
  }

  // ---- Account scope on the hub (plan 3.4a) ----
  // Until the hub reads a partition inside the app, naming the user as the account is refused.
  // The refusal is remembered for ACCOUNT_REFUSAL_MS, logged once per window, and the question is
  // asked again with app and main grounding only.
  let accountRefusedUntil = 0;
  const accountScopeRefused = () => now() < accountRefusedUntil;
  const accountBrain = () => (
    !aiReady()
      ? { readable: false, reason: REASONS.noHub }
      : accountScopeRefused()
        ? { readable: false, reason: REASONS.accountScopeRefused }
        : { readable: true }
  );

  async function callBrain(question, system, accountId) {
    try {
      return await bounded(hub.brain.chat(question, { system, topK: 4, ...(accountId ? { accountId } : {}) }), ms.chat, 'The AI service');
    } catch (err) {
      console.warn('[Jourvance] Ask Jourvance call failed:', err?.message || err);
      return null;
    }
  }

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

  // ---- Routes ----

  app.get('/api/ai/assistant/thread', requireUser, async (req, res) => {
    try {
      const { doc } = await readThread(req.user.uid);
      const available = aiReady();
      return res.json({
        success: true,
        available,
        ...(available ? {} : { reason: 'ai-unavailable' }),
        messages: doc.messages,
        notes: doc.notes,
        profileOnHub: doc.profileOnHub || { durable: false, reason: REASONS.notSentYet },
        accountBrain: accountBrain()
      });
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
      const pack = await contextPack(uid);
      const guide = guideSectionsFor(read.message, loadGuideSections(guidePath));
      const system = assistantSystem(pack, guide, thread.doc.messages, thread.doc.notes);

      let grounding = accountScopeRefused() ? 'app' : 'account';
      let answer = await callBrain(read.message, system, grounding === 'account' ? uid : null);
      if (grounding === 'account' && isAccountRefusal(answer)) {
        if (!accountScopeRefused()) {
          console.warn(`[Jourvance] Ask Jourvance: the hub refused account scope ("${ACCOUNT_REFUSAL}"). Asking with app grounding for the next ${ACCOUNT_REFUSAL_MS / 60000} minutes.`);
        }
        accountRefusedUntil = now() + ACCOUNT_REFUSAL_MS;
        grounding = 'app';
        answer = await callBrain(read.message, system, null);
      }

      if (answer?.success !== true || typeof answer?.text !== 'string') {
        console.warn('[Jourvance] Ask Jourvance refused by the hub:', answer?.status ?? '', answer?.error ?? '');
        if (hubRefusalKind(answer) === 'unavailable') return res.status(503).json(UNAVAILABLE);
        return res.status(502).json(NO_ANSWER);
      }
      const text = capAnswer(cleanModelStrings(answer.text.slice(0, MAX_HUB_ANSWER_CHARS)));
      if (!text) return res.status(502).json(UNREADABLE);

      const at = isoNow();
      const asked = { id: newId(), role: 'user', text: read.message, at };
      const reply = { id: newId(), role: 'assistant', text, at, grounding };
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
}
