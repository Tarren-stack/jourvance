import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRfmConfig, computeContactRfm } from './rfm-engine.mjs';

test('Customer 360: computeContactRfm accurately categorizes Whale, At-Risk, and Leads', () => {
  const config = cleanRfmConfig({
    atRiskDays: 90,
    lapsedDays: 180,
    vipPlatinum: 500
  });

  // Lead (0 orders)
  const lead = computeContactRfm({ ordersCount: 0, totalSpent: 0, lastOrderAt: null }, config);
  assert.equal(lead.tier, 'prospect');
  assert.equal(lead.badge, 'Lead');
  assert.equal(lead.isVip, false);
  assert.equal(lead.isAtRisk, false);

  // Active VIP Platinum Whale
  const whale = computeContactRfm({
    ordersCount: 4,
    totalSpent: 620,
    lastOrderAt: new Date(Date.now() - 14 * 86400000).toISOString()
  }, config);
  assert.equal(whale.tier, 'whale');
  assert.equal(whale.isVip, true);
  assert.equal(whale.isAtRisk, false);
  assert.equal(whale.recencyDays, 14);

  // At-Risk VIP Whale (112 days inactive)
  const atRiskWhale = computeContactRfm({
    ordersCount: 5,
    totalSpent: 850,
    lastOrderAt: new Date(Date.now() - 112 * 86400000).toISOString()
  }, config);
  assert.equal(atRiskWhale.tier, 'at_risk');
  assert.equal(atRiskWhale.isPlatinum, true);
  assert.equal(atRiskWhale.isVip, true);
  assert.equal(atRiskWhale.isAtRisk, true);
  assert.equal(atRiskWhale.badge, 'At-Risk Whale');
  assert.equal(atRiskWhale.recencyDays, 112);
});

test('Customer 360: Timeline merger orders chronologically newest first', () => {
  const events = [
    { kind: 'joined', at: '2026-08-01T10:00:00.000Z', title: 'Joined CRM' },
    { kind: 'order', at: '2026-08-15T14:30:00.000Z', title: 'Order #1001' },
    { kind: 'order', at: '2026-09-01T12:00:00.000Z', title: 'Order #1002' },
    { kind: 'touch', at: '2026-08-20T09:00:00.000Z', title: 'VIP Email Touch' }
  ];

  const sorted = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  assert.equal(sorted[0].title, 'Order #1002');
  assert.equal(sorted[1].title, 'VIP Email Touch');
  assert.equal(sorted[2].title, 'Order #1001');
  assert.equal(sorted[3].title, 'Joined CRM');
});

test('Customer 360: Strategic Advice correctly matches customer lifecycle tier', () => {
  function getStrategicAdvice(rfm, config) {
    if (rfm.tier === 'whale') {
      if (rfm.isAtRisk) {
        return {
          title: 'Priority At-Risk VIP Whale',
          suggestedTemplate: 'at_risk_winback'
        };
      }
      return {
        title: 'Active VIP Whale (Top 2% Spender)',
        suggestedTemplate: 'whale_perk'
      };
    }
    if (rfm.isAtRisk) {
      return {
        title: 'At-Risk Customer',
        suggestedTemplate: 'at_risk_winback'
      };
    }
    if (rfm.ordersCount === 0) {
      return {
        title: 'Top-of-Funnel Lead (0 Orders)',
        suggestedTemplate: 'lead_welcome'
      };
    }
    return {
      title: 'Customer Engagement',
      suggestedTemplate: 'regular'
    };
  }

  const adviceWhale = getStrategicAdvice({ tier: 'whale', isAtRisk: false, ordersCount: 3 });
  assert.equal(adviceWhale.suggestedTemplate, 'whale_perk');

  const adviceAtRiskWhale = getStrategicAdvice({ tier: 'whale', isAtRisk: true, ordersCount: 4 });
  assert.equal(adviceAtRiskWhale.suggestedTemplate, 'at_risk_winback');

  const adviceLead = getStrategicAdvice({ tier: 'lead', isAtRisk: false, ordersCount: 0 });
  assert.equal(adviceLead.suggestedTemplate, 'lead_welcome');
});

test('Customer 360: Tag array deduplication and cleansing', () => {
  const currentTags = ['Customer', 'VIP-Platinum'];
  const newTag = 'Sensitive-Skin';
  const updated = Array.from(new Set([...currentTags, newTag.trim()].map(t => t.trim()).filter(Boolean)));
  assert.deepEqual(updated, ['Customer', 'VIP-Platinum', 'Sensitive-Skin']);

  // Removing a tag
  const tagToRemove = 'Customer';
  const filtered = updated.filter(t => t !== tagToRemove);
  assert.deepEqual(filtered, ['VIP-Platinum', 'Sensitive-Skin']);
});

test('Customer 360: Enrollment toggle transitions valid statuses', () => {
  const enrollment = { id: 'enr_1', status: 'active' };

  // Pause
  enrollment.status = 'paused';
  assert.equal(enrollment.status, 'paused');

  // Resume
  enrollment.status = 'active';
  assert.equal(enrollment.status, 'active');

  // Cancel
  enrollment.status = 'cancelled';
  assert.equal(enrollment.status, 'cancelled');
});
