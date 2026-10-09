// Email content for starter and built-in flows (EMAIL_STUDIO_PLAN.md, Wave 1, D5): the pure rules
// in email-flow-content.mjs, run against server.mjs's own seeds, cleanSteps and chainGraph, sliced
// out of the file and evaluated without booting the server (the way seeded-offers.test.mjs and
// registry-reload.test.mjs read it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanBlockList } from './email-doc.mjs';
import {
  ACCOUNT_SEQUENCE_LIMIT, cleanAccountSequences, emailHasContent, mergeAccountSteps, stepsFromChain
} from './email-flow-content.mjs';

const SERVER_SRC = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

function slice(from, to) {
  const start = SERVER_SRC.indexOf(from);
  assert.ok(start >= 0, `server.mjs no longer contains ${JSON.stringify(from)}`);
  const end = SERVER_SRC.indexOf(to, start + from.length);
  assert.ok(end > start, `server.mjs no longer contains ${JSON.stringify(to)} after ${JSON.stringify(from)}`);
  return SERVER_SRC.slice(start, end + to.length);
}

// The seeds and helpers exactly as server.mjs has them.
const server = new Function('cleanBlockList', 'mergeAccountSteps', `
  ${slice('function block(id, kind, text, extra) {', '\n}\n')}
  ${slice('function cleanBlocks(input, fallback) {', '\n}\n')}
  ${slice('function cleanSteps(input, fallback) {', '\n}\n')}
  ${slice('function sequenceStepsFor(seq, bag) {', '\n}\n')}
  ${slice('function chainGraph(prefix, steps) {', '\n}\n')}
  ${slice('const AUTOMATION_DEFAULTS = [', '\n];\n')}
  ${slice('const INITIAL_DRIP_SEQUENCES = [', '\n];\n')}
  return { cleanSteps, sequenceStepsFor, chainGraph, AUTOMATION_DEFAULTS, INITIAL_DRIP_SEQUENCES };
`)(cleanBlockList, mergeAccountSteps);

const { cleanSteps, sequenceStepsFor, chainGraph, AUTOMATION_DEFAULTS, INITIAL_DRIP_SEQUENCES } = server;
const clone = (value) => JSON.parse(JSON.stringify(value));
const seed = (id) => {
  const seq = INITIAL_DRIP_SEQUENCES.find((row) => row.id === id);
  assert.ok(seq, `server.mjs seeds ${id}`);
  return clone(seq);
};
const emails = (graph) => graph.nodes.filter((node) => node.type === 'email');
const waits = (graph) => graph.nodes.filter((node) => node.type === 'delay');

test('the five starter flows and two built-in flows are still the ones this suite reads', () => {
  assert.deepEqual(INITIAL_DRIP_SEQUENCES.map((seq) => seq.id), [
    'drip_seq_default', 'drip_seq_cart_recovery', 'drip_seq_upsell_recovery', 'drip_seq_at_risk_winback', 'drip_seq_review_request'
  ]);
  assert.deepEqual(AUTOMATION_DEFAULTS.map((row) => row.id), ['post_purchase', 'winback']);
});

test('chainGraph puts each step\'s preview text on its email node', () => {
  const seq = seed('drip_seq_default');
  const nodes = emails(chainGraph(seq.id, seq.steps));
  assert.deepEqual(nodes.map((node) => node.previewText), seq.steps.map((step) => step.previewText));
  assert.ok(nodes.every((node) => node.previewText), 'every Welcome email has preview text to keep');
});

test('stepsFromChain round-trips every seeded starter flow', () => {
  for (const shared of INITIAL_DRIP_SEQUENCES) {
    const seq = clone(shared);
    const graph = chainGraph(seq.id, seq.steps);
    const read = stepsFromChain(clone(graph), seq.steps);
    assert.equal(read.ok, true, `${seq.id}: ${read.detail}`);
    assert.equal(read.steps.length, seq.steps.length, seq.id);
    read.steps.forEach((step, i) => {
      const was = seq.steps[i];
      assert.equal(step.id, was.id, `${seq.id} step ${i} id`);
      assert.equal(step.stepNumber, was.stepNumber, `${seq.id} step ${i} stepNumber`);
      assert.equal(step.discountVoucher, was.discountVoucher, `${seq.id} step ${i} voucher`);
      assert.equal(step.subject, was.subject, `${seq.id} step ${i} subject`);
      assert.equal(step.previewText, was.previewText, `${seq.id} step ${i} preview text`);
      assert.equal(step.delayHours, was.delayHours, `${seq.id} step ${i} wait`);
      assert.deepEqual(step.blocks, emails(graph)[i].blocks, `${seq.id} step ${i} blocks`);
    });
    // Saved and merged back, the map draws the same subjects, preview texts, waits and words.
    const merged = mergeAccountSteps(seq.steps, cleanSteps(read.steps, []));
    const again = chainGraph(seq.id, merged);
    assert.deepEqual(again.nodes.map((node) => node.id), graph.nodes.map((node) => node.id), `${seq.id} node ids`);
    assert.deepEqual(emails(again).map((node) => [node.subject, node.previewText, node.blocks.map((b) => b.text)]),
      emails(graph).map((node) => [node.subject, node.previewText, node.blocks.map((b) => b.text)]), seq.id);
    assert.deepEqual(waits(again).map((node) => node.delayHours), waits(graph).map((node) => node.delayHours), seq.id);
  }
});

test('stepsFromChain round-trips both built-in flows', () => {
  for (const def of AUTOMATION_DEFAULTS) {
    const steps = cleanSteps(undefined, def.steps);
    const graph = chainGraph(def.id, steps);
    const read = stepsFromChain(clone(graph), steps);
    assert.equal(read.ok, true, `${def.id}: ${read.detail}`);
    assert.deepEqual(cleanSteps(read.steps, []), steps, def.id);
  }
});

// One valid graph and a list of single changes to it, each of which must be refused.
function welcomeGraph() {
  const seq = seed('drip_seq_default');
  return { seq, graph: clone(chainGraph(seq.id, seq.steps)) };
}

test('stepsFromChain refuses an extra email, a missing email, a branch, a cycle and an unknown step', () => {
  const control = welcomeGraph();
  assert.equal(stepsFromChain(control.graph, control.seq.steps).ok, true, 'the unchanged graph is accepted');

  const cases = {
    'an extra email at the end': ({ nodes, edges }) => {
      const last = nodes[nodes.length - 1].id;
      nodes.push({ id: 'extra', type: 'email', subject: 'More', previewText: '', blocks: [{ id: 'x', kind: 'text', text: 'More' }] });
      edges.push({ id: 'e_extra', source: last, target: 'extra', branch: '' });
    },
    'the last email missing': ({ nodes, edges }) => {
      const lastEmail = nodes[nodes.length - 1].id;
      const wait = edges.find((edge) => edge.target === lastEmail).source;
      nodes.splice(nodes.findIndex((node) => node.id === lastEmail), 1);
      nodes.splice(nodes.findIndex((node) => node.id === wait), 1);
      for (const id of [lastEmail, wait]) edges.splice(edges.findIndex((edge) => edge.target === id), 1);
    },
    'a branch out of the trigger': ({ nodes, edges }) => {
      edges.push({ id: 'e_branch', source: nodes[0].id, target: nodes[nodes.length - 1].id, branch: 'yes' });
    },
    'a cycle back to the first email': ({ nodes, edges }) => {
      edges.push({ id: 'e_loop', source: nodes[nodes.length - 1].id, target: emails({ nodes })[0].id, branch: '' });
    },
    'a cycle back to the trigger': ({ nodes, edges }) => {
      edges.push({ id: 'e_loop', source: nodes[nodes.length - 1].id, target: nodes[0].id, branch: '' });
    },
    'a loop of steps off the chain': ({ nodes, edges }) => {
      nodes.push({ id: 'a', type: 'email', blocks: [{ id: 'a', kind: 'text', text: 'a' }] }, { id: 'b', type: 'delay', delayHours: 2 });
      edges.push({ id: 'ab', source: 'a', target: 'b' }, { id: 'ba', source: 'b', target: 'a' });
    },
    'a condition step in place of a wait': ({ nodes }) => { waits({ nodes })[0].type = 'condition'; },
    'a text step added at the end': ({ nodes, edges }) => {
      const last = nodes[nodes.length - 1].id;
      nodes.push({ id: 'txt', type: 'sms', message: 'Hi' });
      edges.push({ id: 'e_txt', source: last, target: 'txt', branch: '' });
    },
    'a second trigger': ({ nodes }) => { nodes.push({ id: 'start_2', type: 'trigger' }); },
    'an edge to a step that is not there': ({ edges }) => { edges[edges.length - 1].target = 'gone'; },
    'a repeated step id': ({ nodes }) => { nodes[2].id = nodes[1].id; },
    'a wait with no email after it': ({ nodes, edges }) => {
      const last = nodes[nodes.length - 1].id;
      nodes.push({ id: 'tail_wait', type: 'delay', delayHours: 5 });
      edges.push({ id: 'e_tail', source: last, target: 'tail_wait', branch: '' });
    },
    'no edges at all': (graph) => { graph.edges = []; },
    'nodes that are not a list': (graph) => { graph.nodes = { 0: graph.nodes[0] }; }
  };
  for (const [name, change] of Object.entries(cases)) {
    const { seq, graph } = welcomeGraph();
    change(graph);
    const read = stepsFromChain(graph, seq.steps);
    assert.equal(read.ok, false, `${name} is refused`);
    assert.equal(read.error, 'shape', `${name}: ${read.detail}`);
    assert.equal(read.steps, undefined, `${name} hands back no steps`);
  }
  assert.equal(stepsFromChain(null, control.seq.steps).ok, false, 'no graph');
  assert.equal(stepsFromChain([], control.seq.steps).ok, false, 'an array is not a graph');
});

test('waits land on the step after them, and a wait that does not parse is refused, never read as 0', () => {
  const { seq, graph } = welcomeGraph();
  // Welcome: email 1 with no wait, then 24 hours, email 2, then 48 hours, email 3.
  const [first, second] = waits(graph);
  first.delayHours = 36;
  second.delayHours = '12';
  const read = stepsFromChain(graph, seq.steps);
  assert.equal(read.ok, true, read.detail);
  assert.deepEqual(read.steps.map((step) => step.delayHours), [0, 36, 12]);

  const cart = seed('drip_seq_cart_recovery');
  const cartRead = stepsFromChain(chainGraph(cart.id, cart.steps), cart.steps);
  assert.deepEqual(cartRead.steps.map((step) => step.delayHours), [1, 24], 'a wait before the first email is that email\'s');

  for (const bad of [0, -2, 2161, 'soon', '', null, undefined, Number.NaN, Infinity]) {
    const again = welcomeGraph();
    waits(again.graph)[1].delayHours = bad;
    const refused = stepsFromChain(again.graph, again.seq.steps);
    assert.equal(refused.ok, false, `a wait of ${String(bad)} is refused`);
    assert.equal(refused.error, 'wait', String(bad));
  }
});

// Fix round (review finding: delayHours 0 read as 24). Both senders compute the next due time with
// `delayHours || 24` (server.mjs, the drip sender and processAccountAutomations), so a wait taken
// out from between two emails was stored as 0, drawn as no wait, and sent a day later.
function withoutWait(graph, wait) {
  const into = graph.edges.find((edge) => edge.target === wait.id);
  const out = graph.edges.find((edge) => edge.source === wait.id);
  graph.nodes.splice(graph.nodes.indexOf(wait), 1);
  graph.edges.splice(graph.edges.indexOf(out), 1);
  into.target = out.target;
  return graph;
}

// The senders read a stored 0 as 24 hours when this was written; since Wave 2 a stored 0 is 0 hours
// (storedWaitHours, starter-drafts.test.mjs). The refusal stands: a starter or built-in flow's steps stay fixed.
test('a wait taken out from between two emails is refused, because a starter or built-in flow keeps its steps', () => {
  const { seq, graph } = welcomeGraph();
  const read = stepsFromChain(withoutWait(graph, waits(graph)[0]), seq.steps);
  assert.equal(read.ok, false, `the wait before Welcome's email 2 was taken out and the save went through: ${JSON.stringify(read.steps?.map((step) => step.delayHours))}`);
  assert.equal(read.error, 'shape');
  const last = welcomeGraph();
  assert.equal(stepsFromChain(withoutWait(last.graph, waits(last.graph)[1]), last.seq.steps).ok, false, 'the wait before email 3');

  const steps = cleanSteps(undefined, AUTOMATION_DEFAULTS.find((row) => row.id === 'post_purchase').steps);
  const after = clone(chainGraph('post_purchase', steps));
  assert.equal(stepsFromChain(withoutWait(after, waits(after)[1]), steps).ok, false, 'After the order: the wait before email 2');

  // Control: a step after the first whose base has no wait (a sequence made through
  // POST /api/drips/sequences can store 0) is drawn with none, and saving it as drawn still works.
  const made = [{ id: 's1', delayHours: 0, subject: 'One', body: 'one' }, { id: 's2', delayHours: 0, subject: 'Two', body: 'two' }];
  const madeRead = stepsFromChain(clone(chainGraph('made', made)), made);
  assert.equal(madeRead.ok, true, madeRead.detail);
  assert.deepEqual(madeRead.steps.map((step) => step.delayHours), [0, 0]);
  // And a built-in flow's first wait is still the account's to take out (enrollAutomation reads 0 as 0).
  const first = clone(chainGraph('post_purchase', steps));
  const firstRead = stepsFromChain(withoutWait(first, waits(first)[0]), steps);
  assert.equal(firstRead.ok, true, firstRead.detail);
  assert.deepEqual(firstRead.steps.map((step) => step.delayHours), [0, 72]);
});

test('a wait is a whole number of hours: a fraction, or a string that is not digits, is refused', () => {
  for (const bad of [0.5, 0.0001, 1.5, 2160.5, '0.5', '1.5', '0x10', '1e2', '+4', '-3', ' ', 'Infinity', [5], true]) {
    const { seq, graph } = welcomeGraph();
    waits(graph)[0].delayHours = bad;
    const read = stepsFromChain(graph, seq.steps);
    assert.equal(read.ok, false, `a wait of ${JSON.stringify(bad)} was accepted as ${read.steps?.[1]?.delayHours}`);
    assert.equal(read.error, 'wait', JSON.stringify(bad));
  }
  for (const [good, hours] of [[1, 1], [2160, 2160], ['12', 12], [' 36 ', 36]]) {
    const { seq, graph } = welcomeGraph();
    waits(graph)[0].delayHours = good;
    const read = stepsFromChain(graph, seq.steps);
    assert.equal(read.ok, true, `${JSON.stringify(good)}: ${read.detail}`);
    assert.equal(read.steps[1].delayHours, hours);
  }
});

test('an email with a blank subject is refused, because the sender would put a stand-in subject on it', () => {
  for (const subject of ['', '   ', undefined, null, 7]) {
    const { seq, graph } = welcomeGraph();
    emails(graph)[1].subject = subject;
    const read = stepsFromChain(graph, seq.steps);
    assert.equal(read.ok, false, `a subject of ${JSON.stringify(subject)} was accepted`);
    assert.equal(read.error, 'no_subject', JSON.stringify(subject));
  }
});

test('emailHasContent: words, a picture, a button or a filled cell is content; blank text, a divider or junk is not', () => {
  const yes = {
    'text with words': [{ kind: 'text', text: 'Hi there' }],
    'a heading': [{ kind: 'heading', text: 'Hello' }],
    'Klaviyo HTML': [{ kind: 'html', text: '<p>Hello</p>' }],
    'an image with an address': [{ kind: 'image', url: 'https://cdn.example.org/a.png' }],
    'a button': [{ kind: 'button', label: 'Open', url: '' }],
    'a product block': [{ kind: 'product', mode: 'static', products: [{ title: 'Jar' }] }],
    'a column with words': [{ kind: 'columns', columns: [{ blocks: [] }, { blocks: [{ kind: 'text', text: 'Right' }] }] }],
    'a split with an image': [{ kind: 'split', cells: [{ kind: 'text', text: '' }, { kind: 'image', url: 'https://cdn.example.org/b.png' }] }],
    'a blank block beside a filled one': [{ kind: 'text', text: '' }, { kind: 'divider' }, { kind: 'text', text: 'Words' }],
    'an unknown kind that cleans to text with words': cleanBlockList([{ kind: 'bogus', text: 'Kept words' }])
  };
  const no = {
    'no blocks': [],
    'not a list': undefined,
    'one blank text block': [{ kind: 'text', text: '' }],
    'only spaces and new lines': [{ kind: 'text', text: '   \n  ' }],
    'a blank heading': [{ kind: 'heading', text: '' }],
    'an image with no address': [{ kind: 'image', url: '  ' }],
    'a divider and a spacer': [{ kind: 'divider' }, { kind: 'spacer', height: 24 }],
    'columns of blank text': [{ kind: 'columns', columns: [{ blocks: [{ kind: 'text', text: ' ' }] }, { blocks: [] }] }],
    'a split with nothing in it': [{ kind: 'split', cells: [{ kind: 'text', text: '' }, { kind: 'image', url: '' }] }],
    'junk': [null, 'text', 4],
    'junk after the real cleaner': cleanBlockList([1, null, 'a', []]),
    'an unknown blank kind after the real cleaner': cleanBlockList([{ kind: 'bogus' }])
  };
  for (const [name, blocks] of Object.entries(yes)) assert.equal(emailHasContent(blocks), true, name);
  for (const [name, blocks] of Object.entries(no)) assert.equal(emailHasContent(blocks), false, name);
  // The case the review ran: the real cleaner keeps junk as one blank text block, so a length check passes it.
  assert.equal(cleanBlockList([1, null, 'a', []]).length, 1);
});

test('an email with no blocks is refused, because the sender would send the shared draft in its place', () => {
  const { seq, graph } = welcomeGraph();
  emails(graph)[1].blocks = [];
  const read = stepsFromChain(graph, seq.steps);
  assert.equal(read.ok, false);
  assert.equal(read.error, 'empty_email');
});

test('image, button and columns blocks survive the save, the clean and the merge', () => {
  const { seq, graph } = welcomeGraph();
  const rich = [
    { id: 'img', kind: 'image', url: 'https://cdn.example.org/hero.png', alt: 'A jar on a shelf', href: 'https://shop.example.org/' },
    { id: 'btn', kind: 'button', label: 'Shop now', url: 'https://shop.example.org/', color: '#f472b6' },
    { id: 'cols', kind: 'columns', columns: [
      { blocks: [{ id: 'c1', kind: 'text', text: 'Left words' }] },
      { blocks: [{ id: 'c2', kind: 'image', url: 'https://cdn.example.org/side.png', alt: 'Side' }] }
    ] }
  ];
  emails(graph)[0].blocks = clone(rich);
  emails(graph)[0].subject = 'A new first subject';
  emails(graph)[0].previewText = 'A new preview';
  const read = stepsFromChain(graph, seq.steps);
  assert.equal(read.ok, true, read.detail);
  const stored = cleanSteps(read.steps, []);
  const sent = sequenceStepsFor(seq, { sequences: { [seq.id]: { steps: stored } } });
  const blocks = sent[0].blocks;
  assert.deepEqual(blocks.map((b) => b.kind), ['image', 'button', 'columns']);
  assert.equal(blocks[0].url, 'https://cdn.example.org/hero.png');
  assert.equal(blocks[0].alt, 'A jar on a shelf');
  assert.equal(blocks[1].label, 'Shop now');
  assert.equal(blocks[1].url, 'https://shop.example.org/');
  assert.equal(blocks[2].columns.length, 2);
  assert.equal(blocks[2].columns[0].blocks[0].text, 'Left words');
  assert.equal(blocks[2].columns[1].blocks[0].url, 'https://cdn.example.org/side.png');
  assert.equal(sent[0].subject, 'A new first subject');
  assert.equal(sent[0].previewText, 'A new preview');
  // And the map draws them back.
  assert.deepEqual(emails(chainGraph(seq.id, sent))[0].blocks, blocks);
  // The other two emails are untouched.
  assert.equal(sent[1].subject, seq.steps[1].subject);
  assert.equal(sent[2].body, seq.steps[2].body);
});

test('mergeAccountSteps keeps id, stepNumber and discountVoucher from the shared step', () => {
  const seq = seed('drip_seq_cart_recovery');
  seq.steps[1].discountVoucher = 'MERCHANT5';
  const account = [{ id: 'cart_step_2', stepNumber: 99, discountVoucher: 'TAKEN', subject: 'Mine', previewText: 'My preview', blocks: [{ id: 'm', kind: 'text', text: 'Mine' }], delayHours: 30 }];
  const merged = mergeAccountSteps(seq.steps, account);
  assert.equal(merged[1].id, 'cart_step_2');
  assert.equal(merged[1].stepNumber, 2);
  assert.equal(merged[1].discountVoucher, 'MERCHANT5');
  assert.equal(merged[1].subject, 'Mine');
  assert.equal(merged[1].previewText, 'My preview');
  assert.deepEqual(merged[1].blocks, [{ id: 'm', kind: 'text', text: 'Mine' }]);
  assert.equal(merged[1].delayHours, 30);
  assert.deepEqual(merged[0], seq.steps[0], 'a step with no account row is unchanged');
  assert.notEqual(merged[0], seq.steps[0], 'and is a copy, so a caller cannot change the shared step through it');
});

test('mergeAccountSteps matches by id, so it still holds after the shared list is reordered', () => {
  const seq = seed('drip_seq_default');
  const account = cleanSteps([
    { id: 'step_1', subject: 'First, mine', previewText: 'p1', blocks: [{ id: 'a', kind: 'text', text: 'one' }], delayHours: 0 },
    { id: 'step_3', subject: 'Third, mine', previewText: 'p3', blocks: [{ id: 'c', kind: 'text', text: 'three' }], delayHours: 50 }
  ], []);
  const reordered = [seq.steps[2], seq.steps[0], seq.steps[1]];
  const merged = mergeAccountSteps(reordered, account);
  assert.deepEqual(merged.map((step) => step.id), ['step_3', 'step_1', 'step_2']);
  assert.deepEqual(merged.map((step) => step.subject), ['Third, mine', 'First, mine', seq.steps[1].subject]);
  assert.deepEqual(merged.map((step) => step.delayHours), [50, 0, 24]);
  assert.deepEqual(merged.map((step) => step.blocks?.[0]?.text), ['three', 'one', undefined]);
  // A row whose id is not in the shared list is ignored.
  const stray = mergeAccountSteps(seq.steps, [{ id: 'step_9', subject: 'Nowhere', blocks: [] }]);
  assert.deepEqual(stray, seq.steps);
});

test('cleanAccountSequences keeps at most 20 well-formed ids and cleans each row through cleanSteps', () => {
  const input = {};
  for (let i = 0; i < 25; i++) input[`seq_${i}`] = { steps: [{ id: 'step_1', subject: `S${i}`, blocks: [{ id: 'b', kind: 'text', text: 'x' }] }] };
  input['has space'] = { steps: [{ id: 'step_1' }] };
  input[''] = { steps: [{ id: 'step_1' }] };
  input['x'.repeat(61)] = { steps: [{ id: 'step_1' }] };
  input.empty = { steps: [] };
  const out = cleanAccountSequences(input, cleanSteps);
  assert.equal(Object.keys(out).length, ACCOUNT_SEQUENCE_LIMIT);
  assert.deepEqual(Object.keys(out), Array.from({ length: 20 }, (_, i) => `seq_${i}`));
  assert.equal(out.seq_0.steps[0].subject, 'S0');
  assert.equal(out.seq_0.steps[0].previewText, '', 'cleaned rows carry every field cleanSteps writes');

  const long = cleanAccountSequences({ drip_seq_default: { steps: [{ id: 'step_1', subject: 'y'.repeat(300), delayHours: 99999, blocks: [] }] } }, cleanSteps);
  assert.equal(long.drip_seq_default.steps[0].subject.length, 200);
  assert.equal(long.drip_seq_default.steps[0].delayHours, 2160);

  for (const bad of [null, undefined, 'text', 7, [], [{ steps: [] }]]) {
    assert.deepEqual(Object.keys(cleanAccountSequences(bad, cleanSteps)), [], String(bad));
  }
});

test('__proto__ and constructor are plain ids that change nothing', () => {
  const row = { steps: [{ id: 'step_1', subject: 'Polluted', blocks: [{ id: 'p', kind: 'text', text: 'p' }] }] };
  const raw = JSON.parse(JSON.stringify({ constructor: row, drip_seq_default: { steps: [{ id: 'step_2', subject: 'Real edit', blocks: [{ id: 'r', kind: 'text', text: 'r' }] }] } })
    .replace('{"constructor"', `{"__proto__":${JSON.stringify(row)},"constructor"`));
  assert.ok(Object.prototype.hasOwnProperty.call(raw, '__proto__'), 'the input really carries an own __proto__ key');

  const out = cleanAccountSequences(raw, cleanSteps);
  assert.equal(Object.getPrototypeOf(out), null, 'the record has no prototype to write through');
  assert.equal(Object.prototype.steps, undefined, 'nothing was written onto Object.prototype');
  assert.equal(({}).steps, undefined);
  assert.equal('toString' in out, false, 'no inherited name reads as a row');
  assert.deepEqual(Object.keys(out).sort(), ['__proto__', 'constructor', 'drip_seq_default']);
  // Written and read back as JSON, the same three rows.
  assert.deepEqual(Object.keys(cleanAccountSequences(JSON.parse(JSON.stringify(out)), cleanSteps)).sort(), ['__proto__', 'constructor', 'drip_seq_default']);

  // A seeded flow merges only its own row, and every other seeded flow is unchanged.
  for (const shared of INITIAL_DRIP_SEQUENCES) {
    const seq = clone(shared);
    const sent = sequenceStepsFor(seq, { sequences: out });
    if (seq.id === 'drip_seq_default') {
      assert.deepEqual(sent.map((step) => step.subject), [seq.steps[0].subject, 'Real edit', seq.steps[2].subject]);
    } else {
      assert.deepEqual(sent, seq.steps, seq.id);
    }
  }
  // A bag with no rows at all: every seeded flow sends its shared steps.
  const empty = cleanAccountSequences({}, cleanSteps);
  for (const shared of INITIAL_DRIP_SEQUENCES) assert.deepEqual(sequenceStepsFor(clone(shared), { sequences: empty }), shared.steps);
});
