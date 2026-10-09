import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// EMAIL_STUDIO_PLAN.md Wave 1. The owner could not click into a starter sequence or a built-in
// automation, and could not reach the builder from any of them: the cards had no click handler,
// the Flow map served both read-only, and their emails were edited in a textarea that flattened
// them to one text block. These pins hold the source shapes that open them and put the builder in
// the step panel, and the server lines the per-account content rides on. The behaviour is driven
// in real Chrome by scripts/email-studio-browser-check.mjs and on a bare Express app by
// email-flow-content-route.test.mjs.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const programs = read('./src/components/campaign/EmailPrograms.tsx');
const suite = read('./src/components/campaign/HubEmailSuite.tsx');
// Wave 4: the starter rows, starter cards and built-in cards became one Flows list in this file.
const list = read('./src/components/campaign/EmailFlowsList.tsx');
const map = read('./src/components/campaign/EmailFlowMap.tsx');
const server = read('./server.mjs');

/** The source from `start` up to (not including) `end`. Both must be found, in that order. */
function between(src, start, end, name) {
  const from = src.indexOf(start);
  assert.ok(from > -1, `${name}: "${start}" was not found`);
  const to = src.indexOf(end, from + start.length);
  assert.ok(to > from, `${name}: "${end}" was not found after "${start}"`);
  return src.slice(from, to);
}

test('every row on All flows is one real button that opens the flow on its first email', () => {
  // Wave 4 (D3): the starter rows and starter cards this pinned are one list now. Each row is a
  // button, and it opens the editor on that flow with its first email chosen.
  const row = between(list, 'const renderRow = (row: FlowRow) => {', 'const flowList =', 'a Flows list row');
  assert.match(row, /<button\s+type="button"\s+data-flow-row=\{row\.id\}/);
  assert.ok(row.includes('onClick={() => onOpenFlow(row.id, row.firstEmailId || undefined)}'), 'a row does not open its flow on its first email');
  assert.doesNotMatch(row, /queue sequence/, 'a row still says "queue sequence"');
  // Rows for every kind come from the one list: starters and built-ins are not drawn anywhere else.
  assert.match(list, /\{flowList\.length > 0 && <ul aria-label="Flows" style=\{listStyle\}>\{flowList\.map\(renderRow\)\}<\/ul>\}/);
  assert.match(list, /<ul aria-labelledby=\{orderHeadingId\} style=\{listStyle\}>\{orderList\.map\(renderRow\)\}<\/ul>/);
  // The intro no longer says the two built-ins are what the queue below sends.
  assert.ok(list.includes('Starter flows run for every new lead or checkout. Built-in flows stay off until you turn them on.'));
  assert.ok(!list.includes('Welcome and abandoned checkout already run from the queue below.'));
});

test('the Flows list edits no email itself, and Turn on or off sends no steps', () => {
  // Wave 4 removed AutomationCard (and the order letter cards): a flow's emails are edited in the
  // builder on the Flow map, so nothing on the list can flatten or overwrite one.
  assert.ok(!programs.includes('const AutomationCard'), 'AutomationCard is still in EmailPrograms.tsx');
  assert.ok(!programs.includes('const LetterCard'), 'the order letter cards are still in EmailPrograms.tsx');
  assert.doesNotMatch(programs, /mode === 'automations'|mode === 'transactional'/);
  assert.doesNotMatch(list, /<textarea/, 'the Flows list edits a body in a textarea');
  assert.doesNotMatch(list, /<input/, 'the Flows list edits a field in an input');
  assert.doesNotMatch(list, /Save steps/);
  // Turn on and Turn off send only whether it is on, so a stale list can never overwrite an edit made on the map.
  const toggle = between(list, 'const toggle = async (row: FlowRow) => {', 'const renderRow', 'toggle');
  assert.ok(toggle.includes('body: JSON.stringify(own ? { enabled: next } : { kind: row.toggleKind, enabled: next })'));
  assert.doesNotMatch(toggle, /steps|blocks|subject/);
});

test('the duplicate starter cards are gone, and every count reads the real number of emails', () => {
  // Wave 4: the starter cards listed each starter flow a second time beside its row. They are gone,
  // with their Edit emails buttons and their email tiles; the list's row opens the flow instead.
  const flows = between(suite, "{activeTab === 'flows' && (", "{activeTab === 'map' && <EmailFlowMap", 'the Flows section');
  assert.doesNotMatch(flows, /dripSequences\.map\(seq =>/, 'a starter card is still drawn');
  assert.doesNotMatch(flows, /Edit emails/, 'a duplicate Edit emails button is still on the Flows section');
  // The email node ids the editor opens on are chainGraph's, so the list's first email is a real node.
  assert.ok(server.includes('const emailId = `${prefix}_email_${index}`;'), 'chainGraph no longer names email nodes <prefix>_email_<index>');
  // The step counts read the real number of emails.
  assert.ok(!suite.includes('Completed 3-Steps'));
  assert.ok(!suite.includes('of 3</td>'));
  assert.ok(flows.includes("Step {enr.currentStepIndex + 1}{stepCountOf(enr.sequenceId) ? ` of ${stepCountOf(enr.sequenceId)}` : ''}"), 'the people table does not count the flow\'s own emails');
  assert.ok(list.includes('{emailCountText(row.emails)}'), 'a row does not print its counted emails');
});

test('Email Studio opens the Flow map on a flow from inside, and the tab strip clears it', () => {
  const open = between(suite, 'const openFlowInMap', '};', 'openFlowInMap');
  assert.match(open, /setMapFlowId\(flowId\);\s*setMapNodeId\(nodeId \|\| ''\);\s*setActiveTab\('map'\);/);
  assert.match(suite, /onClick=\{\(\) => \{ setMapFlowId\(''\); setMapNodeId\(''\); setActiveTab\(tab\.key as any\); \}\}/);
  assert.ok(suite.includes("<EmailFlowMap initialFlowId={mapFlowId || openFlowId} initialNodeId={mapNodeId || undefined} fromStep={!mapFlowId} onContentSaved={refreshSequences} />"));
  // The starter cards read the sequences again once their emails are saved on the map.
  assert.match(between(suite, 'const refreshSequences', '};', 'refreshSequences'), /fetch\('\/api\/drips\/sequences'/);
  // Wave 4: the Flows list opens a flow through the same function, on the step a row names.
  assert.ok(suite.includes('<EmailFlowsList onOpenFlow={openFlowInMap} sequences={dripSequences} onRefresh={loadData} />'));
});

test('the Flow map shows the step panel for a starter or built-in flow, with the builder in it', () => {
  // The gate: an account flow, or a flow whose emails can be edited.
  assert.match(map, /\{\(current\?\.editable \|\| current\?\.contentEditable\) && \(\s*<div style=\{\{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 \}\}>/, 'the step panel is not shown for contentEditable');
  assert.match(map, /if \(!current\?\.editable && !current\?\.contentEditable\) return;/, 'patchNode refuses a contentEditable flow');
  assert.match(map, /contentEditable\?: boolean;/);
  // Flow-level controls stay account-flow only: the panel opens with them behind current.editable.
  const panel = map.slice(map.indexOf('{(current?.editable || current?.contentEditable) && ('));
  const flowLevel = between(panel, '{current.editable && (', '{selectedNode && (', 'flow-level controls');
  for (const control of ['>Name<', '>Starts when<', '>Re-entry<', '>Account timezone<', '>Add wait<', '>Add email<', '>Remove step<', '>Connect<']) {
    assert.ok(flowLevel.includes(control), `${control} is not behind current.editable`);
  }
  // The email step: Subject, Preview text, then the builder in place of the old textarea.
  const email = between(map, "{selectedNode?.type === 'email' && (", "{selectedNode?.type === 'delay'", 'email branch');
  assert.match(email, /<BlockEditor blocks=\{selectedNode\.blocks \|\| \[\]\} onChange=\{\(blocks\) => patchNode\(selectedNode\.id, \{ blocks \}\)\} \/>/);
  assert.doesNotMatch(email, /<textarea/, 'the email step still flattens the body into a textarea');
  assert.ok(email.indexOf('>Subject<') < email.indexOf('>Preview text<') && email.indexOf('>Preview text<') < email.indexOf('<BlockEditor'));
  // The options the drip sender never reads stay account-flow only.
  const advanced = email.slice(email.indexOf('{current.editable && ('));
  assert.ok(email.indexOf('{current.editable && (') > email.indexOf('<BlockEditor'), 'the advanced options are not after the builder');
  for (const option of ['>Status<', 'Send at their hour', 'Transactional, no marketing unsubscribe', '>From name<', '>Reply-to<', 'Klaviyo flow for this email']) {
    assert.ok(advanced.includes(option), `${option} is not behind current.editable`);
  }
  // The Klaviyo HTML branch is kept.
  assert.ok(email.includes("selectedNode.blocks?.[0]?.kind === 'html' ?"));
});

test('a wait on a starter or built-in flow is one field in hours, from 1 to 2160', () => {
  const wait = between(map, "{selectedNode?.type === 'delay' && !current.editable && (", "{selectedNode?.type === 'delay' && current.editable && (", 'content wait');
  assert.match(wait, /htmlFor="flow-step-wait">Wait, in hours</);
  assert.match(wait, /min=\{1\}\s+max=\{2160\}/);
  assert.match(map, /hours >= 1 && hours <= 2160/);
  // 0 is refused before anything is sent: the sender reads 0 as 24.
  const save = between(map, 'const saveContent = async', 'const saveTimezone', 'saveContent');
  assert.ok(save.indexOf('waitHoursOk(node.delayHours)') > -1 && save.indexOf('waitHoursOk(node.delayHours)') < save.indexOf('fetch('), 'a bad wait is not refused before the request');
  assert.match(save, /setNotice\(FLOW_MAP_WRITE_UNREACHABLE\.content\);/);
  assert.ok(save.includes("'Saved. Every email sent from now on uses this version, including for people already in this flow.'"));
});

test('the selected step is drawn, and its heading takes focus', () => {
  const node = between(map, 'const MailNode', 'const nodeTypes', 'MailNode');
  assert.match(node, /\(\{ data, selected \}/, 'MailNode does not read selected');
  assert.match(node, /selected \? '2px solid #f472b6'/);
  assert.match(map, /selected: node\.id === selectedId/);
  assert.match(map, /<h3 ref=\{stepHeadingRef\} tabIndex=\{-1\}/);
  const effect = between(map, 'const heading = stepHeadingRef.current;', '}, [stepFocus]);', 'focus effect');
  assert.match(effect, /heading\.focus\(/);
  assert.match(effect, /heading\.scrollIntoView\(\{ behavior: 'auto'/);
  assert.match(map, /onNodeClick=\{\(_, node\) => selectNode\(node\.id\)\}/);
  // A button inside Email Studio never says the linked flow is missing (rule 5, D7).
  assert.match(map, /if \(asked && fromStep && pick\.missing\) setNotice\(LINKED_FLOW_MISSING\);/);
});

test('server: the drip sender sends the account version of each starter email', () => {
  const tick = between(server, 'async function processUserAutomationsTick', '\nasync function ', 'processUserAutomationsTick');
  assert.match(tick, /sequenceStepsFor\(/, 'the sender does not call sequenceStepsFor(');
  assert.doesNotMatch(tick, /seq\.steps\[enr\.currentStepIndex\]/, 'the sender still reads the shared step');
  assert.doesNotMatch(tick, /seq\.steps\.length/, 'the sender still counts the shared steps');
  // The shared body only when the account's blocks hold nothing to read, never an email with only a footer.
  assert.match(tick, /emailHasContent\(step\.blocks\) \? step\.blocks : \[\{ kind: 'text', text: step\.body \|\| '' \}\]/);
});

test('server: the account content survives an unrelated save, and the map keeps preview text', () => {
  const bag = between(server, 'function userProgramBag(uid)', '\nfunction ', 'userProgramBag');
  assert.match(bag, /cleanAccountSequences\(saved\.sequences, cleanSteps\)/);
  assert.match(bag.slice(bag.lastIndexOf('return {')), /\bsequences\b/, 'userProgramBag does not return sequences');
  const write = between(server, 'function writeUserPrograms(uid, bag, edits = {})', '\nfunction ', 'writeUserPrograms');
  // Only a caller that edits them writes them; every other save keeps what is stored.
  assert.ok(write.includes('sequences: cleanAccountSequences(edits.sequences ? bag.sequences : previous.sequences, cleanSteps)'), 'writeUserPrograms lets an unrelated save write sequences');
  assert.ok(write.includes('edits.steps || !Array.isArray(storedSteps) ? row.steps : storedSteps'), 'writeUserPrograms lets an unrelated save write built-in steps');
  const chain = between(server, 'function chainGraph(prefix, steps)', '\nfunction ', 'chainGraph');
  assert.match(chain, /previewText: step\.previewText/, 'chainGraph does not put previewText on the email node');
});

test('the new copy has no em dash and no spaced en dash', () => {
  const added = [['EmailFlowsList.tsx', list], ['EmailStepPreview.tsx', read('./src/components/campaign/EmailStepPreview.tsx')], ['emailFlowsList.ts', read('./src/lib/emailFlowsList.ts')]];
  for (const [name, src] of [['EmailPrograms.tsx', programs], ['HubEmailSuite.tsx', suite], ['EmailFlowMap.tsx', map], ...added]) {
    const lines = src.split('\n').map((line, i) => `${i + 1}: ${line.trim()}`).filter((line) => /—| – /.test(line));
    assert.deepEqual(lines, [], `${name} has a dash`);
  }
});
