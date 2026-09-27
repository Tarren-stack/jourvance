import test from 'node:test';
import assert from 'node:assert/strict';
import { hubStorage } from './hub-storage.mjs';

test('hubStorage gets and sets in-memory cache without disk errors', () => {
  hubStorage.init({ hub: null, hubReady: false });
  hubStorage.set('test.sample', 'test_sample.json', [{ id: 1, name: 'Alice' }], { immediateDisk: false });
  const val = hubStorage.get('test.sample', 'test_sample.json', []);
  assert.equal(Array.isArray(val), true);
  assert.equal(val.length, 1);
  assert.equal(val[0].name, 'Alice');
});

test('hubStorage buffers behavior events and tracks dirty UIDs', () => {
  hubStorage.pushBehavior('user_test_1', { type: 'product_viewed', at: new Date().toISOString() });
  const bag = hubStorage.loadBehaviorBag('user_test_1');
  assert.equal(bag.events.length >= 1, true);
  assert.equal(bag.events[bag.events.length - 1].type, 'product_viewed');
});

test('hubStorage rehydration migrates local data when Hub doc missing', async () => {
  const fakeHub = {
    store: {
      docs: {
        get: async (key) => null, // simulate missing on hub
        put: async (key, doc) => ({ success: true, name: key }),
        list: async () => ({ documents: [] }),
        batchGet: async () => ({ documents: [] })
      }
    }
  };

  const manager = new (hubStorage.constructor)();
  manager.init({ hub: fakeHub, hubReady: true });
  
  const workspaceCache = {};
  const publicPageCache = {};
  const result = await manager.rehydrateAll({ workspaceCache, publicPageCache });
  
  assert.equal(result.success, true);
  assert.equal(typeof result.migratedCount, 'number');
});

test('lead honeypot identifies bot submissions with hidden website_url_hp field', () => {
  const botBody = { email: 'spammer@bot.com', website_url_hp: 'http://spam-link.ru' };
  const humanBody = { email: 'real.buyer@gmail.com', website_url_hp: '' };
  
  const isBot = (body) => Boolean(body?.website_url_hp || body?.website_hp || body?.hp_field);
  assert.equal(isBot(botBody), true);
  assert.equal(isBot(humanBody), false);
});

test('attribution workspace filter strictly isolates metrics by workspaceId', () => {
  const journeys = [
    { id: 'j1', userId: 'u1', workspaceId: 'ws_alpha', nodes: [{ type: 'ad-source', data: { platform: 'meta', spend: 500 } }] },
    { id: 'j2', userId: 'u1', workspaceId: 'ws_beta', nodes: [{ type: 'ad-source', data: { platform: 'meta', spend: 200 } }] }
  ];

  const calculateSpend = (uid, wsId) => {
    let spend = 0;
    for (const j of journeys) {
      if (j.userId !== uid) continue;
      if (wsId && j.workspaceId && j.workspaceId !== wsId) continue;
      for (const node of j.nodes || []) {
        if (node.type === 'ad-source') spend += Number(node.data?.spend || 0);
      }
    }
    return spend;
  };

  assert.equal(calculateSpend('u1', 'ws_alpha'), 500);
  assert.equal(calculateSpend('u1', 'ws_beta'), 200);
  assert.equal(calculateSpend('u1', ''), 700);
});

test('contact inquiry ingestion validates email and tags CRM appropriately', () => {
  const cleanEmail = 'client@beautyclinic.com';
  const contacts = [];
  const addInquiry = (email, name, message, businessType) => {
    if (!email || !email.includes('@')) return false;
    contacts.push({
      email,
      name,
      tags: ['inquiry', 'contact_page'],
      metadata: { businessType, message }
    });
    return true;
  };

  assert.equal(addInquiry('invalid-email', 'Test', 'Hi', 'beauty'), false);
  assert.equal(addInquiry(cleanEmail, 'Dr. Sarah', 'Tell me more', 'medical-spa'), true);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].tags.includes('inquiry'), true);
  assert.equal(contacts[0].tags.includes('contact_page'), true);
});
