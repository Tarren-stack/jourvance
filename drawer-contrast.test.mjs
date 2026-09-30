import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// C32: the 31 color-contrast spots that scripts/canvas-browser-check.baseline.json held as known
// debt under #19. White on #6366F1 (4.47), white on #EC4899 (3.53), #EF4444 on its own red tint
// (4.49), #64748B on the dark panels (2.84 to 3.97), #818CF8 on its indigo tint (4.19) and the
// Forecaster's text-slate-500 (3.79 to 4.08) all sat under WCAG AA's 4.5 to 1 in the Ad, Form and
// Page editors, the line panel and the ROAS Forecaster.
//
// check:canvas measures the composited colours in Chrome and is the real proof; it needs a build
// and a browser, so this file pins the same spots in the source with the WCAG formula and the
// backdrops the check measured, plus a scan of every inline style that pairs a text colour with an
// opaque background, so a new white-on-pink button fails here before it reaches the ratchet.

const { contrastRatio, composite } = await import('./src/lib/a11yRules.ts');

const read = path => fs.readFileSync(path, 'utf8');
const D = 'src/components/drawers';
const AD = `${D}/AdEditor.tsx`;
const FORM = `${D}/FormEditor.tsx`;
const PAGE = `${D}/PageEditor.tsx`;
const LINE = `${D}/EdgeInspector.tsx`;
const FORECASTER = `${D}/FinancialSimulatorDrawer.tsx`;
const AA = 4.5;

/** '#RRGGBB', '#RGB', 'rgb(...)' or 'rgba(...)' to {r,g,b,a}; null for anything else. */
function color(input) {
  const s = String(input).trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}

const ratio = (fg, bg) => {
  const b = color(bg);
  return contrastRatio(composite(color(fg), b), b);
};

// ---- Inline style objects: brace, quote and comment aware ----

function skipBraces(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) return src.length; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return src.length;
}

/** The text of every `style={{ ... }}` object, with the line it starts on. */
function styleObjects(src) {
  const out = [];
  for (let at = src.indexOf('style={{'); at !== -1; at = src.indexOf('style={{', at + 1)) {
    const open = at + 'style={'.length;
    out.push({ start: at, line: src.slice(0, at).split('\n').length, body: src.slice(open + 1, skipBraces(src, open) - 1) });
  }
  return out;
}

/** The expression of a top-level property of an object body, or null. */
function prop(body, name) {
  const re = new RegExp(`(?:^|[,{\\s])${name}\\s*:`, 'g');
  for (let m = re.exec(body); m; m = re.exec(body)) {
    // Only a top-level key: no unclosed bracket or brace before it.
    const before = body.slice(0, m.index);
    const depth = [...before].reduce((d, c) => d + ('({['.includes(c) ? 1 : ')}]'.includes(c) ? -1 : 0), 0);
    if (depth !== 0) continue;
    let i = m.index + m[0].length;
    let d = 0;
    let q = null;
    for (; i < body.length; i++) {
      const c = body[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') q = c;
      else if ('({['.includes(c)) d++;
      else if (')}]'.includes(c)) d--;
      else if (c === ',' && d === 0) break;
    }
    return body.slice(m.index + m[0].length, i).trim();
  }
  return null;
}

/** A literal colour, or a `cond ? 'a' : 'b'` of two literals: { cond, values: [a, b] } or null. */
function colourChoices(expr) {
  if (expr === null) return null;
  const lit = /^'([^']*)'$/.exec(expr);
  if (lit) return { cond: null, values: [lit[1]] };
  const tern = /^(.+?)\s*\?\s*'([^']*)'\s*:\s*'([^']*)'$/s.exec(expr);
  if (tern) return { cond: tern[1].trim(), values: [tern[2], tern[3]] };
  return null;
}

/** Every [text, background, line] an inline style pairs, where the background is opaque. */
function inlinePairs(src) {
  const pairs = [];
  for (const { line, body } of styleObjects(src)) {
    const fg = colourChoices(prop(body, 'color'));
    const bg = colourChoices(prop(body, 'backgroundColor') ?? prop(body, 'background'));
    if (!fg || !bg) continue;
    const same = fg.cond && bg.cond && fg.cond === bg.cond;
    for (let i = 0; i < fg.values.length; i++) {
      const backs = same ? [bg.values[i]] : bg.cond && fg.cond ? [] : bg.values;
      for (const b of backs) {
        const f = color(fg.values[i]);
        const c = color(b);
        if (!f || !c || c.a < 1) continue;
        pairs.push({ fg: fg.values[i], bg: b, line });
      }
    }
  }
  return pairs;
}

test('every inline text colour on an opaque inline background reaches 4.5 to 1 in the five drawers', () => {
  const bad = [];
  for (const file of [AD, FORM, PAGE, LINE, FORECASTER]) {
    for (const p of inlinePairs(read(file))) {
      const r = ratio(p.fg, p.bg);
      if (r < AA) bad.push(`${file}:${p.line} ${p.fg} on ${p.bg} is ${r.toFixed(2)} to 1`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the scan sees the pairs it exists for (a positive control, so an empty list is not a dead parser)', () => {
  const planted = `<button style={{ backgroundColor: on ? '#6366F1' : 'transparent', color: on ? '#FFFFFF' : '#94A3B8' }} />
<div style={{ background: '#ec4899', color: '#FFFFFF', fontSize: '12px' }} />`;
  const pairs = inlinePairs(planted);
  assert.deepEqual(pairs.map(p => `${p.fg} on ${p.bg}`), ['#FFFFFF on #6366F1', '#FFFFFF on #ec4899']);
  assert.ok(pairs.every(p => ratio(p.fg, p.bg) < AA), 'both planted pairs fail AA');
  // And the real files do hold opaque pairs, so the clean scan above is not vacuous.
  assert.ok(inlinePairs(read(AD)).length >= 3);
  assert.ok(inlinePairs(read(PAGE)).length >= 4);
});

// ---- The spots on translucent or inherited backdrops, against what check:canvas measured ----

/** The literal colour on the `color:` line of the style that renders `anchor`. */
function colourNear(src, anchor, pick = v => v[0]) {
  const at = src.indexOf(anchor);
  assert.ok(at !== -1, `anchor not found: ${anchor}`);
  const obj = styleObjects(src).filter(o => o.start < at).pop();
  const choices = colourChoices(prop(obj.body, 'color'));
  assert.ok(choices, `no literal colour for ${anchor}`);
  return pick(choices.values);
}

const SPOTS = [
  // [label, file, anchor just after the style, how to pick the branch, measured backdrop]
  ['Form "type: text" rows', FORM, '>type: {f.type}<', v => v[0], '#1D2432'],
  ['Form "Required" toggle', FORM, "{f.required ? 'Required' : 'Optional'}", v => v[0], '#2B3158'],
  ['Form "Optional" toggle', FORM, "{f.required ? 'Required' : 'Optional'}", v => v[1], '#282F3C'],
  ['Page address prefix', PAGE, '>{pageHost}/p/</span>', v => v[0], '#0C111B'],
  ['Preview address bar', PAGE, "{pageHost}/p/{data.slug || 'offer'}", v => v[0], '#1E293B'],
  ['Line panel "Disconnect Step Connection"', LINE, 'Disconnect Step Connection', v => v[0], '#1E1B29']
];

for (const [label, file, anchor, pick, backdrop] of SPOTS) {
  test(`${label} reaches 4.5 to 1 on its measured backdrop ${backdrop}`, () => {
    const fg = colourNear(read(file), anchor, pick);
    const r = ratio(fg, backdrop);
    assert.ok(r >= AA, `${fg} on ${backdrop} is ${r.toFixed(2)} to 1`);
  });
}

test('the Forecaster labels check:canvas flagged use a slate that reaches 4.5 to 1 on their panels', () => {
  const src = read(FORECASTER);
  const css = read('src/styles/drawerUtilities.css');
  const slate = name => {
    const m = new RegExp(`\\.jv-utility \\.${name}[^{]*\\{ color: (rgb\\([^)]*\\))`).exec(css);
    assert.ok(m, `no rule for ${name} in drawerUtilities.css`);
    return m[1].replace(/ /g, ',').replace('rgb(,', 'rgb(');
  };
  // Each anchor with the darkest panel check:canvas measured behind it.
  const LABELS = [
    ['SCENARIO_PRESETS[activePreset].description', '#070D1F'],
    ['<span>$200</span>', '#090F21'],
    ['<span>$0.20</span>', '#090F21'],
    ['<span>0.5%</span>', '#090F21'],
    ['1-Click offer shown after checkout', '#090F21'],
    ['Offered to buyers who decline initial upsell', '#090F21'],
    ['Max allowable cost to acquire 1 buyer', '#070C1E'],
    ['CPC & {forecast.conversionRate}% CVR', '#070C1E'],
    ['$0 CAC', '#0E1629']
  ];
  const bad = [];
  for (const [anchor, backdrop] of LABELS) {
    const at = src.indexOf(anchor);
    if (at === -1) { bad.push(`anchor not found: ${anchor}`); continue; }
    const open = src.lastIndexOf('className="', at);
    const cls = src.slice(open, src.indexOf('"', open + 11));
    const tone = /text-slate-\d00/.exec(cls)?.[0];
    if (!tone) { bad.push(`${anchor}: no slate text colour`); continue; }
    const r = ratio(slate(tone), backdrop);
    if (r < AA) bad.push(`${anchor}: ${tone} on ${backdrop} is ${r.toFixed(2)} to 1`);
  }
  assert.deepEqual(bad, []);
});

test('no Forecaster text is text-slate-500, including the lines behind a toggle the check never opens', () => {
  // slate-500 reads 3.79 to 4.08 on every Forecaster panel. The one kept is the HelpCircle icon,
  // which needs 3 to 1 as a graphic, not 4.5.
  const src = read(FORECASTER);
  const tags = [...src.matchAll(/<(\w+)[^<>]*\btext-slate-500\b/g)].map(m => m[1]);
  assert.deepEqual(tags, ['HelpCircle']);
});

test('the check:canvas baseline no longer holds color-contrast debt', () => {
  const baseline = JSON.parse(read('scripts/canvas-browser-check.baseline.json'));
  assert.equal(baseline['color-contrast'], undefined);
  for (const [rule, entry] of Object.entries(baseline)) assert.ok(entry.count >= 1, `${rule} must be 1 or more, or removed`);
});
