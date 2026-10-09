import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FLOW_MAP_UNREACHABLE, FLOW_MAP_WRITE_UNREACHABLE, retryFlowMapArgs, sendFlowWrite, settleRead } from './src/lib/flowMapLoad.ts';

const map = readFileSync(new URL('./src/components/campaign/EmailFlowMap.tsx', import.meta.url), 'utf8');

test('a read the server never answered settles as unanswered and never rejects', async () => {
  const rejected = [];
  const onRejection = (reason) => rejected.push(reason);
  process.on('unhandledRejection', onRejection);
  try {
    const failed = await settleRead(async () => { throw new TypeError('Failed to fetch'); });
    assert.deepEqual(failed, { answered: false });
    const ok = await settleRead(async () => ({ flows: [] }));
    assert.deepEqual(ok, { answered: true, data: { flows: [] } });
    // An answer with an empty body is still an answer: only a rejection means no server.
    assert.deepEqual(await settleRead(async () => ({})), { answered: true, data: {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(rejected, []);
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

test('the unreachable sentence is one plain sentence pair with no dash', () => {
  assert.equal(FLOW_MAP_UNREACHABLE, 'The flows could not be loaded. The server did not answer.');
  assert.doesNotMatch(FLOW_MAP_UNREACHABLE, /—| – /);
});

test('Retry keeps the shown flow, and before any list it asks again for the linked flow', () => {
  assert.deepEqual(retryFlowMapArgs('flow_a', 'flow_b'), ['flow_a', false]);
  assert.deepEqual(retryFlowMapArgs('', 'flow_b'), ['flow_b', true]);
  assert.deepEqual(retryFlowMapArgs('', undefined), [undefined, true]);
});

test('the flow map read is guarded and a failure keeps the last list instead of emptying it', () => {
  const load = map.slice(map.indexOf('const load = async'), map.indexOf('useEffect(() => {\n    load('));
  assert.match(load, /settleRead\(async \(\) => readJson\(await fetch\('\/api\/email\/flow-map'/);
  const bail = load.indexOf('if (!read.answered)');
  assert.ok(bail > 0, 'load checks for an unanswered read');
  assert.ok(bail < load.indexOf('setFlows('), 'it returns before touching the flow list');
  assert.ok(bail < load.indexOf('setCurrentId('), 'it returns before touching the chosen flow');
  assert.match(load.slice(bail, load.indexOf('setFlows(')), /setLoadError\(FLOW_MAP_UNREACHABLE\);\s*return;/);
  assert.match(load, /setLoadError\(''\)/);
});

test('the Klaviyo and SMS reads cannot reject unhandled either', () => {
  assert.match(map, /settleRead\(async \(\) => readJson\(await fetch\('\/api\/klaviyo'/);
  assert.match(map, /settleRead\(async \(\) => readJson\(await fetch\('\/api\/sms\/preview'/);
  // No bare mount-time read of these three is left.
  assert.doesNotMatch(map, /const (data|res) = await (readJson\()?(await )?fetch\('\/api\/(email\/flow-map|klaviyo|sms\/preview)'/);
});

test('the failure is announced with a keyboard-reachable Retry that loads again', () => {
  const block = map.slice(map.indexOf('{loadError && ('), map.indexOf('{loadError && (') + 500);
  assert.match(block, /role="alert"/);
  assert.match(block, /<button type="button"[^>]*onClick=\{\(\) => \{ retried\.current = true; load\(\.\.\.retryFlowMapArgs\(currentId, initialFlowId\)\); \}\}>Retry<\/button>/);
});

test('a Retry that answers hands focus to the Flow map heading instead of dropping it on the page', () => {
  // The heading can take focus from script but is not added to the Tab order.
  assert.match(map, /<h2 ref=\{headingRef\} tabIndex=\{-1\}[^>]*>Flow map<\/h2>/);
  const effect = map.slice(map.indexOf('useEffect(() => {\n    if (!retried.current'), map.indexOf('}, [loadError]);'));
  assert.ok(effect.length > 0, 'an effect watches loadError after a Retry');
  // Only once the alert is gone, only once per Retry, and only when focus has fallen to the page.
  assert.match(effect, /if \(!retried\.current \|\| loadError\) return;/);
  assert.match(effect, /retried\.current = false;/);
  assert.match(effect, /if \(!active \|\| active === document\.body\) headingRef\.current\?\.focus\(\);/);
  // A Retry that fails again keeps its button and focus, so it drops the pending hand-off.
  const load = map.slice(map.indexOf('const load = async'), map.indexOf('useEffect(() => {\n    load('));
  const bail = load.slice(load.indexOf('if (!read.answered)'), load.indexOf("setLoadError('')"));
  assert.match(bail, /retried\.current = false;/);
});

test('a write the server never answered settles as unanswered, and an answer is read whatever its body', async () => {
  const rejected = [];
  const onRejection = (reason) => rejected.push(reason);
  process.on('unhandledRejection', onRejection);
  try {
    assert.deepEqual(await sendFlowWrite(async () => { throw new TypeError('Failed to fetch'); }), { answered: false });
    const saved = await sendFlowWrite(async () => new Response(JSON.stringify({ success: true, flow: { id: 'f1' } }), { status: 200 }));
    assert.deepEqual(saved, { answered: true, ok: true, data: { success: true, flow: { id: 'f1' } } });
    // A server that answered with an error page still answered: the caller keeps its own wording.
    assert.deepEqual(await sendFlowWrite(async () => new Response('<html>502</html>', { status: 502 })), { answered: true, ok: false, data: {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(rejected, []);
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

test('each unanswered write has one plain sentence that does not claim what happened', () => {
  assert.deepEqual(Object.keys(FLOW_MAP_WRITE_UNREACHABLE).sort(), ['content', 'create', 'enabled', 'enroll', 'remove', 'save', 'suppress', 'timezone']);
  for (const sentence of Object.values(FLOW_MAP_WRITE_UNREACHABLE)) {
    assert.match(sentence, /^The server did not answer, so .* may not .*\.$/);
    assert.equal(sentence.split('. ').length, 1, sentence);
    assert.doesNotMatch(sentence, /—| – /);
  }
});

test('no Flow map request can reject unhandled: every fetch is inside settleRead or sendFlowWrite', () => {
  const calls = map.split('\n').filter((line) => /\bfetch\(/.test(line));
  assert.equal(calls.length, 11, 'three reads and eight writes');
  for (const line of calls) {
    assert.match(line, /(settleRead\(async \(\) => readJson\(await fetch\(|sendFlowWrite\(async \(\) => fetch\()/, line.trim());
  }
  // Each write says which change may not have gone through, then stops.
  for (const [key, route] of [['save', '`/api/email/flows/${next.id}`, {'], ['timezone', "'/api/email/timezone', {"], ['create', "'/api/email/flows', {"], ['remove', "`/api/email/flows/${current.id}`, { method: 'DELETE'"], ['enroll', '`/api/email/flows/${current.id}/enroll`, {'], ['suppress', '`/api/email/flows/${current.id}/suppress`, {'], ['content', '`/api/email/flow-content/${next.id}`, {'], ['enabled', '`/api/email/flow-content/${flow.id}`, {']]) {
    const at = map.indexOf(`sendFlowWrite(async () => fetch(${route}`);
    assert.ok(at > 0, `${key} is sent through sendFlowWrite`);
    // The first thing read back is whether it answered, before anything else is set or loaded.
    const after = map.slice(at, map.indexOf('sent.', map.indexOf('if (!sent.answered)', at) + 20));
    assert.match(after, new RegExp(`\\}\\)\\);\\s*if \\(!sent\\.answered\\) \\{\\s*setNotice\\(FLOW_MAP_WRITE_UNREACHABLE\\.${key}\\);\\s*return;\\s*\\}`), key);
  }
});

test('the notice is a live region that is always mounted, so a failure is heard as well as seen', () => {
  assert.match(map, /<p role="status" style=\{[^}]*\}\}>\{notice\}<\/p>/);
  assert.doesNotMatch(map, /\{notice && </);
});
