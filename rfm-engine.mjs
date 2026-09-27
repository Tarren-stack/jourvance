/**
 * Jourvance RFM Lifecycle Segmentation Engine
 * Evaluates Recency, Frequency, and Monetary parameters for e-commerce contacts.
 * Classifies buyers into actionable tiers (Whale, Gold, Silver, At-Risk, Lapsed, Lead)
 * and synchronizes CRM tags dynamically.
 */

export const DEFAULT_RFM_CONFIG = {
  atRiskDays: 90,
  lapsedDays: 180,
  vipSilver: 100,
  vipGold: 250,
  vipPlatinum: 500,
  coolingDays: 60
};

export const MANAGED_RFM_TAGS = new Set([
  'VIP-Platinum',
  'VIP-Gold',
  'VIP-Silver',
  'VIP Customer',
  'Repeat Buyer',
  'First-Time Buyer',
  'At-Risk',
  'Lapsed'
]);

/**
 * Validates and cleans user-defined RFM configuration
 */
export function cleanRfmConfig(input) {
  if (!input || typeof input !== 'object') return { ...DEFAULT_RFM_CONFIG };
  return {
    atRiskDays: Math.max(14, Math.min(365, Number(input.atRiskDays) || DEFAULT_RFM_CONFIG.atRiskDays)),
    lapsedDays: Math.max(30, Math.min(730, Number(input.lapsedDays) || DEFAULT_RFM_CONFIG.lapsedDays)),
    vipSilver: Math.max(10, Number(input.vipSilver) || DEFAULT_RFM_CONFIG.vipSilver),
    vipGold: Math.max(20, Number(input.vipGold) || DEFAULT_RFM_CONFIG.vipGold),
    vipPlatinum: Math.max(50, Number(input.vipPlatinum) || DEFAULT_RFM_CONFIG.vipPlatinum),
    coolingDays: Math.max(7, Number(input.coolingDays) || DEFAULT_RFM_CONFIG.coolingDays)
  };
}

/**
 * Calculates days between now and a date string
 */
export function daysSince(dateStr, nowMs = Date.now()) {
  if (!dateStr) return null;
  const time = Date.parse(dateStr);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((nowMs - time) / 86400000));
}

/**
 * Computes RFM metrics and lifecycle classification for a contact
 */
export function computeContactRfm(contact, configInput = DEFAULT_RFM_CONFIG, nowMs = Date.now()) {
  const config = cleanRfmConfig(configInput);
  const ordersCount = Math.max(0, Number(contact?.ordersCount || 0));
  const totalSpent = Math.max(0, Number(contact?.totalSpent || 0));
  const recencyDays = daysSince(contact?.lastOrderAt, nowMs);

  // 1. Prospect (0 orders)
  if (ordersCount === 0) {
    return {
      ordersCount: 0,
      totalSpent: 0,
      recencyDays: null,
      segment: 'Nurture Prospect',
      tier: 'prospect',
      badge: 'Lead',
      color: '#94a3b8',
      isVip: false,
      isPlatinum: false,
      isGold: false,
      isSilver: false,
      isAtRisk: false,
      isLapsed: false
    };
  }

  // 2. Determine VIP Status
  const isPlatinum = totalSpent >= config.vipPlatinum || (ordersCount >= 4 && totalSpent >= config.vipGold);
  const isGold = !isPlatinum && (totalSpent >= config.vipGold || (ordersCount >= 3 && totalSpent >= config.vipSilver));
  const isSilver = !isPlatinum && !isGold && (totalSpent >= config.vipSilver || ordersCount >= 2);
  const isVip = isPlatinum || isGold || isSilver;

  // 3. Determine Recency State
  const isLapsed = recencyDays != null && recencyDays >= config.lapsedDays;
  const isAtRisk = !isLapsed && recencyDays != null && recencyDays >= config.atRiskDays;

  // 4. Determine Segment & Badge
  let segment = '';
  let tier = '';
  let badge = '';
  let color = '';

  if (isPlatinum) {
    if (isLapsed) {
      segment = 'Lapsed VIP Whale';
      tier = 'lapsed';
      badge = 'Lapsed Whale';
      color = '#ef4444';
    } else if (isAtRisk) {
      segment = 'At-Risk VIP Whale';
      tier = 'at_risk';
      badge = 'At-Risk Whale';
      color = '#f59e0b';
    } else {
      segment = 'VIP Whale (Platinum)';
      tier = 'whale';
      badge = 'VIP Platinum';
      color = '#a855f7';
    }
  } else if (isGold) {
    if (isLapsed) {
      segment = 'Lapsed VIP Client';
      tier = 'lapsed';
      badge = 'Lapsed VIP';
      color = '#ef4444';
    } else if (isAtRisk) {
      segment = 'At-Risk VIP Client';
      tier = 'at_risk';
      badge = 'At-Risk VIP';
      color = '#f59e0b';
    } else {
      segment = 'VIP Client (Gold)';
      tier = 'gold';
      badge = 'VIP Gold';
      color = '#eab308';
    }
  } else if (isSilver) {
    if (isLapsed) {
      segment = 'Lapsed Customer';
      tier = 'lapsed';
      badge = 'Lapsed';
      color = '#ef4444';
    } else if (isAtRisk) {
      segment = 'At-Risk Customer';
      tier = 'at_risk';
      badge = 'At-Risk';
      color = '#f97316';
    } else {
      segment = 'VIP Rising (Silver)';
      tier = 'silver';
      badge = 'VIP Silver';
      color = '#06b6d4';
    }
  } else {
    // Non-VIP buyer (<$100 spend, single low-value order)
    if (isLapsed) {
      segment = 'Lapsed Buyer';
      tier = 'lapsed';
      badge = 'Lapsed';
      color = '#94a3b8';
    } else if (isAtRisk) {
      segment = 'At-Risk Buyer';
      tier = 'at_risk';
      badge = 'At-Risk';
      color = '#f97316';
    } else if (recencyDays != null && recencyDays <= 30) {
      segment = 'New Buyer';
      tier = 'new';
      badge = 'New Buyer';
      color = '#10b981';
    } else {
      segment = 'Standard Buyer';
      tier = 'buyer';
      badge = 'Buyer';
      color = '#64748b';
    }
  }

  return {
    ordersCount,
    totalSpent,
    recencyDays,
    segment,
    tier,
    badge,
    color,
    isVip,
    isPlatinum,
    isGold,
    isSilver,
    isAtRisk,
    isLapsed
  };
}

/**
 * Synchronizes managed RFM tags onto a contact while preserving custom tags.
 * Returns true if contact.tags was changed.
 */
export function syncContactRfmTags(contact, rfmOrConfig) {
  if (!contact || typeof contact !== 'object') return false;
  const currentTags = Array.isArray(contact.tags) ? contact.tags : [];
  
  const rfm = (rfmOrConfig && typeof rfmOrConfig.ordersCount === 'number' && typeof rfmOrConfig.isPlatinum === 'boolean')
    ? rfmOrConfig
    : computeContactRfm(contact, rfmOrConfig);

  // Retain non-RFM custom tags (e.g. Order Bump Taker, Exit-Intent-Rescue, Shopify Buyer)
  const retainedTags = currentTags.filter(t => !MANAGED_RFM_TAGS.has(t));
  const newTags = [...retainedTags];

  // Apply new tags based on RFM calculation
  if (rfm.ordersCount >= 2) {
    newTags.push('Repeat Buyer');
  } else if (rfm.ordersCount === 1) {
    newTags.push('First-Time Buyer');
  }

  if (rfm.isPlatinum) {
    newTags.push('VIP-Platinum', 'VIP Customer');
  } else if (rfm.isGold) {
    newTags.push('VIP-Gold', 'VIP Customer');
  } else if (rfm.isSilver) {
    newTags.push('VIP-Silver', 'VIP Customer');
  }

  if (rfm.isLapsed) {
    newTags.push('Lapsed');
  } else if (rfm.isAtRisk) {
    newTags.push('At-Risk');
  }

  // Deduplicate and compare
  const deduplicated = [...new Set(newTags)];
  const tagsChanged = deduplicated.length !== currentTags.length || deduplicated.some(t => !currentTags.includes(t));

  if (tagsChanged) {
    contact.tags = deduplicated;
  }

  return tagsChanged;
}

/**
 * Runs RFM synchronization across an array of contacts
 */
export function syncAllContactsRfm(contacts, configInput = DEFAULT_RFM_CONFIG, nowMs = Date.now()) {
  const config = cleanRfmConfig(configInput);
  const rows = Array.isArray(contacts) ? contacts : [];
  let modifiedCount = 0;

  const summary = {
    whales: 0,
    gold: 0,
    silver: 0,
    atRisk: 0,
    lapsed: 0,
    repeatBuyers: 0,
    leads: 0,
    total: rows.length
  };

  for (const c of rows) {
    const rfm = computeContactRfm(c, config, nowMs);
    const changed = syncContactRfmTags(c, rfm);
    if (changed) modifiedCount++;

    if (rfm.tier === 'whale') summary.whales++;
    else if (rfm.tier === 'gold') summary.gold++;
    else if (rfm.tier === 'silver') summary.silver++;
    
    if (rfm.isAtRisk) summary.atRisk++;
    if (rfm.isLapsed) summary.lapsed++;
    if (rfm.ordersCount >= 2) summary.repeatBuyers++;
    if (rfm.ordersCount === 0) summary.leads++;
  }

  return {
    contacts: rows,
    modifiedCount,
    summary
  };
}
