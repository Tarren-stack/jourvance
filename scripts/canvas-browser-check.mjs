#!/usr/bin/env node
// The journey map browser check (#11): npm run check:canvas.
//
// What it checks, on /canvas with the default journey, in real Chrome at 1440x900, 768x1024 and
// 390x844:
//   overflow  no page scroll, no control that cannot be reached, no box that hides text or a
//             control past its edge (content-clipped)
//   drawers   the two utility-class drawers (Audit and ROAS Forecaster) are really styled: a
//             fixed backdrop that dims, an opaque full-height panel on the right, a loaded
//             .jv-utility stylesheet, and a header button that closes them
//   save      a signed-in save that fails reads "Not saved", never "Saved", says why in the
//             banner, offers a Try again that really retries, and keeps the edit in this browser;
//             a signed-out save this browser refuses says what browserSaveOutcome says for that
//             refusal (out of space with Open journeys, or would not store), offers no Try again,
//             and keeps the leave warning
//   a11y      23 hand-written WCAG A and AA rules named after axe's rules (they are not axe), plus
//             #19's keyboard and screen reader checks from scripts/a11y-browser-check.mjs (spoken
//             step names, lines in words, dialog round trips, focus rings, the 11px floor, tied
//             labels, aria-pressed, reduced motion, clean saved data), each a zero-only rule
//             a11y-<check>, beside this harness's own C05 keyboard move and C01 blueprint layout
//             (every shipped blueprint opened with no card over a handle or another card). They
//             run at their own widths, so a run with --viewports skips them.
//   runtime   no uncaught page error
//
// Why: every P0 item passed a type check and would have failed this. A type check cannot see a
// clipped Save button, an unstyled drawer or a failed save that says "Saved".
//
// The browser only collects facts. Every judgement is a pure function in src/lib/a11yRules.ts or
// src/lib/canvasCheckRules.ts, with node tests. Before any scenario counts, planted positive and
// negative controls prove each rule still fires; if one does not, the run exits 2.
//
// Known debt is held by scripts/canvas-browser-check.baseline.json, a hand-edited ratchet:
//   { "<rule>": { "count": 11, "owner": "#19 Accessibility pass" } }
// A count above its entry fails, and a count below fails with "lower the baseline", so a fix can
// never be undone quietly. Zero-only rules (page-scroll, control-off-screen, drawer-*, save-* and
// page-error) can never be baselined. There is no baseline writer: when counts change, the run
// prints them and a person edits the file.
//
// Usage: npm run check:canvas -- [--only overflow,drawers,save,a11y] [--viewports 1440,768,390]
//        [--shots <dir>]
// Exit 0 pass, 1 findings, 2 could not run or cannot be trusted (Playwright or Chrome missing, the
// build failed, the port could not be bound, a control did not fire, a requested section did not
// run).
//
// Safety: it never reads .env (Vite's envDir is an empty temp dir, because .env holds a live hub
// key), never starts server.mjs or any other process, and sets preview.proxy to {} so the preview
// forwards nothing to localhost:3005. A route guard aborts every request that is not the preview
// origin, plus /api/ and /p/ on it, and counts what it blocked. It builds into a temp dir, removes
// it afterwards, and writes nothing inside the repo. Screenshots go only to --shots.
//
// Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), CHROME_PATH, CHECK_CANVAS_PORT (a fixed
// preview port; by default a free one is found).

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, preview } from 'vite';
import {
  A11Y_DOCUMENT_RULES,
  A11Y_NEGATIVE_CONTROL,
  A11Y_POSITIVE_CONTROL,
  A11Y_RULES,
  A11Y_TABLES,
  judgeA11y
} from '../src/lib/a11yRules.ts';
import {
  CHECK_RULES,
  CHECK_SECTIONS,
  CHECK_VIEWPORTS,
  LAYOUT_NEGATIVE_CONTROL,
  LAYOUT_POSITIVE_CONTROL,
  ZERO_ONLY_RULES,
  countByRule,
  dedupeFindings,
  drawerProblems,
  exitCode,
  findingKey,
  firebaseApiKeyFrom,
  formatReport,
  layoutProblems,
  pageErrorProblems,
  ratchetVerdict,
  routeVerdict,
  isSavedClaim,
  saveProblems,
  signedInUserFixture
} from '../src/lib/canvasCheckRules.ts';
import { BROWSER_OUT_OF_SPACE, browserSaveOutcome, saveOutcome } from '../src/lib/saveOutcome.ts';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from '../src/lib/defaultBlueprint.ts';
import { ECOM_BLUEPRINTS } from '../src/data/ecomBlueprints.ts';
import { zeroBlueprintMetrics } from '../src/lib/liveStats.ts';
import { repairEdgeHandles } from '../src/lib/stepHandles.ts';
import { CHECKS as KEYBOARD_CHECKS, runA11yChecks } from './a11y-browser-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'canvas-browser-check.baseline.json');
const STORAGE_KEY = 'jourvance_active_project';
const SAVE_POST = /^\/api\/user\/[^/]+\/journey\//;
const EXPECTED_NAME = 'Browser check journey';
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ---- The collector: runs in the page, closes over nothing, returns plain facts ----

function collectFacts({ tables, want }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cs = el => getComputedStyle(el);
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const isVisible = (el, opacity = false) =>
    typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true, opacityProperty: opacity }) : true;
  const hiddenFromAT = el => !!el.closest('[aria-hidden="true"], [inert]');
  // Screen-reader-only text (.jv-sr-only: a 1px box clipped to nothing) is drawn nowhere on
  // purpose, so it hides no text from anyone who sees the page.
  const srOnly = el => {
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return r.width <= 1 && r.height <= 1 && (/^rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)$/.test(c.clip) || c.clipPath === 'inset(50%)');
  };
  const isSvg = el => el instanceof SVGElement;
  const alphaOf = color => {
    const s = String(color || '').trim();
    if (s === 'transparent') return 0;
    const m = /^rgba?\(([^)]*)\)$/.exec(s);
    if (!m) return 1;
    const body = m[1];
    const raw = body.includes('/') ? body.split('/')[1] : body.split(',')[3];
    if (raw === undefined) return 1;
    const t = raw.trim();
    const n = t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t);
    return Number.isFinite(n) ? n : 1;
  };

  // -- Roles and names --
  const implicitRole = el => {
    const tag = el.tagName.toLowerCase();
    const map = tables.implicitRoleByTag;
    if (tag === 'a') return el.hasAttribute('href') ? map['a[href]'] : map.a;
    if (tag === 'input') return map[`input[${(el.getAttribute('type') || 'text').toLowerCase()}]`] || map.input;
    return map[tag] || 'generic';
  };
  const roleOf = el => {
    const r = (el.getAttribute('role') || '').trim().split(/\s+/)[0].toLowerCase();
    return r || implicitRole(el);
  };
  const textOf = node => {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out += child.textContent;
        continue;
      }
      if (child.nodeType !== 1) continue;
      if (child.getAttribute('aria-hidden') === 'true' || !isVisible(child)) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'img') {
        out += ` ${child.getAttribute('alt') || ''} `;
        continue;
      }
      const label = child.getAttribute('aria-label');
      if (label && label.trim()) {
        out += ` ${label} `;
        continue;
      }
      if (tag === 'svg') {
        const title = child.querySelector('title');
        if (title) out += ` ${title.textContent} `;
        continue;
      }
      if (tag === 'script' || tag === 'style') continue;
      out += ` ${textOf(child)} `;
    }
    return out;
  };
  const labelledbyText = el => {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return clean(ids.map(id => document.getElementById(id)).filter(Boolean).map(n => n.getAttribute('aria-label') || textOf(n)).join(' '));
  };
  const labelsText = el => (el.labels ? clean([...el.labels].map(textOf).join(' ')) : '');
  const focusable = el => {
    if (el.disabled) return false;
    if (el.hasAttribute('tabindex')) return el.tabIndex >= 0;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' || tag === 'area') return el.hasAttribute('href');
    if (tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'summary') return true;
    if (tag === 'input') return (el.getAttribute('type') || '').toLowerCase() !== 'hidden';
    return el.isContentEditable === true;
  };
  const WIDGET_ROLES = ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton', 'textbox', 'combobox', 'searchbox'];
  const isControl = el => focusable(el) || WIDGET_ROLES.includes((el.getAttribute('role') || '').toLowerCase());

  // -- Where: 'tag[role or type] "name" #n in <region>' --
  const described = new Set();
  const headingCache = new Map();
  // A heading names an ancestor only when it is not shut inside a smaller box of its own (a
  // panel or dialog beside the element). Otherwise opening the step panel would rename every
  // element in the app shell after the panel's heading, and one element would count as several.
  const BOXES = '[role="dialog"], [role="region"], aside, section, .jv-utility, .react-flow__node, [role="menu"], [role="alert"], header';
  const headingOf = a => {
    if (headingCache.has(a)) return headingCache.get(a);
    let text = null;
    for (const h of a.querySelectorAll('h2, h3')) {
      const box = h.closest(BOXES);
      if (box && box !== a && a.contains(box)) continue;
      text = clean(h.textContent).slice(0, 60) || null;
      if (text) break;
    }
    headingCache.set(a, text);
    return text;
  };
  const regionOf = el => {
    const control = el.closest('[data-control]');
    if (control) return `control ${control.getAttribute('data-control')}`;
    const drawer = el.closest('.jv-utility');
    if (drawer) return `"${clean(drawer.querySelector('h2')?.textContent).slice(0, 60)}" drawer`;
    if (el.closest('[role="alert"]')) return 'alert banner';
    const menu = el.closest('[role="menu"]');
    if (menu) return `"${clean(menu.getAttribute('aria-label')) || 'unnamed'}" menu`;
    if (el.closest('[role="toolbar"]')) return 'journey toolbar';
    if (el.closest('header')) return 'app bar';
    const node = el.closest('.react-flow__node');
    if (node) return `step ${node.getAttribute('data-id')}`;
    const line = el.closest('[data-edge-id]');
    if (line) return `line ${line.getAttribute('data-edge-id')}`;
    if (el.closest('[data-jv-edge-label], .react-flow__edges')) return 'map lines';
    if (el.closest('.react-flow__panel, .react-flow__minimap, .react-flow__attribution')) return 'map controls';
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const h = headingOf(a);
      if (h) return `"${h}" section`;
    }
    return 'page';
  };
  const baseOf = el => {
    const tag = el.tagName.toLowerCase();
    const kind = el.getAttribute('role') || (tag === 'input' ? el.getAttribute('type') || 'text' : '');
    const name = clean(el.getAttribute('aria-label') || labelledbyText(el) || labelsText(el) || (tag === 'input' || tag === 'select' || tag === 'textarea' ? '' : textOf(el)) || el.getAttribute('title') || '').slice(0, 40);
    return `${tag}${kind ? `[${kind}]` : ''}${name ? ` "${name}"` : ''}`;
  };
  const ref = el => {
    described.add(el);
    return el;
  };

  const all = [...document.body.querySelectorAll('*')];
  const out = {};

  // -- Accessibility facts --
  if (want.a11y) {
    const names = [];
    const aria = [];
    const structure = [];
    const lists = [];
    const targets = [];
    const scrollRegions = [];
    const texts = [];
    const roleKind = role => {
      if (['button', 'link', 'menuitem'].includes(role)) return 'command';
      if (['checkbox', 'switch', 'radio', 'menuitemcheckbox', 'menuitemradio', 'option'].includes(role)) return 'toggle';
      if (['combobox', 'listbox', 'searchbox', 'slider', 'spinbutton', 'textbox'].includes(role)) return 'input-field';
      return null;
    };
    const nameKind = el => {
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute('role') || '').trim().toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(type))) return 'button';
      if ((tag === 'input' && type !== 'hidden') || tag === 'select' || tag === 'textarea') return 'label';
      if (tag === 'img') return role === 'none' || role === 'presentation' ? null : 'image';
      if (tag === 'a' && el.hasAttribute('href') && (!role || role === 'link')) return 'link';
      return roleKind(role);
    };
    const nativeName = el => {
      const tag = el.tagName.toLowerCase();
      if (tag !== 'input') return null;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'image') return el.getAttribute('alt');
      if (type === 'submit') return el.getAttribute('value') ?? 'Submit';
      if (type === 'reset') return el.getAttribute('value') ?? 'Reset';
      if (type === 'button') return el.getAttribute('value');
      return null;
    };
    const idrefAttrs = Object.keys(tables.ariaAttributes).filter(n => /^idref/.test(tables.ariaAttributes[n]));

    for (const el of all) {
      if (!isVisible(el)) continue;
      const atHidden = hiddenFromAT(el);
      const tag = el.tagName.toLowerCase();
      const explicitRole = (el.getAttribute('role') || '').trim().split(/\s+/)[0].toLowerCase();
      const role = roleOf(el);

      // Structure: aria-hidden focus and nested controls are read even under aria-hidden.
      const isFocusable = focusable(el);
      const hiddenFocus = isFocusable && !!el.closest('[aria-hidden="true"]') && !el.closest('[inert]');
      let nested = false;
      if (isFocusable && !atHidden) {
        for (let a = el.parentElement; a; a = a.parentElement) {
          if (tables.childrenPresentationalRoles.includes(roleOf(a))) {
            nested = true;
            break;
          }
        }
      }
      const needsChildren = !atHidden && explicitRole && tables.requiredChildren[explicitRole];
      const needsContext = !atHidden && explicitRole && tables.requiredContext[explicitRole];
      if (hiddenFocus || nested || needsChildren || needsContext) {
        let ownedRoles = null;
        if (needsChildren) {
          ownedRoles = [];
          const walk = node => {
            for (const c of node.children) {
              const r = roleOf(c);
              if (tables.genericRoles.includes(r)) walk(c);
              else ownedRoles.push(r);
            }
          };
          walk(el);
        }
        let contextRole = null;
        if (needsContext) {
          for (let a = el.parentElement; a; a = a.parentElement) {
            const r = roleOf(a);
            if (!tables.genericRoles.includes(r)) {
              contextRole = r;
              break;
            }
          }
        }
        structure.push({ where: ref(el), role, explicit: !!explicitRole, ownedRoles, contextRole, ariaHiddenFocusable: hiddenFocus, interactiveAncestor: nested });
      }
      if (atHidden) continue;

      const kind = nameKind(el);
      if (kind) {
        names.push({
          where: ref(el),
          kind,
          labelledby: labelledbyText(el),
          ariaLabel: el.getAttribute('aria-label'),
          labels: kind === 'label' ? labelsText(el) : '',
          native: nativeName(el),
          content: kind === 'label' || kind === 'image' || kind === 'input-field' ? '' : clean(textOf(el)),
          title: el.getAttribute('title'),
          placeholder: el.getAttribute('placeholder'),
          altAttr: tag === 'img' ? el.getAttribute('alt') : null
        });
      }

      const attrs = [...el.attributes].filter(a => a.name.startsWith('aria-')).map(a => ({ name: a.name, value: a.value }));
      if (attrs.length) {
        const missingIds = [];
        for (const a of attrs) {
          if (!idrefAttrs.includes(a.name)) continue;
          if (a.name === 'aria-controls' && el.getAttribute('aria-expanded') === 'false') continue;
          const ids = a.value.split(/\s+/).filter(Boolean);
          if (ids.length && !ids.some(id => document.getElementById(id))) missingIds.push(a.name);
        }
        aria.push({ where: ref(el), tag, role, attrs, missingIds });
      }

      if ((tag === 'ul' || tag === 'ol') && !el.hasAttribute('role')) {
        const badChildren = [...el.children].map(c => c.tagName.toLowerCase()).filter(t => !['li', 'script', 'template'].includes(t));
        lists.push({ where: ref(el), tag, badChildren, parentOk: true });
      } else if (tag === 'li' && !el.hasAttribute('role')) {
        const p = el.parentElement;
        const ptag = p ? p.tagName.toLowerCase() : '';
        const parentOk = !!p && ((['ul', 'ol', 'menu'].includes(ptag) && !p.hasAttribute('role')) || roleOf(p) === 'list');
        lists.push({ where: ref(el), tag, badChildren: [], parentOk });
      }

      // Left out of target-size: an SVG line (its bounding box is not its hit area), anything on
      // the pannable map (its size on screen is the zoom the person chose), and a target covered
      // by something else, such as the app bar under an open drawer (nobody can press it).
      if (isControl(el) && !isSvg(el) && !el.closest('.react-flow__viewport')) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const onScreen = cx >= 0 && cy >= 0 && cx < vw && cy < vh;
        const top = onScreen ? document.elementFromPoint(cx, cy) : null;
        const covered = onScreen && !!top && top !== el && !el.contains(top);
        if (r.width > 0 && r.height > 0 && !covered) {
          const s = cs(el);
          const inline = tag === 'a' && s.display === 'inline' && !!el.parentElement && clean(el.parentElement.textContent).length > clean(el.textContent).length;
          targets.push({ where: ref(el), x: r.left, y: r.top, w: r.width, h: r.height, inline });
        }
      }

      if (el !== document.body && !isSvg(el)) {
        const s = cs(el);
        const scrollsY = ['auto', 'scroll'].includes(s.overflowY) && el.scrollHeight > el.clientHeight + 1;
        const scrollsX = ['auto', 'scroll'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
        if (scrollsX || scrollsY) {
          scrollRegions.push({
            where: ref(el),
            focusable: el.hasAttribute('tabindex') ? el.tabIndex >= 0 : focusable(el),
            hasFocusableDescendant: [...el.querySelectorAll('*')].some(focusable)
          });
        }
      }
    }

    // Contrast: one sample per element that holds text, with its ancestor backgrounds.
    const sampled = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!clean(node.textContent)) continue;
      const el = node.parentElement;
      if (!el || sampled.has(el) || isSvg(el)) continue;
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'title', 'option', 'template'].includes(tag)) continue;
      if (!isVisible(el) || el.closest('button:disabled, [aria-disabled="true"], input:disabled')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      sampled.add(el);
      const layers = [];
      let blockedBy = null;
      let opaque = false;
      for (let a = el; a; a = a.parentElement) {
        const s = cs(a);
        if (!opaque) {
          if (s.backgroundImage && s.backgroundImage !== 'none') blockedBy = blockedBy || (/gradient\(/.test(s.backgroundImage) ? 'gradient' : 'background-image');
          if (s.mixBlendMode && s.mixBlendMode !== 'normal') blockedBy = blockedBy || 'mix-blend-mode';
          if (s.backdropFilter && s.backdropFilter !== 'none' && alphaOf(s.backgroundColor) < 1) blockedBy = blockedBy || 'backdrop-filter';
        }
        if (parseFloat(s.opacity) < 1) blockedBy = blockedBy || 'opacity';
        layers.push(s.backgroundColor);
        if (alphaOf(s.backgroundColor) >= 1) opaque = true;
      }
      const s = cs(el);
      texts.push({ where: ref(el), color: s.color, layers, blockedBy, fontSizePx: parseFloat(s.fontSize) || 0, fontWeight: parseInt(s.fontWeight, 10) || 400 });
    }

    const viewportMeta = document.querySelector('meta[name="viewport"]');
    out.a11y = {
      names,
      aria,
      structure,
      lists,
      targets,
      scrollRegions,
      texts,
      document: {
        lang: document.documentElement.getAttribute('lang') || '',
        title: document.title || '',
        viewportContent: viewportMeta ? viewportMeta.getAttribute('content') : null
      }
    };
  }

  // -- Layout facts --
  if (want.layout) {
    const docScrollsY = (() => {
      const se = document.scrollingElement || document.documentElement;
      const blocked = v => v === 'hidden' || v === 'clip';
      return se.scrollHeight > vh + 1 && !blocked(cs(document.documentElement).overflowY) && !blocked(cs(document.body).overflowY);
    })();
    const clipInfo = el => {
      const r = el.getBoundingClientRect();
      const info = { clipped: { x: false, y: false }, revealable: { x: false, y: docScrollsY } };
      let pos = cs(el).position;
      if (pos === 'fixed') return info;
      let skipToPositioned = pos === 'absolute';
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const s = cs(a);
        const positioned = s.position !== 'static' || s.transform !== 'none';
        if (skipToPositioned && !positioned) continue;
        skipToPositioned = false;
        const ar = a.getBoundingClientRect();
        for (const axis of ['x', 'y']) {
          const ov = axis === 'x' ? s.overflowX : s.overflowY;
          const outside = axis === 'x' ? r.left < ar.left - 1 || r.right > ar.right + 1 : r.top < ar.top - 1 || r.bottom > ar.bottom + 1;
          if (ov === 'hidden' || ov === 'clip') {
            if (outside) info.clipped[axis] = true;
          } else if (ov === 'auto' || ov === 'scroll') {
            const scrolls = axis === 'x' ? a.scrollWidth > a.clientWidth + 1 : a.scrollHeight > a.clientHeight + 1;
            if (scrolls && a !== document.body) info.revealable[axis] = true;
          }
        }
        if (s.position === 'fixed') break;
        if (s.position === 'absolute') skipToPositioned = true;
      }
      return info;
    };
    // The nearest absolutely or fixed positioned ancestor: a menu, a drawer or a popover is its own
    // layer, and one of those opened over a control is not the control being covered.
    const layerOf = node => {
      for (let a = node; a && a !== document.documentElement; a = a.parentElement) {
        const p = cs(a).position;
        if (p === 'absolute' || p === 'fixed') return a;
      }
      return null;
    };
    const coveredBy = el => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) return null;
      const top = document.elementFromPoint(cx, cy);
      if (!top || top === el || el.contains(top) || top.contains(el)) return null;
      if (layerOf(top) !== layerOf(el)) return null;
      return top;
    };
    // The box that scrolls an element (null for the page), and whether anything between them pins
    // it in place. Scrolling moves a control out from under a sticky or fixed cover, but never out
    // from under a cover that scrolls with it.
    const scrollerOf = node => {
      for (let a = node.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
        const s = cs(a);
        if ((['auto', 'scroll'].includes(s.overflowY) && a.scrollHeight > a.clientHeight + 1) || (['auto', 'scroll'].includes(s.overflowX) && a.scrollWidth > a.clientWidth + 1)) return a;
      }
      return null;
    };
    const pinned = (node, scroller) => {
      for (let a = node; a && a !== scroller && a !== document.documentElement; a = a.parentElement) {
        if (['sticky', 'fixed'].includes(cs(a).position)) return true;
      }
      return false;
    };
    const controls = [];
    for (const el of all) {
      if (!isControl(el) || hiddenFromAT(el) || isSvg(el) || !isVisible(el, true)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const inPannableCanvas = !!el.closest('.react-flow__viewport');
      const info = inPannableCanvas ? { clipped: { x: false, y: false }, revealable: { x: true, y: true } } : clipInfo(el);
      const cover = inPannableCanvas ? null : coveredBy(el);
      let revealable = info.revealable;
      if (cover) {
        // A control fully on screen under a cover that scrolls with it cannot be scrolled clear:
        // tell the judge nothing can reveal it, so the cover is reported.
        const onScreen = r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1 && !info.clipped.x && !info.clipped.y;
        const scroller = scrollerOf(el);
        if (onScreen && scroller === scrollerOf(cover) && !pinned(cover, scroller) && !pinned(el, scroller)) revealable = { x: false, y: false };
      }
      controls.push({
        where: ref(el),
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        clipped: info.clipped,
        revealable,
        inPannableCanvas,
        coveredBy: cover ? ref(cover.closest('button, a[href], input, select, textarea, [role], [tabindex]') || cover) : null
      });
    }
    const clippedBoxes = [];
    for (const el of all) {
      if (el === document.body || isSvg(el) || el.closest('.react-flow') || hiddenFromAT(el) || !isVisible(el) || srOnly(el)) continue;
      const s = cs(el);
      if (s.overflowX !== 'hidden' && s.overflowX !== 'clip') continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      const er = el.getBoundingClientRect();
      if (er.width === 0) continue;
      const ellipsisWithin = node => {
        for (let a = node; a && a !== el.parentElement; a = a.parentElement) {
          if (a.nodeType === 1 && cs(a).textOverflow === 'ellipsis') return true;
        }
        return false;
      };
      let hides = null;
      let allEllipsis = true;
      for (const c of el.querySelectorAll('*')) {
        if (!isControl(c) || isSvg(c)) continue;
        const cr = c.getBoundingClientRect();
        if (cr.width > 0 && cr.right > er.right + 1) {
          hides = 'control';
          if (!ellipsisWithin(c)) allEllipsis = false;
        }
      }
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = tw.nextNode(); t; t = tw.nextNode()) {
        if (!clean(t.textContent) || !t.parentElement || isSvg(t.parentElement) || srOnly(t.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(t);
        const tr = range.getBoundingClientRect();
        if (tr.width > 0 && tr.right > er.right + 1) {
          hides = hides || 'text';
          if (!ellipsisWithin(t.parentElement)) allEllipsis = false;
        }
      }
      if (!hides) continue;
      clippedBoxes.push({ where: ref(el), hiddenPx: el.scrollWidth - el.clientWidth, hides, ellipsis: s.textOverflow === 'ellipsis' || allEllipsis });
    }
    out.layout = {
      viewport: { width: vw, height: vh },
      scrollWidths: { documentElement: document.documentElement.scrollWidth, body: document.body.scrollWidth },
      controls,
      clippedBoxes
    };
  }

  // -- Drawer facts --
  if (want.drawer) {
    const root = document.querySelector('.jv-utility');
    const panel = root ? root.firstElementChild : null;
    let stylesheetRule = false;
    const scan = rules => {
      for (const rule of rules) {
        if (stylesheetRule) return;
        if (rule.selectorText && rule.selectorText.includes('.jv-utility')) stylesheetRule = true;
        else if (rule.cssRules) scan(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        scan(sheet.cssRules);
      } catch {
        // A cross-origin sheet cannot be read, and none of ours is one.
      }
    }
    const box = el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    out.drawer = {
      name: root ? clean(root.querySelector('h2')?.textContent) : '',
      found: !!root && !!panel,
      stylesheetRule,
      viewport: { width: vw, height: vh },
      root: root ? { position: cs(root).position, rect: box(root), backgroundColor: cs(root).backgroundColor } : null,
      panel: panel ? { display: cs(panel).display, flexDirection: cs(panel).flexDirection, backgroundColor: cs(panel).backgroundColor, rect: box(panel) } : null,
      closes: null
    };
  }

  // -- Replace element references with unique descriptions --
  const ordered = [...described].sort((a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const counts = new Map();
  const whereOf = new Map();
  for (const el of ordered) {
    const base = baseOf(el);
    const region = regionOf(el);
    const key = `${base}|${region}`;
    const n = (counts.get(key) || 0) + 1;
    counts.set(key, n);
    whereOf.set(el, `${base} #${n} in ${region}`);
  }
  const swap = list => {
    for (const f of list) f.where = whereOf.get(f.where) || 'page';
  };
  if (out.a11y) for (const k of ['names', 'aria', 'structure', 'lists', 'targets', 'scrollRegions', 'texts']) swap(out.a11y[k]);
  if (out.layout) {
    for (const c of out.layout.controls) if (c.coveredBy) c.coveredBy = whereOf.get(c.coveredBy) || 'something';
    swap(out.layout.controls);
    swap(out.layout.clippedBoxes);
  }
  return out;
}

// ---- Browser helpers ----

const hostPath = url => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return String(url).slice(0, 80);
  }
};

/** Lets the page come to rest: fonts, finite animations (the edge dash never ends), the map's fit. */
export async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document.getAnimations().filter(a => {
      const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      return t && Number.isFinite(Number(t.endTime));
    });
    await Promise.race([Promise.all(finite.map(a => a.finished.catch(() => {}))), new Promise(r => setTimeout(r, 2000))]);
  });
  let last = null;
  for (let i = 0; i < 14; i++) {
    const now = await page.evaluate(() => document.querySelector('.react-flow__viewport')?.style.transform ?? '');
    if (now === last) break;
    last = now;
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

function collect(page, want) {
  return page.evaluate(collectFacts, { tables: A11Y_TABLES, want });
}

/**
 * A fresh context on /canvas with every outside request, /api and /p aborted and recorded. With
 * signedIn, the fixture user is seeded where Firebase Auth looks for a persisted user. With project,
 * that journey is the one this browser holds on the first load, as a signed-out visitor's is.
 */
export async function openCanvas(browser, viewport, { origin, signedIn = false, storageFails = false, blocked = [], project = null }) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const savePosts = [];
  await context.route('**/*', route => {
    const req = route.request();
    if (routeVerdict(req.url(), origin) === 'continue') return route.continue();
    // The account read of the open journey answers with no copy, so the journey is not held.
    try {
      const u = new URL(req.url());
      if (req.method() === 'GET' && u.origin === origin && /^\/api\/journey\/[^/]+$/.test(u.pathname)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, journey: null }) });
      }
    } catch {}
    blocked.push(`${req.method()} ${hostPath(req.url())}`);
    try {
      if (req.method() === 'POST' && SAVE_POST.test(new URL(req.url()).pathname)) savePosts.push(req.url());
    } catch {
      // an unparseable URL is still blocked
    }
    return route.abort();
  });
  let signInReason = null;
  if (signedIn) {
    const apiKey = firebaseApiKeyFrom(fs.readFileSync(path.join(ROOT, 'src/lib/firebase.ts'), 'utf8'));
    if (!apiKey) signInReason = 'No Firebase apiKey was found in src/lib/firebase.ts.';
    else {
      const fixture = signedInUserFixture(apiKey, Date.now());
      await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [fixture.key, JSON.stringify(fixture.value)]);
    }
  }
  if (project) {
    await context.addInitScript(([key, value]) => {
      // Only on the first load of this context, so a reload reads what the app saved.
      if (sessionStorage.getItem('jv-check-seeded')) return;
      sessionStorage.setItem('jv-check-seeded', '1');
      localStorage.setItem(key, value);
    }, [STORAGE_KEY, JSON.stringify(project)]);
  }
  if (storageFails) {
    // A browser that refuses to store anything, as #8's leave warning is checked: every write throws
    // the DOMException named by storageFails (QuotaExceededError for a full store, SecurityError for
    // one blocked by privacy settings), so the journey cannot be kept here.
    const errorName = typeof storageFails === 'string' ? storageFails : 'QuotaExceededError';
    await context.addInitScript(name => {
      Storage.prototype.setItem = function () {
        throw new DOMException(`This browser refused the write (${name}).`, name);
      };
    }, errorName);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', err => errors.push(String(err?.message || err)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  try {
    await page.goto(`${origin}/canvas`);
    await page.waitForSelector('.react-flow__node', { timeout: 20000 });
    await settle(page);
  } catch (err) {
    await context.close().catch(() => {});
    // A map that never loads often threw first; the runtime section must still show it.
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { pageErrors: errors });
  }
  return { context, page, errors, savePosts, signInReason };
}

const button = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' }).first();

async function waitUntil(fn, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return fn();
}

// ---- The failed save ----

async function saveProbe(page, run) {
  const expectedMessage = saveOutcome(null, '').message;
  const facts = {
    signedIn: false,
    postsAttempted: 0,
    alertText: null,
    expectedMessage,
    statusText: '',
    statusLog: [],
    retryOffered: false,
    retryPosts: 0,
    keptName: null,
    expectedName: EXPECTED_NAME,
    dismissed: false
  };
  if (run.signInReason) return { save: { ...facts, signInReason: run.signInReason } };
  try {
    await page.waitForFunction(() => {
      const names = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim());
      return names.some(n => /browser-check/.test(n)) && !names.includes('Sign In');
    }, null, { timeout: 5000 });
    facts.signedIn = true;
  } catch {
    return { save: facts };
  }
  await page.evaluate(() => {
    const log = (window.__statusLog = []);
    const last = new Map();
    const read = () => {
      for (const s of document.querySelectorAll('[role="status"]')) {
        const t = (s.textContent || '').trim();
        if (t && last.get(s) !== t) {
          last.set(s, t);
          log.push(t);
        }
      }
    };
    read();
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.fill('input[aria-label="Journey name"]', EXPECTED_NAME);
  await button(page, 'Save').click();
  await page
    .waitForFunction(msg => [...document.querySelectorAll('[role="alert"]')].some(a => (a.textContent || '').includes(msg)), expectedMessage, { timeout: 5000 })
    .catch(() => {});
  facts.postsAttempted = run.savePosts.length;
  const readState = () =>
    page.evaluate(() => {
      const alerts = [...document.querySelectorAll('[role="alert"]')].map(a => (a.textContent || '').trim()).filter(Boolean);
      const status = document.querySelector('[role="toolbar"] [role="status"]') || document.querySelector('[role="status"]');
      return { alertText: alerts.length ? alerts.join(' ') : null, statusText: (status?.textContent || '').trim() };
    });
  Object.assign(facts, await readState());
  const collected = await run.collect();
  if (run.shoot) await run.shoot();

  const retry = button(page, 'Try again');
  facts.retryOffered = (await retry.count()) > 0 && (await retry.isVisible());
  if (facts.retryOffered) {
    const before = run.savePosts.length;
    await retry.click();
    await waitUntil(() => run.savePosts.length > before, 2000);
    facts.retryPosts = run.savePosts.length - before;
    await page.waitForTimeout(200);
  }
  facts.keptName = await page.evaluate(key => {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null')?.name ?? null;
    } catch {
      return null;
    }
  }, STORAGE_KEY);
  const dismiss = button(page, 'Dismiss');
  if ((await dismiss.count()) > 0) {
    await dismiss.click();
    facts.dismissed = await waitUntil(
      () => page.evaluate(msg => ![...document.querySelectorAll('[role="alert"]')].some(a => (a.textContent || '').includes(msg)), expectedMessage),
      2000
    );
  }
  facts.statusLog = await page.evaluate(() => window.__statusLog || []);
  return { save: facts, ...collected };
}

// ---- A signed-out save this browser refuses (#8, F4) ----

/**
 * Zero-only, reported under save. What the banner must say comes from browserSaveOutcome in
 * src/lib/saveOutcome.ts, never a copy of its sentences, so a reworded sentence cannot strand the
 * check waiting for the old one (T01: a full browser has said BROWSER_OUT_OF_SPACE since F4).
 */
export const BROWSER_SAVE_RULES = ['save-browser-message', 'save-browser-claimed', 'save-browser-action', 'save-browser-retry', 'save-browser-leave'];

/**
 * The save state a refused browser write must show; `full` when the store was out of space, which
 * must say BROWSER_OUT_OF_SPACE whatever else browserSaveOutcome comes to say.
 */
export function browserRefusal(full) {
  const outcome = browserSaveOutcome(false, '', full);
  return full ? { ...outcome, message: BROWSER_OUT_OF_SPACE } : outcome;
}

/**
 * Judges one refused browser save. `f.full` says which refusal the scenario threw; `found` says the
 * banner row carrying the expected sentence was there, and `buttons` are that row's buttons.
 */
export function browserSaveProblems(f) {
  const expected = browserRefusal(!!f?.full);
  const where = 'alert banner';
  const out = [];
  if (!f?.found) {
    const said = f?.alertText ? ` It said "${f.alertText}".` : ' No alert showed.';
    out.push({ rule: 'save-browser-message', where, detail: `A browser whose storage ${f?.full ? 'is full' : 'is blocked'} did not say "${expected.message}".${said}` });
  }
  if (isSavedClaim(f?.statusText)) {
    out.push({ rule: 'save-browser-claimed', where: 'save status', detail: `A save this browser refused was shown as "${String(f.statusText).trim()}".` });
  }
  if (f?.found) {
    const buttons = f.buttons ?? [];
    if (expected.action === 'open-library') {
      if (!buttons.includes('Open journeys')) out.push({ rule: 'save-browser-action', where, detail: 'The out-of-space banner offered no Open journeys.' });
      else if (!f.libraryOpened) out.push({ rule: 'save-browser-action', where, detail: 'Open journeys did not open the journey library.' });
    } else if (buttons.includes('Open journeys')) {
      out.push({ rule: 'save-browser-action', where, detail: 'A browser that blocks storage was sent to the journey library, where removing a journey cannot help.' });
    }
    if (buttons.includes('Try again') !== expected.retryable) {
      out.push({ rule: 'save-browser-retry', where, detail: expected.retryable ? 'The banner offered no Try again.' : 'The banner offered Try again, which cannot help this refusal.' });
    }
  }
  if (!f?.leaveWarned) {
    out.push({ rule: 'save-browser-leave', where: 'window', detail: 'Leaving the page raised no warning, though closing the tab would lose the edit.' });
  }
  return out;
}

/**
 * Drives a scenario opened with storageFails: waits for the banner the refusal should give, reads it
 * and collects the page in that state, then asks the app's leave handler (a cancelable beforeunload,
 * as the browser sends one) and, for a full browser, opens the journey library from the banner and
 * closes it again.
 */
async function browserSaveProbe(page, run) {
  const full = !!run.scenario.full;
  const expected = browserRefusal(full);
  const facts = { full, found: false, alertText: null, statusText: '', buttons: [], libraryOpened: null, leaveWarned: false };
  await page
    .waitForFunction(msg => [...document.querySelectorAll('[role="alert"]')].some(a => (a.textContent || '').includes(msg)), expected.message, { timeout: 5000 })
    .catch(() => {});
  Object.assign(
    facts,
    await page.evaluate(msg => {
      const alerts = [...document.querySelectorAll('[role="alert"]')];
      const texts = alerts.map(a => (a.textContent || '').trim()).filter(Boolean);
      const line = alerts.flatMap(a => [...a.querySelectorAll('span')]).find(s => (s.textContent || '').includes(msg));
      const row = line?.parentElement ?? null;
      const status = document.querySelector('[role="toolbar"] [role="status"]') || document.querySelector('[role="status"]');
      return {
        found: !!row,
        alertText: texts.length ? texts.join(' ') : null,
        statusText: (status?.textContent || '').trim(),
        buttons: row ? [...row.querySelectorAll('button')].map(b => (b.textContent || '').trim()) : []
      };
    }, expected.message)
  );
  const collected = await run.collect();
  if (run.shoot) await run.shoot();

  facts.leaveWarned = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  if (full && facts.buttons.includes('Open journeys')) {
    await page.getByRole('alert').getByRole('button', { name: 'Open journeys', exact: true }).first().click();
    facts.libraryOpened = await page
      .waitForSelector('#journey-library-title', { state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (facts.libraryOpened) await button(page, 'Close journeys').click().catch(() => {});
  }
  return { browserSave: facts, ...collected };
}

// ---- Scenarios ----

async function openMore(page) {
  await button(page, 'More').click();
  await page.waitForSelector('[role="menu"]', { timeout: 2000 });
}

/**
 * One row per map state. `sections` names what the state is checked for; `open` puts the page in
 * that state; `probe`, when present, drives the state itself and returns its own facts;
 * `storageFails` opens it in a browser whose every localStorage write throws the DOMException it
 * names, and `full` says whether that refusal means the store is out of space. A state that cannot
 * be reached leaves its sections unproven (exit 2), never passed. The rows after save-failed belong
 * to later items: #7 docked step panel, #8 undo and the leave warning, #12 the step picker, #14 tidy
 * layout and #19 focus return.
 */
export const SCENARIOS = [
  { id: 'canvas', sections: ['overflow', 'a11y'], open: async () => {} },
  { id: 'more-menu', sections: ['overflow', 'a11y'], open: openMore },
  {
    id: 'add-step-menu',
    sections: ['overflow', 'a11y'],
    open: async page => {
      await button(page, /Add Step/).click();
      await page.waitForTimeout(200);
    }
  },
  {
    id: 'step-selected',
    sections: ['overflow', 'a11y'],
    open: async page => {
      await page.locator('.react-flow__node').first().click();
      await page.waitForTimeout(250);
    }
  },
  {
    id: 'line-selected',
    sections: ['overflow', 'a11y'],
    open: async page => {
      await page.locator('.react-flow__edge').first().dispatchEvent('click');
      await page.waitForTimeout(250);
    }
  },
  {
    id: 'live-roas',
    sections: ['overflow', 'a11y'],
    open: async page => {
      await page.click('button[aria-label="Live ROAS"]');
      await page.waitForTimeout(250);
    }
  },
  {
    id: 'audit-drawer',
    sections: ['drawers', 'overflow', 'a11y'],
    open: async page => {
      // The Audit's header button is "Check design" since #10, and its name carries the count.
      await page.click('button[aria-label^="Check design"]');
      await page.waitForSelector('.jv-utility', { timeout: 3000 });
    }
  },
  {
    id: 'forecaster-drawer',
    sections: ['drawers', 'overflow', 'a11y'],
    open: async page => {
      await openMore(page);
      await page.getByRole('menuitem', { name: 'ROAS Forecaster' }).click();
      await page.waitForSelector('.jv-utility', { timeout: 3000 });
    }
  },
  { id: 'save-failed', sections: ['save', 'overflow', 'a11y'], signedIn: true, open: async () => {}, probe: saveProbe },
  {
    // #7: a step chosen from the docked panel's finder, with the step open beside (or under) the map.
    id: 'step-finder',
    sections: ['overflow', 'a11y'],
    open: async page => {
      await page.fill('#jv-step-search', 'form');
      await page.press('#jv-step-search', 'Enter');
      await page.waitForSelector('.react-flow__node[data-id="node-form-1"].selected', { timeout: 3000 });
      await page.waitForFunction(() => (document.getElementById('jv-step-panel-title')?.textContent || '').trim().length > 0, null, { timeout: 3000 });
    }
  },
  {
    // #8: one edit made, so Undo is live and the status says where the journey is kept.
    id: 'undo-ready',
    sections: ['overflow', 'a11y'],
    open: async page => {
      await page.fill('input[aria-label="Journey name"]', EXPECTED_NAME);
      await page.waitForSelector('button[aria-label="Undo"][aria-disabled="false"]', { timeout: 3000 });
    }
  },
  {
    // #8 and F4: a browser that is out of space says so, points to the journey library with Open
    // journeys rather than Try again, and the leave warning stands.
    id: 'browser-save-full',
    sections: ['save', 'overflow', 'a11y'],
    storageFails: 'QuotaExceededError',
    full: true,
    open: page => page.fill('input[aria-label="Journey name"]', EXPECTED_NAME),
    probe: browserSaveProbe
  },
  {
    // #8: a browser that blocks storage says it would not store the journey, offers no Try again,
    // and the leave warning stands.
    id: 'browser-save-refused',
    sections: ['save', 'overflow', 'a11y'],
    storageFails: 'SecurityError',
    full: false,
    open: page => page.fill('input[aria-label="Journey name"]', EXPECTED_NAME),
    probe: browserSaveProbe
  },
  {
    // #12: the step picker opened from + Next on a selected step.
    id: 'step-picker',
    sections: ['overflow', 'a11y'],
    open: async page => {
      await page.locator('.react-flow__node[data-id="node-page-1"]').click();
      await page.locator('button[aria-label^="Add a step after"]').click();
      await page.waitForSelector('dialog[open]', { timeout: 3000 });
    }
  },
  {
    // #14: the map after Tidy layout, with its notice and Undo tidy layout showing.
    id: 'tidied',
    sections: ['overflow', 'a11y'],
    open: async page => {
      // A narrow map folds Tidy layout into the Map tools disclosure (T06), so open it first.
      const tools = page.locator('button[aria-controls="jv-map-tools jv-map-legend"][aria-expanded="false"]');
      if (await tools.count()) await tools.click();
      await button(page, 'Tidy layout').click();
      await page.waitForSelector('button[aria-label="Dismiss message"]', { timeout: 3000 });
    }
  },
  {
    // #19: the Audit opened and closed from the keyboard, so focus is back on its button.
    id: 'focus-returned',
    sections: ['overflow', 'a11y'],
    open: async page => {
      await page.keyboard.press('Shift');
      await page.locator('button[aria-label^="Check design"]').focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 3000 });
      await page.keyboard.press('Escape');
      await page.waitForSelector('[role="dialog"][aria-modal="true"]', { state: 'detached', timeout: 3000 });
    }
  }
];

// ---- #19's keyboard and screen reader checks ----

/** The rule id a #19 check reports under: stepRoundTrip is a11y-step-round-trip. */
export const keyboardRule = name => `a11y-${name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;

// ---- C05: a step moved with the arrow keys ----

const sameSpot = (a, b) => !!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
const spot = p => (p ? `${Math.round(p.x)}, ${Math.round(p.y)}` : 'nowhere');

/**
 * Judges one keyboard move (C05): React Flow moves a focused, selected step with Shift+Arrow, and
 * that move must be saved in this browser, be one undo step, and survive a reload, as a drag does.
 * Positions are map units: `screen`, `afterReload`, `quickBefore` and `quickUndo` are where the card
 * is drawn, the rest are what this browser stored.
 */
export function keyboardMoveProblems(f) {
  if (!f?.found) return ['No step could be focused and moved with the arrow keys.'];
  if (sameSpot(f.screen, f.before)) return ['Shift+ArrowRight did not move the focused step on the map.'];
  const out = [];
  if (!sameSpot(f.stored, f.screen)) out.push(`A step moved with the arrow keys was not saved: the map shows it at ${spot(f.screen)} and this browser keeps ${spot(f.stored)}.`);
  if (!f.undoOn) out.push('Undo stayed off after a step was moved with the arrow keys.');
  if (!sameSpot(f.afterUndo, f.before)) out.push(`One undo did not put a step moved with the arrow keys back: it was at ${spot(f.before)} and is kept at ${spot(f.afterUndo)}.`);
  if (!sameSpot(f.afterReload, f.screen)) out.push(`After a reload, a step moved with the arrow keys and redone was at ${spot(f.afterReload)}, not ${spot(f.screen)}.`);
  if (!sameSpot(f.quickUndo, f.quickBefore)) out.push(`An undo pressed straight after the arrow keys left the step at ${spot(f.quickUndo)} on the map, not back at ${spot(f.quickBefore)}.`);
  return out;
}

/** Moves the first form step with Shift+ArrowRight at 1440px, signed out, and reports keyboardMoveProblems. */
async function checkKeyboardMove(browser, run) {
  const viewport = CHECK_VIEWPORTS.find(v => v.label === '1440') ?? { label: '1440', width: 1440, height: 900 };
  const { context, page } = await openCanvas(browser, viewport, { origin: run.origin, blocked: run.blocked });
  try {
    const id = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('.react-flow__node[data-id]')].map(n => n.getAttribute('data-id'));
      return ids.find(i => i.includes('form')) ?? ids[0] ?? null;
    });
    if (!id) return keyboardMoveProblems({ found: false });
    const card = page.locator(`.react-flow__node[data-id="${id}"]`);
    const stored = () => page.evaluate(([key, nodeId]) => {
      try {
        const node = JSON.parse(localStorage.getItem(key) || 'null')?.nodes?.find(n => n.id === nodeId);
        return node?.position ? { x: node.position.x, y: node.position.y } : null;
      } catch {
        return null;
      }
    }, [STORAGE_KEY, id]);
    const screen = () => card.evaluate(el => {
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform || '');
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    });
    const undoOn = () => page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Undo"]');
      return !!b && b.getAttribute('aria-disabled') !== 'true' && !b.disabled;
    });
    // Past the canvas's settle time and the signed-out save.
    const rest = () => page.waitForTimeout(900);
    const move = async presses => {
      await card.click({ position: { x: 10, y: 10 } });
      await card.focus();
      for (let i = 0; i < presses; i++) await page.keyboard.press('Shift+ArrowRight');
    };
    const facts = { found: true, before: await stored() };
    await move(5);
    await rest();
    facts.screen = await screen();
    facts.stored = await stored();
    facts.undoOn = await undoOn();
    // Control works on every platform: the shortcut takes Command or Control.
    await page.keyboard.press('Control+z');
    await rest();
    facts.afterUndo = await stored();
    await page.keyboard.press('Control+Shift+z');
    await rest();
    await page.reload();
    await page.waitForSelector(`.react-flow__node[data-id="${id}"]`, { timeout: 20000 });
    await settle(page);
    facts.afterReload = await screen();
    // Undo inside the settle time, before the move could have been saved on its own.
    facts.quickBefore = await screen();
    await move(3);
    await page.keyboard.press('Control+z');
    await rest();
    facts.quickUndo = await screen();
    return keyboardMoveProblems(facts);
  } finally {
    await context.close().catch(() => {});
  }
}

// ---- C01: every shipped blueprint opens with every card, handle and line pill in reach ----

const overlapOf = (a, b) => ({
  w: Math.min(a.right, b.right) - Math.max(a.left, b.left),
  h: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
});

/**
 * Judges one shipped blueprint as it opens (C01). A blueprint's cards sit where ecomBlueprints.ts
 * puts them, and when the cards grew taller than the gap, the lower card lay over the bottom of the
 * card above: the "Left checkout" and "Rescue flow" handles were under it, so a drag from them moved
 * that card instead of making a line. Spacing the rows made the map taller, and the first fit then
 * put the top row's line pills under the map tools and the corner cards under the legend and the
 * minimap, so those are judged too. `cards` and `overlays` ({ name, ...box }) are screen boxes; each
 * handle says which card (`topCard`) or overlay (`topOverlay`) is on top at its centre and `inView`
 * whether its centre is on screen; each line pill says what a press at its centre lands on instead
 * of the pill (`blockedBy`, null when the pill takes it).
 */
export function blueprintLayoutProblems(f) {
  const at = `${f?.width}px, ${f?.blueprint}`;
  const cards = f?.cards ?? [];
  const handles = f?.handles ?? [];
  if (!cards.length) return [`${at}: the blueprint opened with no step on the map.`];
  if (!handles.some(h => h.inView)) return [`${at}: no handle of any step could be measured on screen.`];
  const out = [];
  for (const h of handles) {
    if (h.inView && h.topCard && h.topCard !== h.card) {
      out.push(`${at}: the "${h.handle}" handle of ${h.card} is under the ${h.topCard} card, so a drag from it moves that card instead of making a line.`);
    } else if (h.inView && h.topOverlay) {
      out.push(`${at}: the "${h.handle}" handle of ${h.card} is under the map's ${h.topOverlay}, so a drag from it cannot make a line.`);
    }
  }
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const o = overlapOf(cards[i], cards[j]);
      if (o.w > 1 && o.h > 1) out.push(`${at}: the ${cards[i].id} and ${cards[j].id} cards overlap by ${Math.round(o.w)} by ${Math.round(o.h)} px.`);
    }
  }
  for (const c of cards) {
    for (const v of f?.overlays ?? []) {
      const o = overlapOf(c, v);
      if (o.w > 1 && o.h > 1) out.push(`${at}: the ${c.id} card is under the map's ${v.name} by ${Math.round(o.w)} by ${Math.round(o.h)} px.`);
    }
  }
  for (const p of f?.pills ?? []) {
    if (p.inView && p.blockedBy) out.push(`${at}: the "${p.label}" line pill is under the ${p.blockedBy}, so a press on it lands there instead.`);
  }
  return out;
}

/** A blueprint as Use Blueprint opens it: its own positions, with the seeded numbers cleared. */
export function blueprintProject(bp) {
  const nodes = structuredClone(bp.nodes);
  const blank = zeroBlueprintMetrics(nodes, repairEdgeHandles(nodes, structuredClone(bp.edges)));
  return { id: `check-${bp.id}`, name: bp.title, businessType: 'ecom', offerHeadline: '', goal: '', nodes: blank.nodes, edges: blank.edges, updatedAt: new Date(0).toISOString() };
}

// `plant` puts a tool box over the first card and a pointer-taking box over the first line pill,
// in the page itself, so the control proves the overlay and pill halves read the real DOM.
async function blueprintLayoutFacts(browser, run, viewport, bp, plant = false) {
  const { context, page } = await openCanvas(browser, viewport, { origin: run.origin, blocked: run.blocked, project: blueprintProject(bp) });
  try {
    const facts = await page.evaluate(plantIt => {
      const box = el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const tools = document.querySelector('[data-map-overlay]');
      if (plantIt && tools) {
        const card = document.querySelector('.react-flow__node[data-id]').getBoundingClientRect();
        const fake = document.createElement('span');
        fake.textContent = 'Planted';
        fake.style.cssText = `position:fixed;left:${card.left + 10}px;top:${card.top + 10}px;width:40px;height:20px;background:#000`;
        tools.appendChild(fake);
        const pill = document.querySelector('[data-jv-edge-label] button')?.getBoundingClientRect();
        if (pill) {
          const cover = document.createElement('div');
          cover.setAttribute('data-planted-cover', '');
          cover.style.cssText = `position:fixed;left:${pill.left}px;top:${pill.top}px;width:${pill.width}px;height:${pill.height}px;z-index:99`;
          document.body.appendChild(cover);
        }
      }
      // What floats over the map: each painted box of the top-right tools and legend (the box
      // around them is transparent and ignores the pointer), the zoom controls and the minimap.
      const painted = el => {
        const cs = getComputedStyle(el);
        return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      };
      const paintedAbove = el => {
        for (let a = el.parentElement; a && a !== tools; a = a.parentElement) if (painted(a)) return true;
        return false;
      };
      // The outermost painted boxes: a pill, the legend, the tidy notice.
      const toolBoxes = tools ? [...tools.querySelectorAll('*')].filter(el => painted(el) && !paintedAbove(el)) : [];
      const nameOf = el => {
        if (el.closest('.react-flow__minimap')) return 'minimap';
        if (el.closest('.react-flow__controls')) return 'zoom controls';
        if (el.closest('[role="group"][aria-label="What the line colours mean"]')) return 'line legend';
        const text = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim().split('\n')[0].trim().slice(0, 24);
        return `"${text}" tool`;
      };
      const overlayEls = [...toolBoxes, ...document.querySelectorAll('.react-flow__minimap, .react-flow__controls')];
      const overlays = overlayEls.map(el => ({ name: nameOf(el), ...box(el) })).filter(o => o.right - o.left > 0 && o.bottom - o.top > 0);
      const overlayAt = hit => {
        if (!hit) return null;
        const el = hit.closest('.react-flow__minimap, .react-flow__controls, [data-map-overlay] *');
        return el ? nameOf(el.closest('.react-flow__minimap, .react-flow__controls') ?? el) : null;
      };
      const cards = [...document.querySelectorAll('.react-flow__node[data-id]')].map(n => ({ id: n.getAttribute('data-id'), ...box(n) }));
      const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
      const onPane = (x, y) => !!pane && x > pane.left && y > pane.top && x < pane.right && y < pane.bottom;
      const handles = [...document.querySelectorAll('.react-flow__handle')].map(h => {
        const r = h.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const inView = r.width > 0 && x > 0 && y > 0 && x < innerWidth && y < innerHeight;
        const hit = inView ? document.elementFromPoint(x, y) : null;
        return {
          card: h.getAttribute('data-nodeid'),
          handle: h.getAttribute('data-handleid') || 'main',
          inView,
          topCard: hit?.closest?.('.react-flow__node')?.getAttribute('data-id') ?? null,
          topOverlay: overlayAt(hit)
        };
      });
      const pills = [...document.querySelectorAll('[data-jv-edge-label] button')].map(el => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const inView = r.width > 0 && onPane(x, y);
        const hit = inView ? document.elementFromPoint(x, y) : null;
        const label = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        let blockedBy = null;
        if (inView && !(hit && (hit === el || el.contains(hit)))) {
          const card = hit?.closest?.('.react-flow__node')?.getAttribute('data-id');
          blockedBy = overlayAt(hit) ? `map's ${overlayAt(hit)}` : card ? `${card} card` : hit?.hasAttribute?.('data-planted-cover') ? 'planted cover' : 'something else on the page';
        }
        return { label, inView, blockedBy };
      });
      return { cards, handles, overlays, pills };
    }, plant);
    return { width: viewport.width, blueprint: bp.id, ...facts };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Opens every shipped blueprint at 1440, 1280 and 390px, signed out, and reports
 * blueprintLayoutProblems. 1280 is not one of the harness's widths, but it is a common laptop and
 * the first width where the fit put a line pill under the map tools. First a planted control must
 * be found, or the check cannot be trusted and throws, which leaves the a11y section unproven: the
 * first blueprint's third card dropped 150px under its landing page, over the page's bottom "Left
 * checkout" handle (the shape the review found), with a painted tool box planted over its first
 * card and a cover planted over its first line pill.
 */
export const BLUEPRINT_LAYOUT_EXTRA_VIEWPORT = { label: '1280', width: 1280, height: 800 };
async function checkBlueprintLayout(browser, run) {
  const widths = [
    CHECK_VIEWPORTS.find(v => v.label === '1440'),
    BLUEPRINT_LAYOUT_EXTRA_VIEWPORT,
    CHECK_VIEWPORTS.find(v => v.label === '390')
  ].filter(Boolean);
  const planted = structuredClone(ECOM_BLUEPRINTS[0]);
  const [, page, cover] = planted.nodes;
  cover.position = { x: page.position.x, y: page.position.y + 150 };
  const control = blueprintLayoutProblems(await blueprintLayoutFacts(browser, run, widths[0], planted, true));
  const found = [
    control.some(p => p.includes(`handle of ${page.id} is under the ${cover.id} card`)),
    control.some(p => /cards overlap by/.test(p)),
    control.some(p => /card is under the map's "Planted" tool/.test(p)),
    control.some(p => /line pill is under the planted cover/.test(p))
  ];
  if (found.includes(false)) {
    throw new Error('The planted blueprint control (one card dropped over another, a tool box over a card, a cover over a line pill) was not found, so this check cannot be trusted.');
  }
  const out = [];
  for (const viewport of widths) {
    for (const bp of ECOM_BLUEPRINTS) out.push(...blueprintLayoutProblems(await blueprintLayoutFacts(browser, run, viewport, bp)));
  }
  return out;
}

/**
 * Checks this harness runs itself, reported beside #19's under the same zero-only rules: C05's
 * keyboard move, and C01's blueprint layout (a handle a pointer cannot press is a control it cannot use).
 */
export const CANVAS_KEYBOARD_CHECKS = { keyboardMove: checkKeyboardMove, blueprintLayout: checkBlueprintLayout };

/** Every #19 check is its acceptance test, so each one must stay at zero and is never baselined. */
export const KEYBOARD_RULES = [...Object.keys(KEYBOARD_CHECKS), ...Object.keys(CANVAS_KEYBOARD_CHECKS)].map(keyboardRule);

/**
 * Turns #19's results ({ name: string[] | { error } }) into findings. A check that threw could not
 * run, which leaves the a11y section unproven rather than passed.
 */
export function keyboardFindings(results) {
  const findings = [];
  const notRun = [];
  for (const [name, result] of Object.entries(results)) {
    if (!Array.isArray(result)) {
      notRun.push(`#19 ${name} check could not run: ${result?.error ?? 'no result'}`);
      continue;
    }
    for (const line of result) {
      const width = /^(\d+)px/.exec(line);
      findings.push({
        section: 'a11y',
        rule: keyboardRule(name),
        where: line,
        detail: name in CANVAS_KEYBOARD_CHECKS ? `Found by the ${name} check in scripts/canvas-browser-check.mjs.` : `Found by #19's ${name} check in scripts/a11y-browser-check.mjs.`,
        viewport: width ? width[1] : '1440',
        scenario: name in CANVAS_KEYBOARD_CHECKS ? name : `#19 ${name}`
      });
    }
  }
  return { findings, notRun };
}

/** Clicks the last button in the drawer header and reports whether the drawer went away. */
async function drawerCloses(page) {
  const handle = await page.evaluateHandle(() => {
    const header = document.querySelector('.jv-utility')?.firstElementChild?.firstElementChild;
    const buttons = header ? header.querySelectorAll('button') : [];
    return buttons[buttons.length - 1] ?? null;
  });
  const el = handle.asElement();
  if (!el) return false;
  await el.click();
  return page
    .waitForSelector('.jv-utility', { state: 'detached', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
}

async function runScenario(browser, scenario, viewport, run) {
  const want = {
    layout: run.requested.includes('overflow') && scenario.sections.includes('overflow'),
    a11y: run.requested.includes('a11y') && scenario.sections.includes('a11y'),
    drawer: run.requested.includes('drawers') && scenario.sections.includes('drawers')
  };
  const findings = [];
  const unmeasured = [];
  const stamp = (section, problems) => {
    for (const p of problems) findings.push({ section, rule: p.rule, where: p.where, detail: p.detail, viewport: viewport.label, scenario: scenario.id });
  };
  let opened;
  try {
    opened = await openCanvas(browser, viewport, { origin: run.origin, signedIn: !!scenario.signedIn, storageFails: scenario.storageFails ?? false, blocked: run.blocked });
  } catch (err) {
    stamp('runtime', pageErrorProblems(err?.pageErrors ?? []));
    return { findings, unmeasured, completed: false, note: `${scenario.id} at ${viewport.label}px: the map did not load (${String(err?.message || err).split('\n')[0]})` };
  }
  const { context, page, errors } = opened;
  const shotPath = run.shots ? path.join(run.shots, `${viewport.label}-${scenario.id}.png`) : null;
  const shoot = shotPath ? () => page.screenshot({ path: shotPath }).catch(() => {}) : null;
  let completed = false;
  try {
    let facts = {};
    let openFailed = null;
    try {
      await scenario.open(page);
      await settle(page);
    } catch (err) {
      openFailed = String(err?.message || err).split('\n')[0];
    }
    if (openFailed && want.drawer) {
      stamp('drawers', drawerProblems({ name: scenario.id, found: false, stylesheetRule: false, viewport, root: null, panel: null, closes: null }));
      if (shoot) await shoot();
      completed = true;
      return { findings, unmeasured, completed, note: null };
    }
    if (openFailed) return { findings, unmeasured, completed: false, note: `${scenario.id} at ${viewport.label}px could not open: ${openFailed}` };

    if (scenario.probe) {
      const result = await scenario.probe(page, { ...opened, scenario, collect: () => collect(page, want), shoot });
      facts = result;
      if (run.requested.includes('save') && scenario.sections.includes('save')) stamp('save', result.browserSave ? browserSaveProblems(result.browserSave) : saveProblems(result.save));
    } else {
      facts = await collect(page, want);
      if (shoot) await shoot();
    }
    if (want.drawer && facts.drawer) {
      facts.drawer.closes = facts.drawer.found ? await drawerCloses(page) : null;
      stamp('drawers', drawerProblems(facts.drawer));
    }
    if (want.layout && facts.layout) stamp('overflow', layoutProblems(facts.layout));
    if (want.a11y && facts.a11y) {
      const judged = judgeA11y(facts.a11y);
      stamp('a11y', judged.findings);
      for (const u of judged.unmeasured) unmeasured.push({ ...u, viewport: viewport.label, scenario: scenario.id });
    }
    completed = true;
  } catch (err) {
    return { findings, unmeasured, completed: false, note: `${scenario.id} at ${viewport.label}px stopped: ${String(err?.message || err).split('\n')[0]}` };
  } finally {
    stamp('runtime', pageErrorProblems(errors));
    await context.close().catch(() => {});
  }
  return { findings, unmeasured, completed, note: null };
}

// ---- Controls ----

const controlDoc = body =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Controls</title></head><body style="margin:0;background:#FFFFFF;color:#0F172A;font:14px sans-serif">${body}</body></html>`;

/**
 * Every rule must fire on its planted example, and correct markup must produce nothing, in this
 * Chrome, before any scenario result counts. Returns the sentences that say what did not hold.
 */
export async function runControls(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  const problems = [];
  const untrusted = rule => `The checks cannot be trusted: rule ${rule} did not fire on its planted example.`;
  try {
    const sectioned = A11Y_POSITIVE_CONTROL.filter(c => !A11Y_DOCUMENT_RULES.includes(c.rule));
    await page.setContent(controlDoc(sectioned.map(c => `<section data-control="${c.rule}">${c.html}</section>`).join('')));
    const positive = judgeA11y((await collect(page, { a11y: true })).a11y);
    for (const c of sectioned) {
      if (!positive.findings.some(f => f.rule === c.rule && f.where.endsWith(`in control ${c.rule}`))) problems.push(untrusted(c.rule));
    }
    for (const c of A11Y_POSITIVE_CONTROL.filter(c => A11Y_DOCUMENT_RULES.includes(c.rule))) {
      await page.setContent(c.html);
      const judged = judgeA11y((await collect(page, { a11y: true })).a11y);
      if (!judged.findings.some(f => f.rule === c.rule)) problems.push(untrusted(c.rule));
    }
    for (const c of LAYOUT_POSITIVE_CONTROL) {
      await page.setContent(controlDoc(c.html));
      if (!layoutProblems((await collect(page, { layout: true })).layout).some(p => p.rule === c.rule)) problems.push(untrusted(c.rule));
    }
    const missing = A11Y_RULES.filter(rule => !A11Y_POSITIVE_CONTROL.some(c => c.rule === rule));
    for (const rule of missing) problems.push(untrusted(rule));

    await page.setContent(controlDoc(A11Y_NEGATIVE_CONTROL + LAYOUT_NEGATIVE_CONTROL));
    const facts = await collect(page, { a11y: true, layout: true });
    const negative = [...judgeA11y(facts.a11y).findings, ...layoutProblems(facts.layout)];
    for (const f of negative) problems.push(`The checks cannot be trusted: rule ${f.rule} fired on correct markup (${f.where}).`);
  } finally {
    await context.close().catch(() => {});
  }
  return problems;
}

// ---- Main ----

function parseArgs(argv) {
  const opts = { only: null, viewports: null, shots: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (!v) throw new Error(`${a.split('=')[0]} needs a value.`);
      return v;
    };
    if (a.startsWith('--only')) opts.only = value().split(',').map(s => s.trim()).filter(Boolean);
    else if (a.startsWith('--viewports')) opts.viewports = value().split(',').map(s => s.trim()).filter(Boolean);
    else if (a.startsWith('--shots')) opts.shots = path.resolve(value());
    else throw new Error(`Unknown option ${a}.`);
  }
  const sections = ['overflow', 'drawers', 'save', 'a11y'];
  const badSection = (opts.only ?? []).find(s => !sections.includes(s));
  if (badSection) throw new Error(`--only takes ${sections.join(', ')}, not ${badSection}.`);
  const labels = CHECK_VIEWPORTS.map(v => v.label);
  const badWidth = (opts.viewports ?? []).find(v => !labels.includes(v));
  if (badWidth) throw new Error(`--viewports takes ${labels.join(', ')}, not ${badWidth}.`);
  return opts;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { baseline: {}, exists: false };
  return { baseline: JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')), exists: true };
}

const say = line => console.log(line);

async function main(cleanup) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    say(`check:canvas could not run. ${err.message}`);
    return 2;
  }
  const requested = [...(opts.only ?? ['overflow', 'drawers', 'save', 'a11y']), 'runtime'];
  const viewports = CHECK_VIEWPORTS.filter(v => !opts.viewports || opts.viewports.includes(v.label));
  const scenarios = SCENARIOS.filter(s => s.sections.some(sec => requested.includes(sec)));
  const partial = !!opts.only || viewports.length !== CHECK_VIEWPORTS.length;

  const pwPath = process.env.PLAYWRIGHT_MODULE || path.resolve(ROOT, '../../node_modules/playwright/index.mjs');
  if (!fs.existsSync(pwPath)) {
    say(`check:canvas could not run. Playwright was not found at ${pwPath}.`);
    return 2;
  }
  const chromePath = process.env.CHROME_PATH || DEFAULT_CHROME;
  if (!fs.existsSync(chromePath)) {
    say(`check:canvas could not run. Chrome was not found at ${chromePath}.`);
    return 2;
  }
  const { chromium } = await import(pathToFileURL(pwPath).href);
  if (opts.shots) fs.mkdirSync(path.join(opts.shots, 'keyboard'), { recursive: true });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-canvas-check-'));
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-canvas-env-'));
  cleanup.dirs.push(work, envDir);
  const outDir = path.join(work, 'dist');
  try {
    await build({ root: ROOT, envDir, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  } catch (err) {
    say(`check:canvas could not run. The app did not build: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }
  let origin;
  let port;
  try {
    port = Number(process.env.CHECK_CANVAS_PORT) || (await freePort());
    const server = await preview({
      root: ROOT,
      envDir,
      logLevel: 'warn',
      build: { outDir },
      preview: { host: '127.0.0.1', port, strictPort: true, proxy: {}, open: false }
    });
    cleanup.server = server;
    origin = new URL(server.resolvedUrls.local[0]).origin;
  } catch (err) {
    say(`check:canvas could not run. The preview could not bind port ${port ?? 'on 127.0.0.1'}: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }

  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  cleanup.browser = browser;

  const controlProblems = await runControls(browser);
  if (controlProblems.length) {
    for (const p of controlProblems) say(p);
    return 2;
  }

  const run = { origin, requested, shots: opts.shots, blocked: [] };
  const all = [];
  const unmeasured = [];
  const notes = [];
  const incomplete = new Set();
  say(`Journey map browser check: ${scenarios.length} scenarios at ${viewports.map(v => v.label).join(', ')}px. Hand-written rules, not axe.`);
  for (const viewport of viewports) {
    for (const scenario of scenarios) {
      const result = await runScenario(browser, scenario, viewport, run);
      all.push(...result.findings);
      unmeasured.push(...result.unmeasured);
      if (!result.completed) {
        for (const s of scenario.sections) incomplete.add(s);
        if (result.note) notes.push(result.note);
      }
    }
  }

  // #19's checks drive their own widths (1440, and 390 or 1280 where they say so), so a run held to
  // some widths leaves them out rather than reaching past what it was asked for.
  if (requested.includes('a11y')) {
    if (viewports.length === CHECK_VIEWPORTS.length) {
      const results = await runA11yChecks(browser, {
        base: origin,
        seed: DEFAULT_LEAD_CAPTURE_PROJECT,
        shots: opts.shots ? path.join(opts.shots, 'keyboard') : null,
        blocked: run.blocked
      });
      for (const [name, check] of Object.entries(CANVAS_KEYBOARD_CHECKS)) {
        try {
          results[name] = await check(browser, run);
        } catch (err) {
          results[name] = { error: String(err?.message || err).split('\n')[0] };
        }
      }
      const keyboard = keyboardFindings(results);
      all.push(...keyboard.findings);
      const ranChecks = Object.keys(results).length - keyboard.notRun.length;
      notes.push(`#19 keyboard checks: ${ranChecks} of ${Object.keys(results).length} ran, with ${keyboard.findings.length} finding${keyboard.findings.length === 1 ? '' : 's'} (reported under a11y).`);
      if (keyboard.notRun.length) {
        incomplete.add('a11y');
        notes.push(...keyboard.notRun);
      }
    } else {
      notes.push("#19's keyboard checks were left out, because they run at their own widths and --viewports held this run to fewer.");
    }
  }

  const findings = dedupeFindings(all.filter(f => requested.includes(f.section)));
  const ran = requested.filter(s => !incomplete.has(s) && (s === 'runtime' || scenarios.some(sc => sc.sections.includes(s))));
  let baselineRead;
  try {
    baselineRead = readBaseline();
  } catch (err) {
    say(`check:canvas could not run. The baseline file does not parse: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }
  const { baseline, exists } = baselineRead;
  const counts = countByRule(findings);
  const zeroOnly = [...ZERO_ONLY_RULES, ...KEYBOARD_RULES, ...BROWSER_SAVE_RULES];
  const verdict = ratchetVerdict(counts, baseline, zeroOnly, { knownRules: [...CHECK_RULES, ...A11Y_RULES, ...KEYBOARD_RULES, ...BROWSER_SAVE_RULES], partial, ranSections: ran });

  say(formatReport({ requested, ran, findings, verdict, baseline, zeroOnly }));
  for (const n of notes) say(n.startsWith("#19's") || n.startsWith('#19 keyboard checks:') ? n : `could not run: ${n}`);

  const seen = new Map();
  for (const u of unmeasured) seen.set(findingKey({ section: 'a11y', rule: u.rule, where: u.where }), u.reason);
  const reasons = {};
  for (const r of seen.values()) reasons[r] = (reasons[r] ?? 0) + 1;
  const reasonText = Object.entries(reasons).map(([r, n]) => `${r} ${n}`).join(', ');
  if (requested.includes('a11y')) say(`Unmeasured contrast: ${seen.size}${reasonText ? ` (${reasonText})` : ''}. These are not passes.`);

  if ((!exists || verdict.stale.length) && !partial) {
    const paste = {};
    for (const [rule, count] of Object.entries(counts).sort()) {
      if (!zeroOnly.includes(rule)) paste[rule] = { count, owner: baseline[rule]?.owner ?? '#<item> <owner>' };
    }
    say(`${exists ? 'New' : 'No baseline file yet. Current'} counts to paste into scripts/canvas-browser-check.baseline.json:`);
    say(JSON.stringify(paste, null, 2));
  }

  const hosts = [...new Set(run.blocked.map(b => {
    const target = b.split(' ')[1] ?? '';
    const host = target.split('/')[0];
    return host === new URL(origin).host ? `${host}${target.slice(host.length).split('/').slice(0, 2).join('/')}` : host;
  }))].sort();
  say(`Blocked ${run.blocked.length} outside requests (${hosts.join(', ') || 'none'}). Nothing reached a server.`);

  return exitCode({ requested, ran, controlsFailed: false, verdict, findings, zeroOnly });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cleanup = { dirs: [], server: null, browser: null, done: false };
  const finish = async () => {
    if (cleanup.done) return;
    cleanup.done = true;
    await cleanup.browser?.close().catch(() => {});
    await cleanup.server?.close().catch(() => {});
    for (const d of cleanup.dirs) fs.rmSync(d, { recursive: true, force: true });
  };
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      finish().finally(() => process.exit(2));
    });
  }
  main(cleanup)
    .catch(err => {
      say(`check:canvas could not run. ${String(err?.message || err).split('\n')[0]}`);
      return 2;
    })
    .then(async code => {
      await finish();
      process.exit(code);
    });
}
