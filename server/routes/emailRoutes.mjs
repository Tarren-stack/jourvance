import crypto from 'crypto';
import {
  BUILT_INS, FOLLOW_UP_NOTE, applyListChange, applyUtm, campaignSchedule, cleanAb,
  cleanPicks, cleanSegment, cleanUtm, dueRecipients, inBuiltIn,
  nextBatchAt, nextSegmentState, resolveAudience, segmentDefinition, segmentMatches,
  smartSkipReason
} from '../../audience.mjs';
import {
  cleanBlockList, fillMailTokens, noteSuppression, personFields, sendBlockReason
} from '../../email-doc.mjs';
import {
  SMART_EMAIL_HOURS, SMART_SMS_HOURS, isIanaTimezone
} from '../../email-flows.mjs';
import { emailTouchFields } from '../../email-map.mjs';
import {
  mailSecretOk, normalizeProviderEvent, readProviderEvents, secretsMatch
} from '../mail-events.mjs';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function setupEmailRoutes(app, ctx) {
  const {
    hub,
    hubReady,
    loadBehaviorBag,
    requireUser,
    ensureSignalStarters,
    suitePayload,
    cleanBlocks,
    contactsForUser,
    loadOrders,
    isDemoRecord,
    loadCheckouts,
    orderMailVars,
    personFields,
    composeLetter,
    fillMailTokens,
    SAMPLE_MAIL_VARS,
    listWorkspaces,
    realStoreDomain,
    adminToken,
    workspaceCache,
    userProgramBag,
    writeUserPrograms,
    loadContacts,
    saveContacts,
    contactOwnerId,
    computeContactRfm,
    syncContactRfmTags,
    cleanRfmConfig,
    DEFAULT_RFM_CONFIG,
    ensureShopifyCoreDiscounts,
    loadCampaigns,
    saveCampaigns,
    loadDrips,
    saveDrips,
    predictStore,
    accountOrders,
    publicPrediction,
    refreshPredictions,
    loadEvents,
    loadRedirects,
    eventsFilePath,
    verifyUnsubscribeToken,
    cleanPicks,
    cleanFallbackHour,
    resolveAudience,
    FOLLOW_UP_NOTE,
    SMART_EMAIL_HOURS,
    SMART_SMS_HOURS,
    splitHoldout,
    recordEvent,
    knownSend = () => null,
    smartSkipReason,
    composeForSend,
    deliverLetter,
    applyUtm,
    rememberRedirectsBatch,
    smsQuietEnabled,
    quietOpenAt,
    textConsentKnown,
    prepareSmsMessage
  } = ctx;

// ── Hub Email Suite Routes ──

app.get('/api/email/status', requireUser, async (req, res) => {
  if (hubReady) {
    try {
      const status = await hub.email.status();
      return res.json({ success: true, status });
    } catch (e) {
      console.warn('[Jourvance] Hub email status failed:', e.message);
    }
  }
  res.json({ success: true, status: { connected: false, provider: null, notice: 'Email sending is not connected.' } });
});

app.get('/api/email/suite', requireUser, (req, res) => {
  ensureSignalStarters(req.user.uid);
  res.json({ success: true, suite: suitePayload(req.user.uid) });
});

app.post('/api/email/programs/preview', requireUser, (req, res) => {
  const blocks = cleanBlocks(req.body?.blocks, []);
  const mode = req.body?.merge === 'keep' ? 'keep' : req.body?.merge === 'person' ? 'person' : 'sample';
  const previewText = String(req.body?.previewText || '').slice(0, 140);
  const marketing = req.body?.marketing !== false;
  if (mode === 'person') {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const contact = contactsForUser(req.user.uid).find((row) => String(row.email || '').toLowerCase() === email);
    if (!contact) return res.status(404).json({ success: false, error: 'That person is not in this account.' });
    const orders = loadOrders().filter((order) => order.userId === req.user.uid && String(order.customerEmail || '').toLowerCase() === email && !isDemoRecord(order));
    orders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const checkouts = loadCheckouts().filter((row) => row.userId === req.user.uid && String(row.customerEmail || '').toLowerCase() === email);
    checkouts.sort((a, b) => new Date(b.abandonedAt || 0) - new Date(a.abandonedAt || 0));
    const vars = orders[0]
      ? orderMailVars(orders[0], contact)
      : checkouts[0]
        ? { ...personFields(contact.name, contact), email, phone: contact.phone || '', checkout_url: checkouts[0].abandonedCheckoutUrl || '', eventLineItems: checkouts[0].lineItems || [] }
        : { ...personFields(contact.name, contact), email, phone: contact.phone || '' };
    const letter = composeLetter(req.user.uid, contact, blocks, vars, { previewText, marketing, embedPreheader: true, previewCoupons: true });
    return res.json({
      success: true,
      sample: false,
      label: `Preview for ${email}. Nothing was sent.`,
      subject: fillMailTokens(String(req.body?.subject || ''), letter.vars, false).slice(0, 200),
      html: letter.html,
      text: letter.text,
      untranslated: letter.untranslated || [],
      hidden: letter.hidden || 0
    });
  }
  const keep = mode === 'keep';
  const vars = keep ? {} : { ...SAMPLE_MAIL_VARS };
  const letter = composeLetter(req.user.uid, keep ? { email: '' } : { email: 'preview@example.com', name: 'Alex Sample' }, blocks, vars, {
    keepUnknown: keep,
    marketing,
    previewText,
    embedPreheader: true,
    previewCoupons: true,
    event: keep ? {} : { line_items: [{ title: 'Example product', quantity: 1, price: '48.00' }] }
  });
  const subject = fillMailTokens(String(req.body?.subject || ''), keep ? {} : letter.vars, keep).slice(0, 200);
  res.json({
    success: true,
    sample: !keep,
    label: keep ? '' : 'Sample preview. The name and example product are samples.',
    subject,
    html: letter.html,
    text: letter.text,
    untranslated: letter.untranslated || [],
    hidden: letter.hidden || 0
  });
});

function honestCatalogProduct(product, domain, currency) {
  if (!product || typeof product !== 'object') return null;
  const variant = Array.isArray(product.variants) ? product.variants[0] || {} : {};
  const image = product.images?.[0]?.src || product.image?.src || '';
  const row = { id: String(product.id || '').slice(0, 40) };
  const title = String(product.title || '').trim();
  if (title) row.title = title.slice(0, 200);
  if (typeof image === 'string' && /^https?:\/\//.test(image)) row.image = image.slice(0, 500);
  if (variant.price != null && String(variant.price) !== '') row.price = String(variant.price).slice(0, 40);
  if (variant.compare_at_price != null && String(variant.compare_at_price) !== '') row.compareAt = String(variant.compare_at_price).slice(0, 40);
  if (domain && product.handle) row.url = `https://${domain}/products/${String(product.handle).slice(0, 120)}`;
  if (currency && row.price) row.currency = String(currency).slice(0, 8);
  if (!row.title && !row.image && !row.price && !row.url) return null;
  return row;
}

app.get('/api/email/products', requireUser, async (req, res) => {
  const shops = await listWorkspaces(req.user.uid);
  const shop = shops.find((ws) => realStoreDomain(ws?.shopifyConfig) && adminToken(ws?.shopifyConfig) && ws?.shopifyConfig?.status === 'connected');
  const domain = realStoreDomain(shop?.shopifyConfig);
  const token = adminToken(shop?.shopifyConfig);
  if (!domain || !token) {
    return res.json({ success: true, products: [], notice: 'Connect a Shopify store to choose products.' });
  }
  try {
    const resp = await fetch(`https://${domain}/admin/api/2024-10/products.json?limit=50`, {
      headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) return res.json({ success: true, products: [], notice: 'The store did not return a product list.' });
    const data = await resp.json();
    rememberAdminCatalog(req.user.uid, domain, data?.products);
    const products = (Array.isArray(data?.products) ? data.products : []).map((product) => honestCatalogProduct(product, domain, shop.shopifyConfig?.currency)).filter(Boolean);
    return res.json({ success: true, products, notice: products.length ? '' : 'The store returned no products.' });
  } catch {
    return res.json({ success: true, products: [], notice: 'The store did not answer.' });
  }
});

app.post('/api/email/library', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  const block = cleanBlockList([req.body?.block])[0];
  if (!block) return res.status(400).json({ success: false, error: 'That block could not be saved.' });
  const row = {
    id: `lib_${Date.now().toString(36)}`,
    name: String(req.body?.name || block.kind).slice(0, 80),
    block
  };
  bag.library = cleanLibrary([...(bag.library || []), row]).slice(0, 40);
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, library: bag.library });
});

app.delete('/api/email/library/:id', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  bag.library = (bag.library || []).filter((row) => row.id !== req.params.id);
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, library: bag.library });
});

app.post('/api/email/postal', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  bag.postalAddress = String(req.body?.physicalAddress || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, physicalAddress: bag.postalAddress });
});

app.post('/api/email/timezone', requireUser, (req, res) => {
  const zone = String(req.body?.timezone || '').trim();
  if (zone && !isIanaTimezone(zone)) {
    return res.status(400).json({ success: false, error: 'Enter a timezone like America/New_York, or leave it empty to use UTC.' });
  }
  const bag = userProgramBag(req.user.uid);
  bag.timezone = zone;
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, timezone: zone });
});

function applyUnsubscribe(uid, email) {
  const all = loadContacts();
  let found = false;
  for (const contact of all) {
    if (contactOwnerId(contact) !== uid) continue;
    if (String(contact.email || '').toLowerCase() !== email) continue;
    contact.acceptsMarketing = false;
    found = true;
  }
  if (found) saveContacts(all);
  const bag = userProgramBag(uid);
  bag.suppressions = noteSuppression(bag.suppressions, email, 'unsubscribe');
  writeUserPrograms(uid, bag);
  return found;
}

function unsubscribeResponse(req, res) {
  const parsed = verifyUnsubscribeToken(req.params.token);
  if (!parsed) {
    const message = 'This unsubscribe link is not valid.';
    if (req.method === 'POST') return res.status(400).type('text/plain').send(message);
    return res.status(400).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribe</title></head><body style="font-family:Georgia,serif;padding:40px;"><p>${message}</p></body></html>`);
  }
  applyUnsubscribe(parsed.uid, parsed.email);
  const message = 'You are unsubscribed. Marketing mail from this store will stop for this address.';
  if (req.method === 'POST') return res.status(200).type('text/plain').send(message);
  return res.status(200).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body style="font-family:Georgia,serif;padding:40px;max-width:36rem;"><p>${message}</p></body></html>`);
}

app.get('/u/:token', unsubscribeResponse);
app.post('/u/:token', unsubscribeResponse);

app.post('/api/email/provider-event', (req, res) => {
  const secret = String(process.env.MAIL_EVENT_SECRET || '');
  if (!mailSecretOk(secret)) {
    return res.status(401).json({ success: false, error: 'Mail event secret is not configured, so bounces are not recorded.' });
  }
  if (!secretsMatch(req.get('x-jourvance-mail-secret'), secret)) {
    return res.status(401).json({ success: false, error: 'The mail event secret did not match, so this event was not recorded.' });
  }
  const incoming = readProviderEvents(req.body);
  if (!incoming.length) {
    return res.status(400).json({ success: false, error: 'uid, email, and an open, click, delivered, bounce, complaint, or unsubscribe type are required.' });
  }
  const seen = new Set();
  for (const row of loadEvents()) {
    const id = String(row?.providerEventId || '');
    if (id && row?.userId) seen.add(`${row.userId}\0${id}`);
  }
  let recorded = 0;
  let duplicate = 0;
  let skipped = 0;
  let lastType = '';
  let attached = false;
  for (const raw of incoming) {
    const event = normalizeProviderEvent(raw);
    if (!event) { skipped += 1; continue; }
    if (event.providerEventId) {
      const key = `${event.uid}\0${event.providerEventId}`;
      if (seen.has(key)) { duplicate += 1; continue; }
      seen.add(key);
    }
    const known = knownSend(event.uid, event.messageId);
    if (event.type === 'unsubscribe') applyUnsubscribe(event.uid, event.email);
    else if (event.type === 'hard_bounce' || event.type === 'soft_bounce' || event.type === 'complaint') {
      const bag = userProgramBag(event.uid);
      bag.suppressions = noteSuppression(bag.suppressions, event.email, event.type);
      writeUserPrograms(event.uid, bag);
    }
    recordEvent({
      type: event.type,
      userId: event.uid,
      email: event.email,
      messageId: known?.messageId || '',
      campaignId: known?.campaignId || '',
      flowId: known?.flowId || '',
      nodeId: known?.nodeId || '',
      sequenceId: known?.sequenceId || '',
      ...(event.providerEventId ? { providerEventId: event.providerEventId } : {}),
      ...(event.prefetch ? { prefetch: true } : {}),
      ...(event.at ? { at: event.at } : {}),
      ...(event.bounceType && event.bounceType !== event.type ? { bounceType: event.bounceType } : {}),
      ...emailTouchFields(event.type)
    });
    recorded += 1;
    lastType = event.type;
    if (known) attached = true;
  }
  if (!recorded && !duplicate) {
    return res.status(400).json({ success: false, error: 'uid, email, and an open, click, delivered, bounce, complaint, or unsubscribe type are required.' });
  }
  if (incoming.length === 1 && recorded === 1) {
    return res.json({ success: true, recorded: lastType, attached });
  }
  res.json({ success: true, recorded, duplicate, skipped });
});

app.post('/api/email/programs/:id', requireUser, (req, res) => {
  const id = String(req.params.id || '');
  const kind = req.body?.kind === 'automation' ? 'automation' : 'transactional';
  const bag = userProgramBag(req.user.uid);
  if (kind === 'automation') {
    const row = bag.automations.find((item) => item.id === id);
    if (!row) return res.status(404).json({ success: false, error: 'That automation is not in the suite.' });
    if (req.body?.enabled !== undefined) row.enabled = Boolean(req.body.enabled);
    if (req.body?.steps) row.steps = cleanSteps(req.body.steps, row.steps);
  } else {
    const row = bag.transactional.find((item) => item.id === id);
    if (!row) return res.status(404).json({ success: false, error: 'That letter is not in the suite.' });
    if (req.body?.enabled !== undefined) row.enabled = Boolean(req.body.enabled);
    if (typeof req.body?.subject === 'string' && req.body.subject.trim()) row.subject = req.body.subject.trim().slice(0, 200);
    if (req.body?.blocks) row.blocks = cleanBlocks(req.body.blocks, row.blocks);
  }
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, suite: suitePayload(req.user.uid) });
});

app.get('/api/email/flows', requireUser, async (req, res) => {
  if (hubReady) {
    try {
      const data = await hub.email.flows?.list?.({ accountId: req.user.uid });
      if (data?.flows && data.flows.length) return res.json({ success: true, flows: data.flows });
    } catch (e) {
      console.warn('[Jourvance] Hub email flows failed:', e.message);
    }
  }
  res.json({ success: true, flows: [] });
});

app.get('/api/email/broadcasts', requireUser, async (req, res) => {
  const campaigns = loadCampaigns().filter(c => c.userId === req.user.uid);
  res.json({
    success: true,
    broadcasts: campaigns.map(presentCampaign),
    followUpNote: FOLLOW_UP_NOTE
  });
});

// Dynamic Audience API reading directly from contacts.json with RFM Lifecycle Intelligence
app.get('/api/email/audience', requireUser, async (req, res) => {
  const contacts = contactsForUser(req.user.uid);
  const bag = userProgramBag(req.user.uid);
  const rfmConfig = cleanRfmConfig(bag.rfmConfig);
  const suppressions = bag.suppressions;
  const orders = accountOrders(req.user.uid);
  const live = predictStore(orders, Date.now());

  let whalesCount = 0;
  let goldCount = 0;
  let silverCount = 0;
  let atRiskCount = 0;
  let lapsedCount = 0;
  let repeatCount = 0;

  const subscribers = contacts.map(c => {
    const reason = sendBlockReason(c, suppressions, true);
    const status = reason === 'hard_bounce' || reason === 'soft_bounce' ? 'suppressed' : (c.acceptsMarketing === false || reason === 'unsubscribed' ? 'unsubscribed' : 'active');
    const email = String(c.email || '').toLowerCase();
    const row = live.ready ? live.rows?.[email] : null;
    const spent = historicSpend(orders.filter((order) => String(order.customerEmail || '').toLowerCase() === email));
    const rfm = computeContactRfm(c, rfmConfig);

    if (rfm.tier === 'whale') whalesCount++;
    else if (rfm.tier === 'gold') goldCount++;
    else if (rfm.tier === 'silver') silverCount++;
    if (rfm.isAtRisk) atRiskCount++;
    if (rfm.isLapsed) lapsedCount++;
    if (rfm.ordersCount >= 2) repeatCount++;

    return {
      email: c.email,
      name: c.name || c.email.split('@')[0],
      phone: c.phone || '',
      status,
      tags: c.tags || ['Customer'],
      totalSpent: c.totalSpent || 0,
      ordersCount: c.ordersCount || 0,
      joinedAt: c.firstSeenAt || c.subscribedAt || new Date().toISOString(),
      lastOrderAt: c.lastOrderAt || null,
      predictionLine: predictionLine(row || spent),
      rfmSegment: rfm.segment,
      rfmTier: rfm.tier,
      rfmBadge: rfm.badge,
      rfmColor: rfm.color,
      recencyDays: rfm.recencyDays,
      isVip: rfm.isVip,
      isAtRisk: rfm.isAtRisk,
      isLapsed: rfm.isLapsed
    };
  });

  res.json({
    success: true,
    rfmConfig,
    rfmSummary: {
      whales: whalesCount,
      gold: goldCount,
      silver: silverCount,
      atRisk: atRiskCount,
      lapsed: lapsedCount,
      repeatBuyers: repeatCount,
      totalBuyers: subscribers.filter(s => (s.ordersCount || 0) > 0).length,
      leads: subscribers.filter(s => (s.ordersCount || 0) === 0).length,
      totalContacts: subscribers.length
    },
    subscribers
  });
});

app.get('/api/email/contact-details', requireUser, async (req, res) => {
  const emailQuery = String(req.query.email || '').toLowerCase().trim();
  if (!emailQuery || !emailQuery.includes('@')) {
    return res.status(400).json({ success: false, error: 'Valid customer email is required.' });
  }

  const contacts = contactsForUser(req.user.uid);
  let contact = contacts.find(c => String(c.email || '').toLowerCase().trim() === emailQuery);

  const orders = accountOrders(req.user.uid).filter(o => String(o.customerEmail || '').toLowerCase().trim() === emailQuery);
  const bag = userProgramBag(req.user.uid);
  const rfmConfig = cleanRfmConfig(bag.rfmConfig);
  const suppressions = bag.suppressions || [];

  if (!contact && orders.length > 0) {
    const sorted = [...orders].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    const first = sorted[sorted.length - 1];
    contact = {
      userId: req.user.uid,
      email: emailQuery,
      name: first.customerName || emailQuery.split('@')[0],
      phone: first.customerPhone || '',
      tags: ['Customer'],
      firstSeenAt: first.createdAt,
      subscribedAt: first.createdAt,
      ordersCount: orders.length,
      totalSpent: orders.reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0),
      lastOrderAt: sorted[0]?.createdAt
    };
  }

  if (!contact) {
    return res.status(404).json({ success: false, error: 'Customer record not found.' });
  }

  const rfm = computeContactRfm(contact, rfmConfig);
  const reason = sendBlockReason(contact, suppressions, true);
  const marketingStatus = reason === 'hard_bounce' || reason === 'soft_bounce' ? 'suppressed' : (contact.acceptsMarketing === false || reason === 'unsubscribed' ? 'unsubscribed' : 'active');

  const checkouts = loadCheckouts().filter(c => {
    const ownerMatch = !c.userId || c.userId === req.user.uid;
    const emailMatch = String(c.email || c.customerEmail || '').toLowerCase().trim() === emailQuery;
    return ownerMatch && emailMatch;
  });

  const { enrollments, sequences } = loadDrips();
  const customerEnrollments = (enrollments || []).filter(e => e.userId === req.user.uid && String(e.customerEmail || '').toLowerCase().trim() === emailQuery).map(e => {
    const seq = sequences.find(s => s.id === e.sequenceId);
    return {
      ...e,
      sequenceName: seq?.name || e.sequenceId,
      totalSteps: seq?.steps?.length || 1
    };
  });

  // The host passes loadRedirects in ctx; it was once a bare name here, and the ReferenceError
  // left this request unanswered for every known contact. Without it the touches are left out.
  const redirects = (typeof loadRedirects === 'function' ? loadRedirects() : []).filter(r => r.uid === req.user.uid && String(r.email || '').toLowerCase().trim() === emailQuery);
  const events = loadEvents().filter(evt => evt.userId === req.user.uid && String(evt.email || '').toLowerCase().trim() === emailQuery);

  const timeline = [];
  if (contact.firstSeenAt || contact.subscribedAt) {
    timeline.push({
      kind: 'joined',
      title: 'Joined Jourvance CRM',
      description: `Lead captured via ${contact.sourceSlug || 'Storefront'}`,
      at: contact.firstSeenAt || contact.subscribedAt
    });
  }

  for (const o of orders) {
    timeline.push({
      kind: 'order',
      title: `Placed Order #${o.orderNumber || o.name || 'Store Order'}`,
      description: `$${(Number(o.totalPrice) || 0).toFixed(2)} • ${Array.isArray(o.lineItems) ? o.lineItems.map(l => l.title || l.name).filter(Boolean).join(', ') : 'Shopify Order'}`,
      at: o.createdAt,
      orderId: o.id || o.orderNumber,
      total: Number(o.totalPrice) || 0
    });
  }

  for (const chk of checkouts) {
    timeline.push({
      kind: 'checkout',
      title: chk.recoveredAt ? 'Recovered Abandoned Checkout' : 'Initiated Checkout',
      description: `$${(Number(chk.totalPrice || chk.subtotalPrice) || 0).toFixed(2)} in bag`,
      at: chk.abandonedAt || chk.createdAt || chk.updatedAt,
      recovered: Boolean(chk.recoveredAt)
    });
  }

  for (const enr of customerEnrollments) {
    timeline.push({
      kind: 'automation',
      title: `Enrolled in ${enr.sequenceName}`,
      description: `Status: ${enr.status} • Step ${(enr.currentStepIndex || 0) + 1}`,
      at: enr.enrolledAt
    });
  }

  for (const red of redirects) {
    timeline.push({
      kind: 'touch',
      title: `${red.channel === 'sms' ? 'SMS' : 'Email'} Delivered`,
      description: red.campaignId ? `Campaign: ${red.campaignId}` : 'Automation link touch',
      at: red.sentAt
    });
  }

  for (const ev of events) {
    timeline.push({
      kind: 'event',
      title: ev.event || ev.type || 'Storefront Interaction',
      description: ev.url || ev.description || '',
      at: ev.at || ev.timestamp
    });
  }

  timeline.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));

  let strategicAdvice = {
    title: 'Customer Engagement',
    actionText: 'Draft Broadcast',
    suggestedTemplate: 'regular',
    body: 'Regular subscriber with standard engagement.'
  };

  if (rfm.tier === 'whale') {
    if (rfm.isAtRisk) {
      strategicAdvice = {
        title: 'Priority At-Risk VIP Whale',
        actionText: 'Draft VIP Check-In',
        suggestedTemplate: 'at_risk_winback',
        body: `High lifetime value ($${rfm.totalSpent.toFixed(2)}) but inactive for ${rfm.recencyDays} days. Reach out personally before they lapse.`
      };
    } else {
      strategicAdvice = {
        title: 'Active VIP Whale (Top 2% Spender)',
        actionText: 'Draft VIP Thank-You',
        suggestedTemplate: 'whale_perk',
        body: `Top-spending customer with $${rfm.totalSpent.toFixed(2)} across ${rfm.ordersCount} orders. Thank them personally.`
      };
    }
  } else if (rfm.isAtRisk) {
    strategicAdvice = {
      title: 'At-Risk Customer',
      actionText: 'Draft Winback Check-In',
      suggestedTemplate: 'at_risk_winback',
      body: `Customer has not ordered in ${rfm.recencyDays} days (exceeds your ${rfmConfig.atRiskDays}d threshold). Re-engage with a personal check-in.`
    };
  } else if (rfm.ordersCount === 0) {
    strategicAdvice = {
      title: 'Top-of-Funnel Lead (0 Orders)',
      actionText: 'Draft First-Order Welcome',
      suggestedTemplate: 'lead_welcome',
      body: 'Lead has subscribed but has not yet placed their first order. Send a welcome note.'
    };
  } else if (rfm.ordersCount === 1) {
    strategicAdvice = {
      title: 'Single-Order Buyer',
      actionText: 'Encourage 2nd Order',
      suggestedTemplate: 'repeat_nurture',
      body: 'Ordered once. Suggest something that goes with their first order to invite a second.'
    };
  }

  const formattedOrders = orders.map(o => ({
    id: o.id || o.orderNumber || o.name,
    orderNumber: o.orderNumber || o.name || 'Store Order',
    totalPrice: Number(o.totalPrice) || 0,
    currency: o.currency || 'USD',
    financialStatus: o.financialStatus || 'paid',
    fulfillmentStatus: o.fulfillmentStatus || 'unfulfilled',
    createdAt: o.createdAt || o.processedAt || new Date().toISOString(),
    lineItems: Array.isArray(o.lineItems) ? o.lineItems.map(item => ({
      title: item.title || item.name || 'Product',
      quantity: Number(item.quantity) || 1,
      price: Number(item.price) || 0,
      imageUrl: item.imageUrl || item.image || ''
    })) : []
  }));

  const formattedCheckouts = checkouts.map(chk => ({
    id: chk.id || chk.token,
    totalPrice: Number(chk.totalPrice || chk.subtotalPrice) || 0,
    currency: chk.currency || 'USD',
    abandonedAt: chk.abandonedAt || chk.createdAt || new Date().toISOString(),
    recoveryStatus: chk.recoveryStatus || (chk.recoveredAt ? 'recovered' : 'abandoned'),
    abandonedCheckoutUrl: chk.abandonedCheckoutUrl || chk.checkoutUrl || '',
    lineItems: Array.isArray(chk.lineItems) ? chk.lineItems.map(item => ({
      title: item.title || item.name || 'Product',
      quantity: Number(item.quantity) || 1,
      price: Number(item.price) || 0
    })) : []
  }));

  res.json({
    success: true,
    contact: {
      ...contact,
      status: marketingStatus,
      rfmSegment: rfm.segment,
      rfmTier: rfm.tier,
      rfmBadge: rfm.badge,
      rfmColor: rfm.color,
      recencyDays: rfm.recencyDays,
      isVip: rfm.isVip,
      isAtRisk: rfm.isAtRisk,
      isLapsed: rfm.isLapsed
    },
    rfm,
    strategicAdvice,
    orders: formattedOrders,
    checkouts: formattedCheckouts,
    enrollments: customerEnrollments,
    timeline: timeline.slice(0, 50)
  });
});

app.post('/api/email/contact-tags', requireUser, async (req, res) => {
  const { email, tags } = req.body || {};
  const emailClean = String(email || '').toLowerCase().trim();
  if (!emailClean || !Array.isArray(tags)) {
    return res.status(400).json({ success: false, error: 'Valid email and tags array are required.' });
  }

  const allContacts = loadContacts();
  let contact = allContacts.find(c => contactOwnerId(c) === req.user.uid && String(c.email || '').toLowerCase().trim() === emailClean);
  const cleanTags = Array.from(new Set(tags.map(t => String(t || '').trim()).filter(Boolean)));

  if (!contact) {
    contact = {
      userId: req.user.uid,
      email: emailClean,
      name: emailClean.split('@')[0],
      tags: cleanTags,
      firstSeenAt: new Date().toISOString(),
      subscribedAt: new Date().toISOString()
    };
    allContacts.push(contact);
  } else {
    contact.tags = cleanTags;
  }

  saveContacts(allContacts);
  res.json({ success: true, tags: contact.tags });
});

app.get('/api/email/rfm-config', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  res.json({ success: true, config: cleanRfmConfig(bag.rfmConfig) });
});

app.post('/api/email/rfm-config', requireUser, async (req, res) => {
  const bag = userProgramBag(req.user.uid);
  const previousConfig = cleanRfmConfig(bag.rfmConfig);
  const willBeEnabled = Boolean(req.body?.autoWinbackEnabled);
  const enabledAt = (willBeEnabled && !previousConfig.autoWinbackEnabled)
    ? new Date().toISOString()
    : (willBeEnabled ? (previousConfig.autoWinbackEnabledAt || new Date().toISOString()) : null);

  const updated = cleanRfmConfig({
    ...req.body,
    autoWinbackEnabledAt: enabledAt
  });
  bag.rfmConfig = updated;
  writeUserPrograms(req.user.uid, bag);

  // Synchronize contacts with new thresholds
  const allContacts = loadContacts();
  let modifiedCount = 0;
  for (const c of allContacts) {
    if (contactOwnerId(c) !== req.user.uid) continue;
    const rfm = computeContactRfm(c, updated);
    if (syncContactRfmTags(c, rfm)) modifiedCount++;
  }
  if (modifiedCount > 0) {
    saveContacts(allContacts);
  }

  // Provision core discounts for Shopify workspace if connected
  const userWs = Object.values(workspaceCache).find(w => w.userId === req.user.uid && realStoreDomain(w.shopifyConfig));
  let discountResults = [];
  if (userWs) {
    discountResults = await ensureShopifyCoreDiscounts(userWs, updated.allowUnlimitedDiscountUse);
  }

  res.json({ success: true, config: updated, modifiedCount, discounts: discountResults });
});

function segmentContext(contact, bag, orders, events, account) {
  const email = String(contact?.email || '').toLowerCase();
  const stored = bag.profiles?.[email]?.properties || {};
  const props = contact?.properties && typeof contact.properties === 'object' && !Array.isArray(contact.properties) ? contact.properties : {};
  const profile = overlayPrediction({
    email,
    name: contact?.name || '',
    totalSpent: Number(contact?.totalSpent) || 0,
    ordersCount: Number(contact?.ordersCount) || 0,
    acceptsMarketing: contact?.acceptsMarketing === true,
    tags: Array.isArray(contact?.tags) ? contact.tags.join(',') : '',
    ...stored,
    ...props
  }, account?.rows?.[email]);
  const lists = [...new Set([...(Array.isArray(contact?.lists) ? contact.lists : []), ...(bag.profiles?.[email]?.lists || [])])];
  return {
    contact,
    eligible: !sendBlockReason(contact, bag.suppressions, true),
    profile,
    properties: profile,
    lists,
    event: {},
    orders: (orders || []).filter((order) => String(order.customerEmail || '').toLowerCase() === email).map((order) => ({ at: order.createdAt, createdAt: order.createdAt })),
    events: (events || []).filter((evt) => String(evt.email || '').toLowerCase() === email).map((evt) => ({ type: evt.type, at: evt.at })),
    canEmail: !sendBlockReason(contact, bag.suppressions, true),
    canText: null,
    now: Date.now()
  };
}

function accountEvents(uid) {
  const behavior = loadBehaviorBag(uid).events.filter((evt) => evt.email).map((evt) => ({ type: evt.type, at: evt.at, email: evt.email, userId: uid }));
  return [...loadEvents().filter((evt) => evt.userId === uid), ...behavior];
}

function audienceRows(uid) {
  const bag = userProgramBag(uid);
  const orders = loadOrders().filter((order) => order.userId === uid && !isDemoRecord(order));
  const events = accountEvents(uid);
  const account = predictionAccount(uid);
  return contactsForUser(uid).map((contact) => {
    const ctx = segmentContext(contact, bag, orders, events, account);
    const segments = [
      ...BUILT_INS.filter((row) => inBuiltIn(row.id, contact, ctx.eligible)).map((row) => row.id),
      ...bag.segments.filter((segment) => segmentMatches(segment, ctx)).map((segment) => segment.id)
    ];
    return {
      email: String(contact.email || '').toLowerCase(),
      name: contact.name || '',
      phone: contact.phone || '',
      lists: ctx.lists,
      segments,
      eligible: ctx.eligible,
      ctx
    };
  }).filter((row) => row.email.includes('@'));
}

async function noteSegmentChanges(uid) {
  if (!uid) return { entered: 0, byId: {} };
  const bag = userProgramBag(uid);
  const orders = loadOrders().filter((order) => order.userId === uid && !isDemoRecord(order));
  const events = accountEvents(uid);
  const contacts = contactsForUser(uid);
  const account = predictionAccount(uid);
  const contexts = contacts.map((contact) => segmentContext(contact, bag, orders, events, account));
  const nowIso = new Date().toISOString();
  const state = { ...(bag.segmentState || {}) };
  const byId = {};
  const consider = [
    ...BUILT_INS.map((row) => ({ id: row.id, builtin: true })),
    ...bag.segments.map((segment) => ({ id: segment.id, builtin: false, segment }))
  ];
  for (const item of consider) {
    const matching = [];
    for (const ctx of contexts) {
      const hit = item.builtin ? inBuiltIn(item.id, ctx.contact, ctx.eligible) : segmentMatches(item.segment, ctx);
      if (hit) matching.push(String(ctx.contact.email || '').toLowerCase());
    }
    const next = nextSegmentState(state[item.id], matching, nowIso, item.builtin ? 'quiet' : 'enter');
    state[item.id] = next.row;
    byId[item.id] = next.entered.length;
    for (const email of next.entered) {
      const ctx = contexts.find((row) => String(row.contact.email || '').toLowerCase() === email);
      await enrollFlowsForTrigger(uid, 'segment_entered', ctx?.contact || { email }, {}, {
        reason: 'segment',
        dedupe: `segment:${item.id}:${nowIso}`,
        occurrence: `segment:${item.id}:${nowIso}`,
        event: { segment_id: item.id }
      }, bag);
    }
  }
  bag.segmentState = state;
  writeUserPrograms(uid, bag);
  return { entered: Object.values(byId).reduce((sum, count) => sum + count, 0), byId };
}

function segmentMembers(uid, segmentId) {
  return audienceRows(uid).filter((row) => row.eligible && row.segments.includes(segmentId || 'all')).map((row) => (
    contactsForUser(uid).find((contact) => String(contact.email || '').toLowerCase() === row.email)
  )).filter(Boolean);
}

function presentCampaign(row) {
  const stats = messageStatsFor(row.userId, (item) => item.campaignId === row.id);
  if (stats.sent == null && Array.isArray(row.sentTo) && row.sentTo.length) stats.sent = row.sentTo.length;
  return {
    id: row.id,
    subject: row.subject,
    previewText: row.previewText || '',
    body: row.body || '',
    segment: row.segment || '',
    segmentName: row.segmentName || '',
    recipients: Number(row.recipients) || 0,
    recipientsCount: Number(row.recipientsCount ?? row.recipients) || 0,
    sentAt: row.sentAt || null,
    openRate: null,
    clickRate: null,
    attributedSales: stats.revenue,
    sent: stats.sent,
    delivered: stats.delivered,
    opened: stats.opened,
    clicked: stats.clicked,
    unsubscribed: stats.unsubscribed,
    revenue: stats.revenue,
    prefetchOpens: stats.prefetchOpens,
    holdout: row.holdout || null,
    holdoutReport: row.holdout?.enabled ? holdoutReport(
      (row.sentTo || []).map((email) => ({ email, at: row.holdoutAssignedAt || row.sentAt || '' })),
      row.heldOut || [],
      loadOrders().filter((order) => order.userId === row.userId && !isDemoRecord(order))
    ) : null,
    status: row.status || '',
    sendMode: row.sendMode,
    when: row.when || '',
    sendAt: row.sendAt || null,
    gradual: row.gradual || null,
    ab: row.ab ? { variable: row.ab.variable, winner: row.ab.winner || '', offsetHours: row.ab.offsetHours || 0 } : null,
    smartSkip: row.smartSkip === true,
    smartReport: row.smart?.report || '',
    followUp: null,
    followUpNote: FOLLOW_UP_NOTE,
    shopifyTagApplied: row.shopifyTagApplied,
    scheduledCount: Array.isArray(row.audience) ? row.audience.length : (Number(row.recipients) || 0),
    lastError: row.lastError || ''
  };
}

function knownPick(uid, pick) {
  const bag = userProgramBag(uid);
  if (pick.type === 'list') return bag.lists.some((list) => list.id === pick.id);
  return BUILT_INS.some((row) => row.id === pick.id) || bag.segments.some((segment) => segment.id === pick.id);
}

async function recentMarketing(uid, email, now) {
  const sinceEmail = now - SMART_EMAIL_HOURS * 3600000;
  const sinceSms = now - SMART_SMS_HOURS * 3600000;
  const own = loadEvents().filter((evt) => evt.userId === uid && String(evt.email || '').toLowerCase() === email && evt.transactional !== true);
  return {
    email: own.some((evt) => evt.type === 'email_sent' && new Date(evt.at || 0).getTime() >= sinceEmail),
    sms: own.some((evt) => evt.type === 'sms_sent' && new Date(evt.at || 0).getTime() >= sinceSms)
  };
}

async function deliverCampaignParts(uid, record, emailPeople, smsPeople, now) {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let held = 0;
  let lastError = '';
  record.sentTo = Array.isArray(record.sentTo) ? record.sentTo : [];
  record.skipped = Array.isArray(record.skipped) ? record.skipped : [];
  record.heldOut = Array.isArray(record.heldOut) ? record.heldOut : [];
  record.smsSentTo = Array.isArray(record.smsSentTo) ? record.smsSentTo : [];
  record.smsSkipped = Array.isArray(record.smsSkipped) ? record.smsSkipped : [];
  if (record.holdout?.enabled) {
    const at = record.holdoutAssignedAt || new Date(now).toISOString();
    record.holdoutAssignedAt = at;
    const already = new Set(record.heldOut.map((row) => row.email));
    const split = splitHoldout(emailPeople.filter((person) => !already.has(person.email)), record.holdout, record.id, at);
    for (const row of split.held) {
      record.heldOut.push(row);
      record.skipped.push(row.email);
      recordEvent({ type: 'email_held', userId: uid, email: row.email, campaignId: record.id, at });
      held += 1;
    }
    emailPeople = split.send;
  }
  const broadcastRedirectBatch = [];
  for (const person of emailPeople) {
    const recent = await recentMarketing(uid, person.email, now);
    if (smartSkipReason('email', { enabled: record.smartSkip === true, ...recent })) {
      record.skipped.push(person.email);
      skipped += 1;
      continue;
    }
    const contact = contactsForUser(uid).find((row) => String(row.email || '').toLowerCase() === person.email) || person;
    const subject = person.side === 'b' && record.ab?.variable === 'subject' ? record.ab.subjectB : record.subject;
    const body = person.side === 'b' && record.ab?.variable === 'content' ? record.ab.bodyB : (record.body || '');
    const useBlocks = Array.isArray(record.blocks) && record.blocks.length && !(person.side === 'b' && record.ab?.variable === 'content');
    const sourceBlocks = useBlocks ? record.blocks : [{ kind: 'text', text: body || record.html || '' }];
    const ws = Object.values(workspaceCache).find((w) => w.userId === uid);
    const storeName = ws?.shopifyConfig?.shopName || ws?.name || 'our store';
    // No discount_code: WELCOMEBACK15 filled it on every broadcast, a code the merchant never chose (R24).
    const letter = await composeForSend(uid, contact, sourceBlocks, {
      store_name: storeName
    }, { previewText: record.previewText, marketing: true, embedPreheader: true });
    const result = await deliverLetter({
      to: person.email,
      name: person.name,
      subject: fillMailTokens(subject, letter.vars).slice(0, 200),
      text: letter.text,
      html: applyUtm(letter.html, record.utm),
      previewText: record.previewText,
      userId: uid,
      visitorId: contact.visitorId,
      medium: 'broadcast',
      marketing: true,
      campaignId: record.id,
      redirectBatch: broadcastRedirectBatch
    });
    if (!result.ok) {
      if (result.status === 'unsubscribed' || result.status === 'suppressed') record.skipped.push(person.email);
      failed += 1;
      lastError = result.error || result.status;
      continue;
    }
    record.sentTo.push(person.email);
    sent += 1;
  }
  if (broadcastRedirectBatch.length) {
    rememberRedirectsBatch(broadcastRedirectBatch);
  }
  for (const person of smsPeople) {
    const until = smsQuietEnabled({ transactional: false, quietHours: record.sms?.quietHours }) ? quietOpenAt(now, userProgramBag(uid).timezone) : null;
    if (until && until > now + 999) {
      record.smsQuietUntil = new Date(until).toISOString();
      record.smsNote = 'Quiet hours. This text waits until the window opens.';
      continue;
    }
    if (record.sms?.confirm !== true) {
      record.smsSkipped.push(person.email);
      skipped += 1;
      record.smsNote = 'The text was not sent because opt-in was not confirmed.';
      continue;
    }
    const recent = await recentMarketing(uid, person.email, now);
    if (smartSkipReason('sms', { enabled: record.smartSkip === true, ...recent })) {
      record.smsSkipped.push(person.email);
      skipped += 1;
      continue;
    }
    const optedIn = await textConsentKnown(person.email, person.phone);
    if (optedIn !== true || !person.phone) {
      record.smsSkipped.push(person.email);
      skipped += 1;
      record.smsNote = 'The text was not sent because this number is not on the opted-in list.';
      continue;
    }
    try {
      const messageId = `msg_${crypto.randomBytes(6).toString('hex')}`;
      const prepared = await prepareSmsMessage(uid, record.sms.message, {
        email: person.email, coupon: record.sms.coupon, messageId, campaignId: record.id, utm: { utm_source: 'sms', utm_medium: 'broadcast' }
      });
      const sentSms = await hub.email.sms.send({ message: prepared.text, recipients: [{ email: person.email, phone: person.phone, name: person.name || '' }] });
      const blast = sentSms?.blast;
      if (!sentSms || sentSms.success === false || sentSms.error || (blast && (blast.sent || 0) === 0)) {
        failed += 1;
        lastError = sentSms?.error || 'The text was not sent.';
        continue;
      }
      recordEvent({ type: 'sms_sent', userId: uid, email: person.email, utm_source: 'sms', utm_medium: 'broadcast', transactional: false, messageId, campaignId: record.id });
      record.smsSentTo.push(person.email);
      sent += 1;
    } catch (err) {
      failed += 1;
      lastError = err.message || 'The text was not sent.';
    }
  }
  record.recipients = (record.sentTo.length || 0);
  record.recipientsCount = record.recipients;
  record.lastError = lastError;
  return { sent, failed, skipped, held, lastError };
}

function unfinishedPeople(audience, sentTo, skipped) {
  const done = new Set([...(sentTo || []), ...(skipped || [])]);
  return (audience || []).filter((person) => person?.email && !done.has(person.email));
}

function finishCampaign(record, now) {
  const emailLeft = unfinishedPeople(record.audience, record.sentTo, record.skipped);
  const smsLeft = unfinishedPeople(record.smsAudience, record.smsSentTo, record.smsSkipped);
  if (!emailLeft.length && !smsLeft.length) {
    record.status = record.recipients && record.lastError ? 'partial' : 'sent';
    record.sentAt = record.sentAt || new Date(now).toISOString();
    record.nextAt = '';
    record.smsQuietUntil = '';
    return;
  }
  if (record.smsQuietUntil && Date.parse(record.smsQuietUntil) > now && smsLeft.length) {
    record.status = 'sending';
    record.nextAt = record.smsQuietUntil;
    return;
  }
  record.status = 'sending';
  if (record.when === 'smart' && record.gradual) record.nextAt = nextBatchAt(record, now);
  else if (record.when === 'smart') {
    const times = [...emailLeft, ...smsLeft].map((person) => Date.parse(person?.smart?.sendAt || '')).filter((at) => Number.isFinite(at));
    record.nextAt = times.length ? new Date(Math.min(...times)).toISOString() : new Date(now).toISOString();
  } else record.nextAt = record.when === 'gradual' ? nextBatchAt(record, now) : (record.sendAt || new Date(now).toISOString());
}

async function processDueCampaigns(uid) {
  const now = Date.now();
  const campaigns = loadCampaigns();
  let sent = 0;
  let changed = false;
  for (const record of campaigns) {
    if (record.userId !== uid || record.sendMode === 'shopify_push') continue;
    if (record.status !== 'scheduled' && record.status !== 'sending') continue;
    if (record.nextAt && record.status === 'sending' && new Date(record.nextAt).getTime() > now) continue;
    const emailDue = dueRecipients(record, now);
    const smsRecord = { ...record, audience: record.smsAudience || [], sentTo: record.smsSentTo || [], skipped: record.smsSkipped || [] };
    const smsDue = record.sms?.message ? dueRecipients(smsRecord, now) : { due: [] };
    if (!emailDue.due.length && !smsDue.due.length) continue;
    const result = await deliverCampaignParts(uid, record, emailDue.due, smsDue.due, now);
    finishCampaign(record, now);
    sent += result.sent;
    changed = true;
  }
  if (changed) saveCampaigns(campaigns);
  return { sent };
}

function segmentLabel(uid, id) {
  return BUILT_INS.find((row) => row.id === id)?.name
    || userProgramBag(uid).segments.find((row) => row.id === id)?.name
    || userProgramBag(uid).lists.find((row) => row.id === id)?.name
    || id;
}

app.get('/api/email/segments', requireUser, async (req, res) => {
  const bag = userProgramBag(req.user.uid);
  const rows = audienceRows(req.user.uid);
  const segments = [
    ...BUILT_INS.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.definition,
      definition: row.definition,
      count: rows.filter((person) => person.segments.includes(row.id)).length,
      filterKey: row.id,
      builtin: true
    })),
    ...bag.segments.map((segment) => ({
      id: segment.id,
      name: segment.name,
      description: segmentDefinition(segment),
      definition: segmentDefinition(segment),
      count: rows.filter((person) => person.segments.includes(segment.id)).length,
      filterKey: 'custom',
      builtin: false,
      join: segment.join,
      groups: segment.groups
    }))
  ];
  res.json({
    success: true,
    totalAudience: contactsForUser(req.user.uid).length,
    segments,
    followUpNote: FOLLOW_UP_NOTE
  });
});

app.get('/api/email/lists', requireUser, (req, res) => {
  const lists = userProgramBag(req.user.uid).lists.map((list) => ({
    ...list,
    count: contactsForUser(req.user.uid).filter((contact) => (contact.lists || []).includes(list.id)).length
  }));
  res.json({ success: true, lists });
});

app.post('/api/email/lists', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  if (bag.lists.length >= 50) return res.status(400).json({ success: false, error: 'This account already has 50 lists.' });
  const list = { id: `list_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: String(req.body?.name || 'List').slice(0, 80), createdAt: new Date().toISOString() };
  bag.lists.unshift(list);
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, list: { ...list, count: 0 } });
});

app.delete('/api/email/lists/:id', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  bag.lists = bag.lists.filter((list) => list.id !== req.params.id);
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true });
});

app.post('/api/email/lists/:id/members', requireUser, async (req, res) => {
  const bag = userProgramBag(req.user.uid);
  const list = bag.lists.find((row) => row.id === req.params.id);
  if (!list) return res.status(404).json({ success: false, error: 'That list is not on this account.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const contacts = loadContacts();
  const contact = contacts.find((row) => String(row.email || '').toLowerCase() === email && contactOwnerId(row) === req.user.uid);
  if (!contact) return res.status(404).json({ success: false, error: 'That person is not on this account.' });
  const update = req.body?.update === 'remove' ? 'remove' : 'add';
  const change = applyListChange(contact.lists, list.id, update);
  contact.lists = change.next;
  saveContacts(contacts);
  let started = 0;
  if (change.added) {
    const enrolled = await enrollFlowsForTrigger(req.user.uid, 'list_added', contact, {}, {
      listId: list.id,
      reason: 'list',
      dedupe: `list:${list.id}`,
      occurrence: `list:${list.id}:${new Date().toISOString()}`,
      event: { list_id: list.id }
    });
    started = enrolled.added;
  }
  await noteSegmentChanges(req.user.uid);
  const saved = loadContacts().find((row) => String(row.email || '').toLowerCase() === email && contactOwnerId(row) === req.user.uid);
  res.json({
    success: true,
    added: change.added,
    removed: change.removed,
    acceptsMarketing: saved?.acceptsMarketing === true,
    enrolled: started
  });
});

app.post('/api/email/segments', requireUser, async (req, res) => {
  const bag = userProgramBag(req.user.uid);
  if (bag.segments.length >= 50) return res.status(400).json({ success: false, error: 'This account already has 50 segments.' });
  const id = `seg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const cleaned = cleanSegment({ ...req.body, id });
  if (!cleaned.ok) return res.status(400).json({ success: false, error: cleaned.error });
  bag.segments.unshift(cleaned.segment);
  writeUserPrograms(req.user.uid, bag);
  const noted = await noteSegmentChanges(req.user.uid);
  res.json({ success: true, segment: { ...cleaned.segment, definition: segmentDefinition(cleaned.segment) }, entered: noted.byId[id] || 0 });
});

app.post('/api/email/segments/:id', requireUser, async (req, res) => {
  if (BUILT_INS.some((row) => row.id === req.params.id)) return res.status(400).json({ success: false, error: 'That built-in segment stays as it is.' });
  const bag = userProgramBag(req.user.uid);
  const index = bag.segments.findIndex((row) => row.id === req.params.id);
  if (index < 0) return res.status(404).json({ success: false, error: 'That segment is not on this account.' });
  const cleaned = cleanSegment({ ...bag.segments[index], ...req.body, id: req.params.id });
  if (!cleaned.ok) return res.status(400).json({ success: false, error: cleaned.error });
  bag.segments[index] = cleaned.segment;
  writeUserPrograms(req.user.uid, bag);
  const noted = await noteSegmentChanges(req.user.uid);
  res.json({ success: true, segment: cleaned.segment, entered: noted.byId[req.params.id] || 0 });
});

app.post('/api/email/segments/:id/refresh', requireUser, async (req, res) => {
  const known = BUILT_INS.some((row) => row.id === req.params.id) || userProgramBag(req.user.uid).segments.some((row) => row.id === req.params.id);
  if (!known) return res.status(404).json({ success: false, error: 'That segment is not on this account.' });
  const noted = await noteSegmentChanges(req.user.uid);
  res.json({ success: true, entered: noted.byId[req.params.id] || 0 });
});

app.delete('/api/email/segments/:id', requireUser, (req, res) => {
  if (BUILT_INS.some((row) => row.id === req.params.id)) return res.status(400).json({ success: false, error: 'That built-in segment stays as it is.' });
  const bag = userProgramBag(req.user.uid);
  bag.segments = bag.segments.filter((row) => row.id !== req.params.id);
  if (bag.segmentState) delete bag.segmentState[req.params.id];
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true });
});

app.delete('/api/email/campaigns/:id', requireUser, (req, res) => {
  const campaigns = loadCampaigns();
  const row = campaigns.find((item) => item.id === req.params.id && item.userId === req.user.uid);
  if (!row) return res.status(404).json({ success: false, error: 'That campaign is not on this account.' });
  if (row.sentAt || (row.sentTo || []).length || (row.smsSentTo || []).length) {
    return res.status(400).json({ success: false, error: 'That campaign already sent, so it was left in place.' });
  }
  saveCampaigns(campaigns.filter((item) => item.id !== row.id));
  res.json({ success: true });
});

app.post('/api/email/campaigns/:id/winner', requireUser, (req, res) => {
  const winner = req.body?.winner === 'a' || req.body?.winner === 'b' ? req.body.winner : '';
  if (!winner) return res.status(400).json({ success: false, error: 'Choose version A or version B.' });
  const campaigns = loadCampaigns();
  const row = campaigns.find((item) => item.id === req.params.id && item.userId === req.user.uid);
  if (!row?.ab) return res.status(400).json({ success: false, error: 'This campaign has no A/B test.' });
  row.ab.winner = winner;
  saveCampaigns(campaigns);
  res.json({ success: true, campaign: presentCampaign(row), message: 'Winner saved. Nothing was sent.' });
});

// Send Segmented Campaign (Direct Delivery or 1-Click Shopify Email Segment Push)
app.post('/api/email/campaign/send', requireUser, async (req, res) => {
  const { subject, previewText, body, bodyText, html, segmentId, sendMode } = req.body || {};
  const blocks = Array.isArray(req.body?.blocks) ? cleanBlocks(req.body.blocks, []) : [];
  const emailBody = body || bodyText || '';
  const emailHtml = typeof html === 'string' ? html : '';
  const smsMessage = String(req.body?.smsMessage || '').trim().slice(0, 480);
  const hasEmail = Boolean(subject && (emailBody || emailHtml.trim() || blocks.length));
  const hasSms = Boolean(smsMessage);
  if (!hasEmail && !hasSms) return res.status(400).json({ success: false, error: 'Subject and email body are required.' });
  const holdout = cleanHoldout(req.body?.holdout);
  if (!holdout.ok) return res.status(400).json({ success: false, error: holdout.error });
  const mode = sendMode === 'shopify_push' ? 'shopify_push' : 'direct';
  const schedule = campaignSchedule({
    when: req.body?.when,
    sendAt: req.body?.sendAt,
    timezone: userProgramBag(req.user.uid).timezone,
    gradual: req.body?.gradual
  });
  if (!schedule.ok) return res.status(400).json({ success: false, error: schedule.error });
  if (mode === 'shopify_push' && schedule.when !== 'now') {
    return res.status(400).json({ success: false, error: 'Scheduling sends from Jourvance. Shopify tagging runs when you choose send now.' });
  }
  const ab = cleanAb(req.body?.ab);
  if (!ab.ok) return res.status(400).json({ success: false, error: ab.error });
  if (smartSendConflict(schedule.when, ab.ab)) {
    return res.status(400).json({ success: false, error: 'Smart send does not combine with a send-time A/B.' });
  }
  const fallback = schedule.when === 'smart' ? cleanFallbackHour(req.body?.fallbackHour) : { ok: true, hour: null };
  if (!fallback.ok) return res.status(400).json({ success: false, error: fallback.error });
  let include = cleanPicks(req.body?.include);
  if (!include.ok) return res.status(400).json({ success: false, error: include.error });
  if (!include.picks.length) include = { ok: true, picks: [{ type: 'segment', id: String(segmentId || 'all').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'all' }] };
  const exclude = cleanPicks(req.body?.exclude);
  if (!exclude.ok) return res.status(400).json({ success: false, error: exclude.error });
  let smsInclude = cleanPicks(req.body?.smsInclude);
  if (!smsInclude.ok) return res.status(400).json({ success: false, error: smsInclude.error });
  if (!smsInclude.picks.length) smsInclude = include;
  for (const pick of [...include.picks, ...exclude.picks, ...smsInclude.picks]) {
    if (!knownPick(req.user.uid, pick)) return res.status(400).json({ success: false, error: 'That list or segment is not on this account.' });
  }
  const eligible = audienceRows(req.user.uid).filter((row) => row.eligible);
  const people = hasEmail ? resolveAudience(eligible, include.picks, exclude.picks) : [];
  const smsPeople = hasSms ? resolveAudience(eligible, smsInclude.picks, exclude.picks) : [];
  if ((hasEmail && !people.length) || (!hasEmail && !smsPeople.length)) {
    return res.status(400).json({ success: false, error: 'No contacts match that segment, so nothing was sent.' });
  }
  if (mode === 'shopify_push') {
    const tagToApply = `jourvance-segment-${include.picks[0]?.id || 'all'}`;
    const all = loadContacts();
    const wanted = new Set(people.map((person) => person.email));
    for (const contact of all) {
      if (contactOwnerId(contact) !== req.user.uid || !wanted.has(String(contact.email || '').toLowerCase())) continue;
      if (!contact.tags) contact.tags = [];
      if (!contact.tags.includes(tagToApply)) contact.tags.push(tagToApply);
    }
    saveContacts(all);
    const campaignRecord = {
      id: `camp_${Date.now()}`,
      subject,
      previewText: previewText || '',
      body: emailBody,
      segment: include.picks[0]?.id || 'all',
      segmentName: include.picks.map((pick) => segmentLabel(req.user.uid, pick.id)).join(', '),
      recipients: people.length,
      recipientsCount: people.length,
      sentAt: null,
      openRate: null,
      clickRate: null,
      attributedSales: null,
      status: 'tagged-locally',
      sendMode: mode,
      userId: req.user.uid,
      shopifyTagApplied: tagToApply,
      followUp: null
    };
    const campaigns = loadCampaigns();
    campaigns.unshift(campaignRecord);
    saveCampaigns(campaigns);
    return res.json({
      success: true,
      campaign: presentCampaign(campaignRecord),
      recipientCount: people.length,
      recipientsCount: people.length,
      followUp: null,
      followUpNote: FOLLOW_UP_NOTE,
      appliedShopifyTag: tagToApply,
      message: `Tagged ${people.length} contacts here as ${tagToApply}. Shopify was not emailed.`
    });
  }
  const record = {
    id: `camp_${Date.now().toString(36)}`,
    userId: req.user.uid,
    subject: String(subject || 'Text message').slice(0, 200),
    previewText: String(previewText || '').slice(0, 140),
    body: emailBody,
    html: emailHtml,
    blocks,
    segment: include.picks[0]?.id || 'all',
    segmentName: include.picks.map((pick) => segmentLabel(req.user.uid, pick.id)).join(', ').slice(0, 180),
    include: include.picks,
    exclude: exclude.picks,
    when: schedule.when,
    sendAt: schedule.sendAt,
    gradual: schedule.gradual,
    ab: ab.ab,
    utm: cleanUtm(req.body?.utm),
    smartSkip: req.body?.smartSkip === true,
    holdout: holdout.holdout,
    heldOut: [],
    audience: people,
    smsAudience: smsPeople,
    sms: hasSms ? { message: smsMessage, confirm: req.body?.smsConfirm === 'opted-in' || req.body?.confirm === 'opted-in' } : null,
    sentTo: [],
    skipped: [],
    smsSentTo: [],
    smsSkipped: [],
    recipients: 0,
    recipientsCount: 0,
    sentAt: null,
    openRate: null,
    clickRate: null,
    attributedSales: null,
    status: 'scheduled',
    sendMode: 'direct',
    followUp: null,
    nextAt: ''
  };
  if (schedule.when === 'smart') {
    const zoneFor = (email) => {
      const contact = contactsForUser(req.user.uid).find((row) => String(row.email || '').toLowerCase() === email);
      const zone = contact?.timezone || contact?.properties?.timezone;
      return isIanaTimezone(zone) ? zone : '';
    };
    const seen = new Set();
    const recipients = [];
    for (const person of [...people, ...smsPeople]) {
      if (seen.has(person.email)) continue;
      seen.add(person.email);
      recipients.push({ email: person.email, timezone: zoneFor(person.email) });
    }
    const plan = assignSmartSend({
      people: recipients,
      events: accountEvents(req.user.uid),
      now: Date.now(),
      accountTimezone: userProgramBag(req.user.uid).timezone,
      fallbackHour: fallback.hour,
      explore: req.body?.explore === true,
      seed: record.id
    });
    const byEmail = new Map(plan.assignments.map((row) => [row.email, { rule: row.rule, hour: row.hour, sampleSize: row.sampleSize, sendAt: row.sendAt }]));
    record.audience = people.map((person) => ({ ...person, smart: byEmail.get(person.email) || null }));
    record.smsAudience = smsPeople.map((person) => ({ ...person, smart: byEmail.get(person.email) || null }));
    record.smart = { fallbackHour: fallback.hour, explore: req.body?.explore === true, batches: plan.batches, report: plan.report };
  }
  const campaigns = loadCampaigns();
  if (schedule.waiting) {
    campaigns.unshift(record);
    saveCampaigns(campaigns);
    return res.json({
      success: true,
      campaign: presentCampaign(record),
      recipientCount: 0,
      recipientsCount: 0,
      followUp: null,
      followUpNote: FOLLOW_UP_NOTE,
      smartReport: record.smart?.report || '',
      message: 'Scheduled. Nothing was sent.'
    });
  }
  if (hasEmail && !hubReady) return res.status(503).json({ success: false, error: 'Email sending is not connected, so nothing was sent.' });
  const now = Date.now();
  const emailDue = dueRecipients(record, now);
  const smsDue = record.sms?.message ? dueRecipients({ ...record, audience: record.smsAudience, sentTo: [], skipped: [] }, now) : { due: [] };
  const result = await deliverCampaignParts(req.user.uid, record, emailDue.due, smsDue.due, now);
  if (!result.sent && result.failed && !result.skipped && !result.held) {
    return res.status(502).json({ success: false, error: result.lastError || 'The email service rejected the send.', failed: result.failed, followUp: null, followUpNote: FOLLOW_UP_NOTE });
  }
  finishCampaign(record, now);
  campaigns.unshift(record);
  saveCampaigns(campaigns);
  res.json({
    success: true,
    campaign: presentCampaign(record),
    recipientCount: result.sent,
    recipientsCount: result.sent,
    failed: result.failed,
    skipped: result.skipped,
    followUp: null,
    followUpNote: FOLLOW_UP_NOTE,
    message: `Sent to ${result.sent} recipients.${result.failed ? ` ${result.failed} were not sent.` : ''}${result.skipped ? ` ${result.skipped} were skipped.` : ''}${result.held ? ` ${result.held} were held out and received nothing.` : ''}`
  });
});

// ── Wave 7: Automated Lead Nurture Drips API ──────────────────────────────────

app.get('/api/drips/sequences', requireUser, async (req, res) => {
  const { sequences } = loadDrips();
  res.json({
    success: true,
    sequences: sequences.map((seq) => ({ ...seq, attributedSales: sequenceRevenue(req.user.uid, seq.id) })),
    revenueNote: 'Last-touch revenue uses a click within 5 days, or an open within 5 days when there is no click. Blank until one of those is stored.'
  });
});

app.post('/api/drips/sequences', requireUser, async (req, res) => {
  const { name, description, triggerType, smartExitOnPurchase, steps } = req.body || {};
  if (!name || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ success: false, error: 'Sequence name and at least one step are required.' });
  }

  const dripsData = loadDrips();
  const newSeq = {
    id: `drip_seq_${Date.now()}`,
    name,
    description: description || 'Automated lead nurture drip workflow.',
    triggerType: triggerType || 'lead_capture',
    smartExitOnPurchase: smartExitOnPurchase !== false,
    steps: steps.map((st, idx) => ({
      id: st.id || `step_${idx + 1}`,
      stepNumber: idx + 1,
      delayHours: Number(st.delayHours ?? (idx * 24)),
      subject: st.subject || 'Automated Nurture Step',
      previewText: st.previewText || '',
      body: st.body || '',
      discountVoucher: st.discountVoucher || ''
    })),
    activeEnrollments: 0,
    totalCompleted: 0,
    totalExitedPurchased: 0,
    attributedSales: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  dripsData.sequences.unshift(newSeq);
  saveDrips(dripsData);

  res.json({ success: true, sequence: newSeq });
});

app.get('/api/drips/enrollments', requireUser, async (req, res) => {
  const { enrollments } = loadDrips();
  const mine = enrollments.filter(e => e.userId === req.user.uid);
  res.json({ success: true, enrollments: mine.slice(0, 100) });
});

app.post('/api/drips/enroll', requireUser, async (req, res) => {
  const { sequenceId, customerEmail, customerName, sourceSlug } = req.body || {};
  if (!customerEmail || !customerEmail.includes('@')) {
    return res.status(400).json({ success: false, error: 'Valid customer email is required.' });
  }

  const dripsData = loadDrips();
  const seq = dripsData.sequences.find(s => s.id === (sequenceId || 'drip_seq_default')) || dripsData.sequences[0];
  if (!seq) {
    return res.status(404).json({ success: false, error: 'Drip sequence not found.' });
  }

  const alreadyActive = dripsData.enrollments.find(e => e.customerEmail === customerEmail.toLowerCase().trim() && e.sequenceId === seq.id && e.status === 'active');
  if (alreadyActive) {
    return res.json({ success: true, message: 'Contact is already active in this sequence.', enrollment: alreadyActive });
  }

  const enrollment = {
    id: `enr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sequenceId: seq.id,
    userId: req.user.uid,
    customerEmail: customerEmail.toLowerCase().trim(),
    customerName: customerName || customerEmail.split('@')[0],
    sourceSlug: sourceSlug || 'direct',
    currentStepIndex: 0,
    status: 'active',
    enrolledAt: new Date().toISOString(),
    nextStepDueAt: new Date().toISOString(),
    history: []
  };

  dripsData.enrollments.unshift(enrollment);
  seq.activeEnrollments = (seq.activeEnrollments || 0) + 1;
  saveDrips(dripsData);

  res.json({ success: true, enrollment });
});

app.post('/api/drips/enrollment-toggle', requireUser, async (req, res) => {
  const { enrollmentId, action } = req.body || {};
  if (!enrollmentId || !['pause', 'resume', 'cancel'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Valid enrollmentId and action (pause, resume, cancel) are required.' });
  }

  const dripsData = loadDrips();
  const enr = (dripsData.enrollments || []).find(e => e.id === enrollmentId && e.userId === req.user.uid);
  if (!enr) {
    return res.status(404).json({ success: false, error: 'Enrollment not found.' });
  }

  if (action === 'pause') {
    enr.status = 'paused';
  } else if (action === 'resume') {
    enr.status = 'active';
  } else if (action === 'cancel') {
    enr.status = 'cancelled';
  }

  saveDrips(dripsData);
  res.json({ success: true, enrollment: enr });
});

app.get('/api/email/predictions', requireUser, (req, res) => {
  const result = predictStore(accountOrders(req.user.uid), Date.now());
  res.json({ success: true, ...publicPrediction(result) });
});

app.post('/api/email/predictions/refresh', requireUser, async (req, res) => {
  try {
    const result = await refreshPredictions(req.user.uid);
    res.json({
      success: true,
      ...publicPrediction(result),
      message: result.ready ? 'Predicted value was recomputed from this store’s orders.' : 'Predicted value was not saved. This store’s history is still too thin.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Predicted value was not computed.' });
  }
});



  return {
    noteSegmentChanges,
    processDueCampaigns
  };
}
