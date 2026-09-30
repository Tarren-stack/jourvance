import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// C04: every step's description says "Backspace deletes the selected step". React Flow's delete key
// removed the card and focus fell to the page body with nothing announced. The map now moves focus
// to #journey-map, says what went and how to undo it, and an undo says what came back.

const { deletedNotice, restoredNotice, focusFellWithDelete, isApplePlatform, undoKeys } = await import('./src/lib/deleteNotice.ts');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const code = p => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const DASHES = /—| – /;

const ad = { id: 'ad', data: { type: 'ad-source', platform: 'meta', label: 'Meta ad' } };
const page = { id: 'page', data: { type: 'landing-page', slug: 'vip-consultation', label: 'Landing' } };
const form = { id: 'form', data: { type: 'lead-form', label: 'Where should we reach you?' } };
const byId = new Map([ad, page, form].map(n => [n.id, n]));

test('one deleted step is named the way its card reads, with the undo keys', () => {
  const text = deletedNotice({ nodes: [ad], edges: [{ source: 'ad', target: 'page' }] }, byId, true);
  assert.match(text, /^Deleted Meta ad\. Press Command Z to undo\.$/);
  assert.doesNotMatch(deletedNotice({ nodes: [{ ...form, id: 'node-form-17' }] }, byId, true), /node-form-17/, 'never the node id');
  assert.match(deletedNotice({ nodes: [page] }, byId, false), /^Deleted Landing page \/vip-consultation\. Press Control Z to undo\.$/);
});

test('two steps are named, more are counted, and the lines that went with them are not listed', () => {
  assert.match(deletedNotice({ nodes: [ad, page], edges: [{ source: 'ad', target: 'page' }] }, byId, true), /^Deleted Meta ad and Landing page \/vip-consultation\. /);
  assert.match(deletedNotice({ nodes: [ad, page, form], edges: [] }, byId, true), /^Deleted 3 steps\. Press Command Z to undo\.$/);
});

test('a line on its own is named by the steps it joins', () => {
  assert.equal(deletedNotice({ nodes: [], edges: [{ source: 'ad', target: 'page' }] }, byId, true), 'Deleted the line from Meta ad to Landing page /vip-consultation. Press Command Z to undo.');
  assert.match(deletedNotice({ nodes: [], edges: [{ source: 'gone', target: 'page' }] }, byId, true), /from a step that is gone to/);
  assert.match(deletedNotice({ nodes: [], edges: [{ source: 'ad', target: 'page' }, { source: 'page', target: 'form' }] }, byId, false), /^Deleted 2 lines\. Press Control Z to undo\.$/);
  assert.equal(deletedNotice({ nodes: [], edges: [] }, byId, true), '');
});

test('an undo names what came back', () => {
  assert.equal(restoredNotice([ad]), 'Restored Meta ad.');
  assert.equal(restoredNotice([ad, page, form]), 'Restored 3 steps.');
  assert.equal(restoredNotice([]), '');
});

test('a name that ends in its own punctuation is not given a second full stop (R10)', () => {
  // "Where should we reach you?" read "you?. Press Command Z" and "Restored ... you?." aloud. A titled
  // step is its kind and its title in quotes inside a sentence (T09), the rule every map sentence shares.
  const asked = { id: 'asked', data: { type: 'lead-form', formTitle: 'Where should we reach you?' } };
  const cheer = { id: 'cheer', data: { type: 'follow-up-sequence', sequenceTitle: 'Welcome!' } };
  const quoted = { id: 'quoted', data: { type: 'lead-form', formTitle: 'Say \u201CHi!\u201D' } };
  const names = new Map([ad, asked, cheer, quoted].map(n => [n.id, n]));
  assert.equal(deletedNotice({ nodes: [asked], edges: [] }, names, true), 'Deleted Lead form "Where should we reach you?" Press Command Z to undo.');
  assert.equal(restoredNotice([asked]), 'Restored Lead form "Where should we reach you?"');
  assert.match(deletedNotice({ nodes: [ad, cheer], edges: [] }, names, false), /and Nurture sequence "Welcome!" Press Control Z to undo\.$/);
  assert.match(restoredNotice([ad, cheer]), /"Welcome!"$/);
  assert.equal(deletedNotice({ nodes: [], edges: [{ source: 'ad', target: 'asked' }] }, names, true), 'Deleted the line from Meta ad to Lead form "Where should we reach you?" Press Command Z to undo.');
  assert.equal(deletedNotice({ nodes: [], edges: [{ source: 'asked', target: 'ad' }] }, names, true), 'Deleted the line from Lead form "Where should we reach you?" to Meta ad. Press Command Z to undo.');
  assert.match(restoredNotice([quoted]), /\u201CHi!\u201D"$/, 'a closing quote after the mark still ends the sentence');
  for (const s of [
    deletedNotice({ nodes: [asked], edges: [] }, names, true),
    restoredNotice([asked]),
    deletedNotice({ nodes: [ad, cheer], edges: [] }, names, true),
    restoredNotice([ad, cheer]),
    restoredNotice([quoted])
  ]) assert.doesNotMatch(s, /[?!\u201D]\.|[?!] (?:to|and) /, s);
  // A name with no ending mark still gets its full stop.
  assert.equal(restoredNotice([ad]), 'Restored Meta ad.');
});

test('no sentence carries an em dash or a spaced en dash', () => {
  for (const s of [
    deletedNotice({ nodes: [ad] }, byId, true),
    deletedNotice({ nodes: [], edges: [{ source: 'ad', target: 'page' }] }, byId, false),
    restoredNotice([ad, page])
  ]) assert.doesNotMatch(s, DASHES, s);
});

test('undo keys follow the platform', () => {
  for (const p of ['MacIntel', 'iPhone', 'iPad', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)']) assert.equal(isApplePlatform(p), true, p);
  for (const p of ['Win32', 'Linux x86_64', '', null, undefined]) assert.equal(isApplePlatform(p), false, String(p));
  assert.equal(undoKeys(true), 'Command Z');
  assert.equal(undoKeys(false), 'Control Z');
});

test('focus moves only when it fell to the body or left with the card', () => {
  const body = {};
  assert.equal(focusFellWithDelete(null, body), true);
  assert.equal(focusFellWithDelete(body, body), true);
  assert.equal(focusFellWithDelete({ isConnected: false }, body), true);
  // Someone in the panel or the header keeps their place.
  assert.equal(focusFellWithDelete({ isConnected: true }, body), false);
});

test('the map handles React Flow\'s delete: notice, focus to the map, and the undo that brings a step back', () => {
  const canvas = code('src/components/canvas/JourneyCanvas.tsx');
  assert.match(canvas, /import \{ deletedNotice, restoredNotice, focusFellWithDelete, isApplePlatform \} from '\.\.\/\.\.\/lib\/deleteNotice'/);
  assert.match(canvas, /onDelete=\{handleDelete\}/);
  const handler = canvas.slice(canvas.indexOf('const handleDelete = useCallback('), canvas.indexOf('const commitConnection'));
  assert.match(handler, /setRuleNotice\(\{ tone: 'deleted', text \}\)/);
  // Focus waits for the card to leave the page, then goes to the map, never the body.
  assert.match(handler, /\.react-flow__node\[data-id=/);
  assert.match(handler, /focusFellWithDelete\(document\.activeElement, document\.body\)\) canvasRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  // The region the canvas focuses is the map landmark.
  assert.match(canvas, /<div ref=\{canvasRef\} tabIndex=\{-1\}\s+id="journey-map"/);
  // The deleted notice clears like the added one, in the always-mounted polite region.
  assert.match(canvas, /ruleNotice\?\.tone !== 'added' && ruleNotice\?\.tone !== 'deleted'/);
  assert.match(canvas, /deleted: '#[0-9A-F]{6}'/);
  // Undo: the restored step is announced and focused while focus is still on the map.
  assert.match(canvas, /setRuleNotice\(\{ tone: 'added', text: restoredNotice\(back\) \}\)/);
  assert.match(canvas, /active === canvasRef\.current \|\| focusFellWithDelete\(active, document\.body\)\) focusCard\(back\[0\]\.id\)/);
  assert.match(canvas, /if \(!deleted\.gone\) return;/);
});
