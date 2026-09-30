import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orderBumpPriceText, NO_BUMP_PRICE } from './src/lib/orderBumpPrice.ts';
import { renderPublicFunnelHtml } from './server/routes/publicRoutes.mjs';

// C38: with the order bump on and no price, the map card showed '$18' and the editor preview
// '$19.00'. Nobody entered either figure and the published page shows no price at all.
describe('Order bump price shows no invented figure', () => {
  it('names a missing price instead of inventing one', () => {
    assert.equal(orderBumpPriceText(undefined), NO_BUMP_PRICE);
    assert.equal(orderBumpPriceText(''), NO_BUMP_PRICE);
    assert.equal(orderBumpPriceText('   '), NO_BUMP_PRICE);
    assert.equal(orderBumpPriceText(null), NO_BUMP_PRICE);
    assert.equal(NO_BUMP_PRICE, 'No price set');
  });

  it('shows the price the user entered, formatted only when there is one', () => {
    assert.equal(orderBumpPriceText('$24.00'), '$24.00');
    assert.equal(orderBumpPriceText(12), '12');
    const seen = [];
    const fmt = p => { seen.push(p); return `EUR ${p}`; };
    assert.equal(orderBumpPriceText('24.00', fmt), 'EUR 24.00');
    assert.equal(orderBumpPriceText('', fmt), NO_BUMP_PRICE);
    assert.deepEqual(seen, ['24.00'], 'no fallback figure reaches the currency converter');
  });

  it('the card and both editor previews read the price through the helper', () => {
    const card = fs.readFileSync(new URL('./src/components/canvas/nodes/PageNode.tsx', import.meta.url), 'utf8');
    const editor = fs.readFileSync(new URL('./src/components/drawers/PageEditor.tsx', import.meta.url), 'utf8');
    for (const [name, src] of [['PageNode', card], ['PageEditor', editor]]) {
      assert.doesNotMatch(src, /orderBumpPrice\s*\|\|\s*'\$?\d/, `${name} falls back to an invented bump price`);
    }
    assert.match(card, /orderBumpPriceText\(d\.orderBumpPrice\)/);
    assert.equal((editor.match(/orderBumpPriceText\(data\.orderBumpPrice,/g) || []).length, 2, 'modal and page previews');
  });

  it('the published page shows no bump price either, so the preview matches it', () => {
    const html = renderPublicFunnelHtml({
      slug: 'bump-no-price',
      userId: 'usr_test',
      data: { headline: 'Kit', orderBumpEnabled: true, orderBumpTitle: 'Travel case' }
    }, { query: {}, headers: {} });
    assert.ok(html.includes('bump-product-price'), 'the bump renders');
    assert.doesNotMatch(html, /\$18|\$19\.00/);
  });
});
