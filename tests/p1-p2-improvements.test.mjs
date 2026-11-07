import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeGoogleDriveImageUrl,
  isConvertedGoogleDriveImageUrl,
  buildGoogleCalendarPresetUrl,
  validateDirectCheckoutUrl,
  buildChatConciergeHref
} from '../src/lib/pageEditorSections.ts';
import { migrateLegacyPage } from '../src/lib/pageBuilder/model.mjs';
import { builderFrameScript } from '../server/routes/publicBuilderScript.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

describe('P1.1 & P1.2: Public Funnel Builder & Legacy Parity (Click-to-Chat + GTM dataLayer)', () => {
  const publicRoutesSrc = fs.readFileSync(path.join(ROOT, 'server/routes/publicRoutes.mjs'), 'utf8');

  it('renderBuilderPage renders #jv-chat-concierge-btn when buildChatConciergeHref is non-empty and 0 bytes when disabled', () => {
    const builderFnStart = publicRoutesSrc.indexOf('function renderBuilderPage(page, req)');
    const builderFnEnd = publicRoutesSrc.indexOf('function renderPublicFunnelHtml(page, req, res)');
    assert.ok(builderFnStart > -1 && builderFnEnd > builderFnStart, 'renderBuilderPage is present');
    const builderBlock = publicRoutesSrc.slice(builderFnStart, builderFnEnd);

    assert.ok(builderBlock.includes('buildChatConciergeHref(rawData)'), 'renderBuilderPage calls buildChatConciergeHref(rawData)');
    assert.ok(builderBlock.includes('id="jv-chat-concierge-btn"'), 'renderBuilderPage emits #jv-chat-concierge-btn when configured');
    assert.equal(buildChatConciergeHref({ chatConciergeEnabled: false, chatConciergePhone: '15551234567' }), '');
    assert.equal(
      buildChatConciergeHref({ chatConciergeEnabled: true, chatConciergeChannel: 'whatsapp', chatConciergePhone: '+1 (555) 123-4567', chatConciergeMessage: 'Hello team' }),
      'https://wa.me/15551234567?text=Hello%20team'
    );
  });

  it('builderFrameScript and renderPublicFunnelHtml push begin_checkout and generate_lead to window.dataLayer when gtmContainerId is set', () => {
    const scriptWithoutGtm = builderFrameScript({
      slug: 'test-offer',
      productTitle: 'Growth Package',
      gtmContainerId: ''
    });
    assert.ok(!scriptWithoutGtm.includes('window.dataLayer.push'), '0 extra dataLayer bytes when gtmContainerId is empty');

    const scriptWithGtm = builderFrameScript({
      slug: 'test-offer',
      productTitle: 'Growth Package',
      gtmContainerId: 'GTM-ABC1234'
    });
    assert.ok(
      scriptWithGtm.includes("window.dataLayer.push({ event: 'begin_checkout'"),
      'builderFrameScript pushes begin_checkout to dataLayer when GTM is configured'
    );
    assert.ok(
      scriptWithGtm.includes("window.dataLayer.push({ event: 'generate_lead' })"),
      'builderFrameScript pushes generate_lead to dataLayer when GTM is configured'
    );

    const legacyFnStart = publicRoutesSrc.indexOf('function renderPublicFunnelHtml(page, req, res)');
    const legacyBlock = publicRoutesSrc.slice(legacyFnStart, legacyFnStart + 70000);
    assert.ok(
      legacyBlock.includes("window.dataLayer.push({ event: 'begin_checkout'"),
      'renderPublicFunnelHtml pushes begin_checkout to dataLayer when GTM is configured'
    );
    assert.ok(
      legacyBlock.includes("window.dataLayer.push({ event: 'generate_lead' })"),
      'renderPublicFunnelHtml pushes generate_lead to dataLayer when GTM is configured'
    );
  });
});

describe('P1.3: Mobile Nav Trigger in Email Draft Browser Check', () => {
  it('scripts/email-draft-browser-check.mjs opens .jv-mobile-nav-trigger when Email Studio button is hidden on mobile viewports', () => {
    const scriptSrc = fs.readFileSync(path.join(ROOT, 'scripts/email-draft-browser-check.mjs'), 'utf8');
    const openComposerStart = scriptSrc.indexOf('async function openComposer(page, base)');
    const openComposerBlock = scriptSrc.slice(openComposerStart, openComposerStart + 700);
    assert.ok(openComposerBlock.includes('.jv-mobile-nav-trigger'), 'openComposer clicks .jv-mobile-nav-trigger when sidebar is hidden');
  });
});

describe('P2.1: Google Drive Image Share Link Auto-Converter', () => {
  it('normalizeGoogleDriveImageUrl converts file/d/<id>/view and open?id=<id> links to direct lh3.googleusercontent.com URLs', () => {
    const fileId = '1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';
    assert.equal(
      normalizeGoogleDriveImageUrl(`https://drive.google.com/file/d/${fileId}/view?usp=sharing`),
      `https://lh3.googleusercontent.com/d/${fileId}`
    );
    assert.equal(
      normalizeGoogleDriveImageUrl(`https://drive.google.com/open?id=${fileId}`),
      `https://lh3.googleusercontent.com/d/${fileId}`
    );
    assert.equal(
      normalizeGoogleDriveImageUrl(`https://drive.google.com/uc?export=view&id=${fileId}`),
      `https://lh3.googleusercontent.com/d/${fileId}`
    );
    assert.equal(isConvertedGoogleDriveImageUrl(`https://lh3.googleusercontent.com/d/${fileId}`), true);
    assert.equal(isConvertedGoogleDriveImageUrl('https://images.unsplash.com/photo-123'), false);
  });

  it('migrateLegacyPage in model.mjs normalizes Google Drive share links in heroImageUrl and orderBumpImage', () => {
    const fileId = '1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';
    const doc = migrateLegacyPage({
      headline: 'Consulting Retainer',
      heroImageUrl: `https://drive.google.com/file/d/${fileId}/view?usp=sharing`,
      orderBumpEnabled: true,
      orderBumpImage: `https://drive.google.com/open?id=${fileId}`
    });
    const offerSec = doc.sections.find(s => s.id === 'legacy-offer');
    const productWidget = offerSec.children[0].children[0];
    const bumpWidget = offerSec.children[1].children.find(w => w.id === 'legacy-bump');
    assert.equal(productWidget.props.imageUrl, `https://lh3.googleusercontent.com/d/${fileId}`);
    assert.equal(bumpWidget.props.image, `https://lh3.googleusercontent.com/d/${fileId}`);
  });
});

describe('P2.2: 1-Click Add to Google Calendar Preset in ThankYouEditor', () => {
  it('buildGoogleCalendarPresetUrl builds a Google Calendar template URL and ThankYouEditor wires the preset button', () => {
    const url = buildGoogleCalendarPresetUrl('Strategy Kickoff', 'Bring your Q4 goals.');
    assert.ok(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'));
    assert.ok(url.includes('text=Strategy%20Kickoff'));
    assert.ok(url.includes('details=Bring%20your%20Q4%20goals.'));

    const tySrc = fs.readFileSync(path.join(ROOT, 'src/components/drawers/ThankYouEditor.tsx'), 'utf8');
    assert.ok(tySrc.includes('Add to Google Calendar Preset'), 'ThankYouEditor renders Add to Google Calendar Preset button');
    assert.ok(tySrc.includes('buildGoogleCalendarPresetUrl'), 'ThankYouEditor uses buildGoogleCalendarPresetUrl');
  });
});

describe('P2.3: Harmonized Blueprint Modal Filter Pills with 5 Universal Categories', () => {
  it('BlueprintModal.tsx uses UNIVERSAL_BUSINESS_CATEGORIES for its turnkey filter pills', () => {
    const modalSrc = fs.readFileSync(path.join(ROOT, 'src/components/modals/BlueprintModal.tsx'), 'utf8');
    assert.ok(modalSrc.includes('UNIVERSAL_BUSINESS_CATEGORIES.map'), 'BlueprintModal maps over UNIVERSAL_BUSINESS_CATEGORIES');
    assert.ok(modalSrc.includes("label: 'All Categories'"), 'BlueprintModal includes All Categories pill');
    assert.ok(!modalSrc.includes('All Architectures'), 'Legacy ad-hoc filter tabs are removed');
  });
});

describe('P2.4 & P2.5: Progressive Disclosure Sub-Groups & Direct Checkout Link Validator in PageEditor', () => {
  const editorSrc = fs.readFileSync(path.join(ROOT, 'src/components/drawers/PageEditor.tsx'), 'utf8');

  it('validateDirectCheckoutUrl validates https:// and site-relative paths and rejects malformed URLs', () => {
    assert.equal(validateDirectCheckoutUrl('').valid, true);
    assert.equal(validateDirectCheckoutUrl('https://buy.stripe.com/test_123').valid, true);
    assert.equal(validateDirectCheckoutUrl('/book-call').valid, true);
    assert.equal(validateDirectCheckoutUrl('not a url').valid, false);
    assert.equal(validateDirectCheckoutUrl('ftp://files.example.com').valid, false);
    assert.equal(validateDirectCheckoutUrl('https://localhost:3000/checkout').valid, true);
  });

  it('PageEditor.tsx groups extras into 3 native <details> disclosure groups and wires Test Link + Order Bump notice', () => {
    assert.ok(editorSrc.includes('<span>Urgency &amp; Scarcity</span>'), 'Urgency & Scarcity disclosure group present');
    assert.ok(editorSrc.includes('<span>Exit &amp; Retention</span>'), 'Exit & Retention disclosure group present');
    assert.ok(editorSrc.includes('<span>Social Proof &amp; Reviews</span>'), 'Social Proof & Reviews disclosure group present');
    assert.ok(editorSrc.includes('<span>Test Link</span>'), 'Test Link button present for valid direct checkout URLs');
    assert.ok(editorSrc.includes('Direct Link + Order Bump Notice:'), 'Order Bump compatibility notice present when both checkoutUrl and orderBumpEnabled are active');
  });
});

describe('P2.6: Journey-Level Global Theme Selector & Single-Page Variants vs. Canvas Route Split Callouts', () => {
  it('CanvasHeader, App, PageEditor, and AbSplitEditor wire global journey theme and disambiguate A/B testing modes', () => {
    const headerSrc = fs.readFileSync(path.join(ROOT, 'src/components/toolbar/CanvasHeader.tsx'), 'utf8');
    const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
    const pageEditorSrc = fs.readFileSync(path.join(ROOT, 'src/components/drawers/PageEditor.tsx'), 'utf8');
    const abSplitSrc = fs.readFileSync(path.join(ROOT, 'src/components/drawers/AbSplitEditor.tsx'), 'utf8');

    assert.ok(headerSrc.includes('aria-label="Journey theme"'), 'CanvasHeader renders Journey theme selector');
    assert.ok(appSrc.includes('const handleUpdateJourneyTheme ='), 'App defines handleUpdateJourneyTheme');
    assert.ok(pageEditorSrc.includes('Apply to all steps'), 'PageEditor renders Apply to all steps button');
    assert.ok(pageEditorSrc.includes('Single-Page Variants vs. Canvas Route Split:'), 'PageEditor explains Single-Page Variants vs. Canvas Route Split');
    assert.ok(abSplitSrc.includes('Canvas Route Split vs. Single-Page Variants:'), 'AbSplitEditor explains Canvas Route Split vs. Single-Page Variants');
  });
});
