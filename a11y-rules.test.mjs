import test from 'node:test';
import assert from 'node:assert/strict';
import {
  A11Y_NEGATIVE_CONTROL,
  A11Y_POSITIVE_CONTROL,
  A11Y_RULES,
  accessibleName,
  ariaProblems,
  composite,
  contrastRatio,
  documentProblems,
  judgeA11y,
  judgeContrast,
  listProblems,
  nameProblem,
  parseCssColor,
  requiredContrast,
  scrollRegionProblems,
  structureProblems,
  targetSizeProblems
} from './src/lib/a11yRules.ts';

// The hand-written accessibility rules behind npm run check:canvas (#11). The browser only
// collects facts; these tests drive every judge with facts written by hand, so a rule can be
// proven to fire (and to stay quiet) without Chrome.

const hex = h => {
  const n = parseInt(h.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const rgb = h => parseCssColor(hex(h));
const sample = (over = {}) => ({ where: 'p #1 in page', color: hex('#94A3B8'), layers: [hex('#0F172A')], blockedBy: null, fontSizePx: 12, fontWeight: 400, ...over });
const nameFacts = (over = {}) => ({
  where: 'button #1 in page',
  kind: 'button',
  labelledby: '',
  ariaLabel: null,
  labels: '',
  native: null,
  content: '',
  title: null,
  placeholder: null,
  altAttr: null,
  ...over
});
const aria = (attrs, role = 'generic', over = {}) => ({ where: 'div #1 in page', tag: 'div', role, attrs: Object.entries(attrs).map(([name, value]) => ({ name, value })), missingIds: [], ...over });
const structure = over => ({ where: 'div #1 in page', role: 'generic', explicit: false, ownedRoles: null, contextRole: null, ariaHiddenFocusable: false, interactiveAncestor: false, ...over });
const rules = list => list.map(f => f.rule);
const EMPTY = { names: [], aria: [], structure: [], lists: [], targets: [], scrollRegions: [], texts: [], document: null };
const DASHES = /—| – /;

// ---- Colour ----

test('contrastRatio is 21 for white on black', () => {
  assert.equal(contrastRatio(rgb('#FFFFFF'), rgb('#000000')), 21);
});

test('#94A3B8 on #0F172A passes at 12px, about 6.96 to 1', () => {
  const v = judgeContrast(sample());
  assert.equal(v.verdict, 'pass');
  assert.ok(Math.abs(v.ratio - 6.96) < 0.01, `ratio ${v.ratio}`);
});

test('#64748B on #0F172A fails at 12px (about 3.75 to 1) and passes at 24px', () => {
  const small = judgeContrast(sample({ color: hex('#64748B') }));
  assert.equal(small.verdict, 'fail');
  assert.ok(Math.abs(small.ratio - 3.75) < 0.01, `ratio ${small.ratio}`);
  assert.equal(small.required, 4.5);
  assert.equal(judgeContrast(sample({ color: hex('#64748B'), fontSizePx: 24 })).verdict, 'pass');
});

test('requiredContrast: large text is 24px, or 18.66px bold', () => {
  assert.equal(requiredContrast(18.66, 700), 3);
  assert.equal(requiredContrast(18, 700), 4.5);
  assert.equal(requiredContrast(24, 400), 3);
  assert.equal(requiredContrast(18.66, 400), 4.5);
});

test('parseCssColor reads comma, space-and-slash and transparent, and nothing else', () => {
  assert.deepEqual(parseCssColor('rgba(15, 23, 42, 0.95)'), { r: 15, g: 23, b: 42, a: 0.95 });
  assert.deepEqual(parseCssColor('rgb(15 23 42 / 0.6)'), { r: 15, g: 23, b: 42, a: 0.6 });
  assert.deepEqual(parseCssColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseCssColor('rgb(15, 23, 42)'), { r: 15, g: 23, b: 42, a: 1 });
  assert.equal(parseCssColor('oklch(0.5 0.1 200)'), null);
  assert.equal(parseCssColor('#0F172A'), null);
  assert.equal(parseCssColor('rgb(1, 2)'), null);
});

// ---- judgeContrast ----

test('translucent layers composite over the first opaque one', () => {
  // White text on half-black over white is white on mid grey, not white on black.
  const layers = ['rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)'];
  const v = judgeContrast(sample({ color: 'rgb(255, 255, 255)', layers }));
  const grey = composite(parseCssColor('rgba(0, 0, 0, 0.5)'), parseCssColor('rgb(255, 255, 255)'));
  assert.ok(Math.abs(v.ratio - contrastRatio(parseCssColor('rgb(255, 255, 255)'), grey)) < 1e-9);
  assert.ok(v.ratio < 5);
  // The black below the opaque white does not count.
  assert.notEqual(Math.round(v.ratio), 21);
});

test('with no opaque layer the page is white', () => {
  const v = judgeContrast(sample({ color: 'rgb(0, 0, 0)', layers: ['transparent', 'rgba(0, 0, 0, 0)'] }));
  assert.equal(v.verdict, 'pass');
  assert.equal(v.ratio, 21);
});

test('a blocked sample is unmeasured with its reason, never a pass', () => {
  for (const reason of ['gradient', 'background-image', 'opacity', 'mix-blend-mode', 'backdrop-filter']) {
    const v = judgeContrast(sample({ color: 'rgb(255, 255, 255)', blockedBy: reason }));
    assert.deepEqual(v, { verdict: 'unmeasured', reason });
  }
  assert.equal(judgeContrast(sample({ layers: ['oklch(0.2 0 0)'] })).verdict, 'unmeasured');
  const judged = judgeA11y({ ...EMPTY, texts: [sample({ blockedBy: 'gradient' })] });
  assert.equal(judged.findings.length, 0);
  assert.deepEqual(judged.unmeasured, [{ rule: 'color-contrast', where: 'p #1 in page', reason: 'gradient' }]);
});

// ---- Names ----

test('a button whose only content is an aria-hidden svg has no name, and gains one from aria-label or title', () => {
  // The collector leaves aria-hidden children out of content, so an icon button reads as empty.
  assert.equal(nameProblem(nameFacts())?.rule, 'button-name');
  assert.equal(nameProblem(nameFacts({ ariaLabel: 'Close Audit Drawer' })), null);
  assert.equal(nameProblem(nameFacts({ title: 'Close' })), null);
  assert.equal(nameProblem(nameFacts({ content: 'Save' })), null);
  assert.equal(nameProblem(nameFacts({ ariaLabel: '   ' }))?.rule, 'button-name');
});

test('a placeholder never counts as a label', () => {
  const input = nameFacts({ kind: 'label', placeholder: 'Your email' });
  assert.equal(nameProblem(input)?.rule, 'label');
  assert.equal(accessibleName(input), '');
  assert.equal(nameProblem({ ...input, labels: 'Email' }), null);
  // A field is not named from its content.
  assert.equal(nameProblem({ ...input, content: 'typed text' })?.rule, 'label');
});

test('image-alt fires only on a missing alt with no ARIA name; alt="" passes', () => {
  const img = nameFacts({ kind: 'image' });
  assert.equal(nameProblem(img)?.rule, 'image-alt');
  assert.equal(nameProblem({ ...img, altAttr: '' }), null);
  assert.equal(nameProblem({ ...img, altAttr: 'Logo' }), null);
  assert.equal(nameProblem({ ...img, ariaLabel: 'Logo' }), null);
});

test('role names: command, toggle and input field rules', () => {
  assert.equal(nameProblem(nameFacts({ kind: 'command' }))?.rule, 'aria-command-name');
  assert.equal(nameProblem(nameFacts({ kind: 'command', content: 'Open' })), null);
  assert.equal(nameProblem(nameFacts({ kind: 'toggle' }))?.rule, 'aria-toggle-field-name');
  assert.equal(nameProblem(nameFacts({ kind: 'input-field', content: 'text' }))?.rule, 'aria-input-field-name');
  assert.equal(nameProblem(nameFacts({ kind: 'input-field', labelledby: 'Budget' })), null);
  assert.equal(nameProblem(nameFacts({ kind: 'link' }))?.rule, 'link-name');
});

test('accessibleName follows accname order', () => {
  const f = nameFacts({ labelledby: 'From labelledby', ariaLabel: 'From label', content: 'From content', title: 'From title' });
  assert.equal(accessibleName(f), 'From labelledby');
  assert.equal(accessibleName({ ...f, labelledby: '' }), 'From label');
  assert.equal(accessibleName({ ...f, labelledby: '', ariaLabel: null }), 'From content');
  assert.equal(accessibleName({ ...f, labelledby: '', ariaLabel: null, content: '' }), 'From title');
});

// ---- ARIA ----

test('aria-valid-attr-value: aria-expanded="yes" fails, aria-haspopup="menu" passes', () => {
  assert.deepEqual(rules(ariaProblems(aria({ 'aria-expanded': 'yes' }, 'button'))), ['aria-valid-attr-value']);
  assert.deepEqual(ariaProblems(aria({ 'aria-haspopup': 'menu' }, 'button')), []);
  assert.deepEqual(rules(ariaProblems(aria({ 'aria-haspopup': 'popup' }, 'button'))), ['aria-valid-attr-value']);
  assert.deepEqual(rules(ariaProblems(aria({ 'aria-labelledby': 'nope' }, 'button', { missingIds: ['aria-labelledby'] }))), ['aria-valid-attr-value']);
});

test('aria-valid-attr: a misspelt attribute fails', () => {
  assert.deepEqual(rules(ariaProblems(aria({ 'aria-lable': 'Close' }, 'button'))), ['aria-valid-attr']);
});

test('aria-allowed-attr: aria-pressed fails on a plain div and passes on a button', () => {
  assert.deepEqual(rules(ariaProblems(aria({ 'aria-pressed': 'true' }))), ['aria-allowed-attr']);
  assert.deepEqual(ariaProblems(aria({ 'aria-pressed': 'true' }, 'button')), []);
  assert.deepEqual(ariaProblems(aria({ 'aria-expanded': 'false' }, 'button')), []);
});

test('aria-prohibited-attr: aria-label on a plain span fails', () => {
  assert.deepEqual(rules(ariaProblems(aria({ 'aria-label': 'Total' }, 'generic', { tag: 'span' }))), ['aria-prohibited-attr']);
  assert.deepEqual(ariaProblems(aria({ 'aria-label': 'Journey tools' }, 'toolbar')), []);
});

// ---- Structure ----

test('aria-required-children: a menu with no menuitem fails', () => {
  assert.deepEqual(rules(structureProblems(structure({ role: 'menu', explicit: true, ownedRoles: [] }))), ['aria-required-children']);
  assert.deepEqual(structureProblems(structure({ role: 'menu', explicit: true, ownedRoles: ['menuitem', 'menuitem'] })), []);
});

test('aria-required-parent: a stray menuitem fails', () => {
  assert.deepEqual(rules(structureProblems(structure({ role: 'menuitem', explicit: true, contextRole: 'region' }))), ['aria-required-parent']);
  assert.deepEqual(rules(structureProblems(structure({ role: 'menuitem', explicit: true, contextRole: null }))), ['aria-required-parent']);
  assert.deepEqual(structureProblems(structure({ role: 'menuitem', explicit: true, contextRole: 'menu' })), []);
});

test('aria-hidden-focus and nested-interactive', () => {
  assert.deepEqual(rules(structureProblems(structure({ role: 'button', ariaHiddenFocusable: true }))), ['aria-hidden-focus']);
  assert.deepEqual(rules(structureProblems(structure({ role: 'button', interactiveAncestor: true }))), ['nested-interactive']);
});

test('list and listitem', () => {
  assert.deepEqual(rules(listProblems({ where: 'ul #1', tag: 'ul', badChildren: ['div'], parentOk: true })), ['list']);
  assert.deepEqual(listProblems({ where: 'ul #1', tag: 'ul', badChildren: [], parentOk: true }), []);
  assert.deepEqual(rules(listProblems({ where: 'li #1', tag: 'li', badChildren: [], parentOk: false })), ['listitem']);
  assert.deepEqual(listProblems({ where: 'li #1', tag: 'li', badChildren: [], parentOk: true }), []);
});

test('scrollable-region-focusable: a scroller with nothing focusable fails', () => {
  assert.deepEqual(rules(scrollRegionProblems({ where: 'div #1', focusable: false, hasFocusableDescendant: false })), ['scrollable-region-focusable']);
  assert.deepEqual(scrollRegionProblems({ where: 'div #1', focusable: true, hasFocusableDescendant: false }), []);
  assert.deepEqual(scrollRegionProblems({ where: 'div #1', focusable: false, hasFocusableDescendant: true }), []);
});

// ---- Target size and document ----

const target = (x, y, w = 16, h = 16, over = {}) => ({ where: `button @${x},${y}`, x, y, w, h, inline: false, ...over });

test('target-size: an isolated 16px button passes, two 8px apart both fail, an inline link is exempt', () => {
  assert.deepEqual(targetSizeProblems([target(0, 0), target(100, 100, 40, 40)]), []);
  const close = targetSizeProblems([target(0, 0), target(24, 0)]);
  assert.deepEqual(close.map(f => f.where), ['button @0,0', 'button @24,0']);
  assert.deepEqual(targetSizeProblems([target(0, 0, 30, 12, { inline: true }), target(0, 14, 30, 12, { inline: true })]), []);
  // A card that holds the button is its container, not a neighbour.
  assert.deepEqual(targetSizeProblems([target(10, 10), target(0, 0, 200, 100)]), []);
  // A big target 4px away is touched by the 24px circle.
  assert.equal(targetSizeProblems([target(0, 0), target(20, 0, 40, 40)]).length, 1);
});

test('document: empty lang, empty title and user-scalable=no each fail', () => {
  const good = { lang: 'en', title: 'Jourvance', viewportContent: 'width=device-width, initial-scale=1.0' };
  assert.deepEqual(documentProblems(good), []);
  assert.deepEqual(rules(documentProblems({ ...good, lang: '' })), ['html-has-lang']);
  assert.deepEqual(rules(documentProblems({ ...good, title: '  ' })), ['document-title']);
  assert.deepEqual(rules(documentProblems({ ...good, viewportContent: 'width=device-width, user-scalable=no' })), ['meta-viewport']);
  assert.deepEqual(rules(documentProblems({ ...good, viewportContent: 'width=device-width, maximum-scale=1' })), ['meta-viewport']);
  assert.deepEqual(documentProblems({ ...good, viewportContent: 'width=device-width, maximum-scale=5' }), []);
});

// ---- Completeness ----

test('A11Y_RULES holds 23 unique axe ids and each has a planted positive control', () => {
  assert.equal(A11Y_RULES.length, 23);
  assert.equal(new Set(A11Y_RULES).size, 23);
  for (const rule of A11Y_RULES) {
    assert.ok(A11Y_POSITIVE_CONTROL.some(c => c.rule === rule && c.html.trim()), `no positive control for ${rule}`);
  }
  for (const c of A11Y_POSITIVE_CONTROL) assert.ok(A11Y_RULES.includes(c.rule), `control for unknown rule ${c.rule}`);
  assert.ok(A11Y_NEGATIVE_CONTROL.includes('aria-label="Close panel"'));
  assert.ok(A11Y_NEGATIVE_CONTROL.includes('alt=""'));
  assert.ok(A11Y_NEGATIVE_CONTROL.includes('role="menu"') && A11Y_NEGATIVE_CONTROL.includes('role="menuitem"'));
});

test('no detail or reason a judge returns carries an em dash or a spaced en dash', () => {
  const facts = {
    names: ['button', 'link', 'label', 'image', 'command', 'toggle', 'input-field'].map(kind => nameFacts({ kind })),
    aria: [
      aria({ 'aria-lable': 'x' }),
      aria({ 'aria-expanded': 'yes' }),
      aria({ 'aria-pressed': 'true' }),
      aria({ 'aria-label': 'x' }),
      aria({ 'aria-controls': 'gone' }, 'button', { missingIds: ['aria-controls'] })
    ],
    structure: [
      structure({ role: 'menu', explicit: true, ownedRoles: [] }),
      structure({ role: 'tab', explicit: true }),
      structure({ role: 'button', ariaHiddenFocusable: true, interactiveAncestor: true })
    ],
    lists: [
      { where: 'ul', tag: 'ul', badChildren: ['div'], parentOk: true },
      { where: 'li', tag: 'li', badChildren: [], parentOk: false }
    ],
    targets: [target(0, 0), target(24, 0)],
    scrollRegions: [{ where: 'div', focusable: false, hasFocusableDescendant: false }],
    texts: [sample({ color: hex('#64748B') }), sample({ blockedBy: 'backdrop-filter' }), sample({ layers: ['oklch(0 0 0)'] })],
    document: { lang: '', title: '', viewportContent: 'user-scalable=no' }
  };
  const judged = judgeA11y(facts);
  assert.equal(new Set(judged.findings.map(f => f.rule)).size, 23, 'every rule fired on these fixtures');
  for (const f of judged.findings) assert.doesNotMatch(f.detail, DASHES, f.rule);
  for (const u of judged.unmeasured) assert.doesNotMatch(u.reason, DASHES);
});

test('judgeA11y on empty facts finds nothing', () => {
  assert.deepEqual(judgeA11y(EMPTY), { findings: [], unmeasured: [] });
});
