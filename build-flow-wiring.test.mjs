import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// EMAIL_STUDIO_PLAN.md Wave 7, fix round: the path "Build a flow in Email Studio" takes from the
// sequence step's button to App and back. flow-from-step.test.mjs holds the pure plan and
// email-flow-create-route.test.mjs the route; editor-return-wiring.test.mjs holds the Edit path.
// These pins hold what the review found missing: App never passed the build handler down, so the
// button never built anything; a second press while the link or the save was on its way posted a
// second flow; and a built flow whose journey save failed was built again on the next press.
// The behaviour itself is the browser step canvas-build-flow (scripts/email-studio-browser-check.mjs).

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('./src/App.tsx');
const dock = read('./src/components/drawers/StepDock.tsx');
const inspector = read('./src/components/drawers/NodeInspector.tsx');
const editor = read('./src/components/drawers/SequenceEditor.tsx');

/** The source of one `const name = ...` in a file, up to the next blank line. */
const helper = (src, name) => {
  const start = src.indexOf(`const ${name}`);
  assert.ok(start > -1, `${name} is defined`);
  const end = src.indexOf('\n\n', start);
  return src.slice(start, end === -1 ? undefined : end);
};

test('App hands the build handler to the docked panel, and the panel to the sequence editor', () => {
  const start = app.indexOf('<StepDock');
  assert.ok(start > -1, 'App renders StepDock');
  const element = app.slice(start, app.indexOf('/>', start));
  assert.ok(element.includes('onBuildEmailFlow={handleBuildEmailFlow}'), 'App passes handleBuildEmailFlow to StepDock');
  assert.match(dock, /onBuildEmailFlow=\{onBuildEmailFlow\}/, 'StepDock passes it to NodeInspector');
  assert.ok(
    inspector.includes('onBuildEmailFlow={onBuildEmailFlow ? flow => onBuildEmailFlow(node.id, flow) : undefined}'),
    'NodeInspector binds it to the step it shows'
  );
  // The editor only builds when that prop arrived; without it the button falls back to the plain open.
  assert.match(editor, /if \(!data\.jourvanceFlowId && onBuildEmailFlow\) await buildFlow\(onBuildEmailFlow\);/);
});

test('App links the step before any save, and opens only through the save gate', () => {
  const build = helper(app, 'handleBuildEmailFlow');
  assert.match(build, /linkStepToFlow\(projectRef\.current, nodeId, flow, stamp\)/, 'a step that is not a sequence step on this journey is refused first');
  assert.match(build, /setProject\(cur => linkStepToFlow\(cur, nodeId, flow, stamp\) \?\? cur\)/, 'the link is applied to the journey as it is, not as the click saw it');
  assert.doesNotMatch(build, /saveNow|setActiveView|openAfterSave/, 'the build handler neither saves nor opens on its own');
  // The open waits for the linked journey and goes through handleOpenEmailStudio, so it saves first.
  const effect = app.slice(app.indexOf('const want = buildOpenRef.current;'));
  assert.ok(effect.length < app.length, 'the open effect reads the pending build');
  const body = effect.slice(0, effect.indexOf('}, [project]);'));
  assert.match(body, /funnelReturnFor\(project, want\.nodeId\)/);
  assert.match(body, /if \(ret && ret\.flowId !== want\.flowId\) return;/, 'it opens only once the step names the new flow');
  assert.match(body, /handleOpenEmailStudio\(want\.nodeId\)\.then\(want\.done\)/);
  // The editing hook's effect hands the journey to the save. Effects run in the order they are
  // declared, so this one must come after it, or the save would send the journey without the link.
  assert.ok(app.indexOf('const editing = useJourneyEditing(') > -1);
  assert.ok(app.indexOf('const editing = useJourneyEditing(') < app.indexOf('const want = buildOpenRef.current;'));
  const opens = app.match(/setActiveView\('email-studio'\)/g) || [];
  assert.equal(opens.length, 1, 'Email Studio still opens from one place');
});

test('a second press posts no second flow: the guard is set in the click and held until the open settles', () => {
  const open = helper(editor, 'openStudio');
  assert.match(open, /if \(!onOpenEmailStudio \|\| openingEmailStudio \|\| busyRef\.current\) return;/);
  const set = open.indexOf('busyRef.current = true;');
  assert.ok(set > -1 && set < open.indexOf('await'), 'the guard is set before the first await');
  const cleared = open.indexOf('busyRef.current = false;');
  assert.ok(cleared > open.indexOf('await buildFlow('), 'the guard is cleared only after the build, link and open settled');
  assert.match(open, /finally \{\s*busyRef\.current = false;\s*\}/);
  assert.equal((editor.match(/busyRef\.current = false;/g) || []).length, 1, 'nothing else lets go of the guard');
  // Both buttons call it with their own slot for the sentence.
  assert.ok(editor.includes("onClick={() => openStudio('picker')}"));
  assert.ok(editor.includes("onClick={() => openStudio('summary')}"));
});

test('a flow that was built is linked again, never posted again', () => {
  const build = helper(editor, 'buildFlow');
  assert.match(build, /let flow = builtRef\.current;\s*if \(!flow\) \{/);
  const post = build.indexOf("fetch('/api/email/flows'");
  assert.ok(post > build.indexOf('if (!flow) {'), 'the POST sits inside the not-yet-built branch');
  assert.ok(build.indexOf('builtRef.current = flow;') > post, 'a created flow is remembered as soon as it exists');
  assert.equal((editor.match(/fetch\('\/api\/email\/flows'/g) || []).length, 1, 'one place creates a flow');
});

test('the build is said in the status region, Edit says Saving, and an unlinked step says what Build does', () => {
  assert.match(editor, /\{buildingFlow \? FLOW_BUILDING : noticeAt === 'picker' \? studioNotice : ''\}/);
  assert.match(editor, /\{openingEmailStudio \? 'Saving\\u2026' : 'Edit in Email Studio'\}/);
  assert.match(editor, /noticeAt === 'summary' \? studioNotice : ''/);
  assert.match(editor, /stepLettersSource\(flowStartForStep\(data\.sequenceType\)\.label\)/);
  assert.ok(editor.includes('Read only here. Edit these emails in Email Studio.'));
});

test('every name the editor imports from editorReturn is used', () => {
  const m = /import \{([^}]*)\} from '\.\.\/\.\.\/lib\/editorReturn';/.exec(editor);
  assert.ok(m, 'SequenceEditor imports from editorReturn');
  const names = m[1].split(',').map(s => s.trim().replace(/^type\s+/, '')).filter(Boolean);
  assert.ok(names.length > 5);
  const rest = editor.slice(m.index + m[0].length);
  const unused = names.filter(name => !new RegExp(`\\b${name}\\b`).test(rest));
  assert.deepEqual(unused, []);
});
