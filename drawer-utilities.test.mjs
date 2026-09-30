import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The Audit and ROAS Forecaster drawers are written in utility classes and Jourvance has no
// Tailwind, so both rendered as raw text. Their classes now come from a stylesheet this repo
// generates (scripts/build-drawer-css.mjs). These checks keep it from drifting back: a class the
// generator does not know, or a stylesheet older than the drawers, fails here.

const { generate, buildCss, classTokens, OUTPUT_FILE, DRAWER_FILES, SCOPE } = await import('./scripts/build-drawer-css.mjs');

test('every class the two drawers use is one the generator knows', () => {
  assert.deepEqual(generate().unknown, []);
});

test('the committed stylesheet is the generated one (rerun the script after editing a drawer)', () => {
  assert.equal(fs.readFileSync(OUTPUT_FILE, 'utf8'), generate().css);
});

test('each drawer carries the scope class on its root and imports the stylesheet', () => {
  for (const file of DRAWER_FILES) {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, new RegExp(`className="${SCOPE} fixed inset-0`), file);
    assert.match(src, /import '\.\.\/\.\.\/styles\/drawerUtilities\.css';/, file);
  }
});

test('an unknown class is reported, never guessed', () => {
  const { unknown, css } = buildCss(new Set(['flex', 'grid-cols-banana', 'wobble:flex', 'bg-chartreuse-500']));
  assert.deepEqual(unknown, ['bg-chartreuse-500', 'grid-cols-banana', 'wobble:flex']);
  assert.match(css, /\.jv-utility \.flex, \.jv-utility\.flex \{ display: flex; \}/);
});

test('every rule is scoped to the drawers, so nothing else on the page changes', () => {
  const css = fs.readFileSync(OUTPUT_FILE, 'utf8');
  const selectors = css.split('\n')
    .map(l => l.trim())
    .filter(l => l.includes('{') && !l.startsWith('@') && !l.startsWith('/*'));
  assert.ok(selectors.length > 200);
  for (const line of selectors) {
    const list = line.slice(0, line.indexOf('{')).split(',').map(s => s.trim());
    for (const sel of list) assert.ok(sel.startsWith(`.${SCOPE}`) || /^(from|to|\d+%)/.test(sel), `unscoped: ${sel}`);
  }
});

test('variants and breakpoints come out as real selectors and media queries', () => {
  const { css } = buildCss(new Set(['hover:bg-slate-800', 'md:grid-cols-12', 'space-y-4', 'bg-slate-900/60']));
  assert.match(css, /\.jv-utility \.hover\\:bg-slate-800:hover/);
  assert.match(css, /@media \(min-width: 768px\) \{\n {2}\.jv-utility \.md\\:grid-cols-12/);
  assert.match(css, /\.space-y-4 > :not\(\[hidden\]\) ~ :not\(\[hidden\]\) \{ margin-top: 1rem; \}/);
  assert.match(css, /background-color: rgb\(15 23 42 \/ 0\.6\)/);
});

test('hidden and block are known, and md: brings back what hidden removed', () => {
  const { css, unknown } = buildCss(new Set(['hidden', 'block', 'md:flex', 'md:block', 'md:hidden']));
  assert.deepEqual(unknown, []);
  const hiddenRule = css.indexOf('.jv-utility .hidden, .jv-utility.hidden { display: none; }');
  const media = css.indexOf('@media (min-width: 768px) {');
  assert.ok(hiddenRule !== -1, 'the bare hidden rule');
  assert.ok(media !== -1 && hiddenRule < media, 'hidden comes before the md block, so md: wins from 768');
  const after = css.slice(media);
  assert.match(after, /\.md\\:flex, \.jv-utility\.md\\:flex \{ display: flex; \}/);
  assert.match(after, /\.md\\:hidden, \.jv-utility\.md\\:hidden \{ display: none; \}/);
});

test('keyboard focus shows a ring in the drawers, even on a control written with outline-none', () => {
  // focus:outline-none and outline-none sit later in the sheet and match with more specificity, so
  // a ring without !important vanished on every focused input in the Forecaster.
  const { css } = buildCss(new Set(['outline-none', 'focus:outline-none']));
  assert.match(css, /\.jv-utility :focus-visible \{ outline: 2px solid rgb\(129 140 248\) !important; outline-offset: 2px !important; \}/);
  const ring = css.indexOf('.jv-utility :focus-visible');
  assert.ok(ring !== -1 && ring < css.indexOf('.jv-utility .focus\\:outline-none:focus'), 'the ring rule is written, and it wins by !important');
});

test('the drawers render no text under 11px, and the sheet keeps no rule for it', () => {
  for (const file of DRAWER_FILES) {
    const small = [...fs.readFileSync(file, 'utf8').matchAll(/text-\[(\d+)px\]/g)].filter(m => Number(m[1]) < 11);
    assert.deepEqual(small.map(m => m[0]), [], file);
  }
  assert.ok(!/font-size: (?:[0-9]|10)px/.test(fs.readFileSync(OUTPUT_FILE, 'utf8')));
});

test('classes written in a ternary or && branch are collected, comparison operands are not', () => {
  // The ${...} parts of a className template were blanked, so every conditional class (the
  // Aggressive Scale pressed state, the dimmed off cards, the loss tint) had no rule and --check
  // still said current.
  const src = "<b className={`px-2 ${mode === 'aggressive' ? 'bg-purple-500/20 text-purple-300' : \"opacity-75\"} ${on && 'bg-rose-500'}`} />";
  const tokens = classTokens(src);
  for (const t of ['px-2', 'bg-purple-500/20', 'text-purple-300', 'opacity-75', 'bg-rose-500']) assert.ok(tokens.has(t), t);
  assert.ok(!tokens.has('aggressive'), 'a comparison operand is not a class');
});

test('the conditional classes the drawers use have rules in the committed stylesheet', () => {
  const css = fs.readFileSync(OUTPUT_FILE, 'utf8');
  const rule = cls => `.${SCOPE} .${cls.replace(/([:/.[\]])/g, '\\$1')}${cls.startsWith('hover:') ? ':hover' : ''},`;
  for (const cls of ['bg-purple-500/20', 'text-purple-300', 'border-purple-500/40', 'opacity-75', 'bg-rose-500',
    'bg-rose-950/30', 'bg-slate-950/30', 'bg-amber-950/20', 'hover:to-teal-300', 'hover:from-emerald-400', 'hover:text-slate-200']) {
    assert.ok(css.includes(rule(cls)), `no rule for ${cls}`);
  }
});
