import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// C36: a Backspace delete and a drag handed App React Flow's own copies of the steps and lines, so
// the drawing-only fields the canvas adds (a copy of both end steps' data on every line, the arrow,
// inLoop, isSelected, each step's measured size, selection and view mode) were saved into the
// journey. One delete grew a 60-step journey from 65 KB to 179 KB. What goes back to App is built
// from the saved props; React Flow gives only positions.

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const canvas = fs.readFileSync(path.join(ROOT, 'src/components/canvas/JourneyCanvas.tsx'), 'utf8');

/** The source from `const name =` to the end of its useCallback( ... ) call. */
function declaration(name) {
  const at = canvas.indexOf(`const ${name} = useCallback`);
  assert.ok(at > -1, `${name} not found`);
  const open = canvas.indexOf('(', at);
  let depth = 0;
  for (let i = open; i < canvas.length; i++) {
    if (canvas[i] === '(') depth++;
    else if (canvas[i] === ')' && --depth === 0) return canvas.slice(at, i + 1);
  }
  throw new Error(`${name} never closes`);
}

/** The arguments of every onNodesChange( / onEdgesChange( call in a piece of source. */
function changeCalls(src) {
  const calls = [];
  for (const m of src.matchAll(/on(Nodes|Edges)Change\(/g)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    calls.push(src.slice(m.index + m[0].length, i).trim());
  }
  return calls;
}

test('a delete and a drag hand App the saved steps and lines, never React Flow\'s copies', () => {
  for (const name of ['handleNodesChange', 'handleEdgesChange', 'handleNodeDragStop']) {
    const calls = changeCalls(declaration(name));
    assert.ok(calls.length > 0, `${name} calls App`);
    for (const args of calls) {
      assert.ok(!/\brf(Nodes|Edges)\b/.test(args), `${name} saves React Flow's drawing state: ${args}`);
    }
  }
  assert.match(declaration('handleNodesChange'), /onNodesChange\(persistedNodes\(\)\.filter\(n => !removedIds\.has\(n\.id\)\)/);
  assert.match(declaration('handleEdgesChange'), /onEdgesChange\(edges\.filter\(e => !removedIds\.has\(e\.id\)\)/);
  assert.match(declaration('handleNodeDragStop'), /onNodesChange\(persistedNodes\(dragged\)/);
});

test('persistedNodes is declared before the handlers that list it (no temporal dead zone)', () => {
  const at = canvas.indexOf('const persistedNodes = useCallback');
  for (const name of ['handleNodesChange', 'handleNodeDragStop']) {
    assert.ok(at > -1 && at < canvas.indexOf(`const ${name} = useCallback`), `persistedNodes comes after ${name}`);
    assert.match(declaration(name), /\bpersistedNodes\b[^\]]*\]\s*\)$/, `${name} lists persistedNodes`);
  }
  assert.match(declaration('handleEdgesChange'), /\bedges\]\s*\)$/);
});

test('persistedNodes keeps the saved step and takes only its position from the screen', () => {
  // Run the real function body: the saved props, React Flow's decorated copies, a drop position.
  const src = declaration('persistedNodes');
  const fn = src.slice(src.indexOf('(moved'), src.lastIndexOf(',', src.lastIndexOf('[nodes')))
    .replace(/: \{ id: string; position: XY \}\[\]/, '');
  const nodes = [
    { id: 'a', type: 'page', position: { x: 0, y: 0 }, data: { type: 'page', label: 'Lander' } },
    { id: 'b', type: 'form', position: { x: 300, y: 0 }, data: { type: 'form', label: 'Form' } },
    { id: 'c', type: 'thankyou', position: { x: 600, y: 0 }, data: { type: 'thankyou', label: 'Thanks' } }
  ];
  const decorate = n => ({ ...n, measured: { width: 240, height: 120 }, selected: true, dragging: true, ariaLabel: 'x', data: { ...n.data, canvasViewMode: 'detailed' } });
  const rfNodes = [
    decorate({ ...nodes[0], position: { x: 10, y: 20 } }),
    decorate(nodes[1])
    // c is not drawn yet: it keeps its saved position.
  ];
  const persistedNodes = new Function('nodes', 'rfNodes', `return ${fn};`)(nodes, rfNodes);
  const out = persistedNodes([{ id: 'b', position: { x: 333, y: 44 } }]);
  assert.deepEqual(out, [
    { ...nodes[0], position: { x: 10, y: 20 } },
    { ...nodes[1], position: { x: 333, y: 44 } },
    nodes[2]
  ]);
  for (const n of out) {
    assert.deepEqual(Object.keys(n).sort(), ['data', 'id', 'position', 'type']);
    assert.ok(!('canvasViewMode' in n.data));
  }
});
