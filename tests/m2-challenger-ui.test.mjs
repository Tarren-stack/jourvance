import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import {
  renderPublicFunnelHtml,
  renderPublicThankYouHtml,
  renderPublicUpsellHtml,
  withTracking
} from '../server/routes/publicRoutes.mjs';

import {
  PAGE_THEME_IDS,
  isPageThemeId
} from '../src/types/journey.ts';

import {
  PAGE_THEMES,
  renderThemeHeadAssets
} from '../src/lib/pageThemes.ts';

import {
  PAGE_EDITOR_SECTIONS
} from '../src/lib/pageEditorSections.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');
const fixturesDir = path.join(rootDir, 'test-fixtures', 'legacy-pages');
const pageEditorPath = path.join(rootDir, 'src', 'components', 'drawers', 'PageEditor.tsx');
const pageEditorSrc = fs.readFileSync(pageEditorPath, 'utf8');

// Parse PageEditor.tsx into a TypeScript AST
const sourceFile = ts.createSourceFile(
  'PageEditor.tsx',
  pageEditorSrc,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

const shopConfig = { storeDomain: 'shop.myshopify.com', currency: 'USD' };
const VARIANT_ID = 'gid://shopify/ProductVariant/123';
const BUMP_ID = 'gid://shopify/ProductVariant/456';
const makeReq = (query = {}, headers = {}) => ({ query, headers, params: {} });

const sampleFullLanding = {
  headline: 'Glow in seven days',
  subhead: 'A serum made in small batches.',
  bullets: ['Fragrance free', 'Dermatologist tested', 'Ships in 2 days'],
  buttonText: 'Get the serum',
  heroImageUrl: 'https://cdn.example.com/hero.jpg',
  shopifyVariantId: VARIANT_ID,
  shopifyProductId: 'gid://shopify/Product/9',
  shopifyProductTitle: 'Glow Serum',
  shopifyProductPrice: '48.00',
  shopifyProductImage: 'https://cdn.example.com/serum.jpg',
  discountCode: 'WELCOME10',
  trustBadge: 'Free returns for 30 days',
  orderBumpEnabled: true,
  orderBumpVariantId: BUMP_ID,
  orderBumpTitle: 'Travel size',
  orderBumpPrice: '12.00',
  orderBumpHeadline: 'Add a travel size',
  orderBumpDescription: 'Fits a carry-on.',
  urgencyTimerEnabled: true,
  urgencyMinutes: 15,
  urgencyText: 'This offer ends in',
  scarcityBatchEnabled: true,
  scarcityBatchCount: 40,
  exitIntentEnabled: true,
  exitIntentHeadline: 'Wait, take 10 percent off',
  exitIntentDiscountCode: 'STAY10',
  metaPixelId: '123456789012345',
  tiktokPixelId: 'C1ABCDEFGHIJKLMNOP',
  ga4TrackingId: 'G-ABC123XYZ9',
  abTestingEnabled: true,
  splitRatio: 50,
  variantB: { headline: 'Glow in a week', buttonText: 'Start glowing', subhead: 'Small batches, big results.' }
};

// Map each legacy snapshot fixture to a renderer function accepting custom theme overrides
const FIXTURE_FACTORIES = [
  [
    'landing-minimal-nostore',
    (themeOverride) => renderPublicFunnelHtml(
      { slug: 'min', data: { headline: 'Hello', buttonText: 'Buy', ...(themeOverride !== undefined ? { theme: themeOverride } : {}) }, shopifyConfig: {} },
      makeReq(),
      null
    )
  ],
  [
    'landing-full-a',
    (themeOverride) => renderPublicFunnelHtml(
      { slug: 'full', userId: 'u1', data: { ...sampleFullLanding, ...(themeOverride !== undefined ? { theme: themeOverride } : {}) }, shopifyConfig: shopConfig },
      makeReq({ var: 'a' }),
      null
    )
  ],
  [
    'landing-full-b',
    (themeOverride) => renderPublicFunnelHtml(
      { slug: 'full', userId: 'u1', data: { ...sampleFullLanding, ...(themeOverride !== undefined ? { theme: themeOverride } : {}) }, shopifyConfig: shopConfig },
      makeReq({ var: 'b' }),
      null
    )
  ],
  [
    'landing-full-eur',
    (themeOverride) => renderPublicFunnelHtml(
      { slug: 'full', userId: 'u1', data: { ...sampleFullLanding, ...(themeOverride !== undefined ? { theme: themeOverride } : {}) }, shopifyConfig: shopConfig },
      makeReq({ var: 'a', currency: 'EUR' }),
      null
    )
  ],
  [
    'landing-lead-gate',
    (themeOverride) => renderPublicFunnelHtml(
      { slug: 'gate', data: { headline: 'Free guide', buttonText: 'Send it', checkoutMode: 'lead-gate', shopifyVariantId: VARIANT_ID, shopifyProductPrice: '0', ...(themeOverride !== undefined ? { theme: themeOverride } : {}) }, shopifyConfig: shopConfig },
      makeReq(),
      null
    )
  ],
  [
    'landing-lead-gate-nocode',
    (themeOverride) => renderPublicFunnelHtml(
      { slug: 'gate2', data: { headline: 'Join', buttonText: 'Join', checkoutMode: 'lead-gate', shopifyVariantId: VARIANT_ID, ...(themeOverride !== undefined ? { theme: themeOverride } : {}) }, shopifyConfig: shopConfig },
      makeReq(),
      null
    )
  ],
  [
    'landing-referral',
    (themeOverride) => renderPublicFunnelHtml(
      { slug: 'ref', data: { headline: 'Refer', buttonText: 'Buy', shopifyVariantId: VARIANT_ID, discountCode: 'SAVE5', ...(themeOverride !== undefined ? { theme: themeOverride } : {}) }, shopifyConfig: shopConfig },
      makeReq({ ref: 'friend42', utm_source: 'fb' }),
      null
    )
  ],
  [
    'thank-you',
    (themeOverride) => renderPublicThankYouHtml(
      { slug: 'ty', data: { headline: 'Thank you', subhead: 'Your order is on its way.', ...(themeOverride !== undefined ? { theme: themeOverride } : {}) }, shopifyConfig: shopConfig },
      makeReq(),
      null
    )
  ],
  [
    'upsell',
    (themeOverride) => renderPublicUpsellHtml(
      { slug: 'up', data: { headline: 'One more thing', subhead: 'Add the refill.', buttonText: 'Add it', shopifyVariantId: VARIANT_ID, shopifyProductPrice: '20.00', ...(themeOverride !== undefined ? { theme: themeOverride } : {}) }, shopifyConfig: shopConfig },
      makeReq(),
      null,
      false
    )
  ],
  [
    'downsell',
    (themeOverride) => renderPublicUpsellHtml(
      { slug: 'down', data: { headline: 'How about this', offerType: 'downsell', buttonText: 'Yes please', shopifyVariantId: VARIANT_ID, shopifyProductPrice: '9.00', ...(themeOverride !== undefined ? { theme: themeOverride } : {}) }, shopifyConfig: shopConfig },
      makeReq(),
      null,
      true
    )
  ],
  [
    'landing-with-tracking',
    (themeOverride) => withTracking(
      renderPublicFunnelHtml(
        { slug: 'full', userId: 'u1', data: { ...sampleFullLanding, ...(themeOverride !== undefined ? { theme: themeOverride } : {}) }, shopifyConfig: shopConfig },
        makeReq({ var: 'a' }),
        null
      ),
      'full',
      'a',
      true,
      { productId: 'gid://shopify/Product/9', price: '48.00' },
      {}
    )
  ]
];

describe('M2 Challenger Empirical UI & AST Analysis', () => {
  it('verifies fid("page-theme-heading") appears exactly once as a JSX id', () => {
    let countInAST = 0;
    function walk(node) {
      if (ts.isJsxAttribute(node) && node.name.text === 'id' && node.initializer) {
        if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          const expr = node.initializer.expression;
          if (ts.isCallExpression(expr) && expr.expression.text === 'fid') {
            const firstArg = expr.arguments[0];
            if (firstArg && ts.isStringLiteral(firstArg) && firstArg.text === 'page-theme-heading') {
              countInAST++;
            }
          }
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(sourceFile);

    assert.equal(countInAST, 1, 'AST must find exactly one id={fid("page-theme-heading")}');

    const regexMatches = [...pageEditorSrc.matchAll(/\sid=\{fid\('page-theme-heading'\)\}/g)];
    assert.equal(regexMatches.length, 1, 'Source text must contain exactly one id={fid("page-theme-heading")}');

    // Also verify aria-labelledby references the same heading
    assert.match(
      pageEditorSrc,
      /aria-labelledby=\{fid\('page-theme-heading'\)\}/,
      'Theme role group must link aria-labelledby to page-theme-heading'
    );
  });

  it('verifies zero duplicate id={fid(...)} attributes across entire PageEditor.tsx', () => {
    const fidIdsFromAST = [];
    function walk(node) {
      if (ts.isJsxAttribute(node) && node.name.text === 'id' && node.initializer) {
        if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          const expr = node.initializer.expression;
          if (ts.isCallExpression(expr) && expr.expression.text === 'fid') {
            const firstArg = expr.arguments[0];
            if (firstArg && ts.isStringLiteral(firstArg)) {
              fidIdsFromAST.push(firstArg.text);
            }
          }
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(sourceFile);

    assert.ok(fidIdsFromAST.length >= 40, `Expected >= 40 fid IDs in AST, found ${fidIdsFromAST.length}`);

    const duplicatesAST = fidIdsFromAST.filter((id, index) => fidIdsFromAST.indexOf(id) !== index);
    assert.deepEqual(duplicatesAST, [], `Zero duplicate fid IDs allowed in AST. Found: ${duplicatesAST}`);

    const regexFidIds = [...pageEditorSrc.matchAll(/\sid=\{fid\('([^']+)'\)\}/g)].map(m => m[1]);
    const duplicatesRegex = regexFidIds.filter((id, index) => regexFidIds.indexOf(id) !== index);
    assert.deepEqual(duplicatesRegex, [], `Zero duplicate fid IDs allowed via regex. Found: ${duplicatesRegex}`);
    assert.deepEqual(fidIdsFromAST, regexFidIds, 'AST and regex fid collections must be identical');
  });

  it('verifies all 6 theme options exist in PAGE_THEME_OPTIONS (1 default + 5 universal themes)', () => {
    let themeOptionsArrayNode = null;
    ts.forEachChild(sourceFile, node => {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (decl.name.text === 'PAGE_THEME_OPTIONS' && decl.initializer) {
            themeOptionsArrayNode = decl.initializer;
          }
        }
      }
    });

    assert.ok(themeOptionsArrayNode, 'PAGE_THEME_OPTIONS variable must exist');
    assert.ok(ts.isArrayLiteralExpression(themeOptionsArrayNode), 'PAGE_THEME_OPTIONS must be an array literal');
    assert.equal(themeOptionsArrayNode.elements.length, 6, 'Must define exactly 6 theme options');

    const parsedOptions = themeOptionsArrayNode.elements.map(el => {
      assert.ok(ts.isObjectLiteralExpression(el), 'Option must be an object literal');
      const obj = {};
      for (const prop of el.properties) {
        if (ts.isPropertyAssignment(prop) && prop.name && prop.initializer) {
          obj[prop.name.text] = prop.initializer.text;
        }
      }
      return obj;
    });

    const expectedIds = [
      'default',
      'clean-executive',
      'bold-commerce',
      'warm-editorial',
      'creator-minimal',
      'midnight-modern'
    ];

    const expectedNames = [
      'Original (Default)',
      'Clean Executive',
      'Bold Commerce',
      'Warm Editorial',
      'Creator Minimal',
      'Midnight Modern'
    ];

    for (let i = 0; i < 6; i++) {
      const opt = parsedOptions[i];
      assert.equal(opt.id, expectedIds[i]);
      assert.equal(opt.name, expectedNames[i]);
      assert.ok(opt.industry && opt.industry.length > 5, `Option ${opt.id} must have descriptive industry`);
      assert.match(opt.primaryColor, /^#[0-9A-Fa-f]{6}$/, `Option ${opt.id} primaryColor must be 6-digit hex`);
      assert.match(opt.bgColor, /^#[0-9A-Fa-f]{6}$/, `Option ${opt.id} bgColor must be 6-digit hex`);
    }

    // Verify correlation with canonical PAGE_THEME_IDS
    const canonicalSet = new Set(PAGE_THEME_IDS);
    const nonDefaultParsed = parsedOptions.filter(o => o.id !== 'default').map(o => o.id);
    assert.deepEqual(nonDefaultParsed, [...PAGE_THEME_IDS], 'Universal themes must match PAGE_THEME_IDS in order');
  });

  it('verifies dual swatch preview circles are rendered with aria-hidden="true"', () => {
    const cardStart = pageEditorSrc.indexOf('{/* PAGE THEME SELECTOR CARD:');
    const cardEnd = pageEditorSrc.indexOf('<section aria-labelledby={pageWordsHeadingId}');
    assert.ok(cardStart > 0 && cardEnd > cardStart, 'Theme card markup slice found');

    const cardSnippet = pageEditorSrc.slice(cardStart, cardEnd);

    // Look for swatches container
    assert.ok(cardSnippet.includes("opt.primaryColor"), 'Must bind primary swatch color');
    assert.ok(cardSnippet.includes("opt.bgColor"), 'Must bind background swatch color');
    assert.ok(cardSnippet.includes("borderRadius: '50%'"), 'Must render circular swatches');

    // Extract all swatch spans and ensure each has aria-hidden="true"
    const swatchSpanMatches = [...cardSnippet.matchAll(/<span[\s\S]*?borderRadius:\s*'50%'[\s\S]*?\/>/g)];
    assert.equal(swatchSpanMatches.length, 2, 'Must render exactly 2 swatch circles in button template');
    for (const swatch of swatchSpanMatches) {
      assert.match(swatch[0], /aria-hidden="true"/, 'Each swatch circle must have aria-hidden="true"');
    }

    // Also check that Check icon carries aria-hidden="true"
    const checkIconMatch = cardSnippet.match(/<Check\b[\s\S]*?\/>/);
    assert.ok(checkIconMatch, 'Check icon rendered when selected');
    assert.match(checkIconMatch[0], /aria-hidden="true"/, 'Check icon must carry aria-hidden="true"');
  });

  it('verifies theme group buttons have aria-pressed={isSelected} and accessible text labels', () => {
    const cardStart = pageEditorSrc.indexOf('{/* PAGE THEME SELECTOR CARD:');
    const cardEnd = pageEditorSrc.indexOf('<section aria-labelledby={pageWordsHeadingId}');
    const cardSnippet = pageEditorSrc.slice(cardStart, cardEnd);

    assert.match(cardSnippet, /role="group"/, 'Theme card must have role="group"');
    assert.match(cardSnippet, /type="button"/, 'Theme buttons must have type="button"');
    assert.match(cardSnippet, /aria-pressed=\{isSelected\}/, 'Theme buttons must use aria-pressed={isSelected}');
    assert.match(cardSnippet, /\{opt\.name\}/, 'Theme button must display opt.name text');
    assert.match(cardSnippet, /\{opt\.industry\}/, 'Theme button must display opt.industry text');

    // Accessibility check: min font size >= 11px
    const fontSizes = [...cardSnippet.matchAll(/fontSize:\s*['"]?([0-9]+)px['"]?/g)].map(m => parseInt(m[1], 10));
    assert.ok(fontSizes.length > 0, 'Found font size rules in theme card');
    for (const fs of fontSizes) {
      assert.ok(fs >= 11, `Font size ${fs}px must be >= 11px for accessible legibility`);
    }
  });

  it('verifies switching themes calls handleFieldChange("theme", undefined | id)', () => {
    assert.match(
      pageEditorSrc,
      /onClick=\{.*?handleFieldChange\('theme',\s*opt\.id === 'default'\s*\?\s*undefined\s*:\s*opt\.id\).*?\}/,
      'Theme button click must trigger handleFieldChange with undefined for default and theme id otherwise'
    );

    // Verify mapping function logic directly
    const transformThemeId = (id) => (id === 'default' ? undefined : id);
    assert.equal(transformThemeId('default'), undefined);
    assert.equal(transformThemeId('clean-executive'), 'clean-executive');
    assert.equal(transformThemeId('bold-commerce'), 'bold-commerce');
    assert.equal(transformThemeId('warm-editorial'), 'warm-editorial');
    assert.equal(transformThemeId('creator-minimal'), 'creator-minimal');
    assert.equal(transformThemeId('midnight-modern'), 'midnight-modern');
  });

  it('verifies PAGE_EDITOR_SECTIONS contains strictly 5 sections and Theme Selector is placed before page words section', () => {
    assert.equal(PAGE_EDITOR_SECTIONS.length, 5, 'PAGE_EDITOR_SECTIONS must maintain strictly 5 sections');
    assert.deepEqual(
      PAGE_EDITOR_SECTIONS.map(s => s.id),
      ['commerce', 'ab-test', 'extras', 'privacy', 'hosting']
    );

    const editorSectionMatches = [...pageEditorSrc.matchAll(/<EditorSection\b/g)];
    assert.equal(editorSectionMatches.length, 5, 'PageEditor.tsx must render exactly 5 <EditorSection> elements');

    const wordsCommentPos = pageEditorSrc.indexOf('{/* PAGE WORDS: always open, first */}');
    const themeCardPos = pageEditorSrc.indexOf('{/* PAGE THEME SELECTOR CARD:');
    const pageWordsSectionPos = pageEditorSrc.indexOf('<section aria-labelledby={pageWordsHeadingId}');
    const firstEditorSectionPos = pageEditorSrc.indexOf('<EditorSection');

    assert.ok(wordsCommentPos > 0, 'PAGE WORDS comment marker found');
    assert.ok(themeCardPos > 0, 'PAGE THEME SELECTOR CARD marker found');
    assert.ok(pageWordsSectionPos > 0, 'pageWordsSection found');
    assert.ok(firstEditorSectionPos > 0, 'firstEditorSection found');

    assert.ok(
      wordsCommentPos < themeCardPos,
      'PAGE WORDS comment must precede Theme Selector card'
    );
    assert.ok(
      themeCardPos < pageWordsSectionPos,
      'Theme Selector card must sit directly before <section aria-labelledby={pageWordsHeadingId}>'
    );
    assert.ok(
      pageWordsSectionPos < firstEditorSectionPos,
      'pageWordsSection must sit before the first <EditorSection>'
    );
  });
});

describe('M2 Challenger Snapshot Regression Adversarial Tests', () => {
  it('all 11 legacy fixtures match golden files byte-for-byte with no theme specified', () => {
    for (const [name, render] of FIXTURE_FACTORIES) {
      const html = render();
      const goldenFile = path.join(fixturesDir, `${name}.html`);
      assert.ok(fs.existsSync(goldenFile), `Golden file exists: ${goldenFile}`);
      const golden = fs.readFileSync(goldenFile, 'utf8');

      if (html !== golden) {
        let diffIdx = 0;
        while (diffIdx < html.length && html[diffIdx] === golden[diffIdx]) diffIdx++;
        assert.fail(`Fixture ${name} drifted at byte ${diffIdx}: received ${JSON.stringify(html.slice(diffIdx, diffIdx + 60))} vs golden ${JSON.stringify(golden.slice(diffIdx, diffIdx + 60))}`);
      }
      assert.equal(html, golden, `Fixture ${name} must match golden byte-for-byte`);
    }
  });

  it('all 11 legacy fixtures match golden files byte-for-byte when theme is undefined', () => {
    for (const [name, render] of FIXTURE_FACTORIES) {
      const html = render(undefined);
      const golden = fs.readFileSync(path.join(fixturesDir, `${name}.html`), 'utf8');
      assert.equal(html, golden, `Fixture ${name} with theme=undefined must match golden byte-for-byte`);
    }
  });

  it('all 11 legacy fixtures match golden files byte-for-byte when theme is null', () => {
    for (const [name, render] of FIXTURE_FACTORIES) {
      const html = render(null);
      const golden = fs.readFileSync(path.join(fixturesDir, `${name}.html`), 'utf8');
      assert.equal(html, golden, `Fixture ${name} with theme=null must match golden byte-for-byte`);
    }
  });

  it('all 11 legacy fixtures match golden files byte-for-byte when theme is "default"', () => {
    for (const [name, render] of FIXTURE_FACTORIES) {
      const html = render('default');
      const golden = fs.readFileSync(path.join(fixturesDir, `${name}.html`), 'utf8');
      assert.equal(html, golden, `Fixture ${name} with theme="default" must match golden byte-for-byte`);
    }
  });

  it('all 11 legacy fixtures match golden files byte-for-byte when theme is empty string ""', () => {
    for (const [name, render] of FIXTURE_FACTORIES) {
      const html = render('');
      const golden = fs.readFileSync(path.join(fixturesDir, `${name}.html`), 'utf8');
      assert.equal(html, golden, `Fixture ${name} with theme="" must match golden byte-for-byte`);
    }
  });

  it('renders byte-for-byte identical output when theme is on page object instead of data', () => {
    const landingGolden = fs.readFileSync(path.join(fixturesDir, 'landing-minimal-nostore.html'), 'utf8');
    for (const themeVal of [undefined, null, 'default', '']) {
      const html = renderPublicFunnelHtml(
        { slug: 'min', theme: themeVal, data: { headline: 'Hello', buttonText: 'Buy' }, shopifyConfig: {} },
        makeReq(),
        null
      );
      assert.equal(html, landingGolden, `Landing with page.theme=${themeVal} must match golden byte-for-byte`);
    }

    const tyGolden = fs.readFileSync(path.join(fixturesDir, 'thank-you.html'), 'utf8');
    for (const themeVal of [undefined, null, 'default', '']) {
      const html = renderPublicThankYouHtml(
        { slug: 'ty', theme: themeVal, data: { headline: 'Thank you', subhead: 'Your order is on its way.' }, shopifyConfig: shopConfig },
        makeReq(),
        null
      );
      assert.equal(html, tyGolden, `Thank you with page.theme=${themeVal} must match golden byte-for-byte`);
    }

    const upGolden = fs.readFileSync(path.join(fixturesDir, 'upsell.html'), 'utf8');
    for (const themeVal of [undefined, null, 'default', '']) {
      const html = renderPublicUpsellHtml(
        { slug: 'up', theme: themeVal, data: { headline: 'One more thing', subhead: 'Add the refill.', buttonText: 'Add it', shopifyVariantId: VARIANT_ID, shopifyProductPrice: '20.00' }, shopifyConfig: shopConfig },
        makeReq(),
        null,
        false
      );
      assert.equal(html, upGolden, `Upsell with page.theme=${themeVal} must match golden byte-for-byte`);
    }
  });

  it('adversarial injection stress: malicious and unknown themes safely evaluate to zero bytes', () => {
    const maliciousThemeStrings = [
      '<script>alert("xss")</script>',
      '"><script>document.location="http://evil.com"</script>',
      'clean-executive" onload="evil()',
      'constructor',
      '__proto__',
      'prototype',
      '../../../../etc/passwd',
      'DROP TABLE funnels;',
      'undefined',
      'null',
      'false',
      '0',
      '   clean-executive   ',
      'CLEAN-EXECUTIVE'
    ];

    const landingGolden = fs.readFileSync(path.join(fixturesDir, 'landing-minimal-nostore.html'), 'utf8');

    for (const attackString of maliciousThemeStrings) {
      assert.equal(
        renderThemeHeadAssets(attackString, 'landing'),
        '',
        `Malicious theme string "${attackString}" must produce empty theme head assets`
      );

      const html = renderPublicFunnelHtml(
        { slug: 'min', data: { headline: 'Hello', buttonText: 'Buy', theme: attackString }, shopifyConfig: {} },
        makeReq(),
        null
      );
      assert.equal(
        html,
        landingGolden,
        `Malicious theme string "${attackString}" must not alter golden landing output by even 1 byte`
      );
    }
  });

  it('zero-drift byte isolation: active theme HTML equals golden HTML minus injected theme head assets', () => {
    const landingGolden = fs.readFileSync(path.join(fixturesDir, 'landing-minimal-nostore.html'), 'utf8');
    const tyGolden = fs.readFileSync(path.join(fixturesDir, 'thank-you.html'), 'utf8');
    const upGolden = fs.readFileSync(path.join(fixturesDir, 'upsell.html'), 'utf8');

    for (const themeId of PAGE_THEME_IDS) {
      // 1. Landing
      const landingHtml = renderPublicFunnelHtml(
        { slug: 'min', data: { headline: 'Hello', buttonText: 'Buy', theme: themeId }, shopifyConfig: {} },
        makeReq(),
        null
      );
      const landingAssets = renderThemeHeadAssets(themeId, 'landing');
      assert.ok(landingAssets.length > 50, `Theme assets for ${themeId} landing must be non-empty`);
      assert.ok(landingHtml.includes(landingAssets), `Landing HTML must cleanly contain theme assets for ${themeId}`);
      assert.equal(
        landingHtml.replace(landingAssets, ''),
        landingGolden,
        `Stripping theme assets from active ${themeId} landing must produce 100% byte-identical legacy golden`
      );

      // 2. Thank You
      const tyHtml = renderPublicThankYouHtml(
        { slug: 'ty', data: { headline: 'Thank you', subhead: 'Your order is on its way.', theme: themeId }, shopifyConfig: shopConfig },
        makeReq(),
        null
      );
      const tyAssets = renderThemeHeadAssets(themeId, 'thank-you');
      assert.ok(tyHtml.includes(tyAssets), `Thank you HTML must contain theme assets for ${themeId}`);
      assert.equal(
        tyHtml.replace(tyAssets, ''),
        tyGolden,
        `Stripping theme assets from active ${themeId} thank you must produce 100% byte-identical legacy golden`
      );

      // 3. Upsell
      const upHtml = renderPublicUpsellHtml(
        { slug: 'up', data: { headline: 'One more thing', subhead: 'Add the refill.', buttonText: 'Add it', shopifyVariantId: VARIANT_ID, shopifyProductPrice: '20.00', theme: themeId }, shopifyConfig: shopConfig },
        makeReq(),
        null,
        false
      );
      const upAssets = renderThemeHeadAssets(themeId, 'upsell');
      assert.ok(upHtml.includes(upAssets), `Upsell HTML must contain theme assets for ${themeId}`);
      assert.equal(
        upHtml.replace(upAssets, ''),
        upGolden,
        `Stripping theme assets from active ${themeId} upsell must produce 100% byte-identical legacy golden`
      );
    }
  });
});

describe('M2 Challenger Dash Invariants & Repo Standards', () => {
  it('tests/m2-challenger-ui.test.mjs contains 0 em dashes and 0 spaced en dashes', () => {
    const selfPath = fileURLToPath(import.meta.url);
    const selfSrc = fs.readFileSync(selfPath, 'utf8');
    assert.equal(selfSrc.includes('\u2014'), false, 'Test suite must contain 0 em dashes');
    assert.equal(/\s\u2013\s/.test(selfSrc), false, 'Test suite must contain 0 spaced en dashes');
  });

  it('PageEditor.tsx contains 0 em dashes and 0 spaced en dashes', () => {
    assert.equal(pageEditorSrc.includes('\u2014'), false, 'PageEditor.tsx must contain 0 em dashes');
    assert.equal(/\s\u2013\s/.test(pageEditorSrc), false, 'PageEditor.tsx must contain 0 spaced en dashes');
  });
});
