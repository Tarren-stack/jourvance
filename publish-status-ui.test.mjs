import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Source pins for the #23 wiring. "Published" used to be a flag App set with the browser clock,
// and the landing card and the page editor printed it. The server now says what is live
// (GET /api/journey/:id/publication), and the cards and the inspector read that through
// PublishStatusContext. These pins keep the old client-side claim from coming back.

const read = path => fs.readFileSync(path, 'utf8');
const CARDS = ['PageNode.tsx', 'UpsellNode.tsx', 'ThankYouNode.tsx', 'AbSplitNode.tsx'];
const card = file => read(`src/components/canvas/nodes/${file}`);

test('the landing card no longer claims Draft or Published on its own', () => {
  const src = card('PageNode.tsx');
  assert.doesNotMatch(src, /Draft/);
  assert.doesNotMatch(src, /d\.published/);
  // The header pill is the AOV figure in Live ROAS view, and nothing otherwise.
  assert.match(src, /isRoasMode && \(/);
});

test('each publishable card renders the status strip right after its top banner', () => {
  for (const file of CARDS) {
    const src = card(file);
    assert.match(src, /import \{ PublishStatusStrip \} from '\.\.\/PublishStatus'/, `${file} imports the strip`);
    const strip = src.indexOf('<PublishStatusStrip nodeId={id}');
    assert.ok(strip > 0, `${file} renders <PublishStatusStrip nodeId={id}`);
    const banner = src.indexOf('{/* Top Banner */}');
    assert.ok(banner > 0 && banner < strip, `${file}: the strip comes after the top banner`);
    // Directly after it: the banner's closing div, then the strip, with no other element between.
    const between = src.slice(banner, strip);
    const lastClose = between.lastIndexOf('</div>');
    assert.match(between.slice(lastClose + '</div>'.length), /^\s*$/, `${file}: the strip is the next element after the banner`);
    // It never sits inside a ROAS-only or A/B-only branch.
    assert.doesNotMatch(src.slice(strip - 40, strip), /&&\s*\(?\s*$/, `${file}: the strip is unconditional`);
  }
});

test('form, ad and sequence cards carry no strip', () => {
  for (const file of ['FormNode.tsx', 'AdNode.tsx', 'SequenceNode.tsx']) {
    assert.doesNotMatch(card(file), /PublishStatusStrip/, file);
  }
});

test('card roots still never pair overflow hidden with a containing block', () => {
  for (const file of CARDS) {
    const src = card(file);
    const start = src.indexOf('style={{', src.indexOf('return ('));
    const root = src.slice(start, src.indexOf('\n      }}', start));
    assert.ok(root.length > 20, `${file}: found the root style`);
    if (!/overflow: 'hidden'/.test(root)) continue;
    assert.doesNotMatch(root, /backdropFilter|position:\s*'(relative|absolute|fixed|sticky)'|transform:|\bfilter:|willChange|contain:/, `${file} root clips its handles`);
  }
});

test('the landing card title can shrink and its slug ellipsizes', () => {
  const src = card('PageNode.tsx');
  const slugAt = src.indexOf('{address || <span');
  assert.ok(slugAt > 0);
  const slugLine = src.slice(src.lastIndexOf('<div', slugAt), slugAt);
  assert.match(slugLine, /overflow: 'hidden'/);
  assert.match(slugLine, /textOverflow: 'ellipsis'/);
  assert.match(slugLine, /whiteSpace: 'nowrap'/);
  const banner = src.slice(src.indexOf('{/* Top Banner */}'), slugAt);
  assert.ok((banner.match(/minWidth: 0/g) || []).length >= 2, 'the title block and its column both have minWidth 0');
});

test('the page editor lost its own unchecked Live/Draft badge', () => {
  const src = read('src/components/drawers/PageEditor.tsx');
  assert.doesNotMatch(src, /Live Published/);
  assert.doesNotMatch(src, /○ Draft/);
});

test('the inspector opens with the Publish status section for publishable steps', () => {
  const src = read('src/components/drawers/NodeInspector.tsx');
  assert.match(src, /onPreviewStep\?: \(nodeId: string\) => Promise<PreviewOutcome>/);
  assert.match(src, /isPublishableStep\(node\) && <StepPublishPanel key=\{node\.id\} node=\{node\}/);
  // It is the first thing in the body, above the connections list, for every publishable step but a
  // landing page, which opens on its editor (#17).
  const body = src.indexOf('{/* Panel body */}');
  const panel = src.indexOf('<StepPublishPanel');
  const nav = src.indexOf('{navigation}');
  assert.ok(body > 0 && body < panel && panel < nav);
});

test('App reads publish status from the server, not from its own clock', () => {
  const src = read('src/App.tsx');
  assert.doesNotMatch(src, /const publishedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(src, /applyPublishResult\(prev, /);
  assert.match(src, /setAuthReady\(true\)/);
  assert.match(src, /usePublication\(\{/);
  assert.match(src, /<PublishStatusContext\.Provider value=\{publishCtx\}>/);
  // The one requestAnswer lives in saveOutcome.ts now.
  assert.doesNotMatch(src, /async function requestAnswer/);
  assert.match(src, /requestAnswer[^;]*from '\.\/lib\/saveOutcome'/);
  // Publish and unpublish both re-read what is live.
  const refreshes = src.match(/void pub\.refresh\(\);/g) || [];
  assert.ok(refreshes.length >= 2, 'publish and unpublish both call pub.refresh()');
});

test('the status components keep readable text, no em dash and a focus ring', () => {
  for (const path of ['src/components/canvas/PublishStatus.tsx', 'src/components/drawers/StepPublishPanel.tsx']) {
    const src = read(path);
    for (const m of src.matchAll(/fontSize:\s*'(\d+(?:\.\d+)?)px'/g)) {
      assert.ok(Number(m[1]) >= 11, `${path}: fontSize ${m[1]}px is below 11px`);
    }
    assert.doesNotMatch(src, /—/, `${path} has an em dash`);
    assert.doesNotMatch(src, / – /, `${path} has a spaced en dash`);
    assert.doesNotMatch(src, /outline:\s*'none'/, `${path} removes the focus outline`);
  }
});
