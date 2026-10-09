// Starter drafts and the starter switch (EMAIL_STUDIO_PLAN.md Wave 2; owner question 1, answered yes
// on 2026-10-08: an unedited starter draft is skipped and never sent).
//
// The placeholder bodies are read OUT OF server.mjs, the way seeded-offers.test.mjs reads the seeds:
// every step body INITIAL_DRIP_SEQUENCES seeds that tells the merchant to replace it, and every body
// the old-copy migration (recomputeDripCounters) writes that says the same. So a seed changed in
// server.mjs without a line in email-flow-content.mjs STARTER_DRAFT_BODIES fails here. The flow-map
// row is server.mjs's own presentSequenceRow, sliced out and run (server.mjs is never booted).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanBlockList } from './email-doc.mjs';
import { SEEDED_DRAFT_STEPS } from './server/seededOffers.mjs';
import {
  STARTER_DRAFT_BODIES, cleanAccountSequences, isStarterDraft, mergeAccountSteps, starterFlowOn, storedWaitHours
} from './email-flow-content.mjs';

const SERVER_SRC = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

function slice(from, to) {
  const start = SERVER_SRC.indexOf(from);
  assert.ok(start >= 0, `server.mjs no longer contains ${JSON.stringify(from)}`);
  const end = SERVER_SRC.indexOf(to, start + from.length);
  assert.ok(end > start, `server.mjs no longer contains ${JSON.stringify(to)} after ${JSON.stringify(from)}`);
  return SERVER_SRC.slice(start, end + to.length);
}

// A placeholder says "Replace": "Replace it with ...", "Replace this note with ...".
const PLACEHOLDER = /\bReplace\b/;

// The seeds' own step bodies, and the bodies the migration writes, as server.mjs has them.
function seededPlaceholders() {
  const seeds = new Function(`return ${slice('const INITIAL_DRIP_SEQUENCES = [', '\n];\n').replace(/^const INITIAL_DRIP_SEQUENCES = /, '')}`)();
  const seeded = seeds.flatMap((seq) => (seq.steps || []).map((step) => ({ where: `${seq.id} ${step.id}`, body: step.body })));
  const migration = slice('function recomputeDripCounters(data) {', '\n}\n');
  const written = [...migration.matchAll(/step\.body = ('(?:[^'\\]|\\.)*');/g)]
    .map((match, i) => ({ where: `recomputeDripCounters body ${i + 1}`, body: new Function(`return ${match[1]}`)() }));
  return { seeds, seeded, written };
}

const server = new Function('cleanBlockList', 'mergeAccountSteps', 'isStarterDraft', 'starterFlowOn', `
  ${slice('function block(id, kind, text, extra) {', '\n}\n')}
  ${slice('function cleanBlocks(input, fallback) {', '\n}\n')}
  ${slice('function cleanSteps(input, fallback) {', '\n}\n')}
  ${slice('function sequenceStepsFor(seq, bag) {', '\n}\n')}
  ${slice('function chainGraph(prefix, steps) {', '\n}\n')}
  ${slice('// D3: what the step panel says', '\n}\n')}
  return { cleanSteps, sequenceStepsFor, presentSequenceRow };
`)(cleanBlockList, mergeAccountSteps, isStarterDraft, starterFlowOn);

const SEED_SUBJECTS = ['You are on the list', 'What happens after you opt in', 'Still thinking it over?'];

test('server.mjs seeds and migrates to exactly the placeholders this suite expects, and each one is a draft', () => {
  const { seeded, written } = seededPlaceholders();
  const seededDrafts = seeded.filter((row) => PLACEHOLDER.test(row.body || ''));
  const writtenDrafts = written.filter((row) => PLACEHOLDER.test(row.body || ''));
  // Three Welcome seeds and two migration bodies today. A new one changes these counts on purpose.
  assert.deepEqual(seededDrafts.map((row) => row.where), ['drip_seq_default step_1', 'drip_seq_default step_2', 'drip_seq_default step_3']);
  assert.equal(writtenDrafts.length, 2, `the migration writes ${writtenDrafts.length} placeholder bodies: ${writtenDrafts.map((row) => row.where).join(', ')}`);
  assert.ok(written.length > writtenDrafts.length, 'the migration also writes a finished body (the checkout one), which the filter must leave out');
  for (const row of [...seededDrafts, ...writtenDrafts]) {
    assert.ok(STARTER_DRAFT_BODIES.includes(row.body), `${row.where} is not in STARTER_DRAFT_BODIES word for word: ${JSON.stringify(row.body)}`);
    assert.equal(isStarterDraft({ body: row.body }), true, `${row.where} as the shared step`);
    assert.equal(isStarterDraft({ body: row.body, blocks: [] }), true, `${row.where} with no blocks of its own`);
  }
  // The earlier winback draft (seededOffers.mjs SEEDED_DRAFT_STEPS) is one too, word for word.
  assert.equal(SEEDED_DRAFT_STEPS.length, 1);
  for (const row of SEEDED_DRAFT_STEPS) {
    assert.ok(STARTER_DRAFT_BODIES.includes(row.body), `${row.seqId} ${row.stepId}, the old winback draft, is not in STARTER_DRAFT_BODIES`);
    assert.equal(isStarterDraft({ body: row.body }), true, `${row.seqId} ${row.stepId}`);
  }
  // And nothing else in the list: every line tells the merchant to replace it, and comes from one of
  // those three places, so an edited email can never be mistaken for one.
  const origins = new Set([...seededDrafts, ...writtenDrafts, ...SEEDED_DRAFT_STEPS].map((row) => row.body));
  for (const body of STARTER_DRAFT_BODIES) {
    assert.match(body, PLACEHOLDER);
    assert.ok(origins.has(body), `STARTER_DRAFT_BODIES holds a line no seed, migration or old draft writes: ${JSON.stringify(body)}`);
  }
  assert.equal(STARTER_DRAFT_BODIES.length, 6);
});

test('every seed that is not a placeholder is never a draft, so the finished starter emails still send', () => {
  const { seeds } = seededPlaceholders();
  let checked = 0;
  for (const seq of seeds) {
    for (const step of seq.steps) {
      if (PLACEHOLDER.test(step.body)) continue;
      assert.equal(isStarterDraft(step), false, `${seq.id} ${step.id}`);
      assert.equal(isStarterDraft(server.cleanSteps([step], [])[0]), false, `${seq.id} ${step.id} as an account row`);
      checked += 1;
    }
  }
  assert.equal(checked, 6, 'cart 2, upsell 1, winback 1, review 2');
});

test('a draft is still a draft as the account row cleanSteps stores (one text block), with whitespace moved', () => {
  for (const body of STARTER_DRAFT_BODIES) {
    const [row] = server.cleanSteps([{ id: 'step_1', subject: 'A new subject', body }], []);
    assert.deepEqual(row.blocks.map((b) => b.kind), ['text']);
    assert.equal(isStarterDraft(row), true, 'a subject-only edit leaves the placeholder body, which would still go out');
    assert.equal(isStarterDraft({ body: `  ${body.replace(/\n\n/g, '\n \n')}  ` }), true, 'line breaks and spaces are not words');
    // A divider or spacer added holds nothing to read, so the email still says only the placeholder.
    assert.equal(isStarterDraft({ ...row, blocks: [...row.blocks, { id: 'd', kind: 'divider' }, { id: 's', kind: 'spacer', height: 24 }] }), true);
  }
});

test('an edited body never matches: one word, an added sentence, a rewrite, or a block added', () => {
  const body = STARTER_DRAFT_BODIES[0];
  const text = (t) => [{ id: 't', kind: 'text', text: t }];
  const edits = {
    'one word changed': { body: body.replace('real', 'true') },
    'a sentence added': { body: `${body} We open on Monday.` },
    'a word taken out': { body: body.replace('Hey ', '') },
    'rewritten in the builder': { body, blocks: text('Hey {{first_name}},\n\nThanks for joining. Here is your guide.') },
    'one word changed in the builder': { body, blocks: text(body.replace('signing up', 'joining')) },
    'an image added': { body, blocks: [...text(body), { id: 'i', kind: 'image', url: 'https://cdn.example.test/a.png' }] },
    'a button added': { body, blocks: [...text(body), { id: 'b', kind: 'button', label: 'Shop', url: 'https://shop.example.test' }] },
    'a heading added': { body, blocks: [{ id: 'h', kind: 'heading', text: 'Welcome' }, ...text(body)] },
    'the placeholder as a heading': { body, blocks: [{ id: 'h', kind: 'heading', text: body }] },
    'a sentence added inside the tags': { body, blocks: text(`<p>${body}</p><p>We open on Monday.</p>`) },
    'one word changed in HTML': { body, blocks: [{ id: 'x', kind: 'html', text: `<p>${body.replace('real', 'true')}</p>` }] },
    'an image tag beside other words': { body, blocks: [{ id: 'x', kind: 'html', text: '<p>Hey {{first_name}},</p><img src="https://cdn.example.test/a.png"><p>Our new range is in.</p>' }] },
    'a blank body': { body: '' },
    'no body at all': {}
  };
  for (const [name, step] of Object.entries(edits)) assert.equal(isStarterDraft(step), false, name);
  for (const junk of [null, undefined, 'text', 7, [], { blocks: 'text' }]) assert.equal(isStarterDraft(junk), false, String(junk));
});

test('the placeholder wrapped in tags or retyped into an HTML block reads as the same words, so it is still a draft', () => {
  for (const body of STARTER_DRAFT_BODIES) {
    const paragraphs = `<p>${body.split('\n\n').join('</p><p>')}</p>`;
    const cases = {
      'as an HTML block': [{ id: 'x', kind: 'html', text: body }],
      'as an HTML block in paragraphs': [{ id: 'x', kind: 'html', text: paragraphs }],
      'as a text block wrapped in <p>': [{ id: 't', kind: 'text', text: `<p>${body}</p>` }],
      'with <br> and &nbsp; for its breaks': [{ id: 't', kind: 'text', text: body.replace(/\n\n/g, '<br><br>').replace(/ /g, '&nbsp;') }],
      'with a bold name': [{ id: 't', kind: 'text', text: body.replace('{{first_name}}', '<strong>{{first_name}}</strong>') }]
    };
    for (const [name, blocks] of Object.entries(cases)) {
      assert.equal(isStarterDraft({ body, blocks }), true, `${name}: ${JSON.stringify(blocks[0].text.slice(0, 60))}`);
    }
    // As the account row cleanSteps stores: an HTML block keeps its text, and it is still the draft.
    const [row] = server.cleanSteps([{ id: 'step_1', subject: 'S', blocks: [{ id: 'x', kind: 'html', text: paragraphs }] }], []);
    assert.deepEqual(row.blocks.map((b) => b.kind), ['html']);
    assert.equal(isStarterDraft(row), true, `the stored HTML block: ${JSON.stringify(row.blocks[0].text.slice(0, 60))}`);
  }
});

test('the subject is never what decides: a placeholder under a new subject is a draft, a rewrite under the seed subject is not', () => {
  STARTER_DRAFT_BODIES.slice(0, 3).forEach((body, i) => {
    assert.equal(isStarterDraft({ subject: SEED_SUBJECTS[i], body }), true, `seed ${i + 1} as seeded`);
    assert.equal(isStarterDraft({ subject: 'Something the merchant wrote', body }), true, `seed ${i + 1} under a new subject`);
    assert.equal(isStarterDraft({ subject: SEED_SUBJECTS[i], body, blocks: [{ id: 't', kind: 'text', text: 'Hey {{first_name}},\n\nA real note.' }] }), false, `seed ${i + 1} rewritten under the seed subject`);
  });
});

test('the flow-map row marks the drafts the sender would skip, and stops once an email is edited', () => {
  const { seeds } = seededPlaceholders();
  const welcome = seeds.find((seq) => seq.id === 'drip_seq_default');
  const draftsOf = (row) => row.nodes.filter((node) => node.type === 'email').map((node) => node.starterDraft === true);
  assert.deepEqual(draftsOf(server.presentSequenceRow(welcome, { sequences: {} })), [true, true, true]);
  for (const seq of seeds.filter((row) => row.id !== welcome.id)) {
    const row = server.presentSequenceRow(seq, { sequences: {} });
    assert.ok(row.nodes.every((node) => !('starterDraft' in node)), `${seq.id} marks a finished email as a draft`);
  }
  // Email 1 rewritten and saved: only it stops being a draft. The mark rides on the email node itself.
  const bag = { sequences: cleanAccountSequences({ drip_seq_default: { steps: [{ id: 'step_1', subject: 'Welcome', blocks: [{ id: 'b', kind: 'text', text: 'Hey {{first_name}},\n\nA real first note.' }] }] } }, server.cleanSteps) };
  const edited = server.presentSequenceRow(welcome, bag);
  assert.deepEqual(draftsOf(edited), [false, true, true]);
  assert.equal(edited.nodes.find((node) => node.id === 'drip_seq_default_email_1').starterDraft, true);
  // A subject-only edit is stored as one text block of the placeholder: still a draft.
  const subjectOnly = { sequences: cleanAccountSequences({ drip_seq_default: { steps: [{ id: 'step_2', subject: 'New subject', blocks: [{ id: 'b', kind: 'text', text: welcome.steps[1].body }] }] } }, server.cleanSteps) };
  assert.deepEqual(draftsOf(server.presentSequenceRow(welcome, subjectOnly)), [true, true, true]);
});

test('starterFlowOn: on unless this account turned it off; the flow-map row carries it', () => {
  assert.equal(starterFlowOn({ sequences: {} }, 'drip_seq_default'), true, 'no row');
  assert.equal(starterFlowOn({}, 'drip_seq_default'), true, 'no sequences');
  assert.equal(starterFlowOn(null, 'drip_seq_default'), true, 'no bag');
  assert.equal(starterFlowOn({ sequences: { drip_seq_default: { steps: [] } } }, 'drip_seq_default'), true, 'a row with no enabled');
  assert.equal(starterFlowOn({ sequences: { drip_seq_default: { steps: [], enabled: true } } }, 'drip_seq_default'), true);
  assert.equal(starterFlowOn({ sequences: { drip_seq_default: { steps: [], enabled: false } } }, 'drip_seq_default'), false);
  assert.equal(starterFlowOn({ sequences: { drip_seq_default: { steps: [], enabled: false } } }, 'drip_seq_cart_recovery'), true, 'another flow');
  assert.equal(starterFlowOn({ sequences: { drip_seq_default: { enabled: 'false' } } }, 'drip_seq_default'), true, 'only the boolean false is off');
  // An inherited name is never a row.
  for (const id of ['__proto__', 'constructor', 'toString']) assert.equal(starterFlowOn({ sequences: {} }, id), true, id);
  const { seeds } = seededPlaceholders();
  const cart = seeds.find((seq) => seq.id === 'drip_seq_cart_recovery');
  assert.equal(server.presentSequenceRow(cart, { sequences: {} }).enabled, true);
  assert.equal(server.presentSequenceRow(cart, { sequences: { drip_seq_cart_recovery: { steps: [], enabled: false } } }).enabled, false);
});

test('cleanAccountSequences keeps a boolean enabled, and keeps a row that only turns its flow off', () => {
  const rows = cleanAccountSequences({
    off_only: { enabled: false },
    on_only: { enabled: true },
    off_with_steps: { enabled: false, steps: [{ id: 'step_1', subject: 'S', blocks: [{ id: 'b', kind: 'text', text: 'x' }] }] },
    on_with_steps: { enabled: true, steps: [{ id: 'step_1', subject: 'S', blocks: [{ id: 'b', kind: 'text', text: 'x' }] }] },
    junk_enabled: { enabled: 'false', steps: [{ id: 'step_1', subject: 'S', blocks: [{ id: 'b', kind: 'text', text: 'x' }] }] },
    nothing: {}
  }, server.cleanSteps);
  assert.deepEqual(Object.keys(rows), ['off_only', 'off_with_steps', 'on_with_steps', 'junk_enabled']);
  assert.deepEqual(rows.off_only, { steps: [], enabled: false });
  assert.equal(rows.off_with_steps.enabled, false);
  assert.equal(rows.off_with_steps.steps[0].subject, 'S');
  assert.equal(rows.on_with_steps.enabled, true);
  assert.equal('enabled' in rows.junk_enabled, false, 'a string is not a switch');
  // Written and read back as JSON, the same.
  assert.deepEqual(JSON.parse(JSON.stringify(cleanAccountSequences(JSON.parse(JSON.stringify(rows)), server.cleanSteps))), JSON.parse(JSON.stringify(rows)));
});

test('storedWaitHours: a stored 0 is 0 hours; only an absent or non-numeric wait is 24', () => {
  assert.equal(storedWaitHours(0), 0);
  assert.equal(storedWaitHours(1), 1);
  assert.equal(storedWaitHours(48), 48);
  assert.equal(storedWaitHours(2.5), 2.5);
  assert.equal(storedWaitHours('12'), 12);
  assert.equal(storedWaitHours('0'), 0);
  assert.equal(storedWaitHours(-5), 0, 'never below 0');
  for (const absent of [undefined, null, '', '   ', 'soon', NaN, Infinity, true, {}, []]) assert.equal(storedWaitHours(absent), 24, String(absent));
});
