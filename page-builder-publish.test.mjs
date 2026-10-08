// Publishing carries the landing page builder document (LANDING_BUILDER_PLAN.md, wave 1b).
// Drives the real publish route over HTTP with storage stubbed, in the style of
// journey-publish.test.mjs. What is held here:
// - a valid `builder` (and `builderB`) reaches the stored public record byte for byte;
// - an invalid one is refused with 400 and the path of every problem, and NOTHING is written:
//   the previous public record, the journey and the publish log are all untouched;
// - a node with no `builder` publishes with no builder field anywhere in the record;
// - the lead body the legacy modal posts is worded by publicLeadScript.mjs, in the design's order.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';
import { renderPublicFunnelHtml } from './server/routes/publicRoutes.mjs';
import { leadBodyScript, LEAD_BODY_FIELDS } from './server/routes/publicLeadScript.mjs';
import { createEmptyPage, createNode, insertNode, validateBuilderDoc } from './src/lib/pageBuilder/model.mjs';

function validDoc(headingText = 'Hello') {
  let doc = createEmptyPage();
  const section = createNode('section');
  doc = insertNode(doc, null, 0, section).doc;
  const heading = createNode('widget', 'heading');
  heading.props = { ...heading.props, text: headingText };
  doc = insertNode(doc, section.children[0].id, 0, heading).doc;
  return doc;
}

function journeyWith(data) {
  return {
    id: 'j1',
    nodes: [{ id: 'page-1', type: 'landing-page', data: { type: 'landing-page', slug: 'offer', headline: 'Offer', ...data } }],
    edges: []
  };
}

async function serve({ journey, records = {} }) {
  const saved = { ...records };
  const counts = { saveJourney: 0, savePublicPage: 0, savePublishLog: 0 };
  const store = { journey };
  const logs = {};
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    loadJourney: async () => store.journey,
    saveJourney: async (_uid, _id, j) => { counts.saveJourney += 1; store.journey = j; return { durable: true }; },
    loadWorkspace: async (_uid, wsId) => ({ id: wsId, shopifyConfig: { storeDomain: 'real-shop.myshopify.com', status: 'connected' } }),
    realStoreDomain: () => '',
    validateSlugAvailability: async (slug) => ({ available: true, cleanSlug: slug }),
    reloadDomainRegistry: () => {},
    domainRegistryCache: {},
    savePublicPage: async (key, record) => { counts.savePublicPage += 1; saved[key] = record; },
    removePublicPage: async (key) => { delete saved[key]; return true; },
    loadPublicPage: async (key) => saved[key] || null,
    loadPublishLog: async (uid, id) => ({ ok: true, log: logs[`${uid}:${id}`] || null }),
    savePublishLog: async (uid, id, log) => { counts.savePublishLog += 1; logs[`${uid}:${id}`] = structuredClone(log); return { durable: true }; },
    renderPublicFunnelHtml: () => '<html><head></head><body></body></html>',
    renderPublicUpsellHtml: () => '<html><head></head><body></body></html>',
    persistPublicPages: () => {},
    publicPageCache: {},
    now: () => Date.parse('2026-10-08T10:00:00.000Z')
  };
  const app = express();
  app.use(express.json());
  setupJourneyRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    saved, counts, store, logs,
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); })
  };
}

async function publish(journey, records) {
  const ctx = await serve({ journey, records });
  try {
    const res = await fetch(`${ctx.base}/api/journey/j1/publish`, { method: 'POST' });
    return { ...ctx, status: res.status, body: await res.json() };
  } finally {
    await ctx.close();
  }
}

test('a valid builder document reaches the stored public record byte for byte', async () => {
  const builder = validDoc('Version A');
  const builderB = validDoc('Version B');
  assert.equal(validateBuilderDoc(builder).ok, true, 'precondition: the fixture is valid');
  const r = await publish(journeyWith({ builder, builderB }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const record = r.saved.offer;
  assert.ok(record, 'the landing page was stored under its slug');
  assert.equal(JSON.stringify(record.builder), JSON.stringify(builder));
  assert.equal(JSON.stringify(record.builderB), JSON.stringify(builderB));
  assert.equal(JSON.stringify(record.data.builder), JSON.stringify(builder), 'the node data keeps it too');
});

test('an invalid builder document is refused with its paths and nothing changes', async () => {
  const bad = validDoc();
  bad.sections[0].children[0].children[0].props.level = 'banana';
  bad.sections[0].children[0].children[0].type = 'notAWidget';
  const problems = validateBuilderDoc(bad).problems;
  assert.ok(problems.length > 0, 'precondition: the fixture is invalid');

  const previous = { slug: 'offer', data: { headline: 'Old page' }, publishedAt: 'earlier' };
  const journey = journeyWith({ builder: bad });
  const before = JSON.stringify(journey);
  const r = await publish(journey, { offer: previous });

  assert.equal(r.status, 400);
  assert.equal(r.body.success, false);
  assert.match(r.body.error, /nothing was published/);
  assert.ok(Array.isArray(r.body.problems) && r.body.problems.length > 0);
  for (const p of r.body.problems) {
    assert.equal(p.nodeId, 'page-1');
    assert.equal(p.field, 'builder');
    assert.equal(typeof p.path, 'string');
    assert.equal(typeof p.message, 'string');
  }
  assert.deepEqual(r.body.problems.map(p => p.path), problems.map(p => p.path), 'the paths are the model\'s own');
  assert.equal(r.counts.savePublicPage, 0, 'no page was written');
  assert.equal(r.counts.saveJourney, 0, 'the journey was not saved');
  assert.equal(r.counts.savePublishLog, 0, 'no revision was recorded');
  assert.equal(r.saved.offer, previous, 'the previous public record is the same object');
  assert.equal(JSON.stringify(r.store.journey), before, 'the loaded journey is untouched');
});

test('an invalid builderB refuses the publish too, and names the field', async () => {
  const r = await publish(journeyWith({ builder: validDoc(), builderB: { version: 1, sections: 'x' } }));
  assert.equal(r.status, 400);
  assert.ok(r.body.problems.every(p => p.field === 'builderB'));
  assert.equal(r.counts.savePublicPage, 0);
});

test('a node with no builder publishes with no builder field anywhere', async () => {
  const r = await publish(journeyWith({}));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const record = r.saved.offer;
  assert.ok(record);
  assert.equal('builder' in record, false);
  assert.equal('builderB' in record, false);
  assert.equal('builder' in record.data, false);
  assert.equal(record.data.headline, 'Offer');
});

test('a null builder is the same as none', async () => {
  const r = await publish(journeyWith({ builder: null }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal('builder' in r.saved.offer, false);
});

test('the lead body script words the fields the design names, in order', () => {
  const script = leadBodyScript();
  assert.deepEqual(LEAD_BODY_FIELDS, [
    'slug', 'email', 'name', 'phone', 'order_bump_selected', 'variant', 'currency',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'fbclid', 'ttclid', 'gclid', 'visitorId', 'ref'
  ]);
  let at = -1;
  for (const f of LEAD_BODY_FIELDS) {
    const i = script.search(new RegExp(`(^|\\s)${f}\\b`, 'm'));
    assert.ok(i > at, `${f} appears after the field before it`);
    at = i;
  }
  assert.match(script, /utm_content: \(utm_content \? utm_content \+ '_' : ''\) \+ 'var-' \+ activeVariant/);
  assert.match(script, /^body: JSON\.stringify\(\{/);
});

test('input expressions can be named, and anything else is refused', () => {
  const s = leadBodyScript({ emailExpr: "document.getElementById('x').value", nameExpr: 'nameEl.value', phoneExpr: 'phoneEl.value' });
  assert.match(s, /email: document\.getElementById\('x'\)\.value,/);
  assert.match(s, /name: nameEl\.value,/);
  for (const bad of ['a;b', 'alert(1)//', '', 'x.value, evil: 1', 5]) {
    assert.throws(() => leadBodyScript({ emailExpr: bad }), /plain identifier path/, String(bad));
  }
});

test('the legacy page template emits exactly the script text', () => {
  const html = renderPublicFunnelHtml(
    { slug: 'probe', data: { headline: 'H', buttonText: 'Buy' }, shopifyConfig: {} },
    { query: {}, headers: {}, params: {} },
    null
  );
  assert.ok(html.includes(`headers: { 'Content-Type': 'application/json' },\n              ${leadBodyScript()}\n            });`));
});
