// U07: a step's accessible name disagreed with its card. Signed out, a page or upsell seeded with
// published: true read "Upsell /glow/upsell, published" while its card said "Status unavailable",
// because stepSpokenName read the browser's data.published flag and the card reads publishState.
// And the default form read "Lead form: Where should we reach you?, 4 fields", a doubled mark T09
// removed everywhere else. stepSpokenName now takes the card's own publish state and places a
// titled step with nameInSentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { stepSpokenName, stepShortName } = await import('./src/lib/stepNames.ts');
const { stepPublishState, publishStateLabel, stepFingerprint, PUBLISHABLE_STEP_TYPES } = await import('./src/lib/publishState.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');

const clone = v => JSON.parse(JSON.stringify(v));
const read = path => (fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '');
// The same test step-name-sentences.test.mjs applies: a closing mark followed by a full stop (also
// across a closing quote) or by a bare comma.
const DOUBLED = /[?!…]['"’”)\]]*\.|[?!…],/;

const page = { id: 'p1', type: 'landing-page', data: { type: 'landing-page', slug: 'vip-consultation', headline: 'Hello' } };
const upsell = { id: 'u1', type: 'upsell', data: { type: 'upsell', slug: 'glow', offerType: 'upsell' } };
const downsell = { id: 'd1', type: 'upsell', data: { type: 'upsell', slug: 'glow', offerType: 'downsell' } };
const split = { id: 's1', type: 'ab-split', data: { type: 'ab-split', slug: 'spring', splitRatio: 70 } };
const thanks = { id: 't1', type: 'thank-you', data: { type: 'thank-you', slug: 'thanks' } };
const STEPS = [page, upsell, downsell, split, thanks];
const flagged = n => ({ ...n, data: { ...n.data, published: true, publishedAt: '2026-09-01T10:00:00Z', publishedUrl: '/p/x' } });

const liveRead = steps => ({ kind: 'read', report: { checkedAt: '', steps, liveRevision: null } });
const live = fingerprint => ({ live: true, url: '/p/x', fingerprint, revisionNumber: 3, publishedAt: '2026-09-01T10:00:00Z' });

/** Every read the card can be in, with the state stepPublishState gives a step under it. */
function everyState(node) {
  const reads = {
    checking: { kind: 'checking' },
    none: null,
    'signed-out': { kind: 'signed-out' },
    unavailable: { kind: 'unavailable', message: 'The status check did not work.' },
    'not-published': liveRead({}),
    published: liveRead({ [node.id]: live(stepFingerprint(node, [])) }),
    changed: liveRead({ [node.id]: live('c1:00000000000000') }),
    untracked: liveRead({ [node.id]: live(null) })
  };
  return Object.entries(reads).map(([name, r]) => [name, stepPublishState(node, [], r)]);
}

/** The status word the card's strip and summary show, as it sits mid-name. */
const cardWord = state => {
  const label = publishStateLabel(state);
  return label.charAt(0).toLowerCase() + label.slice(1);
};

test("U07's finding: signed out, a step flagged published reads the card's \"Status unavailable\"", () => {
  const signedOut = { kind: 'signed-out' };
  const up = flagged(upsell);
  assert.equal(publishStateLabel(stepPublishState(up, [], signedOut)), 'Status unavailable');
  assert.equal(stepSpokenName(up, stepPublishState(up, [], signedOut)), 'Upsell /glow/upsell, status unavailable');
  const lp = flagged(page);
  assert.equal(stepSpokenName(lp, stepPublishState(lp, [], signedOut)), 'Landing page /vip-consultation, status unavailable');
  // Unflagged, the card says "Not published" and so does the name.
  assert.equal(stepSpokenName(page, stepPublishState(page, [], signedOut)), 'Landing page /vip-consultation, not published');
});

test('the card and its accessible name agree on publish status in every state, for every publishable step', () => {
  let checked = 0;
  const kinds = new Set();
  for (const base of STEPS) {
    for (const node of [base, flagged(base)]) {
      for (const [readName, state] of everyState(node)) {
        assert.ok(state, `${node.id} under ${readName}`);
        kinds.add(state.kind + (state.reason ? `:${state.reason}` : ''));
        const name = stepSpokenName(node, state);
        const word = cardWord(state);
        assert.ok(name.startsWith(`${stepShortName(node)}, ${word}`), `${node.id} under ${readName}: "${name}" should carry "${word}"`);
        // Exactly one status: no other state's word rides along (the flag's "published" included).
        for (const other of ['published', 'draft', 'unpublished changes', 'not published', 'live, changes unknown', 'checking status', 'status unavailable']) {
          if (other === word || word.includes(other)) continue;
          assert.ok(!new RegExp(`, ${other}(,|$)`).test(name), `${node.id} under ${readName}: "${name}" also says "${other}"`);
        }
        checked++;
      }
    }
  }
  assert.deepEqual([...kinds].sort(), ['changed', 'checking', 'not-published', 'published', 'unknown:signed-out', 'unknown:unavailable', 'untracked']);
  assert.ok(checked >= 70, `only ${checked} checked`);
});

test('the flag never decides the word; the state does', () => {
  for (const base of STEPS) {
    for (const [, state] of everyState(base)) {
      assert.equal(stepSpokenName(flagged(base), state), stepSpokenName({ ...base, data: { ...base.data, published: false } }, state));
    }
  }
  // An unknown status reads "status unavailable" in both, whatever the flag says.
  const unknown = { kind: 'unknown', reason: 'unavailable' };
  assert.equal(publishStateLabel(unknown), 'Status unavailable');
  assert.equal(stepSpokenName(flagged(upsell), unknown), 'Upsell /glow/upsell, status unavailable');
  assert.equal(stepSpokenName(split, unknown), 'A/B split /spring, status unavailable, 70/30 split');
  assert.equal(stepSpokenName({ ...page, data: { ...page.data, abTestingEnabled: true } }, { kind: 'changed', revisionNumber: 2, publishedAt: '' }),
    'Landing page /vip-consultation, unpublished changes, A/B test on');
});

test('with no status to hand the name says none, as a card with no status shows none', () => {
  for (const base of STEPS) {
    for (const node of [base, flagged(base)]) {
      for (const name of [stepSpokenName(node), stepSpokenName(node, null), stepSpokenName(node.data)]) {
        assert.doesNotMatch(name, /published|draft|status/, name);
      }
    }
  }
  assert.equal(stepSpokenName(flagged(upsell)), 'Upsell /glow/upsell');
  assert.equal(stepSpokenName(split), 'A/B split /spring, 70/30 split');
  // A step that is never published carries no status even when handed one.
  const form = { type: 'lead-form', formTitle: 'Join', fields: [{ enabled: true }] };
  assert.equal(stepSpokenName(form, { kind: 'unknown', reason: 'unavailable' }), 'Lead form "Join", 1 field');
  assert.ok(PUBLISHABLE_STEP_TYPES.includes('thank-you'));
  assert.equal(stepSpokenName(thanks, { kind: 'not-published' }), 'Thank-you page /thanks, not published');
});

test('the default form reads without "you?,"', () => {
  const form = DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.id === 'node-form-1');
  assert.equal(stepSpokenName(form), 'Lead form "Where should we reach you?", 4 fields');
  assert.equal(stepSpokenName(form.data), 'Lead form "Where should we reach you?", 4 fields');
});

test('no accessible name has "?," "?." "!," or "!." after a step name, in any state', () => {
  const titles = ['Where should we reach you?', 'Welcome!', 'Ready…', 'Wait.', 'Plain title'];
  const nodes = [];
  for (const journey of [DEFAULT_LEAD_CAPTURE_PROJECT, ...ECOM_BLUEPRINTS]) nodes.push(...clone(journey.nodes));
  for (const title of titles) {
    nodes.push({ id: 'f', type: 'lead-form', data: { type: 'lead-form', formTitle: title, fields: [{ enabled: true }] } });
    nodes.push({ id: 'q', type: 'follow-up-sequence', data: { type: 'follow-up-sequence', sequenceTitle: title, steps: [] } });
    nodes.push({ id: 'r', type: 'follow-up-sequence', data: { type: 'follow-up-sequence', sequenceType: 'checkout_recovery', sequenceTitle: title, steps: [{}] } });
  }
  let checked = 0;
  for (const node of nodes) {
    const states = [undefined, ...everyState(node).map(([, s]) => s)];
    for (const state of states) {
      const name = stepSpokenName(node, state);
      assert.doesNotMatch(name, DOUBLED, `${node.id}: ${name}`);
      checked++;
    }
  }
  assert.ok(checked >= 100, `only ${checked} checked`);
});

test('the card strip and the zoomed-out summary word their status with publishStateLabel', () => {
  // The name's word is only right while the card reads the same function.
  assert.match(read('src/components/canvas/PublishStatus.tsx'), /const label = publishStateLabel\(state\);/);
  assert.match(read('src/components/canvas/StepSummary.tsx'), /\{publishStateLabel\(state\)\}/);
});

// The map and the step panel must hand the card's state in. Those two files belong to other lanes
// this round, so the pin is a todo until the call sites change (see U07's outside edits).
test('the map and the step panel pass the card\'s state to stepSpokenName', () => {
  assert.ok(/ariaLabel: stepSpokenName\(n, publishStates\.get\(n\.id\)\)/.test(read('src/components/canvas/JourneyCanvas.tsx')), 'JourneyCanvas.tsx: ariaLabel: stepSpokenName(n, publishStates.get(n.id))');
  assert.ok(/stepSpokenName\(node, publishStatus\.states\.get\(node\.id\)\)/.test(read('src/components/drawers/NodeInspector.tsx')), 'NodeInspector.tsx: stepSpokenName(node, publishStatus.states.get(node.id))');
});
