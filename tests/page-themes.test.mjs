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
import { composite, contrastRatio, parseCssColor } from '../src/lib/a11yRules.ts';
import { setupJourneyRoutes } from '../server/routes/journeyRoutes.mjs';
import { renderPublicFunnelHtml, renderPublicUpsellHtml } from '../server/routes/publicRoutes.mjs';
import { stepFingerprint } from '../src/lib/publishState.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

const hexToRgba = h => {
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
};

const parseColor = c => {
  if (c.startsWith('#')) return hexToRgba(c);
  const parsed = parseCssColor(c);
  if (!parsed) throw new Error(`Could not parse color: ${c}`);
  return parsed;
};

test('PAGE_THEME_IDS defines exactly the five universal themes in order', () => {
  assert.deepEqual(PAGE_THEME_IDS, [
    'clean-executive',
    'bold-commerce',
    'warm-editorial',
    'creator-minimal',
    'midnight-modern'
  ]);
});

test('isPageThemeId validates valid theme IDs and rejects invalid ones', () => {
  for (const id of PAGE_THEME_IDS) {
    assert.equal(isPageThemeId(id), true);
  }
  assert.equal(isPageThemeId('default'), false);
  assert.equal(isPageThemeId(''), false);
  assert.equal(isPageThemeId(null), false);
  assert.equal(isPageThemeId(undefined), false);
  assert.equal(isPageThemeId('unknown-theme'), false);
});

test('PAGE_THEMES contains full definitions for all 5 themes with required properties', () => {
  const REQUIRED_VARS = [
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
    '--radius-card',
    '--font-heading',
    '--font-body',
    '--btn-text'
  ];

  for (const id of PAGE_THEME_IDS) {
    const theme = PAGE_THEMES[id];
    assert.ok(theme, `Theme ${id} must exist in PAGE_THEMES`);
    assert.equal(theme.id, id);
    assert.ok(theme.name.length > 0);
    assert.ok(theme.industry.length > 0);
    assert.ok(theme.description.length > 0);
    assert.ok(theme.fontHeading.length > 0);
    assert.ok(theme.fontBody.length > 0);
    assert.ok(theme.googleFontsUrl.startsWith('https://fonts.googleapis.com/css2?family='));
    assert.ok(theme.radiusBtn.endsWith('px'));
    assert.ok(theme.radiusCard.endsWith('px'));
    assert.ok(theme.btnGradient.startsWith('linear-gradient('));
    assert.ok(theme.topbarGradient.startsWith('linear-gradient('));
    assert.ok(theme.btnText.startsWith('#'));

    for (const varName of REQUIRED_VARS) {
      assert.ok(
        varName in theme.cssVariables,
        `Theme ${id} missing css variable ${varName}`
      );
      assert.ok(
        theme.cssVariables[varName].length > 0,
        `Theme ${id} empty css variable ${varName}`
      );
    }
  }
});

test('getPageTheme and getThemeCssVariables return expected values or empty fallbacks', () => {
  const execTheme = getPageTheme('clean-executive');
  assert.equal(execTheme?.name, 'Clean Executive');
  assert.equal(getPageTheme('default'), null);
  assert.equal(getPageTheme(null), null);
  assert.equal(getPageTheme(undefined), null);

  const execVars = getThemeCssVariables('clean-executive');
  assert.equal(execVars['--bg'], '#F8FAFC');
  assert.equal(execVars['--primary'], '#2563EB');

  assert.deepEqual(getThemeCssVariables('default'), {});
  assert.deepEqual(getThemeCssVariables(null), {});
  assert.deepEqual(getThemeCssVariables(undefined), {});
  assert.deepEqual(getThemeCssVariables('non-existent'), {});
});

test('PAGE_THEMES balances 3 light themes and 2 dark themes with matching color-scheme declarations', () => {
  const lightIds = ['clean-executive', 'warm-editorial', 'creator-minimal'];
  const darkIds = ['bold-commerce', 'midnight-modern'];
  const pureBlack = parseColor('#000000');
  const pureWhite = parseColor('#FFFFFF');

  for (const id of lightIds) {
    const theme = PAGE_THEMES[id];
    assert.equal(theme.mode, 'light', `Theme ${id} must declare mode: 'light'`);
    const crVsBlack = contrastRatio(pureBlack, parseColor(theme.cssVariables['--bg']));
    assert.ok(crVsBlack >= 18, `Light theme ${id} background must be a true light surface (>= 18:1 vs black, got ${crVsBlack.toFixed(2)})`);
    const block = renderThemeStyleBlock(id, 'landing');
    assert.ok(block.includes('color-scheme: light;'), `Light theme ${id} must emit color-scheme: light;`);
  }

  for (const id of darkIds) {
    const theme = PAGE_THEMES[id];
    assert.equal(theme.mode, 'dark', `Theme ${id} must declare mode: 'dark'`);
    const crVsWhite = contrastRatio(pureWhite, parseColor(theme.cssVariables['--bg']));
    assert.ok(crVsWhite >= 18, `Dark theme ${id} background must be a true dark surface (>= 18:1 vs white, got ${crVsWhite.toFixed(2)})`);
    const block = renderThemeStyleBlock(id, 'landing');
    assert.ok(block.includes('color-scheme: dark;'), `Dark theme ${id} must emit color-scheme: dark;`);
  }
});

test('renderThemeStyleBlock and renderThemeHeadAssets return empty string for unset/default theme and valid style for active themes', () => {
  assert.equal(renderThemeStyleBlock(null), '');
  assert.equal(renderThemeStyleBlock(undefined), '');
  assert.equal(renderThemeStyleBlock(''), '');
  assert.equal(renderThemeStyleBlock('default'), '');
  assert.equal(renderThemeStyleBlock('non-existent'), '');

  assert.equal(renderThemeHeadAssets(null), '');
  assert.equal(renderThemeHeadAssets(undefined), '');
  assert.equal(renderThemeHeadAssets(''), '');
  assert.equal(renderThemeHeadAssets('default'), '');
  assert.equal(renderThemeHeadAssets('non-existent'), '');

  for (const id of PAGE_THEME_IDS) {
    const html = renderThemeStyleBlock(id, 'landing');
    assert.ok(html.includes('<style id="jv-page-theme">'), `Theme ${id} must render style block`);
    assert.ok(html.includes(':root {'), `Theme ${id} must contain root variables`);
    assert.ok(html.includes('--bg:'), `Theme ${id} must include --bg`);
    assert.ok(html.includes('.cta-btn'), `Theme ${id} landing must style .cta-btn`);
    assert.ok(html.includes('</style>'), `Theme ${id} must close style tag`);

    const tyHtml = renderThemeStyleBlock(id, 'thank-you');
    assert.ok(tyHtml.includes('.check-icon'), `Theme ${id} thank-you must style .check-icon`);

    const upHtml = renderThemeStyleBlock(id, 'upsell');
    assert.ok(upHtml.includes('.btn-accept'), `Theme ${id} upsell must style .btn-accept`);
  }
});

test('all themes meet WCAG AA contrast standards (>= 4.5:1 body text, >= 3:1 large accent, >= 4.5:1 button text)', () => {
  for (const id of PAGE_THEME_IDS) {
    const theme = PAGE_THEMES[id];
    const bg = parseColor(theme.cssVariables['--bg']);
    const cardBgRaw = parseColor(theme.cssVariables['--card-bg']);
    const cardComp = composite(cardBgRaw, bg);
    const text = parseColor(theme.cssVariables['--text']);
    const textMuted = parseColor(theme.cssVariables['--text-muted']);
    const primary = parseColor(theme.cssVariables['--primary']);
    const secondary = parseColor(theme.cssVariables['--secondary']);
    const btnText = parseColor(theme.btnText);

    const crTextBg = contrastRatio(text, bg);
    assert.ok(
      crTextBg >= 4.5,
      `Theme ${id} text on bg contrast must be >= 4.5:1 (got ${crTextBg.toFixed(2)})`
    );

    const crTextCard = contrastRatio(text, cardComp);
    assert.ok(
      crTextCard >= 4.5,
      `Theme ${id} text on card contrast must be >= 4.5:1 (got ${crTextCard.toFixed(2)})`
    );

    const crMutedBg = contrastRatio(textMuted, bg);
    assert.ok(
      crMutedBg >= 4.5,
      `Theme ${id} muted text on bg contrast must be >= 4.5:1 (got ${crMutedBg.toFixed(2)})`
    );

    const crMutedCard = contrastRatio(textMuted, cardComp);
    assert.ok(
      crMutedCard >= 4.5,
      `Theme ${id} muted text on card contrast must be >= 4.5:1 (got ${crMutedCard.toFixed(2)})`
    );

    const crPrimBg = contrastRatio(primary, bg);
    assert.ok(
      crPrimBg >= 3.0,
      `Theme ${id} primary on bg contrast must be >= 3.0:1 (got ${crPrimBg.toFixed(2)})`
    );

    const crSecBg = contrastRatio(secondary, bg);
    assert.ok(
      crSecBg >= 3.0,
      `Theme ${id} secondary on bg contrast must be >= 3.0:1 (got ${crSecBg.toFixed(2)})`
    );

    // Extract hex colors from button gradient
    const gradMatches = theme.btnGradient.match(/#[0-9a-fA-F]{6}/g) || [];
    assert.ok(gradMatches.length >= 2, `Theme ${id} button gradient must have at least 2 color stops`);
    for (const gHex of gradMatches) {
      const gColor = parseColor(gHex);
      const crBtn = contrastRatio(btnText, gColor);
      assert.ok(
        crBtn >= 4.5,
        `Theme ${id} button text on gradient stop ${gHex} must be >= 4.5:1 (got ${crBtn.toFixed(2)})`
      );
    }
  }
});

test('src/lib/pageThemes.ts contains zero em dashes and zero spaced en dashes', () => {
  const filePath = path.join(here, '../src/lib/pageThemes.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.equal(content.includes('\u2014'), false, 'Must contain 0 em dashes');
  assert.equal(/\s\u2013\s/.test(content), false, 'Must contain 0 spaced en dashes');
});

test('standalone published upsell records and /p/preview/:token inherit landing-page theme without drifting stepFingerprint', async () => {
  const routes = new Map();
  const app = {
    get: (routePath, ...handlers) => routes.set(`GET ${routePath}`, handlers),
    post: (routePath, ...handlers) => routes.set(`POST ${routePath}`, handlers)
  };

  const journeys = new Map();
  const publicPageCache = {};
  const publishLogs = new Map();

  setupJourneyRoutes(app, {
    requireUser: (req, _res, next) => next(),
    loadJourney: async (_uid, id) => journeys.get(id) || null,
    saveJourney: async (_uid, id, journey) => {
      journeys.set(id, journey);
      return { durable: true };
    },
    loadWorkspace: async () => null,
    realStoreDomain: () => '',
    validateSlugAvailability: async (slug) => ({ available: true, cleanSlug: slug }),
    reloadDomainRegistry: () => {},
    domainRegistryCache: {},
    savePublicPage: async (key, record) => {
      publicPageCache[key] = record;
      return { written: true };
    },
    removePublicPage: async (key) => {
      delete publicPageCache[key];
      return { removed: true };
    },
    persistPublicPages: async () => {},
    publicPageCache,
    loadPublishLog: async (_uid, id) => ({ ok: true, log: publishLogs.get(id) || null }),
    savePublishLog: async (_uid, id, log) => {
      publishLogs.set(id, log);
      return { durable: true };
    },
    renderPublicFunnelHtml,
    renderPublicUpsellHtml
  });

  const invoke = async (method, routeKey, { params = {}, query = {}, body = {} } = {}) => {
    const handlers = routes.get(`${method} ${routeKey}`);
    assert.ok(handlers, `Missing handler for ${method} ${routeKey}`);
    const req = { user: { uid: 'user_theme_1' }, params, query, body, headers: {} };
    let statusCode = 200;
    let payload;
    const headers = {};
    let settled = false;
    await new Promise((resolve, reject) => {
      const done = (val) => {
        payload = val;
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const res = {
        headersSent: false,
        set: (k, v) => { headers[k] = v; return res; },
        setHeader: (k, v) => { headers[k] = v; },
        status: (c) => { statusCode = c; return res; },
        json: (obj) => { res.headersSent = true; done(obj); return res; },
        send: (txt) => { res.headersSent = true; done(txt); return res; }
      };
      const runChain = (idx) => {
        if (idx >= handlers.length) return;
        try {
          const out = handlers[idx](req, res, () => runChain(idx + 1));
          if (out && typeof out.then === 'function') out.catch(reject);
        } catch (err) {
          reject(err);
        }
      };
      runChain(0);
    });
    return { statusCode, payload, headers };
  };

  // Case 1: Landing page has theme 'clean-executive', upsell has no theme set -> inherits 'clean-executive'
  journeys.set('j_inherit', {
    id: 'j_inherit',
    name: 'Executive Funnel',
    nodes: [
      {
        id: 'n_landing',
        type: 'landing-page',
        data: { slug: 'exec-offer', headline: 'Executive Brief', theme: 'clean-executive' }
      },
      {
        id: 'n_upsell',
        type: 'upsell',
        data: { slug: 'exec-addon', headline: 'Implementation Workshop', offerType: 'upsell' }
      }
    ],
    edges: [{ id: 'e1', source: 'n_landing', target: 'n_upsell' }]
  });

  const pub1 = await invoke('POST', '/api/journey/:id/publish', { params: { id: 'j_inherit' } });
  assert.equal(pub1.statusCode, 200);
  assert.equal(pub1.payload.success, true);

  const upsellRecord = publicPageCache['exec-addon'];
  assert.ok(upsellRecord, 'Standalone upsell record must be written');
  assert.equal(upsellRecord.data.theme, 'clean-executive', 'Standalone upsell record must inherit landing-page theme');
  assert.equal(upsellRecord.data.upsell.theme, 'clean-executive', 'Nested upsell payload must inherit landing-page theme');

  // Verify saved node data did NOT gain a synthetic theme key and contentFingerprint matches stepFingerprint
  const savedJourney = journeys.get('j_inherit');
  const savedUpsellNode = savedJourney.nodes.find(n => n.id === 'n_upsell');
  assert.equal(savedUpsellNode.data.theme, undefined, 'Saved upsell node data must remain unmutated');
  assert.equal(
    upsellRecord.contentFingerprint,
    stepFingerprint(savedUpsellNode, savedJourney.edges),
    'Upsell record contentFingerprint must match client stepFingerprint'
  );

  // Verify standalone /u/:slug SSR render uses the inherited light theme
  const standaloneHtml = renderPublicUpsellHtml(upsellRecord, { params: { slug: 'exec-addon' }, query: {}, headers: {} }, null, false);
  assert.ok(standaloneHtml.includes('<style id="jv-page-theme">'));
  assert.ok(standaloneHtml.includes('color-scheme: light;'));
  assert.ok(standaloneHtml.includes('--bg: #F8FAFC;'));

  // Verify /p/preview/:token for the upsell step also renders with the inherited theme
  const prevReq = await invoke('POST', '/api/journey/:id/preview', {
    params: { id: 'j_inherit' },
    body: { nodeId: 'n_upsell' }
  });
  assert.equal(prevReq.statusCode, 200);
  const token = prevReq.payload.url.replace('/p/preview/', '');
  const prevGet = await invoke('GET', '/p/preview/:token', { params: { token } });
  assert.equal(prevGet.statusCode, 200);
  assert.ok(prevGet.payload.includes('<style id="jv-page-theme">'));
  assert.ok(prevGet.payload.includes('--bg: #F8FAFC;'));

  // Case 2: Upsell explicitly sets its own theme ('bold-commerce') -> own theme wins over landing-page theme
  journeys.set('j_override', {
    id: 'j_override',
    name: 'Override Funnel',
    nodes: [
      {
        id: 'n_landing_2',
        type: 'landing-page',
        data: { slug: 'exec-offer-2', headline: 'Executive Brief', theme: 'clean-executive' }
      },
      {
        id: 'n_upsell_2',
        type: 'upsell',
        data: { slug: 'bold-addon-2', headline: 'Flash Bundle', offerType: 'upsell', theme: 'bold-commerce' }
      }
    ],
    edges: []
  });
  const pub2 = await invoke('POST', '/api/journey/:id/publish', { params: { id: 'j_override' } });
  assert.equal(pub2.statusCode, 200);
  assert.equal(publicPageCache['bold-addon-2'].data.theme, 'bold-commerce');

  // Case 3: Neither landing page nor upsell sets a theme -> no theme key injected and zero theme style block
  journeys.set('j_default', {
    id: 'j_default',
    name: 'Default Funnel',
    nodes: [
      { id: 'n_landing_3', type: 'landing-page', data: { slug: 'default-offer-3', headline: 'Core Offer' } },
      { id: 'n_upsell_3', type: 'upsell', data: { slug: 'default-addon-3', headline: 'Extra Offer', offerType: 'upsell' } }
    ],
    edges: []
  });
  const pub3 = await invoke('POST', '/api/journey/:id/publish', { params: { id: 'j_default' } });
  assert.equal(pub3.statusCode, 200);
  assert.equal(publicPageCache['default-addon-3'].data.theme, undefined);
});
