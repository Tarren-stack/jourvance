// Test Lead Flow (#22): the test walks the map's real lines and labels every effect Simulated.
// Pins the pure walker in src/lib/journeyWalk.ts against the default journey and the ecom
// blueprints, and pins the modal's source so it cannot go back to taking the first node of each
// type or claiming a delivery it never made.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  lineHandle,
  lineAction,
  walkEntries,
  walkExits,
  beginWalk,
  takeExit,
  walkAtLimit,
  startedSequenceIds,
  splitShares,
  pageButtonNote,
  firstNameFrom,
  fillMerge,
  WALK_INTRO,
  WALK_STEP_LIMIT
} from './src/lib/journeyWalk.ts';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from './src/lib/defaultBlueprint.ts';
import { ECOM_BLUEPRINTS } from './src/data/ecomBlueprints.ts';

const blueprint = nodeId => {
  const bp = ECOM_BLUEPRINTS.find(b => b.nodes.some(n => n.id === nodeId));
  assert.ok(bp, `blueprint with ${nodeId}`);
  return { nodes: bp.nodes, edges: bp.edges };
};
const exit = (project, nodeId, action) => {
  const found = walkExits(project, nodeId).find(x => x.action === action);
  assert.ok(found, `${nodeId} has a ${action} exit`);
  return found;
};
const node = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { type, label: id, ...data } });
const line = (source, target, sourceHandle) => ({ id: `${source}-${target}-${sourceHandle ?? ''}`, source, target, sourceHandle });

test('the default journey walks ad, page, form and ends in the sequence', () => {
  const p = DEFAULT_LEAD_CAPTURE_PROJECT;
  assert.equal(walkEntries(p)[0].id, 'node-ad-1');
  assert.equal(exit(p, 'node-ad-1', 'next').nextNodeId, 'node-page-1');
  assert.equal(exit(p, 'node-page-1', 'next').nextNodeId, 'node-form-1');
  const submit = exit(p, 'node-form-1', 'next');
  assert.equal(submit.nextNodeId, null);
  assert.deepEqual(submit.startsNodeIds, ['node-seq-1']);

  let path = beginWalk(p);
  assert.equal(path[0].nodeId, 'node-ad-1');
  path = takeExit(path, exit(p, 'node-ad-1', 'next'), p);
  path = takeExit(path, exit(p, 'node-page-1', 'next'), p);
  path = takeExit(path, submit, p);
  const end = path.at(-1);
  assert.equal(end.nodeId, null);
  assert.match(end.endSentence, /Nurture & Booking Flow/);
  assert.match(end.endSentence, /\(simulated\)/);
  assert.deepEqual(startedSequenceIds(path), ['node-seq-1']);
  // A dead end takes no more choices.
  assert.equal(takeExit(path, submit, p), path);
});

test('a page line into a sequence runs beside the thank-you page', () => {
  const p = blueprint('bp1-page');
  const next = exit(p, 'bp1-page', 'next');
  assert.equal(next.nextNodeId, 'bp1-ty');
  assert.deepEqual(next.startsNodeIds, ['bp1-seq']);
});

test('upsell accepted and declined follow their own lines', () => {
  const p = blueprint('bp5-upsell');
  assert.equal(exit(p, 'bp5-upsell', 'declined').nextNodeId, 'bp5-downsell');
  assert.equal(exit(p, 'bp5-upsell', 'accepted').nextNodeId, 'bp5-ty');
  const decline = exit(p, 'bp5-downsell', 'declined');
  assert.equal(decline.nextNodeId, null);
  assert.deepEqual(decline.startsNodeIds, []);
  const path = takeExit(beginWalk(p, 'bp5-downsell'), decline, p);
  assert.match(path.at(-1).endSentence, /so the map ends here\./);
});

test('leave and rescue start retention flows; lines out of a sequence are not walked', () => {
  const p = blueprint('bp6-page');
  const leave = exit(p, 'bp6-page', 'abandon');
  assert.equal(leave.nextNodeId, null);
  assert.deepEqual(leave.startsNodeIds, ['bp6-cart-recovery']);
  const decline = exit(p, 'bp6-upsell', 'declined');
  assert.equal(decline.nextNodeId, null);
  assert.deepEqual(decline.startsNodeIds, ['bp6-upsell-rescue']);
  assert.equal(exit(p, 'bp6-upsell', 'accepted').nextNodeId, 'bp6-ty');
  assert.deepEqual(walkExits(p, 'bp6-upsell-rescue'), []);
});

test('an incoming line from a sequence does not hide an entry', () => {
  const p = {
    nodes: [node('seq', 'follow-up-sequence', { steps: [] }), node('pX', 'landing-page'), node('p1', 'landing-page'), node('ad', 'ad-source')],
    edges: [line('seq', 'pX'), line('ad', 'p1')]
  };
  assert.deepEqual(walkEntries(p).map(n => n.id), ['ad', 'pX']);
});

test('an A/B split follows branch-a and branch-b, with the live share', () => {
  const p = {
    nodes: [node('split', 'ab-split', { splitRatio: 70 }), node('pA', 'landing-page'), node('pB', 'landing-page')],
    edges: [line('split', 'pA', 'branch-a'), line('split', 'pB', 'branch-b')]
  };
  const [a, b] = walkExits(p, 'split');
  assert.equal(a.action, 'branch-a');
  assert.match(a.label, /70%/);
  assert.match(b.label, /30%/);
  assert.equal(a.nextNodeId, 'pA');
  assert.equal(b.nextNodeId, 'pB');
  assert.equal(a.kind, 'split-a');
  assert.equal(b.kind, 'split-b');
  assert.deepEqual(splitShares({ winner: 'b', splitRatio: 50 }), { a: 0, b: 100, lockedTo: 'b' });
  assert.deepEqual(splitShares({ winner: null, splitRatio: 100 }), { a: 100, b: 0, lockedTo: 'a' });
  assert.deepEqual(splitShares({ splitRatio: 70 }), { a: 70, b: 30, lockedTo: null });
  assert.deepEqual(splitShares({}), { a: 50, b: 50, lockedTo: null });

  const unnamed = { nodes: p.nodes, edges: [line('split', 'pA')] };
  assert.equal(exit(unnamed, 'split', 'branch-a').nextNodeId, 'pA');

  // The map rule, not the server's outgoingEdges[0] fallback.
  const onlyB = { nodes: p.nodes, edges: [line('split', 'pB', 'branch-b')] };
  assert.equal(exit(onlyB, 'split', 'branch-a').nextNodeId, null);
  assert.equal(exit(onlyB, 'split', 'branch-b').nextNodeId, 'pB');
});

test('what a handle means', () => {
  assert.equal(lineAction('landing-page', 'accepted'), 'next'); // #31 legacy handle
  assert.equal(lineAction('landing-page', null), 'next');
  assert.equal(lineAction('landing-page', 'abandon'), 'abandon');
  assert.equal(lineAction('upsell', null), 'accepted');
  assert.equal(lineAction('upsell', 'rescue'), 'declined');
  assert.equal(lineAction('upsell', 'declined'), 'declined');
  assert.equal(lineAction('ab-split', null), 'branch-a');
  assert.equal(lineAction('follow-up-sequence', null), null);
  assert.equal(lineAction('thank-you', null), null);
  assert.equal(lineAction(undefined, null), null);
  assert.equal(lineHandle({ sourceHandle: undefined, data: { sourceHandle: 'declined' } }), 'declined');
  assert.equal(lineHandle({ sourceHandle: 'rescue', data: { sourceHandle: 'declined' } }), 'rescue');
  assert.equal(lineHandle({ sourceHandle: null, data: {} }), null);
});

test('two lines on one choice and lines to deleted steps', () => {
  const p = {
    nodes: [node('p0', 'landing-page'), node('p1', 'landing-page'), node('p2', 'landing-page')],
    edges: [line('p0', 'gone'), line('p0', 'p1'), line('p0', 'p2')]
  };
  const next = exit(p, 'p0', 'next');
  assert.equal(next.nextNodeId, 'p1');
  assert.deepEqual(next.skippedNodeIds, ['p2']);
  assert.equal(next.edgeIds.length, 2);
  assert.equal(exit(p, 'p0', 'abandon').nextNodeId, null);
});

test('a loop stops at the step limit', () => {
  const p = {
    nodes: [node('p1', 'landing-page'), node('p2', 'landing-page')],
    edges: [line('p1', 'p2'), line('p2', 'p1')]
  };
  assert.deepEqual(walkEntries(p).map(n => n.id), ['p1']);
  let path = beginWalk(p);
  for (let i = 0; i < WALK_STEP_LIMIT + 10; i++) {
    const current = path.at(-1).nodeId;
    path = takeExit(path, exit(p, current, 'next'), p);
  }
  assert.equal(WALK_STEP_LIMIT, 40);
  assert.equal(path.length, WALK_STEP_LIMIT);
  assert.equal(walkAtLimit(path), true);
  assert.equal(walkAtLimit(path.slice(0, -1)), false);
});

test('an empty map has no entry to walk', () => {
  assert.deepEqual(walkEntries({ nodes: [], edges: [] }), []);
  assert.equal(beginWalk({ nodes: [], edges: [] })[0].nodeId, null);
});

test('merge tags are never invented', () => {
  assert.equal(fillMerge('Hi [First Name],', ''), 'Hi [First Name],');
  assert.equal(fillMerge('Hi [first name] and [First Name]', 'Ada'), 'Hi Ada and Ada');
  assert.equal(fillMerge('Go to [Checkout Link]', 'Ada'), 'Go to [Checkout Link]');
  assert.equal(fillMerge('Hi [First Name]', '$&'), 'Hi $&');
  const formFields = DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.id === 'node-form-1').data.fields;
  assert.equal(firstNameFrom(formFields, { f_name: 'Ada Lovelace' }), 'Ada');
  assert.equal(firstNameFrom(formFields, {}), '');
  assert.equal(firstNameFrom([{ id: 'x', label: 'Business Name', type: 'text', enabled: true, required: false }], { x: 'Acme Ltd' }), '');
  assert.equal(firstNameFrom([{ id: 'y', label: 'Your first name', type: 'text', enabled: true, required: false }], { y: ' Grace ' }), 'Grace');
  const bp2Fields = blueprint('bp2-form').nodes.find(n => n.id === 'bp2-form').data.fields;
  const values = Object.fromEntries(bp2Fields.map(f => [f.id, f.id === 'f_tel' ? '5550001234' : '']));
  assert.equal(firstNameFrom(bp2Fields, values), '');
});

test('the page button note names the real setting', () => {
  const direct = pageButtonNote({ checkoutMode: undefined }, 'lead-form');
  assert.match(direct, /Direct to Checkout/);
  assert.match(direct, /2-Step Lead Gate/);
  assert.match(pageButtonNote({ checkoutMode: 'lead-gate' }, 'lead-form'), /name, email and phone/);
  assert.match(pageButtonNote({ checkoutMode: 'lead-gate' }, 'thank-you'), /sign-up form first/);
  assert.equal(pageButtonNote({ checkoutMode: 'direct' }, 'upsell'), null);
  assert.equal(pageButtonNote({ checkoutMode: undefined }, undefined), null);
});

test('every sentence is plain and honest', () => {
  const dash = /—| – /;
  const claims = /Delivered|Successfully|Captured/;
  const projects = [DEFAULT_LEAD_CAPTURE_PROJECT, ...ECOM_BLUEPRINTS.map(b => ({ nodes: b.nodes, edges: b.edges }))];
  const sentences = [WALK_INTRO];
  for (const mode of [undefined, 'direct', 'lead-gate']) {
    for (const t of ['lead-form', 'upsell', 'thank-you', undefined]) {
      const note = pageButtonNote({ checkoutMode: mode }, t);
      if (note) sentences.push(note);
    }
  }
  for (const p of projects) {
    for (const n of p.nodes) {
      const data = n.data;
      // Button copy the owner typed is shown as typed; only the walker's own words are pinned here.
      const ownCopy = new Set([data.ctaText, data.buttonText, data.submitButtonText, data.acceptButtonText, data.declineButtonText]
        .filter(v => typeof v === 'string').map(v => v.trim()));
      for (const x of walkExits(p, n.id)) {
        if (!ownCopy.has(x.label)) sentences.push(x.label);
        sentences.push(x.outcome);
        if (['next', 'accepted', 'branch-a', 'branch-b'].includes(x.action)) {
          assert.match(x.outcome, /^Simulated/, `${n.id} ${x.action}`);
        }
        const after = takeExit(beginWalk(p, n.id), x, p).at(-1);
        if (after.endSentence) sentences.push(after.endSentence.replace(x.label, ''));
      }
    }
  }
  assert.ok(sentences.length > 40);
  for (const s of sentences) {
    assert.doesNotMatch(s, dash, s);
    assert.doesNotMatch(s, claims, s);
  }
});

// The owner's own button copy is exempt above, but the blueprints' starting copy is ours: it shows
// on the walk's choice buttons and on every page published from a blueprint.
test('the blueprints ship no dashes in their copy', () => {
  const dash = /—| – /;
  const strings = [];
  const collect = v => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  for (const p of [DEFAULT_LEAD_CAPTURE_PROJECT, ...ECOM_BLUEPRINTS]) collect(p.nodes);
  assert.ok(strings.length > 100);
  for (const s of strings) assert.doesNotMatch(s, dash, s);
});

test('the modal walks lines and claims nothing', () => {
  const src = fs.readFileSync(new URL('./src/components/preview/LiveFunnelModal.tsx', import.meta.url), 'utf8');
  assert.match(src, /from '\.\.\/\.\.\/lib\/journeyWalk'/);
  for (const must of ['nokey', 'aria-modal', 'Simulated', 'Not sent']) assert.ok(src.includes(must), `has ${must}`);
  for (const never of ['Delivered', '$58.00', 'notifications@yourbusiness.com', '0m delay', 'Successfully', 'Your Business', 'jourvance.app', '—', 'fetch(', 'Friend']) {
    assert.ok(!src.includes(never), `does not contain ${never}`);
  }
  assert.doesNotMatch(src, / – /);
  assert.doesNotMatch(src, /project\.nodes\.find\(n => n\.type ===/);
});
