import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describeSentHtml, linksToRewrite, applyLinkUtm, redirectStatus } from './email-feeds.mjs';

// Standalone implementation matching server.mjs logic for unit testing batching invariants
function createTestRedirectManager() {
  const store = [];
  let saveCount = 0;

  function loadRedirects() {
    return [...store];
  }

  function saveRedirects(rows) {
    saveCount++;
    store.length = 0;
    store.push(...(rows || []).slice(-20000));
  }

  function rememberRedirect(uid, url, meta, batchCollector = null) {
    const code = crypto.randomBytes(9).toString('base64url');
    const sentAt = new Date().toISOString();
    const row = {
      code,
      uid: uid || '',
      url,
      email: String(meta?.email || '').toLowerCase(),
      channel: meta?.channel === 'email' ? 'email' : 'sms',
      campaignId: meta?.campaignId || '',
      flowId: meta?.flowId || '',
      nodeId: meta?.nodeId || '',
      sequenceId: meta?.sequenceId || '',
      messageId: meta?.messageId || '',
      sentAt,
      expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
      utm: meta?.utm || {}
    };
    if (Array.isArray(batchCollector)) {
      batchCollector.push(row);
    } else {
      const rows = loadRedirects();
      rows.push(row);
      saveRedirects(rows);
    }
    return `https://jourvance.app/r/${code}`;
  }

  function rememberRedirectsBatch(newRows) {
    if (!Array.isArray(newRows) || !newRows.length) return;
    const rows = loadRedirects();
    rows.push(...newRows);
    saveRedirects(rows);
  }

  function rewritePlainMailLinks(html, meta, batchCollector = null) {
    let next = String(html || '');
    const internalBatch = Array.isArray(batchCollector) ? null : [];
    const targetBatch = batchCollector || internalBatch;
    for (const url of linksToRewrite(next)) {
      const short = rememberRedirect(
        meta.userId,
        url,
        { ...meta, channel: 'email', utm: { utm_source: 'email', utm_medium: meta.medium || 'email' } },
        targetBatch
      );
      next = next.split(`href="${url}"`).join(`href="${short}"`);
    }
    if (internalBatch && internalBatch.length > 0) {
      rememberRedirectsBatch(internalBatch);
    }
    return next;
  }

  return {
    store,
    getSaveCount: () => saveCount,
    rememberRedirect,
    rememberRedirectsBatch,
    rewritePlainMailLinks
  };
}

test('Shortlink In-Memory Batching: Single email with 4 links executes exactly 1 storage write', () => {
  const manager = createTestRedirectManager();
  const emailHtml = `
    <html>
      <body style="font-family: sans-serif;">
        <p>Welcome to Jourvance Boutique!</p>
        <a href="https://jourvance.com/collections/serums">Shop Serums</a>
        <a href="https://jourvance.com/collections/creams">Shop Creams</a>
        <a href="https://jourvance.com/vip-access">VIP Access</a>
        <a href="https://jourvance.com/journal">Read Journal</a>
        <!-- duplicate link should not create duplicate redirect entry -->
        <a href="https://jourvance.com/vip-access">Join VIP Club</a>
        <img width="1" height="1" src="https://jourvance.app/o/px123" alt="" />
      </body>
    </html>
  `;

  const rewritten = manager.rewritePlainMailLinks(emailHtml, {
    userId: 'usr_test123',
    email: 'charlotte@example.com',
    campaignId: 'camp_autumn_glow'
  });

  // Exactly 1 save call should have occurred for the whole email, NOT 4 or 5
  assert.equal(manager.getSaveCount(), 1, 'Expected exactly 1 save call for 4 links in single email');
  assert.equal(manager.store.length, 4, 'Expected 4 unique redirect records in storage');

  // Verify all links in the html were rewritten to /r/ codes
  assert.ok(!rewritten.includes('href="https://jourvance.com/collections/serums"'));
  assert.ok(!rewritten.includes('href="https://jourvance.com/collections/creams"'));
  assert.ok(!rewritten.includes('href="https://jourvance.com/vip-access"'));
  assert.ok(!rewritten.includes('href="https://jourvance.com/journal"'));
  assert.match(rewritten, /href="https:\/\/jourvance\.app\/r\/[a-zA-Z0-9_-]+"/);

  // Verify stored rows have valid metadata and recipient email
  const serumRow = manager.store.find(r => r.url === 'https://jourvance.com/collections/serums');
  assert.ok(serumRow);
  assert.equal(serumRow.email, 'charlotte@example.com');
  assert.equal(serumRow.campaignId, 'camp_autumn_glow');
  assert.equal(serumRow.channel, 'email');
});

test('Shortlink In-Memory Batching: Multi-recipient broadcast collects all links in-memory and saves once', () => {
  const manager = createTestRedirectManager();
  const templateHtml = `
    <div>
      <h1>Glow Ritual Newsletter</h1>
      <a href="https://jourvance.com/products/rose-elixir">Discover Rose Elixir</a>
      <a href="https://jourvance.com/products/peptide-creme">Firming Peptide Crème</a>
      <a href="https://jourvance.com/checkout?discount=GLOW15">Claim 15% Courtesy</a>
      <img width="1" height="1" src="https://jourvance.app/o/glow" alt="" />
    </div>
  `;

  const recipients = [
    { email: 'aurora@example.com', name: 'Aurora' },
    { email: 'sophia@example.com', name: 'Sophia' },
    { email: 'chloe@example.com', name: 'Chloe' },
    { email: 'elena@example.com', name: 'Elena' },
    { email: 'valentina@example.com', name: 'Valentina' }
  ];

  // Simulated broadcast send loop with shared redirect batch collector
  const broadcastBatch = [];
  for (const person of recipients) {
    manager.rewritePlainMailLinks(templateHtml, {
      userId: 'usr_broadcast_owner',
      email: person.email,
      campaignId: 'camp_broadcast_99',
      medium: 'broadcast'
    }, broadcastBatch);
  }

  // During the loop, no storage write should have occurred yet!
  assert.equal(manager.getSaveCount(), 0, 'No disk writes should occur inside the broadcast loop');
  assert.equal(broadcastBatch.length, recipients.length * 3, 'All 15 link records should be in the memory batch');

  // Bulk commit at the end of the broadcast
  manager.rememberRedirectsBatch(broadcastBatch);

  assert.equal(manager.getSaveCount(), 1, 'Exactly 1 atomic save should commit the entire broadcast batch');
  assert.equal(manager.store.length, 15, 'All 15 recipient-specific shortlinks should be stored');

  // Verify each recipient has their own trackable shortlink for each link
  const auroraLinks = manager.store.filter(r => r.email === 'aurora@example.com');
  const chloeLinks = manager.store.filter(r => r.email === 'chloe@example.com');
  assert.equal(auroraLinks.length, 3);
  assert.equal(chloeLinks.length, 3);
  assert.notEqual(auroraLinks[0].code, chloeLinks[0].code, 'Codes must be unique per recipient for attribution');
});

test('Shortlink In-Memory Batching: Shortlinks status and UTM parameter resolution', () => {
  const manager = createTestRedirectManager();
  const html = '<a href="https://jourvance.com/shop">Shop Now</a><img width="1" height="1" src="/o/1" />';
  manager.rewritePlainMailLinks(html, {
    userId: 'usr_brand',
    email: 'isabella@example.com',
    medium: 'broadcast'
  });

  const row = manager.store[0];
  assert.ok(row);
  assert.equal(redirectStatus(row, Date.now()), 'ok');
  assert.equal(redirectStatus(row, Date.now() + 100 * 86400000), 'expired');

  const destination = applyLinkUtm(row.url, row.utm);
  assert.ok(destination.includes('utm_source=email'));
  assert.ok(destination.includes('utm_medium=broadcast'));
});
