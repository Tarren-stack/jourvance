import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  NON_CONTENT_KEYS,
  FINGERPRINT_VERSION,
  stepFingerprint,
  isPublishableStep,
  publishKey,
  normalizeSlug,
  splitBranchTargets,
  stepPublishState,
  stepPublishStates,
  publishStateLabel,
  publishStateDetail,
  publicationRead,
  applyPublishResult,
  startRevision,
  finishRevision,
  markUnpublished,
  liveRevisionEntry,
  everyLoggedPage,
  MAX_REVISIONS,
  PREVIEW_TTL_MS,
  previewExpiryText
} from './src/lib/publishState.ts';
import { applyLiveStats, MEASURED_KEYS, FLOW_STAT_KEYS } from './src/lib/liveStats.ts';

// "Published" used to be a flag the browser set with its own clock. These pin the rules that
// replace it: what counts as content, how a server answer becomes a status, and the revision log.

const DASHES = /—| – /;

function landing(extra = {}) {
  return {
    id: 'page-1',
    type: 'landing-page',
    position: { x: 0, y: 0 },
    data: {
      type: 'landing-page',
      label: 'Offer',
      slug: 'my-offer',
      headline: 'Sleep better tonight',
      subhead: 'A calmer evening',
      bullets: ['One', 'Two', 'Three'],
      buttonText: 'Buy',
      trustBadge: '',
      visitors: 0,
      conversions: 0,
      conversionRate: 0,
      variantB: { headline: 'B headline', bullets: ['x'] },
      ...extra
    }
  };
}

const fp = (node, edges = []) => stepFingerprint(node, edges);
const withData = (node, patch) => ({ ...node, data: { ...node.data, ...patch } });

// ── Fingerprints ──

test('a fingerprint is versioned and only exists for publishable steps', () => {
  assert.match(fp(landing()), new RegExp(`^${FINGERPRINT_VERSION}:[0-9a-f]{14}$`));
  for (const type of ['landing-page', 'upsell', 'ab-split', 'thank-you']) {
    assert.equal(isPublishableStep({ id: 'x', type, data: {} }), true, type);
    assert.ok(fp({ id: 'x', type, data: {} }), type);
  }
  for (const type of ['lead-form', 'ad-source', 'follow-up-sequence']) {
    assert.equal(isPublishableStep({ id: 'x', type, data: {} }), false, type);
    assert.equal(fp({ id: 'x', type, data: {} }), null, type);
  }
});

test('a stats poll changes no fingerprint', () => {
  const page = landing();
  const stats = {};
  for (const key of MEASURED_KEYS) stats[key] = 7;
  for (const key of FLOW_STAT_KEYS) stats[key] = 3;
  stats.leads = 4;
  stats.jourvanceFlowName = 'Welcome';
  const project = { id: 'j', nodes: [page], edges: [], updatedAt: 'x' };
  const polled = applyLiveStats(project, { nodes: { [page.id]: stats } });
  assert.notEqual(polled.nodes[0], page, 'the poll did change the node');
  assert.equal(fp(polled.nodes[0]), fp(page));
});

test('view state, publish bookkeeping and the merged snapshots are not content', () => {
  const page = landing();
  const base = fp(page);
  const cases = {
    canvasViewMode: 'roas',
    published: true,
    publishedAt: '2026-09-01T00:00:00.000Z',
    publishedUrl: '/p/my-offer',
    customDomainVerified: true,
    upsell: { headline: 'Upsell' },
    downsell: { headline: 'Downsell' },
    hasDownsell: true,
    thankYou: { headline: 'Thanks' }
  };
  for (const [key, value] of Object.entries(cases)) {
    assert.equal(fp(withData(page, { [key]: value })), base, key);
  }
});

test('copy, slug and variant edits change the fingerprint', () => {
  const page = landing();
  const base = fp(page);
  assert.notEqual(fp(withData(page, { headline: 'Sleep better' })), base, 'headline');
  assert.notEqual(fp(withData(page, { slug: 'other' })), base, 'slug');
  assert.notEqual(fp(withData(page, { variantB: { headline: 'New B', bullets: ['x'] } })), base, 'variantB.headline');
  assert.notEqual(fp(withData(page, { bullets: ['Two', 'One', 'Three'] })), base, 'bullet order');
  const split = { id: 's', type: 'ab-split', data: { slug: 'try', branchAPageSlug: 'a' } };
  assert.notEqual(fp(withData(split, { branchAPageSlug: 'b' })), fp(split), 'branch A page slug');
});

test('the deny-list is top level only: a nested "views" is content', () => {
  const page = landing({ variantB: { headline: 'B', views: 1 } });
  assert.notEqual(fp(withData(page, { variantB: { headline: 'B', views: 2 } })), fp(page));
});

test('key order, a JSON round trip and undefined values do not matter', () => {
  const page = landing();
  const reversed = { ...page, data: Object.fromEntries(Object.entries(page.data).reverse()) };
  assert.equal(fp(reversed), fp(page));
  assert.equal(fp(JSON.parse(JSON.stringify(page))), fp(page));
  assert.equal(fp(withData(page, { discountCode: undefined })), fp(page));
});

test('a split fingerprint follows its branch lines, not their stats', () => {
  const split = { id: 's', type: 'ab-split', data: { slug: 'try' } };
  const edges = [
    { id: 'e1', source: 's', sourceHandle: 'branch-a', target: 'a', data: { rate: 1 } },
    { id: 'e2', source: 's', sourceHandle: 'branch-b', target: 'b', data: { rate: 1 } }
  ];
  const base = fp(split, edges);
  assert.notEqual(fp(split, [edges[0], { ...edges[1], target: 'c' }]), base);
  assert.equal(fp(split, edges.map(e => ({ ...e, data: { rate: 99, sourceThroughput: 5 } }))), base);
  assert.deepEqual(splitBranchTargets('s', edges), { a: 'a', b: 'b' });
  assert.deepEqual(splitBranchTargets('s', []), { a: null, b: null });
});

// ── Publish keys ──

test('publishKey matches the addresses publish writes', () => {
  assert.equal(publishKey({ id: 'up-123456789', type: 'upsell', data: {} }), 'up-123456789-upsell');
  assert.equal(publishKey({ id: 'sp', type: 'ab-split', data: { slug: 'Try It!' } }), 'split:try-it');
  assert.equal(publishKey({ id: 'sp', type: 'ab-split', data: {} }), 'split:sp-split');
  assert.equal(publishKey({ id: 'page-abcdef', type: 'landing-page', data: { slug: '!!!' } }), 'offer-page-a');
  assert.equal(publishKey({ id: 'p', type: 'landing-page', data: { slug: 'My Offer!' } }), 'my-offer');
  assert.equal(publishKey({ id: 't', type: 'thank-you', data: { slug: 'x' } }), null);
  assert.equal(normalizeSlug(' -My Offer!- '), 'my-offer');
});

// ── Status ──

const liveRead = (steps) => ({ kind: 'read', report: { checkedAt: 'now', steps, liveRevision: null } });

test('the status matrix and its labels', () => {
  const page = landing();
  const live = (fingerprint) => liveRead({ [page.id]: { live: true, url: '/p/my-offer', fingerprint, revisionNumber: 3, publishedAt: '2026-09-01T10:00:00.000Z' } });
  const cases = [
    [live(fp(page)), 'published', 'Published'],
    [live(`${FINGERPRINT_VERSION}:00000000000000`), 'changed', 'Unpublished changes'],
    [liveRead({}), 'not-published', 'Not published'],
    [live(null), 'untracked', 'Live, changes unknown'],
    [live('z9:abc'), 'untracked', 'Live, changes unknown'],
    [{ kind: 'checking' }, 'checking', 'Checking status'],
    [null, 'checking', 'Checking status'],
    [{ kind: 'unavailable', message: 'x' }, 'unknown', 'Status unavailable'],
    [{ kind: 'signed-out' }, 'not-published', 'Not published']
  ];
  for (const [read, kind, label] of cases) {
    const state = stepPublishState(page, [], read);
    assert.equal(state.kind, kind, JSON.stringify(read));
    assert.equal(publishStateLabel(state), label);
  }
  const flagged = stepPublishState(withData(page, { published: true }), [], { kind: 'signed-out' });
  assert.deepEqual(flagged, { kind: 'unknown', reason: 'signed-out' });
  assert.equal(publishStateLabel(flagged), 'Status unavailable');
  assert.equal(publishStateDetail(flagged, 'landing-page'), 'Sign in to see what is live.');
  const published = stepPublishState(page, [], live(fp(page)));
  assert.equal(published.revisionNumber, 3);
  for (const type of ['lead-form', 'ad-source', 'follow-up-sequence']) {
    assert.equal(stepPublishState({ id: 'n', type, data: { published: true } }, [], live(null)), null, type);
  }
  const states = stepPublishStates([page, { id: 'f', type: 'lead-form', data: {} }], [], liveRead({}));
  assert.deepEqual([...states.keys()], [page.id]);
});

test('status details are short sentences and never throw on a bad date', () => {
  const info = { revisionNumber: 3, publishedAt: '2026-09-01T10:00:00.000Z' };
  const when = () => 'Sep 1';
  assert.equal(publishStateDetail({ kind: 'published', ...info }, 'landing-page', when), 'Revision 3 went live on Sep 1. Visitors see this version.');
  assert.equal(
    publishStateDetail({ kind: 'changed', ...info }, 'landing-page', when),
    'You changed this step after revision 3 went live on Sep 1. Visitors still see the older version. Publish the funnel to put your changes live.'
  );
  assert.equal(publishStateDetail({ kind: 'published', revisionNumber: 2, publishedAt: 'not a date' }), 'Revision 2 went live. Visitors see this version.');
  assert.equal(publishStateDetail({ kind: 'published', ...info }, 'upsell', () => { throw new Error('boom'); }), 'Revision 3 went live. Visitors see this version.');
  assert.equal(publishStateDetail({ kind: 'not-published' }, 'upsell'), 'This step is not on the web. Publish the funnel to put it live.');
  assert.match(publishStateDetail({ kind: 'not-published' }, 'thank-you'), /^No live landing page shows this thank-you step\./);
  assert.equal(publishStateDetail({ kind: 'unknown', reason: 'unavailable' }), 'The status check did not work. Try again.');
});

test('publicationRead turns every failure into "unavailable" and keeps only well-formed steps', () => {
  const unavailable = (answer) => {
    const r = publicationRead(answer);
    assert.equal(r.kind, 'unavailable', JSON.stringify(answer));
    assert.ok(r.message.length > 10);
    assert.doesNotMatch(r.message, DASHES);
    return r.message;
  };
  assert.match(unavailable(null), /could not reach the server/);
  assert.match(unavailable({ status: 401, body: {} }), /sign-in has expired/);
  assert.match(unavailable({ status: 500, body: {} }), /status 500/);
  assert.equal(unavailable({ status: 500, body: { success: false, error: 'The status check did not finish on the server. Try again.' } }), 'The status check did not finish on the server. Try again.');
  unavailable({ status: 200, body: { success: false } });
  unavailable({ status: 200, body: { success: true, steps: [] } });
  unavailable({ status: 200, body: { success: true } });
  const good = publicationRead({
    status: 200,
    body: {
      success: true,
      checkedAt: '2026-09-01T00:00:00.000Z',
      steps: {
        a: { live: true, url: '/p/a', fingerprint: 'c1:1', revisionNumber: 2, publishedAt: 'x' },
        b: { live: true, url: '/p/b', fingerprint: null, revisionNumber: null, publishedAt: 'x' },
        c: { live: true, url: 5, fingerprint: 'c1:1' },
        d: { live: true, url: '/p/d', fingerprint: 7 }
      },
      liveRevision: { id: 'rev_1', number: 2, publishedAt: 'x' }
    }
  });
  assert.equal(good.kind, 'read');
  assert.deepEqual(Object.keys(good.report.steps), ['a', 'b']);
  assert.equal(good.report.steps.b.fingerprint, null);
  assert.deepEqual(good.report.liveRevision, { id: 'rev_1', number: 2, publishedAt: 'x' });
});

// ── Applying a publish answer ──

test('applyPublishResult mirrors only listed, well-formed steps and leaves updatedAt alone', () => {
  const project = {
    id: 'j',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [
      landing({ slug: 'My Offer!', customDomain: 'https://Shop.Example.com/x', headline: 'Edited' }),
      { id: 'up', type: 'upsell', data: { type: 'upsell', headline: 'U' } },
      { id: 's', type: 'ab-split', data: { type: 'ab-split', slug: 'try' } },
      { id: 'f', type: 'lead-form', data: { type: 'lead-form' } }
    ],
    edges: []
  };
  const at = '2026-09-01T10:00:00.000Z';
  const next = applyPublishResult(project, [
    { nodeId: 'page-1', type: 'landing-page', slug: 'my-offer', url: '/p/my-offer', publishedAt: at, customDomain: 'shop.example.com' },
    { nodeId: 'up', type: 'upsell', slug: 'up-upsell', url: '/p/up-upsell', publishedAt: at },
    { nodeId: 's', type: 'ab-split', slug: 'try', url: '/p/split/try', publishedAt: at, branchAPageSlug: 'my-offer', branchBPageSlug: 'b' },
    { nodeId: 'f', type: 'lead-form', slug: 'x', url: 'https://evil.example/x', publishedAt: at },
    { nodeId: 7, slug: 'x', url: '/p/x' }
  ]);
  assert.equal(next.updatedAt, project.updatedAt);
  const [page, up, split, form] = next.nodes;
  assert.equal(page.data.slug, 'my-offer');
  assert.equal(page.data.customDomain, 'shop.example.com');
  assert.equal(page.data.headline, 'Edited');
  assert.equal(page.data.published, true);
  assert.equal(page.data.publishedAt, at);
  assert.equal(page.data.publishedUrl, '/p/my-offer');
  assert.equal(up.data.slug, 'up-upsell');
  assert.equal(up.data.published, true);
  assert.equal(split.data.branchAPageSlug, 'my-offer');
  assert.equal(split.data.branchBPageSlug, 'b');
  assert.equal(form, project.nodes[3], 'a malformed entry changes nothing');
  assert.equal(applyPublishResult(project, []), project);
  assert.equal(applyPublishResult(project, null), project);
});

// ── Revision log ──

test('revisions are numbered 1, 2, 3 and a number is never reused after trimming', () => {
  let log = startRevision(null, 'r1', 't1');
  assert.equal(log.lastNumber, 1);
  log = finishRevision(log, 'r1', [{ nodeId: 'p', type: 'landing-page', key: 'p', url: '/p/p' }], 't1b');
  log = startRevision(log, 'r2', 't2');
  assert.equal(log.entries.find(e => e.id === 'r2').status, 'started', 'a started entry stays started');
  log = finishRevision(log, 'r2', [], 't2b');
  assert.equal(log.entries.find(e => e.id === 'r1').status, 'replaced');
  assert.equal(liveRevisionEntry(log).number, 2);
  log = startRevision(log, 'r3', 't3');
  assert.equal(log.entries.at(-1).number, 3);
  assert.equal(log.entries.at(-1).status, 'started');
  for (let i = 4; i <= MAX_REVISIONS + 10; i++) log = startRevision(log, `r${i}`, `t${i}`);
  assert.equal(log.entries.length, MAX_REVISIONS);
  assert.ok(log.entries.some(e => e.id === 'r2'), 'the live entry is never trimmed');
  const numbers = log.entries.map(e => e.number);
  assert.equal(new Set(numbers).size, numbers.length);
  log = startRevision(log, 'next', 'tn');
  assert.equal(log.entries.at(-1).number, MAX_REVISIONS + 11);
  const off = markUnpublished(log, 'toff');
  assert.equal(off.liveRevisionId, null);
  assert.equal(off.unpublishedAt, 'toff');
  assert.equal(liveRevisionEntry(off), null);
  assert.equal(startRevision(off, 'after', 'ta').lastNumber, MAX_REVISIONS + 12);
  assert.equal(markUnpublished(null, 'x'), null);
});

test('a trimmed revision hands its pages to retiredPages unless a kept entry names them', () => {
  const page = (key) => ({ nodeId: key, type: 'landing-page', key, url: `/p/${key}` });
  let log = startRevision(null, 'r1', 't1', [page('old-offer'), page('shared')]);
  log = finishRevision(log, 'r1', [page('old-offer'), page('shared')], 't1b');
  log = startRevision(log, 'r2', 't2', [page('shared')]);
  log = finishRevision(log, 'r2', [page('shared')], 't2b');
  for (let i = 3; i <= MAX_REVISIONS + 1; i++) log = startRevision(log, `r${i}`, `t${i}`);
  assert.ok(!log.entries.some(e => e.id === 'r1'), 'r1 was trimmed');
  // old-offer may still be live and nothing else names it; shared is still on the live entry.
  assert.deepEqual(log.retiredPages.map(p => p.key), ['old-offer']);
  assert.deepEqual(everyLoggedPage(log).map(p => p.key).sort(), ['old-offer', 'shared']);
  // A later trim keeps what was retired before.
  log = startRevision(log, 'rx', 'tx');
  assert.deepEqual(log.retiredPages.map(p => p.key), ['old-offer']);
  // Taking the funnel offline takes every address down, so nothing stays retired.
  const off = markUnpublished(log, 'toff');
  assert.equal('retiredPages' in off, false);
  assert.deepEqual(everyLoggedPage(off).map(p => p.key), ['shared']);
  assert.deepEqual(everyLoggedPage(null), []);
});

test('everyLoggedPage names replaced, offline and started revisions too, once each', () => {
  const page = (key) => ({ nodeId: key, type: 'landing-page', key, url: `/p/${key}` });
  let log = startRevision(null, 'r1', 't1', [page('a')]);
  log = finishRevision(log, 'r1', [page('a')], 't1b');
  log = startRevision(log, 'r2', 't2', [page('b')]);
  log = finishRevision(log, 'r2', [page('b')], 't2b');
  log = markUnpublished(log, 't3');
  log = startRevision(log, 'r3', 't4', [page('c'), page('a')]);
  assert.deepEqual(log.entries.map(e => e.status), ['replaced', 'offline', 'started']);
  assert.deepEqual(everyLoggedPage(log).map(p => p.key), ['a', 'b', 'c']);
});

// ── Preview expiry ──

test('previewExpiryText counts down and then says the link expired', () => {
  const now = Date.parse('2026-09-01T10:00:00.000Z');
  const at = (ms) => new Date(now + ms).toISOString();
  assert.equal(PREVIEW_TTL_MS, 3_600_000);
  assert.equal(previewExpiryText(at(PREVIEW_TTL_MS), now), 'Works for 60 more minutes.');
  assert.equal(previewExpiryText(at(30_000), now), 'Works for 1 more minute.');
  assert.equal(previewExpiryText(at(0), now), 'This preview link has expired. Make a new one.');
  assert.equal(previewExpiryText('garbage', now), 'This preview link has expired. Make a new one.');
});

test('no status text uses an em dash or a spaced en dash', () => {
  const states = [
    { kind: 'published', revisionNumber: 1, publishedAt: '2026-09-01T00:00:00.000Z' },
    { kind: 'changed', revisionNumber: null, publishedAt: '' },
    { kind: 'untracked', revisionNumber: null, publishedAt: '' },
    { kind: 'not-published' },
    { kind: 'checking' },
    { kind: 'unknown', reason: 'signed-out' },
    { kind: 'unknown', reason: 'unavailable' }
  ];
  for (const s of states) {
    assert.doesNotMatch(publishStateLabel(s), DASHES);
    for (const type of ['landing-page', 'thank-you']) assert.doesNotMatch(publishStateDetail(s, type), DASHES);
  }
  assert.doesNotMatch(previewExpiryText('x', 0), DASHES);
});

// ── Drift pin ──

/** Top-level keys of every object literal assigned to nodeStats[node.id], plus every `keys` list. */
function analyticsStatKeys() {
  const src = fs.readFileSync(new URL('./server/routes/analyticsRoutes.mjs', import.meta.url), 'utf8');
  const keys = new Set();
  const marker = 'nodeStats[node.id] = {';
  let at = src.indexOf(marker);
  let literals = 0;
  while (at >= 0) {
    literals += 1;
    let i = at + marker.length;
    let depth = 1;
    let part = '';
    const parts = [];
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if ('{[('.includes(ch)) depth += 1;
      if ('}])'.includes(ch)) depth -= 1;
      if (depth === 0) break;
      if (ch === ',' && depth === 1) { parts.push(part); part = ''; } else part += ch;
    }
    parts.push(part);
    for (const p of parts) {
      const clean = p.replace(/\/\/.*$/gm, '').trim();
      const m = clean.match(/^([A-Za-z_$][\w$]*)\s*(:|$)/);
      if (m) keys.add(m[1]);
    }
    at = src.indexOf(marker, i);
  }
  for (const m of src.matchAll(/const keys = \[([^\]]*)\]/g)) {
    for (const k of m[1].matchAll(/'([^']+)'/g)) keys.add(k[1]);
  }
  return { keys, literals };
}

test('every stat the funnel stats route writes onto a step is outside the fingerprint', () => {
  const { keys, literals } = analyticsStatKeys();
  assert.ok(literals >= 7, `found ${literals} nodeStats literals`);
  assert.ok(keys.size >= 30, `found ${keys.size} keys`);
  const missing = [...keys].filter(k => !NON_CONTENT_KEYS.has(k));
  assert.deepEqual(missing, []);
  assert.equal(NON_CONTENT_KEYS.has('branchAPageSlug'), false);
  assert.equal(NON_CONTENT_KEYS.has('branchBPageSlug'), false);
});
