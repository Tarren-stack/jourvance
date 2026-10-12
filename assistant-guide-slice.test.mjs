// Ask Jourvance, the app guide slice (server/assistantGuide.mjs, plan 3.6). The guide is split on its
// `## ` headings and the sections sharing the most words with the question are sent, heading words
// counted twice, ties in file order, at most GUIDE_SLICE_MAX_CHARS in all. A missing or empty guide
// answers [] and the assistant still answers. The fixture is inline: the real guide is written and
// tested elsewhere (assistant-guide.test.mjs), so these tests never depend on its wording.
// Dashes in this file are written as \u escapes so it carries none.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { splitGuideSections, guideSectionsFor, loadGuideSections, termsOf, stem } from './server/assistantGuide.mjs';
import { LIMITS } from './server/assistantContext.mjs';

const FIXTURE = `# Jourvance guide

Intro text that is not a section.

## Journey canvas and steps
Build your funnel on the canvas. Each step is a card. When the funnel is ready, publish it.
<!-- Read from: src/components/JourneyCanvas.tsx -->

## Email Studio
Write flows and broadcasts. Senders and the sending domain live here.
<!-- Read from: src/components/email/EmailStudio.tsx -->

## Publish and custom domains
Press Publish to put pages live. Each page gets an address.
<!-- Read from: src/components/PublishPanel.tsx -->

## Billing (Starter and Pro)
Starter is free. Pro adds more workspaces.

## Account and workspaces
Sign in with Google. A workspace holds one store.
`;

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmpDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-guide-')); dirs.push(d); return d; };

test('the guide splits into its five ## sections, without the title or the source comments', () => {
  const sections = splitGuideSections(FIXTURE);
  assert.deepEqual(sections.map((s) => s.heading), ['Journey canvas and steps', 'Email Studio', 'Publish and custom domains', 'Billing (Starter and Pro)', 'Account and workspaces']);
  assert.ok(!sections.some((s) => s.text.includes('Intro text')));
  assert.ok(!sections.some((s) => s.text.includes('<!--') || s.text.includes('Read from')));
  assert.equal(sections[2].text, '## Publish and custom domains\nPress Publish to put pages live. Each page gets an address.');
  assert.deepEqual(splitGuideSections(''), []);
  assert.deepEqual(splitGuideSections('# Title only\n\nNo sections.'), []);
});

test('a question about publishing picks the publish section first, because heading words count double', () => {
  const sections = splitGuideSections(FIXTURE);
  // The canvas section holds both "funnel" and "publish" in its body (score 2); the publish section
  // holds "publish" in its heading and body (score 3). Without the heading weight the canvas wins.
  const picked = guideSectionsFor('How do I publish my funnel?', sections);
  assert.equal(picked[0].heading, 'Publish and custom domains');
  assert.equal(picked[1].heading, 'Journey canvas and steps');
  assert.equal(picked.length, 2, 'a section that shares no word is never sent');
  assert.equal(guideSectionsFor('Publishing a page', sections)[0].heading, 'Publish and custom domains');
});

test('ties keep file order, max is honoured, and stop words alone match nothing', () => {
  const sections = splitGuideSections(FIXTURE);
  // "workspaces" sits in two sections: once in a body (Billing, earlier) and once in a heading.
  assert.deepEqual(guideSectionsFor('workspaces', sections).map((s) => s.heading), ['Account and workspaces', 'Billing (Starter and Pro)']);
  const tie = splitGuideSections('## Alpha\nmug glaze\n\n## Beta\nmug glaze\n\n## Gamma\nmug glaze\n\n## Delta\nmug glaze');
  assert.deepEqual(guideSectionsFor('mug glaze', tie).map((s) => s.heading), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(guideSectionsFor('mug glaze', tie, 2).map((s) => s.heading), ['Alpha', 'Beta']);
  assert.deepEqual(guideSectionsFor('how do I do it and what is the', sections), []);
  assert.deepEqual(guideSectionsFor('', sections), []);
  assert.deepEqual(guideSectionsFor('publish', null), []);
  assert.equal(stem('publishing'), 'publish');
  assert.equal(stem('publishes'), 'publish');
  assert.equal(stem('pages'), 'page');
  assert.ok(!termsOf('How do I publish in Jourvance?').has('jourvance'));
});

test('the slice never passes GUIDE_SLICE_MAX_CHARS', () => {
  const long = (h) => `## ${h} pricing\n${'Pricing words and more pricing words for the plan. '.repeat(120)}`;
  const sections = splitGuideSections([long('One'), long('Two'), long('Three')].join('\n\n'));
  assert.ok(sections.every((s) => s.text.length > 5000));
  const picked = guideSectionsFor('pricing', sections);
  const total = picked.reduce((n, s) => n + s.text.length, 0);
  assert.ok(total <= LIMITS.GUIDE_SLICE_MAX_CHARS, String(total));
  assert.ok(total > LIMITS.GUIDE_SLICE_MAX_CHARS - 400, 'the room is used, not wasted');
  assert.equal(picked[0].heading, 'One pricing');
});

test('a missing or empty guide file answers [], and a guide is read from disk once', () => {
  const dir = tmpDir();
  assert.deepEqual(loadGuideSections(path.join(dir, 'missing.md')), []);
  assert.deepEqual(loadGuideSections(''), []);
  assert.deepEqual(loadGuideSections(undefined), []);
  const empty = path.join(dir, 'empty.md');
  fs.writeFileSync(empty, '');
  assert.deepEqual(loadGuideSections(empty), []);

  const file = path.join(dir, 'guide.md');
  fs.writeFileSync(file, FIXTURE);
  const first = loadGuideSections(file);
  assert.equal(first.length, 5);
  fs.writeFileSync(file, '## Changed\nOther words.');
  assert.equal(loadGuideSections(file), first, 'the second call answers the first read');

  // A guide written after a missing read is picked up: a miss is not remembered.
  const later = path.join(dir, 'later.md');
  assert.deepEqual(loadGuideSections(later), []);
  fs.writeFileSync(later, FIXTURE);
  assert.equal(loadGuideSections(later).length, 5);
});
