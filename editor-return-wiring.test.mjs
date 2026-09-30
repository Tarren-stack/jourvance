import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// #21's wiring (the w3-spine-2 half). editor-return.test.mjs holds the pure rules and the Email
// Studio side. These pins hold the path between them: a sequence step's button reaches App through
// the docked panel, App saves through #8's saveNow before it opens Email Studio, a return is one
// trip, every way back lands on the step through #7's selectStep, and the canvas's first fit frames
// that step instead of the whole map.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('./src/App.tsx');

/** The source of one `const name = ...` helper in App, up to the next blank line. */
const helper = (name) => {
  const start = app.indexOf(`const ${name}`);
  assert.ok(start > -1, `${name} is defined in App.tsx`);
  const end = app.indexOf('\n\n', start);
  return app.slice(start, end === -1 ? undefined : end);
};

test('App opens Email Studio from a step only through the save gate', () => {
  const open = helper('handleOpenEmailStudio');
  assert.match(open, /funnelReturnFor\(project, nodeId\)/);
  assert.match(open, /openAfterSave\(saveNow,/, 'the one save is #8 saveNow, the same save the header uses');
  assert.match(open, /const \{ saveNow \} = editing;/);
  assert.match(open, /setFunnelReturn\(ret\)/);
  // The view switch sits inside the gate's open callback, so a failed save never leaves the map.
  assert.ok(open.indexOf("setActiveView('email-studio')") > open.indexOf('openAfterSave('));
  const opens = app.match(/setActiveView\('email-studio'\)/g) || [];
  assert.equal(opens.length, 1, 'no other path opens Email Studio with a return');
});

test('a return belongs to one trip and a focus hand-back to one landing', () => {
  assert.match(app, /if \(activeView !== 'email-studio'\) setFunnelReturn\(null\);/);
  assert.match(app, /if \(activeView !== 'canvas'\) setReturnFocusNodeId\(null\);/);
  assert.match(app, /setReturnFocusNodeId\(prev => \(prev === selectedNodeId \? prev : null\)\)/);
});

test('every way back lands on the step through selectStep', () => {
  const back = helper('showCanvas');
  assert.match(back, /returnStepId\(project, funnelReturn\)/);
  assert.match(back, /if \(stepId\) selectStep\(stepId\);/, '#7 selectStep is the one way to choose a step');
  assert.match(back, /setReturnFocusNodeId\(stepId\)/);
  assert.match(back, /setFunnelReturn\(null\)/);
  assert.match(back, /setActiveView\('canvas'\)/);
  // The banner, Email Studio's own button and the header's Funnel Canvas switch all go through it.
  assert.match(app, /onSelectView=\{view => \(view === 'canvas' \? showCanvas\(\) : setActiveView\(view\)\)\}/);
  assert.match(app, /<FunnelReturnBanner[\s\S]{0,120}onBack=\{showCanvas\}/);
  assert.ok(app.includes('onReturnToCanvas={funnelReturn ? undefined : showCanvas}'));
});

test('the banner sits under the header only during a trip, and Email Studio opens on the flow', () => {
  assert.match(app, /\{activeView === 'email-studio' && funnelReturn && \(?\s*<FunnelReturnBanner/);
  assert.match(app, /onDismiss=\{\(\) => setFunnelReturn\(null\)\}/);
  assert.ok(app.includes("initialTab={funnelReturn ? 'map' : undefined}"));
  assert.ok(app.includes('openFlowId={funnelReturn?.flowId || undefined}'));
  // Directly under the header: nothing but the banner between the header element and the main area.
  const header = app.indexOf('<CanvasHeader');
  const banner = app.indexOf('<FunnelReturnBanner');
  const main = app.indexOf('<Suspense fallback={<SuspenseLoader');
  assert.ok(header > -1 && header < banner && banner < main);
});

test('the opener reaches the sequence editor through the docked panel', () => {
  const start = app.indexOf('<StepDock');
  const element = app.slice(start, app.indexOf('/>', start));
  assert.ok(element.includes('onOpenEmailStudio={handleOpenEmailStudio}'));
  assert.ok(element.includes('openingEmailStudio={saving}'));
  assert.ok(element.includes('returnFocusNodeId={returnFocusNodeId}'));

  const dock = read('./src/components/drawers/StepDock.tsx');
  assert.match(dock, /onOpenEmailStudio=\{onOpenEmailStudio\}/);
  assert.match(dock, /openingEmailStudio=\{openingEmailStudio\}/);
  assert.match(dock, /returnFocusNodeId=\{returnFocusNodeId\}/);

  const inspector = read('./src/components/drawers/NodeInspector.tsx');
  assert.match(inspector, /onOpenEmailStudio=\{onOpenEmailStudio \? \(\) => onOpenEmailStudio\(node\.id\) : undefined\}/);
  assert.match(inspector, /openingEmailStudio=\{openingEmailStudio\}/);
  assert.match(inspector, /focusStudioButton=\{returnFocusNodeId === node\.id\}/);
});

test('the canvas frames the selected step on its first fit and adds no second pan', () => {
  const canvas = read('./src/components/canvas/JourneyCanvas.tsx');
  assert.ok(canvas.includes('fitViewOptions={wholeMapFit(canvasFitOptions(selectedNodeId, displayedNodes.map(n => n.id)), wholeMapPadding)}'));
  assert.doesNotMatch(canvas, /fitViewOptions=\{\{ padding: 0\.2 \}\}/);
  assert.match(canvas, /import \{ canvasFitOptions \} from '\.\.\/\.\.\/lib\/editorReturn';/);
  // #7's FocusSelectedStep stays the only pan that follows the selection.
  assert.equal((canvas.match(/<FocusSelectedStep /g) || []).length, 1);
  assert.equal((canvas.match(/function \w*Reveal\w*Step/g) || []).length, 0);
});
