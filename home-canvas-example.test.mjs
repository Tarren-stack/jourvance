import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeCanvasExample } from './src/components/public/homeCanvasExample.ts';
import { checkConnection } from './src/lib/connectionRules.ts';

test('homepage offer branches use real handles and all buyer choices reach confirmation', () => {
  const { nodes, edges } = createHomeCanvasExample();
  const admitted = [];
  for (const edge of edges) {
    assert.equal(checkConnection(edge, nodes, admitted).kind, 'add', edge.id);
    admitted.push(edge);
  }
  const upsell = nodes.find(node => node.data.offerType === 'upsell');
  const downsell = nodes.find(node => node.data.offerType === 'downsell');
  const confirmation = nodes.find(node => node.type === 'thank-you');
  const offer = nodes.find(node => node.type === 'landing-page');
  const followup = nodes.find(node => node.type === 'follow-up-sequence');
  assert.ok(upsell && downsell && confirmation && offer && followup);
  const destination = (node, handle) => edges.find(edge => edge.source === node.id && edge.sourceHandle === handle)?.target;
  assert.equal(destination(upsell, 'accepted'), confirmation.id);
  assert.equal(destination(upsell, 'declined'), downsell.id);
  assert.equal(destination(downsell, 'accepted'), confirmation.id);
  assert.equal(destination(downsell, 'declined'), confirmation.id);
  assert.ok(edges.some(edge => edge.source === offer.id && edge.target === upsell.id));
  assert.ok(edges.some(edge => edge.source === offer.id && edge.target === followup.id));
  assert.equal(followup.data.klaviyoWhen, 'order_paid');
});

test('demo buyers and revenue reconcile through both add-on branches', () => {
  const { nodes, metrics } = createHomeCanvasExample();
  const measure = id => metrics.nodes[id].measure;
  const offer = measure('demo-offer');
  const upsell = measure('demo-upsell');
  const downsell = measure('demo-downsell');
  assert.equal(upsell.views, offer.conversions);
  assert.equal(upsell.views, upsell.takes + upsell.totalDeclines);
  assert.equal(downsell.views, upsell.totalDeclines);
  assert.equal(downsell.views, downsell.takes + downsell.totalDeclines);
  assert.equal(measure('demo-confirmation').pageViews, upsell.takes + downsell.takes + downsell.totalDeclines);
  assert.equal(measure('demo-followup').flowEnrolled, offer.conversions);
  for (const node of nodes.filter(node => node.type === 'upsell')) {
    const m = measure(node.id);
    const price = Number(node.data.productPrice.replace('$', ''));
    assert.ok(Number.isFinite(price) && price > 0);
    assert.equal(m.attributedRevenue, m.takes * price);
    assert.equal(m.conversionRate, m.takes / m.views * 100);
    for (const handle of ['accepted', 'declined']) {
      const figure = metrics.edges[`${node.id}-${handle === 'accepted' ? 'yes' : 'no'}`];
      assert.equal(figure.count, handle === 'accepted' ? m.takes : m.totalDeclines);
      assert.equal(figure.denominator, m.views);
    }
  }
  assert.equal(measure('demo-ad').attributedRevenue, offer.grossRevenue + upsell.attributedRevenue + downsell.attributedRevenue);
});

test('fictional figures are labeled as demo without a live snapshot or connected resources', () => {
  const { nodes, metrics } = createHomeCanvasExample();
  assert.equal(metrics.view, null);
  for (const node of nodes) {
    assert.match(metrics.nodes[node.id].note, /Demo data/);
    for (const key of ['shopifyProductId', 'shopifyVariantId', 'klaviyoFlowId', 'jourvanceFlowId']) {
      assert.equal(node.data[key], undefined);
    }
  }
  for (const figure of Object.values(metrics.edges)) {
    assert.equal(figure.basis, 'Demo');
    assert.equal(figure.status.status, 'not_graded');
    assert.ok(Number.isFinite(figure.count));
  }
});

test('each homepage example owns its graph and figures', () => {
  const first = createHomeCanvasExample();
  const second = createHomeCanvasExample();
  first.nodes[0].data.headline = 'Changed';
  first.edges.pop();
  first.metrics.nodes['demo-upsell'].measure.takes = 999;
  assert.deepEqual(second, createHomeCanvasExample());
});
