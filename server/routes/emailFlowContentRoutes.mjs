/**
 * Saving the emails of a starter or built-in flow, or an order email: POST /api/email/flow-content/:id
 * (EMAIL_STUDIO_PLAN.md, Wave 1, decisions D3 and D5).
 *
 * A starter flow is a shared drip sequence, one copy for every account. Its emails are saved per
 * account, in the caller's own program record (`sequences[<id>] = { steps }`), and the drip sender
 * lays them over the shared steps, so the trigger, smart exit and links stay the shared ones and
 * nobody is enrolled twice. A built-in flow (an account automation) already lives in the caller's
 * record; its steps are replaced and its `enabled` is kept.
 *
 * An order email (Wave 4: order confirmation, shipping, cancelled, refund) is a one-email flow on the
 * map. It lives in the caller's own record too; its subject and blocks are saved the way
 * POST /api/email/programs/:id saves them for the transactional kind (a blank subject keeps the
 * stored one, the blocks through cleanBlocks), its `enabled` is kept, it has no preview text, and
 * it can never wait: it sends when Shopify reports the order event.
 *
 * TENANCY: `:id` resolves only against the sequences the caller can see (a shared one, or one whose
 * `userId` is the caller), the built-in automations and the four order emails in the caller's own
 * record. Any other id, including another account's sequence and an account flow (those save
 * through /api/email/flows/:id), gets the same 404 body and nothing is written, so the answer never
 * tells a caller that someone else's sequence exists. The record written is always the signed-in
 * caller's; nothing in the body names whose it is.
 *
 * SHAPE: the body is the flow map's `{ nodes, edges }`. It must be exactly the chain the map drew
 * (`stepsFromChain`): the same number of emails, waits only before an email, no other step. An
 * edit changes what the emails say and how long each wait is, never the flow's steps or its start.
 * A refusal is a 400 with one sentence and writes nothing.
 *
 * STORED: only the emails that differ from the shared copy. An email the account never changed keeps
 * following the shared sequence, so a later fix to the shared copy still reaches it; saving every
 * email would freeze all of them at the moment of the first edit.
 *
 * WRITE: `writeUserPrograms(uid, bag, { sequences: true })`, `{ steps: true }` or
 * `{ transactional: true }`. Every other save keeps the stored starter-flow emails, built-in steps and
 * order emails (subject, blocks and whether it is on), so a background tick or an order send that read
 * the record before this save and writes after it cannot put the old emails back.
 */
import { ACCOUNT_SEQUENCE_LIMIT, WAIT_HOURS_MAX, emailHasContent, stepsFromChain } from '../../email-flow-content.mjs';

export const FLOW_CONTENT_NOT_FOUND = 'That flow is not on this account.';
export const FLOW_CONTENT_SHAPE = "These emails could not be saved, because the flow's steps changed. Reload it and try again.";
export const FLOW_CONTENT_WAIT = `A wait must be a whole number of hours from 1 to ${WAIT_HOURS_MAX}, so these emails were not saved.`;
export const FLOW_CONTENT_EMPTY = 'An email in this flow has nothing in it, so these emails were not saved. Add a block to it and save again.';
export const FLOW_CONTENT_NO_SUBJECT = 'An email in this flow has no subject, so these emails were not saved. Add a subject and save again.';
export const FLOW_CONTENT_NOT_KEPT = "These emails could not be saved, because this flow's steps cannot be kept as they are.";
export const FLOW_CONTENT_FULL = `This account already keeps its own emails for ${ACCOUNT_SEQUENCE_LIMIT} starter flows, so this one could not be saved.`;
export const FLOW_CONTENT_FAILED = 'These emails were not saved. Try again in a minute.';
export const ORDER_EMAIL_NO_WAIT = 'An order email sends as soon as Shopify reports the order event, so it cannot have a wait before it. This email was not saved.';

// A starter flow's first email is timed when someone joins it, from the shared sequence (the
// enrollment points in publicRoutes.mjs and shopifyRoutes.mjs), and the sender reads only the waits
// after it. So that one wait is not the account's to change, and saying it saved would be false.
export function firstWaitFixed(hours) {
  return hours > 0
    ? `The wait before this flow's first email is set when someone joins it, at ${hours} hours, so these emails were not saved. Put that wait back to ${hours} hours and save again.`
    : "This flow's first email sends as soon as someone joins it, so it cannot have a wait before it. These emails were not saved.";
}

const REFUSALS = { shape: FLOW_CONTENT_SHAPE, wait: FLOW_CONTENT_WAIT, empty_email: FLOW_CONTENT_EMPTY, no_subject: FLOW_CONTENT_NO_SUBJECT };

// What a reader of one email gets: its subject, preview text, wait and blocks. Block ids are left
// out, because the map names a shared email's one text block differently from cleanSteps.
const contentKey = (step) => JSON.stringify([
  step.subject, step.previewText, step.delayHours,
  (Array.isArray(step.blocks) ? step.blocks : []).map((block) => {
    const { id: blockId, ...rest } = block || {};
    return rest;
  })
]);

export function setupEmailFlowContentRoutes(app, ctx) {
  const {
    requireUser,
    loadDrips,
    userProgramBag,
    writeUserPrograms,
    cleanSteps,
    cleanBlocks,
    sequenceStepsFor,
    presentSequenceRow,
    presentAutomationRow,
    presentOrderEmailRow
  } = ctx;

  // The flows this caller may edit the emails of: a visible sequence first, then a built-in flow,
  // then one of the caller's own order emails.
  const resolveFlow = (uid, id, bag) => {
    const sequences = loadDrips()?.sequences;
    const sequence = (Array.isArray(sequences) ? sequences : [])
      .find((seq) => seq && seq.id === id && (!seq.userId || seq.userId === uid));
    if (sequence) return { sequence };
    const automation = (bag.automations || []).find((row) => row && row.id === id);
    if (automation) return { automation };
    const letter = (bag.transactional || []).find((row) => row && row.id === id);
    if (letter) return { letter };
    return null;
  };

  // An order email: its one email read back from the chain the map drew, then saved the way
  // POST /api/email/programs/:id saves the transactional kind (emailRoutes.mjs).
  const saveOrderEmail = (req, res, uid, bag, letter, body) => {
    const base = [{ id: letter.id, subject: letter.subject, previewText: '', blocks: letter.blocks, delayHours: 0 }];
    const read = stepsFromChain({ nodes: body.nodes, edges: body.edges }, base);
    if (!read.ok) return res.status(400).json({ success: false, error: REFUSALS[read.error] || FLOW_CONTENT_SHAPE });
    const [mail] = read.steps;
    if (mail.delayHours !== 0) return res.status(400).json({ success: false, error: ORDER_EMAIL_NO_WAIT });
    const blocks = cleanBlocks(mail.blocks, letter.blocks);
    if (!emailHasContent(blocks)) return res.status(400).json({ success: false, error: FLOW_CONTENT_EMPTY });
    const row = bag.transactional.find((item) => item && item.id === letter.id);
    if (typeof mail.subject === 'string' && mail.subject.trim()) row.subject = mail.subject.trim().slice(0, 200);
    row.blocks = blocks;
    writeUserPrograms(uid, bag, { transactional: true });
    const fresh = userProgramBag(uid);
    const saved = (fresh.transactional || []).find((item) => item && item.id === letter.id) || row;
    return res.json({ success: true, flow: presentOrderEmailRow(saved) });
  };

  app.post('/api/email/flow-content/:id', requireUser, (req, res) => {
    try {
      const uid = req.user.uid;
      const id = String(req.params.id || '');
      const bag = userProgramBag(uid);
      const found = resolveFlow(uid, id, bag);
      if (!found) return res.status(404).json({ success: false, error: FLOW_CONTENT_NOT_FOUND });
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      if (found.letter) return saveOrderEmail(req, res, uid, bag, found.letter, body);

      const base = found.sequence ? sequenceStepsFor(found.sequence, bag) : (found.automation.steps || []);
      const read = stepsFromChain({ nodes: body.nodes, edges: body.edges }, base);
      if (!read.ok) return res.status(400).json({ success: false, error: REFUSALS[read.error] || FLOW_CONTENT_SHAPE });
      if (found.sequence) {
        const fixed = Math.max(0, Number(found.sequence.steps?.[0]?.delayHours) || 0);
        if (read.steps.length && read.steps[0].delayHours !== fixed) {
          return res.status(400).json({ success: false, error: firstWaitFixed(fixed) });
        }
      }

      // The stored row is what cleanSteps keeps. It must keep every step under its own id, or the
      // sender would merge nothing for the step it lost; and an email it emptied (blocks that clean
      // to blank text, a divider alone) would go out with nothing but the footer.
      const steps = cleanSteps(read.steps, []);
      const sameSteps = steps.length === read.steps.length
        && steps.every((row, i) => row.id === String(read.steps[i]?.id ?? ''));
      if (!sameSteps) return res.status(400).json({ success: false, error: FLOW_CONTENT_NOT_KEPT });
      if (steps.some((row) => !emailHasContent(row.blocks))) {
        return res.status(400).json({ success: false, error: FLOW_CONTENT_EMPTY });
      }

      if (found.sequence) {
        const own = bag.sequences && typeof bag.sequences === 'object' ? bag.sequences : Object.create(null);
        // Only the emails that differ from the shared copy (STORED above).
        const shared = Array.isArray(found.sequence.steps) ? found.sequence.steps : [];
        const changed = steps.filter((row) => {
          const was = shared.find((step) => step && String(step.id ?? '') === row.id);
          return !was || contentKey(cleanSteps([was], [])[0]) !== contentKey(row);
        });
        const held = Object.keys(own);
        if (changed.length && !held.includes(id) && held.length >= ACCOUNT_SEQUENCE_LIMIT) {
          return res.status(400).json({ success: false, error: FLOW_CONTENT_FULL });
        }
        if (changed.length) own[id] = { steps: changed };
        else delete own[id];
        bag.sequences = own;
        writeUserPrograms(uid, bag, { sequences: true });
      } else {
        const row = bag.automations.find((item) => item && item.id === id);
        row.steps = steps;
        writeUserPrograms(uid, bag, { steps: true });
      }

      // The answer is drawn from the record as it now reads, in the shape of a flow-map row.
      const fresh = userProgramBag(uid);
      if (found.sequence) return res.json({ success: true, flow: presentSequenceRow(found.sequence, fresh) });
      const saved = (fresh.automations || []).find((row) => row && row.id === id) || found.automation;
      return res.json({ success: true, flow: presentAutomationRow(saved) });
    } catch (err) {
      console.error('[Jourvance] Saving flow emails failed:', err);
      if (!res.headersSent) return res.status(500).json({ success: false, error: FLOW_CONTENT_FAILED });
    }
  });
}
