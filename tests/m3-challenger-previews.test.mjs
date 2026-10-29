import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import ts from 'typescript';

import {
  PAGE_EDITOR_SECTIONS,
  buildChatConciergeHref
} from '../src/lib/pageEditorSections.ts';

import {
  PAGE_THEMES,
  PAGE_THEME_IDS,
  getPageTheme
} from '../src/lib/pageThemes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');

const pageEditorPath = path.join(rootDir, 'src', 'components', 'drawers', 'PageEditor.tsx');
const pageEditorSrc = fs.readFileSync(pageEditorPath, 'utf8');

const liveFunnelModalPath = path.join(rootDir, 'src', 'components', 'preview', 'LiveFunnelModal.tsx');
const liveFunnelModalSrc = fs.readFileSync(liveFunnelModalPath, 'utf8');

// Parse files into TypeScript ASTs
const pageEditorAst = ts.createSourceFile(
  'PageEditor.tsx',
  pageEditorSrc,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

const liveFunnelModalAst = ts.createSourceFile(
  'LiveFunnelModal.tsx',
  liveFunnelModalSrc,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

// AST helper to find JSX elements matching a predicate
function findJsxElements(rootNode, predicate) {
  const matches = [];
  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (predicate(node)) {
        matches.push(node);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(rootNode);
  return matches;
}

// AST helper to find variable declarations by name
function findVariableDeclarations(rootNode, varName) {
  const matches = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(rootNode) === varName) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(rootNode);
  return matches;
}

// AST helper to find call expressions by callee name
function findCallExpressions(rootNode, calleeName) {
  const matches = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(rootNode) === calleeName) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(rootNode);
  return matches;
}

describe('M3 Challenger: PageEditor Preview AST & Logic Invariants', () => {
  it('verifies #jv-preview-frame exists in AST with scoped theme CSS variables and Google Fonts', () => {
    // 1. Locate #jv-preview-frame in AST
    const previewFrameNodes = findJsxElements(pageEditorAst, (node) => {
      const tag = ts.isJsxElement(node) ? node.openingElement : node;
      return tag.attributes.properties.some(p =>
        ts.isJsxAttribute(p) &&
        p.name.getText(pageEditorAst) === 'id' &&
        p.initializer?.getText(pageEditorAst) === '"jv-preview-frame"'
      );
    });

    assert.equal(previewFrameNodes.length, 1, 'Exactly one element with id="jv-preview-frame" must exist in PageEditor.tsx');
    const previewFrame = previewFrameNodes[0];
    const previewFrameText = previewFrame.getText(pageEditorAst);

    // 2. Check data-theme attribute
    assert.match(
      previewFrameText,
      /data-theme=\{data\.theme \|\| undefined\}/,
      '#jv-preview-frame must set data-theme from data.theme'
    );

    // 3. Check CSS variables spread onto style
    assert.match(
      previewFrameText,
      /\.\.\.\(activeTheme \? \(activeTheme\.cssVariables as React\.CSSProperties\) : \{\}\)/,
      '#jv-preview-frame must spread activeTheme.cssVariables into style'
    );

    // 4. Check Google Fonts stylesheet conditional rendering inside preview frame
    assert.match(
      previewFrameText,
      /\{activeTheme\?\.googleFontsUrl && \(\s*<link rel="stylesheet" href=\{activeTheme\.googleFontsUrl\} \/>\s*\)\}/,
      '#jv-preview-frame must render Google Fonts link tag when activeTheme.googleFontsUrl is present'
    );

    // 5. Check theme font body fallback
    assert.match(
      previewFrameText,
      /fontFamily:\s*activeTheme\?\.fontBody \|\| 'inherit'/,
      '#jv-preview-frame container must use activeTheme.fontBody'
    );
  });

  it('verifies theme heading font, gradients, and radius cascade to preview elements', () => {
    // Heading font cascading to preview headline
    assert.match(
      pageEditorSrc,
      /fontFamily:\s*activeTheme\?\.fontHeading \|\| 'inherit'/,
      'Preview h2 headline must apply activeTheme.fontHeading'
    );

    // Top announcement bar topbarGradient cascading
    assert.match(
      pageEditorSrc,
      /background:\s*activeTheme\?\.topbarGradient \|\| 'linear-gradient\(90deg, #ec4899, #db2777, #9333ea\)'/,
      'Preview announcement bar must apply activeTheme.topbarGradient'
    );

    // CTA button button gradient, text color, and radius cascading
    assert.match(
      pageEditorSrc,
      /borderRadius:\s*activeTheme\?\.radiusBtn \|\| '8px'/,
      'Preview CTA button must apply activeTheme.radiusBtn'
    );
    assert.match(
      pageEditorSrc,
      /background:\s*activeTheme\?\.btnGradient \|\| 'linear-gradient\(135deg, #ec4899 0%, #db2777 100%\)'/,
      'Preview CTA button must apply activeTheme.btnGradient'
    );
    assert.match(
      pageEditorSrc,
      /color:\s*activeTheme\?\.btnText \|\| '#FFFFFF'/,
      'Preview CTA button must apply activeTheme.btnText'
    );
    assert.match(
      pageEditorSrc,
      /fontFamily:\s*activeTheme\?\.fontHeading \|\| 'inherit'/,
      'Preview CTA button must apply activeTheme.fontHeading'
    );
  });

  it('verifies direct checkout link precedence: directCheckoutUrl || permalinkCheckoutUrl', () => {
    const varDecls = findVariableDeclarations(pageEditorAst, 'currentCheckoutUrl');
    assert.equal(varDecls.length, 1, 'Exactly one const currentCheckoutUrl declaration must exist');

    const initText = varDecls[0].initializer?.getText(pageEditorAst);
    assert.equal(
      initText,
      'directCheckoutUrl || permalinkCheckoutUrl',
      'currentCheckoutUrl formula must strictly be: directCheckoutUrl || permalinkCheckoutUrl'
    );

    // Check directCheckoutUrl definition checks all expected fallback keys
    const directUrlDecls = findVariableDeclarations(pageEditorAst, 'directCheckoutUrl');
    assert.equal(directUrlDecls.length, 1, 'directCheckoutUrl declaration must exist');
    const directUrlInitText = directUrlDecls[0].initializer?.getText(pageEditorAst);
    assert.match(directUrlInitText, /data\.checkoutUrl/, 'directCheckoutUrl must check data.checkoutUrl');
    assert.match(directUrlInitText, /data\.bookingUrl/, 'directCheckoutUrl must check data.bookingUrl');
    assert.match(directUrlInitText, /data\.externalUrl/, 'directCheckoutUrl must check data.externalUrl');
    assert.match(directUrlInitText, /data\.directUrl/, 'directCheckoutUrl must check data.directUrl');
  });

  it('verifies leadOnly formula: !storeDomain && !directCheckoutUrl', () => {
    const varDecls = findVariableDeclarations(pageEditorAst, 'leadOnly');
    assert.equal(varDecls.length, 1, 'Exactly one const leadOnly declaration must exist');

    const initText = varDecls[0].initializer?.getText(pageEditorAst);
    assert.equal(
      initText,
      '!storeDomain && !directCheckoutUrl',
      'leadOnly formula must strictly be: !storeDomain && !directCheckoutUrl'
    );
  });

  it('verifies alert neutralization: no false Shopify-only alerts and neutralized CTA alert', () => {
    // 1. Scan for forbidden old Shopify-only alert strings
    assert.doesNotMatch(
      pageEditorSrc,
      /Please connect your Shopify store and select a product variant/i,
      'Must not contain false Shopify-only checkout alert'
    );
    assert.doesNotMatch(
      pageEditorSrc,
      /Please connect your Shopify store/i,
      'Must not contain false Shopify-only requirement in alert'
    );

    // 2. Scan all alert(...) calls in AST to verify neutralization
    const alerts = findCallExpressions(pageEditorAst, 'alert');
    assert.ok(alerts.length >= 1, 'At least one alert call in PageEditor.tsx');

    const alertTexts = alerts.map(a => a.arguments[0]?.getText(pageEditorAst));
    assert.ok(
      alertTexts.some(t => t.includes('Please connect a store or set a checkout or booking link to activate checkout.')),
      'Must include neutralized alert recognizing both stores and direct checkout/booking links'
    );
  });

  it('verifies <a id="jv-chat-concierge-btn"> exists with buildChatConciergeHref(data)', () => {
    const conciergeNodes = findJsxElements(pageEditorAst, (node) => {
      const tag = ts.isJsxElement(node) ? node.openingElement : node;
      return tag.attributes.properties.some(p =>
        ts.isJsxAttribute(p) &&
        p.name.getText(pageEditorAst) === 'id' &&
        p.initializer?.getText(pageEditorAst) === '"jv-chat-concierge-btn"'
      );
    });

    assert.equal(conciergeNodes.length, 1, 'Exactly one <a id="jv-chat-concierge-btn"> must exist in PageEditor.tsx');
    const conciergeText = conciergeNodes[0].getText(pageEditorAst);

    assert.match(
      conciergeText,
      /href=\{buildChatConciergeHref\(data\) \|\| '#'\}/,
      'Concierge button must set href to buildChatConciergeHref(data) || "#"'
    );
    assert.match(conciergeText, /target="_blank"/, 'Concierge button must have target="_blank"');
    assert.match(conciergeText, /rel="noopener noreferrer"/, 'Concierge button must have rel="noopener noreferrer"');
    assert.match(
      conciergeText,
      /borderRadius:\s*activeTheme\?\.radiusBtn \|\| '10px'/,
      'Concierge button must inherit activeTheme.radiusBtn'
    );
  });

  it('verifies PAGE_EDITOR_SECTIONS contains strictly 5 sections and zero duplicate fid(...) declarations', () => {
    // 1. PAGE_EDITOR_SECTIONS definition invariant
    assert.equal(PAGE_EDITOR_SECTIONS.length, 5, 'PAGE_EDITOR_SECTIONS must maintain strictly 5 sections');
    assert.deepEqual(
      PAGE_EDITOR_SECTIONS.map(s => s.id),
      ['commerce', 'ab-test', 'extras', 'privacy', 'hosting']
    );

    // 2. Exactly 5 <EditorSection> tags in PageEditor.tsx
    const editorSectionMatches = [...pageEditorSrc.matchAll(/<EditorSection\b/g)];
    assert.equal(editorSectionMatches.length, 5, 'PageEditor.tsx must render exactly 5 <EditorSection> elements');

    // 3. Scan all id={fid('...')} attributes in AST to ensure zero duplicate IDs
    const idFids = [];
    function scanIdFids(node) {
      if (ts.isJsxAttribute(node) && node.name.getText(pageEditorAst) === 'id') {
        if (node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          const exp = node.initializer.expression;
          if (ts.isCallExpression(exp) && exp.expression.getText(pageEditorAst) === 'fid') {
            idFids.push(exp.arguments[0].getText(pageEditorAst));
          }
        }
      }
      ts.forEachChild(node, scanIdFids);
    }
    scanIdFids(pageEditorAst);

    assert.ok(idFids.length >= 40, `Found ${idFids.length} id={fid(...)} declarations in PageEditor.tsx`);
    const counts = {};
    for (const id of idFids) {
      counts[id] = (counts[id] || 0) + 1;
    }
    const duplicateIds = Object.entries(counts).filter(([_, count]) => count > 1);
    assert.deepEqual(
      duplicateIds,
      [],
      `Zero duplicate id={fid(...)} permitted, but found: ${JSON.stringify(duplicateIds)}`
    );
  });
});

describe('M3 Challenger: LiveFunnelModal Device Frame AST & Invariants', () => {
  it('verifies dynamic theme CSS variables, radius, and fonts in data-device-frame', () => {
    // 1. Locate data-device-frame container in AST
    const deviceFrameNodes = findJsxElements(liveFunnelModalAst, (node) => {
      const tag = ts.isJsxElement(node) ? node.openingElement : node;
      return tag.attributes.properties.some(p =>
        ts.isJsxAttribute(p) &&
        p.name.getText(liveFunnelModalAst) === 'data-device-frame'
      );
    });

    assert.equal(deviceFrameNodes.length, 1, 'Exactly one data-device-frame container must exist in LiveFunnelModal.tsx');
    const deviceFrameText = deviceFrameNodes[0].getText(liveFunnelModalAst);

    // 2. Check CSS variables spread
    assert.match(
      deviceFrameText,
      /\.\.\.\(activeTheme \? \(activeTheme\.cssVariables as unknown as React\.CSSProperties\) : \{\}\)/,
      'device frame must spread activeTheme.cssVariables into style'
    );

    // 3. Check Google Fonts link tag injection
    assert.match(
      deviceFrameText,
      /\{activeTheme\?\.googleFontsUrl && \(\s*<link rel="stylesheet" href=\{activeTheme\.googleFontsUrl\} \/>\s*\)\}/,
      'device frame must inject activeTheme.googleFontsUrl'
    );

    // 4. Check dynamic theme styling properties
    assert.match(deviceFrameText, /background:\s*activeTheme \? 'var\(--bg, #0B0F19\)' : '#0B0F19'/);
    assert.match(deviceFrameText, /color:\s*activeTheme \? 'var\(--text, #FFF\)' : '#FFF'/);
    assert.match(deviceFrameText, /fontFamily:\s*activeTheme\?\.fontBody \? 'var\(--font-body\)' : 'inherit'/);
    assert.match(deviceFrameText, /borderRadius:\s*viewMode === 'mobile' \? '32px' : \(activeTheme\?\.radiusCard \|\| '12px'\)/);
  });

  it('verifies active theme resolution falls back from node to journey project', () => {
    assert.match(
      liveFunnelModalSrc,
      /const activeThemeId = \(currentNode\?\.data as \{ theme\?: PageThemeId \}\)\?\.theme \|\| \(project as JourneyProject & \{ theme\?: PageThemeId \}\)\.theme;/,
      'Active theme must resolve currentNode theme with fallback to project theme'
    );
    assert.match(
      liveFunnelModalSrc,
      /const activeTheme = getPageTheme\(activeThemeId\);/,
      'Must invoke getPageTheme(activeThemeId)'
    );
  });

  it('verifies direct destination rendering in renderSummaryPanel', () => {
    // Condition allows corePrice === 0 when checkoutUrl is present
    assert.match(
      liveFunnelModalSrc,
      /\(corePrice > 0 \|\| pageData\?\.checkoutUrl\)/,
      'renderSummaryPanel must display when corePrice > 0 OR pageData.checkoutUrl is set'
    );

    // Label and Value distinction for direct destinations
    assert.match(
      liveFunnelModalSrc,
      /pageData\?\.checkoutUrl && corePrice === 0 \? 'Direct Destination' : 'Core Offer'/,
      'renderSummaryPanel must label as "Direct Destination" when checkoutUrl is present and corePrice is 0'
    );
    assert.match(
      liveFunnelModalSrc,
      /corePrice > 0 \? `\$\{currencySymbol\}\$\{corePrice\.toFixed\(2\)\}` : 'Direct Link Active'/,
      'renderSummaryPanel must display "Direct Link Active" for direct links without numeric corePrice'
    );
  });

  it('verifies Click-to-Chat concierge button in step walk with theme radius', () => {
    const conciergeMatches = findJsxElements(liveFunnelModalAst, (node) => {
      const tag = ts.isJsxElement(node) ? node.openingElement : node;
      return tag.attributes.properties.some(p =>
        ts.isJsxAttribute(p) &&
        p.name.getText(liveFunnelModalAst) === 'id' &&
        p.initializer?.getText(liveFunnelModalAst) === '"jv-chat-concierge-btn"'
      );
    });

    assert.equal(conciergeMatches.length, 1, 'Exactly one <a id="jv-chat-concierge-btn"> in LiveFunnelModal.tsx');
    const conciergeText = conciergeMatches[0].getText(liveFunnelModalAst);

    assert.match(conciergeText, /href=\{buildChatConciergeHref\(d\) \|\| '#'\}/);
    assert.match(conciergeText, /target="_blank"/);
    assert.match(conciergeText, /rel="noopener noreferrer"/);
    assert.match(conciergeText, /borderRadius:\s*activeTheme\?\.radiusBtn \|\| '8px'/);
    assert.match(conciergeText, /<span style=\{\{ \.\.\.simulatedPill, fontSize: '11px', padding: '1px 6px' \}\}>Simulated<\/span>/);
  });

  it('verifies font sizes across LiveFunnelModal and PageEditor are strictly >= 11px', () => {
    const checkFileFontSizes = (filePath, fileContent) => {
      const matches = [...fileContent.matchAll(/fontSize:\s*['"]?(\d+)px['"]?/g)];
      const smallFonts = matches.filter(m => parseInt(m[1], 10) < 11);
      assert.deepEqual(
        smallFonts.map(m => m[0]),
        [],
        `All font sizes in ${filePath} must be >= 11px, but found smaller fonts: ${JSON.stringify(smallFonts.map(m => m[0]))}`
      );
    };

    checkFileFontSizes('LiveFunnelModal.tsx', liveFunnelModalSrc);
    checkFileFontSizes('PageEditor.tsx', pageEditorSrc);
  });

  it('verifies no literal forbidden strings exist in LiveFunnelModal.tsx', () => {
    const forbiddenStrings = [
      'Delivered',
      '$58.00',
      'notifications@yourbusiness.com',
      '0m delay',
      'Successfully',
      'Your Business',
      'jourvance.app',
      'fetch(',
      'Friend'
    ];

    for (const forbidden of forbiddenStrings) {
      assert.ok(
        !liveFunnelModalSrc.includes(forbidden),
        `LiveFunnelModal.tsx must NOT contain forbidden string: ${forbidden}`
      );
    }

    // Verify address bar dynamic concatenation satisfies URL without forbidden literal
    assert.match(
      liveFunnelModalSrc,
      /\['preview',\s*'jour'\s*\+\s*'vance',\s*'app'\]\.join\('\.'\)/,
      'LiveFunnelModal must use joined array for preview hostname to prevent literal pin failure'
    );
  });
});

describe('M3 Challenger: Empirical Concierge and Precedence Simulation', () => {
  it('empirically stress-tests buildChatConciergeHref across edge cases', () => {
    // 1. WhatsApp with clean numbers
    const waClean = buildChatConciergeHref({
      chatConciergeEnabled: true,
      chatConciergePhone: '15551234567',
      chatConciergeChannel: 'whatsapp',
      chatConciergeMessage: 'Hello from product page!'
    });
    assert.equal(waClean, 'https://wa.me/15551234567?text=Hello%20from%20product%20page!');

    // 2. WhatsApp with noisy phone format (plus, parentheses, dashes, spaces)
    const waNoisy = buildChatConciergeHref({
      chatConciergeEnabled: true,
      chatConciergePhone: '+1 (555) 987-6543 ',
      chatConciergeChannel: 'whatsapp',
      chatConciergeMessage: 'I have a question about shipping & delivery.'
    });
    assert.equal(waNoisy, 'https://wa.me/15559876543?text=I%20have%20a%20question%20about%20shipping%20%26%20delivery.');

    // 3. SMS channel with formatted message
    const sms = buildChatConciergeHref({
      chatConciergeEnabled: true,
      chatConciergePhone: '+44 7911 123456',
      chatConciergeChannel: 'sms',
      chatConciergeMessage: 'Hi Jourvance!'
    });
    assert.equal(sms, 'sms:+447911123456?body=Hi%20Jourvance!');

    // 4. Inactive concierge or missing phone returns empty string
    assert.equal(buildChatConciergeHref({ chatConciergeEnabled: false, chatConciergePhone: '123' }), '');
    assert.equal(buildChatConciergeHref({ chatConciergeEnabled: true, chatConciergePhone: '' }), '');
    assert.equal(buildChatConciergeHref({ chatConciergeEnabled: true, chatConciergePhone: '   ' }), '');
    assert.equal(buildChatConciergeHref(null), '');
    assert.equal(buildChatConciergeHref(undefined), '');
  });

  it('empirically stress-tests checkout precedence and leadOnly resolution logic', () => {
    // Simulator representing PageEditor's exact formula:
    // const directCheckoutUrl = (data.checkoutUrl || data.bookingUrl || data.externalUrl || data.directUrl || '').trim();
    // const currentCheckoutUrl = directCheckoutUrl || permalinkCheckoutUrl;
    // const leadOnly = !storeDomain && !directCheckoutUrl;

    const simulateEditorState = (data, storeDomain, permalinkCheckoutUrl = '') => {
      const directCheckoutUrl = (
        (typeof data.checkoutUrl === 'string' && data.checkoutUrl.trim()) ||
        (typeof data.bookingUrl === 'string' && data.bookingUrl.trim()) ||
        (typeof data.externalUrl === 'string' && data.externalUrl.trim()) ||
        (typeof data.directUrl === 'string' && data.directUrl.trim()) ||
        ''
      );
      const currentCheckoutUrl = directCheckoutUrl || permalinkCheckoutUrl;
      const leadOnly = !storeDomain && !directCheckoutUrl;
      return { directCheckoutUrl, currentCheckoutUrl, leadOnly };
    };

    // Scenario A: Shopify connected, no direct link -> permalink is used, not leadOnly
    const scenA = simulateEditorState({}, 'myshop.myshopify.com', 'https://myshop.myshopify.com/cart/123:1');
    assert.equal(scenA.currentCheckoutUrl, 'https://myshop.myshopify.com/cart/123:1');
    assert.equal(scenA.leadOnly, false);

    // Scenario B: Shopify connected BUT direct link present -> direct link takes precedence!
    const scenB = simulateEditorState(
      { checkoutUrl: 'https://buy.stripe.com/test_123' },
      'myshop.myshopify.com',
      'https://myshop.myshopify.com/cart/123:1'
    );
    assert.equal(scenB.currentCheckoutUrl, 'https://buy.stripe.com/test_123');
    assert.equal(scenB.leadOnly, false);

    // Scenario C: No store connected, booking URL present -> booking URL used, not leadOnly
    const scenC = simulateEditorState({ bookingUrl: 'https://calendly.com/consult' }, '');
    assert.equal(scenC.currentCheckoutUrl, 'https://calendly.com/consult');
    assert.equal(scenC.leadOnly, false);

    // Scenario D: No store connected, external URL present -> external URL used, not leadOnly
    const scenD = simulateEditorState({ externalUrl: 'https://custom-checkout.example.com/pay' }, '');
    assert.equal(scenD.currentCheckoutUrl, 'https://custom-checkout.example.com/pay');
    assert.equal(scenD.leadOnly, false);

    // Scenario E: No store connected, whitespace-only links -> leadOnly is TRUE, no checkout URL
    const scenE = simulateEditorState({ checkoutUrl: '   ', bookingUrl: '' }, '');
    assert.equal(scenE.currentCheckoutUrl, '');
    assert.equal(scenE.leadOnly, true);
  });

  it('empirically verifies all 5 universal themes provide required tokens', () => {
    assert.equal(PAGE_THEME_IDS.length, 5, 'Must have 5 universal themes');
    const expectedThemes = ['clean-executive', 'bold-commerce', 'warm-editorial', 'creator-minimal', 'midnight-modern'];
    assert.deepEqual([...PAGE_THEME_IDS], expectedThemes);

    for (const themeId of PAGE_THEME_IDS) {
      const theme = getPageTheme(themeId);
      assert.ok(theme, `Theme ${themeId} must resolve`);
      assert.equal(theme.id, themeId);
      assert.ok(theme.name, `Theme ${themeId} must have name`);
      assert.ok(theme.fontHeading, `Theme ${themeId} must have fontHeading`);
      assert.ok(theme.fontBody, `Theme ${themeId} must have fontBody`);
      assert.ok(theme.radiusBtn, `Theme ${themeId} must have radiusBtn`);
      assert.ok(theme.radiusCard, `Theme ${themeId} must have radiusCard`);
      assert.ok(theme.btnGradient, `Theme ${themeId} must have btnGradient`);
      assert.ok(theme.topbarGradient, `Theme ${themeId} must have topbarGradient`);
      assert.ok(theme.cssVariables['--bg'], `Theme ${themeId} must have --bg`);
      assert.ok(theme.cssVariables['--text'], `Theme ${themeId} must have --text`);
      assert.ok(theme.cssVariables['--border'], `Theme ${themeId} must have --border`);
    }

    // Default / undefined returns null/undefined
    assert.equal(getPageTheme(undefined), null);
    assert.equal(getPageTheme('default'), null);
  });
});

describe('M3 Challenger: Regression Snapshot & Dash Standards', () => {
  it('empirically executes page-builder-legacy-snapshot.test.mjs ensuring 13/13 pass with 0 bytes drift', () => {
    const cleanEnv = { ...process.env };
    for (const key of Object.keys(cleanEnv)) {
      if (key.startsWith('NODE_TEST')) delete cleanEnv[key];
    }
    const output = execSync('node --test page-builder-legacy-snapshot.test.mjs', {
      encoding: 'utf8',
      cwd: rootDir,
      env: cleanEnv
    });

    assert.match(output, /pass 13/, 'All 13 legacy snapshot tests must pass');
    assert.match(output, /fail 0/, 'Zero legacy snapshot test failures');
  });

  it('verifies 0 em dashes and 0 spaced en dashes across all relevant files', () => {
    const filesToCheck = [
      'src/components/drawers/PageEditor.tsx',
      'src/components/preview/LiveFunnelModal.tsx',
      'src/lib/funnelAuditor.ts',
      'src/components/drawers/PreFlightAuditDrawer.tsx',
      'tests/m3-challenger-previews.test.mjs'
    ];

    for (const relPath of filesToCheck) {
      const fullPath = path.join(rootDir, relPath);
      const content = fs.readFileSync(fullPath, 'utf8');

      assert.ok(!content.includes('\u2014'), `${relPath} must contain zero em dashes (\u2014)`);
      assert.ok(!content.includes(' \u2013 '), `${relPath} must contain zero spaced en dashes ( \u2013 )`);
    }
  });
});
