// T09: a step name that ends in "?" or "!" read "you?." in the sentences the map writes around it.
// A form's name is its title, and the default journey's form is "Where should we reach you?", so
// the line caption's screen-reader sentence, the loop notice and Check design's loop row all read
// a question mark then a full stop (or a comma). stepNames.ts now holds the one rule: endSentence
// never doubles a closing mark, and nameInSentence names a titled step by its kind and its title in
// quotes (Lead form "Where should we reach you?"). describeEdge, loopMessage, replacePrompt, the
// connection refusals, every Check design row, the fix preview and the delete notice all use it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { describeEdge, stepShortName, endSentence, nameInSentence } = await import('./src/lib/stepNames.ts');
const { loopMessage, replacePrompt, checkConnection } = await import('./src/lib/connectionRules.ts');
const { checkJourneyDesign, describeChange } = await import('./src/lib/designChecks.ts');
const { deletedNotice, restoredNotice } = await import('./src/lib/deleteNotice.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
const A = await import('./src/lib/addStep.ts');
const W = await import('./src/lib/journeyWalk.ts');

const clone = v => JSON.parse(JSON.stringify(v));
const home = () => clone(DEFAULT_LEAD_CAPTURE_PROJECT);
const line = (id, source, target, sourceHandle = null, targetHandle = null) => ({ id, source, target, sourceHandle, targetHandle, type: 'conversion', data: {} });
const ASKED = 'Where should we reach you?';

// A closing mark doubled: a full stop after it, also across a closing quote ("you?." or "you?"."),
// or a bare comma after it ("you?, which"). A comma after a closing quote stays allowed, since a
// list of quoted names keeps its commas (Lead form "Hi!", Meta ad and ...). Also a bare mark left
// mid-sentence ("you? to Landing").
const DOUBLED = /[?!…]['"’”)\]]*\.|[?!…],/;
const BARE_MID = /[?!] [a-z]/;
function clean(s, where) {
  assert.equal(typeof s, 'string', where);
  assert.doesNotMatch(s, DOUBLED, `${where}: ${s}`);
  assert.doesNotMatch(s, BARE_MID, `${where}: ${s}`);
}

test('endSentence adds one full stop and never a second mark', () => {
  assert.equal(endSentence('Deleted Meta ad'), 'Deleted Meta ad.');
  assert.equal(endSentence('Adds Lead form "Where should we reach you?"'), 'Adds Lead form "Where should we reach you?"');
  assert.equal(endSentence('Say “Hi!”'), 'Say “Hi!”');
  assert.equal(endSentence('Done.'), 'Done.');
});

test('nameInSentence quotes a titled step and leaves every other name as it reads', () => {
  assert.equal(nameInSentence(`Lead form: ${ASKED}`), `Lead form "${ASKED}"`);
  assert.equal(nameInSentence('Nurture sequence: Welcome!'), 'Nurture sequence "Welcome!"');
  assert.equal(nameInSentence('Cart recovery sequence: Come back'), 'Cart recovery sequence "Come back"');
  assert.equal(nameInSentence('Landing page /vip-consultation'), 'Landing page /vip-consultation');
  assert.equal(nameInSentence('Lead form'), 'Lead form');
  assert.equal(nameInSentence('Downsell /x/downsell'), 'Downsell /x/downsell');
  // A label that ends in its own mark is quoted whole.
  assert.equal(nameInSentence('Ready to glow?'), '"Ready to glow?"');
  assert.equal(nameInSentence('a step that is gone'), 'a step that is gone');
});

test("the finding's line caption: landing page to the form reads without \"?.\"", () => {
  const p = home();
  const byId = new Map(p.nodes.map(n => [n.id, n]));
  const e = p.edges.find(x => x.source === 'node-page-1' && x.target === 'node-form-1');
  assert.ok(e, 'the default journey joins the page to the form');
  const args = { kind: 'main', from: stepShortName(byId.get(e.source).data), to: stepShortName(byId.get(e.target).data) };
  assert.equal(describeEdge({ ...args, figure: null }),
    `Next step: from Landing page /vip-consultation to Lead form "${ASKED}" No visits measured yet.`);
  // The branch with no closing sentence returns the head alone.
  const estimated = { def: { id: 'opt-in' }, basis: 'Estimated', count: 3, denominator: 10 };
  assert.equal(describeEdge({ ...args, figure: estimated }), `Next step: from Landing page /vip-consultation to Lead form "${ASKED}"`);
  assert.equal(describeEdge({ ...args, visitors: 340, reached: 41 }),
    `Next step: from Landing page /vip-consultation to Lead form "${ASKED}" 41 of 340 visitors went on.`);
  // A name with no mark still gets its full stop.
  assert.equal(describeEdge({ kind: 'main', from: 'Meta ad', to: 'Landing page /x' }), 'Next step: from Meta ad to Landing page /x. No visits measured yet.');
});

test("the finding's loop notice and Check design's loop row name the form in quotes", () => {
  const p = home();
  const back = line('e-back', 'node-form-1', 'node-page-1');
  assert.equal(loopMessage(back, p.nodes),
    `This line makes a loop. Landing page /vip-consultation can lead back to Lead form "${ASKED}" The loop is marked on the map.`);
  // The loop row names the step the line returns to; with the form first, that is the form.
  const pick = id => p.nodes.find(n => n.id === id);
  const q = { ...home(), nodes: [pick('node-form-1'), pick('node-page-1')], edges: [line('e1', 'node-form-1', 'node-page-1'), line('e2', 'node-page-1', 'node-form-1')] };
  const rows = checkJourneyDesign(q).issues.filter(i => i.check === 'loop');
  assert.ok(rows.length > 0, 'Check design reports the loop');
  // The step closes the sentence, so no comma lands after the quoted question.
  assert.ok(rows.some(r => r.message === `A line from this step makes a loop back to Lead form "${ASKED}"`), rows.map(r => r.message).join(' | '));
  // A name with no mark of its own still gets its full stop: the default map with the line back.
  const withBack = { ...home(), edges: [...home().edges, back] };
  const plain = checkJourneyDesign(withBack).issues.filter(i => i.check === 'loop').map(r => r.message);
  assert.ok(plain.includes('A line from this step makes a loop back to Landing page /vip-consultation.'), plain.join(' | '));
});

test('no generated sentence doubles a mark for any step name ending in ? or !', () => {
  let sentences = 0;
  const rowsSeen = new Set();
  const say = (s, where) => { clean(s, where); sentences++; };
  for (const base of [DEFAULT_LEAD_CAPTURE_PROJECT, ...ECOM_BLUEPRINTS]) {
    for (const [mark, formTitle, sequenceTitle, label] of [['?', ASKED, 'Still thinking?', 'Ready to glow?'], ['!', 'Claim your spot!', 'Welcome!', 'Last chance!']]) {
      const p = clone(base);
      // Every form and sequence titled with the mark, and every step labelled with it, since the
      // connection rules name a step by its label.
      for (const n of p.nodes) {
        if (n.data.type === 'lead-form' || n.type === 'lead-form') n.data.formTitle = formTitle;
        if (n.data.type === 'follow-up-sequence' || n.type === 'follow-up-sequence') n.data.sequenceTitle = sequenceTitle;
        n.data.label = label;
      }
      const where = `${base.id} ${mark}`;
      const byId = new Map(p.nodes.map(n => [n.id, n]));
      const figures = [null, { def: { id: 'opt-in' }, basis: 'Estimated', count: 1, denominator: 2 }, { def: { id: 'opt-in' }, basis: 'Measured', count: 1, denominator: 2 }];
      for (const e of p.edges) {
        const from = stepShortName(byId.get(e.source).data);
        const to = stepShortName(byId.get(e.target).data);
        for (const figure of figures) say(describeEdge({ kind: 'main', from, to, figure }), `${where} describeEdge ${e.id}`);
        say(loopMessage(line('x', e.target, e.source), p.nodes), `${where} loopMessage ${e.id}`);
        say(replacePrompt(line('x', e.source, e.target, e.sourceHandle), p.nodes, [e]).body, `${where} replacePrompt ${e.id}`);
        say(describeChange({ kind: 'add-edge', edge: line('x', e.source, e.target, e.sourceHandle) }, p.nodes, p.edges), `${where} add-edge ${e.id}`);
        say(describeChange({ kind: 'remove-edge', edge: e }, p.nodes, p.edges), `${where} remove-edge ${e.id}`);
        say(describeChange({ kind: 'set-edge-handle', edgeId: e.id, end: 'target', before: 'bogus', after: null }, p.nodes, p.edges), `${where} set-edge-handle ${e.id}`);
        say(deletedNotice({ nodes: [], edges: [e] }, byId, true), `${where} deletedNotice ${e.id}`);
      }
      for (const n of p.nodes) {
        say(describeChange({ kind: 'add-node', node: n }, p.nodes, p.edges), `${where} add-node ${n.id}`);
        say(describeChange({ kind: 'set-node-field', nodeId: n.id, field: 'headline', value: 'x' }, p.nodes, p.edges), `${where} set-node-field ${n.id}`);
        say(deletedNotice({ nodes: [n], edges: [] }, byId, false), `${where} deletedNotice ${n.id}`);
        say(restoredNotice([n]), `${where} restoredNotice ${n.id}`);
        // A refused line names the step at the start of its sentence.
        for (const other of p.nodes) {
          if (other.id === n.id) continue;
          const v = checkConnection(line('x', n.id, other.id, 'no-such-exit'), p.nodes, p.edges);
          if (v.kind === 'refuse') say(v.message, `${where} refusal ${n.id}->${other.id}`);
        }
      }
      // Every Check design row, with every line reversed so each step is on a loop and one line into
      // each step through an entry it lacks, so the loop and hidden-line rows name every step.
      const looped = clone(p);
      for (const e of p.edges) looped.edges.push(line(`rev-${e.id}`, e.target, e.source));
      for (const n of p.nodes) looped.edges.push(line(`hid-${n.id}`, p.nodes[0].id, n.id, null, 'no-such-entry'));
      const issues = checkJourneyDesign(looped).issues;
      for (const i of issues) {
        say(i.message, `${where} check ${i.check}`);
        rowsSeen.add(i.check);
      }
      // Each pair of steps on a two-line loop of their own, so the loop row names every kind of
      // step as the one the line returns to, a titled form and sequence included.
      for (const a of p.nodes) {
        for (const b of p.nodes) {
          if (a.id === b.id) continue;
          const pair = { ...clone(p), nodes: [a, b], edges: [line('ab', a.id, b.id), line('ba', b.id, a.id)] };
          for (const i of checkJourneyDesign(pair).issues) {
            say(i.message, `${where} pair check ${i.check}`);
            if (i.check === 'loop' && /(Lead form|sequence) "/.test(i.message)) rowsSeen.add('loop into a titled step');
          }
        }
      }
    }
  }
  assert.ok(sentences > 1000, `only ${sentences} sentences checked`);
  for (const check of ['loop', 'hidden-line', 'loop into a titled step']) assert.ok(rowsSeen.has(check), `no ${check} row was produced`);
});

// The picker's sentences and the add summaries name steps by their label, which a person types
// (an A/B split called "Which offer wins?") and journeyAi sets from page titles. addStep.ts is
// outside this lane: until it places names with nameInSentence and ends on endSentence, this
// sweep runs as a TODO and reports each "wins?." it finds instead of failing the suite. It turns
// into an ordinary test by itself once addStep.ts imports those helpers.
const ADD_STEP_USES_RULE = /\bnameInSentence\b/.test(fs.readFileSync('./src/lib/addStep.ts', 'utf8'));
test('no add-step sentence doubles a mark for a step label ending in ? or !', {
  todo: ADD_STEP_USES_RULE ? false : 'addStep.ts still builds its sentences from bare labels (outside edit pending)'
}, () => {
  let sentences = 0;
  const say = (s, where) => { if (s) { clean(s, where); sentences++; } };
  const planText = plan => (plan.ok ? plan.summary : plan.reason);
  for (const base of [DEFAULT_LEAD_CAPTURE_PROJECT, ...ECOM_BLUEPRINTS]) {
    for (const label of ['Which offer wins?', 'Last chance!']) {
      const p = clone(base);
      for (const n of p.nodes) n.data.label = label;
      // A loose step with the same label, for a step dropped onto a line.
      const loose = { ...clone(p.nodes.find(n => n.type === 'landing-page') ?? p.nodes[0]), id: 'loose', position: { x: -2000, y: -2000 } };
      const where = `${base.id} ${label}`;
      for (const anchor of p.nodes) {
        const before = { direction: 'before', anchorId: anchor.id };
        say(A.pickerAnchorLabel(before, p.nodes, p.edges), `${where} anchor-label before ${anchor.id}`);
        for (const choice of A.STEP_CHOICES) say(planText(A.planAdd(before, choice.key, p.nodes, p.edges, 's')), `${where} before ${anchor.id} ${choice.key}`);
        for (const exit of A.exitOptions(anchor, p.nodes, p.edges)) {
          say(exit.label, `${where} exit option ${anchor.id}`);
          const next = { direction: 'next', anchorId: anchor.id, handle: exit.handle };
          say(A.exitNote(next, p.nodes, p.edges), `${where} exit note ${anchor.id}`);
          say(A.pickerAnchorLabel(next, p.nodes, p.edges), `${where} anchor-label next ${anchor.id}`);
          for (const row of [...Object.values(A.choicesFor(next, p.nodes, p.edges)).flat()]) say(row.refusal, `${where} row ${anchor.id} ${row.key}`);
          for (const choice of A.STEP_CHOICES) {
            const plan = A.planAdd(next, choice.key, p.nodes, p.edges, 's');
            say(planText(plan), `${where} next ${anchor.id} ${choice.key}`);
            const check = A.checkPlan(plan, p.nodes, p.edges);
            if (!check.ok) say(check.message, `${where} checkPlan ${anchor.id} ${choice.key}`);
          }
        }
      }
      for (const e of p.edges) {
        const between = { direction: 'between', edgeId: e.id };
        say(A.exitNote(between, p.nodes, p.edges), `${where} exit note ${e.id}`);
        say(A.pickerAnchorLabel(between, p.nodes, p.edges), `${where} anchor-label ${e.id}`);
        for (const choice of A.STEP_CHOICES) say(planText(A.planAdd(between, choice.key, p.nodes, p.edges, 's')), `${where} between ${e.id} ${choice.key}`);
        for (const n of p.nodes) say(planText(A.insertLine(p.nodes, p.edges, e.id, { ...n, id: `ins-${n.id}` }, 's')), `${where} insert ${n.id} on ${e.id}`);
        say(planText(A.dropOnLine([...p.nodes, loose], p.edges, e.id, 'loose', 's')), `${where} drop on ${e.id}`);
      }
    }
  }
  assert.ok(sentences > 1000, `only ${sentences} sentences checked`);
});

// The test drive's closing sentence names the step it stopped on by its label. journeyWalk.ts is
// outside this lane too, so this runs as a TODO until that file places names with nameInSentence.
const WALK_USES_RULE = /\bnameInSentence\b/.test(fs.readFileSync('./src/lib/journeyWalk.ts', 'utf8'));
test('no test-drive end sentence doubles a mark for a step label ending in ? or !', {
  todo: WALK_USES_RULE ? false : 'journeyWalk.ts still builds its end sentences from bare labels (outside edit pending)'
}, () => {
  let sentences = 0;
  for (const base of [DEFAULT_LEAD_CAPTURE_PROJECT, ...ECOM_BLUEPRINTS]) {
    for (const label of ['Still thinking?', 'Last chance!']) {
      const p = clone(base);
      for (const n of p.nodes) n.data.label = label;
      // Every exit of every step the walk can reach, once each.
      const seen = new Set();
      const queue = W.walkEntries(p).map(entry => W.beginWalk(p, entry.id));
      while (queue.length) {
        const path = queue.shift();
        const last = path[path.length - 1];
        if (!last || last.nodeId === null || seen.has(last.nodeId)) continue;
        seen.add(last.nodeId);
        for (const exit of W.walkExits(p, last.nodeId)) {
          const next = W.takeExit(path, exit, p);
          const end = next[next.length - 1]?.endSentence;
          if (end) { clean(end, `${base.id} ${label} walk from ${last.nodeId}`); sentences++; }
          queue.push(next);
        }
      }
    }
  }
  assert.ok(sentences > 10, `only ${sentences} end sentences checked`);
});
