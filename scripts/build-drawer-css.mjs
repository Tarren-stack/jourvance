#!/usr/bin/env node
/**
 * Generates src/styles/drawerUtilities.css: the utility classes the Pre-Flight Audit and ROAS
 * Forecaster drawers are written in, scoped under `.jv-utility` so nothing else on the page
 * changes.
 *
 * Why this exists: both drawers were written with Tailwind-style class names, and Jourvance has
 * never had Tailwind (the rest of the app is inline styles), so both rendered as raw,
 * unpositioned text. Rewriting them inline would drop their hover, focus and two-column
 * responsive behaviour, and adding Tailwind is a new dependency that needs the owner's sign-off.
 * This script is ours: it knows only the class families below, and it FAILS on a class it does
 * not know, so a drawer edit that adds one is caught by `node --test drawer-utilities.test.mjs`
 * instead of shipping unstyled again.
 *
 *   node scripts/build-drawer-css.mjs          write the stylesheet
 *   node scripts/build-drawer-css.mjs --check  exit 1 when it is stale or a class is unknown
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DRAWER_FILES = [
  'src/components/drawers/PreFlightAuditDrawer.tsx',
  'src/components/drawers/FinancialSimulatorDrawer.tsx'
];
export const OUTPUT_FILE = 'src/styles/drawerUtilities.css';
export const SCOPE = 'jv-utility';

// A quoted literal that is the RESULT of `?`, `:` or `&&` inside a template's ${...}. Only
// results: a comparison operand such as `activePreset === 'aggressive'` is not a class, and the
// generator fails on classes it does not know.
const BRANCH_LITERAL = /(?:\?|:|&&)\s*(?:'([^']*)'|"([^"]*)")/g;

/** The classes in one template literal body: its static text plus each ${...} branch literal. */
function templateClasses(body) {
  const parts = [body.replace(/\$\{[^}]*\}/g, ' ')];
  for (const [, expr] of body.matchAll(/\$\{([^}]*)\}/g)) {
    for (const m of expr.matchAll(BRANCH_LITERAL)) parts.push(m[1] ?? m[2]);
  }
  return parts.join(' ');
}

/** Every class token inside className="..." or className={...} (quoted and template parts). */
export function classTokens(source) {
  const tokens = new Set();
  let i = 0;
  while ((i = source.indexOf('className=', i)) !== -1) {
    i += 'className='.length;
    if (source[i] === '"' || source[i] === "'") {
      const end = source.indexOf(source[i], i + 1);
      source.slice(i + 1, end).split(/\s+/).forEach(t => t && tokens.add(t));
      i = end + 1;
    } else if (source[i] === '{') {
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        if (source[j] === '{') depth++;
        else if (source[j] === '}' && --depth === 0) break;
      }
      const strings = source.slice(i + 1, j).match(/'[^']*'|"[^"]*"|`[^`]*`/g) || [];
      for (const s of strings) {
        const body = s.slice(1, -1);
        (s[0] === '`' ? templateClasses(body) : body).split(/\s+/).forEach(t => t && tokens.add(t));
      }
      i = j + 1;
    }
  }
  return tokens;
}

// The palette values the drawers use. They are the same hexes the rest of Jourvance writes inline.
const PALETTE = {
  black: '#000000',
  white: '#ffffff',
  slate: { 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#020617' },
  amber: { 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 800: '#92400e', 900: '#78350f', 950: '#451a03' },
  emerald: { 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 800: '#065f46', 950: '#022c22' },
  rose: { 400: '#fb7185', 500: '#f43f5e', 800: '#9f1239', 950: '#4c0519' },
  pink: { 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899' },
  purple: { 300: '#d8b4fe', 500: '#a855f7' },
  teal: { 300: '#5eead4', 400: '#2dd4bf' }
};

/** "slate-900/60" -> "rgb(15 23 42 / 0.6)"; null when it is not a palette color. */
function color(spec, alphaOverride) {
  const m = /^([a-z]+)(?:-(\d+))?(?:\/(\d+))?$/.exec(spec);
  if (!m) return null;
  const [, name, shade, alpha] = m;
  const family = PALETTE[name];
  const hex = typeof family === 'string' ? (shade ? null : family) : family?.[shade];
  if (!hex) return null;
  const [r, g, b] = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
  const a = alphaOverride ?? (alpha ? Number(alpha) / 100 : 1);
  return a === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`;
}

const space = n => (Number(n) === 0 ? '0' : `${Number(n) * 0.25}rem`);
const isNum = s => /^\d+(\.\d+)?$/.test(s);

const FIXED = {
  absolute: 'position: absolute', fixed: 'position: fixed', relative: 'position: relative',
  'inset-0': 'inset: 0', 'z-50': 'z-index: 50',
  flex: 'display: flex', grid: 'display: grid', hidden: 'display: none', block: 'display: block',
  'flex-col': 'flex-direction: column', 'flex-row': 'flex-direction: row', 'flex-wrap': 'flex-wrap: wrap',
  'flex-1': 'flex: 1 1 0%', 'shrink-0': 'flex-shrink: 0',
  'items-baseline': 'align-items: baseline', 'items-center': 'align-items: center', 'items-start': 'align-items: flex-start',
  'justify-between': 'justify-content: space-between', 'justify-center': 'justify-content: center',
  'justify-end': 'justify-content: flex-end', 'justify-start': 'justify-content: flex-start',
  'self-end': 'align-self: flex-end', 'self-center': 'align-self: center',
  'overflow-hidden': 'overflow: hidden', 'overflow-y-auto': 'overflow-y: auto',
  'h-full': 'height: 100%', 'w-full': 'width: 100%',
  'max-w-md': 'max-width: 28rem', 'max-w-2xl': 'max-width: 42rem', 'max-w-4xl': 'max-width: 56rem',
  'text-center': 'text-align: center', 'text-right': 'text-align: right', 'text-left': 'text-align: left',
  'text-xs': 'font-size: 0.75rem; line-height: 1rem', 'text-sm': 'font-size: 0.875rem; line-height: 1.25rem',
  'text-base': 'font-size: 1rem; line-height: 1.5rem', 'text-lg': 'font-size: 1.125rem; line-height: 1.75rem',
  'text-2xl': 'font-size: 1.5rem; line-height: 2rem',
  'font-medium': 'font-weight: 500', 'font-semibold': 'font-weight: 600', 'font-bold': 'font-weight: 700',
  'font-black': 'font-weight: 900', 'font-mono': "font-family: var(--font-mono, 'JetBrains Mono', monospace)",
  italic: 'font-style: italic', uppercase: 'text-transform: uppercase',
  underline: 'text-decoration-line: underline', 'underline-offset-2': 'text-underline-offset: 2px',
  'tracking-tight': 'letter-spacing: -0.025em', 'tracking-wider': 'letter-spacing: 0.05em',
  'leading-none': 'line-height: 1', 'leading-relaxed': 'line-height: 1.625',
  'opacity-75': 'opacity: 0.75',
  'cursor-help': 'cursor: help', 'cursor-pointer': 'cursor: pointer',
  'appearance-none': 'appearance: none',
  rounded: 'border-radius: 0.25rem', 'rounded-md': 'border-radius: 0.375rem', 'rounded-lg': 'border-radius: 0.5rem',
  'rounded-xl': 'border-radius: 0.75rem', 'rounded-2xl': 'border-radius: 1rem', 'rounded-full': 'border-radius: 9999px',
  border: 'border-width: 1px', 'border-t': 'border-top-width: 1px', 'border-b': 'border-bottom-width: 1px', 'border-l': 'border-left-width: 1px',
  'shadow-sm': 'box-shadow: 0 1px 2px 0 var(--jv-shadow-color, rgb(0 0 0 / 0.05))',
  'shadow-lg': 'box-shadow: 0 10px 15px -3px var(--jv-shadow-color, rgb(0 0 0 / 0.1)), 0 4px 6px -4px var(--jv-shadow-color, rgb(0 0 0 / 0.1))',
  'shadow-2xl': 'box-shadow: 0 25px 50px -12px var(--jv-shadow-color, rgb(0 0 0 / 0.25))',
  'shadow-inner': 'box-shadow: inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
  'backdrop-blur': 'backdrop-filter: blur(8px)', 'backdrop-blur-sm': 'backdrop-filter: blur(4px)',
  '-rotate-90': 'transform: rotate(-90deg)', 'scale-95': 'transform: scale(0.95)',
  transition: 'transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: var(--jv-duration, 150ms)',
  'transition-all': 'transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: var(--jv-duration, 150ms)',
  'transition-opacity': 'transition-property: opacity; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: var(--jv-duration, 150ms)',
  'ease-out': 'transition-timing-function: cubic-bezier(0, 0, 0.2, 1)',
  'animate-pulse': 'animation: jv-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  'animate-in': 'animation: jv-enter var(--jv-duration, 150ms) ease both',
  'fade-in': '--jv-enter-opacity: 0',
  'slide-in-from-right': '--jv-enter-x: 100%',
  'slide-in-from-bottom-2': '--jv-enter-y: 0.5rem',
  'outline-none': 'outline: 2px solid transparent; outline-offset: 2px',
  'ring-0': 'box-shadow: none',
  'ring-offset-0': '--jv-ring-offset: 0',
  'divide-y': null, 'divide-x': null, 'divide-y-0': null
};

// Declarations for one bare (unprefixed) utility, or null when it is not a class we know.
// Ordered layers keep gradients and borders right: a later layer wins at equal specificity.
function utility(cls) {
  if (cls in FIXED && FIXED[cls]) return { layer: 1, css: FIXED[cls] };
  let m;
  if ((m = /^(-?)(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|w|h)-(\d+(?:\.\d+)?)$/.exec(cls))) {
    const [, neg, kind, n] = m;
    const v = `${neg}${space(n)}`;
    const props = {
      p: ['padding'], px: ['padding-left', 'padding-right'], py: ['padding-top', 'padding-bottom'],
      pt: ['padding-top'], pb: ['padding-bottom'], pl: ['padding-left'], pr: ['padding-right'],
      m: ['margin'], mx: ['margin-left', 'margin-right'], my: ['margin-top', 'margin-bottom'],
      mt: ['margin-top'], mb: ['margin-bottom'], ml: ['margin-left'], mr: ['margin-right'],
      gap: ['gap'], w: ['width'], h: ['height']
    }[kind];
    return { layer: 1, css: props.map(p => `${p}: ${v}`).join('; ') };
  }
  if ((m = /^(bottom|right|top|left)-(\d+(?:\.\d+)?)$/.exec(cls))) return { layer: 1, css: `${m[1]}: ${space(m[2])}` };
  if ((m = /^space-y-(\d+(?:\.\d+)?)$/.exec(cls))) return { layer: 1, child: true, css: `margin-top: ${space(m[1])}` };
  if ((m = /^grid-cols-(\d+)$/.exec(cls))) return { layer: 1, css: `grid-template-columns: repeat(${m[1]}, minmax(0, 1fr))` };
  if ((m = /^col-span-(\d+)$/.exec(cls))) return { layer: 1, css: `grid-column: span ${m[1]} / span ${m[1]}` };
  if ((m = /^text-\[(\d+)px\]$/.exec(cls))) return { layer: 1, css: `font-size: ${m[1]}px` };
  if ((m = /^duration-(\d+)$/.exec(cls))) return { layer: 1, css: `transition-duration: ${m[1]}ms; --jv-duration: ${m[1]}ms` };
  if (cls === 'divide-y') return { layer: 1, child: true, css: 'border-top-width: 1px; border-bottom-width: 0' };
  if (cls === 'divide-x') return { layer: 1, child: true, css: 'border-left-width: 1px; border-right-width: 0' };
  if (cls === 'divide-y-0') return { layer: 1, child: true, css: 'border-top-width: 0; border-bottom-width: 0' };
  if ((m = /^bg-gradient-to-(r|br|tr)$/.exec(cls))) {
    const dir = { r: 'to right', br: 'to bottom right', tr: 'to top right' }[m[1]];
    return { layer: 1, css: `background-image: linear-gradient(${dir}, var(--jv-gradient-stops))` };
  }
  let c;
  if ((m = /^from-(.+)$/.exec(cls)) && (c = color(m[1]))) {
    return { layer: 2, css: `--jv-gradient-from: ${c}; --jv-gradient-to: ${color(m[1], 0)}; --jv-gradient-stops: var(--jv-gradient-from), var(--jv-gradient-to)` };
  }
  if ((m = /^via-(.+)$/.exec(cls)) && (c = color(m[1]))) {
    return { layer: 3, css: `--jv-gradient-to: ${color(m[1], 0)}; --jv-gradient-stops: var(--jv-gradient-from), ${c}, var(--jv-gradient-to)` };
  }
  if ((m = /^to-(.+)$/.exec(cls)) && (c = color(m[1]))) return { layer: 4, css: `--jv-gradient-to: ${c}` };
  if ((m = /^bg-(.+)$/.exec(cls)) && (c = color(m[1]))) return { layer: 1, css: `background-color: ${c}` };
  if ((m = /^text-(.+)$/.exec(cls)) && (c = color(m[1]))) return { layer: 1, css: `color: ${c}` };
  if ((m = /^border-(.+)$/.exec(cls)) && (c = color(m[1]))) return { layer: 2, css: `border-color: ${c}` };
  if ((m = /^divide-(.+)$/.exec(cls)) && (c = color(m[1]))) return { layer: 2, child: true, css: `border-color: ${c}` };
  if ((m = /^shadow-(.+)$/.exec(cls)) && (c = color(m[1]))) return { layer: 2, css: `--jv-shadow-color: ${c}` };
  if ((m = /^accent-(.+)$/.exec(cls)) && (c = color(m[1]))) return { layer: 1, css: `accent-color: ${c}` };
  if ((m = /^stroke-(.+)$/.exec(cls)) && (c = color(m[1]))) return { layer: 1, css: `stroke: ${c}` };
  return null;
}

const VARIANTS = {
  hover: { pseudo: ':hover' }, focus: { pseudo: ':focus' }, active: { pseudo: ':active' },
  sm: { media: '(min-width: 640px)' }, md: { media: '(min-width: 768px)' }
};

const escapeClass = cls => cls.replace(/([:/.[\]])/g, '\\$1');

/** Build the stylesheet for a set of class tokens. Unknown tokens are returned, never guessed. */
export function buildCss(tokens) {
  const rules = [];
  const unknown = [];
  for (const token of [...tokens].sort()) {
    const parts = token.split(':');
    const base = parts.pop();
    const variants = parts.map(v => VARIANTS[v]);
    const u = utility(base);
    if (!u || variants.some(v => !v)) {
      unknown.push(token);
      continue;
    }
    const pseudo = variants.map(v => v.pseudo || '').join('');
    const media = variants.find(v => v.media)?.media || null;
    const self = `.${escapeClass(token)}${pseudo}`;
    const target = u.child ? ' > :not([hidden]) ~ :not([hidden])' : '';
    const selector = `.${SCOPE} ${self}${target}, .${SCOPE}${self}${target}`;
    // Variant rules come after bare ones so hover and breakpoints win at equal specificity.
    const order = (media ? 20 : 0) + (pseudo ? 10 : 0) + u.layer;
    rules.push({ order, media, text: `${selector} { ${u.css}; }` });
  }
  rules.sort((a, b) => a.order - b.order);

  const out = [
    '/* GENERATED by scripts/build-drawer-css.mjs. Do not edit; edit the drawers and rerun it. */',
    '/* Utility classes for the Audit and ROAS Forecaster drawers, scoped under .jv-utility. */',
    '',
    '/* The resets these classes were written against, inside the drawers only. */',
    `.${SCOPE}, .${SCOPE} *, .${SCOPE} ::before, .${SCOPE} ::after { box-sizing: border-box; border-width: 0; border-style: solid; border-color: rgb(51 65 85); }`,
    `.${SCOPE} button, .${SCOPE} input, .${SCOPE} select, .${SCOPE} textarea { font: inherit; color: inherit; letter-spacing: inherit; margin: 0; }`,
    `.${SCOPE} button { background-color: transparent; background-image: none; cursor: pointer; }`,
    `.${SCOPE} button:disabled { cursor: default; }`,
    `.${SCOPE} h1, .${SCOPE} h2, .${SCOPE} h3, .${SCOPE} h4 { font-size: inherit; font-weight: inherit; }`,
    `.${SCOPE} ul, .${SCOPE} ol { list-style: none; }`,
    `.${SCOPE} svg { display: block; vertical-align: middle; flex-shrink: 0; }`,
    `.${SCOPE} input::placeholder { color: rgb(100 116 139); }`,
    // The keyboard focus ring wins over outline-none and focus:outline-none, which sit later and
    // match with more specificity: without !important a focused input in a drawer showed no ring.
    `.${SCOPE} :focus-visible { outline: 2px solid rgb(129 140 248) !important; outline-offset: 2px !important; }`,
    '',
    '@keyframes jv-pulse { 50% { opacity: 0.5; } }',
    '@keyframes jv-enter { from { opacity: var(--jv-enter-opacity, 1); transform: translate3d(var(--jv-enter-x, 0), var(--jv-enter-y, 0), 0); } }',
    '@media (prefers-reduced-motion: reduce) {',
    `  .${SCOPE}, .${SCOPE} * { animation: none !important; transition: none !important; }`,
    '}',
    ''
  ];
  let openMedia = null;
  for (const r of rules) {
    if (r.media !== openMedia) {
      if (openMedia) out.push('}');
      if (r.media) out.push(`@media ${r.media} {`);
      openMedia = r.media;
    }
    out.push(openMedia ? `  ${r.text}` : r.text);
  }
  if (openMedia) out.push('}');
  return { css: `${out.join('\n')}\n`, unknown };
}

export function generate() {
  const tokens = new Set();
  for (const f of DRAWER_FILES) for (const t of classTokens(fs.readFileSync(path.join(ROOT, f), 'utf8'))) tokens.add(t);
  tokens.delete(SCOPE);
  return buildCss(tokens);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { css, unknown } = generate();
  if (unknown.length) {
    console.error(`[drawer-css] Unknown classes, add them to scripts/build-drawer-css.mjs: ${unknown.join(' ')}`);
    process.exit(1);
  }
  const target = path.join(ROOT, OUTPUT_FILE);
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== css) {
      console.error(`[drawer-css] ${OUTPUT_FILE} is stale. Run: node scripts/build-drawer-css.mjs`);
      process.exit(1);
    }
    console.log(`[drawer-css] ${OUTPUT_FILE} is current.`);
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, css);
    console.log(`[drawer-css] Wrote ${OUTPUT_FILE} (${css.split('\n').length} lines).`);
  }
}
