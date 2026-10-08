// Mail events: the gate, the batch a hub would post, and the route that stores it.
// Does not import server.mjs, does not call SendGrid, and does not call the live hub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { setupEmailRoutes } from './server/routes/emailRoutes.mjs';
import {
  eventAtIso, mailCallbackPlan, mailEventsReady, normalizeProviderEvent, publicHttpsOrigin, secretsMatch
} from './server/mail-events.mjs';

const SECRET = 'jourvance-mail-event-test';

test('a public https origin is accepted and a private or local one is not', () => {
  assert.equal(publicHttpsOrigin('https://shop.example'), 'https://shop.example');
  assert.equal(publicHttpsOrigin('https://shop.example/app'), 'https://shop.example');
  assert.equal(publicHttpsOrigin('http://shop.example'), '');
  assert.equal(publicHttpsOrigin('https://localhost'), '');
  assert.equal(publicHttpsOrigin('https://10.1.2.3'), '');
  assert.equal(publicHttpsOrigin('https://192.168.0.8'), '');
  assert.equal(publicHttpsOrigin('https://shop.example.local'), '');
  assert.equal(publicHttpsOrigin('https://user:pass@shop.example'), '');
  assert.equal(publicHttpsOrigin(''), '');
  assert.equal(mailEventsReady({}), false);
  assert.equal(mailEventsReady({ MAIL_EVENT_SECRET: SECRET }), false);
  assert.equal(mailEventsReady({ PUBLIC_BASE_URL: 'https://shop.example' }), false);
  assert.equal(mailEventsReady({ MAIL_EVENT_SECRET: 'short', PUBLIC_BASE_URL: 'https://shop.example' }), false);
  assert.equal(mailEventsReady({ MAIL_EVENT_SECRET: SECRET, PUBLIC_BASE_URL: 'http://localhost:3005' }), false);
  assert.equal(mailEventsReady({ MAIL_EVENT_SECRET: SECRET, PUBLIC_BASE_URL: 'https://shop.example' }), true);
  assert.deepEqual(mailCallbackPlan(SECRET, 'https://shop.example'), {
    url: 'https://shop.example/api/email/provider-event',
    secret: SECRET
  });
  assert.equal(mailCallbackPlan(SECRET, 'https://10.1.2.3'), null);
});

test('a provider row becomes an open, a complaint, or a blocked bounce, and a bad row is skipped', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const open = normalizeProviderEvent({
    event: 'open', email: 'Ada@Shop.test', jourvance_uid: 'acct_a', jourvance_message_id: 'msg_1',
    sg_event_id: 'e1', sg_machine_open: 'true', timestamp: Math.floor(now / 1000)
  }, now);
  assert.equal(open.type, 'email_opened');
  assert.equal(open.prefetch, true);
  assert.equal(open.providerEventId, 'e1');
  assert.equal(open.at, new Date(Math.floor(now / 1000) * 1000).toISOString());
  const complaint = normalizeProviderEvent({ event: 'spamreport', uid: 'acct_a', email: 'ada@shop.test' }, now);
  assert.equal(complaint.type, 'complaint');
  const blocked = normalizeProviderEvent({ event: 'bounce', type: 'blocked', uid: 'acct_a', email: 'ada@shop.test', sg_event_id: 'e3' }, now);
  assert.equal(blocked.type, 'soft_bounce');
  assert.equal(blocked.bounceType, 'blocked');
  assert.equal(normalizeProviderEvent({ event: 'dropped', uid: 'acct_a', email: 'ada@shop.test' }, now), null);
  assert.equal(normalizeProviderEvent({ event: 'deferred', uid: 'acct_a', email: 'ada@shop.test' }, now), null);
  assert.equal(normalizeProviderEvent({ type: 'open' }, now), null);
  assert.equal(normalizeProviderEvent({ event: 'group_unsubscribe', uid: 'acct_a', email: 'ada@shop.test' }, now).type, 'unsubscribe');
  assert.equal(eventAtIso(Math.floor(now / 1000) + 600, now), '');
  assert.equal(eventAtIso(Math.floor((now - 400 * 24 * 60 * 60 * 1000) / 1000), now), '');
  assert.equal(secretsMatch('short', SECRET), false);
  assert.equal(secretsMatch(SECRET, SECRET), true);
  assert.equal(secretsMatch(`${SECRET}x`, SECRET), false);
});

async function listen(app) {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })
  };
}

test('the provider route records a signed batch once and attaches the send it already stored', async () => {
  const previous = process.env.MAIL_EVENT_SECRET;
  process.env.MAIL_EVENT_SECRET = SECRET;
  const events = [];
  const contacts = [{ userId: 'acct_a', email: 'ada@shop.test', acceptsMarketing: true }];
  const bag = { suppressions: [] };
  let writes = 0;
  let contactSaves = 0;
  const app = express();
  app.use(express.json());
  setupEmailRoutes(app, {
    requireUser: (_req, _res, next) => next(),
    loadEvents: () => events,
    recordEvent: (event) => { events.push(event); },
    knownSend: (uid, messageId) => (uid === 'acct_a' && messageId === 'msg_1'
      ? { messageId: 'msg_1', campaignId: 'c1', flowId: 'f1', nodeId: 'n1', sequenceId: 's1', type: 'email_sent' }
      : null),
    userProgramBag: () => bag,
    writeUserPrograms: () => { writes += 1; },
    loadContacts: () => contacts,
    saveContacts: () => { contactSaves += 1; },
    contactOwnerId: (row) => row?.userId || ''
  });
  const { base, close } = await listen(app);
  const post = (body, secret = SECRET) => fetch(`${base}/api/email/provider-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-jourvance-mail-secret': secret },
    body: JSON.stringify(body)
  });
  try {
    const batch = await post({
      events: [
        { uid: 'acct_a', email: 'Ada@Shop.test', type: 'open', messageId: 'msg_1', providerEventId: 'e1', prefetch: true, timestamp: Math.floor(Date.now() / 1000) },
        { event: 'spamreport', uid: 'acct_a', email: 'ada@shop.test', providerEventId: 'e2' },
        { event: 'bounce', type: 'blocked', uid: 'acct_a', email: 'ada@shop.test', sg_event_id: 'e3' },
        { event: 'unsubscribe', uid: 'acct_a', email: 'ada@shop.test', providerEventId: 'e4' },
        { event: 'dropped', uid: 'acct_a', email: 'ada@shop.test' },
        { type: 'open' }
      ]
    });
    assert.equal(batch.status, 200);
    const body = await batch.json();
    assert.equal(body.recorded, 4);
    assert.equal(body.skipped, 2);
    assert.equal(events.length, 4);
    assert.equal(events[0].type, 'email_opened');
    assert.equal(events[0].prefetch, true);
    assert.equal(events[0].campaignId, 'c1');
    assert.equal(events[0].messageId, 'msg_1');
    assert.equal(events[1].type, 'complaint');
    assert.equal(events[2].type, 'soft_bounce');
    assert.equal(events[3].type, 'unsubscribe');
    assert.equal(contacts[0].acceptsMarketing, false);
    assert.equal(contactSaves, 1);
    assert.equal(bag.suppressions.filter((row) => row.reason === 'complaint').length, 1);
    assert.equal(bag.suppressions.find((row) => row.reason === 'soft_bounce').count, 1);
    const again = await post({ events: [{ uid: 'acct_a', email: 'ada@shop.test', type: 'complaint', providerEventId: 'e2' }] });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).duplicate, 1);
    assert.equal(events.length, 4);
    assert.equal(writes, 3);
    const single = await post({ uid: 'acct_a', email: 'ada@shop.test', type: 'delivered', providerEventId: 'e5' });
    assert.equal(single.status, 200);
    assert.equal((await single.json()).recorded, 'email_delivered');
    const wrong = await post({ uid: 'acct_a', email: 'ada@shop.test', type: 'open', providerEventId: 'e6' }, 'not-the-secret');
    assert.equal(wrong.status, 401);
    assert.equal(events.filter((row) => row.providerEventId === 'e6').length, 0);
  } finally {
    if (previous === undefined) delete process.env.MAIL_EVENT_SECRET;
    else process.env.MAIL_EVENT_SECRET = previous;
    await close();
  }
});

test('the send path carries the spoke ids and the callback registers only when the plan is ready', () => {
  const server = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  const deliver = server.slice(server.indexOf('async function deliverLetter'), server.indexOf('async function sendTransactional'));
  assert.match(deliver, /jourvanceUid: userId/);
  assert.match(deliver, /accountId: userId/, 'a letter names the account so a verified merchant sender is used');
  assert.match(deliver, /jourvanceMessageId: messageId/);
  const ctx = server.slice(server.indexOf('const emailCtx'), server.indexOf('setupEmailRoutes(app, emailCtx)'));
  assert.match(ctx, /\bknownSend\b/);
  // accountEvents() in emailRoutes reads loadBehaviorBag off the context; with it missing every
  // prediction refresh threw ReferenceError (seen in the boot log on 2026-10-07).
  assert.match(ctx, /\bloadBehaviorBag\b/);
  const routes = fs.readFileSync(new URL('./server/routes/emailRoutes.mjs', import.meta.url), 'utf8');
  assert.match(routes.slice(routes.indexOf('const {'), routes.indexOf('} = ctx')), /\bloadBehaviorBag\b/);
  assert.match(server, /Mail events stay off until MAIL_EVENT_SECRET and a public https PUBLIC_BASE_URL are set/);
  assert.match(fs.readFileSync(new URL('./hub-sdk.js', import.meta.url), 'utf8'), /\/api\/email\/webhook\/callback/);
});
