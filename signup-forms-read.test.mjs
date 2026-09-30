// T13: a signup form saved from an old preset carried the preset's code, and the lead route minted a
// code of that name for every visitor. grantFormCoupon refuses to mint it, but the live page, the
// editor and the save route read the stored forms through server.mjs signupFormsFor, so that read has
// to take the code and the promise off too: without it the live form kept "Claim Your 15% Welcome
// Ritual" and hasCoupon true, promising a code it never gives. server.mjs cannot be loaded in a test
// (it starts the server and reads .env), so the read is a function in server/seededOffers.mjs driven
// here with the real form cleaner, and the call sites in server.mjs are pinned by their source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanForm, publicForm } from './audience.mjs';
import { readSignupForms } from './server/seededOffers.mjs';
import { SEEDED_SIGNUP_FORMS, SIGNUP_PRESETS } from './src/lib/offerPresets.ts';

// server.mjs cleanSignupForm, which is what signupFormsFor hands readSignupForms.
const cleanSignupForm = (input) => {
  const cleaned = cleanForm(input);
  if (!cleaned || cleaned.error) return cleaned?.error ? cleaned : null;
  return cleaned.form;
};

const old = SEEDED_SIGNUP_FORMS[0];
const asSaved = (id, extra = {}) => ({
  id, name: '15% Welcome Ritual (Exit-Intent)', type: 'popup', enabled: true, ...old.words,
  coupon: { name: old.code, discountType: 'percentage', value: old.value }, ...extra
});

test('the stored forms are read with an old preset\'s code and promise taken off, and nothing else', () => {
  const stored = [
    asSaved('form_old'),
    asSaved('form_rewritten', { headline: 'Get 15% off your first order', body: 'Join our list for 15% off.', buttonText: 'Get my 15%', successMessage: 'Your 15% code is below.' }),
    { id: 'form_mine', type: 'popup', enabled: true, headline: 'Our list', body: 'Hear from us.', buttonText: 'Join', successMessage: 'Thanks.', coupon: { name: 'HELLO20', discountType: 'percentage', value: 20 } },
    { id: 'form_bad', type: 'popup', coupon: { name: 'X' } }
  ];
  const before = JSON.stringify(stored);
  const forms = readSignupForms(stored, cleanSignupForm);
  assert.equal(JSON.stringify(stored), before, 'the stored rows are not changed by reading them');
  assert.deepEqual(forms.map(f => f.id), ['form_old', 'form_rewritten', 'form_mine'], 'a row the cleaner refuses is dropped, as before');

  const [oldForm, rewritten, mine] = forms;
  const live = publicForm(oldForm);
  assert.equal(oldForm.coupon, null);
  assert.equal(live.hasCoupon, false, 'the live form no longer says a code is coming');
  for (const field of ['headline', 'body', 'buttonText', 'successMessage', 'teaser', 'teaserClosed']) {
    assert.equal(oldForm[field], SIGNUP_PRESETS[0][field], `${field} is the current starter's`);
  }
  assert.doesNotMatch(JSON.stringify(live), /15%|WELCOME15|Ritual|samples|gift/i);

  assert.equal(rewritten.coupon?.name, 'WELCOME15', 'a form the merchant rewrote around the code keeps it');
  assert.equal(publicForm(rewritten).hasCoupon, true);
  assert.equal(rewritten.headline, 'Get 15% off your first order');
  assert.equal(mine.coupon?.name, 'HELLO20');

  assert.equal(readSignupForms(Array.from({ length: 25 }, (_, i) => ({ ...stored[2], id: `form_${i}` })), cleanSignupForm).length, 20, 'still at most 20');
  assert.deepEqual(readSignupForms(undefined, cleanSignupForm), []);
});

test('server.mjs reads every stored signup form through readSignupForms', () => {
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  const body = (name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} is in server.mjs`);
    return src.slice(start, src.indexOf('\n}\n', start));
  };
  assert.match(src, /import \{[^}]*\breadSignupForms\b[^}]*\} from '\.\/server\/seededOffers\.mjs';/);
  assert.match(body('signupFormsFor'), /return readSignupForms\(loadSignupStore\(\)\[uid\], cleanSignupForm\);/);
  assert.match(body('cleanSignupForm'), /cleanForm\(input, options\)[\s\S]*return cleaned\.form;/, 'the cleaner this test copies is still the one server.mjs uses');
  // The only other reader of the stored rows is the write, which keeps them as the merchant saved them.
  const readers = [...src.matchAll(/(?<!function )loadSignupStore\(\)/g)].map(m => {
    const fn = src.lastIndexOf('\nfunction ', m.index);
    return src.slice(fn + 10, src.indexOf('(', fn + 10));
  });
  assert.deepEqual(readers.sort(), ['signupFormsFor', 'writeSignupForms']);
  // The live page's form script is built from that read.
  assert.match(body('signupSnippetForSlug'), /signupFormsFor\(page\.userId\)\.filter\(\(form\) => form\.enabled\)\.map\(publicForm\)/);
});
