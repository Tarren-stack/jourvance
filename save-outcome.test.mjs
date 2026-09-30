import test from 'node:test';
import assert from 'node:assert/strict';

// The canvas showed "Saved!" and "Funnel Successfully Published!" whatever happened: the save
// swallowed every fetch error and a failed publish fell back to marking pages live on the client.
// src/lib/saveOutcome.ts is now the one reading of the server's answer.

const { BROWSER_OUT_OF_SPACE, saveOutcome, browserSaveOutcome, publishRefusal, publishedPartly, publishWarning, unpublishRefusal, renameRefusal, isStale } = await import('./src/lib/saveOutcome.ts');

const at = '2026-09-28T12:00:00.000Z';
const ok = (body) => ({ status: 200, body: { success: true, ...body } });

test('a save that never got an answer is a retryable failure that says the edits are kept locally', () => {
  const s = saveOutcome(null, at);
  assert.equal(s.kind, 'failed');
  assert.equal(s.retryable, true);
  assert.match(s.message, /^Not saved because the server could not be reached\. Your changes are kept in this browser\./);
});

test('an expired sign-in is not retryable and says what to do', () => {
  const s = saveOutcome({ status: 401, body: { success: false, error: 'Unauthorized' } }, at);
  assert.equal(s.kind, 'failed');
  assert.equal(s.retryable, false);
  assert.match(s.message, /sign-in has expired/);
});

test('a refusal carries the server sentence, and only a server-side failure is retryable', () => {
  const refused = saveOutcome({ status: 403, body: { success: false, error: 'That is not your account.' } }, at);
  assert.deepEqual(refused, { kind: 'failed', message: 'Not saved. That is not your account.', retryable: false });
  const broken = saveOutcome({ status: 503, body: {} }, at);
  assert.equal(broken.retryable, true);
  assert.equal(broken.message, 'Not saved. The server answered with status 503.');
  const throttled = saveOutcome({ status: 429, body: {} }, at);
  assert.equal(throttled.retryable, true);
});

test('a 200 that does not say success is not a save', () => {
  assert.equal(saveOutcome({ status: 200, body: {} }, at).kind, 'failed');
  assert.equal(saveOutcome({ status: 200, body: { success: false, error: 'Nope.' } }, at).kind, 'failed');
});

test('a landed save is "saved", or "not backed up" when the server says it is not durable', () => {
  assert.deepEqual(saveOutcome(ok({ durable: true }), at), { kind: 'saved', savedUpdatedAt: at });
  assert.deepEqual(saveOutcome(ok({}), at), { kind: 'saved', savedUpdatedAt: at });
  assert.deepEqual(saveOutcome(ok({ durable: false, reason: 'HUB_API_KEY is not set' }), at), { kind: 'not-backed-up', savedUpdatedAt: at });
});

test('signed out, a kept browser write is "browser-only" and a refused one is a plain failure', () => {
  assert.deepEqual(browserSaveOutcome(true, at), { kind: 'browser-only', savedUpdatedAt: at });
  const refused = browserSaveOutcome(false, at);
  assert.equal(refused.kind, 'failed');
  assert.equal(refused.retryable, false, 'trying again cannot make the browser store it');
  assert.match(refused.message, /^Not saved\. /);
  assert.match(refused.message, /This browser would not store the journey/);
  assert.doesNotMatch(refused.message, /—| – /);
});

test('a saved state goes stale at the next edit; a failure or idle never does', () => {
  assert.equal(isStale({ kind: 'saved', savedUpdatedAt: at }, at), false);
  assert.equal(isStale({ kind: 'saved', savedUpdatedAt: at }, '2026-09-28T12:00:01.000Z'), true);
  assert.equal(isStale({ kind: 'browser-only', savedUpdatedAt: at }, 'later'), true);
  assert.equal(isStale({ kind: 'failed', message: 'x', retryable: true }, 'later'), false);
  assert.equal(isStale({ kind: 'idle' }, 'later'), false);
});

test('publish: only a success that published a page is a success', () => {
  assert.equal(publishRefusal(ok({ publishedPages: [{ nodeId: 'p', slug: 's', url: '/p/s', headline: 'h' }] })), null);
  const empty = publishRefusal(ok({ publishedPages: [] }));
  assert.match(empty.message, /^Nothing was published because this journey has no landing page/);
  assert.equal(empty.retryable, false);
  assert.ok(publishRefusal(ok({})), 'a success with no page list is not a publish');
});

test('publish: a partial publish says what went live and never leads with "Not published" (C12)', () => {
  const said = 'Your page is live at /p/one, but the custom domain shop.example could not be saved to storage. Publish again.';
  const answer = { status: 503, body: { success: false, retryable: true, partial: true, error: said } };
  assert.equal(publishedPartly(answer), true);
  assert.deepEqual(publishRefusal(answer), { message: `Partly published. ${said}`, retryable: true });
  const none = { status: 503, body: { success: false, retryable: true, partial: false, error: 'Your pages could not be saved to storage, so nothing new went live. Publish again.' } };
  assert.equal(publishedPartly(none), false);
  assert.match(publishRefusal(none).message, /^Not published\. /);
  assert.equal(publishedPartly(null), false);
});

test('publish: a success still says when an old address stayed live or the pages were not stored (C11, C12)', () => {
  const pages = [{ nodeId: 'p', slug: 's', url: '/p/s', headline: 'h' }];
  assert.equal(publishWarning(ok({ publishedPages: pages, stillLive: [] })), null);
  assert.equal(
    publishWarning(ok({ publishedPages: pages, stillLive: ['/p/old'] })),
    'An old address may still be live: /p/old. Publish again or take the funnel offline to take it down.'
  );
  assert.match(publishWarning(ok({ publishedPages: pages, stillLive: ['/p/a', '/p/b'] })), /^Old addresses may still be live: \/p\/a, \/p\/b\. .*take them down\.$/);
  assert.equal(
    publishWarning(ok({ publishedPages: pages, durable: false })),
    'These pages are live on this server only. They were not saved to storage, so a restart could take them offline.'
  );
  assert.equal(publishWarning({ status: 503, body: { success: false, partial: true } }), null);
  for (const text of [publishWarning(ok({ stillLive: ['/p/x'], durable: false }))]) assert.doesNotMatch(text, /\u2014| \u2013 /);
});

test('publish: a slug conflict is not retryable and a server failure is', () => {
  const taken = publishRefusal({ status: 409, body: { success: false, error: 'That page address is already in use.' } });
  assert.deepEqual(taken, { message: 'Not published. That page address is already in use.', retryable: false });
  const crashed = publishRefusal({ status: 500, body: { success: false, retryable: true, error: 'Publishing did not finish on the server.' } });
  assert.equal(crashed.retryable, true);
  assert.equal(publishRefusal(null).message, 'Not published because the server could not be reached. Check your connection and try again.');
});

test('unpublish: a failure says the funnel is still live', () => {
  assert.equal(unpublishRefusal(ok({})), null);
  assert.equal(unpublishRefusal(null).message, 'Still live because the server could not be reached. Check your connection and try again.');
  assert.equal(unpublishRefusal({ status: 500, body: {} }).message, 'Still live. The server answered with status 500.');
});

test('rename: a failure says the journey was not renamed', () => {
  assert.equal(renameRefusal(ok({})), null);
  assert.deepEqual(renameRefusal(null), { message: 'Not renamed because the server could not be reached. Check your connection and try again.', retryable: true });
  assert.deepEqual(renameRefusal({ status: 401, body: {} }), { message: 'Not renamed because your sign-in has expired. Sign in again, then try once more.', retryable: false });
  assert.deepEqual(renameRefusal({ status: 409, body: { success: false, error: 'That journey changed elsewhere.' } }), { message: 'Not renamed. That journey changed elsewhere.', retryable: false });
  assert.deepEqual(renameRefusal({ status: 503, body: {} }), { message: 'Not renamed. The server answered with status 503.', retryable: true });
});

test('no message carries an em dash', () => {
  const answers = [null, { status: 401, body: {} }, { status: 500, body: {} }, ok({ publishedPages: [] })];
  const messages = [
    ...answers.map(a => saveOutcome(a, at)).filter(s => s.kind === 'failed').map(s => s.message),
    ...answers.map(a => publishRefusal(a)).filter(Boolean).map(r => r.message),
    ...answers.map(a => unpublishRefusal(a)).filter(Boolean).map(r => r.message)
  ];
  assert.ok(messages.length >= 8);
  for (const m of messages) assert.doesNotMatch(m, /—| – /, m);
});

// #23: the preview link answer, and the one requestAnswer every client caller shares.

test('preview: no answer is a retryable refusal that says the server could not be reached', async () => {
  const { previewOutcome } = await import('./src/lib/saveOutcome.ts');
  const p = previewOutcome(null);
  assert.equal(p.kind, 'refused');
  assert.equal(p.retryable, true);
  assert.match(p.message, /^No preview because the server could not be reached\./);
});

test('preview: an expired sign-in is not retryable, and a refusal carries the server sentence', async () => {
  const { previewOutcome } = await import('./src/lib/saveOutcome.ts');
  assert.deepEqual(previewOutcome({ status: 401, body: {} }), {
    kind: 'refused',
    message: 'No preview because your sign-in has expired. Sign in again, then try once more.',
    retryable: false
  });
  assert.deepEqual(previewOutcome({ status: 400, body: { success: false, error: 'Previews are for landing pages and upsell pages.' } }), {
    kind: 'refused',
    message: 'No preview. Previews are for landing pages and upsell pages.',
    retryable: false
  });
  const broken = previewOutcome({ status: 503, body: {} });
  assert.equal(broken.retryable, true);
  assert.equal(broken.message, 'No preview. The server answered with status 503.');
});

test('preview: only a success with a /p/preview/ link and a real expiry is ready', async () => {
  const { previewOutcome } = await import('./src/lib/saveOutcome.ts');
  const expiresAt = '2026-09-28T13:00:00.000Z';
  const url = '/p/preview/abcdefghijklmnopqrstuvwxyz012345';
  assert.deepEqual(previewOutcome(ok({ url, expiresAt })), { kind: 'ready', url, expiresAt });
  const noLink = 'No preview. The server did not send a preview link.';
  for (const body of [{}, { url: '/p/ws/offer', expiresAt }, { url: 'https://evil.example/p/preview/x', expiresAt }, { url, expiresAt: 'soon' }, { url }, { url: 42, expiresAt }]) {
    const p = previewOutcome(ok(body));
    assert.equal(p.kind, 'refused', JSON.stringify(body));
    assert.equal(p.message, noLink);
  }
  assert.equal(previewOutcome({ status: 200, body: { url, expiresAt } }).kind, 'refused', 'a 200 without success:true is not a preview');
});

test('requestAnswer: status and JSON body, {} for a body that is not JSON, null when fetch throws', async () => {
  const { requestAnswer } = await import('./src/lib/saveOutcome.ts');
  const realFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ success: true, n: 1 }), { status: 201 }); };
    assert.deepEqual(await requestAnswer('/api/x', { method: 'POST' }), { status: 201, body: { success: true, n: 1 } });
    assert.deepEqual(calls, [{ url: '/api/x', init: { method: 'POST' } }]);
    globalThis.fetch = async () => new Response('<html>Bad gateway</html>', { status: 502 });
    assert.deepEqual(await requestAnswer('/api/x', {}), { status: 502, body: {} });
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    assert.equal(await requestAnswer('/api/x', {}), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('usePublication uses saveOutcome\'s requestAnswer and previewOutcome, with no copy of its own', async () => {
  const { readFile } = await import('node:fs/promises');
  const hook = await readFile(new URL('./src/lib/usePublication.ts', import.meta.url), 'utf8');
  assert.match(hook, /import \{[^}]*\brequestAnswer\b[^}]*\bpreviewOutcome\b[^}]*\} from '\.\/saveOutcome'/);
  assert.doesNotMatch(hook, /function requestAnswer|function previewOutcome/, 'the stand-ins are gone');
  assert.match(hook, /export type \{ PreviewOutcome \} from '\.\/saveOutcome'/, 'StepPublishPanel still imports PreviewOutcome from the hook');
});

test('no preview message carries an em dash', async () => {
  const { previewOutcome } = await import('./src/lib/saveOutcome.ts');
  const answers = [null, { status: 401, body: {} }, { status: 500, body: {} }, { status: 400, body: { error: 'x' } }, ok({}), ok({ url: '/p/preview/x', expiresAt: 'nope' })];
  const messages = answers.map(a => previewOutcome(a)).map(p => p.message);
  assert.equal(messages.length, 6);
  for (const m of messages) assert.doesNotMatch(m, /—| – /, m);
});

test('a browser save refused because storage is full says so in one sentence, points at the library, and offers no Retry', () => {
  const full = browserSaveOutcome(false, at, true);
  assert.deepEqual(full, { kind: 'failed', message: BROWSER_OUT_OF_SPACE, retryable: false, action: 'open-library' });
  assert.equal(BROWSER_OUT_OF_SPACE, 'This browser is out of space for journeys. Remove one you no longer need, or sign in to save to your account.');
  assert.doesNotMatch(BROWSER_OUT_OF_SPACE, /—| – /);
  // Another refusal (a blocked store) keeps its own sentence and no library button.
  const blocked = browserSaveOutcome(false, at, false);
  assert.equal(blocked.action, undefined);
  assert.match(blocked.message, /This browser would not store the journey/);
  // Kept is kept, whatever `full` says.
  assert.deepEqual(browserSaveOutcome(true, at, true), { kind: 'browser-only', savedUpdatedAt: at });
});
