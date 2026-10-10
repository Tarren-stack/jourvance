import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// hubFlowId and exportFormat on a sequence step were read by nothing (Wave 1 code map, re-grepped in
// the open-list pass) so they were dropped from the type and the blueprints. A journey saved before
// the drop still carries them and must load and build a flow exactly as before.

const { flowFromStepLetters } = await import('./src/lib/editorReturn.ts');
const { layoutPreview } = await import('./src/lib/blueprintPreview.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');

const walkSrc = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walkSrc(p) : /\.(ts|tsx)$/.test(d.name) ? [p] : [];
});

test('no source file names the dropped blueprint fields', () => {
  const files = walkSrc('./src');
  assert.ok(files.length > 20, `expected the source tree, saw ${files.length}`);
  for (const f of files) assert.ok(!/hubFlowId|exportFormat/.test(fs.readFileSync(f, 'utf8')), `${f} names a dropped field`);
});

test('a saved journey that still carries the fields loads and builds the same flow', () => {
  const legacy = {
    type: 'follow-up-sequence', label: 'Old', sequenceTitle: 'Old sequence',
    hubFlowId: 'flow_post_purchase_ecom', exportFormat: 'hub',
    steps: [{ id: 's1', channel: 'email', delay: 'Instant', subject: 'Hello', previewText: '', body: 'Thanks for your order.' }]
  };
  const clean = { ...legacy }; delete clean.hubFlowId; delete clean.exportFormat;
  const a = flowFromStepLetters(legacy);
  const b = flowFromStepLetters(clean);
  assert.deepEqual(a, b);
  const nodes = [{ id: 'n1', type: 'follow-up-sequence', position: { x: 0, y: 0 }, data: legacy }];
  assert.equal(layoutPreview(nodes, []).boxes.length, 1);
  assert.ok(ECOM_BLUEPRINTS.length >= 5);
});
