/**
 * Broadcast drafts: GET, POST and DELETE at /api/email/broadcast-drafts (EMAIL_STUDIO_PLAN.md
 * Wave 5, decision D4 and owner question 9). "Design an email without sending it" is a broadcast
 * saved as a draft: its subject, preview text, the builder's blocks, and the composer's settings
 * (who gets it, when, A/B, holdout, the text add-on), so the composer opens it again as it was left.
 *
 * STORED: in the caller's own program record, `broadcastDrafts`, beside its flows and order emails.
 * `writeUserPrograms` rebuilds that record from an explicit field list, so drafts are on it, and
 * they are written only by a caller that passes `{ broadcastDrafts: true }`. Every other save (a
 * drip tick, an order send, a segment change) keeps the stored drafts, so a save that read the
 * record before a draft was written cannot erase it afterwards.
 *
 * TENANCY: every read and write is the signed-in caller's record; nothing in the body or the query
 * names whose it is. Each draft also carries the uid that wrote it, and `cleanBroadcastDrafts`
 * reads only rows whose uid is the record's own, so a record restored or copied under another
 * account never shows that account someone else's drafts. A draft id that is missing and a draft id
 * that belongs to another account get the same 404 body, and nothing is written.
 *
 * CAPS: at most BROADCAST_DRAFT_LIMIT drafts per account, and each draft at most
 * BROADCAST_DRAFT_MAX_BYTES of JSON, measured as sent and again as stored. A draft that cleaning would
 * cut (draftWouldClip) is refused, never stored shorter. A refusal is one sentence and writes nothing.
 * A save that changes an existing draft is allowed at the count cap.
 */
import crypto from 'node:crypto';
import { emailHasContent } from '../../email-flow-content.mjs';

export const BROADCAST_DRAFT_LIMIT = 20;
export const BROADCAST_DRAFT_MAX_BYTES = 64 * 1024;
export const DRAFT_NOT_FOUND = 'That draft is not on this account.';
export const DRAFT_FULL = `This account already keeps ${BROADCAST_DRAFT_LIMIT} broadcast drafts, so this one was not saved. Delete a draft and save again.`;
export const DRAFT_TOO_LARGE = `This draft is larger than ${BROADCAST_DRAFT_MAX_BYTES / 1024} KB, so it was not saved. Remove a block or shorten its HTML and save again.`;
export const DRAFT_EMPTY = 'There is nothing in this draft yet, so it was not saved. Add a subject or a block first.';
export const DRAFT_CLIPPED = 'Part of this draft is longer than a broadcast keeps (24 blocks, 4000 characters in a block, 60000 in an HTML block, 200 in the subject, 140 in the preview text), so it was not saved. Shorten it and save again.';

const DRAFT_ID = /^bd_[a-z0-9]{6,40}$/;
const WHEN = ['now', 'clock', 'gradual', 'smart'];
const EVERY = ['minute', 'hour'];
const AB = ['', 'subject', 'content', 'send_time'];

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const whole = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const pickId = (value) => String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);

/**
 * The composer's settings as a draft keeps them. The keys are the composer's own
 * (src/lib/broadcastComposer.ts BroadcastSettings); campaign/send validates them again when the
 * draft is sent, so this only keeps each one to its type and size.
 */
export function cleanDraftSettings(input) {
  const s = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const hour = s.fallbackHour === '' || s.fallbackHour == null ? '' : whole(s.fallbackHour, 0, 23, '');
  return {
    include: pickId(s.include) || 'all',
    exclude: pickId(s.exclude),
    sendWhen: pick(s.sendWhen, WHEN, 'now'),
    sendAt: String(s.sendAt ?? '').slice(0, 40),
    gradualPercent: whole(s.gradualPercent, 1, 50, 10),
    gradualEvery: pick(s.gradualEvery, EVERY, 'hour'),
    fallbackHour: hour === '' ? '' : String(hour),
    explore: s.explore === true,
    smartGradual: s.smartGradual === true,
    smartSkip: s.smartSkip === true,
    utmSource: String(s.utmSource ?? '').slice(0, 100),
    utmCampaign: String(s.utmCampaign ?? '').slice(0, 100),
    abVariable: pick(s.abVariable, AB, ''),
    abSubject: String(s.abSubject ?? '').slice(0, 200),
    abBody: String(s.abBody ?? '').slice(0, 20000),
    abHours: whole(s.abHours, 1, 168, 4),
    smsMessage: String(s.smsMessage ?? '').slice(0, 480),
    smsConfirm: s.smsConfirm === true,
    holdoutOn: s.holdoutOn === true,
    holdoutPercent: whole(s.holdoutPercent, 1, 90, 10)
  };
}

function cleanDraft(row, owner, cleanBlocks) {
  return {
    id: row.id,
    userId: owner,
    subject: String(row.subject ?? '').slice(0, 200),
    previewText: String(row.previewText ?? '').slice(0, 140),
    blocks: cleanBlocks(row.blocks, []),
    settings: cleanDraftSettings(row.settings),
    updatedAt: String(row.updatedAt ?? '').slice(0, 40)
  };
}

/**
 * The drafts an account's record holds, as server.mjs userProgramBag and writeUserPrograms keep
 * them: only rows written by `uid` (the ownership filter), well-formed ids, no id twice, at most
 * BROADCAST_DRAFT_LIMIT. `cleanBlocks` is server.mjs's, injected, so a draft's blocks are cleaned
 * by the same rules as every other email's.
 */
export function cleanBroadcastDrafts(input, uid, cleanBlocks) {
  const owner = String(uid ?? '');
  const out = [];
  const seen = new Set();
  if (!owner) return out;
  for (const row of Array.isArray(input) ? input : []) {
    if (!row || typeof row !== 'object' || row.userId !== owner) continue;
    if (typeof row.id !== 'string' || !DRAFT_ID.test(row.id) || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(cleanDraft(row, owner, cleanBlocks));
    if (out.length >= BROADCAST_DRAFT_LIMIT) break;
  }
  return out;
}

/**
 * True when cleaning would cut something the caller sent: more blocks than cleanBlockList keeps (24,
 * and 8 in a column), or a subject, preview text or block text past the length it keeps
 * (email-doc.mjs cleanBlock). A draft clipped on the way in used to answer 200, and the composer said
 * "Draft saved" over a stored copy that had lost blocks or text.
 */
const TEXT_CAP = { heading: 4000, text: 4000, html: 60000 };
const longer = (value, max) => typeof value === 'string' && value.length > max;
function blocksClip(list, max) {
  if (!Array.isArray(list)) return false;
  if (list.length > max) return true;
  return list.some((block) => {
    if (!block || typeof block !== 'object') return false;
    if (TEXT_CAP[block.kind] && longer(block.text, TEXT_CAP[block.kind])) return true;
    if (block.kind === 'columns' && Array.isArray(block.columns)) return block.columns.length > 4 || block.columns.some((column) => blocksClip(column?.blocks, 8));
    if (block.kind === 'split' && Array.isArray(block.cells)) return block.cells.some((cell) => longer(cell?.text, 4000));
    return false;
  });
}
export function draftWouldClip(body) {
  return longer(body.subject, 200) || longer(body.previewText, 140) || blocksClip(body.blocks, 24);
}

/** Bytes of a draft as it is stored. */
export function draftBytes(draft) {
  return Buffer.byteLength(JSON.stringify(draft), 'utf8');
}

const newestFirst = (rows) => rows.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

export function setupBroadcastDraftRoutes(app, ctx) {
  const { requireUser, userProgramBag, writeUserPrograms, cleanBlocks } = ctx;

  const notFound = (res) => res.status(404).json({ success: false, error: DRAFT_NOT_FOUND });

  app.get('/api/email/broadcast-drafts', requireUser, (req, res) => {
    const bag = userProgramBag(req.user.uid);
    res.json({ success: true, drafts: newestFirst(bag.broadcastDrafts || []), limit: BROADCAST_DRAFT_LIMIT });
  });

  // A body with an id changes that draft, which must be one of the caller's; a body with no id saves
  // a new one. The id, the owner and the time are always the server's.
  app.post('/api/email/broadcast-drafts', requireUser, (req, res) => {
    const uid = req.user.uid;
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const bag = userProgramBag(uid);
    const drafts = Array.isArray(bag.broadcastDrafts) ? bag.broadcastDrafts : [];
    const asked = body.id === undefined || body.id === null || body.id === '' ? '' : String(body.id);
    const index = asked ? drafts.findIndex((row) => row.id === asked) : -1;
    if (asked && index < 0) return notFound(res);
    // Measured on what was sent, before cleaning cuts it to fit: a 5 MB block used to be stored at 60000 characters.
    if (draftBytes({ subject: body.subject, previewText: body.previewText, blocks: body.blocks, settings: body.settings }) > BROADCAST_DRAFT_MAX_BYTES) {
      return res.status(413).json({ success: false, error: DRAFT_TOO_LARGE });
    }
    if (draftWouldClip(body)) return res.status(413).json({ success: false, error: DRAFT_CLIPPED });
    const draft = cleanDraft({
      id: asked || `bd_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
      subject: body.subject,
      previewText: body.previewText,
      blocks: body.blocks,
      settings: body.settings,
      updatedAt: new Date().toISOString()
    }, uid, cleanBlocks);
    if (!draft.subject.trim() && !emailHasContent(draft.blocks)) return res.status(400).json({ success: false, error: DRAFT_EMPTY });
    if (draftBytes(draft) > BROADCAST_DRAFT_MAX_BYTES) return res.status(413).json({ success: false, error: DRAFT_TOO_LARGE });
    if (index < 0 && drafts.length >= BROADCAST_DRAFT_LIMIT) return res.status(400).json({ success: false, error: DRAFT_FULL });
    bag.broadcastDrafts = index < 0 ? [draft, ...drafts] : drafts.map((row, i) => (i === index ? draft : row));
    writeUserPrograms(uid, bag, { broadcastDrafts: true });
    const stored = userProgramBag(uid).broadcastDrafts || [];
    const saved = stored.find((row) => row.id === draft.id);
    if (!saved) return res.status(500).json({ success: false, error: 'This draft was not saved. Try again in a minute.' });
    res.json({ success: true, draft: saved, drafts: newestFirst(stored), limit: BROADCAST_DRAFT_LIMIT });
  });

  app.delete('/api/email/broadcast-drafts/:id', requireUser, (req, res) => {
    const uid = req.user.uid;
    const bag = userProgramBag(uid);
    const drafts = Array.isArray(bag.broadcastDrafts) ? bag.broadcastDrafts : [];
    if (!drafts.some((row) => row.id === req.params.id)) return notFound(res);
    bag.broadcastDrafts = drafts.filter((row) => row.id !== req.params.id);
    writeUserPrograms(uid, bag, { broadcastDrafts: true });
    res.json({ success: true, drafts: newestFirst(userProgramBag(uid).broadcastDrafts || []), limit: BROADCAST_DRAFT_LIMIT });
  });
}
