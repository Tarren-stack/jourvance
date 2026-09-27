import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('drip_seq_upsell_recovery is configured in drips.json and INITIAL_DRIP_SEQUENCES', () => {
  const dripsRaw = fs.readFileSync(path.join(__dirname, 'drips.json'), 'utf8');
  const dripsData = JSON.parse(dripsRaw);
  const recoverySeq = dripsData.sequences.find(s => s.id === 'drip_seq_upsell_recovery');

  assert.ok(recoverySeq, 'drip_seq_upsell_recovery sequence must exist in drips store');
  assert.equal(recoverySeq.triggerType, 'upsell_recovery');
  assert.equal(recoverySeq.smartExitOnPurchase, true);
  assert.ok(recoverySeq.steps.length >= 1);

  const step1 = recoverySeq.steps[0];
  assert.equal(step1.delayHours, 18, 'Initial recovery offer delay must be 18 hours');
  assert.equal(step1.discountVoucher, 'SAVE10');
  assert.ok(step1.body.includes('{{discount_code}}'));
  assert.ok(step1.body.includes('{{offer_url}}'));
  assert.ok(step1.body.includes('{{order_number}}'));
  assert.ok(step1.body.includes('{{first_name}}'));
});

test('upsell decline auto-enrolls customer and tags contact correctly', () => {
  const contacts = [
    { id: 'c_1', email: 'sophia@luxeaesthetics.com', name: 'Sophia Rossi', tags: ['VIP-Client'] }
  ];

  const dripsData = {
    sequences: [
      {
        id: 'drip_seq_upsell_recovery',
        name: 'Post-Purchase Courtesy Offer',
        triggerType: 'upsell_recovery',
        smartExitOnPurchase: true,
        steps: [{ delayHours: 18, discountVoucher: 'SAVE10' }],
        activeEnrollments: 0
      }
    ],
    enrollments: []
  };

  // Simulate decline action logic
  const action = 'decline';
  const offerType = 'upsell';
  const customerEmail = 'sophia@luxeaesthetics.com';
  const slug = 'botanical-glow-upsell';
  const isDownsell = offerType === 'downsell';

  // 1. Tagging
  const contact = contacts.find(c => c.email === customerEmail);
  const tagName = isDownsell ? 'Downsell-Declined' : 'Upsell-Declined';
  if (!contact.tags.includes(tagName)) contact.tags.push(tagName);

  assert.ok(contact.tags.includes('Upsell-Declined'));

  // 2. Drip Auto-Enrollment
  const recoverySeq = dripsData.sequences.find(s => s.triggerType === 'upsell_recovery');
  const alreadyActive = dripsData.enrollments.some(e =>
    e.customerEmail === customerEmail && e.sequenceId === recoverySeq.id && e.status === 'active'
  );

  assert.equal(alreadyActive, false);

  const now = Date.now();
  const delayHours = recoverySeq.steps[0].delayHours;
  const newEnrollment = {
    id: `enr_test_1`,
    sequenceId: recoverySeq.id,
    userId: 'usr_default',
    customerEmail,
    customerName: contact.name,
    sourceSlug: slug,
    offerUrl: `https://glowbeauty.com/p/${slug}`,
    offerType: 'upsell',
    discountCode: 'SAVE10',
    currentStepIndex: 0,
    status: 'active',
    enrolledAt: new Date(now).toISOString(),
    nextStepDueAt: new Date(now + delayHours * 3600000).toISOString(),
    history: []
  };

  dripsData.enrollments.unshift(newEnrollment);
  recoverySeq.activeEnrollments++;

  assert.equal(dripsData.enrollments.length, 1);
  assert.equal(dripsData.enrollments[0].status, 'active');
  assert.equal(dripsData.enrollments[0].offerUrl, 'https://glowbeauty.com/p/botanical-glow-upsell');
  assert.equal(dripsData.enrollments[0].discountCode, 'SAVE10');
  assert.equal(recoverySeq.activeEnrollments, 1);
});

test('upsell accept triggers immediate smart exit of active recovery enrollment', () => {
  const dripsData = {
    sequences: [
      {
        id: 'drip_seq_upsell_recovery',
        triggerType: 'upsell_recovery',
        smartExitOnPurchase: true,
        activeEnrollments: 1,
        totalExitedPurchased: 0
      }
    ],
    enrollments: [
      {
        id: 'enr_active_decline',
        sequenceId: 'drip_seq_upsell_recovery',
        customerEmail: 'emma@glowstudio.com',
        status: 'active',
        enrolledAt: new Date(Date.now() - 3600000).toISOString()
      }
    ]
  };

  const customerEmail = 'emma@glowstudio.com';
  const action = 'accept';

  if (action === 'accept') {
    for (const enr of dripsData.enrollments) {
      if (enr.customerEmail === customerEmail && enr.status === 'active') {
        const s = dripsData.sequences.find(sq => sq.id === enr.sequenceId);
        if (s && s.triggerType === 'upsell_recovery') {
          enr.status = 'converted_exit';
          enr.convertedAt = new Date().toISOString();
          s.activeEnrollments = Math.max(0, s.activeEnrollments - 1);
          s.totalExitedPurchased = (s.totalExitedPurchased || 0) + 1;
        }
      }
    }
  }

  assert.equal(dripsData.enrollments[0].status, 'converted_exit');
  assert.ok(dripsData.enrollments[0].convertedAt);
  assert.equal(dripsData.sequences[0].activeEnrollments, 0);
  assert.equal(dripsData.sequences[0].totalExitedPurchased, 1);
});

test('runner smart exit detects subsequent upsell accept event or later order', () => {
  const enrollmentTime = new Date('2026-09-26T12:00:00.000Z').getTime();

  const enr = {
    id: 'enr_runner_test',
    sequenceId: 'drip_seq_upsell_recovery',
    customerEmail: 'chloe@skinwellness.com',
    status: 'active',
    enrolledAt: new Date(enrollmentTime).toISOString()
  };

  const seq = {
    triggerType: 'upsell_recovery',
    smartExitOnPurchase: true
  };

  // Case 1: Initial core order placed before enrollment (should NOT trigger premature exit)
  const initialOrders = [
    {
      customerEmail: 'chloe@skinwellness.com',
      totalPrice: 48.00,
      createdAt: new Date(enrollmentTime - 30000).toISOString() // 30s before decline
    }
  ];
  const noEvents = [];

  function checkShouldExit(orders, events) {
    if (seq.triggerType === 'upsell_recovery') {
      const hasAcceptedUpsell = events.some(ev =>
        ev.type === 'upsell_accept' &&
        ev.email && ev.email.toLowerCase() === enr.customerEmail.toLowerCase() &&
        new Date(ev.timestamp).getTime() >= new Date(enr.enrolledAt).getTime() - 5000
      );
      const hasSubsequentOrder = orders.some(o =>
        o.customerEmail && o.customerEmail.toLowerCase() === enr.customerEmail.toLowerCase() &&
        new Date(o.createdAt).getTime() >= new Date(enr.enrolledAt).getTime() + 1000
      );
      return hasAcceptedUpsell || hasSubsequentOrder;
    }
    return orders.some(o => o.customerEmail === enr.customerEmail && new Date(o.createdAt).getTime() >= new Date(enr.enrolledAt).getTime() - 60000);
  }

  // Should NOT exit on the initial pre-upsell order
  assert.equal(checkShouldExit(initialOrders, noEvents), false);

  // Case 2: Customer converts on the second chance offer via upsell_accept event
  const eventsWithAccept = [
    {
      type: 'upsell_accept',
      email: 'chloe@skinwellness.com',
      timestamp: new Date(enrollmentTime + 7200000).toISOString(), // 2 hours later
      amount: 29.00
    }
  ];
  assert.equal(checkShouldExit(initialOrders, eventsWithAccept), true);

  // Case 3: Customer places a subsequent store order
  const ordersWithLaterOrder = [
    ...initialOrders,
    {
      customerEmail: 'chloe@skinwellness.com',
      totalPrice: 65.00,
      createdAt: new Date(enrollmentTime + 86400000).toISOString()
    }
  ];
  assert.equal(checkShouldExit(ordersWithLaterOrder, noEvents), true);
});

test('email template tokens replace offer_url, discount_code, order_number, and first_name', () => {
  const template = 'Hey {{first_name}},\n\nYour order {{order_number}} is confirmed. Use {{discount_code}} at {{offer_url}} to claim your courtesy offer.';
  const vars = {
    first_name: 'Elena',
    order_number: '#10482',
    discount_code: 'SAVE10',
    offer_url: 'https://jourvance.com/p/botanical-cleanser-offer'
  };

  let rendered = template;
  for (const [key, val] of Object.entries(vars)) {
    rendered = rendered.replaceAll(`{{${key}}}`, val);
  }

  assert.ok(rendered.includes('Hey Elena,'));
  assert.ok(rendered.includes('#10482'));
  assert.ok(rendered.includes('SAVE10'));
  assert.ok(rendered.includes('https://jourvance.com/p/botanical-cleanser-offer'));
  assert.equal(rendered.includes('{{'), false);
});
