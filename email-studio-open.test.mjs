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

test('each starter row on Automations is a real button that opens the flow', () => {
  const rows = between(programs, 'suite.installed.map((row) =>', 'suite.automations.map((row) =>', 'starter rows');
  assert.match(rows, /<button type="button"[^>]*aria-label=\{`Edit emails in \$\{row\.name\}`\}[^>]*onClick=\{\(\) => onOpenFlow\(row\.id\)\}>Edit emails<\/button>/);
  assert.doesNotMatch(rows, /queue sequence/, 'the row still says "queue sequence"');
  // The intro no longer says the two built-ins are what the queue below sends.
  assert.ok(programs.includes('Starter flows run for every new lead or checkout. Built-in flows stay off until you turn them on.'));
  assert.ok(!programs.includes('Welcome and abandoned checkout already run from the queue below.'));
});

test('a built-in card lists its emails, opens them in the builder, and has no textarea', () => {
  const card = between(programs, 'const AutomationCard', 'const LetterCard', 'AutomationCard');
  assert.doesNotMatch(card, /<textarea/, 'AutomationCard still edits a body in a textarea');
  assert.doesNotMatch(card, /<input/, 'AutomationCard still edits a subject in an input');
  assert.doesNotMatch(card, /Save steps/);
  assert.match(card, /<button type="button"[^>]*aria-label=\{`Edit emails in \$\{row\.name\}`\}[^>]*onClick=\{\(\) => onOpenFlow\(row\.id\)\}>Edit emails<\/button>/);
  assert.match(card, /Email \{index \+ 1\}: \{step\.subject\} · \{waitText\(step\.delayHours\)\}/);
  // Turn on and Turn off send no steps, so a stale card can never overwrite an edit made on the map.
  assert.match(card, /onSave\(row\.id, 'automation', \{ enabled: !row\.enabled \}\)/);
  assert.doesNotMatch(card, /steps \}\)/);
});

test('each starter card has Edit emails, and each of its emails is a button that opens that email', () => {
  const cards = between(suite, 'dripSequences.map(seq =>', 'Recent Enrollments Stream', 'starter cards');
  assert.match(cards, /<button\s+type="button"\s+aria-label=\{`Edit emails in \$\{seq\.name\}`\}\s+onClick=\{\(\) => openFlowInMap\(seq\.id\)\}/);
  assert.match(cards, />\s*Edit emails\s*<\/button>/);
  // The tile opens `<sequence id>_email_<index>`, the id chainGraph gives that email node.
  assert.match(cards, /seq\.steps\.map\(\(step, index\) => \(\s*<button\s+type="button"/);
  // The label names the email by its subject too, since aria-label replaces the tile's own text.
  assert.match(cards, /aria-label=\{`Email \$\{index \+ 1\} of \$\{seq\.steps\.length\} in \$\{seq\.name\}: \$\{step\.subject\}`\}/);
  assert.match(cards, /onClick=\{\(\) => openFlowInMap\(seq\.id, `\$\{seq\.id\}_email_\$\{index\}`\)\}/);
  assert.ok(server.includes('const emailId = `${prefix}_email_${index}`;'), 'chainGraph no longer names email nodes <prefix>_email_<index>');
  // A button holds only phrasing content.
  const tile = cards.slice(cards.indexOf('seq.steps.map((step, index)'));
  assert.doesNotMatch(tile.slice(0, tile.indexOf('</button>')), /<div/, 'a div inside the email button');
  // The step counts read the real number of emails.
  assert.ok(!suite.includes('Completed 3-Steps'));
  assert.ok(!suite.includes('of 3</td>'));
  assert.match(suite, /Completed all \$\{seq\.steps\.length\} emails:/);
});

test('Email Studio opens the Flow map on a flow from inside, and the tab strip clears it', () => {
  const open = between(suite, 'const openFlowInMap', '};', 'openFlowInMap');
  assert.match(open, /setMapFlowId\(flowId\);\s*setMapNodeId\(nodeId \|\| ''\);\s*setActiveTab\('map'\);/);
  assert.match(suite, /onClick=\{\(\) => \{ setMapFlowId\(''\); setMapNodeId\(''\); setActiveTab\(tab\.key as any\); \}\}/);
  assert.ok(suite.includes("<EmailFlowMap initialFlowId={mapFlowId || openFlowId} initialNodeId={mapNodeId || undefined} fromStep={!mapFlowId} onContentSaved={refreshSequences} />"));
  // The starter cards read the sequences again once their emails are saved on the map.
  assert.match(between(suite, 'const refreshSequences', '};', 'refreshSequences'), /fetch\('\/api\/drips\/sequences'/);
  assert.ok(suite.includes('<EmailPrograms mode="automations" onOpenFlow={(id) => openFlowInMap(id)} />'));
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
  for (const [name, src] of [['EmailPrograms.tsx', programs], ['HubEmailSuite.tsx', suite], ['EmailFlowMap.tsx', map]]) {
    const lines = src.split('\n').map((line, i) => `${i + 1}: ${line.trim()}`).filter((line) => /—| – /.test(line));
    assert.deepEqual(lines, [], `${name} has a dash`);
  }
});
