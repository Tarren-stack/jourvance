// R01: two sides of one journey toolbar row.
// 1. C26 kept the Live ROAS row on one line by hiding the ROAS ribbon below 2,160px (2,280px with a
//    store), and nothing took its place: on a 1,920px screen Live ROAS showed the journey's gross,
//    bump rate and ROAS nowhere. Between the compact width and the ribbon width a ROAS pill no wider
//    than the lead stats now stands in for the ribbon and opens all four totals.
// 2. After any edit the row wrapped below about 1,090px (1,024px included), because the journey
//    name started at 200px and a wrapping row breaks on each item's starting width. It starts at
//    120px now and grows into the room the row has left.
// T08 moved three more lines:
// 3. With a store connected, Live ROAS showed no ROAS figure from 1,720 to 1,839px, because the store
//    pill moves the compact width up and the compact row showed no ROAS pill. The mode's key number
//    is never hidden now: the pill shows from COMPACT_BELOW_PX up, with or without a store.
// 4. From 1,008px down to 864px the first edit still wrapped the row, because the 144px save status
//    joined it. Below STATUS_SHORT_BELOW_PX its slot is held from the start and it shows a short word.
// 5. At 390px the toolbar was four rows, with Check design and Publish each alone on one.
// U09 moved the last one down:
// 6. From 360 to 389px the toolbar was three rows and from 320 to 350px four, because its two halves
//    each wrapped on their own: the right half (363px) had no room at 360, and at 320 Check design
//    took a row alone since the right half could never start beside it.
// CanvasHeader is TSX that Node cannot load, so these tests evaluate the header's own lines;
// the scratch browser check measures the real row in Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { moneyText, percentText } from './src/lib/journeyMetrics.ts';

const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const header = code(fs.readFileSync('src/components/toolbar/CanvasHeader.tsx', 'utf8'));
const EM_DASH = /—|\s–\s/;

/** The value of `const NAME = <number or sum of names>;` at the top of the header. */
function constant(name) {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(header);
  assert.ok(m, `${name} is defined`);
  return m[1].split('+').map(t => t.trim()).reduce((sum, t) => sum + (/^\d+$/.test(t) ? Number(t) : constant(t)), 0);
}

/** One `const x = ...;` line from the component body, as source. */
function line(name) {
  const m = new RegExp(`\\n\\s*const ${name} = ([^\\n]+);\\n`).exec(header);
  assert.ok(m, `const ${name} is one line in the header`);
  return `const ${name} = ${m[1]};`;
}

/** A multi-line `const name ... = [ ... ];` from the component body, as source without its type. */
function block(name) {
  const at = header.indexOf(`const ${name}`);
  assert.ok(at > -1, `const ${name} is in the header`);
  const src = header.slice(at, header.indexOf('];', at) + 2);
  return src.replace(/^const (\w+)[^=]*=/, 'const $1 =');
}

const T = Object.fromEntries(['COMPACT_BELOW_PX', 'ROAS_RIBBON_BELOW_PX', 'STORE_SCORE_PX', 'STORE_SCORE_FROM_PX'].map(n => [n, constant(n)]));

// eslint-disable-next-line no-new-func
const layout = () => new Function(
  'viewportWidth', 'storeScore', 'canvasViewMode', ...Object.keys(T),
  [line('storeReport'), line('storeWidth'), line('compact'), line('statsHidden'),
    // A header with no ROAS pill reads as one that never shows it, so the widths below say where.
    /\n\s*const roasSummary = /.test(header) ? line('roasSummary') : 'const roasSummary = false;',
    'return { compact, statsHidden, roasSummary };'].join('\n')
);

test('in Live ROAS mode the ROAS figure shows at every width the lead stats show at in Edit Canvas', () => {
  const run = layout();
  const at = (w, store, mode) => run(w, store ? { overallScore: 10 } : null, mode, ...Object.values(T));
  for (const store of [false, true]) {
    for (let w = 1000; w <= 2800; w++) {
      const edit = at(w, store, 'edit');
      const roas = at(w, store, 'roas');
      const where = `${w}px${store ? ' with a store' : ''}`;
      // Edit Canvas is exactly what it was: the lead stats, never the ROAS pill.
      assert.equal(edit.roasSummary, false, `${where}: no ROAS pill in Edit Canvas`);
      assert.equal(edit.statsHidden, edit.compact, `${where}: the lead stats follow the compact width`);
      // Live ROAS shows the ribbon or the pill wherever the lead stats would show, never both.
      if (!edit.statsHidden) assert.ok(!roas.statsHidden || roas.roasSummary, `${where}: Live ROAS shows the ROAS totals somewhere`);
      assert.ok(!(roas.roasSummary && !roas.statsHidden), `${where}: the pill and the ribbon never show together`);
      // From the compact width up Live ROAS always shows a ROAS figure, the ribbon or the pill, with
      // a store too (T08: 1,720 to 1,839px with a store showed neither). Below it the pill steps aside
      // with the lead stats, so the narrower rows keep their width.
      if (w >= T.COMPACT_BELOW_PX) assert.ok(!roas.statsHidden || roas.roasSummary, `${where}: Live ROAS shows a ROAS figure`);
      else assert.equal(roas.roasSummary, false, `${where}: no pill below the compact width`);
    }
  }
  // The widths the finding measured: 1,920px shows the pill, the ribbon from 2,160px (2,280px with a store).
  assert.equal(at(1920, false, 'roas').roasSummary, true);
  assert.equal(at(1920, true, 'roas').roasSummary, true);
  assert.equal(at(T.ROAS_RIBBON_BELOW_PX, false, 'roas').statsHidden, false);
  assert.equal(at(T.ROAS_RIBBON_BELOW_PX + T.STORE_SCORE_PX, true, 'roas').statsHidden, false);
  // The band the regression drive found (T08): with a store, the compact row carries the pill.
  for (let w = 1720; w <= 1839; w++) {
    const r = at(w, true, 'roas');
    assert.equal(r.compact, true, `${w}px with a store is the compact row`);
    assert.equal(r.roasSummary, true, `${w}px with a store shows the ROAS pill`);
  }
});

/** The JSX from the `{roasSummary && (` gate to the end of its element. */
function pill() {
  const at = header.indexOf('{roasSummary && (');
  assert.ok(at > -1, 'the ROAS pill is rendered from roasSummary');
  const end = header.indexOf("flex: '0 1 auto'", at);
  assert.ok(end > at, 'the pill sits in the left group, before Add Step');
  return header.slice(at, end);
}

test('the ROAS pill is a disclosure that opens the four totals, for keyboard and screen reader users too', () => {
  const p = pill();
  const button = p.slice(p.indexOf('<button'), p.indexOf('</button>'));
  assert.match(button, /type="button"/);
  assert.match(button, /aria-expanded=\{showRoasTotals\}/);
  assert.match(button, /aria-controls=\{roasTotalsId\}/);
  assert.match(button, /\{roasHeadline\}/, 'the pill says the headline ROAS figure');
  assert.match(button, /setShowRoasTotals\(v => !v\)/);
  // The totals are a labelled group the pill points at, listing every figure.
  assert.match(p, /\{showRoasTotals && \(/);
  assert.match(p, /id=\{roasTotalsId\}/);
  assert.match(p, /aria-label="ROAS totals"/);
  assert.match(p, /roasFigures\.map\(f =>/);
  assert.match(p, /<dt[^>]*>\{f\.label\}<\/dt>/);
  assert.match(p, /<dd[^>]*>\{f\.value\}<\/dd>/);
  assert.match(header, /const roasTotalsId = useId\(\);/);
  // The ribbon and the pill say the same headline.
  assert.match(header, /<span>\{roasHeadline\}<\/span>/);
  // Escape closes the totals, and so does the pill stepping aside.
  const esc = header.slice(header.indexOf("if (e.key !== 'Escape') return;"), header.indexOf("window.addEventListener('keydown', onKey)"));
  assert.match(esc, /setShowRoasTotals\(false\)/);
  assert.match(header, /if \(!showMoreMenu && !showAddMenu && !showUserMenu && !showRoasTotals\) return;/);
  assert.match(header, /\}, \[showMoreMenu, showAddMenu, showUserMenu, showRoasTotals\]\);/);
  assert.match(header, /if \(!roasSummary\) setShowRoasTotals\(false\);/);
  for (const s of p.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`|>[^<>{}\n]+</g) || []) assert.doesNotMatch(s, EM_DASH, s);
});

test('the totals say Unavailable for what was not measured, never 0', () => {
  // eslint-disable-next-line no-new-func
  const figures = new Function('totals', 'moneyText', 'percentText', `${line('roasHeadline')}\n${block('roasFigures')}\nreturn { roasHeadline, roasFigures };`);
  const none = figures({ spend: 0, gross: null, bumpRate: null, roas: null }, moneyText, percentText);
  assert.equal(none.roasHeadline, 'ROAS Unavailable');
  assert.deepEqual(none.roasFigures.map(f => [f.label, f.value, f.measured]), [
    ['Spend you entered', 'Not entered', false],
    ['Gross', 'Unavailable', false],
    ['Bump rate', 'Unavailable', false],
    ['ROAS', 'Unavailable', false]
  ]);
  const some = figures({ spend: 500, gross: 1250, bumpRate: 0.2, roas: 2.5 }, moneyText, percentText);
  assert.equal(some.roasHeadline, 'Est. 2.5x ROAS');
  assert.deepEqual(some.roasFigures.map(f => [f.label, f.value, f.measured]), [
    ['Spend you entered', moneyText(500), true],
    ['Gross', moneyText(1250), true],
    ['Bump rate', percentText(0.2), true],
    ['ROAS', 'Est. 2.5x', true]
  ]);
  for (const f of [...none.roasFigures, ...some.roasFigures]) assert.doesNotMatch(f.label + f.value, EM_DASH);
});

test('the journey name starts at 120px (80px on a phone, 72px below 390px) and grows into the room the row has left', () => {
  const at = header.indexOf('aria-label="Journey name"');
  assert.ok(at > -1);
  const style = header.slice(header.indexOf('style={{', at), header.indexOf('}}', at));
  // A wrapping row breaks on each item's starting width: the input's width sets that, not only its basis.
  assert.match(style, /width: smallPhone \? '72px' : phone \? '80px' : '120px'/);
  assert.match(style, /flex: smallPhone \? '1 1 72px' : phone \? '1 1 80px' : '1 1 120px'/);
  assert.match(style, /maxWidth: compact \? '200px' : '240px'/);
  assert.match(style, /minWidth: smallPhone \? '72px' : phone \? '80px' : '120px'/);
  // The old starting widths are gone.
  assert.doesNotMatch(style, /'0 1 200px'|'0 1 240px'/);
});

// ---- T08: the save status, the phone row ----

// Read inside each test, so a header without these widths fails the tests that need them, one by one.
const W = new Proxy({}, { get: (_, name) => constant(String(name)) });

/** The JSX of the first `<tag` element whose opening tag contains `marker`, to its closing tag. */
function element(marker, tag) {
  const at = header.indexOf(marker);
  assert.ok(at > -1, `${marker} is in the header`);
  const open = header.lastIndexOf(`<${tag}`, at);
  return header.slice(open, header.indexOf(`</${tag}>`, at) + tag.length + 3);
}

test('below the width the full save status fits, its slot is held from the start and it shows a short word', () => {
  // Measured in Chrome (T08): the edited row with the full status (about 144px) is one row from
  // 1,012px up and two rows from 1,008px down, where the fresh row was still one row down to 868px.
  assert.ok(W.STATUS_SHORT_BELOW_PX > 1012, 'the short status covers every width the full one wrapped at');
  assert.match(header, /const statusShort = viewportWidth < STATUS_SHORT_BELOW_PX;/);
  // The status element, from its opening tag to the Save button after it (it holds spans of its own).
  const statusAt = header.lastIndexOf('<span', header.indexOf('role="status"'));
  const status = header.slice(statusAt, header.indexOf('onClick={onSave}', statusAt));
  // Held whatever the status is, so the row is the same width before the first edit and after it.
  assert.match(status, /minWidth: statusShort \? `\$\{STATUS_SLOT_PX\}px` : undefined,/);
  assert.doesNotMatch(status.slice(0, status.indexOf('>')), /statusView \?/, 'the slot does not wait for a status');
  // The short word is shown, and the full text is what a screen reader hears, first, so the
  // status's text still starts with what it claims ("Saved in this browser").
  const short = status.indexOf('{statusView.short}');
  const full = status.indexOf('<span className="jv-sr-only">{statusView.text}</span>');
  assert.ok(full > -1 && short > full, 'the full text comes first, for screen readers only');
  assert.match(status.slice(full), /<span aria-hidden="true">\{statusView\.short\}<\/span>/);
  assert.match(status, /statusShort && statusView\.short !== statusView\.text/);
});

test('each short word fits the held slot, and the ones that differ keep the full sentence', () => {
  const block = header.slice(header.indexOf('const statusView'), header.indexOf(': null;', header.indexOf('const statusView')));
  const pairs = [...block.matchAll(/text: '([^']+)', short: '([^']+)'/g)].map(m => [m[1], m[2]]);
  // Saving, Unsaved changes, Saved, Saved in this browser, Saved, not backed up (a failure is its own ternary).
  assert.ok(pairs.length >= 5, `found ${pairs.length} statuses with a short word`);
  assert.match(block, /short: saveStatus\.action === 'open-library' \? 'Out of space' : 'Not saved'/);
  const shortOf = Object.fromEntries(pairs);
  assert.equal(shortOf['Saved in this browser'], 'In browser');
  assert.equal(shortOf['Unsaved changes'], 'Unsaved');
  assert.equal(shortOf['Saved, not backed up'], 'No backup');
  assert.equal(shortOf['Saving…'], 'Saving…');
  assert.equal(shortOf.Saved, 'Saved');
  // Chrome widths at 12px/600 (T08): In browser 62.2, No backup 63.1, Unsaved 51.1, Saving… 50.5,
  // Saved 36.0. The slot holds a 13px icon, its 5px gap and the widest of them.
  const measured = { 'In browser': 62.2, 'No backup': 63.1, Unsaved: 51.1, 'Saving…': 50.5, Saved: 36 };
  for (const [, word] of pairs) {
    assert.ok(word in measured, `"${word}" has a measured width`);
    assert.ok(13 + 5 + measured[word] <= W.STATUS_SLOT_PX, `"${word}" fits the ${W.STATUS_SLOT_PX}px slot`);
  }
  for (const [text, word] of pairs) {
    assert.doesNotMatch(text + word, EM_DASH);
    assert.ok(word.length <= text.length, `"${word}" is no longer than "${text}"`);
  }
});

test('Save and Publish keep their width while they work, so a save never wraps the row', () => {
  const save = element('onClick={onSave}', 'button');
  // An autosave sets `saving`, and "Saving…" was 22px wider than "Save".
  assert.match(save, /<span>Save<\/span>/);
  assert.doesNotMatch(save, /'Saving…'/);
  assert.match(save, /saving \? <Loader2 size=\{14\} className="spin" aria-hidden="true" \/> : <Save/);
  const publish = element('data-publish-trigger', 'button');
  // On a narrow row it reads Publish, which "Publishing…" would widen by about 29px.
  assert.match(publish, /<span>\{statusShort \? 'Publish' : publishing \? 'Publishing…' : 'Publish Funnel'\}<\/span>/);
  assert.match(publish, /publishing && statusShort \? <Loader2/);
});

test('on a phone Add Step and More show icons only and keep their words for screen readers, and the row tightens', () => {
  assert.ok(W.PHONE_BELOW_PX > 390 && W.PHONE_BELOW_PX <= 600, 'a phone width');
  assert.ok(W.PHONE_BELOW_PX < W.NARROW_BELOW_PX);
  assert.match(header, /const phone = viewportWidth < PHONE_BELOW_PX;/);
  // The words stay in the button (visually hidden), so its name and its text are the same at every
  // width: the keyboard check reads the focused button's text after Escape.
  const add = element('ref={addButtonRef}', 'button');
  assert.match(add, /\{phone \? <span className="jv-sr-only">Add Step<\/span> : <span>Add Step<\/span>\}/);
  const more = element('ref={moreButtonRef}', 'button');
  assert.match(more, /\{phone \? <span className="jv-sr-only">More<\/span> : <span>More<\/span>\}/);
  for (const b of [add, more]) assert.doesNotMatch(b, /aria-label=/, 'named by its words, not a second copy of them');
  // Budget at 390px (T08, Chrome widths): the side padding is 12px, so each row has 366px.
  // Row 1: Journeys 40, the name from 80, Undo and Redo 64, the mode toggle 70, Check design "! 1" 54,
  // four 6px gaps: 332. Row 2: Add Step 40, More 40, the status slot, Save 78, Publish 98, four 6px
  // gaps. Both fit, so the toolbar is two rows.
  const row1 = 40 + 80 + 64 + 70 + 54 + 4 * 6;
  const row2 = 40 + 40 + W.STATUS_SLOT_PX + 78 + 98 + 4 * 6;
  assert.ok(row1 <= 390 - 24 && row2 <= 390 - 24, `rows of ${row1} and ${row2}px fit 366px`);
  assert.match(header, /padding: smallPhone \? '6px 10px' : phone \? '6px 12px' : '6px 20px'/);
  assert.match(header, /gap: phone \? '6px' : '10px', minWidth: 0, flex: '1 1 auto'/);
  assert.match(header, /gap: phone \? '6px' : '8px', flex: '0 1 auto'/);
});

// ---- U09: 360 to 389px phones ----

/**
 * Check design's narrow pill in Chrome (U09): "! 5" is 54px, "! 10" 60px and "! 100" 66px. A journey
 * reaches ten open checks by adding five steps to the starter one, so the budget holds two digits
 * and three.
 */
const CHECK = { one: 54, two: 60, three: 66 };
/**
 * The toolbar's items in DOM order with their Chrome widths (U09, measured at 360px): Journeys, the
 * journey name from its starting width, Undo and Redo, the mode toggle, Check design, then Add Step,
 * More, the status slot, Save and Publish.
 */
const items = (saveWidth, check = CHECK.one, name = 72) => [40, name, 64, 70, check, 40, 40, W.STATUS_SLOT_PX, saveWidth, 97];
/** Rows a wrapping flex line makes of `widths` in `room` px with `gap` px between items. */
function rows(widths, room, gap) {
  let count = 1; let used = 0;
  for (const w of widths) {
    if (used && used + gap + w > room) { count++; used = w; } else used += (used ? gap : 0) + w;
  }
  return count;
}

test('below 390px the two halves share the rows and Save shows its icon, so 360 to 389px is two rows', () => {
  assert.equal(W.SMALL_PHONE_BELOW_PX, 390, 'every width below 390 (T08 already fits 390 in two rows)');
  assert.ok(W.SMALL_PHONE_BELOW_PX < W.PHONE_BELOW_PX, 'a small phone is a phone');
  assert.match(header, /const smallPhone = viewportWidth < SMALL_PHONE_BELOW_PX;/);
  // Each half hands its items to the toolbar's own row, so the right half can start beside Check design.
  assert.match(header, /const toolbarHalf: React\.CSSProperties \| null = smallPhone \? \{ display: 'contents' \} : null;/);
  assert.equal((header.match(/<div style=\{toolbarHalf \?\? \{ display: 'flex'/g) || []).length, 2, 'both halves');
  // Every item then takes the toolbar's gap, which tightens to the phone gap, and packs from the start.
  assert.match(header, /justifyContent: smallPhone \? 'flex-start' : 'space-between',/);
  assert.match(header, /gap: smallPhone \? '6px' : '8px 12px',/);
  // Publish's own margin keeps it at the end of whichever row it lands on.
  assert.match(element('data-publish-trigger', 'button'), /marginLeft: smallPhone \? 'auto' : undefined,/);
  // Save keeps its word for screen readers, as Add Step and More do: named by its text, not a label.
  const save = element('onClick={onSave}', 'button');
  assert.match(save, /\{smallPhone \? <span className="jv-sr-only">Save<\/span> : <span>Save<\/span>\}/);
  assert.match(save, /title=\{smallPhone \? 'Save' : undefined\}/);
  assert.doesNotMatch(save, /aria-label=/);
  // The budget: 10px side padding, 6px gaps, the name from 72px, Save 44px with its icon only (78px
  // with its word), for every Check design count up to three digits.
  for (const check of Object.values(CHECK)) {
    for (const w of [360, 375, 384, 389]) assert.ok(rows(items(44, check), w - 20, 6) <= 2, `${w}px with a ${check}px Check design is at most two rows`);
    for (const w of [320, 340, 359]) assert.ok(rows(items(44, check), w - 20, 6) <= 3, `${w}px with a ${check}px Check design is at most three rows`);
  }
  // Why the word goes: with it the second row is 363px, over the 340px a 360px phone has.
  assert.equal(rows(items(78), 360 - 20, 6), 3);
  // Why the name and the padding give up room (the skeptic's repro): with 12px padding and the name
  // from 80px, "! 10" wrapped Check design onto the second row at 360px and Publish onto a third.
  assert.equal(rows(items(44, CHECK.two, 80), 360 - 24, 6), 3);
  assert.equal(rows(items(44, CHECK.one, 80), 360 - 24, 6), 2);
});

test('an open Add Step or More menu is placed again when the screen changes width', () => {
  const at = header.indexOf('useLayoutEffect(() => {');
  assert.ok(at > -1, 'a layout effect places the open menus');
  const effect = header.slice(at, header.indexOf('}, [viewportWidth]);', at) + 20);
  assert.match(effect, /\}, \[viewportWidth\]\);$/, 'it runs when the width changes');
  assert.match(effect, /if \(showAddMenu\) \{ setAddMenuSide\(sideFor\(addButtonRef\.current, ADD_MENU_WIDTH\)\); setAddMenuSlide\(slideFor\(addButtonRef\.current, ADD_MENU_WIDTH\)\); \}/);
  assert.match(effect, /if \(showMoreMenu\) \{ setMoreMenuSide\(sideFor\(moreButtonRef\.current, MORE_MENU_WIDTH\)\); setMoreMenuSlide\(slideFor\(moreButtonRef\.current, MORE_MENU_WIDTH\)\); \}/);
});

test('a menu that fits neither edge of its button slides back on screen, so More opens whole at 320px', async () => {
  const { menuSide, MENU_GUTTER_PX } = await import('./src/lib/menuPlacement.ts');
  const at = header.indexOf('const slideFor = ');
  assert.ok(at > -1, 'slideFor is in the header');
  const src = header.slice(at, header.indexOf('\n  };', at) + 5).replace(/: HTMLButtonElement \| null|: number/g, '');
  const place = (rect, width, viewport) => {
    // eslint-disable-next-line no-new-func
    const slideFor = new Function('window', 'sideFor', 'MENU_GUTTER_PX', `${src}\nreturn slideFor;`)(
      { innerWidth: viewport }, (b, w) => menuSide(b.getBoundingClientRect(), w, viewport), MENU_GUTTER_PX);
    const button = { getBoundingClientRect: () => rect };
    const side = menuSide(rect, width, viewport);
    const start = (side === 'left' ? rect.left : rect.right - width) + slideFor(button, width);
    return [start, start + width];
  };
  // U09 at 320px: More sits at 118 to 158px on the second row. Neither edge fits a 220px menu,
  // and without the slide it ran to 338px, 18px past the screen.
  const [start, end] = place({ left: 118, right: 158 }, 220, 320);
  assert.ok(start >= MENU_GUTTER_PX && end <= 320 - MENU_GUTTER_PX, `More opens at ${start} to ${end}px`);
  // Where an edge fits, nothing moves.
  assert.deepEqual(place({ left: 1200, right: 1290 }, 220, 1440), [1070, 1290]);
  assert.deepEqual(place({ left: 12, right: 52 }, 210, 360), [12, 222]);
  // Both menus apply it.
  assert.match(header, /setAddMenuSlide\(slideFor\(addButtonRef\.current, ADD_MENU_WIDTH\)\)/);
  assert.match(header, /setMoreMenuSlide\(slideFor\(moreButtonRef\.current, MORE_MENU_WIDTH\)\)/);
  assert.match(header, /transform: addMenuSlide \? `translateX\(\$\{addMenuSlide\}px\)` : undefined,/);
  assert.match(header, /transform: moreMenuSlide \? `translateX\(\$\{moreMenuSlide\}px\)` : undefined,/);
});
