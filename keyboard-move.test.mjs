import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// C05: React Flow moves a selected step with Arrow or Shift+Arrow and reports it as position
// changes with no drag. The canvas passed on only pointer drops, so the move was on screen alone:
// a reload put the step back, Undo stayed off, and the next drag's undo step took it back too.

const { KEY_MOVE_SETTLE_MS, MOVE_KEYS, applyMoves, commitsWaitingMove, createMoveQueue, settledPositions } = await import('./src/lib/keyboardMoves.ts');
const { createHistory, recordEdit, undoStep } = await import('./src/lib/journeyHistory.ts');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const code = p => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// What React Flow 12 sends: moveSelectedNodes -> updateNodePositions(items) with dragging false.
const keyMove = (id, x, y) => [{ type: 'position', id, position: { x, y }, dragging: false }];
const dragMove = (id, x, y) => [{ type: 'position', id, position: { x, y }, dragging: true }];

const form = { id: 'node-form-1', type: 'lead-form', position: { x: 740, y: 170 }, data: { type: 'lead-form', label: 'Client Intake Form' } };
const ad = { id: 'node-ad-1', type: 'ad-source', position: { x: 50, y: 180 }, data: { type: 'ad-source', platform: 'meta', label: 'Meta Ad' } };
const project = nodes => ({ id: 'p1', name: 'Journey', nodes, edges: [], updatedAt: 'x' });

test('a keyboard move is a settled position; a drag in progress, a select or a size is not', () => {
  assert.deepEqual([...settledPositions(keyMove('a', 1, 2))], [['a', { x: 1, y: 2 }]]);
  assert.deepEqual([...settledPositions([{ type: 'position', id: 'a', position: { x: 3, y: 4 } }])], [['a', { x: 3, y: 4 }]]);
  assert.equal(settledPositions(dragMove('a', 1, 2)).size, 0);
  assert.equal(settledPositions([{ type: 'position', id: 'a', dragging: false }]).size, 0);
  assert.equal(settledPositions([{ type: 'select', id: 'a', selected: true }, { type: 'dimensions', id: 'a' }, { type: 'remove', id: 'a' }]).size, 0);
});

test('a run of arrow presses reaches App once, after the presses stop, at the last place', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const commits = [];
  const queue = createMoveQueue(moves => commits.push(new Map(moves)));
  for (let i = 1; i <= 10; i++) {
    queue.add(keyMove(form.id, 740 + i * 20, 170));
    t.mock.timers.tick(KEY_MOVE_SETTLE_MS - 1);
  }
  assert.equal(commits.length, 0, 'nothing while the presses keep coming');
  assert.equal(queue.pending(), true);
  t.mock.timers.tick(1);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].get(form.id), { x: 940, y: 170 });
  assert.equal(queue.pending(), false);
  t.mock.timers.tick(KEY_MOVE_SETTLE_MS * 3);
  assert.equal(commits.length, 1, 'never twice');
});

test('a drag in progress waits for nothing, and a drop is left to onNodeDragStop', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const commits = [];
  const queue = createMoveQueue(moves => commits.push(moves));
  queue.add(dragMove(ad.id, 60, 190));
  assert.equal(queue.pending(), false);
  queue.add(keyMove(ad.id, 80, 300)); // the drag's own last change, straight before onNodeDragStop
  queue.discard();
  t.mock.timers.tick(KEY_MOVE_SETTLE_MS * 2);
  assert.equal(commits.length, 0);
});

test('any other key or a pointer press commits a waiting move first, so Undo takes it back', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const key of MOVE_KEYS) assert.equal(commitsWaitingMove({ type: 'keydown', key }), false, key);
  for (const key of ['z', 'Meta', 'Control', 'Tab', 'Enter', 'Escape', 'Backspace']) assert.equal(commitsWaitingMove({ type: 'keydown', key }), true, key);
  assert.equal(commitsWaitingMove({ type: 'pointerdown' }), true);
  const commits = [];
  const queue = createMoveQueue(moves => commits.push(moves));
  queue.flush();
  assert.equal(commits.length, 0, 'nothing waiting commits nothing');
  queue.add(keyMove(form.id, 740, 185));
  queue.flush();
  assert.equal(commits.length, 1);
  t.mock.timers.tick(KEY_MOVE_SETTLE_MS * 2);
  assert.equal(commits.length, 1, 'the flushed timer does not fire again');
});

test('applyMoves moves only the named steps and keeps every other node the same object', () => {
  const nodes = [ad, form];
  const out = applyMoves(nodes, new Map([[form.id, { x: 940, y: 170 }]]));
  assert.equal(out[0], ad);
  assert.deepEqual(out[1], { ...form, position: { x: 940, y: 170 } });
  assert.deepEqual(form.position, { x: 740, y: 170 }, 'the input is never changed');
});

test('with the history App keeps, the keyboard move is its own undo step and a later drag is another', t => {
  // The old canvas never committed the move, so the ad drag's commit carried it and one undo put
  // both back (the review's s8b run). Here the move commits on its own first.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let present = project([ad, form]);
  let h = createHistory();
  let now = 10_000;
  const commit = nodes => {
    const next = project(nodes);
    h = recordEdit(h, present, next, now);
    present = next;
  };
  const queue = createMoveQueue(moves => commit(applyMoves(present.nodes, moves)));
  for (let i = 1; i <= 10; i++) queue.add(keyMove(form.id, 740, 170 + i * 5));
  t.mock.timers.tick(KEY_MOVE_SETTLE_MS);
  assert.equal(h.past.length, 1);
  now += 2000;
  commit(applyMoves(present.nodes, new Map([[ad.id, { x: 137, y: 325 }]])));
  assert.equal(h.past.length, 2);
  const undone = undoStep(h, present);
  assert.deepEqual(undone.target.nodes.find(n => n.id === form.id).position, { x: 740, y: 220 }, 'undoing the drag keeps the keyboard move');
  assert.deepEqual(undone.target.nodes.find(n => n.id === ad.id).position, { x: 50, y: 180 });
});

test('the canvas feeds every node change to the queue, commits it before a drag and drops a drop from it', () => {
  const canvas = code('src/components/canvas/JourneyCanvas.tsx');
  assert.match(canvas, /import \{[^}]*createMoveQueue[^}]*\} from '\.\.\/\.\.\/lib\/keyboardMoves'/);
  assert.match(canvas, /createMoveQueue\(moves => latestOnNodesChange\.current\(applyMoves\(latestNodes\.current, moves\)\)\)/);
  const nodesChange = canvas.slice(canvas.indexOf('const handleNodesChange'), canvas.indexOf('const handleEdgesChange'));
  assert.match(nodesChange, /onNodesChangeHandler\(changes as any\);\s*moveQueue\.current!\.add\(changes\);/);
  const dragStart = canvas.slice(canvas.indexOf('const handleNodeDragStart'), canvas.indexOf('const handleNodeDrag:'));
  assert.match(dragStart, /moveQueue\.current!\.flush\(\);/);
  const dragStop = canvas.slice(canvas.indexOf('const handleNodeDragStop'), canvas.indexOf('A step added, deleted or restored'));
  assert.ok(dragStop.indexOf('moveQueue.current!.discard()') > -1, 'a drop discards the queue');
  assert.ok(dragStop.indexOf('moveQueue.current!.discard()') < dragStop.indexOf('onNodesChange(persistedNodes(dragged)'), 'before it pushes the drop');
  assert.match(canvas, /window\.addEventListener\('keydown', flush, true\)/);
  assert.match(canvas, /window\.addEventListener\('pointerdown', flush, true\)/);
  assert.match(canvas, /commitsWaitingMove\(/);
  assert.doesNotMatch(canvas, /disableKeyboardA11y/, 'keyboard users keep moving steps');
});

// ---- npm run check:canvas: the browser half ----

const { keyboardMoveProblems, keyboardFindings, KEYBOARD_RULES } = await import('./scripts/canvas-browser-check.mjs');

test('check:canvas judges a keyboard move: saved, one undo step, kept over a reload', () => {
  const fixed = {
    found: true,
    before: { x: 740, y: 170 },
    screen: { x: 840, y: 170 },
    stored: { x: 840, y: 170 },
    undoOn: true,
    afterUndo: { x: 740, y: 170 },
    afterReload: { x: 840, y: 170 },
    quickBefore: { x: 840, y: 170 },
    quickUndo: { x: 840, y: 170 }
  };
  assert.deepEqual(keyboardMoveProblems(fixed), []);
  // What the old canvas did (the review's verify-7 runs): drawn at 840, kept at 740, Undo off,
  // back at 740 after a reload, and an undo straight after the arrows left the card where it was.
  const old = { ...fixed, stored: { x: 740, y: 170 }, undoOn: false, afterReload: { x: 740, y: 170 }, quickBefore: { x: 740, y: 170 }, quickUndo: { x: 800, y: 170 } };
  const problems = keyboardMoveProblems(old);
  assert.equal(problems.length, 4, problems.join('\n'));
  assert.match(problems[0], /^A step moved with the arrow keys was not saved: the map shows it at 840, 170 and this browser keeps 740, 170\.$/);
  assert.match(problems.join(' '), /Undo stayed off/);
  assert.match(problems.join(' '), /After a reload/);
  assert.match(problems.join(' '), /straight after the arrow keys/);
  assert.deepEqual(keyboardMoveProblems({ ...fixed, afterUndo: { x: 840, y: 170 } }).length, 1);
  assert.deepEqual(keyboardMoveProblems({ found: false }), ['No step could be focused and moved with the arrow keys.']);
  assert.deepEqual(keyboardMoveProblems({ ...fixed, screen: { x: 740, y: 170 } }), ['Shift+ArrowRight did not move the focused step on the map.']);
  for (const p of [...problems, ...keyboardMoveProblems({ found: false })]) assert.doesNotMatch(p, /—| – /);
});

test('a keyboard move finding is a zero-only a11y rule that names this harness', () => {
  assert.ok(KEYBOARD_RULES.includes('a11y-keyboard-move'));
  const out = keyboardFindings({ keyboardMove: ['Undo stayed off after a step was moved with the arrow keys.'] });
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].rule, 'a11y-keyboard-move');
  assert.match(out.findings[0].detail, /scripts\/canvas-browser-check\.mjs/);
  const src = code('scripts/canvas-browser-check.mjs');
  assert.match(src, /for \(const \[name, check\] of Object\.entries\(CANVAS_KEYBOARD_CHECKS\)\)/);
  assert.ok(src.indexOf('await runA11yChecks(') < src.indexOf('Object.entries(CANVAS_KEYBOARD_CHECKS)'), 'run beside #19, after the controls');
});
