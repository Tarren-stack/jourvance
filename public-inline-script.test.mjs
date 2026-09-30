// Values placed inside a public page's inline scripts must survive any text the
// owner types. escapeHtml inside '...' did not escape a backslash, so a headline or
// button label ending in one escaped the closing quote and the whole page script
// (checkout, pixels, timer, exit drawer) failed to parse.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  renderPublicFunnelHtml,
  renderPublicThankYouHtml,
  renderPublicUpsellHtml
} from './server/routes/publicRoutes.mjs';

const BS = '\\';

function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

function brokenScripts(html) {
  const errors = [];
  for (const s of inlineScripts(html)) {
    try { new vm.Script(s); } catch (e) { errors.push(e.message); }
  }
  return errors;
}

// The value a `const name = <expr>;` line in the page script evaluates to.
function scriptConst(html, name) {
  const m = html.match(new RegExp(`const ${name} = ([^\\n]*);\\n`));
  assert.ok(m, `page script declares ${name}`);
  return vm.runInNewContext(`(${m[1]})`);
}

function decodeAttr(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const funnel = (data, query = {}) => renderPublicFunnelHtml(
  { slug: 'probe', data: { buttonText: 'Buy', ...data }, shopifyConfig: { storeDomain: 'shop.myshopify.com' } },
  { query, headers: {}, params: {} },
  null
);

describe('public page inline scripts', () => {
  it('a headline ending in a backslash keeps every script parseable and reaches the pixels verbatim', () => {
    const headline = `Ends with a backslash ${BS}`;
    const html = funnel({ headline, shopifyVariantId: 'gid://shopify/ProductVariant/123' });
    assert.deepEqual(brokenScripts(html), []);
    assert.ok(html.includes(`item_name: ${JSON.stringify(headline)}`), 'productTitle is a JSON string literal');
  });

  it('a button label, discount code and product title with backslashes, quotes and ampersands round-trip as text', () => {
    const buttonText = `Buy "now" & save ${BS}`;
    const discountCode = `A&B${BS}`;
    const html = funnel({ headline: `C:${BS}new path`, buttonText, discountCode });
    assert.deepEqual(brokenScripts(html), []);
    assert.equal(scriptConst(html, 'defaultButtonText'), buttonText);
    assert.equal(scriptConst(html, 'discountCode'), discountCode);
    // The label is restored with textContent now that it is raw text, never parsed as HTML.
    assert.ok(html.includes('mainCta.textContent = defaultButtonText'));
    assert.ok(!html.includes('mainCta.innerHTML = defaultButtonText'));
  });

  it('a visitor link ending in a backslash cannot break the page script', () => {
    const html = funnel({ headline: 'Hi' }, { ref: `abc${BS}` });
    assert.deepEqual(brokenScripts(html), []);
    assert.equal(scriptConst(html, 'referralCode'), `abc${BS}`);
  });

  it('a script-closing string stays inside its literal', () => {
    const html = funnel({ headline: 'Hi', buttonText: '</script><script>alert(1)</script>' });
    assert.deepEqual(brokenScripts(html), []);
    assert.ok(!html.includes('<script>alert(1)'));
    assert.equal(scriptConst(html, 'defaultButtonText'), '</script><script>alert(1)</script>');
  });

  it('the thank-you copy button copies a code ending in a backslash exactly', () => {
    const code = `SAVE'10${BS}`;
    const html = renderPublicThankYouHtml({ slug: 'ty', data: { thankYou: { bounceBackDiscountCode: code } } }, { query: {}, headers: {} }, null);
    assert.deepEqual(brokenScripts(html), []);
    const m = html.match(/id="jv-copy-btn" onclick="([^"]*)"/);
    assert.ok(m, 'copy button rendered');
    let copied = null;
    const ctx = { navigator: { clipboard: { writeText: (v) => { copied = v; } } }, setTimeout: () => {} };
    vm.runInNewContext(`(function(){ ${decodeAttr(m[1])} }).call({ textContent: '' })`, ctx);
    assert.equal(copied, code);
  });

  it('the upsell page scripts parse with backslash-ended copy', () => {
    const html = renderPublicUpsellHtml(
      { slug: 'up', data: { upsellHeadline: `Upgrade ${BS}`, upsellProductTitle: `Serum ${BS}` }, shopifyConfig: {} },
      { query: {}, headers: {}, params: {} },
      null
    );
    assert.deepEqual(brokenScripts(html), []);
  });
});
