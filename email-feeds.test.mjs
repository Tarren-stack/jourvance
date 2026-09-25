import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLetter } from './email-doc.mjs';
import {
  applyLinkUtm, applySmsCoupon, cleanAttributionWindows, describeSentHtml, lastTouch, linksToRewrite,
  quietOpenAt, redirectStatus, rewriteFirstLink, selectFeed, smsCouponPlan, smsDraft, smsQuietEnabled,
  sunsetCandidates, tallyMessages, touchRevenue, unengagedEmails
} from './email-feeds.mjs';

const now = Date.parse('2026-09-25T15:00:00.000Z');
const day = 86400000;

function variant(id, productId, extra = {}) {
  return {
    productId,
    variantId: id,
    title: extra.title || productId,
    image: extra.image || `https://cdn.example/${id}.jpg`,
    price: extra.price || '10.00',
    url: `https://shop.example/products/${productId}`,
    available: extra.available ?? 5,
    createdAt: extra.createdAt || '',
    category: extra.category || ''
  };
}

function order(at, email, lines) {
  return { id: `o_${at}`, createdAt: new Date(at).toISOString(), customerEmail: email, lineItems: lines };
}

const catalog = [
  variant('a1', 'a', { title: 'Hat', price: '100.00' }),
  variant('a2', 'a', { title: 'Hat', price: '20.00' }),
  variant('b1', 'b', { title: 'Cap', price: '5.00' })
];

test('best sellers rank by units and the passing variant is pictured', () => {
  const orders = [
    order(now - day, 'a@b.co', [{ productId: 'a', variantId: 'a1', quantity: 1, price: 100 }]),
    order(now - day, 'c@b.co', [{ productId: 'b', variantId: 'b1', quantity: 4, price: 5 }]),
    order(now - 10 * day, 'd@b.co', [{ productId: 'a', variantId: 'a2', quantity: 9, price: 20 }])
  ];
  const recent = selectFeed({ source: 'best_3', orders, catalog, now, limit: 3, hideMissingImage: true });
  assert.deepEqual(recent.products.map((row) => row.id), ['b1', 'a1']);
  assert.equal(recent.label, 'Best sellers, last 3 days');
  const wide = selectFeed({ source: 'best_90', orders, catalog, now, limit: 3 });
  assert.equal(wide.products[0].id, 'a2');
  const priced = selectFeed({
    source: 'best_90', orders, catalog, now, limit: 1, minPrice: 50, hideMissingImage: true
  });
  assert.equal(priced.products[0].id, 'a1');
  assert.equal(priced.products[0].price, '100.00');
});

test('newest stays unavailable without a created date and checkout is not a view feed', () => {
  const missing = selectFeed({ source: 'newest', catalog, orders: [], now });
  assert.equal(missing.products.length, 0);
  assert.match(missing.unavailable, /created date/);
  const dated = selectFeed({
    source: 'newest',
    now,
    catalog: [
      variant('old', 'old', { createdAt: '2026-01-01T00:00:00.000Z', title: 'Old' }),
      variant('new', 'new', { createdAt: '2026-09-01T00:00:00.000Z', title: 'New' })
    ]
  });
  assert.equal(dated.products[0].id, 'new');
  const checkout = selectFeed({
    source: 'checkout',
    now,
    behavior: [{ type: 'product_viewed', email: 'a@b.co', at: new Date(now).toISOString(), productId: 'viewed' }],
    checkout: { lineItems: [{ productId: 'bag', title: 'Bag', quantity: 1, price: '12.00' }] },
    catalog
  });
  assert.equal(checkout.label, 'This checkout');
  assert.deepEqual(checkout.products.map((row) => row.title), ['Bag']);
});

test('co-purchase excludes the trigger and a previous buy, then fills from best sellers', () => {
  const orders = [
    order(now - day, 'buyer@b.co', [
      { productId: 'trigger', variantId: 't', quantity: 1 },
      { productId: 'b', variantId: 'b1', quantity: 2 }
    ]),
    order(now - day, 'other@b.co', [
      { productId: 'trigger', variantId: 't', quantity: 1 },
      { productId: 'extra', variantId: 'e', quantity: 3 }
    ])
  ];
  const rows = [
    ...catalog,
    variant('t', 'trigger', { title: 'Trigger' }),
    variant('e', 'extra', { title: 'Extra' })
  ];
  const feed = selectFeed({
    source: 'copurchase', fallback: 'best_90', triggerProductId: 'trigger', email: 'buyer@b.co',
    orders, catalog: rows, now, limit: 2
  });
  assert.equal(feed.label, 'Co-purchase');
  assert.equal(feed.products.some((row) => row.id === 't' || row.id === 'b1'), false);
  assert.equal(feed.products[0].id, 'e');
  const empty = selectFeed({ source: 'viewed', email: 'buyer@b.co', orders, catalog: rows, behavior: [], now, limit: 1 });
  assert.match(empty.unavailable, /fallback/);
  const filled = selectFeed({
    source: 'viewed', fallback: 'best_90', email: 'nobody@b.co', orders, catalog: rows, behavior: [], now, limit: 1
  });
  assert.equal(filled.usedFallback, true);
  assert.equal(filled.products[0].id, 'e');
  const viewed = selectFeed({
    source: 'viewed', fallback: 'best_90', email: 'buyer@b.co', orders, catalog: rows, now, limit: 1,
    behavior: [
      { type: 'product_viewed', email: 'buyer@b.co', productId: 'a', at: new Date(now - day).toISOString() },
      { type: 'added_to_cart', email: 'buyer@b.co', productId: 'extra', at: new Date(now - day).toISOString() },
      { type: 'product_viewed', email: 'buyer@b.co', productId: 'b', at: new Date(now - 100 * day).toISOString() }
    ]
  });
  assert.equal(viewed.products[0].id, 'a1');
  assert.equal(viewed.label, 'Recently viewed');
});

test('quiet hours wait until 11:00 and a transactional text leaves the block off', () => {
  const evening = Date.parse('2026-09-25T20:00:00.000Z');
  const morning = Date.parse('2026-09-25T10:30:00.000Z');
  const open = Date.parse('2026-09-25T15:00:00.000Z');
  assert.equal(quietOpenAt(open, 'UTC'), null);
  assert.equal(new Date(quietOpenAt(evening, 'UTC')).toISOString(), '2026-09-26T11:00:00.000Z');
  assert.equal(new Date(quietOpenAt(morning, 'UTC')).toISOString(), '2026-09-25T11:00:00.000Z');
  assert.equal(smsQuietEnabled({ transactional: false }), true);
  assert.equal(smsQuietEnabled({ transactional: true }), false);
  assert.equal(smsQuietEnabled({ transactional: true, quietHours: true }), true);
  assert.equal(smsQuietEnabled({ transactional: false, quietHours: false }), false);
});

test('one text link is rewritten, one coupon tag is kept, and length warnings follow GSM', () => {
  const linked = rewriteFirstLink('See https://shop.example/a and https://shop.example/b', 'https://jourvance.example/r/abc');
  assert.equal(linked.rewritten, true);
  assert.equal(linked.url, 'https://shop.example/a');
  assert.match(linked.text, /\/r\/abc/);
  assert.match(linked.text, /shop\.example\/b/);
  const draft = smsDraft({ message: linked.text, storeName: 'Hat Shop' });
  assert.match(draft.text, /^Hat Shop: /);
  assert.equal(draft.encoding, 'gsm');
  assert.equal(draft.warning, '');
  const emoji = smsDraft({ message: '😀'.repeat(71), storeName: '' });
  assert.equal(emoji.encoding, 'unicode');
  assert.match(emoji.warning, /70/);
  assert.match(emoji.prefixNote, /store name/);
  const long = smsDraft({ message: 'a'.repeat(161), storeName: '' });
  assert.match(long.warning, /160/);
  const tags = smsCouponPlan("{% coupon_code 'Welcome' %} and {% coupon_code 'Extra' %}");
  assert.equal(tags.first, 'Welcome');
  assert.deepEqual(tags.extra, ['Extra']);
  assert.equal(applySmsCoupon("{% coupon_code 'Welcome' %} {% coupon_code 'Extra' %}", 'Code'), 'Code ');
});

test('a redirect expires after 90 days and a hub pixel is not added', () => {
  const sent = new Date(now).toISOString();
  const row = { url: 'https://shop.example/hat', expiresAt: new Date(now + 90 * day).toISOString(), sentAt: sent };
  assert.equal(redirectStatus(row, now + day), 'ok');
  assert.equal(redirectStatus(row, now + 90 * day), 'expired');
  const target = applyLinkUtm('https://shop.example/hat?utm_source=keep', { utm_source: 'sms', utm_medium: 'sms' });
  assert.match(target, /utm_source=keep/);
  assert.match(target, /utm_medium=sms/);
  const plain = renderLetter({ blocks: [{ kind: 'text', text: 'Hello https://shop.example/hat' }], marketing: false });
  const described = describeSentHtml(plain.html);
  assert.equal(described.pixel, false);
  assert.equal(described.addPixel, false);
  assert.deepEqual(linksToRewrite(plain.html), []);
  const mixed = '<a href="https://click.sendgrid.net/x">x</a><img src="https://sendgrid.net/wf/open" width="1" height="1"><a href="https://shop.example/left">y</a><a href="https://jourvance.example/u/token">u</a>';
  assert.deepEqual(linksToRewrite(mixed), ['https://shop.example/left']);
  assert.equal(describeSentHtml(mixed).addPixel, false);
});

test('last-touch revenue subtracts a refund and ignores an order with no click', () => {
  const events = [
    { type: 'email_clicked', email: 'a@b.co', at: new Date(now - 2 * day).toISOString(), campaignId: 'camp_1' },
    { type: 'email_opened', email: 'b@b.co', at: new Date(now - day).toISOString(), flowId: 'flow_1' },
    { type: 'sms_clicked', email: 'c@b.co', at: new Date(now - day).toISOString(), campaignId: 'camp_sms' },
    { type: 'email_clicked', email: 'd@b.co', at: new Date(now - 8 * day).toISOString(), campaignId: 'old' }
  ];
  const click = lastTouch({ at: now, email: 'a@b.co', events, windows: { emailClickDays: 5, emailOpenDays: 5, smsClickDays: 5 } });
  assert.equal(click.kind, 'email_click');
  assert.equal(click.campaignId, 'camp_1');
  assert.equal(click.windowDays, 5);
  const refunded = { totalPrice: 40, refunds: [{ id: 'r', amount: 10 }] };
  assert.equal(touchRevenue(refunded, click), 30);
  assert.equal(touchRevenue(refunded, null), null);
  const open = lastTouch({ at: now, email: 'b@b.co', events });
  assert.equal(open.kind, 'email_open');
  const text = lastTouch({ at: now, email: 'c@b.co', events });
  assert.equal(text.kind, 'sms_click');
  assert.equal(lastTouch({ at: now, email: 'd@b.co', events }), null);
  const stored = { ...click, revenue: 30 };
  const later = lastTouch({ at: now, email: 'a@b.co', events, windows: { emailClickDays: 1, emailOpenDays: 1, smsClickDays: 1 } });
  assert.equal(later, null);
  assert.equal(stored.revenue, 30);
  assert.equal(stored.windowDays, 5);
  const stats = tallyMessages(
    [{ type: 'email_sent', campaignId: 'camp_1' }, { type: 'email_opened', prefetch: true }],
    [{ emailTouch: { campaignId: 'camp_1', revenue: 30 } }, { totalPrice: 10 }]
  );
  assert.equal(stats.sent, 1);
  assert.equal(stats.delivered, null);
  assert.equal(stats.opened, 1);
  assert.equal(stats.revenue, 30);
  assert.equal(stats.prefetchOpens, 1);
  assert.equal(tallyMessages([], []).clicked, null);
  assert.deepEqual(cleanAttributionWindows({}), { emailClickDays: 5, emailOpenDays: 5, smsClickDays: 5 });
});

test('sunset marks only someone who was sent mail and did not open, and suppression is a separate list', () => {
  const contacts = [
    { email: 'quiet@b.co', properties: {} },
    { email: 'opened@b.co', properties: {} },
    { email: 'never@b.co', properties: {} },
    { email: 'marked@b.co', properties: { unengaged: true } }
  ];
  const events = [
    { type: 'email_sent', email: 'quiet@b.co', at: new Date(now - 40 * day).toISOString(), transactional: false },
    { type: 'email_sent', email: 'opened@b.co', at: new Date(now - 40 * day).toISOString(), transactional: false },
    { type: 'email_opened', email: 'opened@b.co', at: new Date(now - 10 * day).toISOString() }
  ];
  assert.deepEqual(sunsetCandidates({ contacts, events, quietDays: 30, now }), ['quiet@b.co']);
  assert.deepEqual(sunsetCandidates({ contacts, events, quietDays: null, now }), []);
  assert.deepEqual(unengagedEmails(contacts), ['marked@b.co']);
});
