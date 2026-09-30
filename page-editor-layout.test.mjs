import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// Source-text pins for the page editor's layout and its AI path. Node's type stripping cannot load
// a .tsx file (JSX), so the behaviour lives in src/lib/pageCopyProposal.ts and
// src/lib/pageEditorSections.ts, and these only pin how PageEditor.tsx wires them. They anchor on
// the editor's own comment markers and id expressions: rename those and update the pins.

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const EDITOR = './src/components/drawers/PageEditor.tsx';
const SECTION = './src/components/drawers/EditorSection.tsx';
const CARD = './src/components/drawers/CopyProposalCard.tsx';
const editor = read(EDITOR);

function settingsBranch() {
  const anchor = "{editorTab === 'preview' ? (";
  const at = editor.indexOf(anchor);
  assert.ok(at > 0, 'the preview/settings branch is where it was');
  return editor.slice(at);
}

test('the four copy inputs come first, in order, before any section', () => {
  const src = settingsBranch();
  const at = key => src.indexOf(`id={PAGE_FIELD_IDS.${key}}`);
  const positions = ['headline', 'subhead', 'buttonText', 'slug'].map(at);
  for (const p of positions) assert.ok(p > 0, 'every copy input carries its PAGE_FIELD_IDS id');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'headline, subhead, button text, then address');
  const firstSection = src.indexOf('<EditorSection');
  const shopify = src.indexOf('Shopify Product Link');
  assert.ok(firstSection > 0 && shopify > 0);
  for (const p of positions) {
    assert.ok(p < firstSection, 'copy inputs sit above the first section');
    assert.ok(p < shopify, 'copy inputs sit above the Shopify block');
  }
});

test('exactly five sections hold everything that is not page words', () => {
  const count = (editor.match(/<EditorSection\b/g) || []).length;
  assert.equal(count, 5);
  const firstSection = editor.indexOf('<EditorSection');
  for (const marker of ['Shopify Product Link', 'A/B Split Testing', 'Urgency & Scarcity', 'COMPLIANCE', 'Live Funnel Hosting']) {
    const at = editor.indexOf(marker);
    assert.ok(at > firstSection, `${marker} sits inside a section`);
  }
});

test('the AI path asks before it writes', () => {
  assert.doesNotMatch(editor, /\brequestAICopy\b(?!Answer)/, 'no call to the silent-fallback client');
  assert.match(editor, /\brequestAICopyAnswer\b/);
  assert.doesNotMatch(editor, /copy\.(headline|subhead|cta) \|\| data\./, 'no direct overwrite from an AI answer');
  assert.doesNotMatch(editor, /activeVariantTab === 'b' \?/, 'a hidden version B is never edited');
  assert.ok(!editor.includes('AI Angle'));
});

test('the new components live at module scope in their own files', () => {
  assert.ok(existsSync(new URL(SECTION, import.meta.url)));
  const section = read(SECTION);
  assert.match(section, /export const EditorSection\b|export function EditorSection\b/);
  for (const attr of ['aria-expanded', 'aria-controls', 'aria-labelledby', 'useId']) {
    assert.ok(section.includes(attr), `EditorSection uses ${attr}`);
  }
  assert.ok(existsSync(new URL(CARD, import.meta.url)));
  assert.ok(read(CARD).includes("'Escape'"));
  assert.doesNotMatch(editor, /const EditorSection\b/);
  assert.doesNotMatch(editor, /function CopyProposalCard\b/);
  assert.doesNotMatch(editor, /const use[A-Z]/, 'event handlers are not named like hooks');
});

test('the inspector ties the editor to its step, and the raw client has no fallback copy', () => {
  const inspector = read('./src/components/drawers/NodeInspector.tsx');
  const pageEditor = inspector.slice(inspector.indexOf('<PageEditor'));
  assert.ok(pageEditor.slice(0, pageEditor.indexOf('/>')).includes('nodeId={node.id}'));

  const hub = read('./src/lib/hubClient.ts');
  const start = hub.indexOf('export async function requestAICopyAnswer');
  assert.ok(start >= 0, 'requestAICopyAnswer exists');
  const next = hub.indexOf('export ', start + 10);
  const body = hub.slice(start, next < 0 ? undefined : next);
  assert.doesNotMatch(body, /headline:/);
});

test('no em dash or spaced en dash, no dead Tailwind spinner, no hard-coded host', () => {
  for (const p of [EDITOR, SECTION, CARD, './src/lib/pageCopyProposal.ts', './src/lib/pageEditorSections.ts']) {
    assert.ok(existsSync(new URL(p, import.meta.url)), `${p} exists`);
    const src = read(p);
    assert.ok(!src.includes('—'), `${p} has no em dash`);
    assert.doesNotMatch(src, /\s–\s/, `${p} has no spaced en dash`);
  }
  assert.ok(!editor.includes('animate-spin'));
  assert.ok(!editor.includes('jourvance.app/p/'));
});

// C17: #17's words-first order held inside PageEditor, but the inspector put the Publish status
// card and the Comes from / Leads to list above the whole editor, which pushed Headline to Page
// address below the fold (headline at y 841 against a 720 or 900 tall window). A page step now
// opens on its editor, and every other step keeps its status and connections first.
test('a page step opens on its words, above its publish status and connections', () => {
  const inspector = read('./src/components/drawers/NodeInspector.tsx');
  const body = inspector.slice(inspector.indexOf('{/* Panel body */}'));
  assert.ok(body.length < inspector.length, 'the panel body marker is where it was');
  const at = s => {
    const i = body.indexOf(s);
    assert.ok(i >= 0, `${s} is in the panel body`);
    return i;
  };
  const page = at('<PageEditor');
  const status = at('<StepPublishPanel');
  const connections = at('{navigation}');
  assert.ok(page < status && status < connections, 'PageEditor, then Publish status, then connections');
  // Rendered once each: a second copy lower down would show a page step its status twice.
  assert.equal(body.split('<StepPublishPanel').length, 2);
  assert.equal(body.split('{navigation}').length, 2);
  for (const other of ['<AdEditor', '<FormEditor', '<SequenceEditor', '<ThankYouEditor', '<UpsellEditor', '<AbSplitEditor']) {
    assert.ok(at(other) > connections, `${other} still follows the status and connections`);
  }
});
