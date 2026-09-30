import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// A follow-up sequence step had no way into Email Studio, the header switch did not save first,
// and coming back fitted the whole map with keyboard focus lost. src/lib/editorReturn.ts holds
// the round trip's rules: save, then open; a return keyed to one step on one journey; a flow
// deep link that never calls an unread list "missing"; and a first view framed on the step.

const {
  funnelReturnFor, returnStepId, returnBannerText, openAfterSave, chooseFlowId, canvasFitOptions,
  STUDIO_NOT_OPENED, LINKED_FLOW_MISSING, emailStudioButtonLabel
} = await import('./src/lib/editorReturn.ts');

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const EM_DASH = '—';
const SPACED_EN_DASH = / – /;
const clean = (text) => !text.includes(EM_DASH) && !SPACED_EN_DASH.test(text);

const project = (nodes, id = 'j1') => ({ id, nodes });
const seq = (id, data = {}) => ({ id, data: { type: 'follow-up-sequence', label: 'Nurture', ...data } });
const page = (id) => ({ id, data: { type: 'landing-page', label: 'Landing' } });

test('funnelReturnFor keys a return to one sequence step and trims its flow id', () => {
  const p = project([seq('s1', { jourvanceFlowId: ' flow_7 ' }), page('p1')]);
  assert.deepEqual(funnelReturnFor(p, 's1'), { journeyId: 'j1', nodeId: 's1', stepName: 'Nurture', flowId: 'flow_7' });
  assert.equal(funnelReturnFor(project([seq('s1')]), 's1').flowId, '');
  assert.equal(funnelReturnFor(project([seq('s1', { label: '   ' })]), 's1').stepName, 'this step');
  assert.equal(funnelReturnFor(p, 'gone'), null);
  assert.equal(funnelReturnFor(p, 'p1'), null);
});

test('returnStepId lands only on a step still on the same journey', () => {
  const p = project([seq('s1')]);
  const ret = funnelReturnFor(p, 's1');
  assert.equal(returnStepId(p, ret), 's1');
  assert.equal(returnStepId(project([seq('s1')], 'j2'), ret), null);
  assert.equal(returnStepId(project([page('p1')]), ret), null);
  assert.equal(returnStepId(p, null), null);
});

test('returnBannerText names the step, and says plainly when it is gone', () => {
  const withFlow = project([seq('s1', { label: 'Nurture & Booking Flow', jourvanceFlowId: 'f1' })]);
  const noFlow = project([seq('s1', { label: 'Nurture & Booking Flow' })]);
  const a = returnBannerText(withFlow, funnelReturnFor(withFlow, 's1'));
  const b = returnBannerText(noFlow, funnelReturnFor(noFlow, 's1'));
  assert.match(a, /Nurture & Booking Flow/);
  assert.match(b, /Nurture & Booking Flow/);
  assert.notEqual(a, b);
  assert.match(b, /choose it on that step/);
  const gone = returnBannerText(project([page('p1')]), funnelReturnFor(noFlow, 's1'));
  assert.match(gone, /no longer on this journey/);
  for (const text of [a, b, gone]) assert.ok(clean(text), text);
});

test('openAfterSave opens only after a save that resolved true', async () => {
  let opened = 0;
  const open = () => { opened += 1; };
  assert.equal(await openAfterSave(async () => false, open), false);
  assert.equal(opened, 0);
  assert.equal(await openAfterSave(async () => { throw new Error('offline'); }, open), false);
  assert.equal(opened, 0);
  assert.equal(await openAfterSave(async () => 'yes', open), false, 'only true opens');
  assert.equal(opened, 0);

  const order = [];
  const ok = await openAfterSave(
    () => new Promise((resolve) => setTimeout(() => { order.push('saved'); resolve(true); }, 5)),
    () => order.push('opened')
  );
  assert.equal(ok, true);
  assert.deepEqual(order, ['saved', 'opened']);
});

test('chooseFlowId never calls a flow missing when the list did not load', () => {
  assert.deepEqual(chooseFlowId(['a', 'b'], 'b'), { id: 'b', missing: false });
  assert.deepEqual(chooseFlowId(['a', 'b'], 'z'), { id: 'a', missing: true });
  assert.deepEqual(chooseFlowId(null, 'z'), { id: '', missing: false });
  assert.deepEqual(chooseFlowId(['a', 'b']), { id: 'a', missing: false });
  assert.deepEqual(chooseFlowId([]), { id: '', missing: false });
  assert.deepEqual(chooseFlowId([], 'z'), { id: '', missing: true });
});

test('canvasFitOptions frames a displayed step at 100% and fits the whole map otherwise', () => {
  assert.deepEqual(canvasFitOptions(null, ['a']), { padding: 0.2 });
  assert.deepEqual(canvasFitOptions(undefined, []), { padding: 0.2 });
  assert.deepEqual(canvasFitOptions('a', ['a', 'b']), { padding: 0.2, nodes: [{ id: 'a' }], maxZoom: 1 });
  assert.deepEqual(canvasFitOptions('a', new Set(['a'])), { padding: 0.2, nodes: [{ id: 'a' }], maxZoom: 1 });
  assert.deepEqual(canvasFitOptions('hidden', ['a', 'b']), { padding: 0.2 });
});

test('the round trip copy has no em dash and no spaced en dash', () => {
  const copy = [STUDIO_NOT_OPENED, LINKED_FLOW_MISSING, emailStudioButtonLabel(true), emailStudioButtonLabel(false)];
  for (const text of copy) assert.ok(clean(text), text);
  assert.equal(emailStudioButtonLabel(true), 'Edit this flow in Email Studio');
  assert.equal(emailStudioButtonLabel(false), 'Build a flow in Email Studio');
});

test('the sequence inspector has the Email Studio button and no longer claims the account has no flow', () => {
  const src = read('./src/components/drawers/SequenceEditor.tsx');
  assert.ok(!src.includes('Build a flow in Email Studio. This node waits'));
  assert.ok(!src.includes('No flow on this account'));
  assert.ok(src.includes('This step waits until a flow is chosen.'));
  assert.match(src, /emailStudioButtonLabel\(/);
  assert.match(src, /STUDIO_NOT_OPENED/);
  assert.match(src, /aria-disabled=\{openingEmailStudio/, 'aria-disabled keeps focus on the button when the save fails');
  assert.match(src, /role="status"/);
});

test('Email Studio opens on a chosen tab and deep-links the Flow map', () => {
  const suite = read('./src/components/campaign/HubEmailSuite.tsx');
  assert.ok(suite.includes('export type EmailStudioTab'));
  assert.ok(suite.includes('initialTab ||'));
  assert.ok(suite.includes('<EmailFlowMap initialFlowId={openFlowId}'));
  const map = read('./src/components/campaign/EmailFlowMap.tsx');
  assert.match(map, /chooseFlowId\(loaded \?/);
  assert.match(map, /load\(initialFlowId, true\)/);
  assert.match(map, /fromStep && pick\.missing\) setNotice\(LINKED_FLOW_MISSING\)/);
});

test('the return banner is plain buttons with a visible focus ring', () => {
  const banner = read('./src/components/campaign/FunnelReturnBanner.tsx');
  assert.ok(banner.includes('Back to funnel'));
  assert.ok(banner.includes('type="button"'));
  assert.ok(banner.includes('Dismiss'));
  assert.doesNotMatch(banner, /outline:\s*'none'/);
  assert.doesNotMatch(banner, /className=/, 'Tailwind is not installed here');
});

// The wiring in App.tsx, NodeInspector.tsx and JourneyCanvas.tsx (w3-spine-2).

test('App saves before it opens Email Studio from a step, and a return is one trip', () => {
  const app = read('./src/App.tsx');
  assert.match(app, /openAfterSave\((handleSave|saveNow)/);
  assert.ok(app.includes('onReturnToCanvas={funnelReturn ? undefined : showCanvas}'));
  assert.match(app, /activeView !== 'email-studio'\) setFunnelReturn\(null\)/);
  const opens = app.match(/setActiveView\('email-studio'\)/g) || [];
  assert.equal(opens.length, 1);
  const body = app.slice(app.indexOf('const handleOpenEmailStudio'));
  assert.ok(body.indexOf("setActiveView('email-studio')") > -1 && body.indexOf("setActiveView('email-studio')") < 600);
});

test('NodeInspector hands the Email Studio opener to the sequence editor', () => {
  const src = read('./src/components/drawers/NodeInspector.tsx');
  assert.match(src, /onOpenEmailStudio=\{onOpenEmailStudio \? \(\) => onOpenEmailStudio\(node\.id\)/);
});

test('the canvas frames the selected step on its first fit', () => {
  const src = read('./src/components/canvas/JourneyCanvas.tsx');
  assert.ok(src.includes('fitViewOptions={wholeMapFit(canvasFitOptions(selectedNodeId'));
});
