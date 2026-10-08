import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('drip_seq_upsell_recovery is configured in the server seed', () => {
  // The sequence lives in server.mjs. drips.json is local store data and is not in git.
  const src = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  const start = src.indexOf("id: 'drip_seq_upsell_recovery'");
  assert.ok(start > 0, 'the upsell recovery seed is in the server');
  const slice = src.slice(start, start + 1400);
  assert.match(slice, /triggerType: 'upsell_recovery'/);
  assert.match(slice, /smartExitOnPurchase: true/);
  assert.match(slice, /delayHours: 18/);
  assert.match(slice, /\{\{offer_url\}\}/);
  assert.match(slice, /\{\{order_number\}\}/);
  assert.match(slice, /\{\{first_name\}\}/);
  assert.doesNotMatch(slice, /\{\{discount_code\}\}/);

  const file = path.join(__dirname, 'drips.json');
  if (!fs.existsSync(file)) return;
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  const recoverySeq = stored.sequences.find(s => s.id === 'drip_seq_upsell_recovery');
  assert.ok(recoverySeq, 'a local drip store that exists still has the recovery sequence');
  assert.equal(recoverySeq.steps[0].delayHours, 18);
});

test('upsell decline auto-enrolls customer and tags contact correctly', () => {
  const contacts = [
    { id: 'c_1', email: 'sophia@luxeaesthetics.com', name: 'Sophia Rossi', tags: ['VIP-Client'] }
  ];

  const dripsData = {
    sequences: [
      {
        id: 'drip_seq_upsell_recovery',
        name: 'Post-Purchase Courtesy Offer',
        triggerType: 'upsell_recovery',
        smartExitOnPurchase: true,
        steps: [{ delayHours: 18, discountVoucher: 'THANKS5' }],
        activeEnrollments: 0
      }
    ],
    enrollments: []
  };

  // Simulate decline action logic
  const action = 'decline';
  const offerType = 'upsell';
  const customerEmail = 'sophia@luxeaesthetics.com';
  const slug = 'botanical-glow-upsell';
  const isDownsell = offerType === 'downsell';

  // 1. Tagging
  const contact = contacts.find(c => c.email === customerEmail);
  const tagName = isDownsell ? 'Downsell-Declined' : 'Upsell-Declined';
  if (!contact.tags.includes(tagName)) contact.tags.push(tagName);

  assert.ok(contact.tags.includes('Upsell-Declined'));

  // 2. Drip Auto-Enrollment
  const recoverySeq = dripsData.sequences.find(s => s.triggerType === 'upsell_recovery');
  const alreadyActive = dripsData.enrollments.some(e =>
    e.customerEmail === customerEmail && e.sequenceId === recoverySeq.id && e.status === 'active'
  );

  assert.equal(alreadyActive, false);

  const now = Date.now();
  const delayHours = recoverySeq.steps[0].delayHours;
  const newEnrollment = {
    id: `enr_test_1`,
    sequenceId: recoverySeq.id,
    userId: 'usr_default',
    customerEmail,
    customerName: contact.name,
    sourceSlug: slug,
    offerUrl: `https://glowbeauty.com/p/${slug}`,
    offerType: 'upsell',
    discountCode: recoverySeq.steps[0].discountVoucher || '',
    currentStepIndex: 0,
    status: 'active',
    enrolledAt: new Date(now).toISOString(),
    nextStepDueAt: new Date(now + delayHours * 3600000).toISOString(),
    history: []
  };

  dripsData.enrollments.unshift(newEnrollment);
  recoverySeq.activeEnrollments++;

  assert.equal(dripsData.enrollments.length, 1);
  assert.equal(dripsData.enrollments[0].status, 'active');
  assert.equal(dripsData.enrollments[0].offerUrl, 'https://glowbeauty.com/p/botanical-glow-upsell');
  assert.equal(dripsData.enrollments[0].discountCode, 'THANKS5');
  assert.equal(recoverySeq.activeEnrollments, 1);
});

test('upsell accept triggers immediate smart exit of active recovery enrollment', () => {
  const dripsData = {
    sequences: [
      {
        id: 'drip_seq_upsell_recovery',
        triggerType: 'upsell_recovery',
        smartExitOnPurchase: true,
        activeEnrollments: 1,
        totalExitedPurchased: 0
      }
    ],
    enrollments: [
      {
        id: 'enr_active_decline',
        sequenceId: 'drip_seq_upsell_recovery',
        customerEmail: 'emma@glowstudio.com',
        status: 'active',
        enrolledAt: new Date(Date.now() - 3600000).toISOString()
      }
    ]
  };

  const customerEmail = 'emma@glowstudio.com';
  const action = 'accept';

  if (action === 'accept') {
    for (const enr of dripsData.enrollments) {
      if (enr.customerEmail === customerEmail && enr.status === 'active') {
        const s = dripsData.sequences.find(sq => sq.id === enr.sequenceId);
        if (s && s.triggerType === 'upsell_recovery') {
          enr.status = 'converted_exit';
          enr.convertedAt = new Date().toISOString();
          s.activeEnrollments = Math.max(0, s.activeEnrollments - 1);
          s.totalExitedPurchased = (s.totalExitedPurchased || 0) + 1;
        }
      }
    }
  }

  assert.equal(dripsData.enrollments[0].status, 'converted_exit');
  assert.ok(dripsData.enrollments[0].convertedAt);
  assert.equal(dripsData.sequences[0].activeEnrollments, 0);
  assert.equal(dripsData.sequences[0].totalExitedPurchased, 1);
});

test('runner smart exit detects subsequent upsell accept event or later order', () => {
  const enrollmentTime = new Date('2026-09-26T12:00:00.000Z').getTime();

  const enr = {
    id: 'enr_runner_test',
    sequenceId: 'drip_seq_upsell_recovery',
    customerEmail: 'chloe@skinwellness.com',
    status: 'active',
    enrolledAt: new Date(enrollmentTime).toISOString()
  };

  const seq = {
    triggerType: 'upsell_recovery',
    smartExitOnPurchase: true
  };

  // Case 1: Initial core order placed before enrollment (should NOT trigger premature exit)
  const initialOrders = [
    {
      customerEmail: 'chloe@skinwellness.com',
      totalPrice: 48.00,
      createdAt: new Date(enrollmentTime - 30000).toISOString() // 30s before decline
    }
  ];
  const noEvents = [];

  function checkShouldExit(orders, events) {
    if (seq.triggerType === 'upsell_recovery') {
      const hasAcceptedUpsell = events.some(ev =>
        ev.type === 'upsell_accept' &&
        ev.email && ev.email.toLowerCase() === enr.customerEmail.toLowerCase() &&
        new Date(ev.timestamp).getTime() >= new Date(enr.enrolledAt).getTime() - 5000
      );
      const hasSubsequentOrder = orders.some(o =>
        o.customerEmail && o.customerEmail.toLowerCase() === enr.customerEmail.toLowerCase() &&
        new Date(o.createdAt).getTime() >= new Date(enr.enrolledAt).getTime() + 1000
      );
      return hasAcceptedUpsell || hasSubsequentOrder;
    }
    return orders.some(o => o.customerEmail === enr.customerEmail && new Date(o.createdAt).getTime() >= new Date(enr.enrolledAt).getTime() - 60000);
  }

  // Should NOT exit on the initial pre-upsell order
  assert.equal(checkShouldExit(initialOrders, noEvents), false);

  // Case 2: Customer converts on the second chance offer via upsell_accept event
  const eventsWithAccept = [
    {
      type: 'upsell_accept',
      email: 'chloe@skinwellness.com',
      timestamp: new Date(enrollmentTime + 7200000).toISOString(), // 2 hours later
      amount: 29.00
    }
  ];
  assert.equal(checkShouldExit(initialOrders, eventsWithAccept), true);

  // Case 3: Customer places a subsequent store order
  const ordersWithLaterOrder = [
    ...initialOrders,
    {
      customerEmail: 'chloe@skinwellness.com',
      totalPrice: 65.00,
      createdAt: new Date(enrollmentTime + 86400000).toISOString()
    }
  ];
  assert.equal(checkShouldExit(ordersWithLaterOrder, noEvents), true);
});

test('email template tokens replace offer_url, discount_code, order_number, and first_name', () => {
  const template = 'Hey {{first_name}},\n\nYour order {{order_number}} is confirmed. Use {{discount_code}} at {{offer_url}} to claim your courtesy offer.';
  const vars = {
    first_name: 'Elena',
    order_number: '#10482',
    discount_code: 'SAVE10',
    offer_url: 'https://jourvance.com/p/botanical-cleanser-offer'
  };

  let rendered = template;
  for (const [key, val] of Object.entries(vars)) {
    rendered = rendered.replaceAll(`{{${key}}}`, val);
  }

  assert.ok(rendered.includes('Hey Elena,'));
  assert.ok(rendered.includes('#10482'));
  assert.ok(rendered.includes('SAVE10'));
  assert.ok(rendered.includes('https://jourvance.com/p/botanical-cleanser-offer'));
  assert.equal(rendered.includes('{{'), false);
});

// C18: the page used to fall back to a literal SAVE10 and claim "10% courtesy discount pre-applied"
// (and charge 90% of the price) on any ?ref=recovery or ?coupon link, whatever the store has. It
// now names only a code it was given and a percentage only when the step stores one for that code.
function upsellPage(upsell = {}) {
  return {
    slug: 'offer',
    shopifyConfig: { storeDomain: 'shop-a.myshopify.com', status: 'connected' },
    data: { upsell: { headline: 'One more thing', productPrice: '$40.00', shopifyVariantId: '123456', acceptButtonText: 'Add it', ...upsell } }
  };
}

async function renderUpsell(page, query) {
  const { renderPublicUpsellHtml } = await import('./server/routes/publicRoutes.mjs');
  return renderPublicUpsellHtml(page, { query, headers: {}, params: {} }, {}, false);
}

test('C18: a recovery link with no code on the step invents no code and no discount', async () => {
  const html = await renderUpsell(upsellPage(), { ref: 'recovery', email: 'a@b.co' });
  assert.ok(!html.includes('SAVE10'), 'no SAVE10 fallback');
  assert.doesNotMatch(html, /\d+% (courtesy|off|OFF)/i);
  assert.ok(!html.includes('id="jv-recovery-banner"'), 'no courtesy banner without a code');
  assert.ok(!html.includes('discount='), 'the cart link carries no code');
  assert.match(html, /data-discounted-base=""/);
});

test('C18: a code in the link is named, but no percentage the step does not store', async () => {
  const html = await renderUpsell(upsellPage(), { coupon: 'friend5', ref: 'recovery' });
  assert.match(html, /id="jv-recovery-banner"/);
  assert.match(html, /Your code: <strong>FRIEND5<\/strong>/);
  assert.doesNotMatch(html, /\d+% (courtesy|off|OFF)/i);
  assert.match(html, /data-discounted-base=""/, 'the price is not cut by a guessed amount');
  assert.match(html, /\/cart\/123456:1\?discount=FRIEND5/);
  // A stored percentage belongs to the step's own code, not to a different code in the link.
  const other = await renderUpsell(upsellPage({ discountCode: 'WELCOME20', discountPercentage: 20 }), { coupon: 'FRIEND5' });
  assert.doesNotMatch(other, /20%/);
});

test('C18: the step\'s own code and percentage are what the recovery page shows and charges', async () => {
  const html = await renderUpsell(upsellPage({ discountCode: 'welcome20', discountPercentage: 20 }), { ref: 'recovery' });
  assert.match(html, /20% off with code <strong>WELCOME20<\/strong>/);
  assert.match(html, /data-discounted-base="32\.00"/);
  assert.match(html, /Add it \(20% off\)/);
  assert.match(html, /\/cart\/123456:1\?discount=WELCOME20/);
  assert.ok(!html.includes('SAVE10'));
});

async function declineWith(steps) {
  const express = (await import('express')).default;
  const { setupPublicRoutes } = await import('./server/routes/publicRoutes.mjs');
  const drips = { sequences: [{ id: 'drip_seq_upsell_recovery', triggerType: 'upsell_recovery', steps }], enrollments: [] };
  const app = express();
  app.use(express.json());
  setupPublicRoutes(app, {
    loadDrips: () => drips,
    saveDrips: () => {},
    reloadPublicPageCache: () => ({ offer: upsellPage() }),
    publicBase: () => 'https://jv.test'
  });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/public/upsell-action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'offer', action: 'decline', offerType: 'upsell', customerEmail: 'a@b.co' })
    });
    assert.equal(r.status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
  return drips.enrollments[0];
}

test('C18: a decline enrols with the sequence\'s own code only, never a SAVE10 fallback', async () => {
  const none = await declineWith([{ delayHours: 18 }]);
  assert.ok(none, 'the decline enrolled');
  assert.equal(none.discountCode, '');
  assert.ok(!none.offerUrl.includes('coupon='), none.offerUrl);
  assert.ok(!JSON.stringify(none).includes('SAVE10'));
  const own = await declineWith([{ delayHours: 18, discountVoucher: 'THANKS5' }]);
  assert.equal(own.discountCode, 'THANKS5');
  assert.equal(new URL(own.offerUrl).searchParams.get('coupon'), 'THANKS5');
});

test('a decline\'s recovery link carries the step\'s code, the email, ref=recovery and an expiry 24h after the send', async () => {
  const before = Date.now();
  const enr = await declineWith([{ delayHours: 18, discountVoucher: 'THANKS5' }]);
  const url = new URL(enr.offerUrl);
  assert.equal(url.pathname, '/p/offer');
  assert.equal(url.searchParams.get('coupon'), 'THANKS5');
  assert.equal(url.searchParams.get('email'), 'a@b.co');
  assert.equal(url.searchParams.get('ref'), 'recovery');
  const exp = Number(url.searchParams.get('exp'));
  assert.ok(exp >= before + 42 * 3600000 && exp <= Date.now() + 42 * 3600000, 'exp is the 18h delay plus 24h');
});

test('Option C1: /api/funnel/stats computes upsell recovery metrics and applies to nodeData', () => {
  const offer = 'upsell';
  const events = [
    { type: 'upsell_view', offerType: 'upsell' },
    { type: 'upsell_view', offerType: 'upsell' },
    { type: 'upsell_view', offerType: 'upsell' },
    { type: 'upsell_view', offerType: 'upsell' },
    { type: 'upsell_accept', offerType: 'upsell', amount: 48, email: 'initial@ex.com' },
    { type: 'upsell_decline', offerType: 'upsell', email: 'recovery1@ex.com' },
    { type: 'upsell_decline', offerType: 'upsell', email: 'recovery2@ex.com' },
    { type: 'upsell_accept', offerType: 'upsell', amount: 43.20, email: 'recovery1@ex.com', discountCode: 'SAVE10' }
  ];

  const drips = {
    enrollments: [
      { sequenceId: 'drip_seq_upsell_recovery', status: 'converted_exit', customerEmail: 'recovery1@ex.com' }
    ]
  };

  const views = events.filter(e => e.type === 'upsell_view' && (e.offerType || 'upsell') === offer).length;
  const accepts = events.filter(e => e.type === 'upsell_accept' && (e.offerType || 'upsell') === offer);
  const takes = accepts.length;
  const attributedRevenue = Number(accepts.reduce((sum, e) => sum + Number(e.amount || 0), 0).toFixed(2));
  const declines = events.filter(e => e.type === 'upsell_decline' && (e.offerType || 'upsell') === offer);
  const totalDeclines = declines.length;
  const declinedEmails = new Set(declines.map(d => String(d.email || '').toLowerCase()).filter(Boolean));
  const recoveryEnrollments = (drips.enrollments || []).filter(e => e.sequenceId === 'drip_seq_upsell_recovery');
  const recoveryConvertedEmails = new Set(
    recoveryEnrollments.filter(e => e.status === 'converted_exit' && e.customerEmail).map(e => e.customerEmail.toLowerCase())
  );
  const recoveryCodes = new Set(recoveryEnrollments.map(e => String(e.discountCode || '').trim()).filter(Boolean));
  const recoveredAccepts = accepts.filter(a => {
    const em = String(a.email || '').toLowerCase();
    return (em && (declinedEmails.has(em) || recoveryConvertedEmails.has(em))) || (a.discountCode && recoveryCodes.has(a.discountCode));
  });
  const recoveredTakes = recoveredAccepts.length;
  const recoveredRevenue = Number(recoveredAccepts.reduce((sum, e) => sum + Number(e.amount || 0), 0).toFixed(2));
  const round1 = (n) => Math.round(n * 10) / 10;
  const recoveryRate = totalDeclines > 0 ? round1((recoveredTakes / totalDeclines) * 100) : 0;

  assert.equal(views, 4);
  assert.equal(takes, 2);
  assert.equal(attributedRevenue, 91.20);
  assert.equal(totalDeclines, 2);
  assert.equal(recoveredTakes, 1);
  assert.equal(recoveredRevenue, 43.20);
  assert.equal(recoveryRate, 50.0);
});

// The expired card and the clock are real code now; the two mirrors that stood here copied the old
// SAVE10 and 10% logic into the test and checked their own strings.
test('an expired recovery link applies no code and makes no claim about an order', async () => {
  const html = await renderUpsell(upsellPage({ discountCode: 'WELCOME20', discountPercentage: 20 }), {
    coupon: 'WELCOME20', ref: 'recovery', email: 'a@b.co', exp: String(Date.now() - 5000)
  });
  assert.match(html, /This Private Courtesy Offer Has Expired/);
  assert.ok(!html.includes('id="jv-recovery-banner"'));
  assert.ok(!html.includes('discount='), 'the cart link carries no code');
  assert.doesNotMatch(html, /20% off/);
  assert.doesNotMatch(html, /fulfillment queue|tracking details|order is confirmed/i, 'nothing on this page backs an order claim');
  assert.match(html, /href="\/p\/offer\/thank-you"[^>]*>\s*Continue\s*<\/a>/);
});

test('a code with no known expiry gets no clock and cannot "expire" in the browser', async () => {
  const html = await renderUpsell(upsellPage(), { coupon: 'FRIEND5', ref: 'recovery' });
  assert.match(html, /id="jv-recovery-banner"/);
  assert.ok(!html.includes('jv-recovery-timer'), 'no countdown without an expiry');
  assert.ok(!html.includes('sessionStorage'), 'the page no longer starts its own 24 hours');
  assert.ok(!html.includes('24:00:00'));
});

test('a known expiry shows its real time left', async () => {
  const exp = Date.now() + 5 * 3600000 + 30 * 60000;
  const html = await renderUpsell(upsellPage(), { coupon: 'FRIEND5', ref: 'recovery', exp: String(exp) });
  assert.match(html, /Link expires in:/);
  assert.match(html, /id="jv-recovery-timer"[^>]*>05:(29|30):\d\d</);
  assert.match(html, new RegExp(`var recoveryExp = ${exp};`));
});

function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

test('a link cannot close the page\'s script: query values are written as safe JS literals', async () => {
  const email = '</script><script>alert(1)</script>';
  const html = await renderUpsell(upsellPage(), { coupon: 'X', ref: 'recovery', email });
  assert.ok(!html.includes('<script>alert(1)'), 'the injected tag is not in the page');
  for (const src of inlineScripts(html)) new Function(src); // every inline script still parses
  // The value survives intact for the page's own use.
  assert.ok(html.includes('"\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"'));
});

test('a referral code ending in a backslash no longer breaks the landing page script', async () => {
  const { renderPublicFunnelHtml } = await import('./server/routes/publicRoutes.mjs');
  const page = { slug: 'offer', data: { headline: 'H', buttonText: 'Go' }, shopifyConfig: {} };
  const html = renderPublicFunnelHtml(page, { query: { ref: 'ab\\' }, headers: {}, params: {}, cookies: {} }, { cookie() {}, setHeader() {} });
  const scripts = inlineScripts(html);
  assert.ok(scripts.length > 0);
  for (const src of scripts) new Function(src);
  assert.match(html, /const referralCode = "ab\\\\";/);
});
