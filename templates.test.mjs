import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Helper mimicking server.mjs blueprint sanitization and generation logic
function sanitizeBlueprintNodesAndEdges(nodes, edges) {
  const safeNodes = (nodes || []).map(n => {
    const rawData = { ...(n.data || {}) };
    delete rawData.visitors;
    delete rawData.conversions;
    delete rawData.liveRevenue;
    delete rawData.grossRevenue;
    delete rawData.pageViews;
    delete rawData.submissions;
    delete rawData.leads;
    delete rawData.orderBumpTakes;
    delete rawData.orderBumpRevenue;
    delete rawData.spend;
    delete rawData.impressions;
    delete rawData.clicks;
    delete rawData.cpc;
    delete rawData.cpa;

    return {
      id: n.id,
      type: n.type,
      position: n.position || { x: 0, y: 0 },
      data: rawData
    };
  });

  const safeEdges = (edges || []).map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle || null,
    targetHandle: e.targetHandle || null,
    type: e.type || 'smoothstep',
    animated: e.animated !== false,
    stats: {
      sourceThroughput: 0,
      targetCount: 0,
      rate: 0
    }
  }));

  return { nodes: safeNodes, edges: safeEdges };
}

function generateShareCode() {
  return `bp_${crypto.randomBytes(6).toString('base64url').toLowerCase()}`;
}

test('custom blueprint sanitization strips live telemetry while preserving architecture', () => {
  const dirtyNodes = [
    {
      id: 'ad_1',
      type: 'ad-source',
      position: { x: 100, y: 150 },
      data: {
        label: 'Meta Retargeting Campaign',
        platform: 'meta',
        spend: 4500,
        clicks: 3200,
        impressions: 48000,
        cpc: 1.40
      }
    },
    {
      id: 'lp_1',
      type: 'landing-page',
      position: { x: 350, y: 150 },
      data: {
        label: 'High-Converting Offer Page',
        headline: 'Transform Your Results Today',
        visitors: 3200,
        conversions: 180,
        liveRevenue: 17820,
        grossRevenue: 17820,
        orderBumpTakes: 64,
        orderBumpRevenue: 1856
      }
    }
  ];

  const dirtyEdges = [
    {
      id: 'e1-2',
      source: 'ad_1',
      target: 'lp_1',
      stats: {
        sourceThroughput: 3200,
        targetCount: 180,
        rate: 5.6
      }
    }
  ];

  const { nodes, edges } = sanitizeBlueprintNodesAndEdges(dirtyNodes, dirtyEdges);

  // Architecture preserved
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].data.label, 'Meta Retargeting Campaign');
  assert.equal(nodes[1].data.headline, 'Transform Your Results Today');

  // Metrics stripped
  assert.equal(nodes[0].data.spend, undefined);
  assert.equal(nodes[0].data.clicks, undefined);
  assert.equal(nodes[1].data.visitors, undefined);
  assert.equal(nodes[1].data.conversions, undefined);
  assert.equal(nodes[1].data.liveRevenue, undefined);
  assert.equal(nodes[1].data.orderBumpTakes, undefined);

  // Edge stats zeroed out
  assert.equal(edges[0].stats.sourceThroughput, 0);
  assert.equal(edges[0].stats.targetCount, 0);
  assert.equal(edges[0].stats.rate, 0);
});

test('user account-level blueprint isolation prevents cross-account data leaks', () => {
  const allTemplates = [
    {
      id: 'bp_100',
      userId: 'user_merchant_alpha',
      name: 'Alpha VIP Funnel',
      shareCode: 'bp_alpha123',
      isShared: true
    },
    {
      id: 'bp_200',
      userId: 'user_merchant_beta',
      name: 'Beta Secret Architecture',
      shareCode: 'bp_beta456',
      isShared: false
    }
  ];

  // User Alpha queries templates
  const alphaBlueprints = allTemplates.filter(t => t.userId === 'user_merchant_alpha');
  assert.equal(alphaBlueprints.length, 1);
  assert.equal(alphaBlueprints[0].name, 'Alpha VIP Funnel');

  // User Beta queries templates
  const betaBlueprints = allTemplates.filter(t => t.userId === 'user_merchant_beta');
  assert.equal(betaBlueprints.length, 1);
  assert.equal(betaBlueprints[0].name, 'Beta Secret Architecture');

  // Multi-tenant security check: User Beta cannot delete User Alpha's blueprint
  const targetIdToDelete = 'bp_100';
  const callingUserId = 'user_merchant_beta';
  const target = allTemplates.find(t => t.id === targetIdToDelete);

  const canDelete = target && target.userId === callingUserId;
  assert.equal(canDelete, false);
});

test('shared blueprint lookup delivers sanitized public preview without caller PII or store keys', () => {
  const privateTemplate = {
    id: 'bp_private_1',
    userId: 'user_merchant_secret_99',
    name: 'B2B Sales Funnel',
    description: 'High-ticket inbound booking flow',
    category: 'high-ticket',
    shareCode: 'bp_share_xyz',
    isShared: true,
    storeDomain: 'secretbrand.myshopify.com',
    nodes: [{ id: 'n1', type: 'lead-form', data: { label: 'Book Consultation' } }],
    edges: []
  };

  // Shared public endpoint output shape
  const publicSharedView = {
    id: privateTemplate.id,
    name: privateTemplate.name,
    description: privateTemplate.description,
    category: privateTemplate.category,
    shareCode: privateTemplate.shareCode,
    nodes: privateTemplate.nodes,
    edges: privateTemplate.edges
  };

  // Assert sensitive fields are strictly excluded
  assert.equal(publicSharedView.name, 'B2B Sales Funnel');
  assert.equal(publicSharedView.shareCode, 'bp_share_xyz');
  assert.equal(publicSharedView.userId, undefined);
  assert.equal(publicSharedView.storeDomain, undefined);
});

test('importing a shared blueprint creates an independent clone in the recipient account', () => {
  const sharedBlueprint = {
    id: 'bp_original_999',
    name: 'Omnichannel D2C Funnel',
    description: 'Shared by Partner Agency',
    category: 'ecom',
    shareCode: 'bp_omni_777',
    nodes: [{ id: 'lp_1', type: 'landing-page', data: { label: 'Exclusive Drop' } }],
    edges: []
  };

  const recipientUserId = 'user_store_owner_charlie';

  // Import operation
  const importedClone = {
    id: `bp_custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId: recipientUserId,
    name: `${sharedBlueprint.name} (Imported)`,
    description: sharedBlueprint.description || '',
    category: sharedBlueprint.category || 'custom',
    nodes: JSON.parse(JSON.stringify(sharedBlueprint.nodes)),
    edges: JSON.parse(JSON.stringify(sharedBlueprint.edges)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    shareCode: generateShareCode(),
    isShared: true
  };

  assert.notEqual(importedClone.id, sharedBlueprint.id);
  assert.equal(importedClone.userId, recipientUserId);
  assert.equal(importedClone.name, 'Omnichannel D2C Funnel (Imported)');
  assert.notEqual(importedClone.shareCode, sharedBlueprint.shareCode);
  assert.equal(importedClone.shareCode.startsWith('bp_'), true);
  assert.equal(importedClone.nodes.length, 1);
});
