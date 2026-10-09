import test from 'node:test';
import assert from 'node:assert/strict';

// EMAIL_STUDIO_PLAN.md Wave 7: "Build a flow in Email Studio" makes an account flow from a canvas
// step's own letters. These are the pure rules in src/lib/editorReturn.ts: each letter becomes an
// email (or a text), each delay a wait before it, the start comes from the step's kind or is By hand,
// and a letter the server would cut short or a delay that cannot be read stops the build by name.
// Every flow built here is put through email-flows.mjs's own cleanFlow and validateFlow, the code
// POST /api/email/flows runs, so "the server keeps it whole" is checked, not assumed.

const {
  flowFromStepLetters, flowStartForStep, letterDelayMinutes, linkStepToFlow, linkedFlowEmails, flowNotBuilt,
  stepLettersSource, linkedLettersNote, funnelReturnFor, STEP_FLOW_LIMITS, FLOW_NOT_BUILT_SIGN_IN, FLOW_NOT_BUILT_UNANSWERED,
  LINKED_FLOW_UNREAD
} = await import('./src/lib/editorReturn.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
const { sequencePreset } = await import('./src/lib/sequencePresets.ts');
const { cleanFlow, validateFlow, TRIGGER_META } = await import('./email-flows.mjs');
const { cleanBlockList } = await import('./email-doc.mjs');

const DASH = /—|\s–\s/;
const serverKeeps = (draft) => cleanFlow({ id: 'flow_check1', ...draft }, { cleanBlocks: (blocks) => cleanBlockList(blocks) });
const homeStep = () => structuredClone(DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find((n) => n.id === 'node-seq-1').data);
const ofType = (flow, type) => flow.nodes.filter((n) => n.type === type);
/** The flow as a walk from its start: each node's type and, for a wait, its minutes. */
const walk = (flow) => {
  const out = [];
  let at = 'n_start';
  for (let guard = 0; guard < 100; guard++) {
    const edge = flow.edges.find((e) => e.source === at);
    if (!edge) break;
    const node = flow.nodes.find((n) => n.id === edge.target);
    out.push(node.type === 'delay' ? `wait ${node.delayMinutes}` : node.type === 'email' ? `email ${node.subject}` : `${node.type} ${node.message ?? ''}`);
    at = node.id;
  }
  return out;
};

test('the default step builds three emails with its subjects, and its delays as waits before emails 2 and 3', () => {
  const plan = flowFromStepLetters(homeStep());
  assert.equal(plan.ok, true, plan.error);
  assert.equal(plan.flow.name, 'Nurture & Booking Flow');
  assert.equal(plan.flow.trigger, 'manual');
  assert.deepEqual(walk(plan.flow), ['email You are on the list', 'wait 1440', 'email A follow-up', 'wait 4320', 'email One more note']);
  // The server's own cleaner keeps every node and line, and the flow validates.
  const kept = serverKeeps(plan.flow);
  assert.ok(kept, 'cleanFlow refused the built flow');
  assert.equal(kept.nodes.length, plan.flow.nodes.length);
  assert.equal(kept.edges.length, plan.flow.edges.length);
  assert.deepEqual(validateFlow(kept), { ok: true });
  assert.deepEqual(ofType(kept, 'delay').map((n) => n.delayMinutes), [1440, 4320]);
});

test('subject, preview text and body carry over: paragraphs become text blocks, tags become the sender\'s tokens', () => {
  const plan = flowFromStepLetters({
    label: 'Cart step', sequenceType: 'checkout_recovery', voucherCode: 'SPRING',
    steps: [{
      id: 's1', channel: 'email', delay: '1 Hour', subject: 'Your cart, [First Name]', previewText: 'Use [Voucher Code]',
      body: 'Hi [First Name],\n\nYour checkout is here:\n[Checkout Link]\n\nAlso [Offer Link] and [Review Link].'
    }]
  });
  assert.equal(plan.ok, true, plan.error);
  const [mail] = ofType(plan.flow, 'email');
  assert.equal(mail.subject, 'Your cart, {{first_name}}');
  assert.equal(mail.previewText, 'Use SPRING');
  assert.deepEqual(mail.blocks.map((b) => [b.kind, b.text]), [
    ['text', 'Hi {{first_name}},'],
    ['text', 'Your checkout is here:\n{{checkout_url}}'],
    ['text', 'Also {{offer_url}} and {{review_url}}.']
  ]);
  // No code on the step: the tag is left as the owner wrote it, never invented.
  const bare = flowFromStepLetters({ label: 'x', steps: [{ id: 's1', channel: 'email', delay: 'Instant', subject: 'Use [Voucher Code]', previewText: '', body: '' }] });
  assert.equal(ofType(bare.flow, 'email')[0].subject, 'Use [Voucher Code]');
  // An empty body is one empty text block, as New flow makes.
  assert.deepEqual(ofType(bare.flow, 'email')[0].blocks.map((b) => b.text), ['']);
});

test('delays read as minutes, and a delay that cannot be read is never a delay of zero', () => {
  const read = {
    'Instant': 0, 'Instant (0m)': 0, 'immediately': 0, '1 Hour': 60, '24 Hours': 1440, '18 hours': 1080, '3 Days': 4320,
    '7 Days (168h)': 10080, '72 Hours': 4320, '90 minutes': 90, '2 weeks': 20160, '1.5 hours': 90, '5 Days': 7200
  };
  for (const [words, minutes] of Object.entries(read)) assert.equal(letterDelayMinutes(words), minutes, words);
  for (const words of ['', '   ', 'soon', 'later', 'tomorrow', '24', 'h24', undefined, null]) assert.equal(letterDelayMinutes(words), null, String(words));
  const letter = (delay) => ({ label: 'x', steps: [{ id: 'a', channel: 'email', delay: 'Instant', subject: 'A', previewText: '', body: '' }, { id: 'b', channel: 'email', delay, subject: 'B', previewText: '', body: '' }] });
  assert.deepEqual(flowFromStepLetters(letter('')), { ok: false, error: 'Email 2 has no delay. Write one, such as Instant, 24 Hours or 3 Days.' });
  const soon = flowFromStepLetters(letter('soon'));
  assert.equal(soon.ok, false);
  assert.match(soon.error, /^Email 2's delay "soon" could not be read as a wait\./);
  const far = flowFromStepLetters(letter('91 Days'));
  assert.deepEqual(far, { ok: false, error: 'Email 2 waits longer than 90 days, the longest wait a flow can hold.' });
  assert.equal(flowFromStepLetters(letter('90 Days')).ok, true);
  // A zero wait is no wait step at all: email 1 then email 2, straight on.
  assert.deepEqual(walk(flowFromStepLetters(letter('Instant')).flow), ['email A', 'email B']);
});

test('a text letter becomes a text step, and a letter the server would cut short stops the build by name', () => {
  const plan = flowFromStepLetters({ label: 'x', steps: [{ id: 't', channel: 'sms', delay: '2 Hours', subject: '', body: 'Hi [First Name], your code is ready.' }] });
  assert.equal(plan.ok, true, plan.error);
  assert.deepEqual(walk(plan.flow), ['wait 120', 'sms Hi {{first_name}}, your code is ready.']);
  assert.equal(ofType(plan.flow, 'sms')[0].status, 'live');
  // An empty text is a draft, which validateFlow accepts; a live empty text it refuses.
  const empty = flowFromStepLetters({ label: 'x', steps: [{ id: 't', channel: 'sms', delay: 'Instant', subject: '', body: '' }] });
  assert.equal(ofType(empty.flow, 'sms')[0].status, 'draft');
  assert.deepEqual(validateFlow(serverKeeps(empty.flow)), { ok: true });
  const L = STEP_FLOW_LIMITS;
  const one = (patch) => flowFromStepLetters({ label: 'x', steps: [{ id: 'a', channel: 'email', delay: 'Instant', subject: 'S', previewText: '', body: '', ...patch }] });
  assert.match(one({ channel: 'sms', body: 'x'.repeat(L.text + 1) }).error, /^Text 1 is longer than 480 characters/);
  assert.match(one({ subject: 'x'.repeat(L.subject + 1) }).error, /^Email 1's subject is longer than 200 characters/);
  assert.match(one({ previewText: 'x'.repeat(L.previewText + 1) }).error, /^Email 1's preview text is longer than 140 characters/);
  assert.match(one({ body: Array.from({ length: L.paragraphs + 1 }, (_, i) => `p${i}`).join('\n\n') }).error, /^Email 1 has more than 24 paragraphs/);
  assert.match(one({ body: 'x'.repeat(L.paragraph + 1) }).error, /^Email 1 has a paragraph longer than 4000 characters/);
  // At each cap exactly, the server keeps the letter whole.
  const atCap = one({ subject: 's'.repeat(L.subject), previewText: 'p'.repeat(L.previewText), body: 'b'.repeat(L.paragraph) });
  const kept = serverKeeps(atCap.flow).nodes.find((n) => n.type === 'email');
  assert.equal(kept.subject.length, L.subject);
  assert.equal(kept.previewText.length, L.previewText);
  assert.equal(kept.blocks[0].text.length, L.paragraph);
  const many = flowFromStepLetters({ label: 'x', steps: Array.from({ length: 30 }, (_, i) => ({ id: `l${i}`, channel: 'email', delay: '1 Day', subject: `S${i}`, previewText: '', body: '' })) });
  assert.equal(many.ok, false);
  assert.match(many.error, /A flow can have 60 steps/);
});

test('the start comes from the step\'s kind where a flow start matches it, otherwise By hand, in TRIGGER_META\'s words', () => {
  const want = [
    ['lead_nurture', 'manual'], ['upsell_recovery', 'manual'], ['checkout_recovery', 'checkout_abandonment'], ['at_risk_winback', 'quiet_buyer'],
    ['fulfillment_review', 'order_fulfilled'], ['', 'manual'], ['__proto__', 'manual'], ['constructor', 'manual'], ['toString', 'manual']
  ];
  for (const [kind, trigger] of want) {
    const start = flowStartForStep(kind);
    assert.equal(start.trigger, trigger, kind);
    assert.equal(start.label, TRIGGER_META.find((row) => row.id === start.trigger)?.label, `${kind}: the label is not TRIGGER_META's`);
  }
  assert.equal(flowStartForStep(undefined).trigger, 'manual');
  assert.equal(flowFromStepLetters({ ...homeStep(), sequenceType: 'checkout_recovery' }).flow.trigger, 'checkout_abandonment');
});

test('a step with no letters makes one empty email, as New flow does', () => {
  const plan = flowFromStepLetters({ label: '', sequenceTitle: 'Titled', steps: [] });
  assert.equal(plan.ok, true);
  assert.equal(plan.flow.name, 'Titled');
  assert.deepEqual(walk(plan.flow), ['email ']);
  assert.equal(flowFromStepLetters({ steps: [] }).flow.name, 'Flow from the funnel map');
});

test('every preset and every blueprint step builds, and the server keeps every node, line and wait', () => {
  const steps = [
    ...['vip-welcome', 'cart-recovery', 'upsell-recovery', 'winback', 'review-request'].map((type) => ({ label: type, ...sequencePreset(type, 1) })),
    ...ECOM_BLUEPRINTS.flatMap((bp) => bp.nodes.filter((n) => n.type === 'follow-up-sequence').map((n) => n.data)),
    homeStep()
  ];
  assert.ok(steps.length >= 10, `only ${steps.length} steps were found to build`);
  for (const step of steps) {
    const plan = flowFromStepLetters(step);
    assert.equal(plan.ok, true, `${step.label}: ${plan.error}`);
    const kept = serverKeeps(plan.flow);
    assert.ok(kept, `${step.label}: cleanFlow refused it`);
    assert.equal(kept.nodes.length, plan.flow.nodes.length, step.label);
    assert.equal(kept.edges.length, plan.flow.edges.length, step.label);
    assert.deepEqual(validateFlow(kept), { ok: true }, step.label);
    // One email or text per letter, and one wait per letter whose delay is not zero.
    const letters = step.steps.length;
    assert.equal(ofType(kept, 'email').length + ofType(kept, 'sms').length, letters, step.label);
    assert.equal(ofType(kept, 'delay').length, step.steps.filter((s) => letterDelayMinutes(s.delay) > 0).length, step.label);
    assert.deepEqual(ofType(kept, 'delay').map((n) => n.delayMinutes), step.steps.map((s) => letterDelayMinutes(s.delay)).filter((m) => m > 0), step.label);
  }
});

test('linkStepToFlow links only a sequence step, and the return then names that flow', () => {
  const project = structuredClone(DEFAULT_LEAD_CAPTURE_PROJECT);
  const linked = linkStepToFlow(project, 'node-seq-1', { id: 'flow_abc', name: 'Nurture & Booking Flow' }, '2026-10-09T00:00:00.000Z');
  const step = linked.nodes.find((n) => n.id === 'node-seq-1');
  assert.equal(step.data.jourvanceFlowId, 'flow_abc');
  assert.equal(step.data.jourvanceFlowName, 'Nurture & Booking Flow');
  assert.deepEqual(step.data.steps, project.nodes.find((n) => n.id === 'node-seq-1').data.steps, 'the letters are kept');
  assert.equal(linked.updatedAt, '2026-10-09T00:00:00.000Z');
  assert.equal(funnelReturnFor(linked, 'node-seq-1').flowId, 'flow_abc');
  for (const n of linked.nodes.filter((x) => x.id !== 'node-seq-1')) assert.equal(n, project.nodes.find((x) => x.id === n.id), `${n.id} was touched`);
  assert.equal(project.nodes.find((n) => n.id === 'node-seq-1').data.jourvanceFlowId, undefined, 'the input was changed in place');
  assert.equal(linkStepToFlow(project, 'node-page-1', { id: 'flow_abc', name: 'x' }, 'now'), null);
  assert.equal(linkStepToFlow(project, 'gone', { id: 'flow_abc', name: 'x' }, 'now'), null);
});

test('linkedFlowEmails lists a flow\'s emails and texts in order with the wait before each', () => {
  const built = flowFromStepLetters(homeStep()).flow;
  assert.deepEqual(linkedFlowEmails(built), {
    branches: false,
    lines: [
      { label: 'Email 1', wait: 'right away', words: 'You are on the list' },
      { label: 'Email 2', wait: 'after 1 day', words: 'A follow-up' },
      { label: 'Email 3', wait: 'after 3 days', words: 'One more note' }
    ]
  });
  const flow = {
    nodes: [
      { id: 't', type: 'trigger' }, { id: 'w1', type: 'delay', delayMinutes: 90 }, { id: 'e1', type: 'email', subject: '' },
      { id: 'w2', type: 'delay', mode: 'clock', delayMinutes: 0 }, { id: 's1', type: 'sms', message: 'x'.repeat(100) },
      { id: 'c', type: 'condition' }, { id: 'e2', type: 'email', subject: 'Yes path' }, { id: 'w3', type: 'delay', delayMinutes: 120 }, { id: 'e3', type: 'email', subject: 'No path' }
    ],
    edges: [
      { source: 't', target: 'w1' }, { source: 'w1', target: 'e1' }, { source: 'e1', target: 'w2' }, { source: 'w2', target: 's1' },
      { source: 's1', target: 'c' }, { source: 'c', target: 'e2', branch: 'yes' }, { source: 'c', target: 'w3', branch: 'else' }, { source: 'w3', target: 'e3' }
    ]
  };
  const read = linkedFlowEmails(flow);
  assert.equal(read.branches, true);
  assert.deepEqual(read.lines, [
    { label: 'Email 1', wait: 'after 90 minutes', words: 'No subject yet' },
    { label: 'Text 1', wait: 'at a set time', words: `${'x'.repeat(79)}…` },
    { label: 'Email 2', wait: 'right away', words: 'Yes path' },
    { label: 'Email 3', wait: 'after 2 hours', words: 'No path' }
  ]);
  assert.deepEqual(linkedFlowEmails(null), { lines: [], branches: false });
  assert.deepEqual(linkedFlowEmails({ nodes: [{ id: 'e', type: 'email', subject: 'orphan' }], edges: [] }), { lines: [], branches: false });
  // A loop is walked once.
  assert.equal(linkedFlowEmails({ nodes: [{ id: 't', type: 'trigger' }, { id: 'e', type: 'email', subject: 'a' }], edges: [{ source: 't', target: 'e' }, { source: 'e', target: 't' }] }).lines.length, 1);
});

test('the build\'s sentences name what happened and hold no em dash', () => {
  assert.equal(flowNotBuilt(401, 'whatever'), FLOW_NOT_BUILT_SIGN_IN);
  assert.equal(flowNotBuilt(400, 'A flow can have 60 steps.'), 'The flow was not built. A flow can have 60 steps.');
  assert.equal(flowNotBuilt(500, ''), 'The flow was not built. Try again in a minute.');
  assert.equal(flowNotBuilt(502, { not: 'a sentence' }), 'The flow was not built. Try again in a minute.');
  const copy = [
    FLOW_NOT_BUILT_SIGN_IN, FLOW_NOT_BUILT_UNANSWERED, LINKED_FLOW_UNREAD, flowNotBuilt(500), linkedLettersNote('Nurture'),
    ...stepLettersSource('By hand'), ...['', 'soon', '200 Days'].map((d) => flowFromStepLetters({ steps: [{ id: 'a', channel: 'email', delay: d, subject: '', body: '' }] }).error)
  ];
  for (const text of copy) {
    assert.equal(typeof text, 'string');
    assert.doesNotMatch(text, DASH, text);
  }
  assert.match(stepLettersSource('Left checkout')[1], /^Starts when: Left checkout\./);
});
