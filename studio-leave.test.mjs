// src/lib/studioLeave.ts (EMAIL_STUDIO_PLAN.md Wave 8): every way out of the flow editor asks before it
// drops an edit that is not saved. The browser half (each way out on screen, Cancel and OK) is the
// unsaved-leave, cards-show-edit and nav-from-step steps of scripts/email-studio-browser-check.mjs; this
// file holds the module's own rule and the places that must ask it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BROADCAST_UNSAVED_LEAVE, FLOW_UNSAVED_LEAVE, STUDIO_UNSAVED_LEAVE, broadcastUnsaved, flowUnsaved, leaveFlowEditorOk, leaveStudioOk,
  noteBroadcastUnsaved, noteFlowUnsaved, warnBeforeUnload
} from './src/lib/studioLeave.ts';

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
    noteBroadcastUnsaved(false);
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
  // Open list: App's ways out of the studio ask about the broadcast draft too (leaveStudioOk), in one question.
  assert.ok(wrapper.includes("if (view !== 'email-studio' && !leaveStudioOk()) return;"), "App's view switch does not ask");
  const back = app.slice(app.indexOf('const showCanvas = () => {'), app.indexOf('const stepId = returnStepId(project, funnelReturn);'));
  assert.ok(back.includes('if (!leaveStudioOk()) return;'), 'Back to funnel spends the return before it asks');
  assert.doesNotMatch(app, /leaveFlowEditorOk/, 'App still asks only about the flow edit');
});

// ---- Open list (2026-10-09): the broadcast draft, one question on the way out, and a reload ----

test('leaving the studio with an unsaved broadcast asks; the studio tabs do not, because the studio keeps the draft', () => {
  const asked = withConfirm([false, true], () => {
    noteBroadcastUnsaved(true);
    // A studio tab keeps the draft (it lives in HubEmailSuite), so the tab strip goes without a question.
    assert.equal(leaveFlowEditorOk(), true, 'a studio tab asked about a broadcast it keeps');
    assert.equal(leaveStudioOk(), false, 'Cancel let the way out go');
    assert.equal(broadcastUnsaved(), true, 'Cancel dropped the unsaved mark');
    assert.equal(leaveStudioOk(), true, 'OK did not let the way out go');
    // showCanvas asks, then setActiveView asks again on the same way out: one question, not two.
    assert.equal(leaveStudioOk(), true);
  });
  assert.deepEqual(asked, [BROADCAST_UNSAVED_LEAVE, BROADCAST_UNSAVED_LEAVE]);
});

test('a flow edit and a broadcast draft both unsaved: one question names both, asked once', () => {
  const asked = withConfirm([true], () => {
    noteFlowUnsaved(true);
    noteBroadcastUnsaved(true);
    assert.equal(leaveStudioOk(), true);
    assert.equal(flowUnsaved(), false);
    assert.equal(broadcastUnsaved(), false);
    assert.equal(leaveStudioOk(), true);
    assert.equal(leaveFlowEditorOk(), true);
  });
  assert.deepEqual(asked, [STUDIO_UNSAVED_LEAVE]);
  // The flow edit alone asks the flow's own question, word for word the picker's.
  const flowOnly = withConfirm([false], () => {
    noteFlowUnsaved(true);
    assert.equal(leaveStudioOk(), false);
  });
  assert.deepEqual(flowOnly, [FLOW_UNSAVED_LEAVE]);
  // Nothing unsaved: nobody is asked.
  assert.deepEqual(withConfirm([], () => { assert.equal(leaveStudioOk(), true); }), []);
  for (const text of [BROADCAST_UNSAVED_LEAVE, STUDIO_UNSAVED_LEAVE]) assert.doesNotMatch(text, /—| – /);
  assert.notEqual(BROADCAST_UNSAVED_LEAVE, FLOW_UNSAVED_LEAVE);
});

test('a reload or a closed tab asks while a flow edit or a broadcast draft is unsaved', () => {
  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; }, returnValue: 'unset' };
  warnBeforeUnload(event);
  assert.equal(prevented, 1, 'the listener does not cancel the unload');
  assert.equal(event.returnValue, '', 'the listener does not set returnValue, which older Chrome needs');
  // The flow editor adds it only while it holds an unsaved edit, and takes it off again.
  const map = read('./src/components/campaign/EmailFlowMap.tsx');
  const effect = map.slice(map.indexOf("    window.addEventListener('beforeunload', warnBeforeUnload);") - 120, map.indexOf("  }, [unsaved]);\n", map.indexOf("window.addEventListener('beforeunload', warnBeforeUnload);")) + 16);
  assert.match(effect, /useEffect\(\(\) => \{\s*if \(!unsaved\) return;\s*window\.addEventListener\('beforeunload', warnBeforeUnload\);\s*return \(\) => window\.removeEventListener\('beforeunload', warnBeforeUnload\);\s*\}, \[unsaved\]\);/, 'the flow editor has no reload guard keyed on its unsaved edit');
  // The composer uses the same listener, and reports its unsaved draft the way the editor reports its edit.
  const composer = read('./src/components/campaign/BroadcastComposer.tsx');
  assert.match(composer, /window\.addEventListener\('beforeunload', warnBeforeUnload\);/);
  assert.ok(composer.includes('useEffect(() => { noteBroadcastUnsaved(unsaved); }, [unsaved]);'), 'the composer does not report its unsaved draft');
  assert.ok(composer.includes('useEffect(() => () => noteBroadcastUnsaved(false), []);'), 'the composer does not clear its report when the studio closes');
  // The report is the same `unsaved` the reload guard reads: changes not saved, with something in them to lose.
  assert.match(composer, /const unsaved = dirty && draftHasContent\(draft\);/);
});
