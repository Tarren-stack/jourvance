import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  previewPageCopy,
  NEW_BENEFIT,
  BENEFIT_HINT,
  HEADLINE_FALLBACK,
  BUTTON_FALLBACK,
  URGENCY_FALLBACK,
  BUMP_HEADLINE_FALLBACK,
  BUMP_TITLE_FALLBACK,
  SOCIAL_PROOF_FALLBACK
} from './src/lib/pagePreviewCopy.ts';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from './src/lib/defaultBlueprint.ts';
import { renderPublicFunnelHtml, setPublicContext } from './server/routes/publicRoutes.mjs';
import {
  dnsCheckOutcome,
  dnsVerdictDetail,
  DNS_UNREACHABLE,
  DNS_SIGN_IN,
  DNS_SERVER_PROBLEM,
  DNS_SERVER_BUSY,
  DNS_UNREADABLE
} from './src/lib/dnsCheckOutcome.ts';
import { realVariantId, realStoreDomain, realTrackingId } from './server/routes/authWorkspaceRoutes.mjs';

// The live page as the server renders it: server.mjs hands publicRoutes these three, which refuse
// placeholder variant ids, store domains and pixel ids. Without them the renderer publishes every
// id as saved, which is more than production shows, so a preview leak through a sample product
// would pass here unseen.
setPublicContext({ realVariantId, realStoreDomain, realTrackingId });

// T12 (R19 follow-up): the page editor's Add Point stored the instruction 'New value point' as a
// benefit, its Preview filled empty fields with copy of its own ('EXCLUSIVE OFFER', 'Clear, concise
// subheadline addressing customer pain.', 'One-Time Upgrade', ...) and the review wall's heading
// field showed 'Loved by Thousands of Radiant Routines' as its value. None of it was on the live
// page. The preview now reads its words from previewPageCopy, which works them out the way
// renderPublicFunnelHtml does, and these tests hold the two together.

const editor = fs.readFileSync(new URL('./src/components/drawers/PageEditor.tsx', import.meta.url), 'utf8');
const publicSrc = fs.readFileSync(new URL('./server/routes/publicRoutes.mjs', import.meta.url), 'utf8');
const publishModal = fs.readFileSync(new URL('./src/components/preview/PublishModal.tsx', import.meta.url), 'utf8');

// The Preview tab's markup, from the tab switch to the settings.
const previewSrc = editor.slice(editor.indexOf("{editorTab === 'preview' ? ("), editor.indexOf('{/* PAGE WORDS: always open, first */}'));

const defaultPage = () => structuredClone(DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.id === 'node-page-1').data);

// The words a visitor can read on the published page: no scripts, styles or tags.
function liveText(data, query = {}) {
  const html = renderPublicFunnelHtml({ slug: 't12-page', userId: 'usr_t12', data }, { query, headers: {} });
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&rarr;/g, '→')
    .replace(/\s+/g, ' ');
}

// Every line of copy the preview would draw.
function previewLines(copy) {
  return [
    copy.headline,
    copy.subhead,
    ...copy.bullets,
    copy.buttonText,
    copy.discountCode && `Code ${copy.discountCode} is ready at checkout`,
    copy.trustBadge,
    copy.urgency?.text,
    copy.scarcity,
    copy.bump?.headline,
    copy.bump?.description,
    copy.bump?.title,
    copy.productPrice
  ].filter(Boolean);
}

describe('Add Point stores an empty benefit with a hint', () => {
  it('adds an empty value in both versions, never an instruction', () => {
    assert.equal(NEW_BENEFIT, '');
    assert.ok(BENEFIT_HINT.trim().length > 0);
    assert.doesNotMatch(editor, /New value point/i, 'the instruction is gone from the editor');
    assert.match(editor, /handleFieldChange\('bullets', \[\.\.\.\(data\.bullets \|\| \[\]\), NEW_BENEFIT\]\)/, 'version A');
    assert.match(editor, /handleVariantBFieldChange\('bullets', \[\.\.\.cur, NEW_BENEFIT\]\)/, 'version B');
    assert.match(editor, /aria-label=\{`Key benefit \$\{idx \+ 1\}`\}\s*value=\{b\}\s*placeholder=\{BENEFIT_HINT\}/, 'the field says what to write');
  });

  it('an empty benefit, or one saved before this fix, is not a benefit on the page or in the preview', () => {
    const data = { ...defaultPage(), bullets: [NEW_BENEFIT, 'New value point', 'Ships in two days'] };
    const copy = previewPageCopy(data);
    assert.deepEqual(copy.bullets, ['Ships in two days']);
    const live = liveText(data);
    assert.ok(live.includes('Ships in two days'));
    assert.ok(!/new value point/i.test(live));
  });
});

describe('The editor Preview shows only what the live page shows', () => {
  const fixtures = [
    ['the default page with nothing written', defaultPage(), {}],
    ['a page with its words written', {
      ...defaultPage(),
      headline: 'Book a free fitting',
      subhead: 'Thirty minutes with a fitter.',
      bullets: ['Measured in store', ''],
      buttonText: 'Book now',
      trustBadge: 'Family run since 1998',
      discountCode: 'FIT10',
      urgencyTimerEnabled: true,
      urgencyMinutes: 15,
      scarcityBatchEnabled: true,
      scarcityBatchCount: 7,
      orderBumpEnabled: true,
      orderBumpVariantId: '55512345678',
      orderBumpPrice: '$12.00'
    }, {}],
    ['version B', {
      ...defaultPage(),
      headline: 'Version A headline',
      abTestingEnabled: true,
      variantB: { headline: 'Version B headline', subhead: 'Describe what the visitor gets.', bullets: ['New value point'], buttonText: 'Try B' }
    }, { var: 'b' }],
    ['seeded lines and a sample add-on', {
      ...defaultPage(),
      trustBadge: 'Rated 4.9/5 by verified beauty lovers',
      scarcityBatchEnabled: true,
      scarcityBatchText: 'Hand-blended batch #22: only 14 units remaining',
      urgencyTimerEnabled: true,
      orderBumpEnabled: true,
      orderBumpVariantId: '42109840194'
    }, {}],
    ['a product picked from the sample catalog', {
      ...defaultPage(),
      shopifyVariantId: '42109840194',
      shopifyProductTitle: 'Sample Serum',
      shopifyProductPrice: '$48.00',
      shopifyProductImage: 'https://cdn.example.com/sample-serum.png'
    }, {}],
    ['a product from the store', {
      ...defaultPage(),
      shopifyVariantId: '55599911122',
      shopifyProductTitle: 'Night Balm',
      shopifyProductPrice: '$31.00',
      shopifyProductImage: 'https://cdn.example.com/night-balm.png'
    }, {}]
  ];

  for (const [name, data, query] of fixtures) {
    it(`every line of the preview is on the live page: ${name}`, () => {
      const copy = previewPageCopy(data, query.var === 'b' ? data.variantB : null);
      const live = liveText(data, query);
      for (const line of previewLines(copy)) {
        assert.ok(live.includes(line), `the preview shows "${line}", which the live page does not`);
      }
    });
  }

  it('shows no subheadline, badge, benefit, countdown or add-on the page leaves out', () => {
    const copy = previewPageCopy({ ...defaultPage(), urgencyTimerEnabled: true, orderBumpEnabled: true });
    assert.equal(copy.subhead, '');
    assert.equal(copy.discountCode, '');
    assert.deepEqual(copy.bullets, []);
    assert.equal(copy.urgency, null, 'no minutes, no countdown');
    assert.equal(copy.bump, null, 'no store product, no add-on card');
    assert.equal(copy.bumpNeedsProduct, true, 'so the editor can say why');
    const seeded = previewPageCopy(fixtures[3][1]);
    assert.equal(seeded.trustBadge, '');
    assert.equal(seeded.scarcity, '');
  });

  it("a sample product's price and image are left off, as the page leaves them off", () => {
    const sample = fixtures.find(f => f[0] === 'a product picked from the sample catalog')[1];
    const copy = previewPageCopy(sample);
    assert.equal(copy.productPrice, '', 'no price tag for an invented price');
    assert.equal(copy.heroImage, sample.heroImageUrl || '', "the page's own image, never the sample's");
    const live = liveText(sample);
    assert.ok(!live.includes('48.00') && !live.includes('Sample Serum'), 'the live page shows neither');
    const html = renderPublicFunnelHtml({ slug: 't12-page', userId: 'usr_t12', data: sample }, { query: {}, headers: {} });
    assert.ok(!html.includes('sample-serum.png'), 'nor the sample image');

    const real = fixtures.find(f => f[0] === 'a product from the store')[1];
    const realCopy = previewPageCopy(real);
    assert.equal(realCopy.productPrice, '$31.00');
    assert.equal(realCopy.heroImage, real.shopifyProductImage);
    assert.ok(liveText(real).includes('$31.00'), 'a real product keeps its price on the page');
  });

  it('the preview price tag and image come from previewPageCopy', () => {
    assert.match(editor, /const previewHeroImage = pageCopy\.heroImage;/);
    assert.match(previewSrc, /\{pageCopy\.productPrice && \(/);
    assert.ok(!previewSrc.includes('data.shopifyProductPrice'), 'the tag never reads the saved price directly');
  });

  it("the fallbacks are the live page's own words", () => {
    const empty = liveText({ orderBumpEnabled: true, orderBumpVariantId: '55512345678', urgencyTimerEnabled: true, urgencyMinutes: 5 });
    for (const word of [HEADLINE_FALLBACK, BUTTON_FALLBACK, URGENCY_FALLBACK, BUMP_HEADLINE_FALLBACK, BUMP_TITLE_FALLBACK]) {
      assert.ok(empty.includes(word), `the live page does not say "${word}"`);
    }
    assert.ok(publicSrc.includes(`data.socialProofHeadline || '${SOCIAL_PROOF_FALLBACK}'`), 'the review wall heading default');
  });

  it('the editor draws the preview from previewPageCopy and invents nothing of its own', () => {
    assert.match(editor, /const pageCopy = previewPageCopy\(data, isPreviewB \? data\.variantB : null\)/);
    for (const invented of [
      'Exclusive Offer',
      'VIP Code:',
      'Your High-Converting Offer Headline',
      'Clear, concise subheadline addressing customer pain.',
      'One-Time Upgrade',
      'Add complementary companion item to this order.',
      'Complementary Add-on',
      'Cart & promotional pricing reserved for',
      '1-Click Order Bump',
      'Modal VIP Upgrade',
      'Triggers discount popup',
      'with coupon applied',
      '⭐ {'
    ]) {
      assert.ok(!previewSrc.includes(invented), `the Preview still shows "${invented}"`);
    }
    assert.ok(previewSrc.length > 1000, 'the preview markup was found');
    // An empty countdown line reads as the page's own default, which its field's hint now says.
    assert.match(editor, /value=\{data\.urgencyText \|\| ''\}\s*placeholder=\{URGENCY_FALLBACK\}/);
    assert.match(editor, /previewHint\('No subheadline yet'/, 'an empty subheadline shows a hint');
  });
});

describe('The review wall heading shows no invented value', () => {
  it('is empty with the heading the page uses as its hint', () => {
    assert.doesNotMatch(editor, /Loved by Thousands/i);
    assert.match(editor, /value=\{data\.socialProofHeadline \?\? ''\}\s*placeholder=\{SOCIAL_PROOF_FALLBACK\}/);
    assert.equal(SOCIAL_PROOF_FALLBACK, 'Customer reviews');
  });
});

// The step panel mounts the page editor (NodeInspector), so a journey id the editor forwards is
// only on the request when that element hands it one. Pinning PageEditor alone passed while the
// shipped app sent none.
const inspector = fs.readFileSync(new URL('./src/components/drawers/NodeInspector.tsx', import.meta.url), 'utf8');
const pageEditorElement = (() => {
  const start = inspector.indexOf('<PageEditor');
  return start < 0 ? '' : inspector.slice(start, inspector.indexOf('/>', start));
})();

describe('Check DNS names the journey', () => {
  it('the page editor forwards the journey id it is given and the client puts it on the request', () => {
    assert.match(editor, /journeyId\?: string;/, 'PageEditor takes the journey id');
    assert.match(editor, /const journeyParam = journeyId \? `&journeyId=\$\{encodeURIComponent\(journeyId\)\}` : '';/);
    assert.match(editor, /requestAnswer\(`\/api\/domain\/verify\?domain=\$\{encodeURIComponent\(data\.customDomain\)\}\$\{journeyParam\}`/);
    // PublishModal names the journey the same way, and reads the answer through dnsCheckOutcome too:
    // a failed request there said "DNS not propagated yet", a DNS result nobody had checked (U03).
    assert.match(publishModal, /requestAnswer\(`\/api\/domain\/verify\?domain=\$\{encodeURIComponent\(domain\)\}\$\{journeyParam\}`/);
    assert.match(publishModal, /&journeyId=\$\{encodeURIComponent\(journeyId\)\}/);
    assert.match(publishModal, /if \(outcome\.kind === 'refused'\) \{\s*setDomainStatus\(prev => \(\{ \.\.\.prev, \[domain\]: \{ verified: false, message: outcome\.message \} \}\)\);\s*return;/);
    assert.doesNotMatch(publishModal, /verifyCustomDomain/);
  });

  // Without journeyId={journeyId} on NodeInspector's <PageEditor> (as SequenceEditor already has),
  // Check DNS sends no journey id.
  it('the step panel hands the page editor its journey id', () => {
    assert.ok(pageEditorElement, 'NodeInspector mounts a PageEditor');
    assert.match(pageEditorElement, /journeyId=\{journeyId\}/);
  });
});

// U03: a Check DNS that failed (500, 401, a dropped connection) showed "CNAME Target Mismatch", a
// DNS result nobody had checked, and the server's error sentence was never shown. Only a real
// answer from the check may give a verdict now; anything else is one sentence, with Retry only
// when retrying can help.
const MISMATCH = {
  success: true, verified: false, domain: 'offer.example.com', cnameMatch: false, cnames: [],
  expectedTarget: 'cname.jourvance.com',
  message: 'No active CNAME detected for offer.example.com.'
};

describe('Check DNS gives a verdict only from a real answer', () => {
  it('a server error, a 401 and a network error each say the check did not run, never a verdict', () => {
    assert.deepEqual(dnsCheckOutcome({ status: 500, body: {} }), { kind: 'refused', message: DNS_SERVER_PROBLEM, retryable: true });
    assert.deepEqual(dnsCheckOutcome({ status: 503, body: { success: false, verified: false } }), { kind: 'refused', message: DNS_SERVER_PROBLEM, retryable: true });
    assert.deepEqual(dnsCheckOutcome({ status: 401, body: { success: false, error: 'Sign in to continue.' } }), { kind: 'refused', message: DNS_SIGN_IN, retryable: false });
    assert.deepEqual(dnsCheckOutcome(null), { kind: 'refused', message: DNS_UNREACHABLE, retryable: true });
    assert.deepEqual(dnsCheckOutcome({ status: 429, body: {} }), { kind: 'refused', message: DNS_SERVER_BUSY, retryable: true });
    for (const message of [DNS_UNREACHABLE, DNS_SIGN_IN, DNS_SERVER_PROBLEM, DNS_SERVER_BUSY, DNS_UNREADABLE]) {
      assert.equal(message.split(/[.!?](\s|$)/).filter(t => t && t.trim()).length, 1, `one sentence: ${message}`);
      assert.doesNotMatch(message, /CNAME|mismatch|verified|—| – /i, message);
    }
  });

  it("a refusal with the server's reason shows that reason, without Retry", () => {
    const reason = 'A valid subdomain is required (e.g. offer.yourbrand.com).';
    assert.deepEqual(dnsCheckOutcome({ status: 400, body: { success: false, error: reason } }), { kind: 'refused', message: reason, retryable: false });
    assert.deepEqual(dnsCheckOutcome({ status: 200, body: { success: false, verified: false, error: reason } }), { kind: 'refused', message: reason, retryable: false });
    // A 200 with no verdict in it (an HTML page, an empty body) is no answer to the check.
    assert.deepEqual(dnsCheckOutcome({ status: 200, body: {} }), { kind: 'refused', message: DNS_UNREADABLE, retryable: true });
  });

  it('a real answer keeps its verdict, and its error sentence is shown when it sends one', () => {
    const mismatch = dnsCheckOutcome({ status: 200, body: MISMATCH });
    assert.equal(mismatch.kind, 'verdict');
    assert.equal(mismatch.result.verified, false);
    assert.equal(dnsVerdictDetail(mismatch.result), MISMATCH.message);
    const contested = { ...MISMATCH, contested: true, error: 'This domain is currently connected to another store.', message: 'Contested Domain.' };
    assert.equal(dnsVerdictDetail(dnsCheckOutcome({ status: 200, body: contested }).result), contested.error);
    const verified = dnsCheckOutcome({ status: 200, body: { ...MISMATCH, verified: true, message: 'CNAME Verified!' } });
    assert.equal(verified.kind, 'verdict');
    assert.equal(verified.result.verified, true);
  });

  it('the page editor draws the mismatch only inside the verdict branch and offers Retry only when it can help', () => {
    const verdictAt = editor.indexOf("dnsOutcome?.kind === 'verdict'");
    assert.ok(verdictAt > 0, 'the verdict has its own branch');
    const mismatchAt = editor.indexOf('CNAME Target Mismatch');
    assert.ok(mismatchAt > verdictAt, 'the mismatch is said only from a verdict');
    assert.equal(editor.indexOf('CNAME Target Mismatch', mismatchAt + 1), -1, 'and nowhere else');
    assert.match(editor, /const outcome = dnsCheckOutcome\(answer\);/);
    assert.match(editor, /\{dnsOutcome\.retryable && \(/);
    assert.match(editor, /outcome\.kind === 'verdict' && outcome\.result\.verified/, 'only a verified answer marks the domain verified');
    assert.doesNotMatch(editor, /dnsResult\.message\}/, "the detail line is dnsVerdictDetail's, which shows the error");
  });
});

describe('Add Point puts focus in the new benefit', () => {
  it('both versions record the new index and the effect focuses that input', () => {
    const addAt = editor.indexOf('<Plus size={12} /> Add Point');
    const onClick = editor.slice(editor.lastIndexOf('onClick={() => {', addAt), addAt);
    assert.match(onClick, /focusBulletAt\.current = cur\.length;\s*handleVariantBFieldChange/, 'version B');
    assert.match(onClick, /focusBulletAt\.current = \(data\.bullets \|\| \[\]\)\.length;\s*addBullet\(\)/, 'version A');
    assert.match(editor, /<div ref=\{bulletGroupRef\} role="group" aria-labelledby=\{fid\('bullets'\)\}/);
    assert.match(editor, /bulletGroupRef\.current\?\.querySelectorAll<HTMLInputElement>\('input\[type="text"\]'\)\[idx\]/);
    assert.match(editor, /focusBulletAt\.current = null;\s*input\.focus\(\);/);
  });
});
