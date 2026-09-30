import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The header carried a Launch Readiness popover that could never open: its only trigger was the
// audit badge's fallback for a missing onOpenAudit, and App.tsx always passes onOpenAudit. It
// also took retention and step-selection props it never read. Backlog #29 removed all of it.
// These pins stop it coming back, and guard the retention wiring the canvas really uses.

const header = fs.readFileSync(new URL('./src/components/toolbar/CanvasHeader.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('./src/App.tsx', import.meta.url), 'utf8');

function slice(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `${start} not found`);
  assert.equal(text.indexOf(start, from + 1), -1, `${start} appears more than once`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `${end} not found after ${start}`);
  return text.slice(from, to);
}

const props = slice(header, 'interface Props', 'export const CanvasHeader');

test('the Launch Readiness popover is gone', () => {
  for (const s of ['showChecklist', 'Launch Readiness', 'isOfferDone', 'isStoreDone', 'isPublishDone', 'blendedAov']) {
    assert.ok(!header.includes(s), `CanvasHeader.tsx still contains ${s}`);
  }
});

test('the audit badge only opens the audit drawer', () => {
  assert.match(props, /\bonOpenAudit:\s*\(\)\s*=>\s*void/);
});

test('the header takes no retention or step-selection props', () => {
  assert.doesNotMatch(props, /\bshowRetentionBranches\??:/);
  assert.doesNotMatch(props, /\bonToggleRetentionBranches\??:/);
  assert.doesNotMatch(props, /\bonSelectNode\??:/);
});

test('App gives retention state to the canvas, not the header', () => {
  const headerEl = slice(app, '<CanvasHeader', '/>');
  for (const s of ['showRetentionBranches=', 'onToggleRetentionBranches=', 'onSelectNode=']) {
    assert.ok(!headerEl.includes(s), `<CanvasHeader> still receives ${s}`);
  }
  const canvasEl = slice(app, '<JourneyCanvas', '/>');
  assert.ok(canvasEl.includes('showRetentionBranches='), '<JourneyCanvas> lost showRetentionBranches');
  assert.ok(canvasEl.includes('onToggleRetentionBranches='), '<JourneyCanvas> lost onToggleRetentionBranches');
  assert.ok(app.includes('const [showRetentionBranches, setShowRetentionBranches] = useState<boolean>(true)'));
});
