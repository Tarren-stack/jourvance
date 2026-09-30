// C46: the sequence editor's "Pre-built Sequence Blueprints" wrote invented offers ($10 gift,
// 10% and 15% credits), invented claims ("our clinical team noticed") and voucher codes the
// store may not have (REVIEW10, SAVE10, WELCOMEBACK15, COMPLETE10) into the person's emails,
// plus an em dash in the winback subject. The preview and both exports also filled an empty
// code with SAVE10. Presets now write "Replace this" drafts and never set a code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sequencePreset, fillVoucherCode, PRESET_DRAFT_PREVIEW } from './src/lib/sequencePresets.ts';

const TYPES = ['vip-welcome', 'cart-recovery', 'upsell-recovery', 'winback', 'review-request'];
const INVENTED = /\$\s?\d|\d+\s?%|REVIEW10|SAVE10|WELCOMEBACK15|COMPLETE10|clinical|visible results|VIP credit|courtesy|privilege|held for you|reserv/i;
const DASH = /—|\s–\s/;

test('every preset writes Replace-this drafts with no offer, claim, code or dash', () => {
  for (const type of TYPES) {
    const p = sequencePreset(type, 1);
    assert.ok(Array.isArray(p.steps) && p.steps.length > 0, type);
    assert.equal('voucherCode' in p, false, `${type} must not set a voucher code`);
    for (const step of p.steps) {
      for (const text of [step.subject, step.previewText, step.body]) {
        assert.doesNotMatch(text, INVENTED, `${type}: ${text}`);
        assert.doesNotMatch(text, DASH, `${type}: ${text}`);
        assert.doesNotMatch(text, /\[Voucher Code\]/, `${type}: a draft names no code`);
      }
      assert.equal(step.previewText, PRESET_DRAFT_PREVIEW);
      assert.match(step.body, /Replace this/);
      assert.match(step.body, /^Hi \[First Name\],/);
    }
  }
});

test('presets keep their structure: step count, timing, links and retention flags', () => {
  const review = sequencePreset('review-request', 5);
  assert.equal(review.sequenceType, 'fulfillment_review');
  assert.equal(review.delayHours, 168);
  assert.equal(review.smartExitOnPurchase, false);
  assert.deepEqual(review.steps.map(s => s.delay), ['7 Days (168h)', '3 Days (72h)']);
  assert.ok(review.steps.every(s => s.body.includes('[Review Link]')));
  assert.deepEqual(review.steps.map(s => s.id), ['step-5-1', 'step-5-2']);

  const upsell = sequencePreset('upsell-recovery', 5);
  assert.equal(upsell.sequenceType, 'upsell_recovery');
  assert.equal(upsell.delayHours, 18);
  assert.ok(upsell.steps.every(s => s.body.includes('[Offer Link]')));

  const winback = sequencePreset('winback', 5);
  assert.equal(winback.sequenceType, 'at_risk_winback');
  assert.equal(winback.steps.length, 1);

  const cart = sequencePreset('cart-recovery', 5);
  assert.equal(cart.sequenceType, 'checkout_recovery');
  assert.equal(cart.delayHours, 1);
  assert.ok(cart.steps.every(s => s.body.includes('[Checkout Link]')));

  const welcome = sequencePreset('vip-welcome', 5);
  assert.equal(welcome.isRetentionBranch, false);
  assert.equal(welcome.steps.length, 3);
  assert.equal('delayHours' in welcome, false);
});

test('fillVoucherCode fills only a code the person set, and never invents one', () => {
  assert.equal(fillVoucherCode('Use [Voucher Code] today', 'SPRING'), 'Use SPRING today');
  assert.equal(fillVoucherCode('Use [Voucher Code] or [Voucher Code]', 'A1'), 'Use A1 or A1');
  assert.equal(fillVoucherCode('Use [Voucher Code] today', ''), 'Use [Voucher Code] today');
  assert.equal(fillVoucherCode('Use [Voucher Code] today', undefined), 'Use [Voucher Code] today');
  assert.equal(fillVoucherCode('Use [Voucher Code] today', '   '), 'Use [Voucher Code] today');
});

test('the sequence editor uses the presets and has no SAVE10 fallback, offer label or em dash', () => {
  const src = readFileSync(new URL('./src/components/drawers/SequenceEditor.tsx', import.meta.url), 'utf8');
  assert.match(src, /sequencePreset\(type\)/);
  assert.doesNotMatch(src, /voucherCode \|\| '[^']/, 'no invented fallback code');
  assert.doesNotMatch(src, /REVIEW10|WELCOMEBACK15|COMPLETE10/);
  assert.doesNotMatch(src, /\$10|15% VIP|clinical team|Claim Courtesy Reservation/);
  assert.doesNotMatch(src, DASH);
  // The preview and both exports fill the code through the one helper.
  assert.equal((src.match(/fillVoucherCode\(/g) || []).length >= 4, true);
});
