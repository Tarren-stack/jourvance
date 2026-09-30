import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupAnalyticsRoutes, timeframeCutoff } from './server/routes/analyticsRoutes.mjs';

// Drives POST /api/funnel/stats and GET /api/reports/attribution over HTTP with storage stubbed.
// The stats route ignored the report's range, so the Attribution page could not show this
// journey's steps for the last 7 or 30 days. The route now counts one range: days 7, 30 or 90
// (default 30), with the Attribution page's timeframe ('7d', '30d', 'all') read as an alias. The
// map and the leak finder share this one window rule (#20 and #9); funnel-stats.test.mjs pins
// the rest of the answer.

const DAY = 86400000;
const ago = days => new Date(Date.now() - days * DAY).toISOString();

async function serve({ events = [], orders = [], enrollments = [], flows = [], flowEnrollments = [], pages = {} } = {}) {
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    requireOperator: (_req, _res, next) => next(),
    loadEvents: () => events.map(e => ({ userId: 'u1', journeyId: 'j1', ...e })),
    loadOrders: () => orders,
    loadContacts: () => [],
    loadDrips: () => ({ enrollments }),
    loadCheckouts: () => [],
    publicPageCache: pages,
    journeyCache: {},
    contactsForUser: () => [],
    userProgramBag: () => ({ flows, flowEnrollments }),
    writeUserPrograms: () => {},
    messageStatsFor: () => ({ sent: 0, clicked: 0, opened: 0, revenue: 0 }),
    hubReady: false
  };
  const app = express();
  app.use(express.json());
  setupAnalyticsRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const stats = async (body) => {
    const res = await fetch(`${base}/api/funnel/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ journeyId: 'j1', ...body })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    return { ...json.stats, days: json.days };
  };
  return { base, stats, close: () => new Promise(r => server.close(r)) };
}

const page = { id: 'node-page-1', type: 'landing-page', slug: 'vip' };
const pages = { vip: { userId: 'u1', journeyId: 'j1' } };

test('page views are counted inside the chosen range, 30 days by default', async () => {
  const { stats, close } = await serve({
    pages,
    events: [
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'a', at: ago(0) },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'b', at: ago(40) }
    ]
  });
  try {
    const body = { nodes: [page], edges: [] };
    assert.equal((await stats(body)).nodes['node-page-1'].visitors, 1);
    assert.equal((await stats({ ...body, days: 90 })).nodes['node-page-1'].visitors, 2);
    assert.equal((await stats({ ...body, timeframe: '30d' })).nodes['node-page-1'].visitors, 1);
    const all = await stats({ ...body, timeframe: 'all' });
    assert.equal(all.nodes['node-page-1'].visitors, 2, "the report's all time reads as the longest range");
    assert.equal(all.days, 90);
    assert.equal((await stats({ ...body, timeframe: 'bogus' })).days, 30, 'an unknown range is the default');
    assert.equal((await stats({ ...body, days: 7, timeframe: 'all' })).days, 7, 'days wins over the alias');
  } finally {
    await close();
  }
});

test('last 7 days leaves out an 8-day-old view, and an undated event is in no range', async () => {
  const { stats, close } = await serve({
    pages,
    events: [
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'a', at: ago(1) },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'b', at: ago(8) },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'c' }
    ]
  });
  try {
    const body = { nodes: [page], edges: [] };
    assert.equal((await stats({ ...body, timeframe: '7d' })).nodes['node-page-1'].visitors, 1);
    assert.equal((await stats({ ...body, days: 7 })).nodes['node-page-1'].visitors, 1);
    assert.equal((await stats(body)).nodes['node-page-1'].visitors, 2);
    assert.equal((await stats({ ...body, days: 90 })).nodes['node-page-1'].visitors, 2);
  } finally {
    await close();
  }
});

test('orders are counted inside the chosen range', async () => {
  const { stats, close } = await serve({
    orders: [
      { attributedSlug: 'vip', attributedNodeId: 'node-page-1', createdAt: ago(1), totalPrice: 10 },
      { attributedSlug: 'vip', attributedNodeId: 'node-page-1', createdAt: ago(40), totalPrice: 10 }
    ],
    pages
  });
  try {
    const body = { nodes: [page], edges: [] };
    assert.equal((await stats({ ...body, days: 90 })).nodes['node-page-1'].liveOrders, 2);
    assert.equal((await stats({ ...body, timeframe: '30d' })).nodes['node-page-1'].liveOrders, 1);
    assert.equal((await stats({ ...body, timeframe: '7d' })).nodes['node-page-1'].grossRevenue, 10);
  } finally {
    await close();
  }
});

test('a bound flow counts enrolments dated inside the range', async () => {
  const seq = { id: 'node-seq-1', type: 'follow-up-sequence', jourvanceFlowId: 'flow-1' };
  const { stats, close } = await serve({
    flows: [{ id: 'flow-1', name: 'Welcome' }],
    flowEnrollments: [
      { flowId: 'flow-1', status: 'active', enrolledAt: ago(0) },
      { flowId: 'flow-1', status: 'active', enrolledAt: ago(40) }
    ]
  });
  try {
    assert.equal((await stats({ nodes: [seq], edges: [], days: 90 })).nodes['node-seq-1'].flowEnrolled, 2);
    assert.equal((await stats({ nodes: [seq], edges: [], timeframe: '30d' })).nodes['node-seq-1'].flowEnrolled, 1);
  } finally {
    await close();
  }
});

test('an unbound sequence counts drip enrolments dated inside the range', async () => {
  const seq = { id: 'node-seq-1', type: 'follow-up-sequence' };
  const { stats, close } = await serve({
    pages,
    enrollments: [
      { sequenceId: 'drip_seq_default', userId: 'u1', sourceSlug: 'vip', customerEmail: 'a@x.com', enrolledAt: ago(2) },
      { sequenceId: 'drip_seq_default', userId: 'u1', sourceSlug: 'vip', customerEmail: 'b@x.com', enrolledAt: ago(40) },
      { sequenceId: 'drip_seq_default', userId: 'u2', sourceSlug: 'vip', customerEmail: 'c@x.com', enrolledAt: ago(2) }
    ]
  });
  try {
    const body = { nodes: [page, seq], edges: [{ id: 'e1', source: 'node-page-1', target: 'node-seq-1' }] };
    assert.equal((await stats({ ...body, days: 90 })).nodes['node-seq-1'].flowEnrolled, 2);
    assert.equal((await stats({ ...body, timeframe: '30d' })).nodes['node-seq-1'].flowEnrolled, 1);
  } finally {
    await close();
  }
});

test('a split counts each branch\'s visitors, so a branch line reads its own share', async () => {
  const { stats, close } = await serve({
    events: [
      { type: 'split_route', nodeId: 'split', variant: 'a', visitorId: 'a' },
      { type: 'split_route', nodeId: 'split', variant: 'b', visitorId: 'b' },
      { type: 'split_route', nodeId: 'split', variant: 'b', visitorId: 'c' }
    ].map(e => ({ ...e, at: ago(0) }))
  });
  try {
    const s = await stats({
      nodes: [{ id: 'split', type: 'ab-split', slug: 's' }, { id: 'pa', type: 'landing-page', slug: 'a' }, { id: 'pb', type: 'landing-page', slug: 'b' }],
      edges: [
        { id: 'ea', source: 'split', target: 'pa', sourceHandle: 'branch-a' },
        { id: 'eb', source: 'split', target: 'pb', sourceHandle: 'branch-b' }
      ]
    });
    assert.equal(s.nodes.split.branchAVisitors, 1);
    assert.equal(s.nodes.split.branchBVisitors, 2);
    assert.equal(s.edges, undefined);
  } finally {
    await close();
  }
});

test('timeframeCutoff is the one report window rule', () => {
  const now = 1_800_000_000_000;
  assert.equal(timeframeCutoff('7d', now), now - 7 * DAY);
  assert.equal(timeframeCutoff('30d', now), now - 30 * DAY);
  assert.equal(timeframeCutoff('90d', now), now - 90 * DAY);
  assert.equal(timeframeCutoff('all', now), now - 9999 * DAY);
  assert.equal(timeframeCutoff('nonsense', now), now - 9999 * DAY);
  assert.equal(timeframeCutoff(undefined, now), now - 9999 * DAY);
});

test('the attribution report still leaves out a page view older than its range', async () => {
  const { base, close } = await serve({ events: [{ type: 'page_view', slug: 'vip', at: ago(8) }] });
  try {
    const res = await fetch(`${base}/api/reports/attribution?timeframe=7d`);
    const body = await res.json();
    assert.equal(res.status, 200);
    // The log was read and holds no view in the range: a measured 0, not Unavailable (U06).
    assert.equal(body.report.touchCounts.pageViews, 0);
    const month = await (await fetch(`${base}/api/reports/attribution?timeframe=30d`)).json();
    assert.equal(month.report.touchCounts.pageViews, 1);
  } finally {
    await close();
  }
});
