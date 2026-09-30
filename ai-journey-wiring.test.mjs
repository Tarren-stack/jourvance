// Draft with AI (#25), the integration part: the More menu entry, App's handleCreateFromAi, the
// canvas remount and the honest card fallbacks. journey-ai.test.mjs pins the builder's logic and
// ai-journey-route.test.mjs the server route; this file pins how they are wired into the app.
//
// #18 landed first in this lane, so Create ADDS the draft to the journey library through
// nav.startJourney (the open journey is saved or kept in this browser first and stays one Back
// away) instead of replacing the journey on the canvas.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('./src/App.tsx');
const header = read('./src/components/toolbar/CanvasHeader.tsx');
const upsell = read('./src/components/canvas/nodes/UpsellNode.tsx');
const thanks = read('./src/components/canvas/nodes/ThankYouNode.tsx');
const css = read('./src/index.css');
const EM_DASH = /—|\s–\s/;

/** The text of a function or block from its first line to the first line that starts with `end`. */
function block(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `${start} not found`);
  assert.equal(text.indexOf(start, from + 1), -1, `${start} appears more than once`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `${end} not found after ${start}`);
  return text.slice(from, to + end.length);
}

test('the More menu offers Draft with AI right after Blueprints, and the More button is findable', () => {
  assert.match(header, /import \{[^}]*\bWandSparkles\b[^}]*\} from 'lucide-react'/);
  const props = block(header, 'interface Props', '\n}');
  assert.match(props, /\bonOpenAiBuilder\?:\s*\(\)\s*=>\s*void;/);
  assert.match(
    header,
    /onOpenBlueprints \? \{ label: 'Blueprints'[^\n]*\n\s*onOpenAiBuilder \? \{ label: 'Draft with AI', icon: WandSparkles, color: '#C4B5FD', onClick: onOpenAiBuilder \} : null,/
  );
  // The one button that toggles the More menu carries the attribute, and nothing else does.
  assert.equal(header.split('data-more-trigger').length - 1, 1, 'data-more-trigger appears once');
  const at = header.indexOf('data-more-trigger');
  const trigger = header.slice(header.lastIndexOf('<button', at), header.indexOf('<span>More</span>', at));
  assert.match(trigger, /setShowMoreMenu\(v => !v\)/);
  assert.match(trigger, /aria-haspopup="menu"/);
});

test('App opens the builder from the header and hands Create to the journey library', () => {
  assert.match(app, /const AiJourneyBuilder = lazy\(\(\) => import\('\.\/components\/modals\/AiJourneyBuilder'\)\.then\(m => \(\{ default: m\.AiJourneyBuilder \}\)\)\);/);
  assert.match(app, /const \[showAiBuilder, setShowAiBuilder\] = useState\(false\);/);
  assert.match(app, /onOpenAiBuilder=\{\(\) => setShowAiBuilder\(true\)\}/);

  const create = block(app, 'const handleCreateFromAi = async (journey: JourneyProject): Promise<string | null> => {', '\n  };');
  // Through #18's startJourney, which keeps the open journey first. Never a bare replace.
  assert.match(create, /await nav\.startJourney\(journey\)/);
  assert.doesNotMatch(create, /setProject\(/);
  // A refusal is said once, in the dialog: the header's copy of it is dismissed.
  assert.match(create, /nav\.dismissNotice\(\)/);
  assert.match(create, /return `Not created\. \$\{refused\.message\}`;/);
  assert.match(create, /return null;/);
  assert.doesNotMatch(create, EM_DASH);
  // The builder's logic stays in its own lazy chunk: App imports nothing from it.
  assert.doesNotMatch(app, /from '\.\/lib\/journeyAi'/);
  assert.match(create, /setActiveView\('canvas'\)/);

  const render = block(app, '{showAiBuilder && (', '\n        )}');
  for (const prop of [
    'signedIn={!!user}',
    'businessType={project.businessType}',
    'workspaceId={currentWorkspace?.id}',
    'onCreate={handleCreateFromAi}',
    'createMode="add"',
    'onClose={() => setShowAiBuilder(false)}'
  ]) {
    assert.ok(render.includes(prop), prop);
  }
  assert.match(render, /onOpenAuth=\{\(\) => \{ setShowAiBuilder\(false\); setShowAuthModal\(true\); \}\}/);
  assert.match(render, /onOpenBlueprints=\{\(\) => \{ setShowAiBuilder\(false\); setBlueprintModalTab\('turnkey'\); setShowBlueprintModal\(true\); \}\}/);
});

test('the canvas remounts on a new journey, so the new map is fitted into view', () => {
  assert.match(app, /<JourneyCanvas\s+key=\{project\.id\}/);
});

test('the upsell card invents no product, price, code or reservation hold', () => {
  for (const s of ['Bioactive Triple Barrier Reserve', 'Deluxe Travel Ritual Duo', "'$38.00'", "'$24.00'", "'SAVE 40%'", "'SAVE 50%'"]) {
    assert.ok(!upsell.includes(s), s);
  }
  // The hold line used to read "5m Reservation Hold" on every upsell that set no timer.
  assert.doesNotMatch(upsell, /urgencyMinutes\s*\|\|\s*\d/);
  assert.match(upsell, /\{\(d\.urgencyMinutes \?\? 0\) > 0 && \(/);
  assert.match(upsell, /d\.badgeText \|\| \(isDownsell \? 'Downsell' : 'Upsell'\)/);
});

test('the thank-you card invents no code and no guide', () => {
  for (const s of ["'VIPRETURN'", "'$15 off next order'", '|| 3']) assert.ok(!thanks.includes(s), s);
  assert.match(thanks, /d\.badgeText \|\| 'Thank-you page'/);
  assert.match(thanks, /\{d\.bounceBackDiscountCode && \(/);
  assert.match(thanks, /\{stepsCount > 0 && \(/);
});

test('the builder shows a focus ring on every control', () => {
  assert.match(css, /\.jv-ai-builder :focus-visible \{\s*outline: 2px solid #A5B4FC;\s*outline-offset: 2px;\s*\}/);
});
