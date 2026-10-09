import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// EMAIL_STUDIO_PLAN.md Wave 3: five destinations. Email Studio had twelve tabs in one strip that
// wrapped to six rows on a phone, two of them called Deliverability. src/lib/emailStudioNav.ts holds
// the five destinations (D1), their sections, and LEGACY_TAB, which says where each of the twelve
// old keys opens, because App still passes 'map' when a funnel step opens the studio. These tests
// hold that data and the keyboard rule; the source pins hold the WAI-ARIA tabs shape in
// HubEmailSuite.tsx. The behaviour is driven in real Chrome by scripts/email-studio-browser-check.mjs
// (nav-five, nav-moved, nav-keyboard, nav-active, nav-390, nav-from-step).

const {
  STUDIO_DESTINATIONS, LEGACY_TAB, STUDIO_HOME, placeFor, destinationOf, firstSectionOf, nextTabIndex
} = await import('./src/lib/emailStudioNav.ts');

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const suite = read('./src/components/campaign/HubEmailSuite.tsx');
const app = read('./src/App.tsx');

/** The source from `start` up to (not including) `end`. Both must be found, in that order. */
function between(src, start, end, name) {
  const from = src.indexOf(start);
  assert.ok(from > -1, `${name}: "${start}" was not found`);
  const to = src.indexOf(end, from + start.length);
  assert.ok(to > from, `${name}: "${end}" was not found after "${start}"`);
  return src.slice(from, to);
}

/** The old tab keys, read from the exported type, so this list is not a second copy of LEGACY_TAB. */
function legacyKeys() {
  const m = suite.match(/export type EmailStudioTab = ([^;]+);/);
  assert.ok(m, 'EmailStudioTab is not exported from HubEmailSuite.tsx');
  const keys = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  assert.equal(keys.length, 12, `EmailStudioTab names ${keys.length} keys, not the twelve tabs before Wave 3`);
  return keys;
}

const sectionsOf = (key) => STUDIO_DESTINATIONS.find((d) => d.key === key)?.sections || [];
// Any dash character (figure dash to horizontal bar, and the minus sign), or a hyphen standing
// between spaces as a dash would. A hyphen inside a word ("Sign-up") is a hyphen.
const DASHED = /[‒-―−]|\s-\s/;

test('every tab key from before the five destinations opens a real section', () => {
  const keys = legacyKeys();
  for (const key of keys) {
    assert.ok(Object.hasOwn(LEGACY_TAB, key), `LEGACY_TAB has no entry for '${key}'`);
    const place = LEGACY_TAB[key];
    assert.ok(sectionsOf(place.destination).some((s) => s.key === place.section), `'${key}' maps to ${JSON.stringify(place)}, which is not a section of that destination`);
    assert.deepEqual(placeFor(key), place, `placeFor('${key}') does not read LEGACY_TAB`);
    assert.equal(destinationOf(place.section).key, place.destination, `the section '${place.section}' is not held by '${place.destination}'`);
  }
  assert.deepEqual(Object.keys(LEGACY_TAB).sort(), [...keys].sort(), 'LEGACY_TAB names a key that is not an old tab');
});

test("'map', the key App passes from a funnel step, lands on the Flows editor", () => {
  assert.deepEqual(LEGACY_TAB.map, { destination: 'flows', section: 'map' });
  assert.ok(app.includes("initialTab={funnelReturn ? 'map' : undefined}"), 'App no longer passes map from a step');
  // The section 'map' is the one that mounts the flow editor, on the step's flow.
  assert.ok(suite.includes("{activeTab === 'map' && <EmailFlowMap initialFlowId={mapFlowId || openFlowId}"), "the 'map' section does not mount EmailFlowMap");
  // The studio's first state is read through LEGACY_TAB, once.
  assert.match(suite, /useState<StudioSectionKey>\(\(\) => placeFor\(initialTab \|\| 'flows'\)\.section\)/);
  // A missing or unknown key opens the studio's home, Flows on its list, never a blank panel.
  for (const key of [undefined, null, '', 'nope', '__proto__', 'constructor', 'toString']) {
    assert.deepEqual(placeFor(key), STUDIO_HOME, `placeFor(${JSON.stringify(key)})`);
  }
  assert.deepEqual(STUDIO_HOME, { destination: 'flows', section: firstSectionOf('flows') });
});

test('five destinations in D1 order, each section in exactly one, and the new sections where D1 puts them', () => {
  assert.deepEqual(STUDIO_DESTINATIONS.map((d) => d.label), ['Flows', 'Broadcasts', 'Audience', 'Results', 'Settings']);
  const keys = STUDIO_DESTINATIONS.flatMap((d) => d.sections.map((s) => s.key));
  assert.equal(new Set(keys).size, keys.length, `a section key is in two destinations: ${keys.join(', ')}`);
  assert.ok(STUDIO_DESTINATIONS.every((d) => d.sections.length >= 1));
  assert.equal(destinationOf('checkouts').key, 'audience');
  assert.equal(destinationOf('advanced').key, 'settings');
  assert.equal(sectionsOf('settings').find((s) => s.key === 'sms')?.badge, 'Soon', 'Texts (Soon) is not under Settings');
  assert.equal(sectionsOf('settings').find((s) => s.key === 'advanced')?.label, 'Advanced');
  assert.equal(sectionsOf('audience').find((s) => s.key === 'checkouts')?.label, 'Open checkouts');
});

test('no two sections share a label, and no label holds a dash', () => {
  const labels = STUDIO_DESTINATIONS.flatMap((d) => d.sections.map((s) => s.label));
  const twice = labels.filter((label, i) => labels.indexOf(label) !== i);
  assert.deepEqual(twice, [], `section labels used twice: ${twice.join(', ')}`);
  const every = [
    ...STUDIO_DESTINATIONS.map((d) => d.label),
    ...STUDIO_DESTINATIONS.flatMap((d) => d.sections.flatMap((s) => [s.label, s.badge || '']))
  ];
  assert.ok(every.includes('Sign-up forms'), 'the hyphen control is gone, so the dash scan is not shown to allow a hyphen');
  const dashed = every.filter((label) => DASHED.test(label));
  assert.deepEqual(dashed, [], `labels with a dash: ${dashed.join(', ')}`);
  // The pattern itself finds what it must, so a clean result means something.
  for (const probe of ['A \u2014 B', 'A\u2013B', 'A - B']) assert.ok(DASHED.test(probe), probe);
});

test('the arrow keys move one tab and wrap; Home and End go to either end; other keys do nothing', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 5), 1);
  assert.equal(nextTabIndex('ArrowRight', 4, 5), 0);
  assert.equal(nextTabIndex('ArrowLeft', 2, 5), 1);
  assert.equal(nextTabIndex('ArrowLeft', 0, 5), 4);
  assert.equal(nextTabIndex('Home', 3, 5), 0);
  assert.equal(nextTabIndex('End', 1, 5), 4);
  for (const key of ['Enter', ' ', 'Tab', 'ArrowDown', 'ArrowUp', 'a']) assert.equal(nextTabIndex(key, 2, 5), null, key);
  assert.equal(nextTabIndex('ArrowRight', 0, 1), 0);
  assert.equal(nextTabIndex('ArrowRight', 0, 0), null);
});

test('source: both strips are WAI-ARIA tablists the arrow keys drive', () => {
  // The five destinations.
  const top = between(suite, '<div\n        role="tablist"\n        aria-label="Email Studio"', '{/* Every tab', 'the destination strip');
  assert.match(top, /STUDIO_DESTINATIONS\.map\(\(dest, index\) =>/);
  for (const attr of ['role="tab"', 'aria-selected={selected}', 'aria-controls={`email-studio-panel-${dest.key}`}', 'id={`email-studio-tab-${dest.key}`}', 'tabIndex={selected ? 0 : -1}', 'onKeyDown={(e) => onDestinationKey(e, index)}', 'onClick={() => selectDestination(dest.key)}']) {
    assert.ok(top.includes(attr), `a destination tab has no ${attr}`);
  }
  // The sections of the open destination: a second tablist of the same kind.
  const second = between(suite, 'role="tablist"\n          aria-label={`${destination.label} sections`}', '{/* Main Tab Content', 'the section strip');
  for (const attr of ['role="tab"', 'aria-selected={active}', 'aria-controls={`email-studio-section-${tab.key}`}', 'id={`email-studio-section-tab-${tab.key}`}', 'tabIndex={active ? 0 : -1}', 'onKeyDown={(e) => onSectionKey(e, index)}']) {
    assert.ok(second.includes(attr), `a section tab has no ${attr}`);
  }
  // Every aria-controls names a panel that exists, labelled by its tab.
  assert.ok(suite.includes('role="tabpanel" id={`email-studio-panel-${dest.key}`} aria-labelledby={`email-studio-tab-${dest.key}`} hidden'));
  assert.ok(suite.includes('role="tabpanel"\n        id={`email-studio-panel-${destination.key}`}\n        aria-labelledby={`email-studio-tab-${destination.key}`}'));
  assert.ok(suite.includes('role="tabpanel" id={`email-studio-section-${tab.key}`} aria-labelledby={`email-studio-section-tab-${tab.key}`} hidden'));
  // An arrow, Home or End selects the tab AND moves focus to it, and the page does not scroll.
  for (const [name, count, refs] of [['onDestinationKey', 'STUDIO_DESTINATIONS.length', 'destinationTabs'], ['onSectionKey', 'destination.sections.length', 'sectionTabs']]) {
    const handler = between(suite, `const ${name} = `, '};', name);
    assert.ok(handler.includes(`nextTabIndex(e.key, index, ${count})`), `${name} does not read the keyboard rule`);
    assert.ok(handler.includes('e.preventDefault();'), `${name} lets the arrow scroll the page`);
    assert.ok(handler.includes(`${refs}.current[target.key]?.focus();`), `${name} moves the selection without the focus`);
  }
  // The selected tab is marked by a bar as well as by colour, on both strips.
  assert.equal((suite.match(/\{(selected|active) && <span aria-hidden="true" style=\{SELECTED_BAR\} \/>\}/g) || []).length, 2);
  assert.match(between(suite, 'const SELECTED_BAR', '};', 'SELECTED_BAR'), /borderBottom: '3px solid #f472b6'/);
  // The twelve-tab strip is gone.
  assert.ok(!suite.includes("label: 'Automations'"), 'the old strip is still there');
  assert.ok(!suite.includes("label: 'DNS & Deliverability'"));
});

test('source: Hub Engine is gone; the hand-run controls are in Settings, Advanced; the checkouts table is in Audience, Open checkouts', () => {
  assert.ok(!suite.includes('Hub Engine'), 'the Hub Engine badge is still in the banner');
  assert.ok(!suite.includes('Run Queue Tick'), 'the D2 name is "Send due emails now"');
  const flows = between(suite, "{activeTab === 'flows' && (", "{activeTab === 'map' && <EmailFlowMap", 'the Flows list');
  assert.doesNotMatch(flows, /handleRunDripTick|setShowWebhookGuide\(true\)|Shopify Abandoned Checkouts Queue|dripTickMsg/, 'a moved control is still on the Flows list');
  const advanced = between(suite, "{activeTab === 'advanced' && (", "{activeTab === 'campaigns' && (", 'Settings, Advanced');
  assert.ok(advanced.includes('onClick={handleRunDripTick}'));
  assert.ok(advanced.includes("{processingDripTick ? 'Sending due emails' : 'Send due emails now'}"));
  assert.ok(advanced.includes('onClick={() => setShowWebhookGuide(true)}'));
  assert.ok(advanced.includes('<span>Webhooks</span>'));
  assert.match(advanced, /<div role="status">\s*\{dripTickMsg && \(/, 'the result of Send due emails now is not in a status region');
  const checkouts = between(suite, "{activeTab === 'checkouts' && (", "{activeTab === 'advanced' && (", 'Audience, Open checkouts');
  assert.ok(checkouts.includes('Shopify Abandoned Checkouts Queue'));
  // "None yet" only of a list that was read; a failed read says so.
  assert.ok(checkouts.includes("checkoutsLoad.state === 'loaded' && abandonedCheckouts.length === 0"));
  assert.ok(checkouts.includes("checkoutsLoad.state === 'failed'"));
  const load = between(suite, 'const loadData = async', 'const refreshSequences', 'loadData');
  assert.match(load, /setCheckoutsLoad\(\{ state: 'loaded' \}\);/);
  assert.match(load, /setCheckoutsLoad\(checkoutsFailure\(/);
});

// Wave 3 fix round. Copy that sends the reader somewhere in the studio still named the old tabs: the
// step panel's note on a built-in flow said "Turn it on or off from Automations." and the Klaviyo note
// said "on the Klaviyo tab", after Automations became Flows, All flows and Klaviyo a section of
// Settings; the All flows section opened on a heading that said Automations.
const studioLabels = new Set(STUDIO_DESTINATIONS.flatMap((d) => [d.label, ...d.sections.map((s) => s.label)]));
const allFlowsLabel = () => sectionsOf('flows').find((s) => s.key === 'flows')?.label;

test("the built-in flow note sends the reader to the section that turns it on, and the browser check's stub carries the same sentence", () => {
  const note = read('./server.mjs').match(/const BUILT_IN_FLOW_NOTE = '([^']+)';/);
  assert.ok(note, 'BUILT_IN_FLOW_NOTE was not found in server.mjs');
  const place = note[1].match(/Turn it on or off from ([^.]+)\.$/);
  assert.ok(place, `BUILT_IN_FLOW_NOTE no longer says where the flow is turned on: "${note[1]}"`);
  assert.ok(studioLabels.has(place[1]), `BUILT_IN_FLOW_NOTE sends the reader to "${place[1]}", which is no destination or section: ${[...studioLabels].join(', ')}`);
  // The built-in flows' On and Off are on the list EmailFlowsList draws in the 'flows' section (Wave 4).
  assert.equal(place[1], allFlowsLabel());
  const check = read('./scripts/email-studio-browser-check.mjs');
  assert.ok(check.includes(`const BUILT_IN_FLOW_NOTE = '${note[1]}';`), 'the browser check stubs the flow map with another built-in flow note than server.mjs sends');
});

test('studio copy names a place as "in <destination>, <section>", and never as "the ... tab"', () => {
  const files = {
    'HubEmailSuite.tsx': suite,
    'EmailFlowMap.tsx': read('./src/components/campaign/EmailFlowMap.tsx'),
    'EmailPrograms.tsx': read('./src/components/campaign/EmailPrograms.tsx'),
    'EmailFlowsList.tsx': read('./src/components/campaign/EmailFlowsList.tsx'),
    'EmailStepPreview.tsx': read('./src/components/campaign/EmailStepPreview.tsx')
  };
  const place = new RegExp(`\\bin (${STUDIO_DESTINATIONS.map((d) => d.label).join('|')}), ([A-Z][A-Za-z-]*(?: [a-z][A-Za-z-]*)*)`, 'g');
  const found = [];
  for (const [name, src] of Object.entries(files)) {
    const tabs = [...src.matchAll(/\bon the [A-Z][\w&; ]* tab\b/g)].map((m) => m[0]);
    assert.deepEqual(tabs, [], `${name} still sends the reader to a tab: ${tabs.join(' | ')}`);
    for (const m of src.matchAll(place)) {
      const dest = STUDIO_DESTINATIONS.find((d) => d.label === m[1]);
      assert.ok(dest.sections.some((s) => s.label === m[2]), `${name}: "${m[0]}" names no section of ${m[1]}`);
      found.push(`${name}: ${m[0]}`);
    }
  }
  // The two places this round names, so a clean scan is shown to have read something.
  assert.ok(found.some((f) => f.startsWith('HubEmailSuite.tsx: in Settings, Advanced')), `found: ${found.join(' | ')}`);
  assert.ok(found.some((f) => f.startsWith('EmailFlowMap.tsx: in Settings, Klaviyo')), `found: ${found.join(' | ')}`);
});

test("the All flows section opens on a heading that says All flows", () => {
  // Wave 4: the list is EmailFlowsList.tsx (it was EmailPrograms' automations mode).
  const list = read('./src/components/campaign/EmailFlowsList.tsx');
  const h2 = list.match(/<h2[^>]*>([^<]+)<\/h2>/);
  assert.ok(h2, 'the All flows list has no h2');
  assert.equal(h2[1], allFlowsLabel(), `the tab reads "${allFlowsLabel()}" and the list it opens is headed "${h2[1]}"`);
  // That list is the first thing the 'flows' section draws.
  const flows = between(suite, "{activeTab === 'flows' && (", "{activeTab === 'map' && <EmailFlowMap", 'the Flows list');
  assert.match(flows, /^\{activeTab === 'flows' && \(\s*<div[^>]*>\s*<EmailFlowsList /);
});

test('source: the panel holding the content is the Tab stop after its tab', () => {
  // WAI-ARIA tabs: a panel whose first content is not focusable takes tabindex 0. Every studio panel
  // opens on a heading. With a second strip that is the section's panel; Results has none, so its
  // destination panel is the stop, and a destination panel with sections stays out of the Tab order.
  assert.ok(suite.includes("'aria-labelledby': `email-studio-section-tab-${activeTab}`, tabIndex: 0 }"), "the open section's panel is not a Tab stop");
  assert.ok(suite.includes('tabIndex={destination.sections.length > 1 ? undefined : 0}'), 'a destination with no sections has no Tab stop for its panel');
});
