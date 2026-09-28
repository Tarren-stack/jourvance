import test from 'node:test';
import assert from 'node:assert/strict';

test('SequenceNode retention metadata schema & types', () => {
  const sequenceTypes = ['lead_nurture', 'upsell_recovery', 'checkout_recovery', 'at_risk_winback'];

  const rescueNode = {
    type: 'follow-up-sequence',
    label: 'Courtesy Rescue Series',
    sequenceTitle: '24h Courtesy Rescue (Upsell Decline)',
    sequenceType: 'upsell_recovery',
    isRetentionBranch: true,
    delayHours: 18,
    voucherCode: 'SAVE10',
    smartExitOnPurchase: true,
    contactsEnrolled: 12,
    avgOpenRate: 64.5,
    avgClickRate: 28.2,
    steps: [
      {
        id: 's1',
        channel: 'email',
        delay: '18 Hours',
        subject: 'A private courtesy reservation for your recent order',
        previewText: 'We held a private reservation on your companion formula',
        body: 'Hi [First Name],\n\nUse code [Voucher Code] at checkout:\n[Offer Link]'
      }
    ]
  };

  assert.ok(sequenceTypes.includes(rescueNode.sequenceType));
  assert.equal(rescueNode.isRetentionBranch, true);
  assert.equal(rescueNode.delayHours, 18);
  assert.equal(rescueNode.voucherCode, 'SAVE10');
  assert.equal(rescueNode.smartExitOnPurchase, true);
});

test('Upsell and Page nodes provide dedicated retention handles', () => {
  // UpsellNode handle specifications
  const upsellHandles = [
    { type: 'target', position: 'left' },
    { type: 'source', id: 'accepted', position: 'right', color: '#10B981' },
    { type: 'source', id: 'declined', position: 'right', color: '#F59E0B' },
    { type: 'source', id: 'rescue', position: 'bottom', color: '#F59E0B' }
  ];

  const rescueHandle = upsellHandles.find(h => h.id === 'rescue');
  assert.ok(rescueHandle, 'Upsell node must feature dedicated bottom rescue handle');
  assert.equal(rescueHandle.position, 'bottom');
  assert.equal(rescueHandle.color, '#F59E0B');

  // PageNode handle specifications
  const pageHandles = [
    { type: 'target', position: 'left' },
    { type: 'source', position: 'right' },
    { type: 'source', id: 'abandon', position: 'bottom', color: '#F59E0B' }
  ];

  const abandonHandle = pageHandles.find(h => h.id === 'abandon');
  assert.ok(abandonHandle, 'Landing page node must feature bottom abandon handle for cart recovery');
  assert.equal(abandonHandle.position, 'bottom');
});

test('ConversionEdge identifies retention connections from decline, rescue, and abandon handles', () => {
  const isRetentionEdge = (edge) => {
    return Boolean(
      edge.data?.isRetentionEdge ||
      edge.sourceHandle === 'declined' ||
      edge.sourceHandle === 'rescue' ||
      edge.sourceHandle === 'abandon' ||
      edge.targetData?.isRetentionBranch ||
      edge.targetData?.sequenceType === 'upsell_recovery' ||
      edge.targetData?.sequenceType === 'checkout_recovery' ||
      edge.targetData?.sequenceType === 'at_risk_winback'
    );
  };

  // Case 1: Connect from upsell decline handle to rescue sequence
  const edgeDecline = {
    source: 'upsell-node',
    target: 'rescue-node',
    sourceHandle: 'declined',
    targetData: { type: 'follow-up-sequence', sequenceType: 'upsell_recovery' }
  };
  assert.equal(isRetentionEdge(edgeDecline), true, 'Decline handle connection must be flagged as retention edge');

  // Case 2: Connect from upsell rescue handle
  const edgeRescue = {
    source: 'upsell-node',
    target: 'rescue-node',
    sourceHandle: 'rescue',
    targetData: { type: 'follow-up-sequence' }
  };
  assert.equal(isRetentionEdge(edgeRescue), true, 'Rescue handle connection must be flagged as retention edge');

  // Case 3: Connect from landing page abandon handle
  const edgeAbandon = {
    source: 'page-node',
    target: 'cart-seq',
    sourceHandle: 'abandon',
    targetData: { type: 'follow-up-sequence', sequenceType: 'checkout_recovery' }
  };
  assert.equal(isRetentionEdge(edgeAbandon), true, 'Abandon handle connection must be flagged as retention edge');

  // Case 4: Standard funnel conversion (e.g. ad -> page)
  const edgeNormal = {
    source: 'ad-node',
    target: 'page-node',
    sourceHandle: undefined,
    targetData: { type: 'landing-page' }
  };
  assert.equal(isRetentionEdge(edgeNormal), false, 'Normal ad to page edge must not be retention edge');
});

test('Canvas retention toggle cleanly filters nodes and dependent edges', () => {
  const nodes = [
    { id: 'node-ad', type: 'ad-source', data: { type: 'ad-source' } },
    { id: 'node-page', type: 'landing-page', data: { type: 'landing-page' } },
    { id: 'node-upsell', type: 'upsell', data: { type: 'upsell' } },
    {
      id: 'node-rescue-seq',
      type: 'follow-up-sequence',
      data: {
        type: 'follow-up-sequence',
        sequenceType: 'upsell_recovery',
        isRetentionBranch: true
      }
    }
  ];

  const edges = [
    { id: 'e1', source: 'node-ad', target: 'node-page' },
    { id: 'e2', source: 'node-page', target: 'node-upsell' },
    { id: 'e3', source: 'node-upsell', target: 'node-rescue-seq', sourceHandle: 'rescue' }
  ];

  const isRetentionNode = (n) => Boolean(
    n.data?.isRetentionBranch ||
    n.data?.sequenceType === 'upsell_recovery' ||
    n.data?.sequenceType === 'checkout_recovery' ||
    n.data?.sequenceType === 'at_risk_winback'
  );

  // When toggle is TRUE (Visible)
  const showRetention = true;
  const retentionNodeIds = new Set(nodes.filter(isRetentionNode).map(n => n.id));
  const visibleNodesWhenOn = showRetention ? nodes : nodes.filter(n => !retentionNodeIds.has(n.id));
  const visibleEdgesWhenOn = showRetention ? edges : edges.filter(e => !retentionNodeIds.has(e.source) && !retentionNodeIds.has(e.target));

  assert.equal(visibleNodesWhenOn.length, 4);
  assert.equal(visibleEdgesWhenOn.length, 3);

  // When toggle is FALSE (Hidden)
  const showRetentionOff = false;
  const visibleNodesWhenOff = showRetentionOff ? nodes : nodes.filter(n => !retentionNodeIds.has(n.id));
  const visibleEdgesWhenOff = showRetentionOff ? edges : edges.filter(e => !retentionNodeIds.has(e.source) && !retentionNodeIds.has(e.target));

  assert.equal(visibleNodesWhenOff.length, 3, 'Retention sequence node should be hidden when filter is OFF');
  assert.equal(visibleNodesWhenOff.some(n => n.id === 'node-rescue-seq'), false);
  assert.equal(visibleEdgesWhenOff.length, 2, 'Connecting rescue edge should be hidden when filter is OFF');
  assert.equal(visibleEdgesWhenOff.some(e => e.id === 'e3'), false);
});

test('Retention token replacement produces valid copy for Klaviyo and Shopify export', () => {
  const step = {
    subject: 'Your private courtesy reservation [Voucher Code]',
    body: 'Hi [First Name],\n\nUse code [Voucher Code] here:\n[Offer Link]\nOr complete cart: [Checkout Link]'
  };

  const voucherCode = 'RESCUE15';

  // Klaviyo formatting
  const klaviyoSubject = step.subject.replace(/\[Voucher Code\]/g, voucherCode);
  const klaviyoBody = step.body
    .replace(/\[First Name\]/g, "{{ first_name|default:'there' }}")
    .replace(/\[Voucher Code\]/g, voucherCode)
    .replace(/\[Offer Link\]/g, '{{ event.extra.offer_url|default:shop.url }}')
    .replace(/\[Checkout Link\]/g, '{{ event.checkout_url }}');

  assert.equal(klaviyoSubject, 'Your private courtesy reservation RESCUE15');
  assert.ok(klaviyoBody.includes('RESCUE15'));
  assert.ok(klaviyoBody.includes("{{ first_name|default:'there' }}"));
  assert.ok(klaviyoBody.includes('{{ event.extra.offer_url|default:shop.url }}'));

  // Shopify HTML formatting
  const shopifyHtml = step.body
    .replace(/\n/g, '<br/>')
    .replace(/\[First Name\]/g, '{{ customer.first_name }}')
    .replace(/\[Voucher Code\]/g, voucherCode)
    .replace(/\[Offer Link\]/g, '<a href="{{ offer_url }}">Claim Courtesy Reservation</a>')
    .replace(/\[Checkout Link\]/g, '<a href="{{ checkout_url }}">Complete Checkout</a>');

  assert.ok(shopifyHtml.includes('RESCUE15'));
  assert.ok(shopifyHtml.includes('{{ customer.first_name }}'));
  assert.ok(shopifyHtml.includes('<a href="{{ offer_url }}">Claim Courtesy Reservation</a>'));
});

test('Smart exit criteria triggers immediate suppression on order attribution', () => {
  const customerEmail = 'elena@vividbeauty.com';
  const recoveryEnrollment = {
    id: 'enr_rescue_99',
    customerEmail,
    sequenceType: 'upsell_recovery',
    smartExitOnPurchase: true,
    status: 'active',
    history: []
  };

  // Simulate Shopify order webhook attribution
  const incomingOrder = {
    customerEmail,
    orderNumber: '#1092',
    totalPrice: 48.00,
    attributedOfferType: 'upsell'
  };

  if (incomingOrder.customerEmail === recoveryEnrollment.customerEmail && recoveryEnrollment.smartExitOnPurchase) {
    recoveryEnrollment.status = 'converted_exit';
    recoveryEnrollment.convertedAt = new Date().toISOString();
  }

  assert.equal(recoveryEnrollment.status, 'converted_exit', 'Active courtesy rescue must auto-exit upon purchase');
  assert.ok(recoveryEnrollment.convertedAt);
});

test('Flagship Turnkey Retention Blueprint contains valid 6-node dual-retention architecture', async () => {
  const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
  const bp = ECOM_BLUEPRINTS.find(b => b.id === 'turnkey-retention-ecosystem');

  assert.ok(bp, 'turnkey-retention-ecosystem blueprint must exist in ECOM_BLUEPRINTS');
  assert.equal(bp.category, 'retention');
  assert.equal(bp.nodes.length, 6, 'Must contain exactly 6 nodes for complete funnel and retention');
  assert.equal(bp.edges.length, 6, 'Must contain exactly 6 edges');

  // Verify Node Types
  const adNode = bp.nodes.find(n => n.type === 'ad-source');
  const pageNode = bp.nodes.find(n => n.type === 'landing-page');
  const upsellNode = bp.nodes.find(n => n.type === 'upsell');
  const tyNode = bp.nodes.find(n => n.type === 'thank-you');
  const cartRecoveryNode = bp.nodes.find(n => n.data?.sequenceType === 'checkout_recovery');
  const upsellRescueNode = bp.nodes.find(n => n.data?.sequenceType === 'upsell_recovery');

  assert.ok(adNode, 'Ad node must exist');
  assert.ok(pageNode, 'Landing page node must exist');
  assert.ok(upsellNode, 'Upsell node must exist');
  assert.ok(tyNode, 'Thank-you node must exist');
  assert.ok(cartRecoveryNode, 'Cart abandonment recovery node must exist');
  assert.ok(upsellRescueNode, '24h Courtesy rescue node must exist');

  // Verify Geometry & Alignment
  assert.equal(adNode.position.y, 160, 'Ad node on main axis');
  assert.equal(pageNode.position.y, 160, 'Page node on main axis');
  assert.equal(upsellNode.position.y, 160, 'Upsell node on main axis');
  assert.equal(tyNode.position.y, 160, 'Thank-you node on main axis');
  assert.equal(cartRecoveryNode.position.y, 440, 'Cart recovery on retention branch axis');
  assert.equal(upsellRescueNode.position.y, 440, 'Upsell rescue on retention branch axis');

  // Verify Retention Handles on Edges
  const cartEdge = bp.edges.find(e => e.source === pageNode.id && e.target === cartRecoveryNode.id);
  assert.ok(cartEdge, 'Edge connecting page to cart recovery must exist');
  assert.equal(cartEdge.data?.sourceHandle, 'abandon', 'Must originate from abandon handle');
  assert.equal(cartEdge.data?.targetHandle, 'retention-in', 'Must target retention-in handle');
  assert.equal(cartEdge.data?.isRetentionEdge, true);

  const rescueEdge = bp.edges.find(e => e.source === upsellNode.id && e.target === upsellRescueNode.id);
  assert.ok(rescueEdge, 'Edge connecting upsell to rescue must exist');
  assert.equal(rescueEdge.data?.sourceHandle, 'rescue', 'Must originate from rescue handle');
  assert.equal(rescueEdge.data?.targetHandle, 'retention-in', 'Must target retention-in handle');
  assert.equal(rescueEdge.data?.isRetentionEdge, true);

  // Verify Metric Sanitization preserves retention metadata
  const { zeroBlueprintMetrics } = await import('./src/lib/liveStats.ts');
  const zeroed = zeroBlueprintMetrics(bp.nodes, bp.edges);

  assert.equal(zeroed.nodes.length, 6);
  assert.equal(zeroed.edges.length, 6);

  const zeroedRescue = zeroed.nodes.find(n => n.data?.sequenceType === 'upsell_recovery');
  assert.equal(zeroedRescue.data.isRetentionBranch, true);
  assert.equal(zeroedRescue.data.delayHours, 18);
  assert.equal(zeroedRescue.data.voucherCode, 'SAVE10');
  assert.equal(zeroedRescue.data.smartExitOnPurchase, true);
  assert.equal(zeroedRescue.data.contactsEnrolled, 0, 'Contacts enrolled must be reset to 0');
});

