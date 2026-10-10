import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TRIGGER_META } from './email-flows.mjs';
import { signalStarterFlows } from './shopify-signals.mjs';
import { FLOW_MAP_UNREACHABLE } from './src/lib/flowMapLoad.ts';
import { isStarterDraft, starterFlowOn } from './email-flow-content.mjs';

// EMAIL_STUDIO_PLAN.md Wave 4: Flows is one list and one editor. Every flow (the account's own, the
// built-in and the starter flows, and the four order emails as one-email flows) is one row from one
// read of GET /api/email/flow-map. src/lib/emailFlowsList.ts is the row model; these tests feed it a
// payload drawn by server.mjs's OWN presenters and chainGraph, sliced out of the file and run here
// (server.mjs is never booted), so what is pinned is what the list makes of what the server sends.
// The behaviour in Chrome is scripts/email-studio-browser-check.mjs (flows-one-list, flows-row-open,
// order-email-builder, delete-asks, panel-beside, panel-below).

const {
  FLOW_GROUPS, FLOW_TAGS, FLOWS_FAILED, FLOWS_FIGURES_UNCOUNTED, FLOWS_NOT_CONNECTED, FLOWS_SIGN_IN, START_ALIASES, START_WORDS,
  emailCount, emailCountText, figuresLeftOut, flowRows, flowStateText, flowStepName, flowStepOrder, flowsListLoad, groupFlowRows,
  starterOffNotice, startsWhenText, stateWarns, switchRequest, switchText, waitWords
} = await import('./src/lib/emailFlowsList.ts');

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const SERVER_SRC = read('./server.mjs');
const map = read('./src/components/campaign/EmailFlowMap.tsx');
const list = read('./src/components/campaign/EmailFlowsList.tsx');
const suite = read('./src/components/campaign/HubEmailSuite.tsx');

function slice(from, to) {
  const start = SERVER_SRC.indexOf(from);
  assert.ok(start >= 0, `server.mjs no longer contains ${JSON.stringify(from)}`);
  const end = SERVER_SRC.indexOf(to, start + from.length);
  assert.ok(end > start, `server.mjs no longer contains ${JSON.stringify(to)} after ${JSON.stringify(from)}`);
  return SERVER_SRC.slice(start, end + to.length);
}

/** The source from `start` up to (not including) `end`. Both must be found, in that order. */
function between(src, start, end, name) {
  const from = src.indexOf(start);
  assert.ok(from > -1, `${name}: "${start}" was not found`);
  const to = src.indexOf(end, from + start.length);
  assert.ok(to > from, `${name}: "${end}" was not found after "${start}"`);
  return src.slice(from, to);
}

// The flow-map payload for an account that has edited nothing, drawn by server.mjs's own code.
const server = new Function('isStarterDraft', 'starterFlowOn', `
  ${slice('function block(id, kind, text, extra) {', '\n}\n')}
  ${slice('const TRANSACTIONAL_DEFAULTS = [', '\n];\n')}
  ${slice('const AUTOMATION_DEFAULTS = [', '\n];\n')}
  ${slice('const INITIAL_DRIP_SEQUENCES = [', '\n];\n')}
  ${slice('function chainGraph(prefix, steps) {', '\n}\n')}
  function sequenceStepsFor(seq) { return seq.steps || []; }
  ${slice('// D3: what the step panel says', '\n}\n')}
  ${slice('function presentAutomationRow(row) {', '\n}\n')}
  ${slice('// D2 and Wave 4: an order email as a one-email flow', '\n}\n')}
  return { TRANSACTIONAL_DEFAULTS, AUTOMATION_DEFAULTS, INITIAL_DRIP_SEQUENCES, presentSequenceRow, presentAutomationRow, presentOrderEmailRow };
`)(isStarterDraft, starterFlowOn);

const sequences = server.INITIAL_DRIP_SEQUENCES.filter((seq) => !seq.userId);
const own = signalStarterFlows();
function payload() {
  return {
    success: true,
    hubConnected: true,
    triggers: TRIGGER_META,
    flows: [
      ...own.map((flow) => ({ id: flow.id, name: flow.name, kind: 'flow', editable: true, enabled: flow.enabled === true, trigger: flow.trigger, nodes: flow.nodes, edges: flow.edges, enrolled: null })),
      ...server.AUTOMATION_DEFAULTS.map((row) => server.presentAutomationRow({ ...row, enabled: false })),
      ...sequences.map((seq) => server.presentSequenceRow(seq, {})),
      ...server.TRANSACTIONAL_DEFAULTS.map((row) => server.presentOrderEmailRow({ ...row, enabled: false }))
    ]
  };
}
const sends = (node) => node.type === 'email' || node.type === 'ab';

test('the payload is the real one: 12 flows and 4 order emails, as the browser check counts them', () => {
  const { flows } = payload();
  assert.equal(flows.filter((flow) => flow.kind !== 'order').length, 12);
  assert.equal(flows.filter((flow) => flow.kind === 'order').length, 4);
});

test('a row counts its emails from the flow\'s own steps, never a constant', () => {
  const { flows, triggers } = payload();
  const rows = flowRows(flows, triggers);
  for (const row of rows) {
    const flow = flows.find((item) => item.id === row.id);
    assert.equal(row.emails, flow.nodes.filter(sends).length, `${row.name}`);
  }
  // Against the seeds themselves, not only against the graph: a starter flow has one email per step.
  for (const seq of sequences) assert.equal(rows.find((row) => row.id === seq.id).emails, seq.steps.length, seq.name);
  for (const auto of server.AUTOMATION_DEFAULTS) assert.equal(rows.find((row) => row.id === auto.id).emails, auto.steps.length, auto.name);
  for (const letter of server.TRANSACTIONAL_DEFAULTS) assert.equal(rows.find((row) => row.id === letter.id).emails, 1, letter.name);
  // The sunset flow sends nothing, and says so.
  const sunset = rows.find((row) => row.id === 'flow_sunset');
  assert.equal(sunset.emails, 0);
  assert.equal(emailCountText(sunset.emails), 'No emails');
  // So many different counts that no constant can pass.
  const counts = new Set(rows.map((row) => row.emails));
  assert.ok(counts.size >= 3, `only ${[...counts].join(', ')}`);
  // An A/B step sends one of its variations (email-flows.mjs), so it counts as an email.
  assert.equal(emailCount([{ id: 't', type: 'trigger' }, { id: 'a', type: 'ab' }, { id: 'e', type: 'email' }, { id: 's', type: 'sms' }, { id: 'w', type: 'delay' }]), 2);
  assert.equal(emailCountText(1), '1 email');
  assert.equal(emailCountText(3), '3 emails');
});

test('each flow is in the list once, in its group, with its tag and its first email', () => {
  const { flows, triggers } = payload();
  // The same flow sent twice, and rows that are not flows at all, still make one row each.
  const doubled = [...flows, flows[0], { ...flows[5], name: 'A second name' }, { name: 'No id' }, { id: '', name: 'Blank id' }, null, 'junk'];
  const rows = flowRows(doubled, triggers);
  const ids = rows.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, `an id is listed twice: ${ids.join(', ')}`);
  assert.deepEqual(ids, flows.map((flow) => flow.id), 'the list is not the flow map, once each, in its order');
  assert.equal(rows.find((row) => row.id === flows[5].id).name, flows[5].name, 'a repeat replaced the first row');
  for (const row of rows) {
    const flow = flows.find((item) => item.id === row.id);
    assert.equal(row.tag, FLOW_TAGS[flow.kind]);
    assert.equal(row.group, flow.kind === 'order' ? 'order' : 'flows');
    assert.equal(row.firstEmailId, flow.nodes.find(sends)?.id || '', `${row.name} opens on the wrong step`);
    // Every row can be turned on or off from the list (Wave 4 fix round; a starter's since Wave 2).
    assert.equal(row.toggleKind, { flow: 'flow', automation: 'automation', order: 'transactional', sequence: 'sequence' }[flow.kind]);
  }
  assert.deepEqual(
    Object.fromEntries(['flow', 'automation', 'sequence', 'order'].map((kind) => [kind, rows.filter((row) => row.kind === kind).length])),
    { flow: own.length, automation: server.AUTOMATION_DEFAULTS.length, sequence: sequences.length, order: server.TRANSACTIONAL_DEFAULTS.length }
  );
  assert.deepEqual(FLOW_TAGS, { flow: '', automation: 'Built in', sequence: 'Starter', order: 'Order email' });
  // On or Off is the flow's own. A starter flow has no switch yet, and the server sends it as on.
  const on = flowRows([{ ...flows[0], enabled: true }, { ...flows[6], enabled: true }, { ...flows[9], enabled: false }], triggers);
  assert.deepEqual(on.map((row) => row.on), [true, true, false]);
  assert.equal(flowRows([{ id: 'x', name: 'X', kind: 'flow' }], triggers)[0].on, false, 'a flow with no enabled reads On');
  // Enrolled is what the server measured or null, never a 0 nobody counted.
  assert.equal(flowRows([{ ...flows[0], enrolled: 4 }], triggers)[0].enrolled, 4);
  assert.equal(flowRows([{ ...flows[0], enrolled: undefined }], triggers)[0].enrolled, null);
});

test('"Starts when" is worded by TRIGGER_META, the server\'s own words', () => {
  const { flows, triggers } = payload();
  const rows = flowRows(flows, triggers);
  const meta = new Map(TRIGGER_META.map((row) => [row.id, row.label]));
  let worded = 0;
  for (const row of rows) {
    const trigger = flows.find((item) => item.id === row.id).trigger;
    if (meta.has(trigger)) {
      assert.equal(row.startsWhen, meta.get(trigger), `${row.name} starts on ${trigger}`);
      worded += 1;
    } else if (Object.hasOwn(START_ALIASES, trigger)) {
      assert.equal(row.startsWhen, meta.get(START_ALIASES[trigger]), `${row.name}'s alias ${trigger}`);
    } else {
      assert.equal(row.startsWhen, START_WORDS[trigger], `${row.name} starts on ${trigger}, which has no words`);
    }
    assert.ok(row.startsWhen && !row.startsWhen.includes('_'), `${row.name} reads "${row.startsWhen}"`);
  }
  assert.ok(worded >= 11, `only ${worded} rows were worded by TRIGGER_META`);
  // Every alias points at a TRIGGER_META entry, and no extra word stands in for one TRIGGER_META has.
  for (const target of Object.values(START_ALIASES)) assert.ok(meta.has(target), target);
  for (const key of [...Object.keys(START_ALIASES), ...Object.keys(START_WORDS)]) assert.ok(!meta.has(key), `${key} is in TRIGGER_META already`);
  // The order emails start on the event that sends them.
  assert.equal(rows.find((row) => row.id === 'order_confirmation').startsWhen, meta.get('order_paid'));
  assert.equal(rows.find((row) => row.id === 'refund').startsWhen, meta.get('order_refunded'));
  // A start nobody words falls back to plain words, never an id or a blank; an own key is never read through the prototype.
  assert.equal(startsWhenText('some_new_start', TRIGGER_META), 'some new start');
  assert.equal(startsWhenText('', TRIGGER_META), 'Not set');
  assert.equal(startsWhenText('constructor', TRIGGER_META), 'constructor');
  assert.equal(startsWhenText('toString', []), 'toString');
});

test('a failed read says so, and never shows an empty list', () => {
  assert.deepEqual(flowsListLoad({ answered: false }), { state: 'failed', text: FLOW_MAP_UNREACHABLE, retry: true });
  assert.deepEqual(flowsListLoad({ answered: true, status: 401, data: { success: false } }), { state: 'failed', text: FLOWS_SIGN_IN, retry: false });
  assert.deepEqual(flowsListLoad({ answered: true, status: 500, data: {} }), { state: 'failed', text: FLOWS_FAILED, retry: true });
  assert.deepEqual(flowsListLoad({ answered: true, status: 200, data: { success: true } }), { state: 'failed', text: FLOWS_FAILED, retry: true });
  assert.deepEqual(flowsListLoad({ answered: true, status: 200, data: { success: false, flows: [] } }), { state: 'failed', text: FLOWS_FAILED, retry: true });
  assert.deepEqual(flowsListLoad({ answered: true, status: 200, data: payload() }), { state: 'loaded' });
  for (const sentence of [FLOWS_SIGN_IN, FLOWS_FAILED, FLOWS_NOT_CONNECTED, ...Object.values(START_WORDS)]) assert.doesNotMatch(sentence, /—| – /);
  // The list keeps its last rows on a failure: it sets them only once the read loaded.
  const readFn = between(list, 'const read = async () => {', 'useEffect(() => { read(); }, []);', 'the list read');
  assert.ok(readFn.indexOf("if (outcome.state !== 'loaded' || !settled.answered) return;") < readFn.indexOf('setRows('), 'a failed read can empty the list');
  assert.ok(list.includes('{load.state === \'loaded\' && !hubConnected && ('), 'the not-connected sentence is not shown');
});

test('Delete asks first, naming the flow, and a Cancel sends nothing', () => {
  const remove = between(map, 'const remove = async () => {', 'const patchNode', 'remove');
  const asks = remove.indexOf('if (!window.confirm(`Delete the flow "${savedName}"?');
  const sends = remove.indexOf("sendFlowWrite(async () => fetch(`/api/email/flows/${current.id}`, { method: 'DELETE'");
  assert.ok(asks > -1, 'Delete does not ask before it deletes');
  assert.ok(sends > asks, 'the DELETE is sent before the question');
  assert.match(remove.slice(asks, sends), /\)\) return;/, 'a Cancel does not stop the delete');
  // The name asked about is the saved one, so an unsaved rename is not the name in the question.
  assert.match(remove, /const savedName = flows\.find\(\(flow\) => flow\.id === current\.id\)\?\.name \|\| current\.name;/);
  // Delete is still only for the account's own flows.
  assert.ok(remove.indexOf('if (!current?.editable) return;') < asks);
});

test('the editor: the panel beside the map from 900px, the flow settings closed, the order email without preview text', () => {
  assert.ok(map.includes("const BESIDE_QUERY = '(min-width: 900px)';"));
  assert.match(map, /flexDirection: beside \? 'row' : 'column'/);
  // The flow's own settings sit in a closed disclosure named Flow settings, from Name to the timezone.
  const settings = between(map, '<details style=', '</details>', 'Flow settings');
  assert.ok(!/<details[^>]*\bopen\b/.test(settings), 'Flow settings opens already open');
  assert.match(settings, />Flow settings<\/summary>/);
  for (const control of ['>Name<', '>Starts when<', '>Re-entry<', '>Account timezone<']) assert.ok(settings.includes(control), `${control} is not under Flow settings`);
  for (const control of ['>Add wait<', '>Remove step<']) assert.ok(!settings.includes(control), `${control} is hidden under Flow settings`);
  // The editor's own flow list is a picker now; All flows is the one list.
  assert.ok(!map.includes("borderColor: flow.id === currentId ? 'rgba(244,114,182,0.7)'"), 'the editor still draws a second list of flows');
  assert.match(map, /<label style=\{label\} htmlFor="flow-picker">Flow to edit<\/label>\s*<select id="flow-picker" style=\{field\} value=\{currentId\} onChange=\{\(e\) => choose\(e\.target\.value\)\}>/);
  // An order email stores no preview text, so it shows no field for one; it keeps its sample preview.
  assert.match(map, /\{current\.kind !== 'order' && \(\s*<>\s*<label style=\{label\} htmlFor="flow-step-preview">Preview text<\/label>/);
  assert.ok(map.includes("{current.kind === 'order' && <EmailStepPreview key={current.id}"));
});

test('All flows: the hub flows are a closed group at the foot, and no text in the new files is under 11px', () => {
  const flows = between(suite, "{activeTab === 'flows' && (", "{activeTab === 'map' && <EmailFlowMap", 'the Flows section');
  const hub = flows.slice(flows.indexOf('From the hub, export only') - 200);
  assert.match(hub, /<details style=\{STUDIO_GROUP\}>\s*<summary style=\{STUDIO_GROUP_SUMMARY\}>From the hub, export only<\/summary>/);
  assert.ok(flows.indexOf('From the hub, export only') > flows.indexOf('<EmailFlowsList'), 'the hub group is not under the list');
  assert.doesNotMatch(flows, /<details[^>]*\bopen\b/, 'a group on the Flows section opens already open');
  assert.ok(flows.includes("minmax(min(460px, 100%), 1fr)"), 'a hub card is wider than a phone');
  for (const [name, src] of [['EmailFlowsList.tsx', list], ['EmailStepPreview.tsx', read('./src/components/campaign/EmailStepPreview.tsx')]]) {
    const sizes = [...src.matchAll(/fontSize:\s*['"]?(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    assert.ok(sizes.length >= 1, `${name}: font sizes not found`);
    assert.deepEqual(sizes.filter((px) => px < 11), [], `${name} sets text under 11px`);
  }
});

test('server: GET /api/email/flow-map serves the four order emails, last, through presentOrderEmailRow', () => {
  // The route is inline in server.mjs and is never booted here, so this pins its source: the list is
  // one read because the order emails ride on it.
  const route = between(SERVER_SRC, "app.get('/api/email/flow-map', requireUser, (req, res) => {", '\n});\n', 'the flow-map route');
  assert.match(route, /const orderEmails = bag\.transactional\.map\(\(row\) => presentOrderEmailRow\(row\)\);/);
  assert.match(route, /flows: \[[^\]]*\.\.\.sequences, \.\.\.orderEmails\]/, 'the order emails are not the last rows of the flow map');
  // The content route is handed what it needs to save one.
  const ctx = between(SERVER_SRC, 'const emailFlowContentCtx = {', '};', 'emailFlowContentCtx');
  for (const name of ['cleanBlocks', 'presentOrderEmailRow']) assert.match(ctx, new RegExp(`\\b${name},?\\n`), `${name} is not on the flow-content context`);
});

// ---- Wave 4 fix round ----

test('a row of a kind the list does not know is dropped, never shown as an account flow', () => {
  const { flows, triggers } = payload();
  const strangers = [
    { id: 'hub_flow_1', name: 'From the hub', kind: 'hub', enabled: true, nodes: [{ id: 'e', type: 'email' }] },
    { id: 'odd_1', name: 'Odd', kind: 'weird' },
    { id: 'none_1', name: 'No kind' },
    { id: 'proto_1', name: 'Proto', kind: 'constructor' }
  ];
  const rows = flowRows([...strangers, ...flows], triggers);
  assert.deepEqual(rows.map((row) => row.id), flows.map((flow) => flow.id), 'a row of an unknown kind is listed');
  // An unknown row does not take the id of a real one that comes after it.
  const shadow = { id: flows[0].id, name: 'A shadow', kind: 'hub' };
  const after = flowRows([shadow, flows[0]], triggers);
  assert.deepEqual(after.map((row) => [row.id, row.name, row.kind]), [[flows[0].id, flows[0].name, 'flow']]);
});

test('Turn on and Turn off: the accessible name begins with the word on the button, Saving included', () => {
  for (const on of [true, false]) {
    for (const busy of [true, false]) {
      const { text, label } = switchText({ name: 'After the order', on }, busy);
      assert.equal(text, busy ? 'Saving' : on ? 'Turn off' : 'Turn on');
      assert.equal(label, `${text} After the order`, `on ${on}, busy ${busy}`);
    }
  }
  // The list draws both from switchText, so what is shown and what is announced cannot part.
  const button = between(list, '<button\n          type="button"\n          data-flow-switch={row.id}', '</button>', 'the switch');
  assert.match(button, /aria-label=\{label\.label\}/);
  assert.match(button, />\s*\{label\.text\}\s*$/);
  assert.match(list, /const label = switchText\(row, switching === row\.id\);/);
  // Wave 2: every row has its switch, a starter's included, so the "Always on" sentence is gone.
  assert.doesNotMatch(list, /row\.toggleKind \?|STARTER_NO_SWITCH|Always on/);
  // Each kind is switched through its own route with only `enabled` (and the kind the programs route needs).
  const toggle = between(list, 'const toggle = async (row: FlowRow) => {', 'const renderRow', 'toggle');
  assert.ok(toggle.includes('const request = switchRequest(row, next);'), 'the switch does not build its request with switchRequest');
  assert.ok(toggle.includes('fetch(request.url, {') && toggle.includes('body: JSON.stringify(request.body)'), 'the switch does not send what switchRequest built');
  const sent = (toggleKind) => switchRequest({ id: 'a b', toggleKind }, false);
  assert.deepEqual(sent('flow'), { url: '/api/email/flows/a%20b', body: { enabled: false } });
  assert.deepEqual(sent('sequence'), { url: '/api/email/flow-content/a%20b', body: { enabled: false } });
  assert.deepEqual(sent('automation'), { url: '/api/email/programs/a%20b', body: { kind: 'automation', enabled: false } });
  assert.deepEqual(sent('transactional'), { url: '/api/email/programs/a%20b', body: { kind: 'transactional', enabled: false } });
  assert.deepEqual(switchRequest({ id: 'x', toggleKind: 'sequence' }, true).body, { enabled: true });
});

test('New flow is on All flows, and both New flow buttons open the new flow on its first email', () => {
  const create = between(list, 'const create = async () => {', 'const toggle = async', 'the list create');
  assert.ok(create.includes("sendFlowWrite(async () => fetch('/api/email/flows', {"), 'New flow does not post /api/email/flows');
  assert.ok(create.includes("JSON.stringify({ name: 'New flow', trigger: 'manual' })"), 'the list makes a different flow from the editor');
  assert.match(create, /if \(!sent\.answered\) \{\s*setNotice\(FLOW_MAP_WRITE_UNREACHABLE\.create\);\s*return;\s*\}/);
  assert.match(create, /onOpenFlow\(flow\.id, first\?\.id \|\| undefined\);/);
  assert.match(list, /onClick=\{create\}[^>]*>\s*\{creating \? 'Creating' : 'New flow'\}/);
  const mapCreate = between(map, 'const create = async () => {', 'const remove = async', 'the editor create');
  assert.ok(mapCreate.indexOf('if (first) selectNode(first.id);') > mapCreate.indexOf('await load(data.flow.id);'), 'the editor\'s New flow does not open its email');
});

test('after a confirmed Delete, focus goes to the Flow map heading and the status says what happened', () => {
  const remove = between(map, 'const remove = async () => {', 'const patchNode', 'remove');
  const loaded = remove.lastIndexOf('await load();');
  assert.ok(loaded > -1);
  assert.ok(remove.indexOf('headingRef.current?.focus();') > loaded, 'focus is not handed on after Delete');
  assert.ok(remove.indexOf('setNotice(`The flow "${savedName}" was deleted.`);') > loaded, 'Delete says nothing when it worked');
});

test('the Flows screens say email, never the retired "letter" (D2)', () => {
  const files = [
    ['EmailFlowMap.tsx', map], ['EmailFlowsList.tsx', list],
    ['EmailStepPreview.tsx', read('./src/components/campaign/EmailStepPreview.tsx')], ['emailFlowsList.ts', read('./src/lib/emailFlowsList.ts')]
  ];
  for (const [name, src] of files) {
    // Comments never reach the screen; every other line can.
    const lines = src.split('\n').map((line, i) => [i + 1, line.trim()])
      .filter(([, line]) => !/^(\/\/|\/\*|\*|\{\/\*)/.test(line))
      .filter(([, line]) => /\bletters?\b/i.test(line));
    assert.deepEqual(lines, [], `${name} still says letter`);
  }
});

test('Wave 2 and the open list: a starter row counts its draft emails, and its state says what that means', () => {
  const { flows, triggers } = payload();
  const rows = flowRows(flows, triggers);
  // Counted from the server's marks on the real payload: Welcome's three seeds are drafts, nothing else is.
  for (const row of rows) {
    const flow = flows.find((item) => item.id === row.id);
    assert.equal(row.drafts, flow.nodes.filter((node) => node.starterDraft === true).length, row.name);
  }
  assert.deepEqual(rows.filter((row) => row.drafts > 0).map((row) => [row.id, row.drafts]), [['drip_seq_default', 3]]);
  // A mark on a step that sends nothing is not an email, and only `true` is a mark.
  assert.equal(flowRows([{ id: 's', name: 'S', kind: 'sequence', nodes: [{ id: 'a', type: 'email', starterDraft: true }, { id: 'b', type: 'delay', starterDraft: true }, { id: 'c', type: 'email', starterDraft: 'true' }] }], triggers)[0].drafts, 1);
  // Open list: On alone only when the sender would send its emails. Welcome, as seeded, sends nothing.
  const welcome = rows.find((row) => row.id === 'drip_seq_default');
  assert.equal(welcome.on, true);
  assert.equal(flowStateText(welcome), 'On, nothing sends yet: every email is still a draft');
  assert.equal(flowStateText({ on: true, emails: 3, drafts: 2 }), 'On, 2 of 3 emails are still drafts and are not sent');
  assert.equal(flowStateText({ on: true, emails: 3, drafts: 1 }), 'On, 1 of 3 emails is still a draft and is not sent');
  assert.equal(flowStateText({ on: true, emails: 3, drafts: 0 }), 'On');
  assert.equal(flowStateText({ on: false, emails: 3, drafts: 3 }), 'Off, and every email is still a draft');
  assert.equal(flowStateText({ on: false, emails: 3, drafts: 2 }), 'Off, 2 of 3 emails are still drafts');
  assert.equal(flowStateText({ on: false, emails: 2, drafts: 0 }), 'Off');
  // Every other row on the real payload reads plain On or Off.
  for (const row of rows.filter((item) => item.drafts === 0)) assert.equal(flowStateText(row), row.on ? 'On' : 'Off', row.name);
  assert.equal(stateWarns(welcome), true);
  assert.equal(stateWarns({ on: false, drafts: 3 }), false);
  assert.equal(stateWarns({ on: true, drafts: 0 }), false);
  for (const text of [flowStateText(welcome), flowStateText({ on: true, emails: 3, drafts: 2 }), flowStateText({ on: false, emails: 3, drafts: 3 })]) assert.doesNotMatch(text, /\u2014| \u2013 /);
  // The row says it where it says On, in the state itself, and the old separate drafts sentence is gone.
  const meta = between(list, '<span id={metaId}', '</span>\n        </button>', 'the row meta');
  assert.match(meta, /<strong data-flow-state=\{row\.id\}[^>]*>\{flowStateText\(row\)\}<\/strong>/);
  assert.ok(meta.indexOf('flowStateText(row)') < meta.indexOf('emailCountText(row.emails)'), 'the state is not said before the email count');
  assert.doesNotMatch(list, /draftCountText|data-flow-drafts/, 'the separate drafts sentence is still drawn');
});

test('Wave 2: Turn off on a starter flow says what happens to the people in it, from the list and from the editor', () => {
  const said = starterOffNotice('Welcome sequence');
  assert.equal(said, 'Welcome sequence is off. Nobody new joins it, and anyone already in it whose next email comes due while it is off leaves it, so turning it back on sends nothing they missed.');
  for (const text of [said, flowStateText({ on: true, emails: 2, drafts: 1 }), flowStateText({ on: true, emails: 2, drafts: 2 })]) assert.doesNotMatch(text, /\u2014| \u2013 /);
  // The list says it for a starter row only; other kinds keep their own sentence.
  const toggle = between(list, 'const toggle = async (row: FlowRow) => {', 'const renderRow', 'toggle');
  assert.ok(toggle.includes("row.kind === 'sequence' ? starterOffNotice(row.name) : `${row.name} is off.`"), 'the list does not say what Turn off does to a starter flow');
  // The editor's header says it too, and keeps the flow's state in words beside the switch.
  const header = between(map, 'const switchStarter = async', 'const saveTimezone', 'the header switch');
  assert.ok(header.includes(': starterOffNotice(flow.name));'), 'the header does not say what Turn off does');
  const state = between(map, "{current.kind === 'sequence' && (() => {", '})()}', 'the header state');
  assert.match(state, /<span data-flow-header-state=\{current\.id\}[^>]*>\{on \? 'On for this account' : 'Off for this account'\}<\/span>/);
  assert.ok(state.indexOf('data-flow-header-state') < state.indexOf('data-flow-header-switch'), 'the state is not said before the switch');
});

// ---- Open list (2026-10-09) ----

test('All flows is four groups in a fixed order, each its own list under its heading, every row once', () => {
  const { flows, triggers } = payload();
  const rows = flowRows(flows, triggers);
  const groups = groupFlowRows(rows);
  assert.deepEqual(groups.map((group) => group.heading), ['Your flows', 'Starter flows', 'Built-in flows', 'Order emails']);
  assert.deepEqual(FLOW_GROUPS.map((group) => group.kind), ['flow', 'sequence', 'automation', 'order']);
  // Every row is in exactly one group, once, and inside a group the server's order is kept.
  const listed = groups.flatMap((group) => group.rows.map((row) => row.id));
  assert.equal(listed.length, rows.length);
  assert.equal(new Set(listed).size, rows.length);
  for (const group of groups) {
    const want = flows.filter((flow) => flow.kind === group.kind).map((flow) => flow.id);
    assert.deepEqual(group.rows.map((row) => row.id), want, `${group.heading} is not the server's order`);
    assert.ok(group.rows.length > 0, `${group.heading} is empty on the real payload`);
  }
  // The starter flows come before the built-in flows even though the server sends the built-in ones first.
  assert.ok(flows.findIndex((flow) => flow.kind === 'automation') < flows.findIndex((flow) => flow.kind === 'sequence'), 'the payload no longer sends built-in flows first, so the reorder is not shown');
  // The component: one list per group, named by its heading, and New flow in Your flows' heading row.
  assert.match(list, /\{group\.rows\.length > 0 && <ul aria-labelledby=\{headingOf\(group\.kind\)\} style=\{listStyle\}>\{group\.rows\.map\(renderRow\)\}<\/ul>\}/);
  assert.match(list, /<h3 id=\{headingOf\(group\.kind\)\} style=\{groupHeading\}>\{group\.heading\}<\/h3>\s*\{newFlow\}/, 'New flow is not beside the Your flows heading');
  assert.equal((list.match(/\{newFlow\}/g) || []).length, 1, 'New flow is drawn more than once');
  assert.doesNotMatch(list, /aria-label="Flows"/, 'the old one list of every flow is still drawn');
  // The editor's picker lists the groups in the same order.
  const picker = between(map, 'const FLOW_PICKER_GROUPS', '\n];', 'the picker groups');
  assert.deepEqual([...picker.matchAll(/label: '([^']+)'/g)].map((m) => m[1]), FLOW_GROUPS.map((group) => group.heading));
});

test('a row shows Enrolled and revenue only when counted, and the list says once why the others are not there', () => {
  const { flows, triggers } = payload();
  const rows = flowRows(flows, triggers);
  // The real payload: no account flow has anyone yet (null), and no starter revenue is traced.
  assert.equal(figuresLeftOut(rows, () => null), true);
  // Every account flow counted and every starter flow's revenue known: nothing left out, except the built-in
  // flows, which the flow map never counts, so the sentence stays while they are listed.
  const counted = rows.map((row) => (row.kind === 'flow' ? { ...row, enrolled: 4 } : row));
  assert.equal(figuresLeftOut(counted, () => 12.5), true, 'a built-in row with no count is not said');
  // Counted account flows and the order emails (which show no figure at all) leave nothing out.
  const ownOnly = counted.filter((row) => row.kind === 'flow' || row.kind === 'order');
  assert.equal(figuresLeftOut(ownOnly, () => null), false, 'counted rows and order emails still say a figure is left out');
  // A starter row never shows Enrolled (the flow map sends no count for it), so it is always said, revenue or not.
  const starter = counted.find((row) => row.kind === 'sequence');
  assert.equal(figuresLeftOut([...ownOnly, starter], () => 12.5), true, 'a starter row with no Enrolled is not said');
  assert.equal(figuresLeftOut([{ id: 'a', kind: 'flow', group: 'flows', enrolled: 0 }], () => null), false, 'a measured 0 is not a figure left out');
  assert.equal(figuresLeftOut([{ id: 'a', kind: 'flow', group: 'flows', enrolled: Number.NaN }], () => null), true);
  assert.doesNotMatch(FLOWS_FIGURES_UNCOUNTED, /—| – |Unavailable/);
  // The component prints a figure only through the counted guard, and says the sentence once, from a loaded list.
  const meta = between(list, '<span id={metaId}', '</span>\n        </button>', 'the row meta');
  assert.match(meta, /\{row\.group === 'flows' && counted\(row\.enrolled\) && <> · Enrolled \{statText\(row\.enrolled\)\}<\/>\}/);
  assert.match(meta, /\{seq && counted\(seq\.attributedSales\) && <> · Last-touch revenue \{statText\(seq\.attributedSales/);
  assert.equal((list.match(/FLOWS_FIGURES_UNCOUNTED\}/g) || []).length, 1, 'the figures sentence is printed more than once');
  assert.match(list, /\{load\.state === 'loaded' && figuresLeftOut\(rows, revenueOf\) && \(/);
});

test('every step of a flow has a name, the same on the map and in the step list, in the order a person meets them', () => {
  const { flows } = payload();
  const welcome = flows.find((flow) => flow.id === 'drip_seq_default');
  const steps = flowStepOrder(welcome.nodes, welcome.edges);
  assert.deepEqual(steps.map((node) => node.id), welcome.nodes.map((node) => node.id), 'a chain is not walked in its own order');
  const seed = sequences.find((seq) => seq.id === 'drip_seq_default');
  const names = steps.map((node) => flowStepName(node, welcome.nodes, 'Someone joins'));
  assert.equal(names[0], 'Starts when: Someone joins');
  const emailNames = names.filter((name) => name.startsWith('Email '));
  assert.deepEqual(emailNames, seed.steps.map((step, i) => `Email ${i + 1} of ${seed.steps.length}: ${step.subject}, starter draft`));
  const waits = names.filter((name) => name.startsWith('Wait '));
  assert.deepEqual(waits, seed.steps.slice(1).filter((step) => step.delayHours).map((step) => `Wait ${step.delayHours === 1 ? '1 hour' : `${step.delayHours} hours`}`));
  assert.ok(waits.length >= 1, 'the Welcome flow has no wait to name');
  // Each kind the editor names, and the ones it leaves to the editor.
  const nodes = [{ id: 't', type: 'trigger' }, { id: 'a', type: 'email', subject: 'Hi', status: 'paused' }, { id: 'b', type: 'email', subject: '', klaviyoFlowId: 'K1' }, { id: 's', type: 'sms', message: 'Hello there' }, { id: 'c', type: 'condition' }, { id: 'x', type: 'ab' }];
  assert.equal(flowStepName(nodes[0], nodes), 'Start');
  assert.equal(flowStepName(nodes[1], nodes), 'Email 1 of 2: Hi, paused');
  assert.equal(flowStepName(nodes[2], nodes), 'Email 2 of 2: No subject yet, Klaviyo');
  assert.equal(flowStepName(nodes[3], nodes), 'Text 1 of 1: Hello there');
  assert.equal(flowStepName(nodes[4], nodes), '');
  assert.equal(flowStepName(nodes[5], nodes), '', 'an A/B step is counted as an email here, unlike the step heading');
  assert.equal(flowStepName({ id: 'l', type: 'email', subject: 'x'.repeat(200) }, [{ id: 'l', type: 'email' }]).length, 'Email 1 of 1: '.length + 80);
  assert.equal(waitWords({ delayHours: 24 }), '24 hours');
  assert.equal(waitWords({ delayHours: 1 }), '1 hour');
  assert.equal(waitWords({ delayMinutes: 90 }), '90 minutes');
  assert.equal(waitWords({ mode: 'clock', clockHour: 9, clockMinute: 5, weekdays: [1, 3] }), 'until 09:05 on Monday, Wednesday');
  // A branch: both arms after the check, each once, and a step nothing leads to last.
  const branchy = flowStepOrder(
    [{ id: 'lost', type: 'email' }, { id: 'e2', type: 'email' }, { id: 'c', type: 'condition' }, { id: 't', type: 'trigger' }, { id: 'e1', type: 'email' }],
    [{ source: 't', target: 'c' }, { source: 'c', target: 'e1' }, { source: 'c', target: 'e2' }, { source: 'e1', target: 'e2' }]
  );
  assert.deepEqual(branchy.map((node) => node.id), ['t', 'c', 'e1', 'e2', 'lost']);
  for (const name of [...names, waitWords({ mode: 'clock', clockHour: 9, weekdays: [1] })]) assert.doesNotMatch(name, /—| – /);
});

test('the editor names each map step and lists the steps as buttons that select one and mark it aria-current', () => {
  // The map: each node's aria-label is the step's name.
  const layoutFn = between(map, 'function layout(', 'const SmsCount', 'layout');
  assert.match(layoutFn, /ariaLabel: stepNameOf\(flow, node, startsWhen\),/);
  assert.match(map, /function stepNameOf\(flow: FlowView, node: FlowNode, startsWhen: string\) \{\s*return flowStepName\(node, flow\.nodes, startsWhen\) \|\| `\$\{titleOf\(node\)\}: \$\{detailOf\(node\)\}`;/);
  assert.match(map, /layout\(current, selected, nodeSizes\.current, startsWhen\)/, 'the map is laid out without the start words');
  // The list: one button per step, in walk order, named by stepNameOf; Enter or a click is selectNode, which
  // moves focus to the step heading; the chosen one is aria-current="step".
  const steps = between(map, '<ol aria-labelledby="flow-steps-label"', '</ol>', 'the step list');
  assert.match(steps, /\{orderedSteps\.map\(\(node\) => \{/);
  assert.match(steps, /aria-current=\{chosen \? 'step' : undefined\}/);
  assert.match(steps, /onClick=\{\(\) => selectNode\(node\.id\)\}/);
  assert.match(steps, /\{stepNameOf\(current, node, startsWhen\)\}\s*<\/button>/);
  assert.match(map, /const orderedSteps = useMemo\(\(\) => current \? flowStepOrder\(current\.nodes, current\.edges\) : \[\], \[current\]\);/);
  assert.match(map, /<p id="flow-steps-label"[^>]*>Steps in this flow<\/p>/);
  const select = between(map, 'const selectNode = (id: string) => {', '};', 'selectNode');
  assert.ok(select.includes('setStepFocus((count) => count + 1);'), 'choosing a step no longer moves focus to its heading');
  // Not by colour alone: the chosen button has a bar and a heavier weight.
  const style = between(map, 'const stepButton = (chosen: boolean)', '};\n};', 'the step button style');
  // The bar is wider than the others' edge (4px against the 1px side), not only another colour.
  assert.match(style, /const side = '1px solid [^']+';/);
  assert.match(style, /borderLeft: chosen \? '4px solid #f472b6' : side,/);
  assert.match(style, /fontWeight: chosen \? 700 : 500/);
});
