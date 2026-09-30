// The Store score in the journey toolbar (C27). Once a store is connected, Check design carries a
// "Store score N/100" pill about 113px wide, and the toolbar's width thresholds were measured without
// it: after one edit the row wrapped onto two lines at 1,720, 1,440, 1,280, 1,240 and 1,180px, the
// widths items 8, 18, 19 and 29 pin to one row. The pill now shows only where the row has room for
// it, and the compact and ribbon widths grow by its width while it shows. The button's name and title
// say the score exactly where the pill shows it (R07): the name used to carry it at every width, so a
// screen reader heard "store score 0 out of 100" at 1,440px where a sighted user saw only "Check
// design (1)". The pill's text never reaches a screen reader on its own, because aria-label replaces
// a button's content, so the name has to say it wherever the pill does. CanvasHeader is TSX that Node
// cannot load, so these tests evaluate the header's own lines; scripts/a11y-browser-check.mjs
// measures the real row in Chrome with a connected store.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const header = code(fs.readFileSync('src/components/toolbar/CanvasHeader.tsx', 'utf8'));
const EM_DASH = /—|\s–\s/;

/** The value of `const NAME = <number or sum of names>;` at the top of the header. */
function constant(name, seen = {}) {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(header);
  assert.ok(m, `${name} is defined`);
  return m[1].split('+').map(t => t.trim()).reduce((sum, t) => sum + (/^\d+$/.test(t) ? Number(t) : constant(t, seen)), 0);
}

/** One `const x = ...;` line from the component body, as source. */
function line(name) {
  const m = new RegExp(`\\n\\s*const ${name} = ([^\\n]+);\\n`).exec(header);
  assert.ok(m, `const ${name} is one line in the header`);
  return `const ${name} = ${m[1]};`;
}

const T = {
  COMPACT_BELOW_PX: constant('COMPACT_BELOW_PX'),
  ROAS_RIBBON_BELOW_PX: constant('ROAS_RIBBON_BELOW_PX'),
  MODES_ICON_BELOW_PX: constant('MODES_ICON_BELOW_PX'),
  STORE_SCORE_PX: constant('STORE_SCORE_PX'),
  STORE_SCORE_FROM_PX: constant('STORE_SCORE_FROM_PX')
};

// The header's own width decisions, run for a viewport width, a store score (or null) and a mode.
// eslint-disable-next-line no-new-func
const layout = new Function(
  'viewportWidth', 'storeScore', 'canvasViewMode', ...Object.keys(T),
  [line('storeReport'), line('storeWidth'), line('compact'), line('statsHidden'), 'return { pill: !!storeReport, compact, statsHidden };'].join('\n')
);
const at = (width, store, mode = 'canvas') => layout(width, store ? { overallScore: 10 } : null, mode, ...Object.values(T));

test('the pill shows only where the row has room for it, with the modes toggle still labelled', () => {
  // Measured in Chrome: the pill is about 113px, and the edited compact row with the toggle labelled
  // needs about 1,350px, so it fits from about 1,470px and wrapped at 1,440px.
  assert.ok(T.STORE_SCORE_PX >= 113, 'the budget covers the measured pill');
  assert.equal(T.STORE_SCORE_FROM_PX, T.MODES_ICON_BELOW_PX + T.STORE_SCORE_PX);
  for (const w of [1180, 1240, 1280, 1440, T.STORE_SCORE_FROM_PX - 1]) assert.equal(at(w, true).pill, false, `no pill at ${w}px`);
  for (const w of [T.STORE_SCORE_FROM_PX, 1720, 1920]) assert.equal(at(w, true).pill, true, `the pill shows at ${w}px`);
  for (const w of [1180, 1720, 2400]) assert.equal(at(w, false).pill, false, `no store, no pill at ${w}px`);
  // The pill is rendered from the width-gated report, never from the raw score.
  assert.match(header, /\{!narrow && storeReport && \(/);
  assert.doesNotMatch(header, /storeScore && \(\s*<span/);
});

test('while the pill shows, Test Lead Flow, the stats and the ROAS ribbon step aside that much sooner', () => {
  // 1,720px is where the full row with the pill wrapped (78px tall) after an edit.
  assert.equal(at(1720, true).compact, true);
  assert.equal(at(T.COMPACT_BELOW_PX + T.STORE_SCORE_PX - 1, true).compact, true);
  assert.equal(at(T.COMPACT_BELOW_PX + T.STORE_SCORE_PX, true).compact, false);
  assert.equal(at(T.ROAS_RIBBON_BELOW_PX + T.STORE_SCORE_PX - 1, true, 'roas').statsHidden, true);
  assert.equal(at(T.ROAS_RIBBON_BELOW_PX + T.STORE_SCORE_PX, true, 'roas').statsHidden, false);
  // Without a store, and where the pill has stepped aside, nothing moves.
  assert.equal(at(1720, false).compact, false);
  assert.equal(at(T.COMPACT_BELOW_PX - 1, false).compact, true);
  assert.equal(at(T.ROAS_RIBBON_BELOW_PX, false, 'roas').statsHidden, false);
  assert.equal(at(1440, true).compact, at(1440, false).compact);
});

/** The expression inside `attr={...}` on the Check design button. */
function buttonAttr(attr) {
  const start = header.indexOf('onClick={onOpenAudit}');
  assert.ok(start > -1, 'the Check design button is in the header');
  const open = header.indexOf(`${attr}={`, start) + attr.length + 2;
  let depth = 1;
  let i = open;
  for (; depth > 0; i++) {
    if (header[i] === '{') depth++;
    if (header[i] === '}') depth--;
  }
  return header.slice(open, i - 1);
}

test('Check design says the store score in its name and title where the pill shows it', () => {
  // eslint-disable-next-line no-new-func
  const named = new Function(
    'viewportWidth', 'storeScore', 'designCount', ...Object.keys(T),
    [line('storeReport'), line('storeScoreName'), line('storeScoreTitle'), `return { name: ${buttonAttr('aria-label')}, title: ${buttonAttr('title')} };`].join('\n')
  );
  const render = (storeScore, designCount, width = 1920) => named(width, storeScore, designCount, ...Object.values(T));
  assert.deepEqual(render({ overallScore: 10 }, 1), {
    name: 'Check design, 1 open check, store score 10 out of 100',
    title: '1 open design check. Open Check design to see it. Store score 10 out of 100.'
  });
  assert.deepEqual(render({ overallScore: 72 }, 0), {
    name: 'Check design, all checks passed, store score 72 out of 100',
    title: 'Every design check passed. Store score 72 out of 100.'
  });
  // No store: the name and title are exactly what they were.
  assert.deepEqual(render(null, 2), {
    name: 'Check design, 2 open checks',
    title: '2 open design checks. Open Check design to see them.'
  });
  assert.deepEqual(render(null, 0), { name: 'Check design, all checks passed', title: 'Every design check passed.' });
  for (const s of [render({ overallScore: 10 }, 1), render({ overallScore: 72 }, 0)]) {
    assert.doesNotMatch(s.name + s.title, EM_DASH);
  }
  // Where the pill has stepped aside, neither the name nor the title says a score the row does not
  // show: 1,440px is the laptop width the regression drive heard "store score 0 out of 100" at.
  for (const w of [390, 1024, 1180, 1280, 1440, T.STORE_SCORE_FROM_PX - 1]) {
    assert.deepEqual(render({ overallScore: 0 }, 1, w), {
      name: 'Check design, 1 open check',
      title: '1 open design check. Open Check design to see it.'
    }, `no store score in the name or title at ${w}px`);
  }
  // At every width the name says the score exactly when the pill does.
  for (let w = 320; w <= 2600; w += 10) {
    const { name } = render({ overallScore: 0 }, 1, w);
    assert.equal(/store score/.test(name), at(w, true).pill, `the name and the pill agree at ${w}px`);
  }
});

test('the browser check measures the toolbar with a store connected at the widths that wrapped', async () => {
  const { STORE_FIT_WIDTHS, STORE_WORKSPACES } = await import('./scripts/a11y-browser-check.mjs');
  for (const w of [1180, 1240, 1280, 1440, 1720]) assert.ok(STORE_FIT_WIDTHS.includes(w), `the store case measures ${w}px`);
  assert.equal(STORE_WORKSPACES.workspaces[0].shopifyConfig.status, 'connected');
  const check = code(fs.readFileSync('scripts/a11y-browser-check.mjs', 'utf8'));
  const fits = check.slice(check.indexOf('export async function checkHeaderFits'), check.indexOf('export async function checkAriaPressed'));
  assert.match(fits, /for \(const width of STORE_FIT_WIDTHS\) cases\.push\(\{ width, edited: true, store: true \}\)/);
  // The control: a store case that never connected would pass on the plain row. Its exact wording is
  // the browser check's own (it reads Check design's name and text), so only its presence is pinned.
  assert.match(fits, /the store did not connect/);
  // Only GET /api/workspaces is answered, and only when a check asks for a store.
  // Read raw: the route pattern '**/*' looks like the start of a block comment to code().
  const raw = fs.readFileSync('scripts/a11y-browser-check.mjs', 'utf8');
  const open = raw.slice(raw.indexOf('export async function openApp'), raw.indexOf('export async function settle'));
  assert.match(open, /if \(store && req\.method\(\) === 'GET' && req\.url\(\) === `\$\{base\.replace\(\/\\\/\$\/, ''\)\}\/api\/workspaces`\)/);
});
