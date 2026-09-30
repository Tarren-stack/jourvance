// AI journey builder (#25): the model writes copy only, and code checks and builds the rest.
// Pins src/lib/journeyAi.ts (structure, content and claim checks, the build, the walk-through,
// the answer reading and the saved draft) and walkJourney in src/lib/journeyWalk.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  requiredPlanRoles,
  readAiPlan,
  planProblems,
  createBlocker,
  claimFlags,
  delayLabel,
  buildJourneyFromPlan,
  simulateAiJourney,
  aiPlanOutcome,
  LIMIT_WAITED_MESSAGE,
  readSavedAiDraft,
  writeSavedAiDraft,
  fieldInputId,
  fieldLabel,
  PLAN_LIMITS,
  SOURCE_HANDLES,
  AI_DRAFT_STORAGE_KEY,
  DEFAULT_BRIEF
} from './src/lib/journeyAi.ts';
import { walkJourney, journeyEntry, handleFor } from './src/lib/journeyWalk.ts';
import { edgeKind } from './src/lib/edgeKinds.ts';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from './src/lib/defaultBlueprint.ts';

const EM = '—';
const SPACED_EN = ' – ';

const brief = (over = {}) => ({
  ...DEFAULT_BRIEF,
  offer: 'Beginner pottery class, 6 weeks, $49 a month. Clay and tools included.',
  audience: 'Adults new to pottery',
  businessType: 'Pottery studio',
  ...over
});

const LEADS_AB = brief({ goal: 'leads', abTest: true });
const SALES_ALL = brief({ goal: 'sales', abTest: true, upsell: true });

function page(role) {
  return {
    role,
    title: `${role} page`,
    headline: `Learn pottery ${role}`,
    subhead: 'A calm class for people who have never touched clay.',
    bullets: role === 'thanks' ? [] : ['Small groups', 'Clay and tools included'],
    button: role === 'thanks' ? '' : 'Save my seat',
    decline: role === 'upsell' ? 'No thanks' : '',
    reason: `Why ${role}.`
  };
}

function fixturePlan(b) {
  const roles = requiredPlanRoles(b);
  return {
    name: 'Pottery Starter',
    strategy: 'An ad leads to one page, then a short email series.',
    assumptions: ['Classes run in the evening.'],
    hypothesis: b.abTest ? 'A shorter headline gets more sign-ups.' : '',
    ad: { headline: 'Try pottery this month', body: 'A calm class for beginners.', cta: 'Book now', reason: 'Reach new people.' },
    pages: roles.pages.map(page),
    form: roles.form ? { title: 'Save your seat', button: 'Send', success: 'Thanks. We will be in touch.', reason: 'Collect details.' } : null,
    emails: roles.emails.map(role => ({
      role,
      name: `${role} series`,
      reason: `Why ${role}.`,
      messages: [
        { subject: 'Hi [First Name]', preview: 'A note', body: 'Hi [First Name], here is what to expect.', delayHours: 0 },
        { subject: 'Still thinking?', preview: 'A reminder', body: 'The class starts soon.', delayHours: 24 },
        { subject: 'Last note', preview: 'One more', body: 'This is our last note.', delayHours: 48 }
      ]
    }))
  };
}

const clone = v => structuredClone(v);

// ---- requiredPlanRoles ----

test('requiredPlanRoles gives the pages, form and emails for all 8 brief shapes', () => {
  for (const goal of ['leads', 'sales']) {
    for (const abTest of [false, true]) {
      for (const upsell of [false, true]) {
        const r = requiredPlanRoles({ goal, abTest, upsell });
        const pages = ['landing', ...(abTest ? ['landing-b'] : []), ...(goal === 'sales' && upsell ? ['upsell'] : []), 'thanks'];
        assert.deepEqual(r.pages, pages, `${goal} ab=${abTest} upsell=${upsell}`);
        assert.equal(r.form, goal === 'leads');
        assert.deepEqual(r.emails, goal === 'sales' ? ['followup', 'recovery'] : ['followup']);
      }
    }
  }
  assert.ok(!requiredPlanRoles({ goal: 'leads', abTest: false, upsell: true }).pages.includes('upsell'), 'upsell is ignored for leads');
});

// ---- readAiPlan (structure) ----

test('readAiPlan accepts a full plan for each goal', () => {
  for (const b of [LEADS_AB, SALES_ALL, brief({ goal: 'leads' }), brief({ goal: 'sales' })]) {
    const r = readAiPlan(fixturePlan(b), b);
    assert.ok('plan' in r, JSON.stringify(r));
    assert.deepEqual(r.plan.pages.map(p => p.role), requiredPlanRoles(b).pages);
  }
});

test('readAiPlan refuses a broken structure with a sentence naming the part', () => {
  const cases = [
    ['a missing landing page', SALES_ALL, p => { p.pages = p.pages.filter(x => x.role !== 'landing'); }, /missing the landing page/],
    ['a duplicate role', SALES_ALL, p => { p.pages.push(page('thanks')); }, /more than one thank-you page/],
    ['an extra downsell', SALES_ALL, p => { p.pages.push(page('downsell')); }, /"downsell"/],
    ['a form on a sales brief', SALES_ALL, p => { p.form = { title: 'x', button: 'y', success: 'z', reason: '' }; }, /sign-up form/],
    ['emails with 0 messages', SALES_ALL, p => { p.emails[0].messages = []; }, /no messages/],
    ['emails with 4 messages', LEADS_AB, p => { p.emails[0].messages.push(clone(p.emails[0].messages[0])); }, /4 messages/],
    ['a non-numeric delayHours', LEADS_AB, p => { p.emails[0].messages[1].delayHours = 'tomorrow'; }, /wait .* not a number/],
    ['a string where an array belongs', LEADS_AB, p => { p.pages[0].bullets = 'Small groups, tools'; }, /bullets is not a list/],
    ['no form on a leads brief', LEADS_AB, p => { p.form = null; }, /missing the sign-up form/],
    ['a missing email flow', SALES_ALL, p => { p.emails = p.emails.filter(e => e.role !== 'recovery'); }, /missing the checkout recovery emails/]
  ];
  for (const [name, b, mutate, pattern] of cases) {
    const p = fixturePlan(b);
    mutate(p);
    const r = readAiPlan(p, b);
    assert.ok('problem' in r && !('plan' in r), name);
    assert.match(r.problem, pattern, name);
    assert.match(r.problem, /\.$/, `${name} is one sentence`);
  }
  assert.ok('problem' in readAiPlan(null, LEADS_AB));
  assert.ok('problem' in readAiPlan([], LEADS_AB));
});

// ---- planProblems (content) ----

test('planProblems is empty for the valid plans', () => {
  for (const b of [LEADS_AB, SALES_ALL]) assert.deepEqual(planProblems(fixturePlan(b), b), []);
});

test('planProblems names the field for each content problem', () => {
  const fieldsFor = (b, mutate) => {
    const p = fixturePlan(b);
    mutate(p);
    return planProblems(p, b).map(x => x.field);
  };
  const landing = p => p.pages.find(x => x.role === 'landing');
  assert.deepEqual(fieldsFor(SALES_ALL, p => { landing(p).headline = 'x'.repeat(PLAN_LIMITS.page.headline + 1); }), ['pages.landing.headline']);
  assert.deepEqual(fieldsFor(SALES_ALL, p => { landing(p).button = '   '; }), ['pages.landing.button']);
  assert.deepEqual(fieldsFor(SALES_ALL, p => { landing(p).subhead = 'Clay <b>now</b>'; }), ['pages.landing.subhead']);
  assert.deepEqual(fieldsFor(SALES_ALL, p => { p.ad.body = 'See https://x.io today'; }), ['ad.body']);
  assert.deepEqual(fieldsFor(SALES_ALL, p => { p.pages.find(x => x.role === 'landing-b').headline = landing(p).headline.toUpperCase(); }), ['pages.landing-b.headline']);
  assert.deepEqual(fieldsFor(SALES_ALL, p => { p.emails[1].messages[2].delayHours = 200; }), ['emails.recovery.2.delayHours']);
  assert.deepEqual(fieldsFor(SALES_ALL, p => { p.emails[0].messages[1].delayHours = 1.5; }), ['emails.followup.1.delayHours']);
  assert.deepEqual(fieldsFor(SALES_ALL, p => { p.assumptions = Array.from({ length: 7 }, (_, i) => `Assumption ${i}`); }), ['assumptions']);
  assert.deepEqual(fieldsFor(SALES_ALL, p => { p.pages.find(x => x.role === 'upsell').decline = ''; }), ['pages.upsell.decline']);
  assert.deepEqual(fieldsFor(LEADS_AB, p => { p.hypothesis = ''; }), ['hypothesis']);
  const noAb = brief({ goal: 'leads' });
  assert.deepEqual(fieldsFor(noAb, p => { p.hypothesis = ''; }), [], 'hypothesis is not required without an A/B test');
  // Thank-you pages have no button or bullets, and landing pages need no decline.
  assert.deepEqual(fieldsFor(LEADS_AB, p => { landing(p).decline = ''; }), []);
  // Every problem field has an input on the review screen.
  const p = fixturePlan(SALES_ALL);
  landing(p).headline = '';
  const [problem] = planProblems(p, SALES_ALL);
  assert.equal(fieldInputId(problem.field), 'ai-pages-landing-headline');
  assert.equal(fieldLabel('pages.landing.headline'), 'Landing page headline');
  assert.match(problem.message, /^Landing page headline is empty\.$/);
});

test('createBlocker asks for the review, then clears once the plan is clean and reviewed', () => {
  const p = fixturePlan(SALES_ALL);
  assert.equal(createBlocker(p, SALES_ALL, false), 'Tick the review box to create.');
  assert.equal(createBlocker(p, SALES_ALL, true), null);
  p.ad.headline = '';
  assert.equal(createBlocker(p, SALES_ALL, true), 'Fix the problems above first.');
});

// ---- claimFlags ----

test('claimFlags lists figures and promises the brief does not contain', () => {
  const b = brief({ goal: 'sales', offer: 'Pottery kit for beginners. $49.', audience: '', businessType: '' });
  const p = fixturePlan(b);
  p.pages[0].subhead = 'Only $19 today, with a 30-day money-back guarantee.';
  p.ad.body = 'Rated 4.9/5 by 10,000 customers.';
  p.pages[0].headline = 'The kit for $49';
  p.emails[0].messages[0].body = 'Hi [First Name], welcome.';
  const flags = claimFlags(p, b);
  const texts = flags.map(f => f.text);
  assert.ok(texts.includes('$19'), texts.join('|'));
  assert.ok(texts.some(t => /30-day|money-back|guarantee/.test(t)), texts.join('|'));
  assert.ok(texts.includes('4.9/5'), texts.join('|'));
  assert.ok(texts.includes('10,000 customers'), texts.join('|'));
  assert.ok(!texts.includes('$49'), '$49 is in the brief');
  assert.ok(!texts.some(t => /first name/i.test(t)));
  const dollar = flags.find(f => f.text === '$19');
  assert.equal(dollar.field, 'pages.landing.subhead');
  assert.equal(dollar.label, 'Landing page subhead');
});

test('claimFlags does not flag a claim the brief already makes', () => {
  const b = brief({ goal: 'sales', offer: 'Organic clay. 30-day money-back guarantee. Rated 4.9/5 by 10000 customers.' });
  const p = fixturePlan(b);
  p.ad.body = 'Organic clay with a 30-day money-back guarantee. Rated 4.9/5 by 10,000 customers.';
  assert.deepEqual(claimFlags(p, b).filter(f => f.field === 'ad.body'), []);
});

test('claimFlags compares whole figures, so a wrong number inside a longer brief figure is flagged', () => {
  const b = brief({ goal: 'sales', offer: 'Pottery class, $149 a month, 100% handmade, 12 weeks, $14.99 kit, 1,200 students.' });
  const flagged = s => {
    const p = fixturePlan(b);
    p.pages[0].subhead = s;
    return claimFlags(p, b).filter(f => f.field === 'pages.landing.subhead').map(f => f.text);
  };
  assert.deepEqual(flagged('Only $14 a month'), ['$14']);
  assert.deepEqual(flagged('Just $1 to start'), ['$1']);
  assert.deepEqual(flagged('2 weeks to learn'), ['2 weeks']);
  assert.deepEqual(flagged('0% handmade'), ['0%']);
  assert.deepEqual(flagged('200 students'), ['200 students']);
  // The brief's own figures, in the copy's spelling, stay unflagged.
  assert.deepEqual(flagged('$149 a month, 100% handmade, 12 weeks, $14.99 kit, 1200 students'), []);
});

test('claimFlags lists a "rated N" or "N rating" the brief does not make', () => {
  const none = brief({ goal: 'sales', offer: 'Pottery kit for beginners. $4.99 glaze.' });
  const p = fixturePlan(none);
  p.pages[0].subhead = 'Rated 4.9 by our students.';
  p.ad.body = 'A 4.8 rating on Google.';
  const texts = claimFlags(p, none).map(f => f.text);
  assert.ok(texts.includes('Rated 4.9'), texts.join('|'));
  assert.ok(texts.includes('4.8 rating'), texts.join('|'));
  // Backed by the brief's number in another wording, and "4.9/5" is flagged once, not twice.
  const rated = brief({ goal: 'sales', offer: 'Kits rated 4.8 by buyers, 4.9 stars on Google.' });
  const q = fixturePlan(rated);
  q.pages[0].subhead = 'Rated 4.9 by our students, a 4.8 rating.';
  q.ad.body = 'Rated 4.7/5.';
  assert.deepEqual(claimFlags(q, rated).filter(f => f.field === 'pages.landing.subhead'), []);
  assert.deepEqual(claimFlags(q, rated).filter(f => f.field === 'ad.body').map(f => f.text), ['4.7/5']);
});

// ---- delayLabel ----

test('delayLabel writes the strings SequenceEditor already writes', () => {
  assert.equal(delayLabel(0), 'Instant (0m)');
  assert.equal(delayLabel(1), '1 Hour');
  assert.equal(delayLabel(24), '24 Hours');
  assert.equal(delayLabel(36), '36 Hours');
  assert.equal(delayLabel(72), '3 Days (72h)');
});

// ---- buildJourneyFromPlan ----

const TARGETS = {
  'ad-source': [],
  'landing-page': [null],
  'lead-form': [null],
  'follow-up-sequence': [null, 'retention-in'],
  'thank-you': [null],
  upsell: [null],
  'ab-split': [null]
};

function checkBuiltMap(project, plan, b) {
  const byId = new Map(project.nodes.map(n => [n.id, n]));
  assert.equal(byId.size, project.nodes.length, 'node ids are unique');
  assert.equal(new Set(project.edges.map(e => e.id)).size, project.edges.length, 'edge ids are unique');

  for (const e of project.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    assert.ok(s && t, `edge ${e.id} joins two steps`);
    assert.ok(SOURCE_HANDLES[s.type].includes(e.sourceHandle ?? null), `${s.type} has handle ${e.sourceHandle}`);
    assert.ok(TARGETS[t.type].includes(e.targetHandle ?? null), `${t.type} has target ${e.targetHandle}`);
    assert.equal(e.type, 'conversion');
    assert.equal(e.data.sourceHandle, e.sourceHandle);
    assert.equal(e.data.rate, 0);
    assert.equal(e.data.sourceThroughput, 0);
    assert.equal(e.data.targetCount, 0);
  }
  for (const n of project.nodes) assert.ok(n.type !== 'thank-you' || !project.edges.some(e => e.source === n.id), 'no line leaves a thank-you page');

  // Every step is reachable from the ad.
  const ad = project.nodes.find(n => n.type === 'ad-source');
  const seen = new Set([ad.id]);
  const queue = [ad.id];
  while (queue.length) {
    const id = queue.shift();
    for (const e of project.edges) if (e.source === id && !seen.has(e.target)) { seen.add(e.target); queue.push(e.target); }
  }
  assert.equal(seen.size, project.nodes.length, 'every step is reachable from the ad');

  // No shared cells, and no overlap within 300 by 260.
  for (let i = 0; i < project.nodes.length; i++) {
    for (let j = i + 1; j < project.nodes.length; j++) {
      const a = project.nodes[i].position;
      const c = project.nodes[j].position;
      assert.ok(Math.abs(a.x - c.x) >= 300 || Math.abs(a.y - c.y) >= 260, `${project.nodes[i].id} and ${project.nodes[j].id} overlap`);
    }
  }

  const slugs = project.nodes.map(n => n.data.slug).filter(s => s !== undefined);
  for (const s of slugs) assert.match(s, /^[a-z0-9][a-z0-9-]*$/);
  assert.equal(new Set(slugs).size, slugs.length, 'slugs are unique');

  // Copy equals the plan.
  assert.equal(ad.data.headline, plan.ad.headline);
  assert.equal(ad.data.body, plan.ad.body);
  assert.equal(ad.data.ctaText, plan.ad.cta);
  assert.equal(ad.data.platform, b.platform);
  for (const pg of plan.pages) {
    const n = byId.get(`ai-t1-${pg.role}`);
    assert.ok(n, pg.role);
    assert.equal(n.data.label, pg.title);
    assert.equal(n.data.headline, pg.headline);
    assert.equal(n.data.subhead, pg.subhead);
    if (n.type === 'landing-page') {
      assert.deepEqual(n.data.bullets, pg.bullets);
      assert.equal(n.data.buttonText, pg.button);
      assert.equal(n.data.heroImageUrl, undefined);
      for (const k of ['urgencyTimerEnabled', 'scarcityBatchEnabled', 'discountCode', 'shopifyProductPrice']) assert.equal(n.data[k], undefined, k);
    }
    if (n.type === 'upsell') {
      assert.deepEqual(n.data.benefits, pg.bullets);
      assert.equal(n.data.acceptButtonText, pg.button);
      assert.equal(n.data.declineButtonText, pg.decline);
      for (const k of ['productTitle', 'productPrice', 'regularPrice', 'discountCode', 'productImage']) assert.equal(n.data[k], '', k);
      assert.ok(!('discountPercentage' in n.data));
      assert.ok(!('urgencyMinutes' in n.data));
      assert.ok(n.data.label);
    }
    if (n.type === 'thank-you') {
      for (const k of ['badgeText', 'bounceBackDiscountCode', 'bounceBackDiscountText', 'usageGuideSteps']) assert.equal(n.data[k], undefined, k);
    }
  }
  for (const flow of plan.emails) {
    const n = byId.get(`ai-t1-${flow.role}`);
    assert.equal(n.data.label, flow.name);
    assert.equal(n.data.sequenceTitle, flow.name);
    assert.deepEqual(n.data.steps.map(s => [s.subject, s.previewText, s.body, s.channel]), flow.messages.map(m => [m.subject, m.preview, m.body, 'email']));
    assert.deepEqual(n.data.steps.map(s => s.delay), flow.messages.map(m => delayLabel(m.delayHours)));
    assert.equal(n.data.contactsEnrolled, 0);
    assert.equal(n.data.avgOpenRate, 0);
    assert.equal(n.data.avgClickRate, 0);
  }

  const json = JSON.stringify(project);
  assert.ok(!json.includes(EM), 'no em dash');
  assert.ok(!/imageUrl|heroImageUrl/.test(json), 'no image');
  const METRICS = ['impressions', 'clicks', 'ctr', 'spend', 'visitors', 'conversions', 'conversionRate', 'views', 'submissions', 'completionRate',
    'takes', 'pageViews', 'contactsEnrolled', 'avgOpenRate', 'avgClickRate', 'branchAVisitors', 'branchAConversions', 'branchBVisitors', 'branchBConversions'];
  for (const n of project.nodes) for (const k of METRICS) if (k in n.data) assert.equal(n.data[k], 0, `${n.id}.${k}`);
}

test('buildJourneyFromPlan builds a leads map with an A/B test in code', () => {
  const plan = fixturePlan(LEADS_AB);
  const project = buildJourneyFromPlan(plan, LEADS_AB, { id: 't1', now: '2026-09-28T00:00:00.000Z', workspaceId: 'ws-1' });
  checkBuiltMap(project, plan, LEADS_AB);
  assert.equal(project.id, 'journey_ai_t1');
  assert.equal(project.name, plan.name);
  assert.equal(project.goal, 'Turn visitors into leads');
  assert.equal(project.workspaceId, 'ws-1');
  assert.equal(project.updatedAt, '2026-09-28T00:00:00.000Z');
  assert.equal(project.businessType, 'Pottery studio');
  assert.equal(project.offerHeadline, LEADS_AB.offer.slice(0, 120));
  const split = project.nodes.find(n => n.type === 'ab-split');
  const out = project.edges.filter(e => e.source === split.id);
  assert.deepEqual(out.map(e => e.sourceHandle).sort(), ['branch-a', 'branch-b']);
  assert.notEqual(out[0].target, out[1].target);
  assert.ok(out.every(e => project.nodes.find(n => n.id === e.target).type === 'landing-page'));
  const form = project.nodes.find(n => n.type === 'lead-form');
  assert.equal(form.data.formTitle, plan.form.title);
  assert.equal(form.data.submitButtonText, plan.form.button);
  assert.equal(form.data.successMessage, plan.form.success);
  assert.deepEqual(form.data.fields.map(f => [f.type, f.required, f.enabled, f.placeholder]), [['text', true, true, undefined], ['email', true, true, undefined], ['tel', false, true, undefined]]);
  assert.equal(project.nodes.find(n => n.id === 'ai-t1-followup').data.sequenceType, 'lead_nurture');
});

test('buildJourneyFromPlan builds a sales map with an upsell, an A/B test and checkout recovery', () => {
  const plan = fixturePlan(SALES_ALL);
  const project = buildJourneyFromPlan(plan, SALES_ALL, { id: 't1', now: 'now' });
  checkBuiltMap(project, plan, SALES_ALL);
  assert.equal(project.goal, 'Turn visitors into customers');
  assert.ok(!('workspaceId' in project));
  const recovery = project.nodes.find(n => n.id === 'ai-t1-recovery');
  assert.equal(recovery.data.sequenceType, 'checkout_recovery');
  assert.equal(recovery.data.isRetentionBranch, true);
  assert.equal(recovery.data.smartExitOnPurchase, true);
  assert.equal(recovery.data.delayHours, plan.emails[1].messages[0].delayHours);
  assert.equal(project.nodes.find(n => n.id === 'ai-t1-followup').data.sequenceType, undefined);
  const into = project.edges.filter(e => e.target === recovery.id);
  assert.equal(into.length, 2, 'both landing pages lead to recovery');
  for (const e of into) {
    assert.equal(e.sourceHandle, 'abandon');
    assert.equal(e.targetHandle, 'retention-in');
    assert.equal(e.data.isRetentionEdge, true);
    assert.equal(edgeKind(e.sourceHandle, recovery.data, e.data.isRetentionEdge), 'declined');
  }
  assert.ok(project.edges.filter(e => e.target !== recovery.id).every(e => e.data.isRetentionEdge === false));
  const upsellOut = project.edges.filter(e => e.source === 'ai-t1-upsell');
  assert.deepEqual(upsellOut.map(e => [e.sourceHandle, e.target]).sort(), [['accepted', 'ai-t1-thanks'], ['declined', 'ai-t1-thanks']]);
});

test('buildJourneyFromPlan makes safe slugs from any name', () => {
  for (const name of ['日本語', '---', '  Big Sale!!  ', 'x'.repeat(80)]) {
    const plan = { ...fixturePlan(SALES_ALL), name };
    const project = buildJourneyFromPlan(plan, SALES_ALL, { id: 'AbC_123xyz', now: 'now' });
    const slugs = project.nodes.map(n => n.data.slug).filter(Boolean);
    for (const s of slugs) {
      assert.match(s, /^[a-z0-9-]+$/, s);
      assert.ok(!s.startsWith('-') && !s.includes('--'), s);
    }
    assert.equal(new Set(slugs).size, slugs.length);
    if (name === '日本語') assert.equal(project.nodes.find(n => n.id === 'ai-AbC_123xyz-landing').data.slug, 'journey-123xyz');
  }
});

// ---- walkJourney ----

const labels = (project, walk) => walk.steps.map(s => [s.nodeId.replace(/^ai-t1-/, ''), s.branch]);

test('walkJourney follows the built sales map by the chosen handles', () => {
  const project = buildJourneyFromPlan(fixturePlan(SALES_ALL), SALES_ALL, { id: 't1', now: 'now' });
  const paid = walkJourney(project.nodes, project.edges, { variant: 'a', checkout: 'paid', upsell: 'accepted' });
  assert.deepEqual(labels(project, paid), [['ad', 'main'], ['split', 'main'], ['landing', 'main'], ['followup', 'side'], ['upsell', 'main'], ['thanks', 'main']]);
  assert.equal(paid.stopped, 'end');
  const left = walkJourney(project.nodes, project.edges, { variant: 'a', checkout: 'left' });
  assert.deepEqual(labels(project, left), [['ad', 'main'], ['split', 'main'], ['landing', 'main'], ['recovery', 'main']]);
  assert.equal(left.stopped, 'end');
  const b = walkJourney(project.nodes, project.edges, { variant: 'b', checkout: 'paid', upsell: 'declined' });
  assert.equal(b.steps[2].nodeId, 'ai-t1-landing-b');
  assert.equal(b.steps[2].via, 'branch-b');
  assert.equal(b.steps.at(-1).nodeId, 'ai-t1-thanks');
  assert.equal(b.steps.at(-1).via, 'declined');
  const labelled = paid.steps.map(s => s.label);
  assert.equal(labelled[0], 'Meta ad');
});

test('walkJourney walks the default journey, stops at a loop, an empty map and a form left', () => {
  const p = DEFAULT_LEAD_CAPTURE_PROJECT;
  const walk = walkJourney(p.nodes, p.edges, {});
  assert.deepEqual(walk.steps.map(s => s.type), ['ad-source', 'landing-page', 'lead-form', 'follow-up-sequence']);
  assert.equal(walk.steps[3].branch, 'main', 'a choice that leads only into a sequence goes into it');
  assert.equal(walk.stopped, 'end');

  const nodes = [
    { id: 'ad', type: 'ad-source', position: { x: 0, y: 0 }, data: { label: 'Ad' } },
    { id: 'a', type: 'landing-page', position: { x: 0, y: 0 }, data: { label: 'A' } },
    { id: 'b', type: 'landing-page', position: { x: 0, y: 0 }, data: { label: 'B' } }
  ];
  const edges = [{ id: 'e1', source: 'ad', target: 'a' }, { id: 'e2', source: 'a', target: 'b' }, { id: 'e3', source: 'b', target: 'a' }];
  const loop = walkJourney(nodes, edges, {});
  assert.equal(loop.stopped, 'loop');
  assert.deepEqual(loop.steps.map(s => s.nodeId), ['ad', 'a', 'b']);

  assert.deepEqual(walkJourney([], [], {}), { steps: [], stopped: 'no-entry' });

  const leads = buildJourneyFromPlan(fixturePlan(LEADS_AB), LEADS_AB, { id: 't1', now: 'now' });
  const gone = walkJourney(leads.nodes, leads.edges, { form: 'left' });
  assert.equal(gone.stopped, 'left');
  assert.equal(gone.steps.at(-1).type, 'lead-form');

  const capped = walkJourney(leads.nodes, leads.edges, {}, 2);
  assert.equal(capped.stopped, 'limit');
  assert.equal(capped.steps.length, 2);
});

test('journeyEntry and handleFor', () => {
  const leads = buildJourneyFromPlan(fixturePlan(LEADS_AB), LEADS_AB, { id: 't1', now: 'now' });
  assert.equal(journeyEntry(leads.nodes, leads.edges).id, 'ai-t1-ad');
  assert.equal(journeyEntry([{ id: 'x', type: 'landing-page', data: {} }], []).id, 'x');
  assert.equal(journeyEntry([], []), null);
  assert.equal(handleFor({ type: 'ab-split' }, { variant: 'b' }), 'branch-b');
  assert.equal(handleFor({ type: 'ab-split' }, {}), 'branch-a');
  assert.equal(handleFor({ type: 'landing-page' }, { checkout: 'left' }), 'abandon');
  assert.equal(handleFor({ type: 'landing-page' }, {}), null);
  assert.equal(handleFor({ type: 'upsell' }, { upsell: 'declined' }), 'declined');
  assert.equal(handleFor({ type: 'upsell' }, {}), 'accepted');
  assert.equal(handleFor({ type: 'lead-form' }, { form: 'left' }), 'stop');
  assert.equal(handleFor({ type: 'thank-you' }, {}), null);
});

// ---- simulateAiJourney ----

test('simulateAiJourney says nothing is sent and never claims a delivery', () => {
  const shapes = [
    [SALES_ALL, { variant: 'a', checkout: 'paid', upsell: 'accepted' }],
    [SALES_ALL, { variant: 'b', checkout: 'left' }],
    [SALES_ALL, { variant: 'a', checkout: 'paid', upsell: 'declined' }],
    [LEADS_AB, { variant: 'a', form: 'submitted' }],
    [LEADS_AB, { variant: 'b', form: 'left' }]
  ];
  for (const [b, choices] of shapes) {
    const rows = simulateAiJourney(fixturePlan(b), b, choices);
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.doesNotMatch(row.detail, /Delivered|\bSent\b/);
      assert.ok(!row.detail.includes(EM) && !row.detail.includes(SPACED_EN));
    }
    const sequences = rows.filter(r => /^Joins /.test(r.detail));
    for (const r of sequences) assert.ok(r.detail.includes('Nothing is sent in this walk-through.'), r.detail);
  }
  const left = simulateAiJourney(fixturePlan(SALES_ALL), SALES_ALL, { checkout: 'left' });
  assert.match(left.at(-1).detail, /^Joins “recovery series”: 3 emails\. The first right away, the next 24 hours later, the last 48 hours after that\. Nothing is sent in this walk-through\.$/);
  assert.ok(left.some(r => r.detail.includes('Leaves without paying.')));
  const b = simulateAiJourney(fixturePlan(SALES_ALL), SALES_ALL, { variant: 'b' });
  assert.ok(b.some(r => r.detail.includes('Learn pottery landing-b')));
  assert.ok(b.some(r => r.detail === 'Is sent to version B.'));
});

// ---- aiPlanOutcome ----

test('aiPlanOutcome reads every answer honestly', () => {
  const good = fixturePlan(SALES_ALL);
  let o = aiPlanOutcome(null, SALES_ALL);
  assert.equal(o.kind, 'refused');
  assert.match(o.message, /could not be reached/);
  assert.equal(o.retryable, true);

  o = aiPlanOutcome({ status: 401, body: {} }, SALES_ALL);
  assert.match(o.message, /sign-in has expired/);
  assert.equal(o.retryable, false);

  // The hourly limit (F2): no Retry now, and the wait after which Retry can help.
  o = aiPlanOutcome({ status: 429, body: { success: false, error: 'You have reached this hour\u2019s AI limit. Try again in 1 hour.', retryable: false, reason: 'hourly-ai-limit', retryAfterSeconds: 3600 } }, SALES_ALL);
  assert.equal(o.retryable, false);
  assert.equal(o.unavailable, false);
  assert.equal(o.retryAfterMs, 3_600_000);
  assert.equal(o.message, 'Not drafted. You have reached this hour\u2019s AI limit. Try again in 1 hour.');
  o = aiPlanOutcome({ status: 429, body: { success: false, error: 'Limit.', retryable: false, retryAfterSeconds: 99999 } }, SALES_ALL);
  assert.equal(o.retryAfterMs, 3_600_000, 'a wait is at most the hour');
  o = aiPlanOutcome({ status: 429, body: { success: false, error: 'Limit.', retryable: false, retryAfterSeconds: 125 } }, SALES_ALL);
  assert.equal(o.retryAfterMs, 125_000, 'an exact wait from the budget is kept');
  for (const bad of [undefined, 0, -1, '600', NaN]) {
    o = aiPlanOutcome({ status: 429, body: { success: false, error: 'Limit.', retryable: false, retryAfterSeconds: bad } }, SALES_ALL);
    assert.equal('retryAfterMs' in o, false, String(bad));
  }
  o = aiPlanOutcome({ status: 502, body: { success: false, error: 'x', retryable: true, retryAfterSeconds: 60 } }, SALES_ALL);
  assert.equal('retryAfterMs' in o, false, 'a retryable answer offers Retry at once');
  assert.equal(LIMIT_WAITED_MESSAGE, 'Not drafted. The wait for your hourly AI limit has passed. Try again.');

  o = aiPlanOutcome({ status: 503, body: { success: false, error: 'AI drafting is not set up on this server.', retryable: false, reason: 'ai-unavailable' } }, SALES_ALL);
  assert.equal(o.retryable, false);
  assert.equal(o.unavailable, true);
  assert.equal(o.message, 'Not drafted. AI drafting is not set up on this server.');

  o = aiPlanOutcome({ status: 502, body: { success: false } }, SALES_ALL);
  assert.equal(o.retryable, true, '5xx without a flag is retryable');
  assert.equal(o.unavailable, false);

  const broken = clone(good);
  broken.pages.pop();
  o = aiPlanOutcome({ status: 200, body: { success: true, plan: broken } }, SALES_ALL);
  assert.equal(o.kind, 'refused');
  assert.match(o.message, /^Not drafted\. The AI returned a plan Jourvance could not use: .+ Nothing changed\. Try again\.$/);
  assert.equal(o.retryable, true);

  o = aiPlanOutcome({ status: 200, body: { success: true, plan: good } }, SALES_ALL);
  assert.equal(o.kind, 'plan');
  assert.equal(o.plan.name, good.name);
});

// ---- The saved draft ----

function fakeStorage({ failGet = false, failSet = false } = {}) {
  const m = new Map();
  return {
    m,
    getItem: k => { if (failGet) throw new Error('blocked'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (failSet) throw new Error('quota'); m.set(k, String(v)); },
    removeItem: k => { m.delete(k); }
  };
}

test('the saved draft round trips and bad data reads as nothing', () => {
  const s = fakeStorage();
  const plan = fixturePlan(SALES_ALL);
  assert.equal(writeSavedAiDraft(s, { brief: SALES_ALL, plan }), true);
  assert.deepEqual(readSavedAiDraft(s), { brief: SALES_ALL, plan: readAiPlan(plan, SALES_ALL).plan });
  assert.equal(writeSavedAiDraft(s, { brief: LEADS_AB, plan: null }), true);
  assert.deepEqual(readSavedAiDraft(s), { brief: LEADS_AB, plan: null });
  writeSavedAiDraft(s, null);
  assert.equal(s.m.has(AI_DRAFT_STORAGE_KEY), false);
  assert.equal(readSavedAiDraft(s), null);

  s.m.set(AI_DRAFT_STORAGE_KEY, '{not json');
  assert.equal(readSavedAiDraft(s), null);
  s.m.set(AI_DRAFT_STORAGE_KEY, JSON.stringify({ v: 2, brief: SALES_ALL, plan }));
  assert.equal(readSavedAiDraft(s), null);
  s.m.set(AI_DRAFT_STORAGE_KEY, JSON.stringify({ v: 1, brief: { goal: 'bookings' }, plan }));
  assert.equal(readSavedAiDraft(s), null);
  assert.equal(readSavedAiDraft(fakeStorage({ failGet: true })), null);
  assert.equal(writeSavedAiDraft(fakeStorage({ failSet: true }), { brief: SALES_ALL, plan }), false);
  assert.equal(readSavedAiDraft(null), null);

  // A wait being typed (NaN) keeps the plan readable and shows as a wait problem.
  const typing = clone(plan);
  typing.emails[0].messages[1].delayHours = Number.NaN;
  writeSavedAiDraft(s, { brief: SALES_ALL, plan: typing });
  const back = readSavedAiDraft(s);
  assert.ok(back.plan);
  assert.deepEqual(planProblems(back.plan, SALES_ALL).map(p => p.field), ['emails.followup.1.delayHours']);
});

test('brief edits made after going back from a plan are kept beside the plan', () => {
  const s = fakeStorage();
  const plan = fixturePlan(SALES_ALL);
  const edited = { ...SALES_ALL, offer: 'A new offer typed after Back to brief.', abTest: false };
  writeSavedAiDraft(s, { brief: SALES_ALL, plan, editedBrief: edited });
  const back = readSavedAiDraft(s);
  assert.deepEqual(back.brief, SALES_ALL, 'the plan is still checked against the brief it was drafted for');
  assert.deepEqual(back.editedBrief, edited);
  assert.ok(back.plan);

  // Unchanged, broken, or with no plan beside it: dropped, and the draft still reads.
  writeSavedAiDraft(s, { brief: SALES_ALL, plan, editedBrief: SALES_ALL });
  assert.equal('editedBrief' in readSavedAiDraft(s), false);
  s.m.set(AI_DRAFT_STORAGE_KEY, JSON.stringify({ v: 1, brief: SALES_ALL, plan, editedBrief: { goal: 'bookings' } }));
  assert.deepEqual(readSavedAiDraft(s), { brief: SALES_ALL, plan: readAiPlan(plan, SALES_ALL).plan });
  writeSavedAiDraft(s, { brief: LEADS_AB, plan: null, editedBrief: SALES_ALL });
  assert.deepEqual(readSavedAiDraft(s), { brief: LEADS_AB, plan: null });
});

// ---- Source pins ----

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const hasDash = s => s.includes(EM) || s.includes(SPACED_EN);

test('the builder stops keys reaching the map, and the new files carry no em dash', () => {
  const dialog = read('./src/components/modals/AiJourneyBuilder.tsx');
  assert.ok(dialog.includes('stopPropagation'));
  assert.ok(dialog.includes('role="dialog"') && dialog.includes('aria-modal="true"'));
  assert.ok(dialog.includes('[data-more-trigger]'), 'focus falls back to the More button');
  // A disabled button drops focus to the page, where Backspace reaches the map. Busy buttons use
  // aria-disabled, and a capture guard stops the delete keys from outside the panel.
  assert.ok(!/\sdisabled=\{/.test(dialog), 'no native disabled on a dialog button');
  assert.ok(dialog.includes("addEventListener('keydown', guard, true)"), 'capture guard for Backspace and Delete');
  assert.ok(!/\bDelivered\b|\bSent\b/.test(dialog));
  // F2: the hourly limit's wait becomes retryAt, and only its timer turns Retry on.
  assert.ok(/retryAt: Date\.now\(\) \+ outcome\.retryAfterMs/.test(dialog), 'the wait is kept on the refusal');
  assert.ok(/r\.retryAt === at \? \{ message: LIMIT_WAITED_MESSAGE, retryable: true/.test(dialog), 'Retry comes back only after the wait');
  for (const f of ['./src/lib/journeyAi.ts', './src/components/modals/AiJourneyBuilder.tsx', './server/routes/aiJourneyRoutes.mjs']) {
    assert.ok(!hasDash(read(f)), `${f} has an em dash or a spaced en dash`);
  }
  assert.ok(read('./src/lib/hubClient.ts').includes("'/api/ai/journey-plan'"));
});

// The integration lanes' wiring (w4-spine-3 wires App, the header and the cards; w3-server-mounts
// mounts the route). Both have landed, so these are hard checks.

test('the canvas cards no longer invent products, prices or codes', () => {
  const cards = read('./src/components/canvas/nodes/UpsellNode.tsx') + read('./src/components/canvas/nodes/ThankYouNode.tsx');
  for (const s of ['Bioactive Triple Barrier Reserve', 'Deluxe Travel Ritual Duo', "'$38.00'", "'$24.00'", "'SAVE 40%'", "'SAVE 50%'", "'VIPRETURN'", "'$15 off next order'"]) {
    assert.ok(!cards.includes(s), s);
  }
});

test('App, the header and the server wire the builder', () => {
  const app = read('./src/App.tsx');
  assert.ok(/<JourneyCanvas\s+key=\{project\.id\}/.test(app), 'JourneyCanvas remounts on a new journey');
  assert.ok(app.includes('handleCreateFromAi'));
  const header = read('./src/components/toolbar/CanvasHeader.tsx');
  assert.ok(header.includes("'Draft with AI'"));
  assert.ok(header.includes('data-more-trigger'));
  assert.ok(read('./server.mjs').includes('setupAiJourneyRoutes(app'));
});
