import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Lines on the map were 20% white at 1.5px with no arrowheads and no legend, and an !important
// rule painted every handle the same colour. src/lib/edgeKinds.ts is now the one rule for what a
// line means, and the handles, the lines and the legend all read it.

const { EDGE_KINDS, EDGE_KIND_ORDER, edgeKind, isRetentionLink, isRetentionStep, branchHandleStyle } =
  await import('./src/lib/edgeKinds.ts');

test('the source handle decides the branch, then a retention target, then the main path', () => {
  assert.equal(edgeKind(undefined), 'main');
  assert.equal(edgeKind(null, { type: 'landing-page' }), 'main');
  assert.equal(edgeKind('accepted'), 'accepted');
  assert.equal(edgeKind('declined'), 'declined');
  assert.equal(edgeKind('abandon', { sequenceType: 'checkout_recovery' }), 'declined');
  assert.equal(edgeKind('branch-a'), 'split-a');
  assert.equal(edgeKind('branch-b'), 'split-b');
  assert.equal(edgeKind('rescue'), 'retention');
  assert.equal(edgeKind(undefined, { sequenceType: 'at_risk_winback' }), 'retention');
  assert.equal(edgeKind(undefined, { isRetentionBranch: true }), 'retention');
  assert.equal(edgeKind(undefined, undefined, true), 'retention');
  assert.equal(edgeKind('accepted', { isRetentionBranch: true }), 'accepted');
});

test('the retention rule matches the three copies it replaced', () => {
  for (const t of ['upsell_recovery', 'checkout_recovery', 'at_risk_winback']) assert.ok(isRetentionStep({ sequenceType: t }), t);
  assert.equal(isRetentionStep({ sequenceType: 'nurture' }), false);
  assert.equal(isRetentionStep(undefined), false);
  for (const h of ['declined', 'rescue', 'abandon']) assert.ok(isRetentionLink(h, undefined), h);
  assert.equal(isRetentionLink('accepted', undefined), false);
});

const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('every line colour reads against the canvas background', () => {
  for (const kind of EDGE_KIND_ORDER) {
    const ratio = contrast(EDGE_KINDS[kind].color, '#0B0F19');
    assert.ok(ratio >= 4.5, `${kind} is ${ratio.toFixed(2)}:1`);
  }
});

test('a "no" and a retention flow differ in dash as well as colour, and the main path is solid', () => {
  assert.equal(EDGE_KINDS.main.dash, undefined);
  assert.equal(EDGE_KINDS.accepted.dash, undefined);
  assert.ok(EDGE_KINDS.declined.dash && EDGE_KINDS.retention.dash);
  assert.notEqual(EDGE_KINDS.declined.dash, EDGE_KINDS.retention.dash);
  assert.equal(new Set(EDGE_KIND_ORDER.map(k => EDGE_KINDS[k].label)).size, EDGE_KIND_ORDER.length);
});

test('each branch handle takes the colour of the line that leaves it', () => {
  const handles = [
    ['UpsellNode.tsx', 'accepted'],
    ['UpsellNode.tsx', 'declined'],
    ['UpsellNode.tsx', 'rescue'],
    ['PageNode.tsx', 'abandon'],
    ['AbSplitNode.tsx', 'branch-a'],
    ['AbSplitNode.tsx', 'branch-b']
  ];
  for (const [file, id] of handles) {
    const src = fs.readFileSync(`src/components/canvas/nodes/${file}`, 'utf8');
    const at = src.indexOf(`id="${id}"`);
    assert.ok(at > 0, `${file} has no handle ${id}`);
    const block = src.slice(at, src.indexOf('/>', at));
    const used = block.match(/branchHandleStyle\('([a-z-]+)'\)/);
    assert.ok(used, `${file} ${id} does not use branchHandleStyle`);
    assert.equal(used[1], edgeKind(id), `${file} ${id}`);
  }
  assert.deepEqual(branchHandleStyle('accepted'), { background: EDGE_KINDS.accepted.color, borderColor: '#0F172A' });
});

test('no stylesheet rule can repaint the handles, and hover no longer moves them', () => {
  const css = fs.readFileSync('src/index.css', 'utf8');
  const rules = [...css.matchAll(/\.custom-handle[^{]*\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(rules.length >= 2);
  for (const body of rules) {
    assert.doesNotMatch(body, /(^|\s)(background|border)\s*:[^;]*!important/);
    assert.doesNotMatch(body, /(^|\s)(transform|scale|translate)\s*:/, 'React Flow places handles with transform; hover must not move them');
  }
});

test('lines no longer animate forever', () => {
  const src = fs.readFileSync('src/components/canvas/edges/ConversionEdge.tsx', 'utf8');
  assert.doesNotMatch(src, /infinite/);
  assert.match(src, /edgeKind\(/);
});

// A line that names a handle its source step does not have is never drawn, and one that names no
// handle on a step whose handles all have ids silently leaves from the first. bp6's page -> upsell
// line and the auditor's "add an upsell" fix named "accepted" on a landing page, so neither showed.
const NODE_FILES = {
  'ad-source': 'AdNode.tsx', 'landing-page': 'PageNode.tsx', 'lead-form': 'FormNode.tsx',
  'follow-up-sequence': 'SequenceNode.tsx', 'thank-you': 'ThankYouNode.tsx', upsell: 'UpsellNode.tsx', 'ab-split': 'AbSplitNode.tsx'
};
const sourceHandles = Object.fromEntries(Object.entries(NODE_FILES).map(([type, file]) => {
  const src = fs.readFileSync(`src/components/canvas/nodes/${file}`, 'utf8');
  const blocks = src.split('<Handle').slice(1).map(b => b.slice(0, b.indexOf('/>')));
  return [type, blocks.filter(b => /type="source"/.test(b)).map(b => (b.match(/id="([^"]+)"/) || [])[1] || null)];
}));

test('the handle table is read from the node components', () => {
  assert.deepEqual(sourceHandles.upsell, ['accepted', 'declined', 'rescue']);
  assert.deepEqual(sourceHandles['landing-page'], [null, 'abandon']);
  assert.deepEqual(sourceHandles['ab-split'], ['branch-a', 'branch-b']);
});

test('every shipped blueprint line leaves from a handle its step really has', async () => {
  const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
  const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
  const maps = [...ECOM_BLUEPRINTS, DEFAULT_LEAD_CAPTURE_PROJECT];
  let checked = 0;
  for (const map of maps) {
    const typeOf = new Map(map.nodes.map(n => [n.id, n.type]));
    for (const e of map.edges) {
      const handles = sourceHandles[typeOf.get(e.source)];
      assert.ok(handles, `${e.id}: unknown source ${e.source}`);
      const named = e.sourceHandle ?? null;
      if (named !== null) assert.ok(handles.includes(named), `${e.id} names "${named}", which ${typeOf.get(e.source)} does not have`);
      if (handles.length > 0 && handles.every(Boolean)) assert.ok(named, `${e.id} must say which ${typeOf.get(e.source)} branch it is`);
      checked++;
    }
  }
  assert.ok(checked > 20);
});

// "The auditor's upsell fix links from the page's own handle" lives in store-checks.test.mjs, where
// it drives the real planAuditFix and checks every added line draws.

// Every handle sits outside its card's edge. A card root with overflow: hidden clips it the moment
// the root also becomes the handles' containing block, which backdrop-filter, a position, a
// transform or a filter all do. Six cards had backdrop-filter (and the A/B card a position), so no
// handle on the map could be seen or dragged from.
test('no card root clips its own handles', () => {
  for (const file of Object.values(NODE_FILES)) {
    const src = fs.readFileSync(`src/components/canvas/nodes/${file}`, 'utf8');
    const start = src.indexOf('style={{', src.indexOf('return ('));
    const root = src.slice(start, src.indexOf('\n      }}', start));
    if (!/overflow: 'hidden'/.test(root)) continue;
    assert.doesNotMatch(root, /backdropFilter|position:\s*'(relative|absolute|fixed|sticky)'|transform:|\bfilter:|willChange|contain:/, `${file} root clips its handles`);
  }
});

// R06: bp6's line from the courtesy rescue sequence to the thank-you page was drawn amber and
// dotted (the legend's "Retention flow") while its pill read "NEXT" and its name "Moved on". The
// pill now takes the same flag the line's colour reads, so the two cannot disagree.
const { edgeMetricFor, asRetentionLine, isRetentionMetric } = await import('./src/lib/conversionBenchmarks.ts');
const { edgeFigure, edgePillValue, edgeSentence } = await import('./src/lib/journeyMetrics.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
const { injectRetentionFlows } = await import('./src/lib/funnelForecaster.ts');

test('a plain line drawn as a retention flow is named one, never NEXT (R06)', () => {
  const rescue = { sequenceType: 'upsell_recovery', isRetentionBranch: true };
  const plain = edgeMetricFor('follow-up-sequence', 'thank-you', undefined, { type: 'thank-you' });
  assert.equal(plain.short, 'NEXT');
  const drawn = edgeMetricFor('follow-up-sequence', 'thank-you', undefined, { type: 'thank-you' }, true);
  assert.equal(drawn.short, 'RESCUE');
  assert.equal(drawn.name, EDGE_KINDS.retention.label);
  assert.equal(drawn.bands, null);
  assert.ok(isRetentionMetric(drawn));
  assert.equal(asRetentionLine(plain, true), drawn);
  assert.equal(asRetentionLine(plain, false), plain);
  // A line with a real measure keeps it: a rescue sequence's click back to a page is still CLICK.
  assert.equal(edgeMetricFor('follow-up-sequence', 'landing-page', undefined, {}, true).short, 'CLICK');
  // A line into a rescue step is still the enrolment line, whatever the flag says.
  assert.equal(edgeMetricFor('upsell', 'follow-up-sequence', 'rescue', rescue, true).id, 'retention');

  // Its figure: no rate out of a sequence yet, so Unavailable and never graded, even with numbers.
  const measure = { views: 500, flowEnrolled: 142, flowSent: 142, flowClicked: 30, conversions: 26, visitors: 500 };
  const f = edgeFigure({ sourceType: 'follow-up-sequence', targetType: 'thank-you', source: measure, target: measure });
  const shown = { ...f, def: asRetentionLine(f.def, true) };
  assert.equal(edgePillValue(shown), 'Unavailable');
  assert.equal(shown.status.status, 'unavailable');
  assert.match(edgeSentence(shown, null), /^Retention flow: Unavailable\./);
});

test('every shipped and injected retention line reads as a retention line on its pill (R06)', () => {
  const maps = ECOM_BLUEPRINTS.map(bp => ({ id: bp.id, nodes: bp.nodes, edges: bp.edges }));
  for (const bp of ECOM_BLUEPRINTS) {
    const r = injectRetentionFlows({ nodes: structuredClone(bp.nodes), edges: structuredClone(bp.edges), addCartRecovery: true, addUpsellRescue: true });
    maps.push({ id: `${bp.id}+forecaster`, nodes: r.nodes, edges: r.edges });
  }
  let retention = 0;
  for (const map of maps) {
    const byId = new Map(map.nodes.map(n => [n.id, n]));
    for (const e of map.edges) {
      const target = byId.get(e.target);
      const source = byId.get(e.source);
      const handle = e.sourceHandle ?? e.data?.sourceHandle;
      // What JourneyCanvas hands ConversionEdge, and the kind the line is drawn as.
      const flag = Boolean(e.data?.isRetentionEdge || isRetentionLink(handle, target?.data));
      const kind = edgeKind(handle, target?.data, flag);
      if (kind !== 'retention') continue;
      retention++;
      const def = asRetentionLine(edgeMetricFor(source?.type, target?.type, handle, target?.data), true);
      assert.notEqual(def.short, 'NEXT', `${map.id} ${e.id}`);
      assert.ok(isRetentionMetric(def) || def.id === 'sequence-click', `${map.id} ${e.id} reads ${def.short}`);
    }
  }
  assert.ok(retention >= 3, `only ${retention} retention lines checked`);
});

test('source pin: the pill names its line from the kind the line is drawn as (R06)', () => {
  const src = fs.readFileSync('src/components/canvas/edges/ConversionEdge.tsx', 'utf8');
  assert.match(src, /const kindId = edgeKind\(d\?\.sourceHandle, d\?\.targetNodeData, d\?\.isRetentionEdge\)/);
  assert.match(src, /asRetentionLine\(measured\.def, kindId === 'retention'\)/);
  assert.match(src, /const isRetentionEdge = isRetentionMetric\(figure\?\.def\)/);
  // The kind is worked out before the pill reads its figure, and only once.
  assert.equal((src.match(/edgeKind\(/g) || []).length, 1);
  assert.ok(src.indexOf('const kindId') < src.indexOf('edgePillValue(figure)'));
});
