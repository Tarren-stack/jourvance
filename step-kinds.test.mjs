import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Every card built its own icon tile, its own kind colour and its own selected border, and the
// minimap kept a third colour table that painted anything it did not name amber. So an upsell,
// a thank-you page and an A/B split all showed amber on the map, and selection was indigo on
// some cards, pink, green, amber or violet on others. src/lib/stepKinds.ts is now the one table
// for a step's colour and icon shape, and selection is one colour on every card.

const {
  STEP_KINDS, UNKNOWN_STEP, stepVariant, stepKind,
  SELECTION_COLOR, SELECTED_CARD_FRAME, cardFrame, withAlpha, iconTile
} = await import('./src/lib/stepKinds.ts');

const NODE_DIR = 'src/components/canvas/nodes';
const NODE_FILES = {
  'ad-source': 'AdNode.tsx', 'landing-page': 'PageNode.tsx', 'lead-form': 'FormNode.tsx',
  'follow-up-sequence': 'SequenceNode.tsx', 'thank-you': 'ThankYouNode.tsx', upsell: 'UpsellNode.tsx', 'ab-split': 'AbSplitNode.tsx'
};

const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('each type maps to its kind', () => {
  assert.equal(stepVariant('ad-source'), 'ad');
  assert.equal(stepVariant('landing-page'), 'page');
  assert.equal(stepVariant('lead-form'), 'form');
  assert.equal(stepVariant('thank-you'), 'thank-you');
  assert.equal(stepVariant('ab-split'), 'split');
  assert.equal(stepVariant('upsell', { offerType: 'downsell' }), 'downsell');
  assert.equal(stepVariant('upsell', {}), 'upsell');
  assert.equal(stepVariant('upsell'), 'upsell');
  const seq = (sequenceType) => stepVariant('follow-up-sequence', { sequenceType });
  assert.equal(seq('upsell_recovery'), 'upsell-rescue');
  assert.equal(seq('checkout_recovery'), 'cart-recovery');
  assert.equal(seq('at_risk_winback'), 'winback');
  assert.equal(seq('fulfillment_review'), 'review');
  assert.equal(seq('lead_nurture'), 'nurture');
  assert.equal(seq(undefined), 'nurture');
  assert.equal(seq('something_new'), 'nurture');
  assert.equal(seq('constructor'), 'nurture');
  assert.equal(stepVariant('follow-up-sequence'), 'nurture');
  assert.equal(stepVariant(undefined, { type: 'thank-you' }), 'thank-you');
  assert.equal(stepVariant('mystery'), null);
  assert.equal(stepVariant('constructor'), null);
  assert.deepEqual(stepKind('mystery'), UNKNOWN_STEP);
  assert.deepEqual(stepKind(undefined, undefined), UNKNOWN_STEP);
  assert.deepEqual(stepKind('landing-page', { canvasViewMode: 'roas', abTestingEnabled: true }), STEP_KINDS.page);
  assert.deepEqual(stepKind('ad-source', { canvasViewMode: 'roas' }), STEP_KINDS.ad);
});

test('the table keeps the colour each card already used', () => {
  assert.deepEqual(STEP_KINDS, {
    ad: { color: '#60A5FA', shape: 'circle' },
    page: { color: '#818CF8', shape: 'square' },
    form: { color: '#34D399', shape: 'square' },
    nurture: { color: '#FBBF24', shape: 'circle' },
    'upsell-rescue': { color: '#F59E0B', shape: 'circle' },
    'cart-recovery': { color: '#10B981', shape: 'circle' },
    winback: { color: '#8B5CF6', shape: 'circle' },
    review: { color: '#EC4899', shape: 'circle' },
    'thank-you': { color: '#F472B6', shape: 'square' },
    upsell: { color: '#10B981', shape: 'square' },
    downsell: { color: '#F59E0B', shape: 'square' },
    split: { color: '#A78BFA', shape: 'diamond' }
  });
  assert.deepEqual(UNKNOWN_STEP, { color: '#94A3B8', shape: 'square' });
});

test('shape means something', () => {
  const byShape = (shape) => Object.keys(STEP_KINDS).filter(k => STEP_KINDS[k].shape === shape).sort();
  assert.deepEqual(byShape('diamond'), ['split']);
  assert.deepEqual(byShape('circle'), ['ad', 'cart-recovery', 'nurture', 'review', 'upsell-rescue', 'winback']);
  assert.deepEqual(byShape('square'), ['downsell', 'form', 'page', 'thank-you', 'upsell']);

  const c = '#A78BFA';
  const diamond = iconTile('diamond', c);
  assert.equal(diamond.shape.transform, 'rotate(45deg)');
  assert.equal(diamond.glyph.transform, 'rotate(-45deg)');
  assert.equal(diamond.box.width, 28);
  assert.equal(diamond.box.height, 28);
  assert.equal(diamond.glyphSize, 12);
  const circle = iconTile('circle', c);
  assert.equal(circle.shape.borderRadius, '50%');
  assert.equal(circle.shape.transform, undefined);
  assert.equal(circle.glyph.transform, undefined);
  const square = iconTile('square', c);
  assert.equal(square.shape.borderRadius, 8);
  assert.equal(square.shape.transform, undefined);
  assert.equal(square.glyph.transform, undefined);
  for (const t of [circle, square]) {
    assert.equal(t.shape.width, 28);
    assert.equal(t.shape.height, 28);
    assert.equal(t.glyphSize, 15);
  }
  for (const t of [diamond, circle, square]) {
    assert.equal(t.shape.color, c);
    assert.equal(t.shape.background, 'rgba(167, 139, 250, 0.15)');
    assert.equal(t.shape.border, '1px solid rgba(167, 139, 250, 0.35)');
    assert.equal(t.box.flexShrink, 0);
  }
  assert.equal(withAlpha('#A78BFA', 0.15), 'rgba(167, 139, 250, 0.15)');
});

test("the item's regression: upsell, thank-you and A/B are three colours, none amber", () => {
  const colors = ['upsell', 'thank-you', 'ab-split'].map(t => stepKind(t, { offerType: 'upsell' }).color);
  assert.equal(new Set(colors).size, 3);
  assert.ok(!colors.includes('#F59E0B'), colors.join(', '));
});

test('one selection colour', () => {
  const css = fs.readFileSync('src/index.css', 'utf8');
  const primary = (css.match(/--color-primary:\s*(#[0-9A-Fa-f]{6})/) || [])[1];
  assert.ok(primary, '--color-primary not found in src/index.css');
  assert.equal(primary.toUpperCase(), SELECTION_COLOR.toUpperCase());
  for (const [k, v] of Object.entries(STEP_KINDS)) assert.notEqual(v.color.toUpperCase(), SELECTION_COLOR.toUpperCase(), k);
  for (const bg of ['#0F172A', '#0B0F19']) {
    const ratio = contrast(SELECTION_COLOR, bg);
    assert.ok(ratio >= 3, `selection is ${ratio.toFixed(2)}:1 on ${bg}`);
  }
  const resting = { border: '1px solid rgba(255, 255, 255, 0.1)', boxShadow: '0 10px 25px rgba(0, 0, 0, 0.4)' };
  assert.equal(cardFrame(true, resting), SELECTED_CARD_FRAME);
  assert.equal(cardFrame(false, resting), resting);
  assert.ok(SELECTED_CARD_FRAME.border.includes(SELECTION_COLOR));
  assert.equal(SELECTED_CARD_FRAME.border, '1.5px solid #6366F1');
  assert.ok(SELECTED_CARD_FRAME.boxShadow.includes('rgba(99, 102, 241'));
  for (const [k, v] of Object.entries(STEP_KINDS)) {
    for (const bg of ['#111827', '#0F172A']) {
      const ratio = contrast(v.color, bg);
      assert.ok(ratio >= 3, `${k} is ${ratio.toFixed(2)}:1 on ${bg}`);
    }
  }
});

// The root style={{ ... }} slice, read the way edge-kinds.test.mjs reads it.
const rootSlice = (src) => {
  const start = src.indexOf('style={{', src.indexOf('return ('));
  return { start, end: src.indexOf('\n      }}', start) };
};

test('every card reads the table', () => {
  for (const [type, file] of Object.entries(NODE_FILES)) {
    const src = fs.readFileSync(`${NODE_DIR}/${file}`, 'utf8');
    assert.match(src, /from '\.\.\/\.\.\/\.\.\/lib\/stepKinds'/, `${file} does not import stepKinds`);
    assert.ok(src.includes(`stepKind('${type}'`), `${file} does not call stepKind('${type}'`);
    assert.ok(src.includes('<StepIcon'), `${file} does not render <StepIcon`);
    assert.doesNotMatch(src, /width: '28px',\s*height: '28px'/, `${file} still builds its own 28px tile`);
    const calls = src.split('cardFrame(selected').length - 1;
    assert.equal(calls, 1, `${file} calls cardFrame(selected ${calls} times`);
    const { start, end } = rootSlice(src);
    assert.ok(start >= 0 && end > start, `${file}: root style not found`);
    const at = src.indexOf('cardFrame(selected');
    assert.ok(at > start && at < end, `${file}: cardFrame is not in the root style`);
    assert.doesNotMatch(src, /\bselected\s*\?/, `${file} still styles its own selected state`);
  }
});

// Each card's root evaluated for the state it reads, the way ad-card-style.test.mjs does it.
const ROOT_VARS = {
  'AdNode.tsx': { lit: [false, true], isRoasMode: [false, true] },
  'PageNode.tsx': { isAbActive: [false, true], isRoasMode: [false, true] },
  'FormNode.tsx': {},
  'SequenceNode.tsx': { borderColor: ['rgba(255, 255, 255, 0.1)', 'rgba(16, 185, 129, 0.35)'], isRetention: [false, true], themeColor: ['#10B981'] },
  'ThankYouNode.tsx': {},
  'UpsellNode.tsx': { isDownsell: [false, true] },
  'AbSplitNode.tsx': { winner: [undefined, 'A'] }
};
const combos = (vars) => Object.entries(vars).reduce(
  (acc, [k, values]) => acc.flatMap(c => values.map(v => ({ ...c, [k]: v }))), [{}]);
const evalRoot = (file, vars) => {
  const src = fs.readFileSync(`${NODE_DIR}/${file}`, 'utf8');
  const { start, end } = rootSlice(src);
  const body = src.slice(start + 'style={{'.length, end);
  const scope = { cardFrame, ...vars };
  return new Function(...Object.keys(scope), `return ({${body}\n});`)(...Object.values(scope));
};

test('selecting any card draws the same frame, and resting cards never use the selection colour', () => {
  for (const [file, vars] of Object.entries(ROOT_VARS)) {
    for (const c of combos(vars)) {
      const on = evalRoot(file, { ...c, selected: true });
      const off = evalRoot(file, { ...c, selected: false });
      const where = `${file} ${JSON.stringify(c)}`;
      assert.equal(on.border, SELECTED_CARD_FRAME.border, where);
      assert.equal(on.boxShadow, SELECTED_CARD_FRAME.boxShadow, where);
      assert.doesNotMatch(`${off.border} ${off.boxShadow}`, /6366F1|99, 102, 241/i, where);
    }
  }
});

test('the minimap reads the same table', () => {
  const src = fs.readFileSync('src/components/canvas/JourneyCanvas.tsx', 'utf8');
  const start = src.indexOf('<MiniMap');
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf('/>', start));
  assert.match(block, /stepKind\(/);
  assert.doesNotMatch(block, /#[0-9A-Fa-f]{6}/);
});

test('StepIcon draws its tile from iconTile and marks its shape', () => {
  const src = fs.readFileSync('src/components/canvas/StepIcon.tsx', 'utf8');
  assert.match(src, /iconTile\(/);
  assert.match(src, /data-step-shape=\{kind\.shape\}/);
  assert.match(src, /aria-hidden="true"/);
  const lib = fs.readFileSync('src/lib/stepKinds.ts', 'utf8');
  for (const line of lib.split('\n').filter(l => /^\s*import\b/.test(l))) {
    assert.match(line, /^\s*import type\b/, `stepKinds.ts has a value import: ${line}`);
  }
  assert.doesNotMatch(lib, /\benum\b|\bnamespace\b/);
});
