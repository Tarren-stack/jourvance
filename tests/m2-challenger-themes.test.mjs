import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PAGE_THEME_IDS,
  PAGE_THEMES,
  getPageTheme,
  getThemeCssVariables,
  isPageThemeId,
  renderThemeStyleBlock,
  renderThemeHeadAssets
} from '../src/lib/pageThemes.ts';

import {
  composite,
  contrastRatio,
  parseCssColor
} from '../src/lib/a11yRules.ts';

import {
  renderPublicFunnelHtml,
  renderPublicThankYouHtml,
  renderPublicUpsellHtml
} from '../server/routes/publicRoutes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// Helper: parse hex color string into RGBA object
const hexToRgba = hex => {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  if (clean.length === 6) {
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
      a: 1
    };
  }
  if (clean.length === 8) {
    return {
      r: (num >> 24) & 255,
      g: (num >> 16) & 255,
      b: (num >> 8) & 255,
      a: ((num & 255) / 255)
    };
  }
  throw new Error(`Unsupported hex length: ${hex}`);
};

// Helper: parse CSS color (hex, rgba, rgb) into RGBA object
const parseColor = c => {
  if (typeof c === 'string' && c.startsWith('#')) {
    return hexToRgba(c);
  }
  const parsed = parseCssColor(c);
  if (!parsed) {
    throw new Error(`Could not parse color value: ${c}`);
  }
  return parsed;
};

const req = (query = {}, headers = {}) => ({ query, headers, params: {} });
const shop = { storeDomain: 'store.myshopify.com', currency: 'USD' };

// ============================================================================
// PART 1: ASSET GENERATION EDGE CASES (NON-STRINGS, SYMBOLS, OBJECTS, NUMBERS)
// ============================================================================

test('Challenger 1.1: Falsy, default, and unknown string themes return strictly empty string', () => {
  const invalidStrings = [
    null,
    undefined,
    '',
    'default',
    'nonexistent-theme',
    '   ',
    '\t\n',
    'CLEAN-EXECUTIVE', // Case-sensitive: IDs are lowercase
    'Bold-Commerce',
    'midnight',
    'clean_executive',
    '../theme',
    '<script>alert(1)</script>'
  ];

  for (const input of invalidStrings) {
    assert.equal(
      renderThemeHeadAssets(input),
      '',
      `renderThemeHeadAssets(${JSON.stringify(input)}) must return empty string`
    );
    assert.equal(
      renderThemeStyleBlock(input),
      '',
      `renderThemeStyleBlock(${JSON.stringify(input)}) must return empty string`
    );
    assert.deepEqual(
      getThemeCssVariables(input),
      {},
      `getThemeCssVariables(${JSON.stringify(input)}) must return empty object`
    );
    assert.equal(
      getPageTheme(input),
      null,
      `getPageTheme(${JSON.stringify(input)}) must return null`
    );
  }
});

test('Challenger 1.2: Numeric, boolean, symbol, object, and function values do not crash and return empty string', () => {
  const exoticInputs = [
    0,
    1,
    -1,
    12345,
    3.14159,
    NaN,
    Infinity,
    -Infinity,
    true,
    false,
    Symbol('clean-executive'),
    Symbol.for('theme'),
    {},
    { id: 'clean-executive' },
    ['clean-executive'],
    [null],
    () => 'clean-executive',
    new Date(),
    /clean-executive/
  ];

  for (const input of exoticInputs) {
    assert.doesNotThrow(() => {
      const result = renderThemeHeadAssets(input);
      assert.equal(
        result,
        '',
        `renderThemeHeadAssets must return strictly empty string for exotic input`
      );
    });

    assert.doesNotThrow(() => {
      const result = renderThemeStyleBlock(input);
      assert.equal(
        result,
        '',
        `renderThemeStyleBlock must return strictly empty string for exotic input`
      );
    });

    assert.doesNotThrow(() => {
      const result = getThemeCssVariables(input);
      assert.deepEqual(
        result,
        {},
        `getThemeCssVariables must return strictly empty object for exotic input`
      );
    });

    assert.doesNotThrow(() => {
      const result = getPageTheme(input);
      assert.equal(
        result,
        null,
        `getPageTheme must return null for exotic input`
      );
    });
  }
});

// ============================================================================
// PART 2: 5 VALID THEMES MARKUP, STYLES, AND CSS VARIABLES VERIFICATION
// ============================================================================

test('Challenger 2.1: Exactly 5 universal themes are defined with valid properties', () => {
  assert.equal(PAGE_THEME_IDS.length, 5);
  assert.deepEqual([...PAGE_THEME_IDS], [
    'clean-executive',
    'bold-commerce',
    'warm-editorial',
    'creator-minimal',
    'midnight-modern'
  ]);

  for (const id of PAGE_THEME_IDS) {
    assert.equal(isPageThemeId(id), true);
    const theme = getPageTheme(id);
    assert.ok(theme !== null, `Theme ${id} must resolve`);
    assert.equal(theme.id, id);
    assert.ok(theme.name && theme.name.length > 0);
    assert.ok(theme.industry && theme.industry.length > 0);
    assert.ok(theme.description && theme.description.length > 0);
    assert.ok(theme.fontHeading && theme.fontHeading.length > 0);
    assert.ok(theme.fontBody && theme.fontBody.length > 0);
    assert.ok(theme.googleFontsUrl.startsWith('https://fonts.googleapis.com/css2?family='));
    assert.ok(theme.radiusBtn.endsWith('px'));
    assert.ok(theme.radiusCard.endsWith('px'));
    assert.ok(theme.btnGradient.startsWith('linear-gradient('));
    assert.ok(theme.topbarGradient.startsWith('linear-gradient('));
    assert.ok(theme.btnText.startsWith('#'));
  }
});

test('Challenger 2.2: All 5 themes define the required 12 CSS variables plus core font and button tokens', () => {
  const REQUIRED_12_CSS_VARS = [
    '--bg',
    '--card-bg',
    '--border',
    '--text',
    '--text-muted',
    '--primary',
    '--primary-glow',
    '--secondary',
    '--btn-gradient',
    '--topbar-gradient',
    '--radius-btn',
    '--radius-card'
  ];

  const ADDITIONAL_CORE_VARS = [
    '--font-heading',
    '--font-body',
    '--btn-text'
  ];

  for (const id of PAGE_THEME_IDS) {
    const vars = getThemeCssVariables(id);

    // Verify all 12 required variables
    for (const v of REQUIRED_12_CSS_VARS) {
      assert.ok(
        v in vars,
        `Theme ${id} must define required CSS variable ${v}`
      );
      assert.ok(
        typeof vars[v] === 'string' && vars[v].trim().length > 0,
        `Theme ${id} variable ${v} must not be empty`
      );
    }

    // Verify additional core tokens
    for (const v of ADDITIONAL_CORE_VARS) {
      assert.ok(
        v in vars,
        `Theme ${id} must define core token ${v}`
      );
      assert.ok(
        typeof vars[v] === 'string' && vars[v].trim().length > 0,
        `Theme ${id} token ${v} must not be empty`
      );
    }
  }
});

test('Challenger 2.3: renderThemeHeadAssets generates valid stylesheet links and theme style block', () => {
  for (const id of PAGE_THEME_IDS) {
    const markup = renderThemeHeadAssets(id, 'all');

    // 1. Must include Google Fonts stylesheet link
    assert.ok(
      markup.includes('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family='),
      `Theme ${id} must include Google Fonts stylesheet link`
    );

    // 2. Must include theme style block with jv-page-theme or jourvance-page-theme id
    const styleTagMatch = /<style id="(?:jourvance|jv)-page-theme">/.test(markup);
    assert.ok(
      styleTagMatch,
      `Theme ${id} must include theme style block with valid id attribute`
    );

    // 3. Must include :root { ... } definition
    assert.ok(
      markup.includes(':root {'),
      `Theme ${id} must declare :root block`
    );

    // 4. Must close style tag cleanly
    assert.ok(
      markup.includes('</style>'),
      `Theme ${id} must close style tag`
    );

    // 5. Scoped variants render required page target selectors
    const landingMarkup = renderThemeHeadAssets(id, 'landing');
    assert.ok(landingMarkup.includes('.cta-btn'), `Theme ${id} landing must style .cta-btn`);
    assert.ok(landingMarkup.includes('.top-bar'), `Theme ${id} landing must style .top-bar`);
    assert.ok(landingMarkup.includes('.offer-card'), `Theme ${id} landing must style .offer-card`);

    const tyMarkup = renderThemeHeadAssets(id, 'thank-you');
    assert.ok(tyMarkup.includes('.check-icon'), `Theme ${id} thank-you must style .check-icon`);
    assert.ok(tyMarkup.includes('.vip-pill'), `Theme ${id} thank-you must style .vip-pill`);

    const upsellMarkup = renderThemeHeadAssets(id, 'upsell');
    assert.ok(upsellMarkup.includes('.btn-accept'), `Theme ${id} upsell must style .btn-accept`);
    assert.ok(upsellMarkup.includes('.badge-pill'), `Theme ${id} upsell must style .badge-pill`);
  }
});

// ============================================================================
// PART 3: WCAG AA CONTRAST STRESS TESTING ACROSS ALL THEMES
// ============================================================================

test('Challenger 3.1: All 5 themes meet WCAG AA contrast standards across body, muted, accents, and buttons', () => {
  for (const id of PAGE_THEME_IDS) {
    const theme = PAGE_THEMES[id];
    const vars = theme.cssVariables;

    const bg = parseColor(vars['--bg']);
    const cardBgRaw = parseColor(vars['--card-bg']);
    const cardComp = composite(cardBgRaw, bg);
    const text = parseColor(vars['--text']);
    const textMuted = parseColor(vars['--text-muted']);
    const primary = parseColor(vars['--primary']);
    const secondary = parseColor(vars['--secondary']);
    const btnText = parseColor(theme.btnText);

    // 1. Body text on page background (>= 4.5:1)
    const crTextBg = contrastRatio(text, bg);
    assert.ok(
      crTextBg >= 4.5,
      `Theme ${id}: Body text on background contrast ratio ${crTextBg.toFixed(2)} must be >= 4.5:1`
    );

    // 2. Body text on composited card background (>= 4.5:1)
    const crTextCard = contrastRatio(text, cardComp);
    assert.ok(
      crTextCard >= 4.5,
      `Theme ${id}: Body text on card contrast ratio ${crTextCard.toFixed(2)} must be >= 4.5:1`
    );

    // 3. Muted text on page background (>= 4.5:1)
    const crMutedBg = contrastRatio(textMuted, bg);
    assert.ok(
      crMutedBg >= 4.5,
      `Theme ${id}: Muted text on background contrast ratio ${crMutedBg.toFixed(2)} must be >= 4.5:1`
    );

    // 4. Muted text on composited card background (>= 4.5:1)
    const crMutedCard = contrastRatio(textMuted, cardComp);
    assert.ok(
      crMutedCard >= 4.5,
      `Theme ${id}: Muted text on card contrast ratio ${crMutedCard.toFixed(2)} must be >= 4.5:1`
    );

    // 5. Primary accent on page background (>= 3.0:1 for large accent / UI elements)
    const crPrimaryBg = contrastRatio(primary, bg);
    assert.ok(
      crPrimaryBg >= 3.0,
      `Theme ${id}: Primary on background contrast ratio ${crPrimaryBg.toFixed(2)} must be >= 3.0:1`
    );

    // 6. Secondary accent on page background (>= 3.0:1 for large accent / UI elements)
    const crSecondaryBg = contrastRatio(secondary, bg);
    assert.ok(
      crSecondaryBg >= 3.0,
      `Theme ${id}: Secondary on background contrast ratio ${crSecondaryBg.toFixed(2)} must be >= 3.0:1`
    );

    // 7. Button text on gradient stops (>= 4.5:1)
    const gradStops = theme.btnGradient.match(/#[0-9a-fA-F]{6}/g) || [];
    assert.ok(
      gradStops.length >= 2,
      `Theme ${id}: Button gradient must contain at least 2 hex stops`
    );

    for (const stopHex of gradStops) {
      const stopColor = parseColor(stopHex);
      const crBtn = contrastRatio(btnText, stopColor);
      assert.ok(
        crBtn >= 4.5,
        `Theme ${id}: Button text on gradient stop ${stopHex} ratio ${crBtn.toFixed(2)} must be >= 4.5:1`
      );
    }
  }
});

// ============================================================================
// PART 4: COMBINATION WITH SSR ROUTES AND ZERO-REGRESSION CHARACTER MATCHING
// ============================================================================

test('Challenger 4.1: Unset, null, and default themes in SSR routes produce exact byte-for-byte character match', () => {
  // Test landing page renderer
  const baseLanding = {
    slug: 'stress-landing',
    data: {
      headline: 'Empirical Verification',
      subhead: 'Stress testing SSR routes',
      buttonText: 'Verify Now'
    },
    shopifyConfig: shop
  };

  const rawHtml = renderPublicFunnelHtml(baseLanding, req(), null);

  const nullDataHtml = renderPublicFunnelHtml({
    ...baseLanding,
    data: { ...baseLanding.data, theme: null }
  }, req(), null);
  assert.equal(nullDataHtml, rawHtml, 'null theme in data must produce exact character match');

  const undefinedDataHtml = renderPublicFunnelHtml({
    ...baseLanding,
    data: { ...baseLanding.data, theme: undefined }
  }, req(), null);
  assert.equal(undefinedDataHtml, rawHtml, 'undefined theme in data must produce exact character match');

  const emptyDataHtml = renderPublicFunnelHtml({
    ...baseLanding,
    data: { ...baseLanding.data, theme: '' }
  }, req(), null);
  assert.equal(emptyDataHtml, rawHtml, 'empty string theme in data must produce exact character match');

  const defaultDataHtml = renderPublicFunnelHtml({
    ...baseLanding,
    data: { ...baseLanding.data, theme: 'default' }
  }, req(), null);
  assert.equal(defaultDataHtml, rawHtml, "'default' theme in data must produce exact character match");

  const nullPageHtml = renderPublicFunnelHtml({
    ...baseLanding,
    theme: null
  }, req(), null);
  assert.equal(nullPageHtml, rawHtml, 'null theme on page must produce exact character match');

  // Test thank-you page renderer
  const baseThankYou = {
    slug: 'stress-thankyou',
    data: {
      headline: 'Thank You',
      subhead: 'Order completed'
    },
    shopifyConfig: shop
  };

  const rawTyHtml = renderPublicThankYouHtml(baseThankYou, req(), null);
  const nullTyHtml = renderPublicThankYouHtml({
    ...baseThankYou,
    data: { ...baseThankYou.data, theme: null }
  }, req(), null);
  assert.equal(nullTyHtml, rawTyHtml, 'null theme in thank you data must produce exact character match');

  const defaultTyHtml = renderPublicThankYouHtml({
    ...baseThankYou,
    data: { ...baseThankYou.data, theme: 'default' }
  }, req(), null);
  assert.equal(defaultTyHtml, rawTyHtml, "'default' theme in thank you data must produce exact character match");

  // Test upsell page renderer
  const baseUpsell = {
    slug: 'stress-upsell',
    data: {
      headline: 'Exclusive Offer',
      subhead: 'Upgrade your experience',
      buttonText: 'Add to Order'
    },
    shopifyConfig: shop
  };

  const rawUpHtml = renderPublicUpsellHtml(baseUpsell, req(), null, false);
  const nullUpHtml = renderPublicUpsellHtml({
    ...baseUpsell,
    data: { ...baseUpsell.data, theme: null }
  }, req(), null, false);
  assert.equal(nullUpHtml, rawUpHtml, 'null theme in upsell data must produce exact character match');

  const defaultUpHtml = renderPublicUpsellHtml({
    ...baseUpsell,
    data: { ...baseUpsell.data, theme: 'default' }
  }, req(), null, false);
  assert.equal(defaultUpHtml, rawUpHtml, "'default' theme in upsell data must produce exact character match");
});

test('Challenger 4.2: SSR rendered pages with themes include valid preconnect links, font stylesheet, and style tag', () => {
  const landing = {
    slug: 'themed-landing',
    data: {
      headline: 'Themed Enterprise Page',
      subhead: 'Built for high performance',
      buttonText: 'Start Enterprise Trial'
    },
    shopifyConfig: shop
  };

  for (const id of PAGE_THEME_IDS) {
    const pageHtml = renderPublicFunnelHtml({
      ...landing,
      data: { ...landing.data, theme: id }
    }, req(), null);

    // 1. Must include Google Fonts preconnect links
    assert.ok(
      pageHtml.includes('<link rel="preconnect" href="https://fonts.googleapis.com">'),
      `Page with theme ${id} must include fonts.googleapis.com preconnect`
    );
    assert.ok(
      pageHtml.includes('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'),
      `Page with theme ${id} must include fonts.gstatic.com crossorigin preconnect`
    );

    // 2. Must include theme Google Fonts stylesheet link
    const themeDef = getPageTheme(id);
    assert.ok(
      pageHtml.includes(themeDef.googleFontsUrl),
      `Page with theme ${id} must include theme Google Fonts URL`
    );

    // 3. Must include theme style block with jv-page-theme or jourvance-page-theme id
    assert.ok(
      /<style id="(?:jourvance|jv)-page-theme">/.test(pageHtml),
      `Page with theme ${id} must include theme style block`
    );

    // 4. Must declare :root variables
    assert.ok(
      pageHtml.includes(':root {'),
      `Page with theme ${id} must include :root variables block`
    );

    // 5. Must contain theme background color
    assert.ok(
      pageHtml.includes(themeDef.cssVariables['--bg']),
      `Page with theme ${id} must contain theme background color ${themeDef.cssVariables['--bg']}`
    );
  }
});

// ============================================================================
// PART 5: THEME UNIQUENESS AND HTML WELL-FORMEDNESS
// ============================================================================

test('Challenger 5.1: Each of the 5 themes produces unique, non-identical HTML', () => {
  const landing = {
    slug: 'unique-landing',
    data: {
      headline: 'Multi-Industry Verification',
      subhead: 'Testing page variance',
      buttonText: 'Explore Now'
    },
    shopifyConfig: shop
  };

  const renderedPages = new Map();

  for (const id of PAGE_THEME_IDS) {
    const html = renderPublicFunnelHtml({
      ...landing,
      data: { ...landing.data, theme: id }
    }, req(), null);
    renderedPages.set(id, html);
  }

  // Compare every pair of themes to ensure pairwise uniqueness
  for (let i = 0; i < PAGE_THEME_IDS.length; i++) {
    for (let j = i + 1; j < PAGE_THEME_IDS.length; j++) {
      const idA = PAGE_THEME_IDS[i];
      const idB = PAGE_THEME_IDS[j];
      const htmlA = renderedPages.get(idA);
      const htmlB = renderedPages.get(idB);

      assert.notEqual(
        htmlA,
        htmlB,
        `Theme ${idA} and Theme ${idB} must produce different HTML output`
      );
    }
  }
});

test('Challenger 5.2: Themed HTML parses cleanly with balanced structural tags and valid CSS syntax', () => {
  const landing = {
    slug: 'parsed-landing',
    data: {
      headline: 'Clean Markup Verification',
      subhead: 'Stress testing parser compatibility',
      buttonText: 'Run Check'
    },
    shopifyConfig: shop
  };

  for (const id of PAGE_THEME_IDS) {
    const html = renderPublicFunnelHtml({
      ...landing,
      data: { ...landing.data, theme: id }
    }, req(), null);

    // Verify balanced structural tags
    const openHeadCount = (html.match(/<head\b[^>]*>/gi) || []).length;
    const closeHeadCount = (html.match(/<\/head>/gi) || []).length;
    assert.equal(openHeadCount, 1, `Theme ${id}: Exactly 1 opening <head> tag expected`);
    assert.equal(closeHeadCount, 1, `Theme ${id}: Exactly 1 closing </head> tag expected`);

    const openBodyCount = (html.match(/<body\b[^>]*>/gi) || []).length;
    const closeBodyCount = (html.match(/<\/body>/gi) || []).length;
    assert.equal(openBodyCount, 1, `Theme ${id}: Exactly 1 opening <body> tag expected`);
    assert.equal(closeBodyCount, 1, `Theme ${id}: Exactly 1 closing </body> tag expected`);

    // Verify theme style tag opens and closes exactly once
    const openThemeStyleCount = (html.match(/<style id="(?:jourvance|jv)-page-theme">/g) || []).length;
    assert.equal(openThemeStyleCount, 1, `Theme ${id}: Exactly 1 theme style opening tag expected`);

    // Extract content between theme style tag and verify CSS property syntax
    const styleBlockMatch = html.match(/<style id="(?:jourvance|jv)-page-theme">([\s\S]*?)<\/style>/);
    assert.ok(styleBlockMatch !== null, `Theme ${id}: Theme style block must be extractable`);

    const cssContent = styleBlockMatch[1];
    assert.ok(cssContent.includes(':root {'), `Theme ${id}: CSS must contain :root`);

    // Check that CSS variable declarations follow valid key: value; syntax
    const varLines = cssContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('--'));

    assert.ok(varLines.length >= 12, `Theme ${id}: Expected at least 12 CSS variable lines`);
    for (const varLine of varLines) {
      assert.ok(
        /^--[a-z0-9-]+:\s*[^;]+;$/.test(varLine),
        `Theme ${id}: Variable line "${varLine}" must match valid CSS syntax`
      );
    }
  }
});

// ============================================================================
// PART 6: ZERO EM DASHES AND ZERO SPACED EN DASHES INVARIANT
// ============================================================================

test('Challenger 6.1: Theme definitions and test suite maintain 0 em dashes and 0 spaced en dashes', () => {
  const filesToCheck = [
    path.join(here, '../src/lib/pageThemes.ts'),
    path.join(here, 'm2-challenger-themes.test.mjs')
  ];

  for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(
      content.includes('\u2014'),
      false,
      `File ${path.basename(filePath)} must contain 0 em dashes`
    );
    assert.equal(
      /\s\u2013\s/.test(content),
      false,
      `File ${path.basename(filePath)} must contain 0 spaced en dashes`
    );
  }
});
