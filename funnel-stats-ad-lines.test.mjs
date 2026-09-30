import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupAnalyticsRoutes } from './server/routes/analyticsRoutes.mjs';
import { readStatsAnswer, figureForEdge, buildCanvasMetrics, edgeSentence, AD_FAN_OUT_NOTE } from './src/lib/journeyMetrics.ts';

// C28: an ad's clicks are every visit in the journey tagged with its campaign, so only the ad's
// lone routing line may show them. The line inspector reads one line with no line list, so the
// stats answer says how many routing lines the ad had in the map it counted. Drives the real
// route over HTTP with storage stubbed, then reads the answer the way the map and inspector do.

async function serve(events) {
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    requireOperator: (_req, _res, next) => next(),
    loadEvents: () => events.map(e => ({ userId: 'u1', journeyId: 'j1', at: new Date().toISOString(), ...e })),
    loadOrders: () => [],
    loadContacts: () => [],
    loadDrips: () => ({ enrollments: [] }),
    loadCheckouts: () => [],
    publicPageCache: { lander: { userId: 'u1', journeyId: 'j1' } },
    journeyCache: {},
    contactsForUser: () => [],
    userProgramBag: () => ({ flows: [], flowEnrollments: [] }),
    writeUserPrograms: () => {},
    messageStatsFor: () => ({ sent: 0, clicked: 0, opened: 0, revenue: 0 }),
    hubReady: false
  };
  const app = express();
  app.use(express.json());
  setupAnalyticsRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const stats = async (nodes, edges) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/funnel/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ journeyId: 'j1', days: 30, nodes, edges })
    });
    assert.equal(res.status, 200);
    return res.json();
  };
  return { stats, close: () => new Promise(r => server.close(r)) };
}

// The request body shape statsRequestBody sends, and the map's own nodes for the readers.
const reqNodes = [
  { id: 'ad', type: 'ad-source', utmCampaign: 'spring', slug: '' },
  { id: 'p1', type: 'landing-page', slug: 'lander' },
  { id: 'p2', type: 'landing-page', slug: 'second-lander' },
  { id: 'sq', type: 'follow-up-sequence', slug: '' }
];
const mapNodes = reqNodes.map(n => ({ id: n.id, type: n.type, position: { x: 0, y: 0 }, data: { type: n.type, slug: n.slug } }));
const byId = Object.fromEntries(mapNodes.map(n => [n.id, n]));
const visits = [
  { type: 'page_view', nodeId: 'p1', slug: 'lander', visitorId: 'v1', utm_campaign: 'spring' },
  { type: 'page_view', nodeId: 'p1', slug: 'lander', visitorId: 'v2', utm_campaign: 'spring' }
];

test('the answer names the ad\'s routing lines, not counting a follow-up side line', async () => {
  const { stats, close } = await serve(visits);
  try {
    const lone = await stats(reqNodes, [{ id: 'a1', source: 'ad', target: 'p1' }, { id: 'a2', source: 'ad', target: 'sq' }]);
    assert.equal(lone.stats.nodes.ad.clicks, 2);
    assert.equal(lone.stats.nodes.ad.routingLines, 1);
    const fan = await stats(reqNodes, [{ id: 'a1', source: 'ad', target: 'p1' }, { id: 'a3', source: 'ad', target: 'p2' }]);
    assert.equal(fan.stats.nodes.ad.routingLines, 2);
    assert.deepEqual(fan.coverage.p2, { measured: false, why: 'not_published' });
  } finally {
    await close();
  }
});

test('the line inspector and the map pill agree on an ad that fans out to two pages', async () => {
  const { stats, close } = await serve(visits);
  try {
    const edges = [{ id: 'a1', source: 'ad', target: 'p1' }, { id: 'a3', source: 'ad', target: 'p2' }];
    const snapshot = readStatsAnswer(await stats(reqNodes, edges), 'j1', 30);
    assert.ok(snapshot);
    const view = { status: 'ready', days: 30, snapshot };
    const pills = buildCanvasMetrics(mapNodes, edges, view).edges;
    for (const e of edges) {
      // EdgeInspector's call: figureForEdge(edge, sourceNode, targetNode, view), no line list.
      const drawer = figureForEdge(e, byId[e.source], byId[e.target], view);
      assert.equal(drawer.count, null, e.id);
      assert.equal(drawer.note, AD_FAN_OUT_NOTE, e.id);
      assert.equal(pills[e.id].count, drawer.count, e.id);
      assert.doesNotMatch(edgeSentence(drawer, view), /\b2 visits/, e.id);
    }
    // The control: with the second page's line gone, the one line shows the ad's visits in both.
    const one = [edges[0]];
    const loneView = { status: 'ready', days: 30, snapshot: readStatsAnswer(await stats(reqNodes, one), 'j1', 30) };
    assert.equal(figureForEdge(one[0], byId.ad, byId.p1, loneView).count, 2);
    assert.equal(buildCanvasMetrics(mapNodes, one, loneView).edges.a1.count, 2);
  } finally {
    await close();
  }
});
