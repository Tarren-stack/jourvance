/**
 * The judging half of the journey map browser check (#11): layout, drawers, the failed save, the
 * request guard, the baseline ratchet, the exit code and the report.
 *
 * scripts/canvas-browser-check.mjs drives real Chrome and only collects facts. Every decision is
 * made here, in pure functions a node test can drive, so a rule can be proven to fire without a
 * browser. No imports and erasable TypeScript only, so Node can strip the types.
 */

// ---- Viewports and sections ----

export const CHECK_VIEWPORTS = [
  { label: '1440', width: 1440, height: 900 },
  { label: '768', width: 768, height: 1024 },
  { label: '390', width: 390, height: 844 }
] as const;

export type CheckViewport = (typeof CHECK_VIEWPORTS)[number];

export const CHECK_SECTIONS = ['overflow', 'drawers', 'save', 'a11y', 'runtime'] as const;
export type CheckSection = (typeof CHECK_SECTIONS)[number];

export interface Finding {
  section: CheckSection;
  rule: string;
  where: string;
  detail: string;
  viewport: string;
  scenario: string;
}

/** A rule's finding before the harness stamps where and when it was seen. */
export interface Problem {
  rule: string;
  where: string;
  detail: string;
}

// ---- Requests ----

/**
 * The route guard: only the preview's own files load. Everything else is aborted, including
 * /api and /p on the preview itself (there is no server behind it) and localhost:3005, where a
 * developer's real server may be running with live keys.
 */
export function routeVerdict(url: string, previewOrigin: string): 'continue' | 'abort' {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'abort';
  }
  if (parsed.origin !== previewOrigin) return 'abort';
  const p = parsed.pathname;
  if (p === '/api' || p.startsWith('/api/') || p === '/p' || p.startsWith('/p/')) return 'abort';
  return 'continue';
}

// ---- Layout ----

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ControlFact {
  where: string;
  rect: Box;
  /** Cut by an overflow hidden or clip ancestor on that axis. */
  clipped: { x: boolean; y: boolean };
  /** A scroll container (or, for y, the page) could bring it into view on that axis. */
  revealable: { x: boolean; y: boolean };
  /** Inside .react-flow__viewport, where panning the map reveals it. */
  inPannableCanvas: boolean;
  /**
   * What sits on top of the control's centre in the same layer (not a menu or drawer opened over
   * it), so a click lands there instead. Null or absent when nothing does.
   */
  coveredBy?: string | null;
}

export interface ClippedBox {
  where: string;
  /** How far the hidden text or control runs past the box's right edge. */
  hiddenPx: number;
  hides: 'text' | 'control';
  ellipsis: boolean;
}

export interface LayoutFacts {
  viewport: { width: number; height: number };
  scrollWidths: { documentElement: number; body: number };
  controls: ControlFact[];
  clippedBoxes: ClippedBox[];
}

export const LAYOUT_RULES = ['page-scroll', 'control-off-screen', 'content-clipped'] as const;

export function layoutProblems(f: LayoutFacts): Problem[] {
  const out: Problem[] = [];
  const vw = f.viewport.width;
  const vh = f.viewport.height;
  const widest = Math.max(f.scrollWidths.documentElement, f.scrollWidths.body);
  if (widest > vw + 1) {
    out.push({ rule: 'page-scroll', where: 'page', detail: `The page is ${widest}px wide on a ${vw}px screen, so it scrolls sideways.` });
  }
  for (const c of f.controls) {
    if (c.inPannableCanvas) continue;
    const offX = c.rect.left < -1 || c.rect.right > vw + 1 || c.clipped.x;
    const offY = c.rect.top < -1 || c.rect.bottom > vh + 1 || c.clipped.y;
    if ((offX && !c.revealable.x) || (offY && !c.revealable.y)) {
      out.push({
        rule: 'control-off-screen',
        where: c.where,
        detail: `This control is cut off (it spans ${Math.round(c.rect.left)} to ${Math.round(c.rect.right)}px across and ${Math.round(c.rect.top)} to ${Math.round(c.rect.bottom)}px down) and nothing can scroll it into view.`
      });
    } else if (c.coveredBy && !c.revealable.x && !c.revealable.y) {
      // Under a sticky footer inside a scroll box is fine: scrolling moves it out from under.
      out.push({
        rule: 'control-off-screen',
        where: c.where,
        detail: `This control is covered by ${c.coveredBy}, so a click lands on that instead.`
      });
    }
  }
  for (const b of f.clippedBoxes) {
    if (b.ellipsis || b.hiddenPx <= 1) continue;
    out.push({
      rule: 'content-clipped',
      where: b.where,
      detail: `This box hides ${Math.round(b.hiddenPx)}px of ${b.hides === 'control' ? 'a control' : 'text'} past its right edge with no scroll and no ellipsis.`
    });
  }
  return out;
}

/** At least one planted example per layout rule, each loaded on its own page at 390px. */
export const LAYOUT_POSITIVE_CONTROL: { rule: (typeof LAYOUT_RULES)[number]; html: string }[] = [
  { rule: 'page-scroll', html: '<div style="width:600px;height:20px;background:#0F172A"></div>' },
  {
    rule: 'control-off-screen',
    html: '<div style="position:relative;width:390px;height:60px;overflow:hidden"><button style="position:absolute;left:380px;top:0;width:60px;height:30px">Cut off</button></div>'
  },
  {
    rule: 'control-off-screen',
    html: '<div style="display:flex;width:200px"><button style="width:120px;height:30px;flex-shrink:0">Under</button><button style="width:120px;height:30px;flex-shrink:0;margin-left:-100px">Over</button></div>'
  },
  {
    rule: 'content-clipped',
    html: '<div style="width:200px;overflow:hidden;white-space:nowrap">This sentence is far too long to fit inside a two hundred pixel box</div>'
  }
];

/** Correct layout: an ellipsis, a button in a scroll strip, a control on the pannable map. */
export const LAYOUT_NEGATIVE_CONTROL: string = [
  '<div style="width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">This sentence is far too long to fit inside a two hundred pixel box</div>',
  '<div style="width:200px;overflow-x:auto;white-space:nowrap"><span style="display:inline-block;width:300px">Wide strip</span><button style="width:60px;height:30px">Reach</button></div>',
  '<div class="react-flow" style="position:relative;width:390px;height:60px;overflow:hidden"><div class="react-flow__viewport" style="position:absolute;left:0;top:0"><button style="position:absolute;left:500px;top:0;width:60px;height:30px">On the map</button></div></div>'
].join('');

// ---- Drawers ----

export interface DrawerFacts {
  /** The drawer's heading, for the report. */
  name: string;
  found: boolean;
  /** A stylesheet rule mentioning .jv-utility is loaded. */
  stylesheetRule: boolean;
  viewport: { width: number; height: number };
  root: { position: string; rect: Box; backgroundColor: string } | null;
  panel: { display: string; flexDirection: string; backgroundColor: string; rect: Box } | null;
  /** The header's last button closed the drawer. Null when it was not tried. */
  closes: boolean | null;
}

export const DRAWER_RULES = ['drawer-missing', 'drawer-stylesheet', 'drawer-overlay', 'drawer-panel', 'drawer-close'] as const;

/** Alpha of an rgb() or rgba() colour; 0 for anything this cannot read. */
function alphaOf(color: string): number {
  const s = String(color ?? '').trim().toLowerCase();
  if (s === 'transparent') return 0;
  const m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (!m) return 0;
  const body = m[1];
  const parts = body.includes('/') ? [body.split('/')[1]] : body.split(',').slice(3);
  if (!parts.length || parts[0] === undefined) return 1;
  const raw = parts[0].trim();
  const n = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function drawerProblems(f: DrawerFacts): Problem[] {
  const where = `"${f.name}" drawer`;
  if (!f.found || !f.root || !f.panel) {
    return [{ rule: 'drawer-missing', where, detail: 'The drawer did not open, so nothing in it was checked.' }];
  }
  const out: Problem[] = [];
  const vw = f.viewport.width;
  const vh = f.viewport.height;
  if (!f.stylesheetRule) {
    out.push({ rule: 'drawer-stylesheet', where, detail: 'No .jv-utility stylesheet is loaded, so the drawer class names style nothing.' });
  }
  const r = f.root.rect;
  const covers = r.left <= 1 && r.top <= 1 && r.right >= vw - 1 && r.bottom >= vh - 1;
  if (f.root.position !== 'fixed' || !covers || alphaOf(f.root.backgroundColor) < 0.2) {
    out.push({ rule: 'drawer-overlay', where, detail: 'The drawer backdrop is not a fixed layer that covers and dims the screen.' });
  }
  const p = f.panel.rect;
  const flush = Math.abs(p.right - vw) <= 1;
  const fullHeight = p.top <= 1 && p.bottom >= vh - 1;
  if (alphaOf(f.panel.backgroundColor) < 1 || f.panel.display !== 'flex' || f.panel.flexDirection !== 'column' || !flush || !fullHeight) {
    out.push({ rule: 'drawer-panel', where, detail: 'The drawer panel is not an opaque, full-height column against the right edge.' });
  }
  if (f.closes === false) {
    out.push({ rule: 'drawer-close', where, detail: "The last button in the drawer's header did not close it." });
  }
  return out;
}

// ---- The failed save ----

export interface SaveFacts {
  signedIn: boolean;
  /** Why the sign-in could not be set up, when it could not. */
  signInReason?: string;
  /** Save POSTs aborted before Try again. */
  postsAttempted: number;
  alertText: string | null;
  /** saveOutcome(null, '').message, the sentence an offline save must show. */
  expectedMessage: string;
  statusText: string;
  /** Every text the save status showed during the run. */
  statusLog: string[];
  retryOffered: boolean;
  /** Save POSTs sent after Try again was clicked. */
  retryPosts: number;
  keptName: string | null;
  expectedName: string;
  dismissed: boolean;
}

export const SAVE_RULES = [
  'save-signed-in',
  'save-not-attempted',
  'save-failure-hidden',
  'save-status',
  'save-claimed',
  'save-no-retry',
  'save-retry-idle',
  'save-not-kept',
  'save-dismiss'
] as const;

export const SIGNED_IN_FAILURE = 'The test user did not sign in, so the failed save was not checked.';

/** True only for a status that claims the journey was saved. 'Not saved' and 'Saving…' are not. */
export function isSavedClaim(text: string | null | undefined): boolean {
  return String(text ?? '').trim().startsWith('Saved');
}

export function saveProblems(f: SaveFacts): Problem[] {
  const where = 'journey toolbar';
  if (!f.signedIn) {
    return [{ rule: 'save-signed-in', where, detail: f.signInReason ? `${SIGNED_IN_FAILURE} ${f.signInReason}` : SIGNED_IN_FAILURE }];
  }
  const out: Problem[] = [];
  if (f.postsAttempted < 1) {
    out.push({ rule: 'save-not-attempted', where, detail: 'Save sent no request to /api/user/<uid>/journey/<id>.' });
  }
  if (!f.alertText || !f.alertText.includes(f.expectedMessage)) {
    out.push({ rule: 'save-failure-hidden', where: 'alert banner', detail: `The banner did not say "${f.expectedMessage}"` });
  }
  if (f.statusText.trim() !== 'Not saved') {
    out.push({ rule: 'save-status', where, detail: `The save status read "${f.statusText.trim()}" instead of "Not saved".` });
  }
  const claims = [...f.statusLog, f.statusText, f.alertText ?? ''].filter(isSavedClaim);
  if (claims.length) {
    out.push({ rule: 'save-claimed', where, detail: `A save that failed was shown as "${claims[0].trim()}".` });
  }
  if (!f.retryOffered) {
    out.push({ rule: 'save-no-retry', where: 'alert banner', detail: 'The banner offered no Try again.' });
  } else if (f.retryPosts < 1) {
    out.push({ rule: 'save-retry-idle', where: 'alert banner', detail: 'Try again sent no new save request.' });
  }
  if (f.keptName !== f.expectedName) {
    out.push({ rule: 'save-not-kept', where, detail: `This browser kept the name "${f.keptName ?? ''}" instead of the edit "${f.expectedName}".` });
  }
  if (!f.dismissed) {
    out.push({ rule: 'save-dismiss', where: 'alert banner', detail: 'Dismiss did not clear the banner.' });
  }
  return out;
}

// ---- Runtime ----

export const RUNTIME_RULES = ['page-error'] as const;

export function pageErrorProblems(messages: string[]): Problem[] {
  return messages.map(m => ({
    rule: 'page-error',
    where: 'page',
    detail: `The page threw an error: ${String(m).split('\n')[0].slice(0, 200)}`
  }));
}

/** Every rule this module owns. The accessibility rules are A11Y_RULES in a11yRules.ts. */
export const CHECK_RULES: string[] = [...LAYOUT_RULES, ...DRAWER_RULES, ...SAVE_RULES, ...RUNTIME_RULES];

/** Rules whose count must be zero. They can never be held by the baseline. */
export const ZERO_ONLY_RULES: string[] = ['page-scroll', 'control-off-screen', ...DRAWER_RULES, ...SAVE_RULES, 'page-error'];

/** The section a rule reports under. */
export function sectionOf(rule: string): CheckSection {
  if ((LAYOUT_RULES as readonly string[]).includes(rule)) return 'overflow';
  if ((DRAWER_RULES as readonly string[]).includes(rule)) return 'drawers';
  if ((SAVE_RULES as readonly string[]).includes(rule)) return 'save';
  if (rule === 'page-error') return 'runtime';
  return 'a11y';
}

// ---- The signed-in fixture ----

/**
 * A Firebase Auth user as @firebase/auth persists it (firebase 12, @firebase/auth 1.13). Seeded
 * into localStorage with every request aborted, Firebase keeps the user when its reload fails with
 * network-request-failed, so the app is signed in without a server. UserImpl._fromJSON asserts
 * createdAt and lastLoginAt are strings: a number makes the sign-in fail silently.
 */
export function signedInUserFixture(apiKey: string, nowMs: number): { key: string; value: Record<string, unknown> } {
  return {
    key: `firebase:authUser:${apiKey}:[DEFAULT]`,
    value: {
      uid: 'browser-check-uid',
      email: 'browser-check@example.invalid',
      emailVerified: false,
      isAnonymous: false,
      providerData: [],
      stsTokenManager: {
        refreshToken: 'browser-check-refresh-token',
        accessToken: 'browser-check-access-token',
        expirationTime: nowMs + 3600000
      },
      createdAt: String(nowMs),
      lastLoginAt: String(nowMs),
      apiKey,
      appName: '[DEFAULT]'
    }
  };
}

/** The web API key from a Firebase config source, in either quote style, or null. */
export function firebaseApiKeyFrom(source: string): string | null {
  const m = /apiKey\s*:\s*(["'])([^"']+)\1/.exec(String(source ?? ''));
  return m ? m[2] : null;
}

// ---- Dedupe ----

export interface MergedFinding extends Finding {
  viewports: string[];
  scenarios: string[];
}

export const findingKey = (f: { section: string; rule: string; where: string }) => `${f.section}|${f.rule}|${f.where}`;

/**
 * Merges only identical keys, so the same element seen at two widths is one finding, while two
 * elements with the same description stay apart by their ordinal.
 */
export function dedupeFindings(findings: Finding[]): MergedFinding[] {
  const byKey = new Map<string, MergedFinding>();
  for (const f of findings) {
    const key = findingKey(f);
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { ...f, viewports: [f.viewport], scenarios: [f.scenario] });
      continue;
    }
    if (!seen.viewports.includes(f.viewport)) seen.viewports.push(f.viewport);
    if (!seen.scenarios.includes(f.scenario)) seen.scenarios.push(f.scenario);
  }
  return [...byKey.values()];
}

export function countByRule(findings: { rule: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.rule] = (counts[f.rule] ?? 0) + 1;
  return counts;
}

// ---- Ratchet ----

export interface BaselineEntry {
  count: number;
  owner: string;
}

export type Baseline = Record<string, BaselineEntry>;

export interface RatchetVerdict {
  over: { rule: string; count: number; allowed: number }[];
  stale: { rule: string; count: number; allowed: number }[];
  forbidden: { rule: string; reason: string }[];
}

/**
 * Known debt may stay at its count and no higher; a lower count must lower the baseline, so a fix
 * can never be undone quietly. `partial` (a run with fewer sections or widths) sees fewer elements,
 * so it can still go over but is never called stale. `knownRules` defaults to this module's rules;
 * the harness passes the accessibility ids as well.
 */
export function ratchetVerdict(
  counts: Record<string, number>,
  baseline: Baseline,
  zeroOnly: string[],
  options: { knownRules?: string[]; partial?: boolean; ranSections?: string[] } = {}
): RatchetVerdict {
  const known = options.knownRules ?? CHECK_RULES;
  const ran = options.ranSections;
  const verdict: RatchetVerdict = { over: [], stale: [], forbidden: [] };
  for (const [rule, entry] of Object.entries(baseline)) {
    if (zeroOnly.includes(rule)) verdict.forbidden.push({ rule, reason: 'This rule must be zero and can never be held by the baseline.' });
    else if (!known.includes(rule)) verdict.forbidden.push({ rule, reason: 'This rule does not exist.' });
    else if (!entry || typeof entry.owner !== 'string' || !entry.owner.includes('#')) verdict.forbidden.push({ rule, reason: 'This entry names no owning backlog item.' });
    else if (!Number.isInteger(entry.count) || entry.count < 1) verdict.forbidden.push({ rule, reason: 'A baseline count must be a whole number of 1 or more.' });
  }
  const allowedFor = (rule: string) => {
    const e = baseline[rule];
    return e && !zeroOnly.includes(rule) && Number.isInteger(e.count) && e.count >= 1 ? e.count : 0;
  };
  for (const [rule, count] of Object.entries(counts)) {
    if (zeroOnly.includes(rule) || count < 1) continue;
    const allowed = allowedFor(rule);
    if (count > allowed) verdict.over.push({ rule, count, allowed });
  }
  if (!options.partial) {
    for (const rule of Object.keys(baseline)) {
      const allowed = allowedFor(rule);
      if (!allowed) continue;
      if (ran && !ran.includes(sectionOf(rule))) continue;
      const count = counts[rule] ?? 0;
      if (count < allowed) verdict.stale.push({ rule, count, allowed });
    }
  }
  return verdict;
}

// ---- Exit ----

/** 2: a requested section did not run, or a control did not fire. 1: findings. 0: clean. */
export function exitCode(input: {
  requested: string[];
  ran: string[];
  controlsFailed: boolean;
  verdict: RatchetVerdict;
  findings: { rule: string }[];
  zeroOnly?: string[];
}): 0 | 1 | 2 {
  if (input.controlsFailed) return 2;
  if (input.requested.some(s => !input.ran.includes(s))) return 2;
  const zeroOnly = input.zeroOnly ?? ZERO_ONLY_RULES;
  const v = input.verdict;
  if (v.over.length || v.stale.length || v.forbidden.length) return 1;
  if (input.findings.some(f => zeroOnly.includes(f.rule))) return 1;
  return 0;
}

// ---- Report ----

const SECTION_TITLES: Record<CheckSection, string> = {
  overflow: 'overflow',
  drawers: 'drawers',
  save: 'save',
  a11y: 'a11y (hand-written rules, not axe)',
  runtime: 'runtime'
};

/**
 * Plain lines, one header per section. A section with no findings is PASS; one whose findings are
 * all held by the baseline is KNOWN with its owners, never PASS, because known debt is not a pass.
 */
export function formatReport(input: {
  requested: string[];
  ran: string[];
  findings: MergedFinding[];
  verdict: RatchetVerdict;
  baseline: Baseline;
  zeroOnly?: string[];
}): string {
  const zeroOnly = input.zeroOnly ?? ZERO_ONLY_RULES;
  const lines: string[] = [];
  const overRules = new Set(input.verdict.over.map(o => o.rule));
  for (const section of CHECK_SECTIONS) {
    const title = SECTION_TITLES[section];
    if (!input.requested.includes(section)) {
      lines.push(`${title}: not requested`);
      continue;
    }
    const mine = input.findings.filter(f => f.section === section);
    if (!input.ran.includes(section)) {
      // A scenario that could not open leaves the section unproven, but what the others found
      // still has to be seen.
      lines.push(mine.length ? `${title}: INCOMPLETE, ${mine.length} finding${mine.length === 1 ? '' : 's'} from the scenarios that ran` : `${title}: DID NOT RUN`);
      for (const f of mine) lines.push(`  ${f.rule}: ${f.where} at ${f.viewports.join(', ')}px in ${f.scenarios.join(', ')}. ${f.detail}`);
      continue;
    }
    if (!mine.length) {
      lines.push(`${title}: PASS`);
      continue;
    }
    const held = mine.every(f => !zeroOnly.includes(f.rule) && input.baseline[f.rule] && !overRules.has(f.rule));
    if (held) {
      const owners = [...new Set(mine.map(f => input.baseline[f.rule].owner))].join(', ');
      lines.push(`${title}: KNOWN ${mine.length} held by the baseline (${owners})`);
      continue;
    }
    lines.push(`${title}: FAIL ${mine.length} finding${mine.length === 1 ? '' : 's'}`);
    for (const f of mine) {
      const heldTag = !zeroOnly.includes(f.rule) && input.baseline[f.rule] && !overRules.has(f.rule) ? ' (known)' : '';
      lines.push(`  ${f.rule}${heldTag}: ${f.where} at ${f.viewports.join(', ')}px in ${f.scenarios.join(', ')}. ${f.detail}`);
    }
  }
  for (const o of input.verdict.over) {
    lines.push(`over the baseline: ${o.rule} has ${o.count}, the baseline allows ${o.allowed}.`);
  }
  for (const s of input.verdict.stale) {
    lines.push(`lower the baseline: ${s.rule} has ${s.count}, the baseline still says ${s.allowed}. Set it to ${s.count}${s.count === 0 ? ' by deleting the entry' : ''}.`);
  }
  for (const f of input.verdict.forbidden) {
    lines.push(`baseline entry refused: ${f.rule}. ${f.reason}`);
  }
  return lines.join('\n');
}
