import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// C24: the journey map leaked memory on every render. The edge-sync effect in JourneyCanvas put a
// new closure into every line's data on each run (onSelectEdge, onAddStep). A closure made during
// render holds that render's whole scope, which also holds rfEdges, the previous generation of
// lines, so each generation kept the one before alive: about 9 MB per 100 keystrokes on a 60 step
// journey, and 2.5 MB per 50 selections with no edit at all. Its deps named App's callbacks, which
// App passes as fresh inline arrows, so every App render built another generation.
//
// JourneyCanvas.tsx is JSX and cannot be imported here, so these pin the source: the handlers a
// line carries are made once, and the effect no longer re-runs on App's callback identities. The
// heap itself was measured in real Chrome (flat 12.6 -> 16.5 MB over 250 selections, was 12.7 -> 29).

const SRC = fs.readFileSync(new URL('./src/components/canvas/JourneyCanvas.tsx', import.meta.url), 'utf8');

// The effect that builds rfEdges from the saved lines, from its setRfEdges call to its deps.
const edgeSync = () => {
  const start = SRC.indexOf('setRfEdges(\n      edges.map(');
  assert.ok(start > 0, 'the edge-sync effect is where it was');
  const depsAt = SRC.indexOf('}, [', start);
  const depsEnd = SRC.indexOf(']);', depsAt);
  return { body: SRC.slice(start, depsAt), deps: SRC.slice(depsAt + 4, depsEnd).split(',').map(s => s.trim()) };
};

// The `data: { ... }` object each line gets, up to its closing `description` entry.
const lineData = body => {
  const at = body.indexOf('data: {');
  const end = body.indexOf('description\n', at);
  assert.ok(at > 0 && end > at, 'the line data object is where it was');
  return body.slice(at, end);
};

test('no function is made inside the data every line carries', () => {
  const data = lineData(edgeSync().body);
  assert.doesNotMatch(data, /=>/, 'an arrow function in line data holds the render scope, and rfEdges with it');
  assert.doesNotMatch(data, /\bfunction\b/);
  assert.match(data, /onSelectEdge: lineHandlers\.onSelectEdge,/);
  assert.match(data, /onAddStep: lineHandlers\.onAddStep,/);
});

test('the line handlers are made once and read the latest props through a ref', () => {
  const at = SRC.indexOf('const lineHandlers = useMemo(');
  assert.ok(at > 0, 'the line handlers are one memoised object');
  // Made once: its own close carries an empty deps list, so the render scope it holds is the
  // first one, never a chain of them.
  const close = SRC.indexOf('\n  }), []);', at);
  assert.ok(close > at && close < SRC.indexOf('\n  React.useEffect(', at), 'lineHandlers has empty deps');
  const handlers = SRC.slice(at, close);
  assert.match(SRC, /edgeHandlers\.current = \{ edges, onOpenEdge, onSelectNode, onSelectEdge \};/);
  // Every prop it calls comes off the ref, never off the render that made it.
  const body = handlers.slice(handlers.indexOf('=> {'));
  for (const prop of ['edges', 'onOpenEdge', 'onSelectNode']) {
    assert.doesNotMatch(body, new RegExp(`(?<![.\\w])${prop}\\b`), `${prop} is read from the ref`);
  }
  // onSelectEdge is also the handler's own key, so check only the calls.
  assert.doesNotMatch(body, /(?<![.\w])onSelectEdge\(/);
  assert.match(body, /h\.onSelectEdge\(clicked \|\| null\)/);
});

test("the edge-sync effect does not re-run on App's callback identities", () => {
  const { deps } = edgeSync();
  for (const cb of ['onSelectEdge', 'onSelectNode', 'onOpenEdge']) {
    assert.ok(!deps.includes(cb), `${cb} in the deps rebuilt every line on each App render`);
  }
  // It still re-runs on everything a line draws from.
  for (const input of ['edges', 'nodeMap', 'loopEdgeIds', 'canvasMetrics', 'selectedEdgeId', 'lineHandlers']) {
    assert.ok(deps.includes(input), input);
  }
});
