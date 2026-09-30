// The journey library and journey addresses (#18), wired into the app. The rules live in
// journeyRoute.ts, journeyLibrary.ts, journeyStorage.ts and useJourneyNavigation.ts, and are
// driven directly by journey-route, journey-library and journey-storage tests. These pins cover
// the part the integration lane owns: App reads the first address once and hands every switch,
// Back and Forward to the navigation hook; a new journey from Blueprints and the operator's Load
// keep the journey that was open; the canvas and the dock remount per journey; the header opens
// the library and shows the switch notice; and the canvas frames a deep-linked step through the
// one first fit, never a second pan.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(p, 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const EM_DASH = /—|\s–\s/;
const app = code(read('src/App.tsx'));
const header = code(read('src/components/toolbar/CanvasHeader.tsx'));
const canvas = code(read('src/components/canvas/JourneyCanvas.tsx'));

// The body of `const name = ...` up to the next const at the same depth.
function block(src, name) {
  const m = new RegExp(`const ${name}\\s*[:=]`).exec(src);
  assert.ok(m, `${name} is defined`);
  const next = src.indexOf('\n  const ', m.index + 10);
  return src.slice(m.index, next < 0 ? undefined : next);
}

// The JSX element that starts at `<Name`, up to its closing `/>`.
function element(src, name) {
  const start = src.indexOf(`<${name}`);
  assert.ok(start > -1, `<${name}> is rendered`);
  return src.slice(start, src.indexOf('/>', start) + 2);
}

test('App reads the first address once, keeping the journey id case', () => {
  assert.match(app, /useState\(\(\) => parseAppLocation\(window\.location\.pathname, window\.location\.search\)\)/);
  assert.match(app, /loadInitialJourney\(initialRoute\.page === 'canvas' \? initialRoute\.journeyId : null\)/);
  assert.match(app, /useState<JourneyProject>\(initialLoad\.project\)/);
  assert.match(app, /useState<AppPage>\(initialRoute\.page\)/);
  // The old parse lowercased the whole path, so /canvas/<id> fell through to the home page.
  assert.doesNotMatch(app, /pathname\.replace\(\/\^\\\/\/, ''\)\.toLowerCase\(\)/);
  // A deep-linked step starts selected only when the journey has it.
  assert.match(app, /initialRoute\.step && initialLoad\.project\.nodes\.some\(n => n\.id === initialRoute\.step\)/);
});

test('the navigation hook owns the address, Back and Forward', () => {
  // App no longer pushes /canvas or listens for popstate itself: two writers would fight.
  assert.doesNotMatch(app, /addEventListener\('popstate'/);
  assert.doesNotMatch(app, /history\.pushState/);
  const nav = app.slice(app.indexOf('useJourneyNavigation({'), app.indexOf('});', app.indexOf('useJourneyNavigation({')));
  assert.ok(nav.length > 0, 'useJourneyNavigation is called');
  // Every switch saves through #8's saveNow first, and a step is chosen through #7's selectStep.
  assert.match(nav, /handleSave: editing\.saveNow/);
  assert.match(nav, /setSelectedNodeId: selectStep/);
  assert.match(nav, /markLoaded: editing\.markLoaded/);
  assert.match(nav, /initialMissingId: initialLoad\.missing \? initialRoute\.journeyId : null/);
  assert.match(nav, /initialStep: initialRoute\.step/);
  assert.match(nav, /authReady/);
  // State that belonged to the previous journey is cleared on every switch.
  const switched = nav.slice(nav.indexOf('onSwitched'));
  for (const s of ['setPublishedPages([])', 'setShowPublishModal(false)', 'setPublishError(null)']) assert.ok(switched.includes(s), s);
});

test('a switch chooses its step in the journey it opens, not the one it leaves', () => {
  // App's selectStep turns Retention Flows back on for a retention step. It is called in the same
  // tick as setProject, so its render's project is still the journey being left; the hook hands it
  // the target, and selectStep looks the step up there.
  assert.match(block(app, 'selectStep'), /\(nodeId: string \| null, inJourney: JourneyProject = project\) =>/);
  assert.match(block(app, 'selectStep'), /inJourney\.nodes\.find\(n => n\.id === nodeId\)/);
  const hook = code(read('src/lib/useJourneyNavigation.ts'));
  const activate = hook.slice(hook.indexOf('const activate'), hook.indexOf('const fail'));
  assert.match(activate, /cur\.setSelectedNodeId\(hasStep \? step : null, target\)/);
  assert.match(hook, /setSelectedNodeId: \(id: string \| null, inJourney\?: JourneyProject\) => void;/);
});

test('a new journey and the operator Load keep the open journey in the library', () => {
  const load = block(app, 'handleLoadBlueprint');
  assert.match(load, /newJourneyId\(Date\.now\(\), journeyToken\(\)\)/);
  assert.match(load, /nav\.startJourney\(newJourney\)/);
  assert.doesNotMatch(load, /setProject\(newJourney\)/);
  // Every journey keeps its own browser copy now, so "this browser keeps one journey" and
  // "those changes will be lost" are no longer true, and neither is asked.
  assert.doesNotMatch(load, /BROWSER_ONE_JOURNEY_QUESTION|LEAVE_JOURNEY_QUESTION|window\.confirm/);
  const dash = element(app, 'OperatorDashboard');
  assert.match(dash, /nav\.startJourney\(p\)/);
  assert.doesNotMatch(dash, /setProject\(p\)/);
});

test('an answer for one journey is never applied to another', () => {
  // The sign-in load captures the id it asked for (read off the render's project or its ref).
  assert.match(app, /const requestedId = (?:project|projectRef\.current)\.id;/);
  assert.match(app, /p\.id !== requestedId/);
  assert.match(app, /encodeURIComponent\(requestedId\)/);
  // The canvas and the dock remount per journey, so no step position or panel state carries over.
  assert.match(element(app, 'JourneyCanvas'), /key=\{project\.id\}/);
  assert.match(element(app, 'StepDock'), /key=\{project\.id\}/);
});

test('the import deep link is read once and taken off the address', () => {
  const start = app.indexOf("params.get('import_blueprint')");
  assert.ok(start > -1);
  const effect = app.slice(start, app.indexOf('}, []);', start));
  assert.match(effect, /delete\('import_blueprint'\)/);
  assert.match(effect, /history\.replaceState\(/);
});

test('the header opens the library and shows the switch notice', () => {
  const props = element(app, 'CanvasHeader');
  assert.match(props, /onOpenJourneyLibrary=\{\(\) => setShowJourneyLibrary\(true\)\}/);
  assert.match(props, /journeyNotice=\{nav\.notice\}/);
  assert.match(props, /onDismissJourneyNotice=\{nav\.dismissNotice\}/);
  assert.match(props, /onRetryJourneyNotice=\{nav\.retryNotice\}/);

  assert.match(app, /const JourneyLibraryDialog = lazy\(\(\) => import\('\.\/components\/modals\/JourneyLibraryDialog'\)/);
  const dialog = element(app, 'JourneyLibraryDialog');
  assert.match(app, /\{showJourneyLibrary && \(?\s*<JourneyLibraryDialog/);
  for (const p of ['onOpen={nav.openJourney}', 'onRename={nav.renameJourneyById}', 'onDuplicate={nav.duplicateJourneyById}']) {
    assert.ok(dialog.includes(p), p);
  }
  assert.match(dialog, /onNewJourney=\{\(\) => \{[^}]*setShowJourneyLibrary\(false\);[^}]*setShowBlueprintModal\(true\);/);

  assert.match(header, /\bLibrary\b[^;]*from 'lucide-react'/);
  assert.match(header, /const LIBRARY_LABEL_BELOW_PX = 1280;/);
  // With the save status showing (after any edit) and the mode toggle labelled, the row needs about
  // 1,350px, so below 1,400px the toggle shows icons only and Save and Publish stay on the row.
  assert.match(header, /const MODES_ICON_BELOW_PX = 1400;/);
  // From 1,600px Test Lead Flow and the lead stats join the row, which then needs about 1,680px.
  assert.match(header, /const COMPACT_BELOW_PX = 1720;/);
  assert.match(header, /\{!modesIconOnly && <span>Edit Canvas<\/span>\}/);
  assert.match(header, /\{!modesIconOnly && <span>Live ROAS<\/span>\}/);
  // The Journeys button sits just before the name input.
  const button = header.indexOf('aria-label="Journeys"');
  const name = header.indexOf('aria-label="Journey name"');
  assert.ok(button > -1 && button < name, 'Journeys comes before the name');
  const tag = header.slice(header.lastIndexOf('<button', button), header.indexOf('</button>', button));
  assert.match(tag, /type="button"/);
  assert.match(tag, /aria-haspopup="dialog"/);
  assert.match(tag, /viewportWidth >= LIBRARY_LABEL_BELOW_PX/);
  assert.match(header, /if \(journeyNotice\) \{?\s*problems\.push\(\{\s*key: 'journey'/);
  assert.match(header, /onRetry: journeyNotice\.retryable \? onRetryJourneyNotice : undefined/);
});

test('in Live ROAS mode the wider ribbon steps aside on its own threshold, so the row stays one row (C26)', async () => {
  // The ROAS ribbon is about 450px wider than the lead stats, so the full row needs about 2,130px
  // after an edit. Gating it on COMPACT_BELOW_PX alone wrapped Add Step, Save and Publish onto a
  // second row from 1,720px to about 2,150px, 1,920px included.
  assert.match(header, /const ROAS_RIBBON_BELOW_PX = 2160;/);
  // A connected store's pill moves the ribbon's width up with it (C27).
  assert.match(header, /const statsHidden = compact \|\| \(canvasViewMode === 'roas' && viewportWidth < ROAS_RIBBON_BELOW_PX \+ storeWidth\);/);
  // The stats strip (lead stats or ROAS ribbon) is gated on statsHidden, never on compact alone.
  const strip = header.indexOf("canvasViewMode === 'roas' ? (");
  assert.ok(strip > -1, 'the ROAS ribbon is in the header');
  const gate = header.lastIndexOf('{!', strip);
  assert.match(header.slice(gate, strip), /^\{!statsHidden && \(/);
  // Test Lead Flow keeps the plain width threshold, so switching modes never moves it into More.
  assert.match(header, /compact \? \{ label: 'Test Lead Flow'/);
  const test = header.indexOf('onClick={onTestJourney}');
  assert.match(header.slice(header.lastIndexOf('{!', test), test), /^\{!compact && \(/);
  // The browser check measures the widths where the ribbon used to wrap, before and after an edit.
  const { HEADER_FIT_WIDTHS } = await import('./scripts/a11y-browser-check.mjs');
  for (const w of [1720, 1920]) assert.ok(HEADER_FIT_WIDTHS.includes(w), `the header check measures ${w}px`);
  const check = code(read('scripts/a11y-browser-check.mjs'));
  const fits = check.slice(check.indexOf('export async function checkHeaderFits'), check.indexOf('export async function checkAriaPressed'));
  assert.match(fits, /for \(const edited of \[false, true\]\)/);
  assert.match(fits, /\['Edit Canvas', 'Live ROAS'\]/);
  // Items inside each group count toward the one-row band, so a group wrapping inside itself is seen.
  assert.match(fits, /flatMap\(c => \[c, \.\.\.c\.children\]\)/);
});

test('a deep-linked step is framed by the first fit, not by a second pan', () => {
  // The canvas remounts per journey (key above) with the step already selected, and #21's first
  // fit frames the selected step, so no extra focus prop is needed. A whole-map fit also keeps room
  // for the map's overlays (C01), and wholeMapFit leaves a framed step's options as they are.
  assert.match(canvas, /fitViewOptions=\{wholeMapFit\(canvasFitOptions\(selectedNodeId, displayedNodes\.map\(n => n\.id\)\), wholeMapPadding\)\}/);
  // #7's FocusSelectedStep stays the only pan, and there is one fitView on the map.
  assert.equal(canvas.match(/function FocusSelectedStep/g)?.length, 1);
  assert.equal(canvas.match(/setCenter\(/g)?.length, 1);
});

test('F4: a full browser store says so, and the banner opens the library instead of Try again', () => {
  // App remembers why the browser refused, and hands it to the signed-out save state.
  assert.match(app, /localWrite\.current = keepJourney\(project\);/);
  assert.match(app, /browserSaveOutcome\(localWrite\.current\.kept, doc\.updatedAt, localWrite\.current\.full\)/);
  // The header's save problem: the library for out of space, never Save (retrying cannot help).
  const save = header.slice(header.indexOf("if (saveStatus.kind === 'failed') {"), header.indexOf('if (publishError)'));
  assert.match(save, /saveStatus\.action === 'open-library' && onOpenJourneyLibrary/);
  assert.match(save, /onRetry: openLibrary \? onOpenJourneyLibrary : saveStatus\.retryable \? onSave : undefined/);
  assert.match(save, /retryLabel: openLibrary \? 'Open journeys' : undefined/);
  assert.match(header, /saveStatus\.action === 'open-library' \? 'Out of space' : 'Not saved'/);
  // A removal may free the room: App keeps the open journey again and, signed out, reports it.
  const dialog = element(app, 'JourneyLibraryDialog');
  assert.match(dialog, /onFreedSpace=\{\(\) => \{[\s\S]*keepJourney\(projectRef\.current\)[\s\S]*if \(!user\) void editing\.saveNow\(\);/);
});

test('F4: a browser copy is removed only from the confirm, never the open one, and Undo is offered', () => {
  const lib = code(read('src/components/modals/JourneyLibraryDialog.tsx'));
  // One call, inside `remove`, which only the confirm's button runs.
  assert.equal(lib.match(/removeBrowserJourney\(/g)?.length, 1);
  assert.match(block(lib, 'remove'), /removeBrowserJourney\(pending\.id, project\.id\)/);
  assert.equal(lib.match(/onClick=\{remove\}/g)?.length, 1);
  const confirm = lib.slice(lib.indexOf('{confirmRemoval && ('), lib.lastIndexOf('</ModalDialog>'));
  assert.match(confirm, /<ModalDialog labelledBy=\{CONFIRM_TITLE_ID\}/, 'a proper dialog on the dialog stack');
  assert.match(confirm, /Remove "\{confirmRemoval\.name\}" from this browser\?/);
  assert.match(confirm, /onClick=\{remove\}/);
  assert.ok(confirm.indexOf('Cancel') < confirm.indexOf('onClick={remove}'), 'Cancel comes first, so it takes focus');
  // The row's button asks; it is offered only for a browser copy that is not open.
  assert.match(lib, /\{row\.inBrowser && !active && \(\s*<button[^>]*onClick=\{\(\) => askToRemove\(row\)\}/);
  // Nothing removes on a timer or on open: no call outside the confirm, and no other removeItem.
  assert.doesNotMatch(lib, /localStorage\.removeItem/);
  // Undo for UNDO_MS, restoring the stored copy; a usage line from the stored sizes.
  assert.match(lib, /export const UNDO_MS = 8000;/);
  assert.match(block(lib, 'undo'), /restoreBrowserJourney\(removalNotice\.removed\)/);
  assert.match(lib, /storageUsageLine\(browserStorageUsage\(\)\)/);
  assert.match(block(lib, 'remove'), /onFreedSpace\?\.\(\)/);
  // A journey another tab opened last is refused before the confirm, and after it (a race) with the
  // same sentence, not the one for the journey open here.
  const ask = block(lib, 'askToRemove');
  assert.ok(ask.indexOf('activeSlotHold(row.id, project.id)') < ask.indexOf('setConfirmRemoval('), 'refused before asking');
  assert.match(ask, /slotRefusal\(hold, row\.id, row\.name\)/);
  assert.match(block(lib, 'remove'), /result\.reason === 'active-slot' \? slotRefusal\(result\.hold, pending\.id, pending\.name\)/);
  // F4: another tab is named only for the 'another-tab' hold; a slot this tab could not write over
  // (a full browser, one tab open) gets the sentence that claims no other tab.
  const slot = lib.slice(lib.indexOf('const slotRefusal ='), lib.indexOf('const askToRemove'));
  assert.match(slot, /hold\.kind === 'another-tab'\s*\?\s*removeOpenElsewhere\(name\)\s*:\s*removeNotSavedHere\(name, hold\.full,/);
  assert.match(slot, /rows\.some\(r => r\.inBrowser && r\.id !== project\.id && r\.id !== id\)/, 'make room only when another copy can go');
  assert.doesNotMatch(lib, /openInAnotherTab/);
});

test('F4: closing the library after a removal hands focus to the header Journeys button, not the page', () => {
  // The out-of-space banner's Open journeys button unmounts once the resave lands, so the opener is
  // gone; the house fallback (BlueprintModal and others use [data-more-trigger]) names the header.
  const lib = code(read('src/components/modals/JourneyLibraryDialog.tsx'));
  const outer = lib.slice(lib.indexOf('<ModalDialog labelledBy={TITLE_ID}'), lib.indexOf('>', lib.indexOf('<ModalDialog labelledBy={TITLE_ID}')));
  assert.match(outer, /fallbackFocusSelectors=\{\['\[data-journeys-trigger\]'/);
  const trigger = header.slice(header.indexOf('onClick={onOpenJourneyLibrary}'), header.indexOf('</button>', header.indexOf('onClick={onOpenJourneyLibrary}')));
  assert.match(trigger, /data-journeys-trigger/);
  assert.match(trigger, /aria-label="Journeys"/);
  assert.equal(header.match(/data-journeys-trigger/g)?.length, 1, 'one element answers the selector');
});

test('no em dash or spaced en dash in the wired copy', () => {
  for (const [name, src] of [['App', app], ['CanvasHeader', header], ['JourneyCanvas', canvas], ['JourneyLibraryDialog', code(read('src/components/modals/JourneyLibraryDialog.tsx'))]]) {
    const strings = src.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`|>[^<>{}\n]+</g) || [];
    for (const s of strings) assert.doesNotMatch(s, EM_DASH, `${name}: ${s}`);
  }
});
