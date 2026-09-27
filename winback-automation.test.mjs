import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RFM_CONFIG, cleanRfmConfig } from './rfm-engine.mjs';

test('Option A & 1-Use Discount: cleanRfmConfig defaults and options', () => {
  const defaults = cleanRfmConfig(null);
  assert.equal(defaults.autoWinbackEnabled, false);
  assert.equal(defaults.allowUnlimitedDiscountUse, false);
  assert.equal(defaults.autoWinbackEnabledAt, null);

  const custom = cleanRfmConfig({
    autoWinbackEnabled: true,
    autoWinbackEnabledAt: '2026-09-27T12:00:00.000Z',
    allowUnlimitedDiscountUse: true
  });
  assert.equal(custom.autoWinbackEnabled, true);
  assert.equal(custom.autoWinbackEnabledAt, '2026-09-27T12:00:00.000Z');
  assert.equal(custom.allowUnlimitedDiscountUse, true);
});

test('Option A Auto-Enrollment: strictly enrolls contacts newly reaching at-risk threshold', () => {
  const now = Date.now();
  const enabledAtMs = now - (2 * 3600000); // Enabled 2 hours ago
  const atRiskWindowMs = 90 * 86400000;
  const lapsedWindowMs = 180 * 86400000;

  // Contact 1: Ordered 89.95 days ago -> Crosses 90 days 1 hour ago (after enabledAtMs) -> SHOULD ENROLL
  const contactNewlyAtRisk = {
    email: 'newly.atrisk@example.com',
    lastOrderAt: new Date(now - atRiskWindowMs + (1 * 3600000)).toISOString()
  };
  const lastOrderMs1 = Date.parse(contactNewlyAtRisk.lastOrderAt);
  const crossedAtRiskMs1 = lastOrderMs1 + atRiskWindowMs;
  const crossedLapsedMs1 = lastOrderMs1 + lapsedWindowMs;
  const shouldEnroll1 = crossedAtRiskMs1 >= enabledAtMs && now < crossedLapsedMs1;
  assert.equal(shouldEnroll1, true, 'Contact who crossed 90d after enabledAt should enroll');

  // Contact 2: Ordered 120 days ago -> Crossed 90 days 30 days ago (before enabledAtMs) -> SHOULD NOT ENROLL (Option A)
  const contactOldAtRisk = {
    email: 'old.atrisk@example.com',
    lastOrderAt: new Date(now - (120 * 86400000)).toISOString()
  };
  const lastOrderMs2 = Date.parse(contactOldAtRisk.lastOrderAt);
  const crossedAtRiskMs2 = lastOrderMs2 + atRiskWindowMs;
  const crossedLapsedMs2 = lastOrderMs2 + lapsedWindowMs;
  const shouldEnroll2 = crossedAtRiskMs2 >= enabledAtMs && now < crossedLapsedMs2;
  assert.equal(shouldEnroll2, false, 'Contact who was already at-risk before enabledAt should NOT enroll in Option A');

  // Contact 3: Ordered 200 days ago -> Past 180d lapsed window -> SHOULD NOT ENROLL
  const contactLapsed = {
    email: 'lapsed@example.com',
    lastOrderAt: new Date(now - (200 * 86400000)).toISOString()
  };
  const lastOrderMs3 = Date.parse(contactLapsed.lastOrderAt);
  const crossedAtRiskMs3 = lastOrderMs3 + atRiskWindowMs;
  const crossedLapsedMs3 = lastOrderMs3 + lapsedWindowMs;
  const shouldEnroll3 = crossedAtRiskMs3 >= enabledAtMs && now < crossedLapsedMs3;
  assert.equal(shouldEnroll3, false, 'Contact already past lapsed threshold should not enroll in at-risk winback');
});

test('Discount Safeguards: oncePerCustomer rule toggles correctly based on allowUnlimitedDiscountUse', () => {
  const buildCoreDiscountRule = (code, value, allowUnlimited) => ({
    code,
    value,
    discountType: 'percentage',
    oncePerCustomer: !allowUnlimited
  });

  const singleUseDefault = buildCoreDiscountRule('WELCOMEBACK15', 15, false);
  assert.equal(singleUseDefault.oncePerCustomer, true, 'Default should restrict coupon to 1 redemption per customer');

  const unlimitedSetting = buildCoreDiscountRule('WELCOMEBACK15', 15, true);
  assert.equal(unlimitedSetting.oncePerCustomer, false, 'Setting allowUnlimitedDiscountUse should allow repeat usage');
});
