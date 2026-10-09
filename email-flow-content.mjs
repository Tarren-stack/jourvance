/**
 * Email content for starter and built-in flows (EMAIL_STUDIO_PLAN.md, Wave 1, decision D5).
 *
 * The starter flows (the shared drip sequences in `store.drips`) are one copy for every account.
 * An account edits their EMAILS, never their shape: its own subject, preview text, blocks and waits
 * live in the account's program record as `sequences[<sequence id>] = { steps }`, and the one drip
 * sender reads the shared steps with that layer merged over them. The trigger, smart exit, checkout
 * link, voucher and review link stay the shared sequence's, and nobody is enrolled twice, because
 * no second flow exists.
 *
 * The flow map draws these flows as a straight chain (`chainGraph` in server.mjs): a trigger, then
 * per step an optional wait and an email. `stepsFromChain` reads that chain back into steps, and
 * refuses any graph that is not exactly that chain over the same number of emails, so a save can
 * change what the emails say and how long each wait is, and nothing else.
 *
 * Plain ESM that imports nothing. The cleaners live in server.mjs and are passed in.
 */

export const ACCOUNT_SEQUENCE_LIMIT = 20;
export const ACCOUNT_SEQUENCE_ID = /^[A-Za-z0-9_-]{1,60}$/;
export const WAIT_HOURS_MAX = 24 * 90;

/**
 * Reads a flow map chain back into steps.
 *
 * Walks from the one trigger along single edges. Each email node takes the next base step in order
 * and gives it the node's subject, previewText and blocks; a delay node before an email gives that
 * step its delayHours, and an email with no delay before it gets 0. Every other field (id,
 * stepNumber, discountVoucher, body) stays the base step's.
 *
 * Refuses, with `{ ok: false, error }`: a graph that is not an object with node and edge arrays, a
 * repeated node id, a node type other than trigger, delay or email, anything but exactly one
 * trigger, an edge naming a node that is not there, a branch (two edges out of or into one node), a
 * cycle, a node the walk never reaches, a delay that is not followed by an email, a wait that is not
 * a whole number of hours from 1 to WAIT_HOURS_MAX (a number, or a string of digits), a wait taken
 * away from before an email after the first when the base step had one (the senders read a stored
 * 0 there as 24 hours, so the map would show no wait while the email waits a day), an email with no
 * blocks or with a blank subject, and an email count different from `baseSteps.length`.
 *
 * `error` is a short machine reason: 'shape', 'wait', 'empty_email' or 'no_subject'. The route words it.
 */
export function stepsFromChain(graph, baseSteps) {
  const fail = (error, detail) => ({ ok: false, error, detail });
  const base = Array.isArray(baseSteps) ? baseSteps : [];
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return fail('shape', 'no graph');
  const { nodes, edges } = graph;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return fail('shape', 'nodes and edges must be arrays');

  const byId = new Map();
  let trigger = null;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') return fail('shape', 'a node is not an object');
    const id = typeof node.id === 'string' ? node.id : '';
    if (!id) return fail('shape', 'a node has no id');
    if (byId.has(id)) return fail('shape', `node ${id} is repeated`);
    if (node.type !== 'trigger' && node.type !== 'delay' && node.type !== 'email') {
      return fail('shape', `node ${id} is a ${String(node.type)}`);
    }
    if (node.type === 'trigger') {
      if (trigger) return fail('shape', 'more than one trigger');
      trigger = node;
    }
    byId.set(id, node);
  }
  if (!trigger) return fail('shape', 'no trigger');

  const out = new Map();
  const into = new Map();
  for (const edge of edges) {
    if (!edge || typeof edge !== 'object') return fail('shape', 'an edge is not an object');
    const source = typeof edge.source === 'string' ? edge.source : '';
    const target = typeof edge.target === 'string' ? edge.target : '';
    if (!byId.has(source) || !byId.has(target)) return fail('shape', 'an edge names a node that is not there');
    if (out.has(source)) return fail('shape', `node ${source} branches`);
    if (into.has(target)) return fail('shape', `node ${target} is joined`);
    out.set(source, target);
    into.set(target, source);
  }
  if (into.has(trigger.id)) return fail('shape', 'an edge leads back into the trigger');

  const steps = [];
  const seen = new Set([trigger.id]);
  let pendingWait = null;
  let at = trigger.id;
  while (out.has(at)) {
    const nextId = out.get(at);
    if (seen.has(nextId)) return fail('shape', 'the chain loops');
    seen.add(nextId);
    const node = byId.get(nextId);
    if (node.type === 'delay') {
      if (pendingWait !== null) return fail('shape', 'two waits in a row');
      // A whole number, or a number field's string of digits. Anything else (a fraction, '0x10',
      // '1e2', a blank) is refused, never read as some other number of hours.
      const raw = node.delayHours;
      const hours = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
      if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > WAIT_HOURS_MAX) {
        return fail('wait', `wait ${nextId} is not a whole number of hours from 1 to ${WAIT_HOURS_MAX}`);
      }
      pendingWait = hours;
    } else if (node.type === 'email') {
      const index = steps.length;
      if (index >= base.length) return fail('shape', 'more emails than the flow has');
      if (!Array.isArray(node.blocks) || node.blocks.length === 0) return fail('empty_email', `email ${nextId} has no blocks`);
      if (typeof node.subject !== 'string' || !node.subject.trim()) return fail('no_subject', `email ${nextId} has no subject`);
      const shared = base[index] && typeof base[index] === 'object' ? base[index] : {};
      // A wait cannot be taken away from between two emails: the map draws one for every base step
      // after the first that has a wait, and a stored 0 there is sent a day later.
      if (index > 0 && pendingWait === null && (Number(shared.delayHours) || 0) > 0) {
        return fail('shape', `the wait before email ${index + 1} was taken away`);
      }
      steps.push({
        ...shared,
        subject: typeof node.subject === 'string' ? node.subject : '',
        previewText: typeof node.previewText === 'string' ? node.previewText : '',
        blocks: node.blocks,
        delayHours: pendingWait === null ? 0 : pendingWait
      });
      pendingWait = null;
    } else {
      return fail('shape', 'a second trigger');
    }
    at = nextId;
  }
  if (pendingWait !== null) return fail('shape', 'a wait with no email after it');
  if (seen.size !== byId.size) return fail('shape', 'a node is not on the chain');
  if (steps.length !== base.length) return fail('shape', `${steps.length} emails where the flow has ${base.length}`);
  return { ok: true, steps };
}

/**
 * The shared steps with this account's own content laid over them, matched by step id.
 *
 * From an account row with the same id each step takes `subject`, `previewText`, `blocks` and
 * `delayHours` (each only when the row carries it in the right type). `id`, `stepNumber`,
 * `discountVoucher` and every other field always stay the shared step's. An account row whose id is
 * not in the shared list is ignored, and a step with no account row comes back unchanged.
 */
export function mergeAccountSteps(sharedSteps, accountSteps) {
  const shared = Array.isArray(sharedSteps) ? sharedSteps : [];
  const rows = new Map();
  for (const row of Array.isArray(accountSteps) ? accountSteps : []) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id ?? '');
    if (id && !rows.has(id)) rows.set(id, row);
  }
  return shared.map((step) => {
    const source = step && typeof step === 'object' ? step : {};
    const row = rows.get(String(source.id ?? ''));
    if (!row) return { ...source };
    const merged = { ...source };
    if (typeof row.subject === 'string') merged.subject = row.subject;
    if (typeof row.previewText === 'string') merged.previewText = row.previewText;
    if (Array.isArray(row.blocks)) merged.blocks = row.blocks;
    if (typeof row.delayHours === 'number' && Number.isFinite(row.delayHours)) merged.delayHours = row.delayHours;
    return merged;
  });
}

/**
 * True when an email's blocks hold something a reader would see: a heading, text or HTML block with
 * words in it, an image with an address, a button, a column or split cell with content, or one of
 * the blocks that draws something of its own (product, coupon, table, social, header, video). A
 * divider or a spacer alone is not content, and neither is a list of blank text blocks, which is
 * what an unknown or junk block cleans to.
 */
export function emailHasContent(blocks) {
  const filled = (block) => {
    if (!block || typeof block !== 'object') return false;
    const kind = block.kind;
    if (kind === 'heading' || kind === 'text' || kind === 'html') return typeof block.text === 'string' && block.text.trim() !== '';
    if (kind === 'image') return typeof block.url === 'string' && block.url.trim() !== '';
    if (kind === 'divider' || kind === 'spacer') return false;
    if (kind === 'columns') return (Array.isArray(block.columns) ? block.columns : []).some((column) => (Array.isArray(column?.blocks) ? column.blocks : []).some(filled));
    if (kind === 'split') return (Array.isArray(block.cells) ? block.cells : []).some(filled);
    return typeof kind === 'string' && kind !== '';
  };
  return Array.isArray(blocks) && blocks.some(filled);
}

/**
 * The account's `sequences` record, cleaned: at most ACCOUNT_SEQUENCE_LIMIT ids matching
 * ACCOUNT_SEQUENCE_ID, each row's steps through the injected `cleanSteps(input, fallback)`, and a
 * row with no steps left dropped.
 *
 * The answer has no prototype, so `__proto__` and `constructor` are plain ids: kept as own keys
 * when they are in the input, never read through to Object.prototype, and never matching a
 * sequence.
 */
export function cleanAccountSequences(input, cleanSteps) {
  const out = Object.create(null);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  if (typeof cleanSteps !== 'function') return out;
  let kept = 0;
  for (const [id, row] of Object.entries(input)) {
    if (kept >= ACCOUNT_SEQUENCE_LIMIT) break;
    if (!ACCOUNT_SEQUENCE_ID.test(id)) continue;
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const steps = cleanSteps(Array.isArray(row.steps) ? row.steps : [], []);
    if (!Array.isArray(steps) || !steps.length) continue;
    out[id] = { steps };
    kept += 1;
  }
  return out;
}
