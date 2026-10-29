import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('PageEditor preview wires theme cascading, direct checkout precedence, and concierge button', () => {
  const src = fs.readFileSync('src/components/drawers/PageEditor.tsx', 'utf8');

  // Imports
  assert.match(src, /import \{ getPageTheme, getThemeCssVariables \} from '\.\.\/\.\.\/lib\/pageThemes';/);
  assert.match(src, /buildChatConciergeHref/);

  // Direct checkout precedence and leadOnly update
  assert.match(src, /const directCheckoutUrl = \(/);
  assert.match(src, /const currentCheckoutUrl = directCheckoutUrl \|\| permalinkCheckoutUrl;/);
  assert.match(src, /const leadOnly = !storeDomain && !directCheckoutUrl;/);

  // Alert neutralization
  assert.doesNotMatch(src, /Please connect your Shopify store and select a product variant/);
  assert.match(src, /Please connect a store or set a checkout or booking link to activate checkout\./);

  // Preview button hint for direct link
  assert.match(src, /directCheckoutUrl\s*\?\s*'Goes straight to your checkout or booking link\.'/);

  // Theme styling cascading in preview mockup frame
  assert.match(src, /id="jv-preview-frame"/);
  assert.match(src, /activeTheme\?\.googleFontsUrl/);
  assert.match(src, /activeTheme\?\.topbarGradient/);
  assert.match(src, /activeTheme\?\.fontHeading/);
  assert.match(src, /activeTheme\?\.btnGradient/);

  // Click-to-Chat concierge button
  assert.match(src, /id="jv-chat-concierge-btn"/);
  assert.match(src, /buildChatConciergeHref\(data\)/);

  // Text sizes and dash invariant
  assert.doesNotMatch(src, /\bfontSize:\s*'(?:[1-9]|10)px'/, 'no text size under 11px');
  assert.ok(!src.includes('\u2014'), 'zero em dashes');
  assert.ok(!src.includes(' \u2013 '), 'zero spaced en dashes');
});

test('LiveFunnelModal wires theme variables, direct destination in summary, and concierge button', () => {
  const src = fs.readFileSync('src/components/preview/LiveFunnelModal.tsx', 'utf8');

  // Imports
  assert.match(src, /import \{ getPageTheme \} from '\.\.\/\.\.\/lib\/pageThemes';/);
  assert.match(src, /import \{ buildChatConciergeHref \} from '\.\.\/\.\.\/lib\/pageEditorSections';/);

  // Active theme resolution
  assert.match(src, /const activeThemeId = \(currentNode\?\.data as \{ theme\?: PageThemeId \}\)\?\.theme \|\| \(project as JourneyProject & \{ theme\?: PageThemeId \}\)\.theme;/);
  assert.match(src, /const activeTheme = getPageTheme\(activeThemeId\);/);

  // Device frame theme styling and font injection
  assert.match(src, /data-device-frame=\{viewMode\}/);
  assert.match(src, /activeTheme\?\.googleFontsUrl/);

  // ChoiceButton receives theme
  assert.match(src, /theme=\{activeTheme\}/);

  // Direct checkout link in summary panel
  assert.match(src, /\(corePrice > 0 \|\| pageData\?\.checkoutUrl\)/);

  // Click-to-Chat concierge button in preview
  assert.match(src, /id="jv-chat-concierge-btn"/);
  assert.match(src, /buildChatConciergeHref\(d\)/);

  // Text size elevation and dash invariant
  assert.doesNotMatch(src, /\bfontSize:\s*'(?:[1-9]|10)px'/, 'no text size under 11px');
  assert.ok(!src.includes('\u2014'), 'zero em dashes');
  assert.ok(!src.includes(' \u2013 '), 'zero spaced en dashes');

  // Network call invariant: no live fetch or external network calls
  assert.ok(!src.includes('fetch('), 'no fetch calls');
});
