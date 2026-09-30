import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buttonTextForProduct, isEditorFilledButtonText } from './src/lib/productButtonText.ts';

// C21: picking or syncing a product wrote 'Claim 15% VIP Voucher' over whatever the user had typed,
// and the exit-intent inputs showed invented offer copy as if the user had written it.
describe('Page editor writes no invented claims', () => {
  it('keeps the button the user wrote, in either checkout mode', () => {
    assert.equal(buttonTextForProduct('Reserve my set', 'lead-gate', '88.00'), 'Reserve my set');
    assert.equal(buttonTextForProduct('Reserve my set', 'direct', '88.00'), 'Reserve my set');
    assert.equal(buttonTextForProduct('Buy now', 'direct', '88.00'), 'Buy now', 'the placeholder example typed by hand is still the user\'s');
  });

  it('names no offer in lead-gate mode, so the field is left empty for its placeholder', () => {
    assert.equal(buttonTextForProduct('', 'lead-gate', '88.00'), '');
    assert.equal(buttonTextForProduct(undefined, 'lead-gate', '88.00'), '');
    assert.equal(buttonTextForProduct('Claim 15% VIP Voucher', 'lead-gate', '88.00'), '', 'the old invented label is replaced');
    assert.ok(!/%|voucher|vip/i.test(buttonTextForProduct('', 'lead-gate', '88.00')));
  });

  it('fills an empty or editor-filled button with the real price in direct mode', () => {
    assert.equal(buttonTextForProduct('', 'direct', '88.00'), 'Buy now for 88.00');
    assert.equal(buttonTextForProduct('Buy now for 42.00', 'direct', '88.00'), 'Buy now for 88.00');
    assert.equal(buttonTextForProduct('Claim 15% VIP Voucher', undefined, 12), 'Buy now for 12');
    assert.equal(buttonTextForProduct('', 'direct', ''), '', 'no price, no invented one');
  });

  it('tells editor-filled labels from the user\'s', () => {
    assert.equal(isEditorFilledButtonText('  '), true);
    assert.equal(isEditorFilledButtonText('Claim 15% VIP Voucher'), true);
    assert.equal(isEditorFilledButtonText('Buy now for 9.00'), true);
    assert.equal(isEditorFilledButtonText('Get the kit'), false);
  });

  it('recognises the pre-backlog price label, and only a price after the prefix', () => {
    // Journeys saved before the backlog carry 'Buy Now', an em dash, then the price.
    assert.equal(isEditorFilledButtonText('Buy Now \u2014 24.00'), true);
    assert.equal(buttonTextForProduct('Buy Now \u2014 24.00', 'direct', '30.00'), 'Buy now for 30.00');
    assert.equal(buttonTextForProduct('Buy Now \u2014 24.00', 'lead-gate', '30.00'), '');
    assert.equal(isEditorFilledButtonText('Buy now for $1,299.00'), true);
    for (const own of ['Buy now for the holidays', 'Buy now for 2 friends', 'Buy Now \u2014 Fast Checkout']) {
      assert.equal(isEditorFilledButtonText(own), false, own);
      assert.equal(buttonTextForProduct(own, 'direct', '30.00'), own, own);
    }
  });

  it('is wired into both product handlers, and the exit fields use placeholders, not value fallbacks', () => {
    const src = fs.readFileSync(new URL('./src/components/drawers/PageEditor.tsx', import.meta.url), 'utf8');
    assert.ok(!src.includes('15% VIP'), 'no 15% claim anywhere in the page editor');
    assert.equal((src.match(/buttonText: buttonTextForProduct\(data\.buttonText, data\.checkoutMode, /g) || []).length, 2);
    for (const field of ['exitIntentBadge', 'exitIntentHeadline', 'exitIntentSubhead', 'exitIntentButtonText']) {
      assert.ok(src.includes(`value={data.${field} || ''}`), `${field} shows only what the user typed`);
    }
  });

  it('the canvas step names no invented exit gift, and says when the drawer will not publish', () => {
    const src = fs.readFileSync(new URL('./src/components/canvas/nodes/PageNode.tsx', import.meta.url), 'utf8');
    assert.ok(!src.includes("'VIP Voucher'"), 'no invented voucher when no code is set');
    assert.ok(src.includes("'Needs a headline'"), 'an exit drawer without a headline is flagged, since it is not published');
  });
});
