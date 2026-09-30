import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupAnalyticsRoutes, followUpTriggers } from './server/routes/analyticsRoutes.mjs';

// Drives POST /api/funnel/stats over HTTP with storage stubbed. The map's numbers come from this
// one answer, so it must count only this journey's events inside the chosen range, count each
// visitor once, say which steps it could not measure (null, never 0), and echo the journey and
// range it answered so the canvas never shows another range's figures.

const DAY = 86400000;
const ago = days => new Date(Date.now() - days * DAY).toISOString();

async function serve({
  events = [], orders = [], enrollments = [], sequences, flows = [], flowEnrollments = [], pages = {}, eventsKept,
  messageStats = { sent: 0, clicked: 0, opened: 0, revenue: 0 }
} = {}) {
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    requireOperator: (_req, _res, next) => next(),
    loadEvents: () => events.map(e => ({ userId: 'u1', journeyId: 'j1', at: ago(0), ...e })),
    loadOrders: () => orders,
    loadContacts: () => [],
    loadDrips: () => ({ enrollments, ...(sequences ? { sequences } : {}) }),
    loadCheckouts: () => [],
    publicPageCache: pages,
    journeyCache: {},
    contactsForUser: () => [],
    userProgramBag: () => ({ flows, flowEnrollments }),
    writeUserPrograms: () => {},
    messageStatsFor: () => messageStats,
    hubReady: false,
    ...(eventsKept ? { eventsKept } : {})
  };
  const app = express();
  app.use(express.json());
  setupAnalyticsRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body) => {
    const res = await fetch(`${base}/api/funnel/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  };
  const stats = async (body) => {
    const answer = await post({ journeyId: 'j1', ...body });
    assert.equal(answer.status, 200);
    assert.equal(answer.body.success, true);
    return answer.body;
  };
  return { post, stats, close: () => new Promise(r => server.close(r)) };
}

const livePage = { vip: { userId: 'u1', journeyId: 'j1' } };
const page = { id: 'node-page-1', type: 'landing-page', slug: 'vip' };

test('a request without a journey is refused', async () => {
  const { post, close } = await serve();
  try {
    const answer = await post({ nodes: [page], edges: [] });
    assert.equal(answer.status, 400);
    assert.equal(answer.body.success, false);
    assert.equal(answer.body.error, 'Name the journey whose numbers you want.');
  } finally {
    await close();
  }
});

test('one visitor seen three times is one visitor', async () => {
  const { stats, close } = await serve({
    pages: livePage,
    events: [
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v1' },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v1' },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v1' },
      { type: 'page_view', nodeId: 'node-page-1' }
    ]
  });
  try {
    const body = await stats({ nodes: [page], edges: [] });
    // v1 once, plus the one event with no id.
    assert.equal(body.stats.nodes['node-page-1'].visitors, 2);
  } finally {
    await close();
  }
});

test('another journey\'s and another user\'s events are not counted', async () => {
  const { stats, close } = await serve({
    pages: livePage,
    events: [
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v1' },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v2', journeyId: 'j2' },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v3', userId: 'u2' },
      { type: 'page_view', slug: 'vip', visitorId: 'v4', journeyId: '' }
    ]
  });
  try {
    assert.equal((await stats({ nodes: [page], edges: [] })).stats.nodes['node-page-1'].visitors, 1);
  } finally {
    await close();
  }
});

test('the range decides which events count, and the answer echoes it', async () => {
  const { stats, close } = await serve({
    pages: livePage,
    events: [
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'new', at: ago(1) },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'old', at: ago(45) }
    ]
  });
  try {
    const month = await stats({ days: 30, nodes: [page], edges: [] });
    assert.equal(month.stats.nodes['node-page-1'].visitors, 1);
    assert.equal(month.days, 30);
    assert.equal(month.journeyId, 'j1');
    const quarter = await stats({ days: 90, nodes: [page], edges: [] });
    assert.equal(quarter.stats.nodes['node-page-1'].visitors, 2);
    assert.equal(quarter.days, 90);
    const bad = await stats({ days: 45, nodes: [page], edges: [] });
    assert.equal(bad.days, 30);
    assert.ok(Date.parse(bad.from) > 0 && Date.parse(bad.to) > Date.parse(bad.from));
    assert.ok(Math.abs(Date.parse(bad.to) - Date.parse(bad.from) - 30 * DAY) < 5000);
    assert.equal(bad.partialSince, null);
  } finally {
    await close();
  }
});

test('an unpublished page is not measured, and a published page with no visits is a measured zero', async () => {
  const { stats, close } = await serve({ pages: livePage });
  try {
    const body = await stats({
      nodes: [page, { id: 'draft', type: 'landing-page', slug: 'draft' }],
      edges: []
    });
    assert.equal(body.stats.nodes['node-page-1'].visitors, 0);
    assert.equal(body.stats.nodes['node-page-1'].conversionRate, null);
    assert.deepEqual(body.coverage['node-page-1'], { measured: true });
    assert.equal(body.stats.nodes.draft.visitors, null);
    assert.equal(body.coverage.draft.measured, false);
    assert.equal(body.coverage.draft.why, 'not_published');
  } finally {
    await close();
  }
});

test('a page counts its leads, and a form reads the page that feeds it', async () => {
  const { stats, close } = await serve({
    pages: livePage,
    events: [
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v1' },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v2' },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v3' },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v4' },
      { type: 'lead', nodeId: 'node-page-1', visitorId: 'v1' }
    ]
  });
  try {
    const body = await stats({
      nodes: [page, { id: 'form', type: 'lead-form' }, { id: 'orphan', type: 'lead-form' }],
      edges: [{ id: 'e1', source: 'node-page-1', target: 'form' }]
    });
    assert.equal(body.stats.nodes['node-page-1'].leads, 1);
    assert.equal(body.stats.nodes['node-page-1'].conversionRate, 25);
    assert.equal(body.stats.nodes.form.views, 4);
    assert.equal(body.stats.nodes.form.submissions, 1);
    assert.equal(body.stats.nodes.form.completionRate, 25);
    assert.equal(body.coverage.orphan.measured, false);
    assert.equal(body.coverage.orphan.why, 'no_source');
    assert.equal(body.stats.nodes.orphan.views, null);
  } finally {
    await close();
  }
});

test('an ad without a campaign tag is not measured, and impressions and CTR never are', async () => {
  const { stats, close } = await serve({
    pages: livePage,
    events: [
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v1', utm_campaign: 'spring' },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v1', utm_campaign: 'spring' },
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v2', utm_campaign: 'spring' }
    ]
  });
  try {
    const body = await stats({
      nodes: [page, { id: 'bare', type: 'ad-source', utmCampaign: '' }, { id: 'tagged', type: 'ad-source', utmCampaign: 'spring', spend: 0 }],
      edges: []
    });
    assert.equal(body.stats.nodes.bare.clicks, null);
    assert.equal(body.coverage.bare.why, 'no_campaign');
    assert.equal(body.stats.nodes.tagged.clicks, 2);
    assert.equal(body.stats.nodes.tagged.roas, null, 'no spend entered, so no return on it');
    for (const id of ['bare', 'tagged']) {
      assert.equal(body.stats.nodes[id].impressions, null);
      assert.equal(body.stats.nodes[id].ctr, null);
    }
  } finally {
    await close();
  }
});

test('thank-you bounce-back claims are never measured', async () => {
  const { stats, close } = await serve({
    pages: livePage,
    events: [{ type: 'thank_you_view', slug: 'vip', visitorId: 'v1' }, { type: 'thank_you_view', slug: 'vip', visitorId: 'v1' }]
  });
  try {
    const body = await stats({ nodes: [page, { id: 'ty', type: 'thank-you' }], edges: [] });
    assert.equal(body.stats.nodes.ty.pageViews, 1);
    assert.equal(body.stats.nodes.ty.bounceBackClaims, null);
  } finally {
    await close();
  }
});

// One live landing page used to mark every offer and thank-you step in the journey as measured, so
// a downsell or a second thank-you added after the last publish showed a measured 0.
test('an offer or thank-you step that is not published is unavailable, not 0, beside a live page', async () => {
  const { stats, close } = await serve({
    pages: { vip: { userId: 'u1', journeyId: 'j1', nodeId: 'node-page-1', slug: 'vip', servedThankYou: { nodeId: 'ty1' } } },
    events: [{ type: 'page_view', slug: 'vip', nodeId: 'node-page-1', visitorId: 'v1' }]
  });
  try {
    const body = await stats({
      nodes: [
        page,
        { id: 'down', type: 'upsell', offerType: 'downsell', slug: 'never-published' },
        { id: 'ty1', type: 'thank-you' },
        { id: 'ty2', type: 'thank-you' }
      ],
      edges: []
    });
    for (const id of ['down', 'ty2']) {
      assert.deepEqual(body.coverage[id], { measured: false, why: 'not_published' }, id);
      for (const v of Object.values(body.stats.nodes[id])) assert.equal(v, null, id);
    }
    // The thank-you the live page serves is measured, with no visits yet.
    assert.deepEqual(body.coverage.ty1, { measured: true });
    assert.equal(body.stats.nodes.ty1.pageViews, 0);
  } finally {
    await close();
  }
});

test('a published offer step and the thank-you its page serves count their own visits', async () => {
  const { stats, close } = await serve({
    pages: {
      vip: { userId: 'u1', journeyId: 'j1', nodeId: 'node-page-1', slug: 'vip', servedThankYou: { nodeId: 'ty2' } },
      'vip-more': { userId: 'u1', journeyId: 'j1', nodeId: 'up', slug: 'vip-more' }
    },
    events: [
      { type: 'thank_you_view', slug: 'vip', visitorId: 'v1' },
      { type: 'thank_you_view', slug: 'vip', visitorId: 'v2' },
      { type: 'upsell_view', slug: 'vip', visitorId: 'v1', offerType: 'downsell' }
    ]
  });
  try {
    const body = await stats({
      nodes: [
        page,
        { id: 'up', type: 'upsell', offerType: 'upsell', slug: 'vip-more' },
        { id: 'down', type: 'upsell', offerType: 'downsell', slug: 'no-record' },
        { id: 'ty1', type: 'thank-you' },
        { id: 'ty2', type: 'thank-you' }
      ],
      edges: []
    });
    // Published, no offer visits yet: a real 0.
    assert.deepEqual(body.coverage.up, { measured: true });
    assert.equal(body.stats.nodes.up.views, 0);
    // No record of its own, but it is the first downsell, which the landing record serves, and
    // visits of its kind were recorded: measured.
    assert.deepEqual(body.coverage.down, { measured: true });
    assert.equal(body.stats.nodes.down.views, 1);
    assert.equal(body.stats.nodes.ty2.pageViews, 2);
    assert.equal(body.coverage.ty1.why, 'not_published');
  } finally {
    await close();
  }
});

test('a second offer of a kind with no record never borrows the first one\'s visits', async () => {
  const { stats, close } = await serve({
    pages: {
      vip: { userId: 'u1', journeyId: 'j1', nodeId: 'node-page-1', slug: 'vip', servedThankYou: { nodeId: 'ty1' } },
      'vip-up': { userId: 'u1', journeyId: 'j1', nodeId: 'up', slug: 'vip-up' }
    },
    events: [
      { type: 'upsell_view', slug: 'vip', visitorId: 'v1', offerType: 'upsell' },
      { type: 'upsell_accept', slug: 'vip', visitorId: 'v1', offerType: 'upsell', amount: 20 },
      { type: 'upsell_view', slug: 'vip', visitorId: 'v2', offerType: 'downsell' }
    ]
  });
  try {
    const body = await stats({
      nodes: [
        page,
        { id: 'up', type: 'upsell', offerType: 'upsell', slug: 'vip-up' },
        { id: 'up2', type: 'upsell', offerType: 'upsell', slug: 'new-up' },
        { id: 'down', type: 'upsell', offerType: 'downsell', slug: 'no-record' },
        { id: 'down2', type: 'upsell', offerType: 'downsell', slug: 'no-record-2' },
        { id: 'ty1', type: 'thank-you' }
      ],
      edges: []
    });
    assert.deepEqual(body.coverage.up, { measured: true });
    assert.equal(body.stats.nodes.up.views, 1);
    assert.equal(body.stats.nodes.up.takes, 1);
    // The first downsell is the one the landing record serves.
    assert.deepEqual(body.coverage.down, { measured: true });
    assert.equal(body.stats.nodes.down.views, 1);
    for (const id of ['up2', 'down2']) {
      assert.deepEqual(body.coverage[id], { measured: false, why: 'not_published' }, id);
      for (const v of Object.values(body.stats.nodes[id])) assert.equal(v, null, id);
    }
  } finally {
    await close();
  }
});

test('a page published before it named its thank-you serves the journey\'s first one', async () => {
  const { stats, close } = await serve({
    pages: { vip: { userId: 'u1', journeyId: 'j1', nodeId: 'node-page-1', slug: 'vip', data: { thankYou: { headline: 'Thanks' } } } }
  });
  try {
    const body = await stats({
      nodes: [page, { id: 'ty1', type: 'thank-you' }, { id: 'ty2', type: 'thank-you' }],
      edges: []
    });
    assert.deepEqual(body.coverage.ty1, { measured: true });
    assert.equal(body.stats.nodes.ty1.pageViews, 0);
    assert.equal(body.coverage.ty2.why, 'not_published');
  } finally {
    await close();
  }
});

test('another user\'s recovery enrolment never turns this user\'s sale into a recovered one', async () => {
  const { stats, close } = await serve({
    pages: livePage,
    events: [
      { type: 'upsell_view', slug: 'vip', visitorId: 'v1', offerType: 'upsell' },
      { type: 'upsell_accept', slug: 'vip', visitorId: 'v1', offerType: 'upsell', amount: 20, email: 'shared@x.com' },
      { type: 'upsell_view', slug: 'vip', visitorId: 'v2', offerType: 'upsell' },
      { type: 'upsell_decline', slug: 'vip', visitorId: 'v2', offerType: 'upsell', email: 'other@x.com' }
    ],
    enrollments: [
      { sequenceId: 'drip_seq_upsell_recovery', status: 'converted_exit', customerEmail: 'shared@x.com', userId: 'u2', sourceSlug: 'vip' },
      { sequenceId: 'drip_seq_upsell_recovery', status: 'converted_exit', customerEmail: 'shared@x.com', userId: 'u1', sourceSlug: 'elsewhere' }
    ]
  });
  try {
    const body = await stats({ nodes: [page, { id: 'up', type: 'upsell', offerType: 'upsell' }], edges: [] });
    const up = body.stats.nodes.up;
    assert.equal(up.views, 2);
    assert.equal(up.takes, 1);
    assert.equal(up.conversionRate, 50);
    assert.equal(up.totalDeclines, 1);
    assert.equal(up.recoveredTakes, 0);
    assert.equal(up.recoveryRate, 0);
  } finally {
    await close();
  }
});

test('a recovery enrolment from this user on this journey\'s page does count', async () => {
  const { stats, close } = await serve({
    pages: livePage,
    events: [{ type: 'upsell_accept', slug: 'vip', visitorId: 'v1', offerType: 'upsell', amount: 20, email: 'back@x.com' }],
    enrollments: [{ sequenceId: 'drip_seq_upsell_recovery', status: 'converted_exit', customerEmail: 'back@x.com', userId: 'u1', sourceSlug: 'vip' }]
  });
  try {
    const up = (await stats({ nodes: [page, { id: 'up', type: 'upsell', offerType: 'upsell' }], edges: [] })).stats.nodes.up;
    assert.equal(up.recoveredTakes, 1);
    assert.equal(up.recoveryRate, null, 'no declines, so no recovery rate');
  } finally {
    await close();
  }
});

test('a full event store whose oldest event is inside the range reports where it starts', async () => {
  const events = [
    { type: 'page_view', nodeId: 'node-page-1', visitorId: 'a', at: ago(10) },
    { type: 'page_view', nodeId: 'node-page-1', visitorId: 'b', at: ago(5) },
    { type: 'page_view', nodeId: 'node-page-1', visitorId: 'c', at: ago(1) }
  ];
  const full = await serve({ pages: livePage, events, eventsKept: 3 });
  try {
    const body = await full.stats({ days: 30, nodes: [page], edges: [] });
    assert.equal(body.partialSince, events[0].at);
    const week = await full.stats({ days: 7, nodes: [page], edges: [] });
    assert.equal(week.partialSince, null, 'the store reaches back past this range');
  } finally {
    await full.close();
  }
  const roomy = await serve({ pages: livePage, events, eventsKept: 10 });
  try {
    assert.equal((await roomy.stats({ days: 30, nodes: [page], edges: [] })).partialSince, null);
  } finally {
    await roomy.close();
  }
});

test('a linked flow is measured as a whole flow, with a real zero for no enrolments', async () => {
  const { stats, close } = await serve({
    flows: [{ id: 'flow-1', name: 'Welcome' }],
    flowEnrollments: [
      { flowId: 'flow-1', status: 'handed_to_klaviyo', enrolledAt: ago(1) },
      { flowId: 'flow-1', status: 'active', enrolledAt: ago(60) }
    ],
    messageStats: { sent: 10, clicked: 2, opened: 5, revenue: null }
  });
  try {
    const body = await stats({ nodes: [{ id: 'seq', type: 'follow-up-sequence', jourvanceFlowId: 'flow-1' }], edges: [] });
    assert.equal(body.stats.nodes.seq.flowEnrolled, 0);
    assert.equal(body.stats.nodes.seq.flowSent, 10);
    assert.equal(body.stats.nodes.seq.flowRevenue, null);
    assert.deepEqual(body.coverage.seq, { measured: true, scope: 'flow' });
  } finally {
    await close();
  }
});

test('the answer carries no line stats', async () => {
  const { stats, close } = await serve({ pages: livePage });
  try {
    const body = await stats({ nodes: [page], edges: [{ id: 'e', source: 'node-page-1', target: 'x' }] });
    assert.equal(body.stats.edges, undefined);
    assert.ok(body.coverage && typeof body.coverage === 'object');
  } finally {
    await close();
  }
});

// Lead sign-ups, checkout abandoners and declined upsells are all enrolled with the page's slug,
// so an unlinked follow-up must count only the enrolments of its own kind of sequence (C08).
test('an unlinked follow-up counts only enrolments of its own kind of sequence', async () => {
  const lead = (i) => ({ sequenceId: 'drip_seq_default', userId: 'u1', sourceSlug: 'vip', customerEmail: `lead${i}@x.com`, enrolledAt: ago(1) });
  const { stats, close } = await serve({
    pages: livePage,
    enrollments: [
      lead(1), lead(2), lead(3), lead(4),
      { sequenceId: 'drip_seq_cart_recovery', userId: 'u1', sourceSlug: 'vip', customerEmail: 'cart@x.com', enrolledAt: ago(1) }
    ]
  });
  try {
    const nurture = { id: 'nurture', type: 'follow-up-sequence' };
    const cart = { id: 'cart', type: 'follow-up-sequence', sequenceType: 'checkout_recovery' };
    const bare = { id: 'bare', type: 'follow-up-sequence' };
    const body = await stats({
      nodes: [page, nurture, cart, bare],
      edges: [
        { id: 'e1', source: 'node-page-1', target: 'nurture' },
        { id: 'e2', source: 'node-page-1', target: 'cart', sourceHandle: 'abandon' },
        // No kind set: the abandon line says what it carries.
        { id: 'e3', source: 'node-page-1', target: 'bare', sourceHandle: 'abandon' }
      ]
    });
    assert.equal(body.stats.nodes.nurture.flowEnrolled, 4);
    assert.equal(body.stats.nodes.cart.flowEnrolled, 1);
    assert.equal(body.stats.nodes.bare.flowEnrolled, 1);
  } finally {
    await close();
  }
});

test('a cart-recovery step fed by a page with only lead sign-ups is a real zero, not their count', async () => {
  const { stats, close } = await serve({
    pages: livePage,
    enrollments: [1, 2, 3].map(i => ({ sequenceId: 'drip_seq_default', userId: 'u1', sourceSlug: 'vip', customerEmail: `l${i}@x.com`, enrolledAt: ago(1) }))
  });
  try {
    const body = await stats({
      nodes: [page, { id: 'cart', type: 'follow-up-sequence', sequenceType: 'checkout_recovery' }],
      edges: [{ id: 'e', source: 'node-page-1', target: 'cart', sourceHandle: 'abandon', targetHandle: 'retention-in' }]
    });
    assert.equal(body.stats.nodes.cart.flowEnrolled, 0);
    assert.deepEqual(body.coverage.cart, { measured: true });
  } finally {
    await close();
  }
});

test('a win-back or review step fed by a live page is unmeasured, never a zero, since those enrolments name no page', async () => {
  // Shaped as server.mjs (winback) and shopifyRoutes.mjs (review) write them: no sourceSlug.
  const { stats, close } = await serve({
    pages: livePage,
    enrollments: [
      ...[1, 2, 3, 4, 5].map(i => ({ sequenceId: 'drip_seq_at_risk_winback', userId: 'u1', customerEmail: `wb${i}@x.com`, status: 'active', enrolledAt: ago(1), source: 'rfm_auto_winback' })),
      ...[1, 2, 3].map(i => ({ sequenceId: 'drip_seq_review_request', userId: 'u1', customerEmail: `rv${i}@x.com`, orderId: `o${i}`, status: 'active', enrolledAt: ago(1) })),
      // Even one that does carry this page's slug is not counted: the kind is never per page.
      { sequenceId: 'drip_seq_at_risk_winback', userId: 'u1', sourceSlug: 'vip', customerEmail: 'manual@x.com', enrolledAt: ago(1) }
    ],
    events: [
      { type: 'page_view', nodeId: 'node-page-1', visitorId: 'v1' },
      // A Klaviyo handoff names its step, so a review step that has one is measured by it.
      { type: 'klaviyo_handoff', entered: true, nodeId: 'rv2', email: 'k@x.com' }
    ]
  });
  try {
    const body = await stats({
      nodes: [
        page,
        { id: 'wb', type: 'follow-up-sequence', sequenceType: 'at_risk_winback' },
        { id: 'rv', type: 'follow-up-sequence', sequenceType: 'fulfillment_review' },
        { id: 'rv2', type: 'follow-up-sequence', sequenceType: 'fulfillment_review' }
      ],
      edges: [
        { id: 'e1', source: 'node-page-1', target: 'wb' },
        { id: 'e2', source: 'node-page-1', target: 'rv' },
        { id: 'e3', source: 'node-page-1', target: 'rv2' }
      ]
    });
    for (const id of ['wb', 'rv']) {
      assert.equal(body.stats.nodes[id].flowEnrolled, null, id);
      assert.deepEqual(body.coverage[id], { measured: false, why: 'not_by_page' }, id);
    }
    assert.equal(body.stats.nodes.rv2.flowEnrolled, 1);
    assert.deepEqual(body.coverage.rv2, { measured: true });
  } finally {
    await close();
  }
});

test('an enrolment is typed by its sequence\'s own trigger, so a custom sequence counts on the right step', async () => {
  const { stats, close } = await serve({
    pages: livePage,
    sequences: [
      { id: 'drip_seq_42', triggerType: 'checkout_abandonment' },
      { id: 'drip_seq_43', triggerType: 'exit_intent' }
    ],
    enrollments: [
      { sequenceId: 'drip_seq_42', userId: 'u1', sourceSlug: 'vip', customerEmail: 'a@x.com', enrolledAt: ago(1) },
      { sequenceId: 'drip_seq_43', userId: 'u1', sourceSlug: 'vip', customerEmail: 'b@x.com', enrolledAt: ago(1) },
      // A sequence nobody can name is not counted anywhere.
      { sequenceId: 'drip_seq_gone', userId: 'u1', sourceSlug: 'vip', customerEmail: 'c@x.com', enrolledAt: ago(1) }
    ]
  });
  try {
    const body = await stats({
      nodes: [page, { id: 'cart', type: 'follow-up-sequence', sequenceType: 'checkout_recovery' }, { id: 'nurture', type: 'follow-up-sequence', sequenceType: 'lead_nurture' }],
      edges: [
        { id: 'e1', source: 'node-page-1', target: 'cart', sourceHandle: 'abandon' },
        { id: 'e2', source: 'node-page-1', target: 'nurture' }
      ]
    });
    assert.equal(body.stats.nodes.cart.flowEnrolled, 1);
    assert.equal(body.stats.nodes.nurture.flowEnrolled, 1);
  } finally {
    await close();
  }
});

test('followUpTriggers: the step\'s own kind, else its line\'s, else nurture', () => {
  assert.deepEqual(followUpTriggers({ sequenceType: 'checkout_recovery' }, []), ['checkout_abandonment']);
  assert.deepEqual(followUpTriggers({ sequenceType: 'upsell_recovery' }, [null]), ['upsell_recovery']);
  assert.deepEqual(followUpTriggers({ sequenceType: 'at_risk_winback' }, []), ['at_risk_inactivity']);
  assert.deepEqual(followUpTriggers({ sequenceType: 'fulfillment_review' }, []), ['fulfillment_review']);
  assert.deepEqual(followUpTriggers({}, ['abandon']), ['checkout_abandonment']);
  assert.deepEqual(followUpTriggers({ sequenceType: 'lead_nurture' }, ['rescue']), ['upsell_recovery']);
  assert.deepEqual(followUpTriggers({}, ['declined']), ['upsell_recovery']);
  assert.deepEqual(followUpTriggers({}, [null]), ['lead_capture', 'exit_intent']);
  // A saved kind that is not one of ours reads as nurture, as the step draws it.
  assert.deepEqual(followUpTriggers({ sequenceType: 'constructor' }, []), ['lead_capture', 'exit_intent']);
});
