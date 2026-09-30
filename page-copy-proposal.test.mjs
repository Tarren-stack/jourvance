import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readCopyAnswer,
  cleanSuggestedText,
  planCopyRows,
  applyCopyRows,
  copyGoal,
  initialFocus,
  joinLabels,
  readAdCopyAnswer,
  readEmailCopyAnswer,
  cleanSuggestedBody,
  planAdCopyRows,
  applyAdCopyRows,
  planEmailCopyRows,
  applyEmailCopyRows,
  AD_COPY_GOAL,
  emailCopyGoal
} from './src/lib/pageCopyProposal.ts';
import { templateCopy } from './server/routes/authWorkspaceRoutes.mjs';

// The page editor's AI path. The editor used to write whatever /api/ai/copy answered straight
// into headline, subhead and button, including the server's template fallback and a client-side
// placeholder, with no preview. These pin the reading that stops placeholder text passing for AI
// and the apply that writes only the fields the person kept.

const NOTHING = 'Nothing was changed.';
const DASHES = /—|\s–\s/;

function page(over = {}) {
  return {
    type: 'landing-page',
    label: 'Lander',
    slug: 'my-offer',
    headline: '',
    subhead: 'Describe what the visitor gets.',
    bullets: ['One', 'Two'],
    trustBadge: 'Trusted line',
    buttonText: 'Continue',
    ...over
  };
}

test('readCopyAnswer: no answer means the server could not be reached', () => {
  const r = readCopyAnswer(null);
  assert.equal(r.kind, 'unavailable');
  assert.match(r.message, /could not be reached/);
  assert.ok(r.message.endsWith(NOTHING));
});

test('readCopyAnswer: a 401 asks the person to sign in', () => {
  const r = readCopyAnswer({ status: 401, body: { success: false, error: 'Sign in required' } });
  assert.equal(r.kind, 'unavailable');
  assert.match(r.message, /Sign in/);
  assert.ok(r.message.endsWith(NOTHING));
});

test('readCopyAnswer: a non-200 with an error uses that sentence', () => {
  const r = readCopyAnswer({ status: 500, body: { success: false, error: 'The copy service is down.' } });
  assert.equal(r.kind, 'unavailable');
  assert.equal(r.message, `The copy service is down. ${NOTHING}`);
});

test('readCopyAnswer: success false on a 200 falls back to the status sentence', () => {
  const r = readCopyAnswer({ status: 200, body: { success: false } });
  assert.equal(r.kind, 'unavailable');
  assert.equal(r.message, `AI writing failed with status 200. ${NOTHING}`);
  const long = readCopyAnswer({ status: 502, body: { success: false, error: 'x'.repeat(250) } });
  assert.equal(long.message, `AI writing failed with status 502. ${NOTHING}`);
});

test('readCopyAnswer: the server template answer is never a suggestion', () => {
  const copy = templateCopy('page', 'X');
  const template = readCopyAnswer({ status: 200, body: { success: true, copy, source: 'template' } });
  assert.equal(template.kind, 'unavailable');
  assert.equal(template.message, `AI writing is not available right now. ${NOTHING}`);

  const limited = readCopyAnswer({ status: 200, body: { success: true, copy, source: 'template', reason: 'hourly-ai-limit' } });
  assert.equal(limited.kind, 'unavailable');
  assert.match(limited.message, /hour/);
  assert.ok(limited.message.endsWith(NOTHING));

  const noSource = readCopyAnswer({ status: 200, body: { success: true, copy } });
  assert.equal(noSource.kind, 'unavailable');

  for (const r of [template, limited, noSource]) {
    assert.ok(!JSON.stringify(r).includes('Replace this with the specifics of your business'));
    assert.ok(!JSON.stringify(r).includes(copy.headline));
  }
});

test('readCopyAnswer: a hub-brain answer maps cta to buttonText and drops blank fields', () => {
  const r = readCopyAnswer({
    status: 200,
    body: { success: true, source: 'hub-brain', copy: { headline: 'Fresh start', subhead: '   ', cta: 'Book a call' } }
  });
  assert.equal(r.kind, 'suggestion');
  assert.deepEqual(r.copy, { headline: 'Fresh start', buttonText: 'Book a call' });

  const odd = readCopyAnswer({
    status: 200,
    body: { success: true, source: 'hub-brain', copy: { headline: 42, subhead: 'Plain words.', cta: null } }
  });
  assert.deepEqual(odd.copy, { subhead: 'Plain words.' });
});

test('readCopyAnswer: an all-blank hub-brain answer is unavailable', () => {
  const r = readCopyAnswer({ status: 200, body: { success: true, source: 'hub-brain', copy: { headline: '', subhead: ' ', cta: '—' } } });
  assert.equal(r.kind, 'unavailable');
  assert.match(r.message, /empty/);
  assert.ok(r.message.endsWith(NOTHING));
  const noCopy = readCopyAnswer({ status: 200, body: { success: true, source: 'hub-brain' } });
  assert.equal(noCopy.kind, 'unavailable');
});

test('readCopyAnswer: suggested text arrives without em dashes', () => {
  const r = readCopyAnswer({
    status: 200,
    body: { success: true, source: 'hub-brain', copy: { headline: 'Fresh start — now', subhead: 'Plain words.', cta: 'Book a call' } }
  });
  assert.equal(r.copy.headline, 'Fresh start, now');
});

test('cleanSuggestedText removes em dashes and spaced en dashes only', () => {
  assert.equal(cleanSuggestedText('Glow now — today'), 'Glow now, today');
  assert.equal(cleanSuggestedText('Glow—today'), 'Glow, today');
  assert.equal(cleanSuggestedText('A – B'), 'A, B');
  assert.equal(cleanSuggestedText('— Fresh start'), 'Fresh start');
  assert.equal(cleanSuggestedText('one-click 10–20'), 'one-click 10–20');
  assert.equal(cleanSuggestedText('  lots   of   space  '), 'lots of space');
  assert.equal(cleanSuggestedText(undefined), '');
  assert.equal(cleanSuggestedText(7), '');
});

test('planCopyRows: fill for an empty field, replace for different text, nothing for the same text', () => {
  const data = page({ headline: '', subhead: 'Old subhead', buttonText: 'Continue' });
  const rows = planCopyRows(data, 'a', { headline: 'New headline', subhead: 'New subhead', buttonText: '  Continue ' });
  assert.deepEqual(rows.map(r => [r.field, r.change]), [['headline', 'fill'], ['subhead', 'replace']]);
  assert.equal(rows[0].label, 'Headline');
  assert.equal(rows[1].current, 'Old subhead');
  assert.equal(rows[1].suggested, 'New subhead');
});

test('planCopyRows: target b reads variantB, and no variantB means every row fills', () => {
  const withB = page({ headline: 'A head', variantB: { headline: 'B head', subhead: '' } });
  const rows = planCopyRows(withB, 'b', { headline: 'A head', subhead: 'New B sub' });
  assert.deepEqual(rows.map(r => [r.field, r.change, r.current]), [['headline', 'replace', 'B head'], ['subhead', 'fill', '']]);

  const noB = page({ headline: 'A head', subhead: 'A sub', buttonText: 'Go' });
  const fills = planCopyRows(noB, 'b', { headline: 'x', subhead: 'y', buttonText: 'z' });
  assert.deepEqual(fills.map(r => r.change), ['fill', 'fill', 'fill']);
});

test('applyCopyRows: only the selected fields change, and nothing else is touched', () => {
  const data = page({ headline: 'Old', subhead: 'Old sub', buttonText: 'Old button' });
  const copy = { headline: 'New', subhead: 'New sub', buttonText: 'New button' };
  const out = applyCopyRows(data, 'a', copy, ['headline', 'buttonText']);
  assert.equal(out.headline, 'New');
  assert.equal(out.subhead, 'Old sub');
  assert.equal(out.buttonText, 'New button');
  assert.deepEqual(out.slug, data.slug);
  assert.deepEqual(out.bullets, data.bullets);
  assert.deepEqual(out.trustBadge, data.trustBadge);
  assert.equal(out.variantB, undefined);
});

test('applyCopyRows: target b writes variantB only and keeps its other fields', () => {
  const data = page({
    headline: 'A head',
    subhead: 'A sub',
    buttonText: 'A button',
    variantB: { headline: 'B head', bullets: ['B one'], discountCode: 'SAVE10' }
  });
  const out = applyCopyRows(data, 'b', { headline: 'New B', subhead: 'New B sub', buttonText: 'New B button' }, ['headline', 'subhead']);
  assert.equal(out.variantB.headline, 'New B');
  assert.equal(out.variantB.subhead, 'New B sub');
  assert.equal(out.variantB.buttonText, undefined);
  assert.deepEqual(out.variantB.bullets, ['B one']);
  assert.equal(out.variantB.discountCode, 'SAVE10');
  assert.equal(out.headline, 'A head');
  assert.equal(out.subhead, 'A sub');
  assert.equal(out.buttonText, 'A button');
});

test('applyCopyRows: an empty selection returns the same object', () => {
  const data = page();
  assert.equal(applyCopyRows(data, 'a', { headline: 'x' }, []), data);
  assert.equal(applyCopyRows(data, 'b', { headline: 'x' }, []), data);
});

test('copyGoal never asks the model to invent claims', () => {
  for (const t of ['a', 'b']) {
    const goal = copyGoal(t);
    assert.ok(goal.includes('Do not invent'));
    assert.doesNotMatch(goal, /clinical|Shopify/);
  }
  assert.ok(copyGoal('b').startsWith('A different angle on the same offer for an A/B test.'));
});

test('initialFocus is keep when anything would be replaced, use when every row fills', () => {
  assert.equal(initialFocus([{ change: 'fill' }, { change: 'replace' }]), 'keep');
  assert.equal(initialFocus([{ change: 'fill' }, { change: 'fill' }]), 'use');
});

test('joinLabels reads like a sentence', () => {
  assert.equal(joinLabels(['Headline']), 'Headline');
  assert.equal(joinLabels(['Headline', 'Button text']), 'Headline and Button text');
  assert.equal(joinLabels(['Headline', 'Subheadline', 'Button text']), 'Headline, Subheadline and Button text');
});

test('no message or goal the module produces carries an em dash or a spaced en dash', () => {
  const answers = [
    null,
    { status: 401, body: {} },
    { status: 500, body: { success: false } },
    { status: 500, body: { success: false, error: 'Down — try later' } },
    { status: 200, body: { success: true, source: 'template' } },
    { status: 200, body: { success: true, source: 'template', reason: 'hourly-ai-limit' } },
    { status: 200, body: { success: true, source: 'hub-brain', copy: {} } }
  ];
  for (const a of answers) assert.doesNotMatch(readCopyAnswer(a).message, DASHES);
  assert.doesNotMatch(copyGoal('a'), DASHES);
  assert.doesNotMatch(copyGoal('b'), DASHES);
});

// C19: the ad step's Generate and the sequence step's AI Polish were still on requestAICopy, which
// answered any failure (and the server's template answer) with placeholder copy and wrote it
// straight into the node: a letter lost its [First Name] tag and an ad's button became "Learn
// more", with nothing on screen to say so. They now read the raw answer the way the page does.

function ad(over = {}) {
  return {
    type: 'ad-source', label: 'Ad', platform: 'meta',
    headline: 'Your ad headline', body: 'Describe the offer in words you can stand behind.', ctaText: 'Claim Your Offer',
    utmCampaign: 'spring', impressions: 0, clicks: 0, ctr: 0, spend: 0,
    ...over
  };
}

function letter(over = {}) {
  return {
    id: 'step-1', channel: 'email', delay: 'Instant',
    subject: 'You are on the list',
    previewText: 'Replace this before anyone receives it',
    body: 'Hi [First Name],\n\nThanks for signing up.\n\nThe Team',
    ...over
  };
}

test('C19: no answer, a 401 or the server template never becomes ad or email copy', () => {
  for (const [read, kind] of [[readAdCopyAnswer, 'ad'], [readEmailCopyAnswer, 'email']]) {
    const copy = templateCopy(kind, 'X');
    const answers = [
      null,
      { status: 401, body: { success: false } },
      { status: 500, body: { success: false } },
      { status: 200, body: { success: true, copy, source: 'template' } },
      { status: 200, body: { success: true, copy, source: 'template', reason: 'hourly-ai-limit' } },
      { status: 200, body: { success: true, copy } }
    ];
    for (const a of answers) {
      const r = read(a);
      assert.equal(r.kind, 'unavailable', `${kind} ${JSON.stringify(a)}`);
      assert.ok(r.message.endsWith(NOTHING));
      assert.doesNotMatch(r.message, DASHES);
      assert.ok(!('copy' in r));
    }
  }
  assert.match(readAdCopyAnswer(null).message, /could not be reached/);
  assert.match(readEmailCopyAnswer({ status: 401, body: {} }).message, /Sign in/);
});

test('C19: a hub-brain ad answer maps cta to ctaText', () => {
  const r = readAdCopyAnswer({
    status: 200,
    body: { success: true, source: 'hub-brain', copy: { headline: 'Book a free fitting', body: 'Plain words — here.', cta: 'Book now' } }
  });
  assert.equal(r.kind, 'suggestion');
  assert.deepEqual(r.copy, { headline: 'Book a free fitting', body: 'Plain words, here.', ctaText: 'Book now' });
});

test('C19: a hub-brain email answer maps preview to previewText and keeps the letter paragraphs', () => {
  const r = readEmailCopyAnswer({
    status: 200,
    body: {
      success: true,
      source: 'hub-brain',
      copy: { subject: 'Your order', preview: 'A quick note', body: 'Hi [First Name],\r\n\r\n\r\nThanks  — really.\nThe Team' }
    }
  });
  assert.equal(r.kind, 'suggestion');
  assert.deepEqual(r.copy, { subject: 'Your order', previewText: 'A quick note', body: 'Hi [First Name],\n\nThanks, really.\nThe Team' });
  assert.equal(cleanSuggestedBody(42), '');
  assert.equal(cleanSuggestedBody('— Step one\nStep two —\nsee – here\n10–20 one-click'), 'Step one\nStep two\nsee, here\n10–20 one-click');
});

test('C19: ad rows and apply write only the kept fields onto the current ad', () => {
  const data = ad();
  const copy = { headline: 'Your ad headline', body: 'New body', ctaText: 'Book now' };
  const rows = planAdCopyRows(data, copy);
  assert.deepEqual(rows.map(r => [r.field, r.label, r.change]), [['body', 'Primary text', 'replace'], ['ctaText', 'Button text', 'replace']]);
  const out = applyAdCopyRows(data, copy, ['ctaText']);
  assert.equal(out.ctaText, 'Book now');
  assert.equal(out.body, data.body);
  assert.equal(out.utmCampaign, 'spring');
  assert.equal(applyAdCopyRows(data, copy, []), data);
  // A page field name in the selection is not an ad field and changes nothing.
  assert.equal(applyAdCopyRows(data, copy, ['buttonText']), data);
});

test('C19: every kept email field lands in one steps array, and the other letters are untouched', () => {
  const steps = [letter(), letter({ id: 'step-2', subject: 'Second', body: 'Two' })];
  const copy = { subject: 'New subject', previewText: 'New preview', body: 'Hi [First Name],\n\nNew body.' };
  const rows = planEmailCopyRows(steps[0], copy);
  assert.deepEqual(rows.map(r => [r.field, r.label]), [['subject', 'Subject line'], ['previewText', 'Preview text'], ['body', 'Letter body']]);
  const out = applyEmailCopyRows(steps, 'step-1', copy, rows.map(r => r.field));
  assert.equal(out[0].subject, 'New subject');
  assert.equal(out[0].previewText, 'New preview');
  assert.equal(out[0].body, copy.body);
  assert.equal(out[1], steps[1]);
  assert.equal(steps[0].subject, 'You are on the list', 'the input steps are not mutated');

  const bodyOnly = applyEmailCopyRows(steps, 'step-1', copy, ['body']);
  assert.equal(bodyOnly[0].subject, 'You are on the list');
  assert.equal(bodyOnly[0].body, copy.body);
  assert.equal(applyEmailCopyRows(steps, 'gone', copy, ['body']), steps);
  assert.equal(applyEmailCopyRows(steps, 'step-1', copy, []), steps);
});

test('C19: the ad and email goals never ask the model to invent claims', () => {
  for (const goal of [AD_COPY_GOAL, emailCopyGoal('24 Hours'), emailCopyGoal('')]) {
    assert.ok(goal.includes('Do not invent'));
    assert.doesNotMatch(goal, DASHES);
  }
  assert.match(emailCopyGoal('24 Hours'), /after 24 Hours/);
  assert.match(emailCopyGoal(''), /\[First Name\]/);
});

test('C19: no editor can reach a client that presents template text as AI', () => {
  const hub = readFileSync('./src/lib/hubClient.ts', 'utf8');
  assert.doesNotMatch(hub, /\brequestAICopy\b(?!Answer)/, 'the silent-fallback client is gone');
  assert.doesNotMatch(hub, /Replace this before anyone receives it|Learn more/);

  const adEditor = readFileSync('./src/components/drawers/AdEditor.tsx', 'utf8');
  const seqEditor = readFileSync('./src/components/drawers/SequenceEditor.tsx', 'utf8');
  for (const [src, reader] of [[adEditor, 'readAdCopyAnswer'], [seqEditor, 'readEmailCopyAnswer']]) {
    assert.doesNotMatch(src, /\brequestAICopy\b(?!Answer)/);
    assert.match(src, /\brequestAICopyAnswer\b/);
    assert.match(src, new RegExp(`\\b${reader}\\b`));
    assert.match(src, /<CopyProposalCard/);
    assert.match(src, /role="status"/);
  }
  // The polish no longer writes field by field from a stale copy of the steps.
  const polish = seqEditor.slice(seqEditor.indexOf('const generateStepCopy'), seqEditor.indexOf('const copyForKlaviyo'));
  assert.doesNotMatch(polish, /handleStepChange/);
  assert.doesNotMatch(polish.slice(0, polish.indexOf('const applyProposal')), /onChange\(/, 'the request itself writes nothing');
  const gen = adEditor.slice(adEditor.indexOf('const generateAICopy'), adEditor.indexOf('const applyProposal'));
  assert.doesNotMatch(gen, /onChange\(/, 'the request itself writes nothing');
});
