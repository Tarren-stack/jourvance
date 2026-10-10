// A lazy part of the app whose file does not arrive (open list, second round). After a deploy an open
// tab still asks for the old build's chunk names; App rendered every lazy view and modal with no error
// boundary, so one failed import (BlueprintModal loads on every visit) unmounted the whole app.
// src/components/ChunkBoundary.tsx now stands around both of App's Suspense regions. The behaviour (a
// withheld BlueprintModal chunk shows the sentence while the sidebar and the canvas stay) is the
// browser check's chunk-missing step; this file pins the sentence, the predicate and the wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CHUNK_NOT_LOADED, isChunkLoadError } from './src/lib/chunkLoad.ts';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('the sentence is the one asked for, with no dash', () => {
  assert.equal(CHUNK_NOT_LOADED, 'This part of Jourvance did not load. Reload the page to get the newest version.');
  assert.doesNotMatch(CHUNK_NOT_LOADED, /—| – /);
});

test('isChunkLoadError: a file that did not arrive, in each browser and from Vite, and nothing else', () => {
  const chunk = [
    new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1:4173/assets/BlueprintModal-Ab12Cd34.js'),
    new TypeError('error loading dynamically imported module: https://jourvance.com/assets/HubEmailSuite-9f8e7d6c.js'),
    new TypeError('Importing a module script failed.'),
    new Error('Unable to preload CSS for /assets/JourneyCanvas-1a2b3c4d.css'),
    Object.assign(new Error('Loading chunk 7 failed.'), { name: 'ChunkLoadError' })
  ];
  for (const error of chunk) assert.equal(isChunkLoadError(error), true, String(error));
  const other = [
    new TypeError("Cannot read properties of undefined (reading 'nodes')"),
    new Error('Minified React error #130'),
    new SyntaxError('Unexpected token <'),
    'Failed to fetch dynamically imported module',
    null,
    undefined,
    { message: 42 }
  ];
  for (const error of other) assert.equal(isChunkLoadError(error), false, String(error?.message ?? error));
});

test('the boundary says the sentence with a Reload button, and passes any other error on', () => {
  const src = read('./src/components/ChunkBoundary.tsx');
  assert.match(src, /static getDerivedStateFromError\(error: unknown\): State \{\n\s+return \{ failed: true, error \};/);
  // Not a missing file: thrown on to whatever is above, as before the boundary existed.
  assert.match(src, /if \(!isChunkLoadError\(this\.state\.error\)\) throw this\.state\.error;/);
  assert.match(src, /<span>\{CHUNK_NOT_LOADED\}<\/span>/);
  assert.match(src, /<button type="button" style=\{reloadBtn\} onClick=\{\(\) => window\.location\.reload\(\)\}>Reload<\/button>/);
  assert.match(src, /minHeight: '44px'/, 'the Reload button is under the 44px target');
});

test('every lazy( in App.tsx is rendered only inside a ChunkBoundary', () => {
  const app = read('./src/App.tsx');
  const names = [...app.matchAll(/const (\w+) = lazy\(/g)].map((m) => m[1]);
  assert.equal(names.length, (app.match(/\blazy\(/g) || []).length, 'a lazy( this pin does not read by its name');
  assert.ok(names.length >= 19, `only ${names.length} lazy parts found, so this checks too little`);
  // Each <ChunkBoundary ...> to its own </ChunkBoundary>, nesting counted.
  const regions = [];
  const stack = [];
  for (const m of app.matchAll(/<ChunkBoundary\b[^>]*>|<\/ChunkBoundary>/g)) {
    if (m[0].startsWith('</')) {
      assert.ok(stack.length, `a </ChunkBoundary> with no opening at ${m.index}`);
      regions.push([stack.pop(), m.index]);
    } else stack.push(m.index + m[0].length);
  }
  assert.equal(stack.length, 0, 'a <ChunkBoundary> that is never closed');
  assert.ok(regions.length >= 2, `${regions.length} boundaries, so the views and the modals are not both covered`);
  const outside = [];
  for (const name of names) {
    const uses = [...app.matchAll(new RegExp(`<${name}[\\s/>]`, 'g'))].map((m) => m.index);
    assert.ok(uses.length, `${name} is declared lazy and never rendered, so this pin cannot see it`);
    for (const at of uses) if (!regions.some(([from, to]) => at > from && at < to)) outside.push(`${name} at line ${app.slice(0, at).split('\n').length}`);
  }
  assert.deepEqual(outside, [], 'rendered outside every ChunkBoundary');
});

// Fix round: the modals stood in one boundary, so one modal whose file did not arrive hid every other modal
// until a reload. They stand each in a boundary and a Suspense of their own now (`each`); the browser check's
// chunk-missing step opens Check design while BlueprintModal's file is missing.
test('each modal stands in a boundary of its own, so one missing file leaves the others working', () => {
  const app = read('./src/App.tsx');
  assert.deepEqual([...app.matchAll(/<ChunkBoundary\b[^>]*>/g)].map((m) => m[0]), ['<ChunkBoundary key={activeView}>', '<ChunkBoundary floating each>']);
  const src = read('./src/components/ChunkBoundary.tsx');
  assert.match(src, /type Props = \{ children: React\.ReactNode; floating\?: boolean; each\?: boolean \};/);
  assert.match(src, /if \(!this\.state\.failed && this\.props\.each\) \{\n\s+return React\.Children\.map\(this\.props\.children, \(child\) => \(child == null \|\| typeof child === 'boolean' \? null : \(\n\s+<ChunkBoundary floating=\{this\.props\.floating\}>\n\s+<React\.Suspense fallback=\{null\}>\{child\}<\/React\.Suspense>\n\s+<\/ChunkBoundary>/);
});
