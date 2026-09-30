// One rule for calling a split (finding C23). The split card named a leader and printed a lift
// once one branch had 5 visits, the landing page's variant pod named one with no minimum at all,
// and the split editor beside them read "0% Confidence" for a test it never ran. All three now
// read journeyMetrics' splitTest: below MIN_SPLIT_BRANCH_SAMPLE visitors in each branch nobody
// names a leader or a lift, and the confidence reads Unavailable, never 0%.
//
// The real components are bundled with esbuild (already installed with Vite) and rendered with
// react-dom/server over the same figures, so the test reads what a person sees side by side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { splitTest, MIN_SPLIT_BRANCH_SAMPLE } from './src/lib/journeyMetrics.ts';
import { MIN_GRADE_SAMPLE } from './src/lib/conversionBenchmarks.ts';

const ROOT = new URL('.', import.meta.url).pathname;
const out = await build({
  stdin: {
    contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { ReactFlowProvider } from '@xyflow/react';
      import { AbSplitNode } from './src/components/canvas/nodes/AbSplitNode.tsx';
      import { PageNode } from './src/components/canvas/nodes/PageNode.tsx';
      import { AbSplitEditor } from './src/components/drawers/AbSplitEditor.tsx';
      import { CanvasMetricsContext } from './src/components/canvas/CanvasMetrics.tsx';
      const onCanvas = (metrics, el) => renderToStaticMarkup(
        React.createElement(ReactFlowProvider, null,
          React.createElement(CanvasMetricsContext.Provider, { value: metrics }, el)));
      export const splitCard = (metrics) => onCanvas(metrics,
        React.createElement(AbSplitNode, { id: 's1', data: { slug: 'x', splitRatio: 50 }, selected: false }));
      export const pageCard = (metrics) => onCanvas(metrics,
        React.createElement(PageNode, { id: 'p1', data: { slug: 'p', abTestingEnabled: true, splitRatio: 50 }, selected: false }));
      export const editor = (measure) => renderToStaticMarkup(
        React.createElement(AbSplitEditor, { data: { slug: 'x', splitRatio: 50 }, onChange() {}, measure }));`,
    resolveDir: ROOT,
    loader: 'tsx'
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }
});
const dir = mkdtempSync(join(tmpdir(), 'jv-split-call-'));
const file = join(dir, 'split-call.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { splitCard, pageCard, editor } = await import(pathToFileURL(file).href);
rmSync(dir, { recursive: true, force: true });

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/\s+/g, ' ');

/** Renders the split card, the page card and the editor over one set of branch figures. */
function sideBySide(va, ca, vb, cb) {
  const split = { branchAVisitors: va, branchAConversions: ca, branchBVisitors: vb, branchBConversions: cb, branchAGrossRevenue: null, branchBGrossRevenue: null };
  const page = { visitors: va + vb, conversions: ca + cb, variantAVisitors: va, variantAConversions: ca, variantBVisitors: vb, variantBConversions: cb };
  const metrics = { view: null, edges: {}, nodes: { s1: { measure: split, note: 'Measured, last 30 days' }, p1: { measure: page, note: 'Measured, last 30 days' } } };
  const pageHtml = pageCard(metrics);
  return {
    card: text(splitCard(metrics)),
    page: text(pageHtml),
    pageGreenBorders: (pageHtml.match(/border:1px solid rgba\(52, 211, 153, 0.4\)/g) || []).length,
    editor: text(editor(split))
  };
}

test('the split sample rule is the grade sample the playbook asks for', () => {
  assert.equal(MIN_SPLIT_BRANCH_SAMPLE, MIN_GRADE_SAMPLE);
});

test('splitTest does not run on missing figures, a thin branch or nothing to compare', () => {
  assert.deepEqual(splitTest(null, 1, 200, 2), { ran: false, reason: 'unmeasured' });
  assert.deepEqual(splitTest(200, null, 200, 2), { ran: false, reason: 'unmeasured' });
  assert.deepEqual(splitTest(6, 1, 5, 2), { ran: false, reason: 'too_few_visits' });
  // One thin branch is enough to stop it, however big the other is.
  assert.deepEqual(splitTest(5000, 50, MIN_SPLIT_BRANCH_SAMPLE - 1, 9), { ran: false, reason: 'too_few_visits' });
  assert.deepEqual(splitTest(200, 0, 200, 0), { ran: false, reason: 'nothing_to_compare' });
  assert.deepEqual(splitTest(200, 200, 150, 150), { ran: false, reason: 'nothing_to_compare' });
});

test('splitTest names the leader, its lift and the confidence once each branch has the sample', () => {
  const close = splitTest(200, 20, 200, 21);
  assert.equal(close.ran, true);
  assert.equal(close.leader, 'b');
  assert.equal(close.lift, 5);
  assert.equal(close.isSignificant, false);
  assert.equal(close.confidence, 13.1);

  const clear = splitTest(500, 15, 500, 45);
  assert.equal(clear.leader, 'b');
  assert.equal(clear.isSignificant, true);
  assert.ok(clear.pValue < 0.05);

  const aAhead = splitTest(300, 30, 300, 15);
  assert.equal(aAhead.leader, 'a');
  assert.equal(aAhead.lift, 100);

  const tie = splitTest(100, 10, 100, 10);
  assert.equal(tie.ran, true);
  assert.equal(tie.leader, null);
  assert.equal(tie.lift, null);
  assert.equal(tie.confidence, 0);

  // A leader over a branch with no conversions has no lift to print: there is no base.
  const noBase = splitTest(100, 5, 100, 0);
  assert.equal(noBase.leader, 'a');
  assert.equal(noBase.lift, null);
});

test('a thin split names no leader and no lift, and the editor never shows 0% confidence', () => {
  for (const [va, ca, vb, cb] of [[6, 1, 5, 2], [45, 5, 6, 3], [5, 0, 5, 1], [99, 5, 400, 60]]) {
    const at = `A ${va}/${ca}, B ${vb}/${cb}`;
    const { card, page, pageGreenBorders, editor: ed } = sideBySide(va, ca, vb, cb);
    assert.match(card, /Too few visits to call a leader/, `split card, ${at}`);
    assert.doesNotMatch(card, /Branch [AB] (leading|\+)/, `split card, ${at}`);
    assert.doesNotMatch(card, /% lift/, `split card, ${at}`);
    assert.match(page, /Too few visits to call a leader/, `page card, ${at}`);
    assert.doesNotMatch(page, /Variant [AB] leading/, `page card, ${at}`);
    assert.equal(pageGreenBorders, 0, `page card paints no variant as the leader, ${at}`);
    assert.match(ed, /Confidence Unavailable/, `editor, ${at}`);
    assert.doesNotMatch(ed, /\b0% Confidence|at 0% confidence|Z: 0\)/, `editor, ${at}`);
    assert.match(ed, new RegExp(`Too few visits in each branch to test yet\\. The test runs once both branches have ${MIN_SPLIT_BRANCH_SAMPLE} visitors\\.`), `editor, ${at}`);
  }
});

test('once the test runs, the cards and the editor agree on the leader', () => {
  const close = sideBySide(200, 20, 200, 21);
  assert.match(close.card, /Branch B \+5\.0% lift/);
  assert.match(close.page, /Variant B leading/);
  assert.equal(close.pageGreenBorders, 1);
  assert.match(close.editor, /13\.1% Confidence/);
  assert.match(close.editor, /Currently trending at 13\.1% confidence/);

  const clear = sideBySide(500, 15, 500, 45);
  assert.match(clear.card, /Branch B \+200\.0% lift/);
  assert.match(clear.page, /Variant B leading/);
  assert.match(clear.editor, /Statistically Significant Result/);
});

test('with nothing to compare the editor says why, and the cards name no leader', () => {
  const none = sideBySide(150, 0, 150, 0);
  assert.match(none.editor, /Confidence Unavailable/);
  assert.match(none.editor, /Neither branch has a conversion yet, so there is nothing to compare\./);
  assert.doesNotMatch(none.card, /leading|% lift/);
  assert.doesNotMatch(none.page, /Variant [AB] leading/);
});

test('unmeasured branches read Unavailable everywhere', () => {
  const { card, page, editor: ed } = (() => {
    const metrics = { view: null, edges: {}, nodes: {} };
    return { card: text(splitCard(metrics)), page: text(pageCard(metrics)), editor: text(editor(null)) };
  })();
  assert.match(card, /Unavailable/);
  assert.doesNotMatch(card, /leading|% lift|Too few visits/);
  assert.match(page, /No leader yet/);
  assert.match(ed, /Confidence Unavailable/);
  assert.match(ed, /Numbers for this split are unavailable\./);
});
