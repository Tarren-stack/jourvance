// T03 follow-up. Zoomed out, a handle's hit area reaches well into its card, so a tap meant for the
// card can arm React Flow's click-to-connect, and the next tap on another dot then asks to replace a
// line. React Flow offers no way to drop an armed dot but finishing the line. These pin that the map
// names the armed line and drops it on Escape, a tap on the empty map or Dismiss. The canvas is JSX,
// which node cannot load, so these are source pins; t03fin/twotaps.mjs drives it in a browser.
// The second half pins that the browser check's line-words rule matches the unit test's (T09).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const canvas = fs.readFileSync('src/components/canvas/JourneyCanvas.tsx', 'utf8');
const script = fs.readFileSync('scripts/a11y-browser-check.mjs', 'utf8');

const between = (src, from, to) => {
  const at = src.indexOf(from);
  assert.ok(at >= 0, from);
  return src.slice(at, src.indexOf(to, at));
};

test('the watcher renders inside ReactFlow, where the store is', () => {
  const flow = between(canvas, '<ReactFlow\n', '</ReactFlow>');
  assert.match(flow, /<ClickConnectCancel cancelRef=\{cancelClickConnect\} onArmed=\{showConnectingNotice\} onDropped=\{dropConnectingNotice\} \/>/);
});

test('Escape drops an armed dot without stopping the key', () => {
  const body = between(canvas, 'function ClickConnectCancel(', '\nexport const JourneyCanvas');
  assert.match(body, /store\.setState\(\{ connectionClickStartHandle: null \}\)/);
  assert.match(body, /e\.key === 'Escape'/);
  assert.match(body, /addEventListener\('keydown', onKey, true\)/);
  assert.match(body, /removeEventListener\('keydown', onKey, true\)/);
  assert.ok(!/stopPropagation|preventDefault/.test(body), 'the same Escape still closes the panel');
  // Armed and dropped are read from the store, so every path that ends a line clears the notice.
  assert.match(body, /if \(now\) armed\.current\(/);
  assert.match(body, /else dropped\.current\(\)/);
});

test('a tap on the empty map and Dismiss drop it too', () => {
  assert.match(between(canvas, 'const handlePaneClick = useCallback(', '}, ['), /cancelClickConnect\.current\(\)/);
  assert.match(between(canvas, 'const dismissRuleNotice = () => {', '};'), /tone === 'connecting'\) cancelClickConnect\.current\(\)/);
  // Only the waiting notice is cleared when the line ends; a refusal from the second tap stays.
  assert.match(canvas, /setRuleNotice\(n => \(n\?\.tone === 'connecting' \? null : n\)\)/);
});

test('the waiting notice names the step, lets taps through, and reads plainly', () => {
  const show = between(canvas, 'const showConnectingNotice = useCallback(', '[nodeMap]');
  assert.match(show, /stepShortName\(node\.data\)/);
  assert.match(show, /press Escape to cancel\./);
  assert.ok(!/—| – /.test(show));
  assert.match(canvas, /pointerEvents: ruleNotice\.tone === 'connecting' \? 'none' : 'auto'/);
  assert.match(canvas, /onClick=\{dismissRuleNotice\} style=\{\{[^}]*pointerEvents: 'auto' \}\}/);
});

test("the browser check's line words end like describeEdge's sentences", () => {
  const src = script.match(/^const LINE_WORDS = (\/.+\/);$/m)?.[1];
  const stop = script.match(/^const DOUBLE_STOP = (\/.+\/);$/m)?.[1];
  assert.ok(src && stop);
  const LINE_WORDS = new Function(`return ${src}`)();
  const DOUBLE_STOP = new Function(`return ${stop}`)();
  const ok = [
    'Next step: from Landing page /vip-consultation to Lead form "Where should we reach you?" No visits measured yet.',
    'Next step: from Ad to Landing page /vip. No visits measured yet.',
    'Declined or left: from Offer to Sequence Win them back! No visits measured yet.'
  ];
  for (const t of ok) {
    assert.ok(LINE_WORDS.test(t), t);
    assert.ok(!DOUBLE_STOP.test(t), t);
  }
  assert.ok(!LINE_WORDS.test('Next step: from Ad to Page No visits measured yet.'));
  assert.ok(DOUBLE_STOP.test('Next step: from Ad to Form "Why?". No visits measured yet.'));
  assert.match(script, /if \(DOUBLE_STOP\.test\(p\.desc\)\) f\.push\(/);
});
