import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Plain language in the page builder (Wave 2 polish). The model words its refusals for developers
// ("is not a finite number", "theme.primary", "#rrggbbaa"), and the theme refusals named the code key
// ("Theme containerWidth"). What a merchant reads is the field's own name and ordinary words. Driven
// through the real reducer, so it reads what the notice under a field really says.

const { createBuilderState, builderReducer } = await import('./src/components/builder/builderState.ts');
const { LAYOUTS } = await import('./src/components/builder/dropZones.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
const { migrateLegacyPage } = await import('./src/lib/pageBuilder/model.mjs');

const page = DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.id === 'node-page-1').data;
const state = createBuilderState(migrateLegacyPage(page));
const notice = action => {
  const next = builderReducer(state, action);
  assert.ok(next.notice, `${JSON.stringify(action)} was not refused`);
  return next.notice.text;
};
const style = (key, value) => notice({ type: 'setStyle', id: 'legacy-offer', values: { [key]: value }, target: `style.${key}` });
const theme = (patch, target) => notice({ type: 'setTheme', theme: patch, target });

const FIELD_NAMES = {
  'theme.colors.primary': ['Main colour', { colors: { primary: 'red' } }],
  'theme.colors.secondary': ['Second colour', { colors: { secondary: 'red' } }],
  'theme.colors.background': ['Page background', { colors: { background: 'red' } }],
  'theme.colors.surface': ['Card background', { colors: { surface: 'red' } }],
  'theme.colors.text': ['Text', { colors: { text: 'red' } }],
  'theme.colors.muted': ['Quiet text', { colors: { muted: 'red' } }],
  'theme.fonts.heading': ['Heading font', { fonts: { heading: 'Bad;Font' } }],
  'theme.fonts.body': ['Body font', { fonts: { body: 'Bad;Font' } }],
  'theme.radius': ['Corner radius', { radius: 999 }],
  'theme.containerWidth': ['Content width', { containerWidth: 10 }],
  'theme.spacingScale': ['Spacing step', { spacingScale: 99 }]
};

describe('a refusal names the field as the merchant sees it', () => {
  for (const [target, [name, patch]] of Object.entries(FIELD_NAMES)) {
    test(`${target} is "${name}"`, () => {
      const text = theme(patch, target);
      assert.ok(text.startsWith(`${name}: `), text);
      assert.doesNotMatch(text, /containerWidth|spacingScale|buttonStyle|Theme [a-z]/);
    });
  }
  test('a button style the theme does not know is "Button style"', () => {
    assert.ok(theme({ buttonStyle: 'zzz' }, 'theme.buttonStyle').startsWith('Button style: '));
  });
});

describe('a refusal uses ordinary words', () => {
  const texts = () => [
    style('maxWidth', 'x'),
    style('width', 'abc'),
    style('backgroundColor', 'red'),
    style('borderColor', '#zzz'),
    style('fontFamily', 'a;b'),
    style('paddingTop', 99999),
    theme({ colors: { primary: '#12' } }, 'theme.colors.primary'),
    theme({ fonts: { heading: 'Bad;Font' } }, 'theme.fonts.heading')
  ];
  test('no developer words and no code spelling in anything a field can say', () => {
    for (const text of texts()) {
      assert.doesNotMatch(text, /finite/, text);
      assert.doesNotMatch(text, /theme\.(primary|heading|body)/, text);
      assert.doesNotMatch(text, /#rrggbb|#rgb/, text);
      assert.ok(!text.includes('\u2014'), text);
    }
  });
  test('a number field that cannot read its text says so plainly', () => {
    assert.equal(style('maxWidth', 'x'), 'Maximum width: "x" is not a number.');
  });
  test('a colour says how to write one', () => {
    assert.match(style('backgroundColor', 'red'), /use a colour code such as #ec4899, or pick a theme colour from the list\.$/);
    assert.match(theme({ colors: { primary: '#12' } }, 'theme.colors.primary'), /a theme colour is a colour code such as #ec4899\.$/);
  });
  test('a font says to pick the theme font from the list', () => {
    assert.match(style('fontFamily', 'a;b'), /or pick the theme heading or body font\.$/);
  });
});

describe('the palette says what each layout is', () => {
  test('every layout label reads as words, and the three uneven ones say which column is wide', () => {
    for (const layout of LAYOUTS) assert.match(layout.label, /column/, layout.label);
    const uneven = LAYOUTS.filter(l => l.columns.some(c => c > 0));
    assert.equal(uneven.length, 3);
    for (const layout of uneven) assert.match(layout.label, /^2 columns, (narrow|wide) first \(\d\d \/ \d\d\)$/, layout.label);
  });
});

describe('a colour field is named for what it takes', () => {
  test('the hex box says colour code, not hex code', () => {
    const fields = fs.readFileSync('src/components/builder/BuilderFields.tsx', 'utf8');
    assert.match(fields, /`\$\{label\}, colour code`/);
    assert.doesNotMatch(fields, /hex code/);
  });
});

describe('the empty-block hint stays readable on any page colour', () => {
  test('its backdrop is opaque, so its contrast does not depend on the merchant page behind it', async () => {
    const { EDITOR_CSS } = await import('./src/components/builder/canvasMarkup.ts');
    const { contrastRatio, composite } = await import('./src/lib/a11yRules.ts');
    const rule = EDITOR_CSS.split('\n').find(line => line.includes('.jvbe-empty{'));
    assert.ok(rule, 'the hint rule');
    assert.match(rule, /background-color:#0F172A;/);
    assert.doesNotMatch(rule, /background-color:rgba/);
    const text = { r: 0xCB, g: 0xD5, b: 0xE1, a: 1 };
    const opaque = { r: 0x0F, g: 0x17, b: 0x2A, a: 1 };
    assert.ok(contrastRatio(text, opaque) >= 4.5, `${contrastRatio(text, opaque).toFixed(2)} to 1`);
    // The old translucent backdrop over a white page, which this pins against: under 3 to 1.
    const old = composite({ r: 15, g: 23, b: 42, a: 0.55 }, { r: 255, g: 255, b: 255, a: 1 });
    assert.ok(contrastRatio(text, old) < 3, `${contrastRatio(text, old).toFixed(2)} to 1`);
  });
});
