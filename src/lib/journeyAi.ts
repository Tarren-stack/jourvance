// The AI journey builder's rules (#25, ported from the rules in Aura's funnelAi.ts, not its look).
// The model writes copy only. This file checks the shape of what it sent (readAiPlan), checks
// the copy a person edits on the review screen (planProblems, claimFlags), and builds the map in
// code (buildJourneyFromPlan): every node, line, handle, slug and position comes from here, and
// product, price, discount, urgency and image fields stay empty. Nothing here sends or saves.
// Value imports carry an explicit .ts so `node --test` can load this file directly.

import { walkJourney } from './journeyWalk.ts';
import type { WalkChoices, WalkAction } from './journeyWalk';
import { SOURCE_HANDLES, stepHasHandle } from './stepHandles.ts';
import type {
  JourneyProject,
  JourneyNode,
  JourneyEdge,
  NodeType,
  AdNodeData,
  AbSplitNodeData,
  PageNodeData,
  FormNodeData,
  UpsellNodeData,
  ThankYouNodeData,
  SequenceNodeData,
  SequenceStep
} from '../types/journey';
import type { Refusal, ServerAnswer } from './saveOutcome';

// The per-step handle table lives in stepHandles.ts (#31). It is re-exported, never typed again.
export { SOURCE_HANDLES };

// ---- The brief ----

export type AiPlatform = 'meta' | 'google' | 'tiktok' | 'organic';

export interface JourneyAiBrief {
  goal: 'leads' | 'sales';
  /** What is being promoted. The only facts the copy may use. */
  offer: string;
  audience: string;
  businessType: string;
  platform: AiPlatform;
  abTest: boolean;
  upsell: boolean;
}

export const DEFAULT_BRIEF: JourneyAiBrief = {
  goal: 'leads',
  offer: '',
  audience: '',
  businessType: '',
  platform: 'meta',
  abTest: false,
  upsell: false
};

/** The same caps as server/routes/aiJourneyRoutes.mjs. ai-journey-route.test.mjs pins them equal. */
export const BRIEF_LIMITS = { offer: 1000, audience: 300, businessType: 120 };

export const AI_PLATFORMS: AiPlatform[] = ['meta', 'google', 'tiktok', 'organic'];

export const AI_DRAFT_STORAGE_KEY = 'jourvance_ai_draft';

export const PLAN_LIMITS = {
  name: 80,
  strategy: 600,
  assumption: 200,
  assumptions: 6,
  hypothesis: 300,
  reason: 300,
  ad: { headline: 80, body: 300, cta: 30 },
  page: { title: 60, headline: 120, subhead: 300, bullet: 160, bullets: 5, button: 40, decline: 80 },
  form: { title: 120, button: 40, success: 200 },
  email: { name: 80, subject: 120, preview: 150, body: 2000, minMessages: 1, maxMessages: 3 },
  delayHours: { min: 0, max: 168 }
} as const;

// ---- The plan ----

export type AiPageRole = 'landing' | 'landing-b' | 'upsell' | 'thanks';
export type AiEmailRole = 'followup' | 'recovery';

export interface AiPlanPage {
  role: AiPageRole;
  title: string;
  headline: string;
  subhead: string;
  bullets: string[];
  button: string;
  decline: string;
  reason: string;
}

export interface AiPlanForm {
  title: string;
  button: string;
  success: string;
  reason: string;
}

export interface AiPlanMessage {
  subject: string;
  preview: string;
  body: string;
  /** Hours since the previous email. The first counts from joining. */
  delayHours: number;
}

export interface AiPlanEmail {
  role: AiEmailRole;
  name: string;
  reason: string;
  messages: AiPlanMessage[];
}

export interface JourneyAiPlan {
  name: string;
  strategy: string;
  assumptions: string[];
  hypothesis: string;
  ad: { headline: string; body: string; cta: string; reason: string };
  pages: AiPlanPage[];
  form: AiPlanForm | null;
  emails: AiPlanEmail[];
}

export interface PlanRoles {
  pages: AiPageRole[];
  form: boolean;
  emails: AiEmailRole[];
}

/** The steps a brief asks for, in path order. The server's planRolesFor must match this. */
export function requiredPlanRoles(brief: Pick<JourneyAiBrief, 'goal' | 'abTest' | 'upsell'>): PlanRoles {
  const sales = brief.goal === 'sales';
  return {
    pages: ['landing', ...(brief.abTest ? ['landing-b' as const] : []), ...(sales && brief.upsell ? ['upsell' as const] : []), 'thanks'],
    form: brief.goal === 'leads',
    emails: ['followup', ...(sales ? ['recovery' as const] : [])]
  };
}

const PAGE_NAMES: Record<string, string> = {
  landing: 'landing page',
  'landing-b': 'version B landing page',
  upsell: 'upsell page',
  thanks: 'thank-you page'
};

const EMAIL_NAMES: Record<string, string> = {
  followup: 'follow-up emails',
  recovery: 'checkout recovery emails'
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A plain brief from anything (saved drafts, the form), or null when it is not one. */
export function normalizeBrief(raw: unknown): JourneyAiBrief | null {
  if (!isObject(raw)) return null;
  if (raw.goal !== 'leads' && raw.goal !== 'sales') return null;
  const str = (v: unknown, cap: number) => (typeof v === 'string' ? v.slice(0, cap) : '');
  const platform = AI_PLATFORMS.includes(raw.platform as AiPlatform) ? (raw.platform as AiPlatform) : 'meta';
  return {
    goal: raw.goal,
    offer: str(raw.offer, BRIEF_LIMITS.offer),
    audience: str(raw.audience, BRIEF_LIMITS.audience),
    businessType: str(raw.businessType, BRIEF_LIMITS.businessType),
    platform,
    abTest: raw.abTest === true,
    upsell: raw.goal === 'sales' && raw.upsell === true
  };
}

class PlanShapeError extends Error {}

function shapeFail(message: string): never {
  throw new PlanShapeError(message);
}

// A missing text field reads as empty, so planProblems names it on the review screen instead of
// wasting a paid draft. A field of the wrong kind is a broken plan.
function readString(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key];
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') shapeFail(`The ${where} ${key} is not text.`);
  return v;
}

function readStrings(obj: Record<string, unknown>, key: string, where: string): string[] {
  const v = obj[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) shapeFail(`The ${where} ${key} is not a list.`);
  return v.map((item, i) => {
    if (typeof item !== 'string') shapeFail(`Item ${i + 1} of the ${where} ${key} is not text.`);
    return item;
  });
}

function readDelay(v: unknown, where: string): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return shapeFail(`The wait on ${where} is not a number.`);
}

/**
 * Checks the STRUCTURE of the model's answer: the exact page and email roles for this brief, each
 * once, a form exactly when the brief needs one, lists that are lists and waits that are numbers.
 * Content (empty, too long, links) is planProblems' job on the editable copy.
 */
export function readAiPlan(raw: unknown, brief: JourneyAiBrief): { plan: JourneyAiPlan } | { problem: string } {
  try {
    if (!isObject(raw)) shapeFail('The answer is not a plan.');
    const roles = requiredPlanRoles(brief);

    const ad = raw.ad;
    if (!isObject(ad)) shapeFail('The plan has no ad.');

    if (!Array.isArray(raw.pages)) shapeFail('The plan pages are not a list.');
    const pagesByRole = new Map<string, AiPlanPage>();
    for (const p of raw.pages) {
      if (!isObject(p)) shapeFail('A page in the plan is not a page.');
      const role = typeof p.role === 'string' ? p.role : '';
      if (!(roles.pages as string[]).includes(role)) {
        shapeFail(role ? `The plan has a page with the role "${role.slice(0, 40)}", which this journey does not use.` : 'A page in the plan has no role.');
      }
      if (pagesByRole.has(role)) shapeFail(`The plan has more than one ${PAGE_NAMES[role]}.`);
      const where = PAGE_NAMES[role];
      pagesByRole.set(role, {
        role: role as AiPageRole,
        title: readString(p, 'title', where),
        headline: readString(p, 'headline', where),
        subhead: readString(p, 'subhead', where),
        bullets: readStrings(p, 'bullets', where),
        button: readString(p, 'button', where),
        decline: readString(p, 'decline', where),
        reason: readString(p, 'reason', where)
      });
    }
    for (const role of roles.pages) if (!pagesByRole.has(role)) shapeFail(`The plan is missing the ${PAGE_NAMES[role]}.`);

    let form: AiPlanForm | null = null;
    const rawForm = raw.form;
    const hasForm = rawForm !== undefined && rawForm !== null;
    if (roles.form && !hasForm) shapeFail('The plan is missing the sign-up form.');
    if (!roles.form && hasForm) shapeFail('The plan has a sign-up form, but a sales journey does not use one.');
    if (hasForm) {
      if (!isObject(rawForm)) shapeFail('The sign-up form in the plan is not a form.');
      form = {
        title: readString(rawForm, 'title', 'sign-up form'),
        button: readString(rawForm, 'button', 'sign-up form'),
        success: readString(rawForm, 'success', 'sign-up form'),
        reason: readString(rawForm, 'reason', 'sign-up form')
      };
    }

    if (!Array.isArray(raw.emails)) shapeFail('The plan emails are not a list.');
    const emailsByRole = new Map<string, AiPlanEmail>();
    for (const e of raw.emails) {
      if (!isObject(e)) shapeFail('An email flow in the plan is not a flow.');
      const role = typeof e.role === 'string' ? e.role : '';
      if (!(roles.emails as string[]).includes(role)) {
        shapeFail(role ? `The plan has an email flow with the role "${role.slice(0, 40)}", which this journey does not use.` : 'An email flow in the plan has no role.');
      }
      if (emailsByRole.has(role)) shapeFail(`The plan has the ${EMAIL_NAMES[role]} twice.`);
      const where = EMAIL_NAMES[role];
      if (!Array.isArray(e.messages)) shapeFail(`The ${where} are not a list.`);
      const count = e.messages.length;
      if (count < PLAN_LIMITS.email.minMessages) shapeFail(`The ${where} have no messages.`);
      if (count > PLAN_LIMITS.email.maxMessages) shapeFail(`The ${where} have ${count} messages. The most is ${PLAN_LIMITS.email.maxMessages}.`);
      const messages = e.messages.map((m: unknown, i: number) => {
        if (!isObject(m)) shapeFail(`Message ${i + 1} of the ${where} is not a message.`);
        const at = `message ${i + 1} of the ${where}`;
        return {
          subject: readString(m, 'subject', at),
          preview: readString(m, 'preview', at),
          body: readString(m, 'body', at),
          delayHours: readDelay(m.delayHours, at)
        };
      });
      emailsByRole.set(role, { role: role as AiEmailRole, name: readString(e, 'name', where), reason: readString(e, 'reason', where), messages });
    }
    for (const role of roles.emails) if (!emailsByRole.has(role)) shapeFail(`The plan is missing the ${EMAIL_NAMES[role]}.`);

    return {
      plan: {
        name: readString(raw, 'name', 'plan'),
        strategy: readString(raw, 'strategy', 'plan'),
        assumptions: readStrings(raw, 'assumptions', 'plan'),
        hypothesis: readString(raw, 'hypothesis', 'plan'),
        ad: {
          headline: readString(ad, 'headline', 'ad'),
          body: readString(ad, 'body', 'ad'),
          cta: readString(ad, 'cta', 'ad'),
          reason: readString(ad, 'reason', 'ad')
        },
        pages: roles.pages.map(r => pagesByRole.get(r)!),
        form,
        emails: roles.emails.map(r => emailsByRole.get(r)!)
      }
    };
  } catch (err) {
    if (err instanceof PlanShapeError) return { problem: err.message };
    throw err;
  }
}

// ---- Field names ----

const PAGE_LABELS: Record<AiPageRole, string> = {
  landing: 'Landing page',
  'landing-b': 'Version B landing page',
  upsell: 'Upsell page',
  thanks: 'Thank-you page'
};

const EMAIL_LABELS: Record<AiEmailRole, string> = {
  followup: 'Follow-up email',
  recovery: 'Recovery email'
};

const FIELD_WORDS: Record<string, string> = {
  title: 'title',
  headline: 'headline',
  subhead: 'subhead',
  bullets: 'bullet points',
  button: 'button',
  decline: 'decline link',
  body: 'body',
  cta: 'button',
  success: 'success message',
  subject: 'subject',
  preview: 'preview text',
  delayHours: 'wait',
  name: 'name'
};

/** The words a person reads for a field key, such as 'Landing page headline'. */
export function fieldLabel(field: string): string {
  const parts = field.split('.');
  if (field === 'name') return 'Journey name';
  if (field === 'hypothesis') return 'Test hypothesis';
  if (field === 'assumptions') return 'Assumptions';
  if (parts[0] === 'ad') return `Ad ${FIELD_WORDS[parts[1]] || parts[1]}`;
  if (parts[0] === 'form') return `Sign-up form ${FIELD_WORDS[parts[1]] || parts[1]}`;
  if (parts[0] === 'pages') return `${PAGE_LABELS[parts[1] as AiPageRole] || 'Page'} ${FIELD_WORDS[parts[2]] || parts[2]}`;
  if (parts[0] === 'emails') {
    const who = EMAIL_LABELS[parts[1] as AiEmailRole] || 'Email';
    if (parts[2] === 'name') return `${who} flow name`;
    return `${who} ${Number(parts[2]) + 1} ${FIELD_WORDS[parts[3]] || parts[3]}`;
  }
  return field;
}

/** The review screen's input id for a field key. Bullets and assumptions are one box each. */
export function fieldInputId(field: string): string {
  return `ai-${field.replace(/\./g, '-')}`;
}

// ---- Content checks on the editable plan ----

export interface PlanProblem {
  field: string;
  message: string;
}

const HTML_TAG = /<\/?[a-z][^>]*>/i;
const LINK = /https?:\/\/|www\./i;

/** Every copy field a person edits, with its key, value and cap. Bullets and assumptions are lists. */
interface CopyField {
  field: string;
  value: string;
  cap: number;
  required: boolean;
}

function copyFields(plan: JourneyAiPlan, brief: JourneyAiBrief): CopyField[] {
  const out: CopyField[] = [];
  const add = (field: string, value: string, cap: number, required: boolean) => out.push({ field, value, cap, required });
  add('name', plan.name, PLAN_LIMITS.name, true);
  if (brief.abTest) add('hypothesis', plan.hypothesis, PLAN_LIMITS.hypothesis, true);
  add('ad.headline', plan.ad.headline, PLAN_LIMITS.ad.headline, true);
  add('ad.body', plan.ad.body, PLAN_LIMITS.ad.body, true);
  add('ad.cta', plan.ad.cta, PLAN_LIMITS.ad.cta, true);
  for (const page of plan.pages) {
    const k = `pages.${page.role}`;
    const thanks = page.role === 'thanks';
    add(`${k}.title`, page.title, PLAN_LIMITS.page.title, true);
    add(`${k}.headline`, page.headline, PLAN_LIMITS.page.headline, true);
    add(`${k}.subhead`, page.subhead, PLAN_LIMITS.page.subhead, true);
    if (!thanks) add(`${k}.button`, page.button, PLAN_LIMITS.page.button, true);
    if (page.role === 'upsell') add(`${k}.decline`, page.decline, PLAN_LIMITS.page.decline, true);
  }
  if (plan.form) {
    add('form.title', plan.form.title, PLAN_LIMITS.form.title, true);
    add('form.button', plan.form.button, PLAN_LIMITS.form.button, true);
    add('form.success', plan.form.success, PLAN_LIMITS.form.success, true);
  }
  for (const flow of plan.emails) {
    const k = `emails.${flow.role}`;
    add(`${k}.name`, flow.name, PLAN_LIMITS.email.name, true);
    flow.messages.forEach((m, i) => {
      add(`${k}.${i}.subject`, m.subject, PLAN_LIMITS.email.subject, true);
      add(`${k}.${i}.preview`, m.preview, PLAN_LIMITS.email.preview, false);
      add(`${k}.${i}.body`, m.body, PLAN_LIMITS.email.body, true);
    });
  }
  return out;
}

function textProblems(field: string, value: string, cap: number, required: boolean, label = fieldLabel(field)): string | null {
  if (required && !value.trim()) return `${label} is empty.`;
  if (value.length > cap) return `${label} is ${value.length} characters. The most is ${cap}.`;
  if (HTML_TAG.test(value)) return `${label} has an HTML tag. Use plain text.`;
  if (LINK.test(value)) return `${label} has a link. Remove it. Plain text only.`;
  return null;
}

/**
 * The CONTENT problems on the editable plan. Each one names a field key the review screen can
 * take a person to. Create stays blocked while any remain.
 */
export function planProblems(plan: JourneyAiPlan, brief: JourneyAiBrief): PlanProblem[] {
  const out: PlanProblem[] = [];
  const push = (field: string, message: string | null) => {
    if (message) out.push({ field, message });
  };
  for (const f of copyFields(plan, brief)) push(f.field, textProblems(f.field, f.value, f.cap, f.required));

  // Lists are edited one item per line, so a blank line is not an item.
  const assumptions = plan.assumptions.filter(a => a.trim());
  if (assumptions.length > PLAN_LIMITS.assumptions) {
    push('assumptions', `There are ${assumptions.length} assumptions. The most is ${PLAN_LIMITS.assumptions}.`);
  }
  assumptions.forEach((a, i) => push('assumptions', textProblems('assumptions', a, PLAN_LIMITS.assumption, false, `Assumption ${i + 1}`)));

  for (const page of plan.pages) {
    if (page.role === 'thanks') continue;
    const field = `pages.${page.role}.bullets`;
    const label = fieldLabel(field);
    const bullets = page.bullets.filter(b => b.trim());
    if (!bullets.length) push(field, `${label} are empty.`);
    if (bullets.length > PLAN_LIMITS.page.bullets) push(field, `${label}: ${bullets.length} lines. The most is ${PLAN_LIMITS.page.bullets}.`);
    bullets.forEach((b, i) => push(field, textProblems(field, b, PLAN_LIMITS.page.bullet, false, `${label}, line ${i + 1},`)));
  }

  const a = plan.pages.find(p => p.role === 'landing');
  const b = plan.pages.find(p => p.role === 'landing-b');
  if (a && b && a.headline.trim() && a.headline.trim().toLowerCase() === b.headline.trim().toLowerCase()) {
    push('pages.landing-b.headline', 'Both versions have the same headline, so the test cannot tell them apart. Change one.');
  }

  for (const flow of plan.emails) {
    flow.messages.forEach((m, i) => {
      const field = `emails.${flow.role}.${i}.delayHours`;
      const h = m.delayHours;
      if (!Number.isInteger(h) || h < PLAN_LIMITS.delayHours.min || h > PLAN_LIMITS.delayHours.max) {
        push(field, `${fieldLabel(field)} must be a whole number of hours from ${PLAN_LIMITS.delayHours.min} to ${PLAN_LIMITS.delayHours.max}.`);
      }
    });
  }
  return out;
}

/** Why Create is off, or null when it is on. */
export function createBlocker(plan: JourneyAiPlan, brief: JourneyAiBrief, reviewed: boolean): string | null {
  if (planProblems(plan, brief).length) return 'Fix the problems above first.';
  if (!reviewed) return 'Tick the review box to create.';
  return null;
}

// ---- Claims the brief does not back ----

export interface ClaimFlag {
  field: string;
  label: string;
  text: string;
}

const CLAIM_PATTERNS: RegExp[] = [
  /[$€£]\s?\d[\d,.]*/g,
  /\d+(?:[.,]\d+)?\s?(?:%|percent\b)/gi,
  /\b\d[\d,.]*\+?[\s-]?(?:days?|hours?|minutes?|weeks?|months?|years?|customers?|clients?|reviews?|stars?|orders?|people|users?|members?|buyers?|students?|patients?|sold)\b/gi,
  /\b\d(?:\.\d+)?\s?\/\s?5\b/g,
  // "Rated 4.9" and "4.8 rating"; "4.9/5" and "4.9 stars" are caught above, so they are skipped here.
  /\brated\s(?:at\s)?\d(?:\.\d+)?(?![\d.]|\s?\/\s?5\b|\s?stars?\b)/gi,
  /\b\d\.\d+\s?rating\b/gi,
  /#1\b/g,
  /\b(?:guarantee[sd]?|money-back|risk-free|refunds?|clinically|proven|certified|award-winning|best-selling|free shipping|limited time|only \d+ left|expires?|testimonials?|dermatologists?|organic|natural|vegan|cruelty-free)\b/gi
];

const normalizeClaim = (s: string) =>
  s
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/([$€£])\s+/g, '$1')
    .replace(/[\s-]+/g, ' ')
    .trim();

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether the brief contains this claim as a whole figure: "$14" is not backed by "$149",
 * "2 weeks" not by "12 weeks", "0%" not by "100%". A rating is compared by its number, so
 * "rated 4.9" is backed by a brief that says "4.9 stars".
 */
function briefBacks(backed: string, norm: string): boolean {
  const core = norm.replace(/^rated (?:at )?/, '').replace(/ ?rating$/, '');
  return new RegExp(`(?<!\\d[.,]?)${escapeRegExp(core)}(?![.,]?\\d)`).test(backed);
}

/** Every copy string with its field key, bullets and emails included. */
function claimSources(plan: JourneyAiPlan, brief: JourneyAiBrief): { field: string; value: string }[] {
  const out = copyFields(plan, brief).map(f => ({ field: f.field, value: f.value }));
  for (const page of plan.pages) for (const b of page.bullets) out.push({ field: `pages.${page.role}.bullets`, value: b });
  return out;
}

/**
 * Prices, percentages, counts, ratings and guarantee or ingredient words in the copy that the
 * person's own brief does not contain. A heuristic: it can miss a claim with no number or keyword.
 */
export function claimFlags(plan: JourneyAiPlan, brief: JourneyAiBrief): ClaimFlag[] {
  const backed = normalizeClaim([brief.offer, brief.audience, brief.businessType].join(' \n '));
  const seen = new Set<string>();
  const out: ClaimFlag[] = [];
  for (const { field, value } of claimSources(plan, brief)) {
    const text = value.replace(/\[first name\]/gi, ' ');
    for (const pattern of CLAIM_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const found = match[0].trim().replace(/[.,]+$/, '');
        const norm = normalizeClaim(found);
        if (!norm || briefBacks(backed, norm)) continue;
        const key = `${field}|${norm}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ field, label: fieldLabel(field), text: found });
      }
    }
  }
  return out;
}

// ---- Building the map ----

/** The wait label SequenceEditor and funnelForecaster already write. */
export function delayLabel(hours: number): string {
  if (hours === 0) return 'Instant (0m)';
  if (hours === 1) return '1 Hour';
  if (hours >= 48 && hours % 24 === 0) return `${hours / 24} Days (${hours}h)`;
  return `${hours} Hours`;
}

export function slugify(text: string): string {
  const s = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'journey';
}

/** Grid spacing for built maps. #12 and #14 can reuse it. */
export const GRID = { x0: 60, y0: 80, dx: 380, dy: 300 };

const cell = (col: number, row: number) => ({ x: GRID.x0 + col * GRID.dx, y: GRID.y0 + row * GRID.dy });

const PLATFORM_LABELS: Record<AiPlatform, string> = {
  meta: 'Meta ad',
  google: 'Google ad',
  tiktok: 'TikTok ad',
  organic: 'Organic post'
};

export interface BuildOptions {
  id: string;
  now: string;
  workspaceId?: string;
}

const nodeId = (id: string, role: string) => `ai-${id}-${role}`;

/**
 * The map Create puts on the canvas, built in code from the reviewed plan. Node types, handles
 * and slugs take the shapes the blueprints already publish (bp2 for leads, bp5 and bp6 for sales).
 * Copy is copied exactly. Every measured number is 0 and nothing is published.
 */
export function buildJourneyFromPlan(plan: JourneyAiPlan, brief: JourneyAiBrief, { id, now, workspaceId }: BuildOptions): JourneyProject {
  const sales = brief.goal === 'sales';
  const suffix = String(id).toLowerCase().replace(/[^a-z0-9]/g, '').slice(-6) || 'draft';
  const base = `${slugify(plan.name).slice(0, 32).replace(/-+$/g, '') || 'journey'}-${suffix}`;
  const page = (role: AiPageRole) => plan.pages.find(p => p.role === role);
  const email = (role: AiEmailRole) => plan.emails.find(e => e.role === role);
  const nodes: JourneyNode[] = [];
  const edges: JourneyEdge[] = [];
  const typeOf = new Map<string, NodeType>();

  const addNode = (role: string, type: NodeType, position: { x: number; y: number }, data: JourneyNode['data']) => {
    const nid = nodeId(id, role);
    typeOf.set(nid, type);
    nodes.push({ id: nid, type, position, data });
    return nid;
  };

  const line = (source: string, target: string, sourceHandle?: string, targetHandle?: string) => {
    const sType = typeOf.get(source);
    const tType = typeOf.get(target);
    // A handle the card does not render draws nothing, so a wrong name here is a bug, not a choice.
    if (!stepHasHandle(sType, 'source', sourceHandle ?? null) || !stepHasHandle(tType, 'target', targetHandle ?? null)) {
      throw new Error(`No ${sourceHandle || 'main'} to ${targetHandle || 'main'} line from ${sType} to ${tType}.`);
    }
    const isRetentionEdge = sourceHandle === 'abandon';
    const edge: JourneyEdge = {
      id: `ai-${id}-e${edges.length + 1}`,
      source,
      target,
      type: 'conversion',
      data: { sourceThroughput: 0, targetCount: 0, rate: 0, isRetentionEdge }
    };
    if (sourceHandle) {
      edge.sourceHandle = sourceHandle;
      edge.data!.sourceHandle = sourceHandle;
    }
    if (targetHandle) {
      edge.targetHandle = targetHandle;
      edge.data!.targetHandle = targetHandle;
    }
    edges.push(edge);
  };

  const sequenceSteps = (role: AiEmailRole): SequenceStep[] =>
    (email(role)?.messages || []).map((m, i) => ({
      id: `step-${i + 1}`,
      channel: 'email',
      delay: delayLabel(m.delayHours),
      subject: m.subject,
      previewText: m.preview,
      body: m.body
    }));

  const landingData = (p: AiPlanPage, slug: string): PageNodeData => ({
    type: 'landing-page',
    label: p.title,
    slug,
    headline: p.headline,
    subhead: p.subhead,
    bullets: p.bullets.filter(b => b.trim()),
    trustBadge: '',
    buttonText: p.button,
    // bp2 gates a lead page with a sign-up form; a sales page goes straight to checkout.
    checkoutMode: sales ? 'direct' : 'lead-gate',
    visitors: 0,
    conversions: 0,
    conversionRate: 0
  });

  // Columns: ad, the split when there is one, the landing pages, then what follows them.
  const ad: AdNodeData = {
    type: 'ad-source',
    label: PLATFORM_LABELS[brief.platform] || 'Ad',
    platform: brief.platform,
    headline: plan.ad.headline,
    body: plan.ad.body,
    ctaText: plan.ad.cta,
    utmCampaign: base,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    spend: 0
  };
  const adId = addNode('ad', 'ad-source', cell(0, 0), ad);
  const L = brief.abTest ? 2 : 1;

  const landingA = page('landing')!;
  const aId = addNode('landing', 'landing-page', cell(L, 0), landingData(landingA, base));
  const landingIds = [aId];
  if (brief.abTest) {
    const split: AbSplitNodeData = {
      type: 'ab-split',
      label: 'A/B test',
      slug: `${base}-split`,
      splitRatio: 50,
      goal: 'conversion_rate',
      branchALabel: 'Version A',
      branchBLabel: 'Version B',
      branchAVisitors: 0,
      branchAConversions: 0,
      branchBVisitors: 0,
      branchBConversions: 0
    };
    const splitId = addNode('split', 'ab-split', cell(1, 0), split);
    const bId = addNode('landing-b', 'landing-page', cell(L, 1), landingData(page('landing-b')!, `${base}-b`));
    landingIds.push(bId);
    line(adId, splitId);
    line(splitId, aId, 'branch-a');
    line(splitId, bId, 'branch-b');
  } else {
    line(adId, aId);
  }

  const thanksPage = page('thanks')!;
  const thanksData: ThankYouNodeData = {
    type: 'thank-you',
    label: thanksPage.title,
    slug: `${base}-thanks`,
    headline: thanksPage.headline,
    subhead: thanksPage.subhead,
    pageViews: 0
  };
  const followup = email('followup');
  const followupData = (): SequenceNodeData => ({
    type: 'follow-up-sequence',
    label: followup?.name || '',
    sequenceTitle: followup?.name || '',
    steps: sequenceSteps('followup'),
    ...(sales ? {} : { sequenceType: 'lead_nurture' as const }),
    contactsEnrolled: 0,
    avgOpenRate: 0,
    avgClickRate: 0
  });

  if (!sales) {
    const f = plan.form!;
    const form: FormNodeData = {
      type: 'lead-form',
      label: 'Sign-up form',
      formTitle: f.title,
      submitButtonText: f.button,
      successMessage: f.success,
      fields: [
        { id: 'f_name', label: 'Name', type: 'text', required: true, enabled: true },
        { id: 'f_email', label: 'Email', type: 'email', required: true, enabled: true },
        { id: 'f_phone', label: 'Phone', type: 'tel', required: false, enabled: true }
      ],
      views: 0,
      submissions: 0,
      completionRate: 0
    };
    const formId = addNode('form', 'lead-form', cell(L + 1, 0), form);
    const thanksId = addNode('thanks', 'thank-you', cell(L + 2, 0), thanksData);
    const followupId = addNode('followup', 'follow-up-sequence', cell(L + 1, 1), followupData());
    for (const lid of landingIds) line(lid, formId);
    line(formId, thanksId);
    line(formId, followupId);
  } else {
    const offer = page('upsell');
    let upsellId: string | null = null;
    if (offer) {
      const upsell: UpsellNodeData = {
        type: 'upsell',
        label: offer.title,
        offerType: 'upsell',
        slug: `${base}-offer`,
        headline: offer.headline,
        subhead: offer.subhead,
        benefits: offer.bullets.filter(b => b.trim()),
        acceptButtonText: offer.button,
        declineButtonText: offer.decline,
        // Prices and products come from the store when a person links one, never from a draft.
        productTitle: '',
        productPrice: '',
        regularPrice: '',
        discountCode: '',
        productImage: '',
        views: 0,
        takes: 0,
        conversionRate: 0
      };
      upsellId = addNode('upsell', 'upsell', cell(L + 1, 0), upsell);
    }
    const thanksId = addNode('thanks', 'thank-you', cell(L + (offer ? 2 : 1), 0), thanksData);
    // The recovery flow sits beside the pages rather than under them: under page A, the line
    // from A's 'abandon' handle would run straight through version B.
    const followupId = addNode('followup', 'follow-up-sequence', cell(L + 1, 2), followupData());
    const recovery = email('recovery');
    const recoveryData: SequenceNodeData = {
      type: 'follow-up-sequence',
      label: recovery?.name || '',
      sequenceTitle: recovery?.name || '',
      steps: sequenceSteps('recovery'),
      sequenceType: 'checkout_recovery',
      isRetentionBranch: true,
      delayHours: recovery?.messages[0]?.delayHours ?? 0,
      smartExitOnPurchase: true,
      contactsEnrolled: 0,
      avgOpenRate: 0,
      avgClickRate: 0
    };
    const recoveryId = addNode('recovery', 'follow-up-sequence', cell(L + 1, 1), recoveryData);
    for (const lid of landingIds) {
      line(lid, upsellId || thanksId);
      line(lid, followupId);
      line(lid, recoveryId, 'abandon', 'retention-in');
    }
    if (upsellId) {
      line(upsellId, thanksId, 'accepted');
      line(upsellId, thanksId, 'declined');
    }
  }

  const project: JourneyProject = {
    id: `journey_ai_${id}`,
    name: plan.name,
    businessType: brief.businessType.trim() || 'Business',
    offerHeadline: (brief.offer.split('\n').find(l => l.trim()) || '').trim().slice(0, 120),
    goal: sales ? 'Turn visitors into customers' : 'Turn visitors into leads',
    nodes,
    edges,
    updatedAt: now
  };
  if (workspaceId) project.workspaceId = workspaceId;
  return project;
}

// ---- The walk-through ----

export interface SimulatedRow {
  key: string;
  title: string;
  detail: string;
}

const quote = (s: string) => `“${s.trim()}”`;

const isSales = (brief: JourneyAiBrief) => brief.goal === 'sales';

function hoursText(h: number): string {
  return h === 1 ? '1 hour' : `${h} hours`;
}

/** 'The first right away, the next 24 hours later, the last 48 hours after that.' */
export function sequenceTimingSentence(delays: number[]): string {
  if (!delays.length) return '';
  const first = delays[0] === 0 ? 'right away' : `${hoursText(delays[0])} after joining`;
  if (delays.length === 1) return `It is due ${first}.`;
  const parts = [`The first ${first}`];
  delays.slice(1).forEach((h, i) => {
    // With three or more, the final one is "the last ... after that"; otherwise "the next ... later".
    const closing = delays.length > 2 && i === delays.length - 2;
    const when = h === 0 ? 'at the same time' : closing ? `${hoursText(h)} after that` : `${hoursText(h)} later`;
    parts.push(`the ${closing ? 'last' : 'next'} ${when}`);
  });
  return `${parts.join(', ')}.`;
}

/**
 * What a simulated visitor sees on the map Create would build, one plain sentence per step.
 * Nothing is sent, charged or recorded, and no row says it was.
 */
export function simulateAiJourney(plan: JourneyAiPlan, brief: JourneyAiBrief, choices: WalkChoices): SimulatedRow[] {
  const project = buildJourneyFromPlan(plan, brief, { id: 'sim', now: '' });
  const byId = new Map(project.nodes.map(n => [n.id, n]));
  const prefix = nodeId('sim', '');
  const walk = walkJourney(project.nodes, project.edges, choices);
  return walk.steps.map((step, i) => {
    const node = byId.get(step.nodeId)!;
    const d = node.data as Record<string, unknown>;
    const role = step.nodeId.slice(prefix.length);
    const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
    let detail = '';
    switch (node.type) {
      case 'ad-source':
        detail = `Sees the ad: ${quote(str('headline'))}. Clicks ${quote(str('ctaText'))}.`;
        break;
      case 'ab-split':
        detail = `Is sent to version ${choices.variant === 'b' ? 'B' : 'A'}.`;
        break;
      case 'landing-page':
        detail = choices.checkout === 'left' && isSales(brief)
          ? `Sees ${quote(str('headline'))}. Leaves without paying.`
          : `Sees ${quote(str('headline'))} and clicks ${quote(str('buttonText'))}.${isSales(brief) ? ' Pays at checkout.' : ''}`;
        break;
      case 'lead-form':
        detail = choices.form === 'left'
          ? `Sees ${quote(str('formTitle'))} and leaves without filling it in.`
          : `Fills in ${quote(str('formTitle'))}.`;
        break;
      case 'upsell':
        detail = `Is offered ${quote(str('headline'))} and ${choices.upsell === 'declined' ? 'declines' : 'accepts'}.`;
        break;
      case 'thank-you':
        detail = `Sees the thank-you page: ${quote(str('headline'))}.`;
        break;
      case 'follow-up-sequence': {
        const flow = plan.emails.find(e => e.role === role);
        const delays = (flow?.messages || []).map(m => m.delayHours);
        const count = delays.length === 1 ? '1 email' : `${delays.length} emails`;
        detail = `Joins ${quote(str('label'))}: ${count}. ${sequenceTimingSentence(delays)} Nothing is sent in this walk-through.`;
        break;
      }
    }
    return { key: `${i}-${step.nodeId}`, title: step.label, detail: detail.replace(/\s+/g, ' ').trim() };
  });
}

export type { WalkChoices, WalkAction };

// ---- The server's answer ----

export type AiPlanOutcome =
  | { kind: 'plan'; plan: JourneyAiPlan }
  | ({ kind: 'refused'; unavailable: boolean; retryAfterMs?: number } & Refusal);

/**
 * The refusal once the hourly limit's wait has passed: Retry can help now, so it is offered, and
 * the sentence no longer names a wait that is over.
 */
export const LIMIT_WAITED_MESSAGE = 'Not drafted. The wait for your hourly AI limit has passed. Try again.';

/** The wait a refusal names, from the answer's retryAfterSeconds: at most an hour, else none. */
function retryAfterMs(body: Record<string, unknown>): number | undefined {
  const s = body.retryAfterSeconds;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? Math.min(3600, Math.ceil(s)) * 1000 : undefined;
}

/** One honest reading of an answer to POST /api/ai/journey-plan. Null means no answer came. */
export function aiPlanOutcome(answer: ServerAnswer | null, brief: JourneyAiBrief): AiPlanOutcome {
  if (!answer) {
    return {
      kind: 'refused',
      message: 'Not drafted because the server could not be reached. Check your connection and try again.',
      retryable: true,
      unavailable: false
    };
  }
  if (answer.status === 401) {
    return { kind: 'refused', message: 'Not drafted because your sign-in has expired. Sign in again, then try once more.', retryable: false, unavailable: false };
  }
  const body = (isObject(answer.body) ? answer.body : {}) as Record<string, unknown>;
  const ok = answer.status >= 200 && answer.status < 300 && body.success === true;
  if (!ok) {
    const said = typeof body.error === 'string' && body.error.trim() ? body.error.trim() : `The server answered with status ${answer.status}.`;
    const retryable = typeof body.retryable === 'boolean'
      ? body.retryable
      : answer.status === 408 || answer.status === 429 || answer.status >= 500;
    const outcome: AiPlanOutcome = { kind: 'refused', message: `Not drafted. ${said}`, retryable, unavailable: body.reason === 'ai-unavailable' };
    // The hourly limit: no Retry now (the server says so), and a wait after which Retry can help.
    const wait = answer.status === 429 && !retryable ? retryAfterMs(body) : undefined;
    return wait === undefined ? outcome : { ...outcome, retryAfterMs: wait };
  }
  const read = readAiPlan(body.plan, brief);
  if ('problem' in read) {
    return {
      kind: 'refused',
      message: `Not drafted. The AI returned a plan Jourvance could not use: ${read.problem} Nothing changed. Try again.`,
      retryable: true,
      unavailable: false
    };
  }
  return { kind: 'plan', plan: read.plan };
}

// ---- The saved draft (sessionStorage), so closing by accident does not waste a paid call ----

export interface SavedAiDraft {
  /** The brief the plan was drafted for, or the brief being written when there is no plan yet. */
  brief: JourneyAiBrief;
  plan: JourneyAiPlan | null;
  /** Brief edits made after going back from a plan. The plan is still checked against `brief`. */
  editedBrief?: JourneyAiBrief;
}

interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readSavedAiDraft(storage: DraftStorage | null | undefined): SavedAiDraft | null {
  try {
    const raw = storage?.getItem(AI_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || parsed.v !== 1) return null;
    const brief = normalizeBrief(parsed.brief);
    if (!brief) return null;
    const read = parsed.plan ? readAiPlan(parsed.plan, brief) : null;
    const plan = read && 'plan' in read ? read.plan : null;
    // Only kept beside a plan, and a bad or unchanged copy is dropped rather than failing the draft.
    const edited = plan && parsed.editedBrief ? normalizeBrief(parsed.editedBrief) : null;
    return edited && JSON.stringify(edited) !== JSON.stringify(brief) ? { brief, plan, editedBrief: edited } : { brief, plan };
  } catch {
    return null;
  }
}

/** Saves the draft, or clears it with null. Answers false when the browser would not store it. */
export function writeSavedAiDraft(storage: DraftStorage | null | undefined, draft: SavedAiDraft | null): boolean {
  try {
    if (!storage) return false;
    if (!draft) {
      storage.removeItem(AI_DRAFT_STORAGE_KEY);
      return true;
    }
    // A wait being typed can be NaN, which JSON writes as null and the reader would refuse. -1
    // keeps the plan readable and shows as a wait problem on the review screen.
    const editedBrief = draft.plan && draft.editedBrief ? draft.editedBrief : undefined;
    const json = JSON.stringify({ v: 1, brief: draft.brief, plan: draft.plan, editedBrief }, (key, value) =>
      key === 'delayHours' && typeof value === 'number' && !Number.isFinite(value) ? -1 : value
    );
    storage.setItem(AI_DRAFT_STORAGE_KEY, json);
    return true;
  } catch {
    return false;
  }
}
