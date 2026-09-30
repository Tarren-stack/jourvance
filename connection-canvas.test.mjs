// The canvas half of the connection rules (#13). connection-rules.test.mjs pins the rules module
// itself; this file pins that the map actually asks it. Before this, handleConnect handed every
// drop to React Flow's addEdge: a step could join itself, a second line on a branch was simply
// added, and nothing on the map said a line was part of a loop. The components are JSX, which
// node cannot load, so these are source pins; the browser check drives the behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(file, 'utf8');
const canvas = read('src/components/canvas/JourneyCanvas.tsx');
const edge = read('src/components/canvas/edges/ConversionEdge.tsx');

// The body of `const name = useCallback(` up to the next top-level `const` in the component.
const callback = (src, name) => {
  const at = src.indexOf(`const ${name} = useCallback(`);
  assert.ok(at >= 0, `${name} is a useCallback`);
  const next = src.indexOf('\n  const ', at + 10);
  return src.slice(at, next < 0 ? undefined : next);
};

test('every line a person draws goes through checkConnection', () => {
  assert.ok(!canvas.includes('addEdge'), 'addEdge adds anything and drops a duplicate silently');
  for (const prop of [
    'onConnect={handleConnect}',
    'isValidConnection={isValidConnection}',
    'onConnectStart={clearRuleState}',
    'onConnectEnd={handleConnectEnd}',
    'onClickConnectStart={clearRuleState}',
    'onClickConnectEnd={handleClickConnectEnd}'
  ]) {
    assert.ok(canvas.includes(prop), prop);
  }
  assert.match(callback(canvas, 'handleConnect'), /checkConnection\(params, nodes, edges\)/);
  assert.match(callback(canvas, 'isValidConnection'), /checkConnection\(c, nodes, edges\)/);
  // A drag is judged again from where it ended; a click has only what isValidConnection recorded.
  assert.match(callback(canvas, 'handleConnectEnd'), /connectionFromState\(state\)/);
  assert.match(callback(canvas, 'handleClickConnectEnd'), /lastRefusal\.current/);
});

test('a new line is committed through withConnection on the saved edges', () => {
  const commit = callback(canvas, 'commitConnection');
  assert.match(commit, /withConnection\(edges, newEdge, replaced\)/);
  assert.match(commit, /onEdgesChange\(nextEdges\)/);
  // rfEdges carry drawing-only fields (sourceNodeData, onSelectEdge, inLoop) that must not be saved.
  assert.ok(!commit.includes('rfEdges'), 'built from rfEdges');
  assert.ok(!commit.includes('setRfEdges'), 'the sync effect redraws from the props');
  assert.match(commit, /createsLoop\(nextEdges, params\.source, params\.target\)/);
});

test('Replace is asked, checked again, and hands focus back', () => {
  assert.match(callback(canvas, 'handleConnect'), /setPendingReplace\(/);
  const confirm = callback(canvas, 'confirmReplace');
  assert.match(confirm, /checkConnection\(pending\.connection, nodes, edges\)/);
  assert.match(confirm, /commitConnection\(/);
  assert.match(canvas, /<ReplaceLineDialog[\s\S]*?prompt=\{pendingReplace \? replacePrompt\(/);
  assert.match(canvas, /returnFocus=\{returnFocusAfterReplace\}/);
  assert.match(callback(canvas, 'returnFocusAfterReplace'), /\.react-flow__node\[data-id="\$\{CSS\.escape\(id\)\}"\]/);
  assert.match(canvas, /<div ref=\{canvasRef\} tabIndex=\{-1\}/);
  // A pending line whose step is gone is dropped, not asked about.
  assert.match(canvas, /!nodeMap\.has\(pendingReplace\.connection\.source\)/);
});

test('a refusal or a loop is explained in a status region clear of the controls', () => {
  const at = canvas.indexOf('data-rule-notice=');
  assert.ok(at >= 0);
  const region = canvas.slice(canvas.lastIndexOf('bottom: 116', at), at);
  assert.ok(region.includes('bottom: 116'), 'sits above the controls and the minimap');
  assert.match(region, /role="status"/);
  assert.match(canvas.slice(at, at + 1400), />\s*Dismiss\s*</);
  assert.match(callback(canvas, 'handleConnect'), /refusalNotice\(verdict\.message\)/);
  assert.match(callback(canvas, 'commitConnection'), /loopMessage\(params, nodes\)/);
});

test('loops are found on the whole map and drawn from that, never from saved data', () => {
  assert.match(canvas, /const loopEdgeIds = useMemo\(\(\) => findLoopEdges\(edges\), \[edges\]\)/);
  const spread = canvas.indexOf('...(e.data || {})');
  const flag = canvas.indexOf('inLoop: loopEdgeIds.has(e.id)');
  assert.ok(spread >= 0 && flag > spread, 'inLoop is set after the saved data spread, so a stale one is overwritten');
  const effectEnd = canvas.indexOf(']);', flag);
  assert.match(canvas.slice(effectEnd - 120, effectEnd), /loopEdgeIds/);
});

test('a line on a loop shows a LOOP chip', () => {
  assert.match(edge, /const inLoop = !!d\?\.inLoop;/);
  assert.match(edge, /\{inLoop && \(\s*<span\s+data-loop="true"/);
  assert.match(edge, />\s*LOOP\s*</);
  assert.match(edge, /data-edge-id=\{id\}/);
  assert.match(edge, /This line is part of a loop\./);
});

test('the Replace dialog is centred and a refused drag is red', () => {
  const css = read('src/index.css');
  // The global reset zeroes the margin a native modal centres itself with.
  assert.match(css, /\.jv-replace-dialog \{\s*margin: auto;\s*\}/);
  const at = css.indexOf('.react-flow__connection.invalid .react-flow__connection-path');
  assert.ok(at >= 0);
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /stroke: #F87171/);
  assert.ok(!rule.includes('!important'));
});

test('the new canvas copy is plain', () => {
  const copy = [
    ...canvas.slice(canvas.indexOf('data-rule-notice=')).match(/>\s*([A-Z][^<>{}]*?)\s*</g) ?? [],
    'This line is part of a loop. Visitors can come back to a step they already passed.'
  ];
  for (const text of copy) {
    assert.ok(!text.includes('—'), text);
    assert.ok(!text.includes(' – '), text);
  }
  assert.ok(!/—| – /.test(edge.slice(edge.indexOf('inLoop'))));
});
