// src/lib/studioLeave.ts (EMAIL_STUDIO_PLAN.md Wave 8): every way out of the flow editor asks before it
// drops an edit that is not saved. The browser half (each way out on screen, Cancel and OK) is the
// unsaved-leave, cards-show-edit and nav-from-step steps of scripts/email-studio-browser-check.mjs; this
// file holds the module's own rule and the places that must ask it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FLOW_UNSAVED_LEAVE, flowUnsaved, leaveFlowEditorOk, noteFlowUnsaved } from './src/lib/studioLeave.ts';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

function withConfirm(answers, run) {
  const asked = [];
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const was = globalThis.window;
  globalThis.window = { confirm: (message) => { asked.push(message); return answers.shift(); } };
  try {
    run();
  } finally {
    if (had) globalThis.window = was;
    else delete globalThis.window;
    noteFlowUnsaved(false);
  }
  return asked;
}

test('nothing unsaved: every way out goes, and nobody is asked', () => {
  const asked = withConfirm([], () => {
    noteFlowUnsaved(false);
    assert.equal(leaveFlowEditorOk(), true);
  });
  assert.deepEqual(asked, []);
});

test('an unsaved edit: Cancel keeps it and asks again next time; OK leaves and a second guard on the same way out does not ask', () => {
  const asked = withConfirm([false, true], () => {
    noteFlowUnsaved(true);
    assert.equal(leaveFlowEditorOk(), false, 'Cancel let the way out go');
    assert.equal(flowUnsaved(), true, 'Cancel dropped the unsaved mark');
    assert.equal(leaveFlowEditorOk(), true, 'OK did not let the way out go');
    // App's view switch runs after Email Studio's own guard on Back to funnel: one question, not two.
    assert.equal(leaveFlowEditorOk(), true);
  });
  assert.deepEqual(asked, [FLOW_UNSAVED_LEAVE, FLOW_UNSAVED_LEAVE]);
  assert.doesNotMatch(FLOW_UNSAVED_LEAVE, /\u2014| \u2013 /);
});

test('the places that must ask: the editor reports its edit, the studio tabs and App ask before they move', () => {
  const map = read('./src/components/campaign/EmailFlowMap.tsx');
  assert.ok(map.includes('useEffect(() => { noteFlowUnsaved(unsaved); }, [unsaved]);'), 'the editor does not report its unsaved edit');
  assert.ok(map.includes('useEffect(() => () => noteFlowUnsaved(false), []);'), 'the editor does not clear its report when it closes');
  assert.ok(map.includes('!window.confirm(FLOW_UNSAVED_LEAVE)'), 'the picker asks in other words than the other ways out');
  const suite = read('./src/components/campaign/HubEmailSuite.tsx');
  const dest = suite.slice(suite.indexOf('const selectDestination'), suite.indexOf('const selectSection'));
  assert.ok(dest.indexOf('leaveFlowEditorOk()') > -1 && dest.indexOf('leaveFlowEditorOk()') < dest.indexOf('setActiveTab('), 'a destination tab moves before it asks');
  const section = suite.slice(suite.indexOf('const selectSection'), suite.indexOf('const onDestinationKey'));
  assert.ok(section.indexOf('leaveFlowEditorOk()') > -1 && section.indexOf('leaveFlowEditorOk()') < section.indexOf('setActiveTab('), 'a section tab moves before it asks');
  assert.ok(suite.includes('onClick={() => { selectSection(tab.key); }}'));
  const app = read('./src/App.tsx');
  const wrapper = app.slice(app.indexOf('const setActiveView = (view: ActiveAppView) => {'), app.indexOf('setActiveViewNow(view);'));
  assert.ok(wrapper.includes("if (view !== 'email-studio' && !leaveFlowEditorOk()) return;"), "App's view switch does not ask");
  const back = app.slice(app.indexOf('const showCanvas = () => {'), app.indexOf('const stepId = returnStepId(project, funnelReturn);'));
  assert.ok(back.includes('if (!leaveFlowEditorOk()) return;'), 'Back to funnel spends the return before it asks');
});
