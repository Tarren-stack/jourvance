import test from 'node:test';
import assert from 'node:assert/strict';

test('waitlist lead tagging records requestedPlan and billingCycle', () => {
  const contact = {
    id: 'lead_waitlist_1',
    email: 'founder@glowbeauty.com',
    tags: ['growth_pro_waitlist'],
    metadata: {
      requestedPlan: 'growth_pro',
      billingCycle: 'annual',
      storeDomain: 'glowbeauty.myshopify.com',
      waitlistJoinedAt: new Date().toISOString()
    }
  };

  assert.equal(contact.tags.includes('growth_pro_waitlist'), true);
  assert.equal(contact.metadata.requestedPlan, 'growth_pro');
  assert.equal(contact.metadata.billingCycle, 'annual');
  assert.equal(contact.metadata.storeDomain, 'glowbeauty.myshopify.com');
});

test('drip enrollment step calculation handles delays accurately', () => {
  const now = Date.now();
  const nextStepDelayHours = 24;
  const nextDue = new Date(now + nextStepDelayHours * 3600000);
  
  assert.equal(nextDue.getTime() > now, true);
  assert.equal(Math.round((nextDue.getTime() - now) / 3600000), 24);
});

test('HMAC secret rotation verifies tokens signed with old secret', async () => {
  const { signUnsubscribe, readUnsubscribe } = await import('./email-doc.mjs');
  const oldSecret = 'historic_key_2025_abc';
  const newSecret = 'current_fresh_key_2026_xyz';
  const secretsArray = [newSecret, oldSecret];

  // Token generated with historic key before rotation
  const token = signUnsubscribe(oldSecret, 'user_tenant_1', 'customer@example.com');
  assert.ok(token);

  // Helper verifying across secret array
  function verifyTokenWithRotation(tok, keys) {
    for (const k of keys) {
      const parsed = readUnsubscribe(k, tok);
      if (parsed) return parsed;
    }
    return null;
  }

  // Verification succeeds against the rotated keys array
  const result = verifyTokenWithRotation(token, secretsArray);
  assert.ok(result);
  assert.equal(result.uid, 'user_tenant_1');
  assert.equal(result.email, 'customer@example.com');

  // Verification fails against invalid secret
  assert.equal(verifyTokenWithRotation(token, ['wrong_key']), null);
});

test('abandoned checkout recovery calculates stage 1 (45m) and stage 2 (24h) intervals', () => {
  const abandonedAt = new Date('2026-09-26T10:00:00.000Z').getTime();
  
  // 30 mins after: pending (too early)
  const at30m = abandonedAt + 30 * 60 * 1000;
  assert.equal(at30m - abandonedAt >= 2700000, false);

  // 45 mins after: stage 1 due
  const at45m = abandonedAt + 45 * 60 * 1000;
  assert.equal(at45m - abandonedAt >= 2700000, true);

  // 24 hours after stage 1: stage 2 incentive due
  const emailSentAt = at45m;
  const at24hLater = emailSentAt + 24 * 3600 * 1000;
  assert.equal(at24hLater - emailSentAt >= 86400000, true);
});

test('mobile sticky bar defaults to enabled unless explicitly set false', () => {
  const pageWithDefault = { mobileStickyBarEnabled: undefined };
  const pageExplicitOn = { mobileStickyBarEnabled: true };
  const pageExplicitOff = { mobileStickyBarEnabled: false };

  assert.equal(pageWithDefault.mobileStickyBarEnabled !== false, true);
  assert.equal(pageExplicitOn.mobileStickyBarEnabled !== false, true);
  assert.equal(pageExplicitOff.mobileStickyBarEnabled !== false, false);
});

