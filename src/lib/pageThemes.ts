/**
 * Universal Published Page Themes for Jourvance.
 *
 * Implements 5 universal themes spanning all business categories (3 light + 2 dark):
 * 1. Clean Executive (Light mode: crisp slate-white, high-trust cobalt, enterprise typography)
 * 2. Bold Commerce (Dark mode: obsidian black, high-conversion amber/orange, high-contrast badges)
 * 3. Warm Editorial (Light mode: warm ivory linen, terracotta accent, Playfair Display serif)
 * 4. Creator Minimal (Light mode: pure minimal white, electric violet accent, distraction-free layout)
 * 5. Midnight Modern (Dark mode: midnight abyss, luminescent indigo-cyan glow, modern tech aesthetic)
 *
 * Erasable TypeScript only (no enum, namespace or parameter properties) so Node
 * tests can import this file directly.
 * Zero em dashes or spaced en dashes in this file.
 */

export const PAGE_THEME_IDS = [
  'clean-executive',
  'bold-commerce',
  'warm-editorial',
  'creator-minimal',
  'midnight-modern'
] as const;

export type PageThemeId = (typeof PAGE_THEME_IDS)[number];

export function isPageThemeId(val: unknown): val is PageThemeId {
  return typeof val === 'string' && (PAGE_THEME_IDS as readonly string[]).includes(val);
}

export interface PageThemeDefinition {
  id: PageThemeId;
  name: string;
  mode: 'light' | 'dark';
  industry: string;
  description: string;
  fontHeading: string;
  fontBody: string;
  googleFontsUrl: string;
  radiusBtn: string;
  radiusCard: string;
  btnGradient: string;
  topbarGradient: string;
  btnText: string;
  cssVariables: Record<string, string>;
}

export const PAGE_THEMES: Record<PageThemeId, PageThemeDefinition> = {
  'clean-executive': {
    id: 'clean-executive',
    name: 'Clean Executive',
    mode: 'light',
    industry: 'B2B, Agencies & Consulting',
    description: 'Crisp slate-white surface, high-trust cobalt, clean enterprise typography',
    fontHeading: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontBody: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap',
    radiusBtn: '8px',
    radiusCard: '12px',
    btnGradient: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
    topbarGradient: 'linear-gradient(90deg, #1E3A8A 0%, #2563EB 50%, #0369A1 100%)',
    btnText: '#FFFFFF',
    cssVariables: {
      '--bg': '#F8FAFC',
      '--card-bg': '#FFFFFF',
      '--surface-tint': 'rgba(37, 99, 235, 0.08)',
      '--border': 'rgba(15, 23, 42, 0.14)',
      '--text': '#0F172A',
      '--text-muted': '#475569',
      '--primary': '#2563EB',
      '--primary-glow': 'rgba(37, 99, 235, 0.22)',
      '--secondary': '#0369A1',
      '--btn-gradient': 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
      '--topbar-gradient': 'linear-gradient(90deg, #1E3A8A 0%, #2563EB 50%, #0369A1 100%)',
      '--radius-btn': '8px',
      '--radius-card': '12px',
      '--font-heading': "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      '--font-body': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      '--btn-text': '#FFFFFF',
      '--pink': '#2563EB',
      '--pink-glow': 'rgba(37, 99, 235, 0.22)',
      '--emerald': '#0369A1'
    }
  },
  'bold-commerce': {
    id: 'bold-commerce',
    name: 'Bold Commerce',
    mode: 'dark',
    industry: 'E-Commerce & Physical Retail',
    description: 'High-conversion amber/orange, obsidian black, high-contrast badges',
    fontHeading: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontBody: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
    radiusBtn: '12px',
    radiusCard: '16px',
    btnGradient: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
    topbarGradient: 'linear-gradient(90deg, #D97706 0%, #F59E0B 50%, #EA580C 100%)',
    btnText: '#0A0A0A',
    cssVariables: {
      '--bg': '#0A0A0A',
      '--card-bg': 'rgba(23, 23, 23, 0.88)',
      '--surface-tint': 'rgba(245, 158, 11, 0.12)',
      '--border': 'rgba(255, 255, 255, 0.12)',
      '--text': '#FFFFFF',
      '--text-muted': '#A3A3A3',
      '--primary': '#F59E0B',
      '--primary-glow': 'rgba(245, 158, 11, 0.35)',
      '--secondary': '#10B981',
      '--btn-gradient': 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
      '--topbar-gradient': 'linear-gradient(90deg, #D97706 0%, #F59E0B 50%, #EA580C 100%)',
      '--radius-btn': '12px',
      '--radius-card': '16px',
      '--font-heading': "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      '--font-body': "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      '--btn-text': '#0A0A0A',
      '--pink': '#F59E0B',
      '--pink-glow': 'rgba(245, 158, 11, 0.35)',
      '--emerald': '#10B981'
    }
  },
  'warm-editorial': {
    id: 'warm-editorial',
    name: 'Warm Editorial',
    mode: 'light',
    industry: 'Local & Client Services',
    description: 'Warm ivory linen surface, terracotta accent, Playfair Display serif',
    fontHeading: "'Playfair Display', Georgia, serif",
    fontBody: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
    radiusBtn: '16px',
    radiusCard: '20px',
    btnGradient: 'linear-gradient(135deg, #C2410C 0%, #B45309 100%)',
    topbarGradient: 'linear-gradient(90deg, #78350F 0%, #C2410C 50%, #B45309 100%)',
    btnText: '#FFFFFF',
    cssVariables: {
      '--bg': '#FAF7F2',
      '--card-bg': '#FFFFFF',
      '--surface-tint': 'rgba(194, 65, 12, 0.08)',
      '--border': 'rgba(120, 53, 15, 0.16)',
      '--text': '#1C1917',
      '--text-muted': '#57534E',
      '--primary': '#C2410C',
      '--primary-glow': 'rgba(194, 65, 12, 0.22)',
      '--secondary': '#047857',
      '--btn-gradient': 'linear-gradient(135deg, #C2410C 0%, #B45309 100%)',
      '--topbar-gradient': 'linear-gradient(90deg, #78350F 0%, #C2410C 50%, #B45309 100%)',
      '--radius-btn': '16px',
      '--radius-card': '20px',
      '--font-heading': "'Playfair Display', Georgia, serif",
      '--font-body': "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      '--btn-text': '#FFFFFF',
      '--pink': '#C2410C',
      '--pink-glow': 'rgba(194, 65, 12, 0.22)',
      '--emerald': '#047857'
    }
  },
  'creator-minimal': {
    id: 'creator-minimal',
    name: 'Creator Minimal',
    mode: 'light',
    industry: 'Digital Products, Courses & Creators',
    description: 'Pure minimal white surface, electric violet accent, distraction-free layout',
    fontHeading: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontBody: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap',
    radiusBtn: '10px',
    radiusCard: '14px',
    btnGradient: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
    topbarGradient: 'linear-gradient(90deg, #5B21B6 0%, #6D28D9 50%, #0E7490 100%)',
    btnText: '#FFFFFF',
    cssVariables: {
      '--bg': '#FFFFFF',
      '--card-bg': '#F4F4F5',
      '--surface-tint': 'rgba(109, 40, 217, 0.08)',
      '--border': 'rgba(24, 24, 27, 0.14)',
      '--text': '#18181B',
      '--text-muted': '#52525B',
      '--primary': '#6D28D9',
      '--primary-glow': 'rgba(109, 40, 217, 0.22)',
      '--secondary': '#0E7490',
      '--btn-gradient': 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
      '--topbar-gradient': 'linear-gradient(90deg, #5B21B6 0%, #6D28D9 50%, #0E7490 100%)',
      '--radius-btn': '10px',
      '--radius-card': '14px',
      '--font-heading': "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      '--font-body': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      '--btn-text': '#FFFFFF',
      '--pink': '#6D28D9',
      '--pink-glow': 'rgba(109, 40, 217, 0.22)',
      '--emerald': '#0E7490'
    }
  },
  'midnight-modern': {
    id: 'midnight-modern',
    name: 'Midnight Modern',
    mode: 'dark',
    industry: 'SaaS, Tech & Events',
    description: 'Midnight abyss, luminescent indigo-cyan glow, modern tech aesthetic',
    fontHeading: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontBody: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap',
    radiusBtn: '14px',
    radiusCard: '18px',
    btnGradient: 'linear-gradient(135deg, #4F46E5 0%, #4338CA 100%)',
    topbarGradient: 'linear-gradient(90deg, #4338CA 0%, #6366F1 50%, #06B6D4 100%)',
    btnText: '#FFFFFF',
    cssVariables: {
      '--bg': '#030712',
      '--card-bg': 'rgba(17, 24, 39, 0.85)',
      '--surface-tint': 'rgba(99, 102, 241, 0.14)',
      '--border': 'rgba(99, 102, 241, 0.25)',
      '--text': '#F9FAFB',
      '--text-muted': '#9CA3AF',
      '--primary': '#6366F1',
      '--primary-glow': 'rgba(99, 102, 241, 0.45)',
      '--secondary': '#06B6D4',
      '--btn-gradient': 'linear-gradient(135deg, #4F46E5 0%, #4338CA 100%)',
      '--topbar-gradient': 'linear-gradient(90deg, #4338CA 0%, #6366F1 50%, #06B6D4 100%)',
      '--radius-btn': '14px',
      '--radius-card': '18px',
      '--font-heading': "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      '--font-body': "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      '--btn-text': '#FFFFFF',
      '--pink': '#6366F1',
      '--pink-glow': 'rgba(99, 102, 241, 0.45)',
      '--emerald': '#06B6D4'
    }
  }
};

export function getPageTheme(themeId: string | undefined | null): PageThemeDefinition | null {
  if (!themeId || !isPageThemeId(themeId)) return null;
  return PAGE_THEMES[themeId] ?? null;
}

export function getThemeCssVariables(themeId: string | undefined | null): Record<string, string> {
  const theme = getPageTheme(themeId);
  return theme ? { ...theme.cssVariables } : {};
}

export function renderThemeStyleBlock(
  themeId: string | undefined | null,
  pageType?: 'landing' | 'thank-you' | 'upsell' | 'downsell' | 'all'
): string {
  const theme = getPageTheme(themeId);
  if (!theme) return '';

  const vars = Object.entries(theme.cssVariables)
    .map(([k, v]) => `    ${k}: ${v};`)
    .join('\n');

  const fontLink = theme.googleFontsUrl
    ? `  <link rel="stylesheet" href="${theme.googleFontsUrl}">\n`
    : '';

  const scope = pageType || 'all';
  const cardShadow = theme.mode === 'light'
    ? 'box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08) !important;'
    : '';
  const rules: string[] = [];

  // Root CSS variables and browser color-scheme hint
  rules.push(`    :root {\n    color-scheme: ${theme.mode};\n${vars}\n    }`);

  // Base typography, header controls, and background across light and dark modes
  rules.push(
    `    body { background-color: var(--bg) !important; background-image: radial-gradient(circle at 50% 0%, var(--surface-tint), transparent 55%) !important; color: var(--text) !important; font-family: var(--font-body) !important; }`,
    `    h1, h2, h3, .brand { font-family: var(--font-heading) !important; color: var(--text) !important; }`,
    `    .secure-pill { color: var(--secondary) !important; border-color: var(--border) !important; background: var(--surface-tint) !important; }`,
    `    .currency-select { background: var(--card-bg) !important; border-color: var(--border) !important; color: var(--text) !important; }`,
    `    .currency-select:hover, .currency-select:focus { border-color: var(--primary) !important; color: var(--text) !important; }`,
    `    .currency-select-wrap::after { color: var(--text-muted) !important; }`,
    `    .currency-select option { background: var(--bg) !important; color: var(--text) !important; }`
  );

  // Landing page specific rules
  if (scope === 'landing' || scope === 'all') {
    rules.push(
      `    .top-bar { background: var(--topbar-gradient) !important; }`,
      `    .offer-card { background: var(--card-bg) !important; border-color: var(--border) !important; border-radius: var(--radius-card) !important; ${cardShadow} }`,
      `    .cta-btn { background: var(--btn-gradient) !important; border-radius: var(--radius-btn) !important; color: var(--btn-text) !important; box-shadow: 0 8px 24px var(--primary-glow) !important; }`,
      `    .cta-btn:hover { box-shadow: 0 12px 30px var(--primary-glow) !important; }`,
      `    .eyebrow, .scarcity-badge { color: var(--primary) !important; background: var(--surface-tint) !important; border-color: var(--border) !important; }`,
      `    .scarcity-pulse, .reservation-dot { background: var(--primary) !important; box-shadow: 0 0 8px var(--primary-glow) !important; }`,
      `    .reservation-bar { background: var(--surface-tint) !important; border-bottom-color: var(--border) !important; color: var(--text) !important; }`,
      `    .reservation-label { color: var(--text) !important; }`,
      `    .reservation-countdown { color: var(--primary) !important; background: var(--card-bg) !important; border-color: var(--border) !important; }`,
      `    .subhead, .trust-box, .guarantee-note, .bump-desc, #lead-modal p { color: var(--text-muted) !important; }`,
      `    .bullet, .bump-title, .bump-product-title, #lead-modal-title { color: var(--text) !important; }`,
      `    .check { color: var(--secondary) !important; }`,
      `    .price-tag { background: var(--card-bg) !important; color: var(--secondary) !important; border-color: var(--secondary) !important; }`,
      `    .order-bump-card { background: var(--surface-tint) !important; border-color: var(--primary) !important; }`,
      `    .order-bump-card.checked { border-color: var(--primary) !important; box-shadow: 0 0 16px var(--primary-glow) !important; }`,
      `    .bump-checkbox { accent-color: var(--primary) !important; }`,
      `    .bump-badge { color: var(--primary) !important; background: var(--surface-tint) !important; }`,
      `    .bump-body { border-top-color: var(--border) !important; }`,
      `    .bump-product-price { color: var(--secondary) !important; background: var(--surface-tint) !important; }`,
      `    .modal-card { border-radius: var(--radius-card) !important; border-color: var(--border) !important; background: var(--card-bg) !important; color: var(--text) !important; ${cardShadow} }`,
      `    .modal-close { color: var(--text-muted) !important; }`,
      `    .input-field { background: var(--bg) !important; border-color: var(--border) !important; color: var(--text) !important; }`,
      `    .input-field:focus { border-color: var(--primary) !important; box-shadow: 0 0 0 2px var(--primary-glow) !important; }`,
      `    #jv-chat-concierge-btn { border-radius: var(--radius-btn) !important; color: var(--secondary) !important; border-color: var(--border) !important; background: var(--surface-tint) !important; }`
    );
  }

  // Thank-you page specific rules
  if (scope === 'thank-you' || scope === 'all') {
    rules.push(
      `    .card { background: var(--card-bg) !important; border-color: var(--border) !important; border-radius: var(--radius-card) !important; ${cardShadow} }`,
      `    .subhead { color: var(--text-muted) !important; }`,
      `    .check-icon { border-color: var(--secondary) !important; color: var(--secondary) !important; background: var(--surface-tint) !important; box-shadow: 0 0 30px var(--primary-glow) !important; }`,
      `    .vip-pill, .step-num { color: var(--primary) !important; border-color: var(--border) !important; background: var(--surface-tint) !important; }`,
      `    .ritual-step { border-bottom-color: var(--border) !important; }`,
      `    .card h3, .ritual-step > div:last-child, .voucher-card > div:nth-child(2), .code-text { color: var(--text) !important; }`,
      `    .voucher-card > div:first-child { color: var(--primary) !important; }`,
      `    .voucher-card { background: var(--surface-tint) !important; border-color: var(--primary) !important; }`,
      `    .voucher-code-wrap { background: var(--bg) !important; border-color: var(--border) !important; }`,
      `    .copy-btn { background: var(--btn-gradient) !important; color: var(--btn-text) !important; border-color: transparent !important; border-radius: var(--radius-btn) !important; }`,
      `    .btn-primary { background: var(--btn-gradient) !important; color: var(--btn-text) !important; border-radius: var(--radius-btn) !important; box-shadow: 0 10px 25px var(--primary-glow) !important; }`,
      `    .btn-secondary { background: var(--card-bg) !important; border-color: var(--border) !important; color: var(--text) !important; border-radius: var(--radius-btn) !important; }`
    );
  }

  // Upsell & Downsell page specific rules
  if (scope === 'upsell' || scope === 'downsell' || scope === 'all') {
    rules.push(
      `    .card { background: var(--card-bg) !important; border-color: var(--border) !important; border-radius: var(--radius-card) !important; ${cardShadow} }`,
      `    .badge-pill { color: var(--primary) !important; background: var(--surface-tint) !important; border-color: var(--border) !important; }`,
      `    p.subhead, .decline-link { color: var(--text-muted) !important; }`,
      `    .decline-link:hover { color: var(--text) !important; }`,
      `    .product-box { background: var(--surface-tint) !important; border-color: var(--border) !important; border-radius: calc(var(--radius-card) - 4px) !important; }`,
      `    .product-title, .benefit-item { color: var(--text) !important; }`,
      `    .price-special { color: var(--secondary) !important; }`,
      `    .benefit-icon { background: var(--surface-tint) !important; color: var(--secondary) !important; }`,
      `    .btn-accept { background: var(--btn-gradient) !important; color: var(--btn-text) !important; border-radius: var(--radius-btn) !important; box-shadow: 0 10px 25px var(--primary-glow) !important; }`,
      `    .recovery-banner { background: var(--surface-tint) !important; border-color: var(--border) !important; color: var(--secondary) !important; }`
    );
  }

  return `${fontLink}  <style id="jv-page-theme">\n${rules.join('\n')}\n  </style>\n`;
}

export const renderThemeHeadAssets = renderThemeStyleBlock;
