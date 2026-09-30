// A follow-up card had no outgoing handle, so a line out of one (bp6's rescue -> thank-you, and
// the one the Forecaster and the auditor's retention fixes add) was never drawn and could not be
// selected or deleted. The card now has one unnamed exit on its right. These tests read the
// handle table straight from the card components, so a card that loses a handle fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EDGE_KINDS, branchHandleStyle, isRetentionLink } from './src/lib/edgeKinds.ts';
import * as edgeKinds from './src/lib/edgeKinds.ts';
import { edgeFigure } from './src/lib/journeyMetrics.ts';

// Copied from edge-kinds.test.mjs on purpose, so neither file has to import the other.
const NODE_FILES = {
  'ad-source': 'AdNode.tsx', 'landing-page': 'PageNode.tsx', 'lead-form': 'FormNode.tsx',
  'follow-up-sequence': 'SequenceNode.tsx', 'thank-you': 'ThankYouNode.tsx', upsell: 'UpsellNode.tsx', 'ab-split': 'AbSplitNode.tsx'
};
const handleBlocks = file => {
  const src = fs.readFileSync(`src/components/canvas/nodes/${file}`, 'utf8');
  return src.split('<Handle').slice(1).map(b => b.slice(0, b.indexOf('/>')));
};
const sourceHandles = Object.fromEntries(Object.entries(NODE_FILES).map(([type, file]) => [
  type,
  handleBlocks(file).filter(b => /type="source"/.test(b)).map(b => (b.match(/id="([^"]+)"/) || [])[1] || null)
]));
const sequenceSourceBlocks = () => handleBlocks(NODE_FILES['follow-up-sequence']).filter(b => /type="source"/.test(b));

test('a follow-up card has exactly one outgoing handle, unnamed, on its right', () => {
  const blocks = sequenceSourceBlocks();
  assert.equal(blocks.length, 1);
  assert.doesNotMatch(blocks[0], /\bid="[^"]*"/);
  assert.match(blocks[0], /Position\.Right/);
  assert.deepEqual(sourceHandles['follow-up-sequence'], [null]);
});

test('every shipped blueprint line leaves a step that has an outgoing handle', async () => {
  const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
  const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
  let checked = 0;
  for (const map of [...ECOM_BLUEPRINTS, DEFAULT_LEAD_CAPTURE_PROJECT]) {
    const typeOf = new Map(map.nodes.map(n => [n.id, n.type]));
    for (const e of map.edges) {
      const handles = sourceHandles[typeOf.get(e.source)];
      assert.ok(handles, `${e.id}: unknown source ${e.source}`);
      assert.ok(handles.length > 0, `${e.id} leaves ${typeOf.get(e.source)}, which has no outgoing handle`);
      if (e.sourceHandle) assert.ok(handles.includes(e.sourceHandle), `${e.id} names "${e.sourceHandle}"`);
      checked++;
    }
  }
  assert.ok(checked > 20);
});

test('the retention fix wires every line from a handle its step has', async () => {
  const { injectRetentionFlows } = await import('./src/lib/funnelForecaster.ts');
  const nodes = [
    { id: 'p', type: 'landing-page', position: { x: 420, y: 160 }, data: { type: 'landing-page', label: 'Page', productPrice: '$49' } },
    { id: 'u', type: 'upsell', position: { x: 790, y: 160 }, data: { type: 'upsell', label: 'Upsell', offerPrice: '$29' } },
    { id: 't', type: 'thank-you', position: { x: 1160, y: 160 }, data: { type: 'thank-you', label: 'Thanks' } }
  ];
  const result = injectRetentionFlows({ nodes, edges: [], addCartRecovery: true, addUpsellRescue: true });
  // One line into each sequence; drafts add no line out of one (R12 made drafts the only copy).
  assert.equal(result.addedEdges.length, 2);
  const typeOf = new Map(result.nodes.map(n => [n.id, n.type]));
  for (const e of result.addedEdges) {
    const handles = sourceHandles[typeOf.get(e.source)];
    assert.ok(handles && handles.length > 0, `${e.id} leaves ${typeOf.get(e.source)}, which has no outgoing handle`);
    if (e.sourceHandle) assert.ok(handles.includes(e.sourceHandle), `${e.id} names "${e.sourceHandle}"`);
  }
});

test('a line drawn out of a retention step is a retention link', () => {
  assert.equal(isRetentionLink(null, { type: 'thank-you' }, { sequenceType: 'upsell_recovery' }), true);
  assert.equal(isRetentionLink(undefined, { type: 'landing-page' }, { isRetentionBranch: true }), true);
  assert.equal(isRetentionLink(null, { type: 'landing-page' }, { sequenceType: 'lead_nurture' }), false);
  assert.equal(isRetentionLink(null, { type: 'thank-you' }), false);
});

test('a line drawn by hand out of a retention step is saved as a retention link', async () => {
  // #13 moved the line build into commitConnection and #12 into makeLine, which asks
  // isRetentionLink with the source step's data. A control shows a plain sequence stays plain.
  const { makeLine } = await import('./src/lib/addStep.ts');
  assert.equal(makeLine('a', null, 'b', null, { type: 'thank-you' }, 's', { sequenceType: 'upsell_recovery' }).data.isRetentionEdge, true);
  assert.equal(makeLine('a', null, 'b', null, { type: 'thank-you' }, 's', { sequenceType: 'lead_nurture' }).data.isRetentionEdge, false);
  const src = fs.readFileSync('src/components/canvas/JourneyCanvas.tsx', 'utf8');
  const start = src.indexOf('const commitConnection');
  assert.ok(start > 0, 'JourneyCanvas has no commitConnection');
  const body = src.slice(start, src.indexOf('const handleConnect', start));
  assert.match(body, /makeLine\([^;]*sourceNode\?\.data\s*\)/);
  assert.match(fs.readFileSync('src/lib/addStep.ts', 'utf8'), /isRetentionLink\(sourceHandle, targetData, sourceData\)/);
});

test('the handle dot takes the colour of the line that leaves it', () => {
  const [block] = sequenceSourceBlocks();
  assert.ok(block, 'no source handle on the follow-up card');
  assert.match(block, /isRetentionStep\(d\)/);
  assert.match(block, /branchHandleStyle\('retention'\)/);
  assert.equal(branchHandleStyle('retention').background, EDGE_KINDS.retention.color);
});

test('only a line into a follow-up shows a wait', () => {
  const { lineShowsDelay } = edgeKinds;
  assert.equal(typeof lineShowsDelay, 'function');
  assert.equal(lineShowsDelay(true, 'follow-up-sequence'), true);
  assert.equal(lineShowsDelay(true, 'thank-you'), false);
  assert.equal(lineShowsDelay(true, 'upsell'), false);
  assert.equal(lineShowsDelay(false, 'follow-up-sequence'), false);
  // #9 moved the wait into journeyMetrics: it is the step's own delay, shown only into a follow-up.
  assert.match(fs.readFileSync('src/lib/journeyMetrics.ts', 'utf8'), /lineShowsDelay\(true, input\.targetType\)/);
  const rescue = targetType => edgeFigure({ sourceType: 'upsell', targetType, sourceHandle: 'rescue', targetData: { delayHours: 5 }, source: null, target: null });
  assert.equal(rescue('thank-you').delayText, undefined);
  assert.equal(rescue('follow-up-sequence').delayText, '5h wait');
});

test('a line out of a sequence shows no rate until it is measured', () => {
  const { lineRateMeasured } = edgeKinds;
  assert.equal(typeof lineRateMeasured, 'function');
  assert.equal(lineRateMeasured('follow-up-sequence'), false);
  assert.equal(lineRateMeasured('landing-page'), true);
  assert.equal(lineRateMeasured(undefined), true);
  // #9 moved the rule into edgeFigure, which the line pill and the inspector both read.
  assert.match(fs.readFileSync('src/lib/journeyMetrics.ts', 'utf8'), /!lineRateMeasured\(input\.sourceType\)/);
  const line = sourceType => edgeFigure({ sourceType, targetType: 'thank-you', sourceHandle: null, targetData: {}, source: { flowEnrolled: 50, pageViews: 50 }, target: { pageViews: 40 } });
  assert.equal(line('follow-up-sequence').basis, null);
  assert.equal(line('thank-you').basis, 'Estimated');
  assert.match(fs.readFileSync('src/components/canvas/edges/ConversionEdge.tsx', 'utf8'), /useEdgeFigure\(/);
  assert.match(fs.readFileSync('src/components/drawers/EdgeInspector.tsx', 'utf8'), /figureForEdge\(/);
});
