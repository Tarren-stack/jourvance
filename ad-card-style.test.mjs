// The ad card was the last canvas card styled with Tailwind class names, and Tailwind is not
// installed, so its root had square corners, visible overflow, a grab cursor and a width that
// followed its content (about 711 flow px with a long headline). Its hover could never have
// worked either, because the inline border and background beat any class rule. These tests read
// each card's literal root style straight from the source and evaluate it for given state, so the
// root stays a plain inline object like the other six cards and no style module is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { cardFrame, SELECTED_CARD_FRAME } = await import('./src/lib/stepKinds.ts');

const NODE_DIR = 'src/components/canvas/nodes';
const CARD_FILES = ['AdNode.tsx', 'PageNode.tsx', 'FormNode.tsx', 'SequenceNode.tsx', 'ThankYouNode.tsx', 'UpsellNode.tsx', 'AbSplitNode.tsx'];

// Evaluates the card's root style={{ ... }} literal (the same slice edge-kinds.test.mjs reads) for
// the given variable values. The one helper it may call is stepKinds' cardFrame, the shared
// selected state. A TS cast or any other helper call makes this throw, which is intended: the root
// stays a plain inline style.
export function readRootStyle(file, vars) {
  const src = fs.readFileSync(`${NODE_DIR}/${file}`, 'utf8');
  const start = src.indexOf('style={{', src.indexOf('return ('));
  const end = src.indexOf('\n      }}', start);
  assert.ok(start >= 0 && end > start, `${file}: root style literal not found`);
  const body = src.slice(start + 'style={{'.length, end);
  try {
    const scope = { cardFrame, ...vars };
    return new Function(...Object.keys(scope), `return ({${body}\n});`)(...Object.values(scope));
  } catch (err) {
    throw new Error(`${file}: root style is not a plain literal (${err.message})`);
  }
}

// lit is computed exactly as AdNode computes it.
function adStyle({ selected, hovered, isRoasMode }) {
  const lit = hovered && !selected;
  return readRootStyle('AdNode.tsx', { selected, lit, isRoasMode });
}

const STATES = [];
for (const selected of [false, true]) for (const hovered of [false, true]) for (const isRoasMode of [false, true]) {
  STATES.push({ selected, hovered, isRoasMode });
}
const label = (s) => `selected=${s.selected} hovered=${s.hovered} roas=${s.isRoasMode}`;

// A root with overflow hidden clips its own handles once it also becomes their containing block.
function clipsHandles(style) {
  if (style.overflow !== 'hidden') return false;
  if (['backdropFilter', 'WebkitBackdropFilter', 'filter', 'transform', 'willChange', 'contain'].some((k) => k in style)) return true;
  return ['relative', 'absolute', 'fixed', 'sticky'].includes(style.position);
}

test('the ad card has the same shell as the other cards', () => {
  for (const s of STATES) {
    const style = adStyle(s);
    assert.equal(style.width, '260px', label(s));
    assert.equal(style.borderRadius, '12px', label(s));
    assert.equal(style.overflow, 'hidden', label(s));
    assert.equal(style.color, '#FFFFFF', label(s));
    assert.equal(style.cursor, 'pointer', label(s));
    assert.equal(style.transition, 'all 0.2s ease', label(s));
  }
});

test('hover lifts the border in both views, and selection wins', () => {
  const edit = (selected, hovered) => adStyle({ selected, hovered, isRoasMode: false });
  const roas = (selected, hovered) => adStyle({ selected, hovered, isRoasMode: true });

  assert.equal(edit(false, false).border, '1px solid rgba(255, 255, 255, 0.1)');
  assert.equal(edit(false, true).border, '1px solid rgba(255, 255, 255, 0.2)');
  assert.equal(edit(false, false).background, 'rgba(15, 23, 42, 0.9)');
  assert.equal(edit(false, true).background, 'rgba(15, 23, 42, 0.95)');

  assert.equal(roas(false, false).border, '1px solid rgba(16, 185, 129, 0.3)');
  assert.equal(roas(false, true).border, '1px solid rgba(16, 185, 129, 0.5)');
  assert.equal(roas(false, true).background, roas(false, false).background);

  for (const view of [edit, roas]) {
    assert.deepEqual(view(true, true), view(true, false));
    assert.equal(view(true, false).border, '1.5px solid #6366F1');
    assert.equal(view(true, false).boxShadow, SELECTED_CARD_FRAME.boxShadow);
  }
});

test('hover changes colour, never geometry, and never clips', () => {
  const borderWidth = (style) => String(style.border).split(' ')[0];
  for (const isRoasMode of [false, true]) for (const selected of [false, true]) {
    const rest = adStyle({ selected, hovered: false, isRoasMode });
    const hover = adStyle({ selected, hovered: true, isRoasMode });
    const where = `roas=${isRoasMode} selected=${selected}`;
    assert.deepEqual(Object.keys(hover).sort(), Object.keys(rest).sort(), where);
    assert.equal(hover.width, '260px', where);
    assert.equal(hover.width, rest.width, where);
    assert.equal(hover.borderRadius, rest.borderRadius, where);
    assert.equal(borderWidth(hover), borderWidth(rest), where);
  }
  for (const s of STATES) {
    const style = adStyle(s);
    for (const key of ['transform', 'translate', 'scale', 'top', 'left', 'margin', 'padding', 'position']) {
      assert.ok(!(key in style), `${label(s)} has ${key}`);
    }
    assert.equal(clipsHandles(style), false, `${label(s)} clips its handles`);
  }
});

test('no card uses a class name that nothing styles', () => {
  for (const file of CARD_FILES) {
    const src = fs.readFileSync(`${NODE_DIR}/${file}`, 'utf8');
    const re = /className=/g;
    let m;
    while ((m = re.exec(src))) {
      const rest = src.slice(m.index + 'className='.length);
      const literal = rest.match(/^(?:"([^"]*)"|\{'([^']*)'\}|\{"([^"]*)"\})/);
      const line = src.slice(0, m.index).split('\n').length;
      assert.ok(literal, `${file}:${line} className is not a string literal`);
      const value = literal[1] ?? literal[2] ?? literal[3];
      assert.equal(value, 'custom-handle', `${file}:${line} className "${value}" is styled by nothing`);
    }
  }
});

test('the ad card root tracks the pointer', () => {
  const src = fs.readFileSync(`${NODE_DIR}/AdNode.tsx`, 'utf8');
  const ret = src.indexOf('return (');
  const opening = src.slice(ret, src.indexOf('style={{', ret));
  assert.match(opening, /onMouseEnter=\{\(\) => setHovered\(true\)\}/);
  assert.match(opening, /onMouseLeave=\{\(\) => setHovered\(false\)\}/);
  assert.doesNotMatch(opening, /className/);
  assert.ok(src.includes('React.useState(false)'));
  assert.ok(src.includes('const lit = hovered && !selected'));
});

test('no em dash on the ad card', () => {
  const src = fs.readFileSync(`${NODE_DIR}/AdNode.tsx`, 'utf8');
  assert.ok(!src.includes('—'), 'AdNode.tsx contains an em dash');
  assert.ok(!src.includes(' – '), 'AdNode.tsx contains a spaced en dash');
  assert.ok(src.includes("x` : 'No spend'"), "the ROAS cell should read 'No spend' when spend is 0");
});
