import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RFM_CONFIG,
  cleanRfmConfig,
  computeContactRfm,
  syncContactRfmTags,
  syncAllContactsRfm
} from './rfm-engine.mjs';

test('Option B: cleanRfmConfig applies defaults and clamps valid ranges', () => {
  const defaults = cleanRfmConfig(null);
  assert.equal(defaults.atRiskDays, 90);
  assert.equal(defaults.lapsedDays, 180);
  assert.equal(defaults.vipSilver, 100);
  assert.equal(defaults.vipGold, 250);
  assert.equal(defaults.vipPlatinum, 500);

  const custom = cleanRfmConfig({ atRiskDays: 60, vipPlatinum: 600 });
  assert.equal(custom.atRiskDays, 60);
  assert.equal(custom.vipPlatinum, 600);
  assert.equal(custom.vipGold, 250);
});

test('Option B: computeContactRfm classifies prospects with 0 orders', () => {
  const contact = { ordersCount: 0, totalSpent: 0 };
  const rfm = computeContactRfm(contact);

  assert.equal(rfm.tier, 'prospect');
  assert.equal(rfm.badge, 'Lead');
  assert.equal(rfm.isVip, false);
  assert.equal(rfm.recencyDays, null);
});

test('Option B: computeContactRfm identifies active VIP Whale (Platinum) at $500+', () => {
  const contact = {
    ordersCount: 3,
    totalSpent: 520.00,
    lastOrderAt: new Date(Date.now() - 10 * 86400000).toISOString() // 10 days ago
  };
  const rfm = computeContactRfm(contact);

  assert.equal(rfm.tier, 'whale');
  assert.equal(rfm.badge, 'VIP Platinum');
  assert.equal(rfm.segment, 'VIP Whale (Platinum)');
  assert.equal(rfm.isPlatinum, true);
  assert.equal(rfm.isVip, true);
  assert.equal(rfm.isAtRisk, false);
  assert.equal(rfm.recencyDays, 10);
});

test('Option B: computeContactRfm classifies VIP Gold at $250+', () => {
  const contact = {
    ordersCount: 2,
    totalSpent: 280.00,
    lastOrderAt: new Date(Date.now() - 25 * 86400000).toISOString()
  };
  const rfm = computeContactRfm(contact);

  assert.equal(rfm.tier, 'gold');
  assert.equal(rfm.badge, 'VIP Gold');
  assert.equal(rfm.isGold, true);
  assert.equal(rfm.isVip, true);
});

test('Option B: computeContactRfm classifies VIP Silver at $100+', () => {
  const contact = {
    ordersCount: 1,
    totalSpent: 125.00,
    lastOrderAt: new Date(Date.now() - 15 * 86400000).toISOString()
  };
  const rfm = computeContactRfm(contact);

  assert.equal(rfm.tier, 'silver');
  assert.equal(rfm.badge, 'VIP Silver');
  assert.equal(rfm.isSilver, true);
});

test('Option B: computeContactRfm detects At-Risk VIPs when inactive for 90+ days', () => {
  const contact = {
    ordersCount: 4,
    totalSpent: 650.00,
    lastOrderAt: new Date(Date.now() - 95 * 86400000).toISOString() // 95 days ago
  };
  const rfm = computeContactRfm(contact);

  assert.equal(rfm.isPlatinum, true);
  assert.equal(rfm.isAtRisk, true);
  assert.equal(rfm.isLapsed, false);
  assert.equal(rfm.tier, 'at_risk');
  assert.equal(rfm.badge, 'At-Risk Whale');
  assert.equal(rfm.segment, 'At-Risk VIP Whale');
});

test('Option B: computeContactRfm respects user-defined custom at-risk threshold', () => {
  const contact = {
    ordersCount: 2,
    totalSpent: 180.00,
    lastOrderAt: new Date(Date.now() - 65 * 86400000).toISOString() // 65 days ago
  };

  // Default config (90 days) -> Not at risk yet
  const rfmDefault = computeContactRfm(contact, DEFAULT_RFM_CONFIG);
  assert.equal(rfmDefault.isAtRisk, false);

  // Custom user config (60 days) -> Marked at risk
  const rfmCustom = computeContactRfm(contact, { atRiskDays: 60 });
  assert.equal(rfmCustom.isAtRisk, true);
  assert.equal(rfmCustom.badge, 'At-Risk');
});

test('Option B: syncContactRfmTags synchronizes tags and preserves custom tags', () => {
  const contact = {
    name: 'Elena Rostova',
    email: 'elena@luxeaesthetics.com',
    ordersCount: 3,
    totalSpent: 550.00,
    lastOrderAt: new Date(Date.now() - 12 * 86400000).toISOString(),
    tags: ['Shopify Buyer', 'Order Bump Taker', 'VIP-Silver'] // Has old Silver tag
  };

  const rfm = computeContactRfm(contact);
  const changed = syncContactRfmTags(contact, rfm);

  assert.equal(changed, true, 'Tags should have updated');
  assert.ok(contact.tags.includes('VIP-Platinum'), 'Must add VIP-Platinum');
  assert.ok(contact.tags.includes('VIP Customer'), 'Must add VIP Customer');
  assert.ok(contact.tags.includes('Repeat Buyer'), 'Must add Repeat Buyer');
  assert.ok(contact.tags.includes('Shopify Buyer'), 'Must retain Shopify Buyer');
  assert.ok(contact.tags.includes('Order Bump Taker'), 'Must retain Order Bump Taker');
  assert.equal(contact.tags.includes('VIP-Silver'), false, 'Must remove stale VIP-Silver tag');
});

test('Option B: syncAllContactsRfm processes audience batch and returns accurate breakdown', () => {
  const contacts = [
    { email: 'c1@example.com', ordersCount: 5, totalSpent: 750, lastOrderAt: new Date(Date.now() - 10 * 86400000).toISOString(), tags: [] },
    { email: 'c2@example.com', ordersCount: 2, totalSpent: 300, lastOrderAt: new Date(Date.now() - 20 * 86400000).toISOString(), tags: [] },
    { email: 'c3@example.com', ordersCount: 1, totalSpent: 120, lastOrderAt: new Date(Date.now() - 110 * 86400000).toISOString(), tags: [] },
    { email: 'c4@example.com', ordersCount: 0, totalSpent: 0, tags: [] }
  ];

  const result = syncAllContactsRfm(contacts);

  assert.equal(result.modifiedCount, 3);
  assert.equal(result.summary.whales, 1);
  assert.equal(result.summary.gold, 1);
  assert.equal(result.summary.atRisk, 1);
  assert.equal(result.summary.leads, 1);
  assert.equal(result.summary.total, 4);
});

test('Option B: syncContactRfmTags seamlessly handles raw config and dynamic window adjustment', () => {
  const contact = {
    email: 'serena@aesthetics.com',
    ordersCount: 3,
    totalSpent: 350.00,
    lastOrderAt: new Date(Date.now() - 100 * 86400000).toISOString(), // 100 days ago
    tags: []
  };

  // With default 90 days at-risk window -> gets At-Risk tag
  syncContactRfmTags(contact, DEFAULT_RFM_CONFIG);
  assert.ok(contact.tags.includes('At-Risk'), 'Should have At-Risk tag with 90d window');
  assert.ok(contact.tags.includes('VIP-Gold'), 'Should have VIP-Gold');

  // Merchant customizes at-risk window to 120 days -> customer is no longer at risk
  const changed = syncContactRfmTags(contact, { atRiskDays: 120, vipGold: 250 });
  assert.equal(changed, true, 'Tags should update when threshold widens');
  assert.equal(contact.tags.includes('At-Risk'), false, 'At-Risk should be removed when window is 120d');
  assert.ok(contact.tags.includes('VIP-Gold'), 'VIP-Gold remains');
});

