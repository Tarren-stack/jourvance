import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// At 390px the ROAS Forecaster had no phone rules: the header and presets bar were single rows
// that never wrapped, and both columns kept their own scroll after the grid went to one column.
// The fix is class strings on one breakpoint (md, 768px), so these checks pin the class strings.
// Every attribute below is a plain literal, because the drawer CSS generator reads only literals.

const SRC = fs.readFileSync('src/components/drawers/FinancialSimulatorDrawer.tsx', 'utf8');

/** Each className="..." literal in the source, with its token list and its index. */
function literalClassAttrs(src) {
  const out = [];
  const re = /className="([^"]*)"/g;
  let m;
  while ((m = re.exec(src))) out.push({ tokens: m[1].split(/\s+/).filter(Boolean), at: m.index });
  return out;
}

const ATTRS = literalClassAttrs(SRC);
const has = (attr, ...tokens) => tokens.every(t => attr.tokens.includes(t));
const lastBefore = (index, pick = () => true) => {
  const before = ATTRS.filter(a => a.at < index && pick(a));
  return before[before.length - 1];
};
const indexOfOnce = needle => {
  const i = SRC.indexOf(needle);
  assert.ok(i !== -1, `missing: ${needle}`);
  assert.equal(SRC.indexOf(needle, i + 1), -1, `more than one: ${needle}`);
  return i;
};

test('the title is text-base on a phone and text-lg from 768', () => {
  const title = lastBefore(indexOfOnce('>Funnel Economics & ROAS Forecaster</h2>'));
  assert.ok(has(title, 'text-base', 'md:text-lg'), title.tokens.join(' '));
  assert.ok(!title.tokens.includes('text-lg'));
});

test('decoration hides below 768 and returns at 768', () => {
  const icon = ATTRS.filter(a => has(a, 'from-emerald-500', 'w-10'));
  assert.equal(icon.length, 1);
  assert.ok(has(icon[0], 'hidden', 'md:flex'), icon[0].tokens.join(' '));
  assert.ok(!icon[0].tokens.includes('flex'));

  const badge = lastBefore(indexOfOnce('Pre-Flight Simulator'));
  assert.ok(has(badge, 'hidden', 'md:block'), badge.tokens.join(' '));

  const hidden = ATTRS.filter(a => a.tokens.includes('hidden'));
  for (const a of hidden) assert.ok(has(a, 'md:flex') || has(a, 'md:block'), a.tokens.join(' '));
  // The icon tile, the badge, the header Sync button and the footer Close.
  assert.equal(hidden.length, 4);
});

test('one Sync Canvas Prices button per layout, same handler', () => {
  assert.equal(SRC.split('onClick={handleSyncFromCanvas}').length - 1, 2);
  const spans = [...SRC.matchAll(/<span>Sync Canvas Prices<\/span>/g)].map(m => m.index);
  assert.equal(spans.length, 2);
  const buttons = spans.map(i => {
    const before = ATTRS.filter(a => a.at < i);
    // The last attribute is the RefreshCw icon's; the one before it is the button's.
    assert.ok(before[before.length - 1].tokens.includes('text-rose-400'));
    return before[before.length - 2];
  });
  const phone = buttons.filter(b => b.tokens.includes('md:hidden'));
  const desk = buttons.filter(b => has(b, 'hidden', 'md:flex'));
  assert.equal(phone.length, 1);
  assert.ok(!phone[0].tokens.includes('hidden'));
  assert.equal(desk.length, 1);
});

test('the presets bar stacks below 768 and its note is left-aligned there', () => {
  const bar = ATTRS.filter(a => has(a, 'bg-slate-950/60', 'border-b', 'justify-between'));
  assert.equal(bar.length, 1);
  assert.ok(has(bar[0], 'flex-col', 'md:flex-row', 'items-start', 'md:items-center'), bar[0].tokens.join(' '));

  const align = /^(md:)?text-(left|right|center)$/;
  const note = lastBefore(indexOfOnce('SCENARIO_PRESETS[activePreset].description'), a => a.tokens.some(t => align.test(t)));
  assert.ok(has(note, 'text-left', 'md:text-right'), note.tokens.join(' '));
  assert.ok(!note.tokens.includes('text-right'));
});

test('below 768 the body is the one scroll region', () => {
  const bare = ATTRS.filter(a => a.tokens.includes('overflow-y-auto'));
  assert.equal(bare.length, 1);
  assert.ok(bare[0].tokens.includes('md:grid-cols-12'));
  for (const col of ['md:col-span-5', 'md:col-span-7']) {
    const attrs = ATTRS.filter(a => a.tokens.includes(col));
    assert.equal(attrs.length, 1, col);
    assert.ok(attrs[0].tokens.includes('md:overflow-y-auto'), col);
    assert.ok(!attrs[0].tokens.includes('overflow-y-auto'), col);
  }
});

test('a figure never clips its pill', () => {
  const rows = ATTRS.filter(a => a.tokens.includes('items-baseline'));
  assert.equal(rows.length, 2);
  for (const r of rows) assert.ok(r.tokens.includes('flex-wrap'), r.tokens.join(' '));
  const heading = lastBefore(indexOfOnce('<span>Blended ROAS</span>'));
  assert.ok(heading.tokens.includes('flex-wrap'), heading.tokens.join(' '));
});

test('16px gutter below 768', () => {
  for (const a of ATTRS) assert.ok(!a.tokens.includes('px-6') && !a.tokens.includes('p-6'), a.tokens.join(' '));
  const gutters = ATTRS.filter(a => has(a, 'px-4', 'md:px-6') || has(a, 'p-4', 'md:p-6'));
  assert.equal(gutters.length, 6);
});

test('the X is named because it is the only close on a phone', () => {
  const x = indexOfOnce('<X className="w-5 h-5" />');
  const open = SRC.lastIndexOf('<button', x);
  const tag = SRC.slice(open, SRC.indexOf('>', open) + 1);
  assert.ok(tag.includes('aria-label="Close ROAS Forecaster"'), tag);

  const close = [...SRC.matchAll(/<button([^>]*)>\s*Close\s*<\/button>/g)];
  assert.equal(close.length, 1);
  const cls = /className="([^"]*)"/.exec(close[0][1]);
  assert.ok(cls, 'the footer Close has a literal className');
  const tokens = cls[1].split(/\s+/);
  assert.ok(tokens.includes('hidden') && tokens.includes('md:block'), cls[1]);
});

// R21: check:canvas held three Forecaster findings in its baseline. The sliders were 6px tall
// inputs and the text-xs price fields 22px, so at 390px the order bump pair sat under 24px and too
// close to its neighbours (WCAG 2.5.8); and from 768px the results column scrolled on its own with
// nothing in it that takes focus, so a keyboard user could not scroll it.

/** Each <input .../> tag in the source. */
const INPUTS = [...SRC.matchAll(/<input\b[\s\S]*?\/>/g)].map(m => m[0]);
const classOf = tag => (/className="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/).filter(Boolean);

test('every slider is a 24px target that draws its 6px track in the middle', () => {
  const sliders = INPUTS.filter(t => t.includes('type="range"'));
  assert.equal(sliders.length, 10);
  for (const t of sliders) {
    assert.ok(t.includes('style={SLIDER_STYLE}'), t);
    assert.ok(!classOf(t).some(c => /^h-/.test(c)), `a height class would fight the style: ${t}`);
  }
  const style = /const SLIDER_STYLE[^=]*=\s*\{([\s\S]*?)\};/.exec(SRC);
  assert.ok(style, 'SLIDER_STYLE is declared');
  const height = Number(/height:\s*(\d+)/.exec(style[1])?.[1]);
  assert.ok(height >= 24, `slider height ${height}`);
  assert.match(style[1], /center \/ 100% 6px no-repeat/);
});

test('every number field is at least 24px tall', () => {
  // text-xs is a 16px line and text-sm (inherited from its row) a 20px one; with a 1px border
  // each side, py-0.5 leaves a text-xs field at 22px, so text-xs needs py-1.
  const fields = INPUTS.filter(t => t.includes('type="number"'));
  assert.equal(fields.length, 10);
  for (const t of fields) {
    const cls = classOf(t);
    if (cls.includes('text-xs')) assert.ok(cls.includes('py-1') && !cls.includes('py-0.5'), t);
  }
});

test('the results column takes focus so a keyboard user can scroll it', () => {
  const col = indexOfOnce('className="p-4 md:p-6 md:col-span-7 space-y-6 md:overflow-y-auto bg-slate-950/70"');
  const open = SRC.lastIndexOf('<div', col);
  const tag = SRC.slice(open, SRC.indexOf('>', col) + 1);
  assert.ok(tag.includes('tabIndex={0}'), tag);
  assert.ok(tag.includes('role="region"') && tag.includes('aria-label="Forecast results"'), tag);
});

test('check:canvas holds no Forecaster debt in its baseline', () => {
  const baseline = JSON.parse(fs.readFileSync('scripts/canvas-browser-check.baseline.json', 'utf8'));
  for (const [rule, entry] of Object.entries(baseline)) {
    assert.ok(!/forecaster/i.test(String(entry?.owner ?? '')), `${rule}: ${entry?.owner}`);
  }
});
