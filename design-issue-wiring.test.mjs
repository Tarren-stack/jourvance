// Check design wiring (#10, w3-spine-2): the cards, the canvas, the header and App read the design
// checks, the old 100-point audit is gone from every place a signed-out person sees it, and the map
// keeps ONE pan (#7's FocusSelectedStep) rather than growing a second one for the drawer's rows.
// Source pins, because these files are TSX that Node cannot load; the checks themselves are pinned
// by behaviour in design-checks.test.mjs and store-checks.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(f, 'utf8');
const NODE_FILES = ['AdNode', 'PageNode', 'FormNode', 'SequenceNode', 'ThankYouNode', 'UpsellNode', 'AbSplitNode'];

test('each card renders the badge right after its root opens, before any handle or banner', () => {
  for (const name of NODE_FILES) {
    const src = read(`src/components/canvas/nodes/${name}.tsx`);
    assert.match(src, /import \{ DesignIssueBadge \} from '\.\.\/DesignIssueBadge';/, `${name} imports the badge`);
    const body = src.slice(src.indexOf('  return ('));
    // The root <div ...> closes on its own line; the badge is the very next line.
    assert.match(body, /^ {2}return \(\n {4}<div\n[\s\S]*?\n {4}>\n {6}<DesignIssueBadge nodeId=\{id\} \/>\n/, `${name}: badge is the first child`);
    assert.equal(src.split('<DesignIssueBadge').length - 1, 1, `${name} renders one badge`);
  }
});

test('the canvas hands the checks to the cards through a memoised context, from the saved journey', () => {
  const src = read('src/components/canvas/JourneyCanvas.tsx');
  assert.match(src, /onOpenIssues\?: \(nodeId: string\) => void;/);
  assert.match(src, /const design = useMemo\(\(\) => checkJourneyDesign\(\{ nodes, edges \}\), \[nodes, edges\]\);/);
  assert.match(src, /const issueCtx = useMemo\(\(\) => \(\{ byNode: design\.byNode, onOpenIssues \}\), \[design, onOpenIssues\]\);/);
  assert.match(src, /<DesignIssuesContext\.Provider value=\{issueCtx\}>/);
  // Checks are context, never data: nothing writes them into a node or an edge.
  assert.doesNotMatch(src, /data:\s*\{[^}]*designIssues/);
});

test('the map keeps one pan: no RevealSelectedStep beside FocusSelectedStep', () => {
  const src = read('src/components/canvas/JourneyCanvas.tsx');
  assert.ok(!src.includes('RevealSelectedStep'), 'a second pan component would fight #7 on the same selection');
  assert.equal(src.split('<FocusSelectedStep').length - 1, 1);
  assert.equal((src.match(/setCenter\(/g) || []).length, 1, 'setCenter is called in one place');
});

test('the header shows the open design checks and never the old score, grade or wins', () => {
  const src = read('src/components/toolbar/CanvasHeader.tsx');
  assert.match(src, /import \{ checkJourneyDesign \} from '\.\.\/\.\.\/lib\/designChecks';/);
  assert.match(src, /import \{ storeScoreFor \} from '\.\.\/\.\.\/lib\/funnelAuditor';/);
  assert.doesNotMatch(src, /auditFunnel|auditReport|fixableChecks|Flame/);
  for (const gone of ['`Audit: ', '`Ready: ', ' wins', 'Grade', 'Pre-Flight Funnel Audit', 'Readiness']) {
    assert.ok(!src.includes(gone), `header still says "${gone}"`);
  }
  assert.ok(src.includes('`Check design (${designCount})`'));
  assert.ok(src.includes("'Design checked'"));
  assert.ok(src.includes("`Check design, ${designCount} open ${designCount === 1 ? 'check' : 'checks'}`"));
  assert.ok(src.includes("'Check design, all checks passed'"));
  // The store score appears only once a store is connected (storeScoreFor answers null otherwise).
  assert.match(src, /\{!narrow && storeReport && \(/);
  assert.ok(src.includes('Store score {storeReport.overallScore}/100'));
  // The only "/100" left in the header is the store score's.
  assert.equal((src.match(/\/100/g) || []).length, 1);
});

test('App asks one plain confirm naming the count, and wires the badge, the drawer and the store', () => {
  const src = read('src/App.tsx');
  assert.doesNotMatch(src, /auditFunnel/);
  assert.match(src, /import \{ checkJourneyDesign \} from '\.\/lib\/designChecks';/);
  const start = src.indexOf('const handlePublishFunnel');
  const publish = src.slice(start, src.indexOf('setPublishing(true)', start));
  // The signed-out return comes first: fixing checks would not make a signed-out publish work.
  assert.ok(publish.indexOf('if (!user)') < publish.indexOf('checkJourneyDesign('));
  assert.ok(publish.includes(
    "`This journey has ${open} open design ${open === 1 ? 'check' : 'checks'}. Choose Cancel to see ${open === 1 ? 'it' : 'them'}, or OK to publish anyway.`"
  ));
  assert.doesNotMatch(publish, /overallScore|storeScoreFor|\/100/, 'the store score never gates publishing');
  // Stable, or the context re-renders every card on each App render.
  assert.match(src, /const openIssues = useCallback\(\(id: string\) => \{ setAuditFocusNodeId\(id\); setShowAuditDrawer\(true\); \}, \[\]\);/);
  assert.match(src, /onOpenIssues=\{openIssues\}/);
  assert.match(src, /onOpenAudit=\{openAudit\}/);
  const drawer = src.slice(src.indexOf('<PreFlightAuditDrawer'));
  assert.match(drawer, /focusNodeId=\{auditFocusNodeId\}/);
  assert.match(drawer, /onOpenShopifyConnect=\{\(\) => setShowShopifyModal\(true\)\}/);
  assert.match(drawer, /signedIn=\{!!user\}/);
  assert.match(drawer, /onClose=\{\(\) => \{ setShowAuditDrawer\(false\); setAuditFocusNodeId\(null\); \}\}/);
  // A row goes through the one step chooser (#7), which also reveals a hidden retention step.
  assert.match(drawer, /onSelectNode=\{openStep\}/);
});

test('no new user-facing text in the wiring carries an em dash or a spaced en dash', () => {
  for (const f of ['src/components/toolbar/CanvasHeader.tsx', 'src/components/canvas/DesignIssueBadge.tsx']) {
    const src = read(f);
    const start = src.indexOf('Check design');
    const region = f.endsWith('CanvasHeader.tsx') ? src.slice(start - 2000, start + 2000) : src;
    assert.doesNotMatch(region, /—| – /, f);
  }
  const app = read('src/App.tsx');
  const confirm = app.slice(app.indexOf('This journey has'), app.indexOf('publish anyway.') + 20);
  assert.doesNotMatch(confirm, /—| – /);
});
