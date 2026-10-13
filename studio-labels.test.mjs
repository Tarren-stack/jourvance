import test from 'node:test';
import assert from 'node:assert/strict';

const {
  VIEW_LABEL,
  ACTION_LABEL,
  STEP_TYPES,
  attributionModelHelp,
  checkDesignName,
  ROAS_STAT_NAME,
  AOV_PHRASE,
  AD_RETURN_NOTE
} = await import('./src/lib/studioLabels.ts');

test('each place and action has one visible name', () => {
  assert.deepEqual(VIEW_LABEL, {
    canvas: 'Funnel Canvas',
    'email-studio': 'Email Studio',
    attribution: 'Attribution'
  });
  assert.equal(ACTION_LABEL.addStep, 'Add Step');
  assert.equal(ACTION_LABEL.checkDesign, 'Check design');
  assert.equal(ACTION_LABEL.showAdReturn, 'Show ad return');
  assert.equal(ACTION_LABEL.testFunnel, 'Test funnel');
  assert.match(AD_RETURN_NOTE, /estimates/);
  assert.match(ROAS_STAT_NAME, /Return on ad spend \(ROAS\)/);
  assert.equal(AOV_PHRASE, 'average order value');
});

test('each step type has a plain label and a description', () => {
  assert.equal(STEP_TYPES.length, 7);
  const types = STEP_TYPES.map(s => s.type);
  assert.deepEqual(types, ['ad-source', 'landing-page', 'ab-split', 'lead-form', 'follow-up-sequence', 'thank-you', 'upsell']);
  for (const step of STEP_TYPES) {
    assert.ok(step.label.length > 0, step.type);
    assert.ok(step.description.length > 0, step.type);
    assert.doesNotMatch(step.label + step.description, /AOV|OTO|Day-0|high-converting|\+/i);
  }
});

test('each attribution model is named in its own sentence', () => {
  const last = attributionModelHelp('last_touch');
  const first = attributionModelHelp('first_touch');
  const linear = attributionModelHelp('linear');
  assert.match(last, /Last-touch/);
  assert.match(last, /last click/);
  assert.match(first, /First-touch/);
  assert.match(first, /first click/);
  assert.match(linear, /Linear/);
  assert.match(linear, /evenly/);
  assert.equal(checkDesignName(0), 'Check design, all checks passed');
  assert.equal(checkDesignName(1), 'Check design, 1 open check');
  assert.equal(checkDesignName(2), 'Check design, 2 open checks');
});
