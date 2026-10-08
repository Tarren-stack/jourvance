import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  HubStorageManager,
  accountDocName,
  batchGetAll,
  combineTenant,
  localCopyWins,
  partitionTenant,
  TENANT_SPECS,
  wrapSlice
} from './hub-storage.mjs';
import { listWorkspaces, setAuthWorkspaceContext } from './server/routes/authWorkspaceRoutes.mjs';
import { setupPublicRoutes } from './server/routes/publicRoutes.mjs';

const contactsSpec = TENANT_SPECS['store.contacts'];
const dripsSpec = TENANT_SPECS['store.drips'];
const programsSpec = TENANT_SPECS['store.email_programs'];

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jv-tenant-'));
}

function fakeDocs(seed = []) {
  const docs = new Map(seed);
  const batchCalls = [];
  const removed = [];
  const api = {
    store: {
      docs: {
        list: async () => ({
          documents: [...docs.entries()].map(([name, row]) => ({ name, updatedAt: row.updatedAt }))
        }),
        batchGet: async (names) => {
          batchCalls.push(names);
          return {
            documents: names.map((name) => {
              const row = docs.get(name);
              return row
                ? { name, found: true, document: row.document, updatedAt: row.updatedAt }
                : { name, found: false };
            })
          };
        },
        put: async (name, document) => {
          docs.set(name, { document, updatedAt: new Date().toISOString() });
          return { name };
        },
        remove: async (name) => {
          removed.push(name);
          docs.delete(name);
          return { name, deleted: true };
        },
        get: async (name) => {
          const row = docs.get(name);
          return row ? { name, document: row.document, updatedAt: row.updatedAt } : { error: 'missing', status: 404 };
        }
      }
    }
  };
  return { api, docs, batchCalls, removed };
}

test('one collection splits by account and combines without mixing rows', () => {
  const rows = [
    { email: 'a@a.test', userId: 'acct_a' },
    { email: 'b@b.test', userId: 'acct_b' },
    { email: 'loose@a.test', userId: '' }
  ];
  const { parts } = partitionTenant(contactsSpec, rows);
  assert.deepEqual(parts.get('acct_a'), [rows[0]]);
  assert.deepEqual(parts.get('acct_b'), [rows[1]]);
  assert.deepEqual(parts.get(''), [rows[2]]);
  const combined = combineTenant(contactsSpec, null, [
    { accountId: 'acct_a', value: parts.get('acct_a') },
    { accountId: 'acct_b', value: parts.get('acct_b') }
  ]);
  assert.deepEqual(combined.map((row) => row.email), ['a@a.test', 'b@b.test']);
  assert.equal(accountDocName('store.contacts', 'acct_a'), 'store.contacts.u.acct_a');
  assert.equal(accountDocName('store.contacts', ''), 'store.contacts.none');
});

test('drip enrollments split per account and sequence definitions stay shared', () => {
  const data = {
    sequences: [{ id: 'welcome' }],
    enrollments: [
      { id: 'e1', userId: 'acct_a' },
      { id: 'e2', userId: 'acct_b' }
    ]
  };
  const { parts, sequences } = partitionTenant(dripsSpec, data);
  assert.deepEqual(sequences, [{ id: 'welcome' }]);
  assert.equal(parts.get('acct_a').length, 1);
  assert.equal(parts.get('acct_b')[0].id, 'e2');
  const programs = partitionTenant(programsSpec, { acct_a: { flows: [1] }, acct_b: { flows: [2] } });
  assert.deepEqual(programs.parts.get('acct_b'), { flows: [2] });
});

test('a newer local file wins, and a mirrored file does not', () => {
  assert.equal(localCopyWins({ localMs: 200, mirroredMs: 0, hubMs: 100, localHasRows: true, hubHasDocs: true }), true);
  assert.equal(localCopyWins({ localMs: 50, mirroredMs: 0, hubMs: 100, localHasRows: true, hubHasDocs: true }), false);
  assert.equal(localCopyWins({ localMs: 200, mirroredMs: 200, hubMs: 100, localHasRows: true, hubHasDocs: true }), false);
  assert.equal(localCopyWins({ localMs: 200, mirroredMs: 0, hubMs: 100, localHasRows: false, hubHasDocs: true }), false);
  assert.equal(localCopyWins({ localMs: 200, mirroredMs: 0, hubMs: 0, localHasRows: true, hubHasDocs: false }), true);
});

test('batchGetAll reads past fifty names', async () => {
  const calls = [];
  const docsApi = {
    batchGet: async (names) => {
      calls.push(names.length);
      return { documents: names.map((name) => ({ name, found: true, document: { name } })) };
    }
  };
  const names = Array.from({ length: 55 }, (_, i) => `doc.${i}`);
  const got = await batchGetAll(docsApi, names);
  assert.deepEqual(calls, [20, 20, 15]);
  assert.equal(got.length, 55);
});

test('a legacy hub document splits into account documents', async () => {
  const dir = tempDir();
  const legacy = [
    { email: 'a@a.test', userId: 'acct_a' },
    { email: 'b@b.test', userId: 'acct_b' }
  ];
  const { api, docs, removed } = fakeDocs([
    ['store.contacts', { document: legacy, updatedAt: '2026-10-07T00:00:00.000Z' }]
  ]);
  const manager = new HubStorageManager();
  manager.init({ hub: api, hubReady: true, dataDir: dir });
  const result = await manager.rehydrateAll({ workspaceCache: {}, publicPageCache: {} });
  assert.equal(result.success, true);
  assert.equal(result.rehydratedCount > 0, true);
  const savedA = docs.get(accountDocName('store.contacts', 'acct_a'));
  const savedB = docs.get(accountDocName('store.contacts', 'acct_b'));
  assert.deepEqual(savedA.document, wrapSlice('acct_a', [legacy[0]]));
  assert.deepEqual(savedB.document, wrapSlice('acct_b', [legacy[1]]));
  assert.ok(removed.includes('store.contacts'));
  const memory = manager.get('store.contacts', 'contacts.json', []);
  assert.deepEqual(memory.map((row) => row.userId).sort(), ['acct_a', 'acct_b']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a newer local file is written back and a newer hub copy replaces the local file', async () => {
  const dir = tempDir();
  const local = [{ email: 'new@a.test', userId: 'acct_a' }];
  fs.writeFileSync(path.join(dir, 'contacts.json'), JSON.stringify(local));
  const { api, docs } = fakeDocs([
    [accountDocName('store.contacts', 'acct_a'), {
      document: wrapSlice('acct_a', [{ email: 'old@a.test', userId: 'acct_a' }]),
      updatedAt: '2020-01-01T00:00:00.000Z'
    }]
  ]);
  const manager = new HubStorageManager();
  manager.init({ hub: api, hubReady: true, dataDir: dir });
  await manager.rehydrateAll({ workspaceCache: {}, publicPageCache: {} });
  assert.equal(docs.get(accountDocName('store.contacts', 'acct_a')).document.value[0].email, 'new@a.test');

  const dir2 = tempDir();
  fs.writeFileSync(path.join(dir2, 'contacts.json'), JSON.stringify([{ email: 'stale@a.test', userId: 'acct_a' }]));
  fs.utimesSync(path.join(dir2, 'contacts.json'), new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'));
  const hub = fakeDocs([
    [accountDocName('store.contacts', 'acct_a'), {
      document: wrapSlice('acct_a', [{ email: 'hub@a.test', userId: 'acct_a' }]),
      updatedAt: '2026-10-07T00:00:00.000Z'
    }]
  ]);
  const second = new HubStorageManager();
  second.init({ hub: hub.api, hubReady: true, dataDir: dir2 });
  await second.rehydrateAll({ workspaceCache: {}, publicPageCache: {} });
  const written = JSON.parse(fs.readFileSync(path.join(dir2, 'contacts.json'), 'utf8'));
  assert.equal(written[0].email, 'hub@a.test');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});

test('boot loads every workspace and every published page', async () => {
  const dir = tempDir();
  const seed = [];
  for (let i = 0; i < 60; i++) {
    seed.push([`workspace.owner.w${i}`, {
      document: { userId: 'owner', id: `w${i}`, updatedAt: '2026-01-01T00:00:00.000Z', shopifyConfig: { storeDomain: '', status: 'disconnected' } },
      updatedAt: '2026-01-01T00:00:00.000Z'
    }]);
  }
  for (let i = 0; i < 55; i++) {
    seed.push([`pubpage.page${i}`, {
      document: { slug: `page${i}`, userId: i < 30 ? 'owner' : 'other', updatedAt: '2026-01-01T00:00:00.000Z' },
      updatedAt: '2026-01-01T00:00:00.000Z'
    }]);
  }
  const { api, batchCalls } = fakeDocs(seed);
  const manager = new HubStorageManager();
  manager.init({ hub: api, hubReady: true, dataDir: dir });
  const workspaceCache = {};
  const publicPageCache = {};
  await manager.rehydrateAll({ workspaceCache, publicPageCache });
  assert.equal(Object.keys(workspaceCache).length, 60);
  assert.equal(Object.keys(publicPageCache).length, 55);
  assert.equal(publicPageCache.page54.userId, 'other');
  const workspaceBatches = batchCalls.filter((names) => names[0].startsWith('workspace.'));
  const pageBatches = batchCalls.filter((names) => names[0].startsWith('pubpage.'));
  assert.deepEqual(workspaceBatches.map((names) => names.length), [20, 20, 20]);
  assert.deepEqual(pageBatches.map((names) => names.length), [20, 20, 15]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listWorkspaces returns every workspace for that account', async () => {
  const uid = 'tenant-batch-user';
  const documents = Array.from({ length: 25 }, (_, i) => ({
    name: `workspace.${uid}.n${i}`,
    document: { userId: uid, id: `ws${i}`, name: `Store ${i}`, shopifyConfig: { storeDomain: '', status: 'disconnected' } }
  }));
  const calls = [];
  setAuthWorkspaceContext({
    hubReady: true,
    hub: {
      store: {
        docs: {
          list: async () => ({ documents }),
          batchGet: async (names) => {
            calls.push(names.length);
            const wanted = new Set(names);
            return { documents: documents.filter((row) => wanted.has(row.name)).map((row) => ({ ...row, found: true })) };
          }
        }
      }
    }
  });
  try {
    const rows = await listWorkspaces(uid);
    assert.equal(rows.length, 25);
    assert.deepEqual(calls, [20, 5]);
    assert.equal(rows.some((row) => row.userId !== uid), false);
  } finally {
    setAuthWorkspaceContext({ hubReady: false, hub: null });
  }
});

test('a lead for one account does not change another account with the same email', async () => {
  const contacts = [
    { id: 'c1', email: 'buyer@a.test', userId: 'acct_a', name: 'Account A', tags: ['keep'] }
  ];
  const app = express();
  app.use(express.json());
  setupPublicRoutes(app, {
    publicPageCache: {
      offer: { slug: 'offer', userId: 'acct_b', data: { headline: 'Offer' }, shopifyConfig: {} }
    },
    domainRegistryCache: {},
    workspaceCache: {},
    hubStorage: { get: (_k, _f, fallback) => fallback, set: () => {} },
    loadContacts: () => contacts,
    saveContacts: (rows) => { contacts.splice(0, contacts.length, ...rows); },
    loadDrips: () => ({ sequences: [], enrollments: [] }),
    saveDrips: () => {},
    realStoreDomain: () => '',
    signupFormsFor: () => []
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/public/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'offer', email: 'buyer@a.test', name: 'Account B' })
    });
    assert.equal(res.status, 200);
    const first = contacts.find((row) => row.userId === 'acct_a');
    const second = contacts.find((row) => row.userId === 'acct_b');
    assert.equal(first.name, 'Account A');
    assert.deepEqual(first.tags, ['keep']);
    assert.equal(second.email, 'buyer@a.test');
    assert.equal(second.name, 'Account B');
    assert.equal(contacts.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
