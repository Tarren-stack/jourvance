// C48: the grade pill in the line inspector ("Within typical range") sat directly above a sentence
// naming a different, unsourced range ("upsells average 12%–25%"), so a 10% take rate was called
// within range above a line saying typical is 12% to 25%. The sentence is now written from the same
// bands the grade uses. These tests drive the pure functions the inspector renders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { edgeMetricFor, edgeStatus, getStepOptimizationTips, typicalRangeText, MIN_GRADE_SAMPLE } from './src/lib/conversionBenchmarks.ts';

// The four line shapes that carry a grade, as edgeMetricFor names them.
const GRADED = [
  ['take', 'upsell', 'thank-you', 'accepted'],
  ['opt-in', 'landing-page', 'lead-form', null],
  ['conversion', 'landing-page', 'thank-you', null],
  ['sequence-click', 'follow-up-sequence', 'landing-page', null]
];

const measured = rate => ({ count: 1, denominator: Math.max(200, MIN_GRADE_SAMPLE), rate, basis: 'Measured' });
const percents = text => [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map(m => Number(m[1]));

test('every graded line states the range it is graded against, and no other figure', () => {
  for (const [id, source, target, handle] of GRADED) {
    const def = edgeMetricFor(source, target, handle, {});
    assert.equal(def.id, id);
    assert.ok(def.bands, `${id} has bands`);
    assert.ok(def.benchmarkDesc.includes(typicalRangeText(def.bands)), `${id} sentence names its own bands`);
    assert.deepEqual(percents(def.benchmarkDesc), [def.bands.poor, def.bands.top], `${id} names only poor and top`);
    assert.doesNotMatch(def.benchmarkDesc, /\baverage\b/i, `${id} makes no unsourced average claim`);
    assert.doesNotMatch(def.benchmarkDesc, /—| – /, `${id} has no em dash or spaced en dash`);
  }
});

test('the pill and the sentence under it agree at every edge of the range', () => {
  for (const [id, source, target, handle] of GRADED) {
    const def = edgeMetricFor(source, target, handle, {});
    const [low, high] = percents(def.benchmarkDesc);
    const within = rate => rate >= low && rate < high;
    // Just outside, on, and just inside each edge, plus the old contradicting cases' neighbourhood.
    for (const rate of [low - 0.1, low, low + 0.1, (low + high) / 2, high - 0.1, high, high + 0.1]) {
      const label = edgeStatus(def, measured(rate)).label;
      const expected = rate < low ? 'Below typical range' : within(rate) ? 'Within typical range' : 'Above typical range';
      assert.equal(label, expected, `${id} at ${rate}%: pill "${label}" beside "${def.benchmarkDesc}"`);
    }
  }
});

test('the reported cases no longer contradict their sentence', () => {
  for (const [rate, source, target, handle] of [[10, 'upsell', 'thank-you', 'accepted'], [13, 'landing-page', 'lead-form', null], [2.9, 'landing-page', 'thank-you', null], [7, 'follow-up-sequence', 'landing-page', null]]) {
    const def = edgeMetricFor(source, target, handle, {});
    assert.equal(edgeStatus(def, measured(rate)).label, 'Within typical range');
    const [low, high] = percents(def.benchmarkDesc);
    assert.ok(rate >= low && rate < high, `${rate}% sits inside the stated ${low}% to ${high}%`);
  }
});

test('the form playbook states no unsourced statistic', () => {
  for (const tip of getStepOptimizationTips('landing-page', 'lead-form')) {
    assert.doesNotMatch(tip.description, /~\s*\d/, `"${tip.title}" states an approximate statistic`);
  }
});

test('the line inspector shows the sentence from the metric table, not its own copy', () => {
  const src = readFileSync(new URL('./src/components/drawers/EdgeInspector.tsx', import.meta.url), 'utf8');
  assert.match(src, /\{def\.benchmarkDesc\}/);
  assert.doesNotMatch(src, /average \d/);
});
