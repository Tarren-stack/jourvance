import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fillMailTokens, normalizeDocument, renderLetter, signUnsubscribe, readUnsubscribe,
  noteSuppression, sendBlockReason, tagOutboundLinks, cleanBlockList, couponPriceRule,
  couponCodeValue, storedCoupon
} from './email-doc.mjs';

test('tokens fill names, checkout alias, and leave unknowns when asked', () => {
  const vars = { first_name: 'Ada', last_name: 'Lovelace', checkout_url: 'https://shop.example/c/1' };
  assert.equal(fillMailTokens('Hi {{ first_name }} {{last_name}}', vars), 'Hi Ada Lovelace');
  assert.equal(fillMailTokens('{{abandoned_checkout_url}}', vars), 'https://shop.example/c/1');
  assert.equal(fillMailTokens('{{order_number}}', vars, true), '{{order_number}}');
  assert.equal(fillMailTokens('{{order_number}}', vars, false), '');
});

test('a flat block list is one section', () => {
  const doc = normalizeDocument([{ kind: 'text', text: 'Hello' }]);
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].columns[0].blocks[0].text, 'Hello');
});

test('marketing footer has the address and unsubscribe link; transactional omits the link', () => {
  const marketing = renderLetter({
    blocks: [{ kind: 'text', text: 'Hello {{first_name}}' }],
    vars: { first_name: 'Ada' },
    physicalAddress: '1 Market St',
    unsubscribeUrl: 'https://jourvance.example/u/abc',
    marketing: true,
    embedPreheader: true,
    previewText: 'A note'
  });
  assert.match(marketing.html, /1 Market St/);
  assert.match(marketing.html, /https:\/\/jourvance\.example\/u\/abc/);
  assert.match(marketing.html, /A note/);
  assert.match(marketing.html, /Hello Ada/);
  const transactional = renderLetter({
    blocks: [{ kind: 'text', text: 'Order' }],
    physicalAddress: '1 Market St',
    unsubscribeUrl: 'https://jourvance.example/u/abc',
    marketing: false
  });
  assert.match(transactional.html, /1 Market St/);
  assert.doesNotMatch(transactional.html, /Unsubscribe/);
});

test('cart links keep the visitor id', () => {
  const tagged = tagOutboundLinks('https://shop.example/cart/1', { visitorId: 'jv_1', sourceSlug: 'page' });
  assert.match(tagged, /utm_source=email/);
  assert.match(tagged, /jv_vid/);
});

test('unsubscribe token round-trips and rejects a bad signature', () => {
  const token = signUnsubscribe('secret', 'uid_1', 'Ada@Example.com');
  assert.deepEqual(readUnsubscribe('secret', token), { uid: 'uid_1', email: 'ada@example.com' });
  assert.equal(readUnsubscribe('other', token), null);
  assert.equal(signUnsubscribe('', 'uid_1', 'ada@example.com'), '');
});

test('seven soft bounces block marketing and a hard bounce blocks every letter', () => {
  let rows = [];
  for (let i = 0; i < 6; i += 1) rows = noteSuppression(rows, 'a@b.co', 'soft_bounce');
  assert.equal(sendBlockReason({ email: 'a@b.co', acceptsMarketing: true }, rows, true), '');
  rows = noteSuppression(rows, 'a@b.co', 'soft_bounce');
  assert.equal(sendBlockReason({ email: 'a@b.co', acceptsMarketing: true }, rows, true), 'soft_bounce');
  assert.equal(sendBlockReason({ email: 'a@b.co', acceptsMarketing: true }, rows, false), '');
  rows = noteSuppression(rows, 'a@b.co', 'hard_bounce');
  assert.equal(sendBlockReason({ email: 'a@b.co', acceptsMarketing: true }, rows, false), 'hard_bounce');
  assert.equal(sendBlockReason({ email: 'a@b.co', acceptsMarketing: false }, [], true), 'unsubscribed');
});

test('text levels, button color, divider, image, and two columns render', () => {
  const letter = renderLetter({
    blocks: [
      { kind: 'heading', text: 'Hello' },
      { kind: 'text', text: 'Note', level: 2, background: '#fff8f0', padding: 8 },
      { kind: 'button', label: 'Shop', url: 'https://shop.example/go', color: '#112233', radius: 2, padding: 8 },
      { kind: 'divider', style: 'dashed', color: '#cccccc', thickness: 2 },
      { kind: 'image', url: 'javascript:alert(1)', alt: 'nope' },
      { kind: 'image', url: 'https://cdn.example/a.png', alt: 'Hat', eventField: 'image' },
      { kind: 'columns', stack: true, columns: [{ blocks: [{ kind: 'text', text: 'Left' }] }, { blocks: [{ kind: 'text', text: 'Right' }] }] },
      { kind: 'spacer', height: 20 },
      { kind: 'social', links: [{ network: 'instagram', url: 'https://instagram.com/shop' }] }
    ],
    event: { image: 'https://cdn.example/from-event.png' },
    embedPreheader: true,
    previewText: 'Preview line'
  });
  assert.match(letter.html, /<h1[^>]*>Hello<\/h1>/);
  assert.match(letter.html, /<h2[^>]*>Note<\/h2>/);
  assert.match(letter.html, /#112233/);
  assert.match(letter.html, /dashed/);
  assert.doesNotMatch(letter.html, /javascript/);
  assert.match(letter.html, /from-event\.png/);
  assert.doesNotMatch(letter.html, /cdn\.example\/a\.png/);
  assert.match(letter.html, /Left/);
  assert.match(letter.html, /Right/);
  assert.match(letter.html, /jv-stack/);
  assert.match(letter.html, /height:20px/);
  assert.match(letter.html, /Instagram/);
  assert.match(letter.html, /Preview line/);
});

test('a line-item table repeats item fields and a product renders only stored fields', () => {
  const letter = renderLetter({
    blocks: [
      { kind: 'table', repeat: 'event.line_items', headers: ['Item', 'Qty'], rows: [['{{ item.title }}', '{{ item.quantity }}']] },
      { kind: 'product', products: [
        { title: 'Hat', price: '12.00', compareAt: '24.00', currency: 'USD', url: 'https://shop.example/hat', buttonLabel: 'View', image: 'https://cdn.example/hat.png' },
        { title: 'Scarf' },
        { title: 'P3' }, { title: 'P4' }, { title: 'P5' }, { title: 'P6' }, { title: 'P7' }, { title: 'P8' }, { title: 'P9' }, { title: 'P10' }
      ] }
    ],
    event: { line_items: [{ title: 'Gold', quantity: 2 }, { title: 'Everyone', quantity: 1 }] }
  });
  assert.match(letter.html, /Gold/);
  assert.match(letter.html, /Everyone/);
  assert.match(letter.html, /line-through/);
  assert.match(letter.html, /12\.00 USD/);
  assert.match(letter.html, /View/);
  assert.doesNotMatch(letter.html, /P10/);
  assert.equal(letter.document.sections[0].columns[0].blocks[1].products.length, 9);
  assert.doesNotMatch(letter.html.split('Scarf')[1] || '', /\$0/);
});

test('a product and a coupon can open this account’s page with the visitor id', () => {
  const letter = renderLetter({
    blocks: [
      { kind: 'product', pageSlug: 'wave-4', products: [{ title: 'Hat', url: 'https://shop.example/hat', buttonLabel: 'View' }] },
      { kind: 'coupon', name: 'Welcome', discountType: 'percentage', value: 10, prefix: 'WELCOME', pageSlug: 'wave-4' }
    ],
    previewCoupons: true,
    pageBase: 'http://localhost:3005',
    ownedSlugs: ['wave-4'],
    visitorId: 'jv_abc123',
    marketing: false
  });
  assert.match(letter.html, /http:\/\/localhost:3005\/p\/wave-4\?jv_vid=jv_abc123/);
  assert.match(letter.html, /Open the page/);
  assert.doesNotMatch(letter.html, /shop\.example\/hat/);
  const other = renderLetter({
    blocks: [{ kind: 'product', pageSlug: 'theirs', products: [{ title: 'Hat', url: 'https://shop.example/hat', buttonLabel: 'View' }] }],
    pageBase: 'http://localhost:3005',
    ownedSlugs: ['wave-4'],
    visitorId: 'jv_abc123',
    marketing: false
  });
  assert.match(other.html, /shop\.example\/hat/);
  assert.doesNotMatch(other.html, /\/p\/theirs/);
});

test('show, hide, and a conflict decide the block before a coupon is counted', () => {
  const hidden = renderLetter({
    blocks: [{ kind: 'coupon', name: 'Welcome', discountType: 'percentage', value: 10, prefix: 'WELCOME', display: { show: { join: 'all', clauses: [{ kind: 'profile', field: 'vip', op: 'eq', value: 'yes' }] } } }],
    showContext: { profile: {}, properties: {}, event: {} },
    previewCoupons: true
  });
  assert.equal(hidden.hidden, 1);
  assert.deepEqual(hidden.couponsNeeded, []);
  assert.doesNotMatch(hidden.html, /Code/);
  const conflict = renderLetter({
    blocks: [{ kind: 'text', text: 'Secret', display: {
      show: { join: 'all', clauses: [{ kind: 'profile', field: 'vip', op: 'eq', value: 'yes' }] },
      hide: { join: 'any', clauses: [{ kind: 'profile', field: 'vip', op: 'eq', value: 'yes' }] }
    } }],
    showContext: { profile: { vip: 'yes' }, properties: { vip: 'yes' }, event: {} }
  });
  assert.doesNotMatch(conflict.html, /Secret/);
  const either = renderLetter({
    blocks: [{ kind: 'text', text: 'Shown', display: { show: { join: 'any', clauses: [
      { kind: 'profile', field: 'vip', op: 'eq', value: 'yes' },
      { kind: 'profile', field: 'tier', op: 'eq', value: 'gold' }
    ] } } }],
    showContext: { profile: { tier: 'gold' }, properties: { tier: 'gold' }, event: {} }
  });
  assert.match(either.html, /Shown/);
});

test('template tags fill, and unrecognized tags are removed and listed', () => {
  const letter = renderLetter({
    blocks: [
      { kind: 'text', text: "{% if first_name == 'Ada' %}Yes{% elif first_name %}No{% else %}None{% endif %} {{ nickname | default: 'there' }}" },
      { kind: 'text', text: "{% for item in event.line_items %}{{ item.title }} {% endfor %}" },
      { kind: 'html', text: '<p>{{ person|lookup:\'Favorite Color\' }}</p><script>alert(1)</script><b onclick="x">Hi</b> {{ email | md5_hash }} {% current_year %}' }
    ],
    vars: { first_name: 'Ada', email: 'ada@example.com' },
    person: { 'Favorite Color': 'green', email: 'ada@example.com' },
    event: { line_items: [{ title: 'Gold' }, { title: 'Everyone' }] }
  });
  assert.match(letter.html, /Yes/);
  assert.match(letter.html, /there/);
  assert.match(letter.html, /Gold/);
  assert.match(letter.html, /Everyone/);
  assert.match(letter.html, /green/);
  assert.doesNotMatch(letter.html, /<script/);
  assert.doesNotMatch(letter.html, /onclick/);
  assert.doesNotMatch(letter.html, /md5_hash/);
  assert.doesNotMatch(letter.html, /ada@example.com/);
  assert.ok(letter.untranslated.includes('md5_hash'));
  assert.ok(letter.untranslated.includes('current_year'));
});

test('catalog misses render nothing and a coupon preview does not request a code', () => {
  const letter = renderLetter({
    blocks: [
      { kind: 'text', text: '{% catalog 999 %}{% catalog 1 %}' },
      { kind: 'coupon', name: 'Welcome', discountType: 'percentage', value: 10, prefix: 'WELCOME' },
      { kind: 'text', text: "{% coupon_code 'Welcome' %}{% coupon_code 'Missing' %}" }
    ],
    catalog: { '1': { title: 'Hat', price: '12.00', url: 'https://shop.example/hat', image: 'https://cdn.example/hat.png' } },
    previewCoupons: true
  });
  assert.match(letter.html, /Hat/);
  assert.match(letter.html, /Code/);
  assert.doesNotMatch(letter.html, /999/);
  assert.deepEqual(letter.couponsNeeded, []);
  assert.ok(letter.untranslated.some((name) => name.includes('Missing')));
  const send = renderLetter({
    blocks: [{ kind: 'coupon', name: 'Welcome', discountType: 'percentage', value: 10, prefix: 'WELCOME' }],
    previewCoupons: false
  });
  assert.deepEqual(send.couponsNeeded, ['Welcome']);
  assert.match(send.html, /A code was not created/);
  const minted = renderLetter({
    blocks: [{ kind: 'coupon', name: 'Welcome', discountType: 'percentage', value: 10 }],
    coupons: { Welcome: 'WELCOME-ABCD' },
    previewCoupons: false
  });
  assert.match(minted.html, /WELCOME-ABCD/);
  assert.deepEqual(minted.couponsNeeded, []);
});

test('video is a linked thumbnail, and coupon rules are ready for Shopify', () => {
  const letter = renderLetter({
    blocks: [{ kind: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }]
  });
  assert.match(letter.html, /i\.ytimg\.com\/vi\/dQw4w9WgXcQ/);
  assert.match(letter.html, /youtube\.com\/watch/);
  assert.doesNotMatch(letter.html, /<iframe/);
  assert.doesNotMatch(letter.html, /<video/);
  assert.equal(couponPriceRule({ name: 'Welcome', discountType: 'percentage', value: 10 }).value, '-10');
  assert.equal(couponPriceRule({ name: 'Ship', discountType: 'free_shipping' }).target_type, 'shipping_line');
  assert.equal(couponPriceRule({ name: 'Five', discountType: 'fixed_amount', value: 5 }).value, '-5.00');
  assert.equal(couponPriceRule({ name: 'Zero', discountType: 'percentage', value: 0 }), null);
  assert.match(couponCodeValue('welcome'), /^WELCOME-[A-Z0-9]+$/);
  assert.equal(storedCoupon([{ email: 'a@b.co', name: 'Welcome', code: 'WELCOME-1' }], 'A@B.co', 'Welcome'), 'WELCOME-1');
  assert.equal(storedCoupon([{ email: 'a@b.co', name: 'Welcome', code: 'WELCOME-1' }], 'a@b.co', 'Other'), '');
  const cleaned = cleanBlockList([{ kind: 'html', text: '<script>no</script><p>Ok</p>' }]);
  assert.equal(cleaned[0].kind, 'html');
});

test('a product feed does not keep a typed product list, and sunset blocks marketing', () => {
  const doc = normalizeDocument([{ kind: 'product', mode: 'feed', feed: { source: 'viewed' }, products: [{ title: 'Sample hat', price: '10' }] }]);
  const block = doc.sections[0].columns[0].blocks[0];
  assert.equal(block.mode, 'feed');
  assert.equal(block.feed.source, 'viewed');
  assert.equal(block.products.length, 0);
  const ready = normalizeDocument([{ kind: 'product', mode: 'feed', feedReady: true, feedLabel: 'This checkout', products: [{ title: 'Bag', price: '12.00' }] }]);
  const letter = renderLetter({ blocks: ready });
  assert.match(letter.html, /From this checkout/);
  assert.match(letter.html, /Bag/);
  const rows = noteSuppression([], 'a@b.co', 'sunset');
  assert.equal(sendBlockReason({ email: 'a@b.co', acceptsMarketing: true }, rows, true), 'unsubscribed');
  assert.equal(sendBlockReason({ email: 'a@b.co', acceptsMarketing: true }, rows, false), '');
});
