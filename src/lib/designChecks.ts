// Design checks for any journey (#10, a port of Aura's validateFunnel).
// The old audit scored every journey as a store: the default lead journey read "Audit: 25/100",
// a D, for having no order bump, no upsell and no Shopify price. These checks ask what any
// journey needs instead: a way in, a destination for every exit that needs one, no line the map
// cannot draw, no step nobody reaches, no loop, a headline and a button on every page and a
// headline on every ad, words in every follow-up letter, no instruction left standing in as copy,
// and no blueprint sample offer, code or price left unnoticed.
// They describe the MAP. The published pages route by step type (publicRoutes.mjs), not by these
// lines, so no message here claims that a live page follows them. The one message about a published
// page, button-skips-form, says where its button does NOT follow its line (R18).
//
// A fix changes structure only: lines, and the one setting that decides where a page's button goes
// (checkoutMode), never words. Each one is a FixPlan whose plain sentences
// are written from the same change list that gets applied, so the preview is exactly the edit.
// applyFixPlan and revertFixPlan are all or nothing: either every precondition still holds and
// every change lands, or the project comes back as the same object.
// Pure: no React, no DOM. Value imports carry .ts so `node --test` loads this file directly, and
// type imports are whole `import type` lines (Node keeps an inline `{ type X }` as a real import).

import type { JourneyNode, JourneyEdge, JourneyProject, FunnelForecast } from '../types/journey';
import {
  STEP_BRANCHES,
  branchOf,
  lineIsDrawable,
  reachableFrom,
  findLoopLines,
  nodeLookup,
  stepName,
  typeOf
} from './journeyGraph.ts';
import { checkConnection, withConnection, handleOf } from './connectionRules.ts';
import { endSentence, nameInSentence } from './stepNames.ts';
import { makeLine } from './addStep.ts';
import { isStarterText } from './stepDefaults.ts';
import { ECOM_BLUEPRINTS } from '../data/ecomBlueprints.ts';

// ---- Placeholder copy ----

/**
 * Words a new step is given only so its card is not blank. A page that still shows one has no
 * headline of its own. Keep in step with stepDefaults.ts and defaultBlueprint.ts.
 */
export const PLACEHOLDER_TEXT: ReadonlySet<string> = new Set([
  'your offer headline',
  'your upsell headline',
  'your offer',
  'your headline',
  'your ad headline'
]);

export function isPlaceholderText(s: unknown): boolean {
  return typeof s === 'string' && PLACEHOLDER_TEXT.has(s.trim().toLowerCase());
}

/** Fields that hold words a person writes. No fix ever sets one. */
export const COPY_FIELDS: ReadonlySet<string> = new Set([
  'headline', 'subhead', 'bullets', 'buttonText', 'trustBadge',
  'orderBumpTitle', 'orderBumpPrice', 'orderBumpImage', 'orderBumpHeadline', 'orderBumpDescription',
  'productTitle', 'productPrice', 'regularPrice', 'productImage', 'benefits', 'badgeText',
  'formTitle', 'submitButtonText', 'successMessage', 'acceptButtonText', 'declineButtonText',
  'ctaText', 'body', 'subject', 'previewText', 'sequenceTitle', 'steps'
]);

/** True for a field in COPY_FIELDS or any other orderBump* field (the bump is the person's offer). */
export function isCopyField(field: string): boolean {
  return COPY_FIELDS.has(field) || field.startsWith('orderBump');
}

// ---- Checks ----

export type DesignCheck =
  | 'broken-line'
  | 'hidden-line'
  | 'no-entry'
  | 'several-starts'
  | 'branch-missing'
  | 'branch-duplicate'
  | 'split-same-target'
  | 'unreachable'
  | 'loop'
  | 'page-headline'
  | 'page-button'
  | 'button-skips-form'
  | 'ad-headline'
  | 'ad-button'
  | 'ad-campaign'
  | 'starter-text'
  | 'letter-empty'
  | 'sample-offer';

export interface DesignIssue {
  /** Stable across renders: `${check}:${nodeId}:${edgeId || branch || field}`. */
  key: string;
  check: DesignCheck;
  /** The step the issue is shown on. Absent for a journey-level issue. */
  nodeId?: string;
  edgeId?: string;
  /** The exit, by handle name ('main' for the unnamed exit). */
  branch?: string;
  field?: string;
  message: string;
}

export interface DesignReport {
  issues: DesignIssue[];
  journeyIssues: DesignIssue[];
  /** Only steps with at least one issue are listed. */
  byNode: Record<string, { name: string; messages: string[] }>;
}

interface CopyCheck {
  check: 'page-headline' | 'page-button' | 'ad-headline' | 'ad-button' | 'ad-campaign';
  field: string;
  /** What the field is called in a sentence. */
  what: string;
  missing: string;
}

const HEADLINE: CopyCheck = { check: 'page-headline', field: 'headline', what: 'headline', missing: 'Add a headline.' };

// A follow-up and a split have no page of their own. An ad is not a page, so its headline is its
// own check, but it is still the first words a visitor reads (T10: the starter ad kept
// 'Your ad headline' and nothing said so). Its button text and campaign tag start empty too (U04),
// and an ad with no campaign tag is reported as not measured, so both are listed.
const COPY_CHECKS: Record<string, CopyCheck[]> = {
  'ad-source': [
    { check: 'ad-headline', field: 'headline', what: 'ad headline', missing: 'Add an ad headline.' },
    { check: 'ad-button', field: 'ctaText', what: 'ad button text', missing: 'Add the ad button text.' },
    { check: 'ad-campaign', field: 'utmCampaign', what: 'campaign tag', missing: 'Add a campaign tag so visits from this ad can be counted.' }
  ],
  'landing-page': [HEADLINE, { check: 'page-button', field: 'buttonText', what: 'button text', missing: 'Add button text.' }],
  upsell: [HEADLINE, { check: 'page-button', field: 'acceptButtonText', what: 'yes button text', missing: 'Add the yes button text.' }],
  'lead-form': [
    { check: 'page-headline', field: 'formTitle', what: 'form title', missing: 'Add a form title.' },
    { check: 'page-button', field: 'submitButtonText', what: 'submit button text', missing: 'Add the submit button text.' }
  ],
  'thank-you': [HEADLINE]
};

/**
 * The fields an instruction was ever saved into (STARTER_TEXT in stepDefaults.ts), with what each
 * is called in a sentence. Before R19 those instructions published word for word, and the headline
 * check above never looked past the headline.
 */
const STARTER_FIELDS: Record<string, Record<string, string>> = {
  'ad-source': { body: 'ad text' },
  'landing-page': { subhead: 'subheadline', bullets: 'key benefits' },
  upsell: { subhead: 'subheadline', benefits: 'value points' },
  'thank-you': { subhead: 'subheadline' }
};

/**
 * The drafts a follow-up letter was ever given in place of words: "Replace this before anyone
 * receives it", "Write this subject", and the starter map's "Mention a deadline only if you
 * actually have one." (stepDefaults.ts, sequencePresets.ts, funnelForecaster.ts, the seed scrub in
 * liveStats.ts, server.mjs, and defaultBlueprint.ts before T10). Matched on the phrase, since each
 * draft names a different next step, and never on "replace" alone, which a real letter can say.
 */
const LETTER_INSTRUCTION = /before anyone receives it|\breplace this (?:note|with)\b|^write this subject$|\bonly if (?:you actually have one|it exists in your store|the code exists in your store)\b/i;

/** What each part of a letter is called in a sentence, in the order the editor shows them. */
const LETTER_FIELDS: Array<[field: 'subject' | 'previewText' | 'body', what: string]> = [
  ['subject', 'subject line'],
  ['previewText', 'preview text'],
  ['body', 'message']
];

/** The starter lines a field holds: the value itself, or each line of a list. */
function starterLines(value: unknown): string[] {
  const lines = Array.isArray(value) ? value : [value];
  return lines.filter(isStarterText).map(v => String(v).trim());
}

// ---- Blueprint sample offers ----

// A blueprint is a worked example, so it ships codes, prices, discounts, a countdown and shipping
// promises no store has made (R23). Its cards keep their ids when it loads (BlueprintModal clones
// them), so a step still holding the very value its blueprint shipped is still holding the sample.
// Matching on the step id and the exact value is what keeps a person's own offer out of this: an
// edited line, a price a connected store filled in, or the same words on another step never match.

const SAMPLE_CODE_FIELDS = ['discountCode', 'bounceBackDiscountCode', 'voucherCode'];
const SAMPLE_PRICE_FIELDS = ['productPrice', 'regularPrice', 'orderBumpPrice', 'shopifyProductPrice'];
/** A number that shows on the published page as an offer: "Save 40%", a countdown. */
const SAMPLE_NUMBER_FIELDS = ['discountPercentage', 'urgencyMinutes'];
/** Text fields a blueprint's offers sit in that COPY_FIELDS does not list. */
const SAMPLE_TEXT_FIELDS = ['bounceBackDiscountText', 'usageGuideSteps'];
/** The words of one follow-up message. */
const SAMPLE_STEP_FIELDS = ['subject', 'previewText', 'body'];
/**
 * The words that make a line of sample copy an offer or a claim a store has to stand behind:
 * a discount, a price, a shipping or tracking promise, a gift or bonus, a guarantee, a deadline,
 * a results claim ("3.4x ROI", "in 30 days"), or a count, rating or comparison claim
 * ("3,200+ professionals", "thousands of daily users", "4.9/5", "at half the price").
 */
const OFFER_WORDS = /\d\s?%|[$£€]\s?\d|\bsave\b|\boff\b|shipping|courier|priority (?:dispatch|upgrade)|\binsured\b|\btracking\b|\bgift\b|\bbonus\b|\bcomplimentary\b|money-back|guarantee|warranty|\bexpires?\b|\d(?:\.\d+)?x\b|\bROI\b|\bin \d+ (?:days?|weeks?)\b|\d[\d,]*\+|\bthousands\b|\bhalf the price\b|\d(?:\.\d)?\/5\b/i;

/** What a field is called in a sentence. Codes and prices are quoted, the rest are named. */
const SAMPLE_NAMES: Record<string, string> = {
  headline: 'headline', subhead: 'subheadline', body: 'ad text', ctaText: 'ad button text', buttonText: 'button text',
  bullets: 'key benefits', trustBadge: 'trust badge', discountCode: 'discount code', shopifyProductPrice: 'product price',
  orderBumpPrice: 'order bump price', orderBumpDescription: 'order bump description', orderBumpHeadline: 'order bump headline',
  badgeText: 'badge', productPrice: 'price', regularPrice: 'regular price', benefits: 'value points',
  acceptButtonText: 'yes button text', declineButtonText: 'no button text', bounceBackDiscountCode: 'discount code',
  bounceBackDiscountText: 'perk description', usageGuideSteps: 'guide steps', voucherCode: 'voucher code'
};
const QUOTED = new Set([...SAMPLE_CODE_FIELDS, ...SAMPLE_PRICE_FIELDS, 'badgeText', 'bounceBackDiscountText']);

type SampleValues = Map<string, Set<string | number>>;
let sampleIndex: Map<string, SampleValues> | null = null;

/** Every blueprint step's sample offers, codes and prices by field (sequence emails as `steps.<field>`). */
function blueprintSamples(): Map<string, SampleValues> {
  if (sampleIndex) return sampleIndex;
  const codes = ECOM_BLUEPRINTS.flatMap(b => b.nodes.flatMap(n => SAMPLE_CODE_FIELDS.map(f => (n.data as Record<string, unknown>)?.[f])))
    .filter((c): c is string => typeof c === 'string' && c.trim() !== '');
  const hasCode = (s: string) => codes.some(c => new RegExp(`\\b${c.replace(/[^A-Za-z0-9]/g, '')}\\b`).test(s));
  const isOffer = (field: string, v: unknown): v is string | number => {
    if (SAMPLE_NUMBER_FIELDS.includes(field)) return typeof v === 'number' && v > 0;
    if (typeof v !== 'string' || !v.trim()) return false;
    if (SAMPLE_CODE_FIELDS.includes(field) || SAMPLE_PRICE_FIELDS.includes(field)) return true;
    return OFFER_WORDS.test(v) || hasCode(v);
  };
  sampleIndex = new Map();
  for (const n of ECOM_BLUEPRINTS.flatMap(b => b.nodes)) {
    const values: SampleValues = new Map();
    const keep = (key: string, field: string, v: unknown) => {
      if (!isOffer(field, v)) return;
      if (!values.has(key)) values.set(key, new Set());
      values.get(key)!.add(v);
    };
    for (const [field, v] of Object.entries((n.data || {}) as Record<string, unknown>)) {
      if (field === 'steps' && Array.isArray(v)) {
        for (const step of v) for (const f of SAMPLE_STEP_FIELDS) keep(`steps.${f}`, f, (step as Record<string, unknown> | null)?.[f]);
      } else if (isSampleField(field)) {
        for (const x of Array.isArray(v) ? v : [v]) keep(field, field, x);
      }
    }
    if (values.size) sampleIndex.set(n.id, values);
  }
  return sampleIndex;
}

function isSampleField(field: string): boolean {
  return isCopyField(field) || [...SAMPLE_CODE_FIELDS, ...SAMPLE_PRICE_FIELDS, ...SAMPLE_NUMBER_FIELDS, ...SAMPLE_TEXT_FIELDS].includes(field);
}

/** What on this step still holds its blueprint's sample offer, in the step's own field order. */
function sampleOffersOn(node: JourneyNode): string[] {
  const samples = blueprintSamples().get(node.id);
  if (!samples) return [];
  const found: string[] = [];
  for (const [field, v] of Object.entries((node.data || {}) as Record<string, unknown>)) {
    if (field === 'steps' && Array.isArray(v)) {
      v.forEach((step, i) => {
        const s = (step || {}) as Record<string, unknown>;
        if (SAMPLE_STEP_FIELDS.some(f => samples.get(`steps.${f}`)?.has(s[f] as string))) {
          found.push(`${s.channel === 'sms' ? 'text' : 'email'} ${i + 1}`);
        }
      });
      continue;
    }
    const set = samples.get(field);
    if (!set) continue;
    const hit = (Array.isArray(v) ? v : [v]).find(x => set.has(x as string | number));
    if (hit === undefined) continue;
    if (field === 'discountPercentage') found.push(`the ${hit}% discount`);
    else if (field === 'urgencyMinutes') found.push(`the ${hit} minute countdown`);
    else {
      const name = SAMPLE_NAMES[field] ?? field.replace(/([A-Z])/g, ' $1').toLowerCase();
      found.push(QUOTED.has(field) ? `the ${name} "${String(hit).trim()}"` : `the ${name}`);
    }
  }
  return found;
}

function listed(items: string[], and = 'and'): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

function branchKey(handle: string | null): string {
  return handle ?? 'main';
}

function issueKey(check: string, nodeId: string | undefined, rest: string | undefined): string {
  return `${check}:${nodeId || ''}:${rest || ''}`;
}

/** Every design check on the map, in a fixed order, with one plain sentence each. */
export function checkJourneyDesign(project: { nodes?: JourneyNode[] | null; edges?: JourneyEdge[] | null }): DesignReport {
  const nodes = (Array.isArray(project?.nodes) ? project.nodes : []).filter(n => n && typeof n.id === 'string');
  const edges = (Array.isArray(project?.edges) ? project.edges : []).filter(e => e && typeof e.id === 'string');
  const byId = nodeLookup(nodes);
  const issues: DesignIssue[] = [];
  const add = (check: DesignCheck, message: string, at: { nodeId?: string; edgeId?: string; branch?: string; field?: string } = {}) => {
    const issue: DesignIssue = { key: issueKey(check, at.nodeId, at.edgeId || at.branch || at.field), check, message };
    if (at.nodeId) issue.nodeId = at.nodeId;
    if (at.edgeId) issue.edgeId = at.edgeId;
    if (at.branch) issue.branch = at.branch;
    if (at.field) issue.field = at.field;
    issues.push(issue);
  };

  // (a) broken-line and (b) hidden-line
  for (const e of edges) {
    const source = byId.get(e.source);
    const target = byId.get(e.target);
    if (!source || !target) {
      if (source) add('broken-line', 'A line from this step leads to a step that is no longer on the map.', { nodeId: source.id, edgeId: e.id });
      else if (target) add('broken-line', 'A line into this step comes from a step that is no longer on the map.', { nodeId: target.id, edgeId: e.id });
      else add('broken-line', 'A line joins two steps that are no longer on the map.', { edgeId: e.id });
      continue;
    }
    if (lineIsDrawable(e, byId)) continue;
    const h = handleOf(e.sourceHandle);
    let message: string;
    if (branchOf(e, typeOf(source)) === null) {
      message = STEP_BRANCHES[typeOf(source) as keyof typeof STEP_BRANCHES]?.length
        ? `A line leaves from an exit named "${h}", which this step does not have, so the map cannot draw it.`
        : 'A line leaves this step, which has no exit, so the map cannot draw it.';
    } else {
      message = typeOf(target) === 'ad-source'
        ? `A line leads into ${nameInSentence(stepName(target))}, which cannot take a line, so the map cannot draw it.`
        : `A line into ${nameInSentence(stepName(target))} uses an entry that step does not have, so the map cannot draw it.`;
    }
    add('hidden-line', message, { nodeId: source.id, edgeId: e.id });
  }

  const drawable = edges.filter(e => lineIsDrawable(e, byId));
  const ads = nodes.filter(n => typeOf(n) === 'ad-source');

  // (c) no-entry and (d) several-starts
  if (ads.length === 0) {
    add('no-entry', 'This journey has no traffic source. Add an ad so visitors have a way in.');
  } else {
    const adIds = new Set(ads.map(n => n.id));
    const firsts = new Set(drawable.filter(e => adIds.has(e.source)).map(e => e.target));
    if (firsts.size > 1) {
      add('several-starts', 'Traffic sources lead to different first steps. Send every traffic source to the same first step.');
    }
  }

  // (e) branch-missing, (f) branch-duplicate and (g) split-same-target
  for (const n of nodes) {
    const type = typeOf(n);
    const branches = type && Object.prototype.hasOwnProperty.call(STEP_BRANCHES, type)
      ? STEP_BRANCHES[type as keyof typeof STEP_BRANCHES]
      : [];
    if (branches.length === 0) continue;
    const out = drawable.filter(e => e.source === n.id);
    const targetsOf = new Map<string, string[]>();
    for (const b of branches) {
      const lines = out.filter(e => branchOf(e, type)?.handle === b.handle);
      targetsOf.set(branchKey(b.handle), lines.map(e => e.target));
      if (b.required && lines.length === 0) {
        add('branch-missing', `Connect "${b.label}" to a next step.`, { nodeId: n.id, branch: branchKey(b.handle) });
      }
      // A line into a follow-up runs beside the path (Aura's email line), so only the others count.
      const routing = new Set(lines.filter(e => typeOf(byId.get(e.target)) !== 'follow-up-sequence').map(e => e.target));
      const routingLines = lines.filter(e => typeOf(byId.get(e.target)) !== 'follow-up-sequence');
      if (routingLines.length > 1) {
        add(
          'branch-duplicate',
          routing.size > 1
            ? `"${b.label}" leads to more than one step. Keep one line on it.`
            : `"${b.label}" has more than one line to the same step. Keep one line on it.`,
          { nodeId: n.id, branch: branchKey(b.handle) }
        );
      }
    }
    if (type === 'ab-split') {
      const a = new Set(targetsOf.get('branch-a') ?? []);
      if ((targetsOf.get('branch-b') ?? []).some(t => a.has(t))) {
        add('split-same-target', 'Split A and Split B lead to the same step. Send each to its own page.', { nodeId: n.id });
      }
    }
  }

  // (h) unreachable, only once there is a way in to be reached from
  if (ads.length > 0) {
    const reached = reachableFrom(ads.map(n => n.id), edges, byId);
    for (const n of nodes) {
      if (!reached.has(n.id)) add('unreachable', 'No line from a traffic source reaches this step.', { nodeId: n.id });
    }
  }

  // (i) loop. The step closes the sentence, so a form titled with a question is its kind and the
  // question in quotes with no full stop after it: never "you?, which makes a loop" or "you?"." (T09).
  for (const e of findLoopLines(nodes, edges)) {
    add('loop', endSentence(`A line from this step makes a loop back to ${nameInSentence(stepName(byId.get(e.target)))}`), { nodeId: e.source, edgeId: e.id });
  }

  // (j) page-headline and page-button
  for (const n of nodes) {
    const checks = COPY_CHECKS[typeOf(n) ?? ''] ?? [];
    const data = (n.data || {}) as Record<string, unknown>;
    for (const c of checks) {
      const value = data[c.field];
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) add(c.check, c.missing, { nodeId: n.id, field: c.field });
      else if (isPlaceholderText(text)) {
        add(c.check, `The ${c.what} is still the placeholder "${text}".`, { nodeId: n.id, field: c.field });
      }
    }
  }

  // (j2) button-skips-form. The one place the published page and the map disagree about a button:
  // with a store connected, a page left on Direct to Checkout never opens the form its line leads to
  // (R18). Only the lead gate does, so the fix is that setting. With no store the button opens the
  // email form whatever the setting, and these checks cannot see the store, so the sentence names
  // the store case and stays true either way.
  for (const n of nodes) {
    if (typeOf(n) !== 'landing-page' || (n.data as { checkoutMode?: unknown })?.checkoutMode === 'lead-gate') continue;
    // The form is not named: a form step's name is its title, often a question, and it read badly mid-sentence.
    const toForm = drawable.some(e => e.source === n.id && branchOf(e, 'landing-page')?.handle === null && typeOf(byId.get(e.target)) === 'lead-form');
    if (!toForm) continue;
    add(
      'button-skips-form',
      'Once a store is connected, the published button on this page skips the form its line leads to and goes straight to checkout, because the page is set to Direct to Checkout. Choose 2-Step Lead Gate in the page settings if the form should come first.',
      { nodeId: n.id, field: 'checkoutMode' }
    );
  }

  // (k) starter-text. A page's variant B is checked under its own field name.
  for (const n of nodes) {
    const fields = STARTER_FIELDS[typeOf(n) ?? ''];
    if (!fields) continue;
    const data = (n.data || {}) as Record<string, unknown>;
    const variantB = typeOf(n) === 'landing-page' && data.variantB && typeof data.variantB === 'object'
      ? (data.variantB as Record<string, unknown>)
      : null;
    const sources: Array<[string, Record<string, unknown>, string]> = [['', data, '']];
    if (variantB) sources.push(['variantB.', variantB, 'variant B ']);
    for (const [prefix, source, whose] of sources) {
      for (const [field, what] of Object.entries(fields)) {
        const found = starterLines(source[field]);
        if (found.length === 0) continue;
        // A quote that ends its own sentence takes no second full stop.
        const quote = /[.!?]$/.test(found[0]) ? `"${found[0]}"` : `"${found[0]}".`;
        const message = Array.isArray(source[field])
          ? `The ${whose}${what} still hold the starter text ${quote} Write your own or remove it.`
          : `The ${whose}${what} still holds the starter text ${quote} Write your own or clear it.`;
        add('starter-text', message, { nodeId: n.id, field: prefix + field });
      }
    }
  }

  // (k2) letter-empty and starter-text on letters: one row per letter for what it lacks, one for
  // what still holds a draft. A text message has no subject line or preview text.
  for (const n of nodes) {
    if (typeOf(n) !== 'follow-up-sequence') continue;
    const letters = (n.data as { steps?: unknown })?.steps;
    if (!Array.isArray(letters)) continue;
    letters.forEach((letter, i) => {
      const l = (letter && typeof letter === 'object' ? letter : {}) as Record<string, unknown>;
      const sms = l.channel === 'sms';
      const name = `${sms ? 'Text' : 'Email'} ${i + 1}`;
      const missing: string[] = [];
      const drafts: string[] = [];
      for (const [field, what] of LETTER_FIELDS) {
        if (sms && field !== 'body') continue;
        const text = typeof l[field] === 'string' ? (l[field] as string).trim() : '';
        if (!text) missing.push(what);
        else if (LETTER_INSTRUCTION.test(text)) drafts.push(what);
      }
      if (missing.length) add('letter-empty', `${name} has no ${listed(missing, 'or')} yet.`, { nodeId: n.id, field: `steps.${i}` });
      if (drafts.length) {
        add('starter-text', `${name} still has draft instructions in its ${listed(drafts)}. Write your own before anyone receives it.`, { nodeId: n.id, field: `steps.${i}` });
      }
    });
  }

  // (l) sample-offer. One row per step, naming each thing to check, and no fix: the words are the person's.
  for (const n of nodes) {
    const found = sampleOffersOn(n);
    if (found.length === 0) continue;
    add(
      'sample-offer',
      `Still the blueprint's sample, not checked against your store: ${listed(found)}. Make each one true for your store, or replace or clear it.`,
      { nodeId: n.id }
    );
  }

  const journeyIssues = issues.filter(i => !i.nodeId);
  const byNode: DesignReport['byNode'] = {};
  for (const n of nodes) {
    const messages = issues.filter(i => i.nodeId === n.id).map(i => i.message);
    if (messages.length) byNode[n.id] = { name: stepName(n), messages };
  }
  return { issues, journeyIssues, byNode };
}

// ---- Fix plans ----

export type FixChange =
  | { kind: 'add-node'; node: JourneyNode }
  | { kind: 'add-edge'; edge: JourneyEdge }
  | { kind: 'remove-edge'; edge: JourneyEdge; index: number }
  | {
      kind: 'set-edge-handle';
      edgeId: string;
      end: 'source' | 'target';
      before: string | null;
      after: string | null;
      /** The copy in edge.data before the change. undefined when data had no such key. */
      dataBefore?: string | null;
    }
  | { kind: 'set-node-field'; nodeId: string; field: string; before: unknown; after: unknown }
  | { kind: 'set-forecast'; before: FunnelForecast | undefined; after: FunnelForecast | undefined };

export interface FixPlan {
  key: string;
  title: string;
  /** What will change, one plain sentence per change, written from `changes`. */
  lines: string[];
  changes: FixChange[];
}

type ProjectLike = Pick<JourneyProject, 'nodes' | 'edges'> & Partial<Pick<JourneyProject, 'updatedAt' | 'forecast'>>;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** What makes a line the same line: its id, its ends and its handles. Measured numbers may move. */
function lineShape(e: JourneyEdge): string {
  return JSON.stringify([e.id, e.source, e.target, handleOf(e.sourceHandle), handleOf(e.targetHandle)]);
}

function handleKey(end: 'source' | 'target'): 'sourceHandle' | 'targetHandle' {
  return end === 'source' ? 'sourceHandle' : 'targetHandle';
}

/**
 * Now, or one millisecond past the old stamp when the clock has not moved on. The sign-in merge
 * in App.tsx keeps the strictly newer copy, so an edit must never carry an older time.
 */
function freshStamp(previous: unknown): string {
  const now = Date.now();
  const prev = typeof previous === 'string' ? Date.parse(previous) : NaN;
  return new Date(Number.isFinite(prev) && prev >= now ? prev + 1 : now).toISOString();
}

function withEdgeHandle(edge: JourneyEdge, end: 'source' | 'target', top: string | null, data: string | null | undefined): JourneyEdge {
  const key = handleKey(end);
  const next = { ...edge } as JourneyEdge & Record<string, unknown>;
  if (top === null) delete next[key];
  else next[key] = top;
  if (edge.data && typeof edge.data === 'object') {
    const d = { ...edge.data } as Record<string, unknown>;
    if (data === undefined || data === null) delete d[key];
    else d[key] = data;
    next.data = d as JourneyEdge['data'];
  }
  return next;
}

function withNodeField(node: JourneyNode, field: string, value: unknown): JourneyNode {
  const data = { ...(node.data || {}) } as Record<string, unknown>;
  if (value === undefined) delete data[field];
  else data[field] = value;
  return { ...node, data: data as JourneyNode['data'] };
}

function withForecast<P extends ProjectLike>(project: P, forecast: FunnelForecast | undefined): P {
  const next = { ...project };
  if (forecast === undefined) delete next.forecast;
  else next.forecast = forecast;
  return next;
}

/**
 * Applies every change of a plan, or none. Refuses (the same project object, applied false) when
 * the journey no longer matches what the plan was written against, when a new line would be
 * refused or would replace a line (connectionRules), or when a change would set a copy field.
 */
export function applyFixPlan<P extends ProjectLike>(project: P, plan: FixPlan): { project: P; applied: boolean } {
  const refuse = { project, applied: false };
  const edgesIn = Array.isArray(project.edges) ? project.edges : [];
  let nodes = Array.isArray(project.nodes) ? [...project.nodes] : [];
  const nodeIds = new Set(nodes.map(n => n.id));
  let forecast = project.forecast;

  for (const c of plan.changes) {
    if (c.kind === 'add-node') {
      if (!c.node || nodeIds.has(c.node.id)) return refuse;
      nodeIds.add(c.node.id);
      nodes.push(c.node);
    }
  }

  let edges = [...edgesIn];
  for (const c of plan.changes) {
    if (c.kind !== 'remove-edge') continue;
    const current = edges.find(e => e.id === c.edge.id);
    if (!current || lineShape(current) !== lineShape(c.edge)) return refuse;
    edges = edges.filter(e => e.id !== c.edge.id);
  }
  for (const c of plan.changes) {
    if (c.kind !== 'set-edge-handle') continue;
    const i = edges.findIndex(e => e.id === c.edgeId);
    if (i === -1) return refuse;
    const key = handleKey(c.end);
    if (!same(edges[i][key], c.before)) return refuse;
    edges = edges.map((e, j) => (j === i ? withEdgeHandle(e, c.end, c.after, c.after) : e));
  }
  for (const c of plan.changes) {
    if (c.kind !== 'add-edge') continue;
    const e = c.edge;
    if (!e || edges.some(x => x.id === e.id)) return refuse;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return refuse;
    const h = handleOf(e.sourceHandle);
    if (edges.some(x => x.source === e.source && x.target === e.target && handleOf(x.sourceHandle) === h)) return refuse;
    // The one gate every new line passes (#13): no refused line, and no silent Replace.
    const verdict = checkConnection(
      { source: e.source, target: e.target, sourceHandle: h, targetHandle: handleOf(e.targetHandle) },
      nodes,
      edges
    );
    if (verdict.kind !== 'add') return refuse;
    edges = withConnection(edges, e);
  }
  for (const c of plan.changes) {
    if (c.kind !== 'set-node-field') continue;
    if (isCopyField(c.field)) return refuse;
    const i = nodes.findIndex(n => n.id === c.nodeId);
    if (i === -1) return refuse;
    if (!same((nodes[i].data as Record<string, unknown> | undefined)?.[c.field], c.before)) return refuse;
    nodes = nodes.map((n, j) => (j === i ? withNodeField(n, c.field, c.after) : n));
  }
  for (const c of plan.changes) {
    if (c.kind !== 'set-forecast') continue;
    if (!same(forecast, c.before)) return refuse;
    forecast = c.after;
  }

  const next = withForecast({ ...project, nodes, edges, updatedAt: freshStamp(project.updatedAt) }, forecast);
  return { project: next, applied: true };
}

/**
 * Takes a plan back out, all or nothing. Refuses (the same project object, reverted false) when
 * anything the plan touched was changed afterwards, so an Undo never throws away later work.
 * Removed lines go back at their old position. updatedAt is stamped fresh, never the old time.
 */
export function revertFixPlan<P extends ProjectLike>(project: P, plan: FixPlan): { project: P; reverted: boolean } {
  const refuse = { project, reverted: false };
  let nodes = Array.isArray(project.nodes) ? [...project.nodes] : [];
  let edges = Array.isArray(project.edges) ? [...project.edges] : [];
  let forecast = project.forecast;

  const addedEdgeIds = new Set<string>();
  for (const c of plan.changes) {
    if (c.kind !== 'add-edge') continue;
    const current = edges.find(e => e.id === c.edge.id);
    if (!current || lineShape(current) !== lineShape(c.edge)) return refuse;
    addedEdgeIds.add(c.edge.id);
  }
  const addedNodeIds = new Set<string>();
  for (const c of plan.changes) {
    if (c.kind !== 'add-node') continue;
    const current = nodes.find(n => n.id === c.node.id);
    // A step the person has since written in is theirs now.
    if (!current || !same(current.data, c.node.data)) return refuse;
    addedNodeIds.add(c.node.id);
  }
  if (edges.some(e => !addedEdgeIds.has(e.id) && (addedNodeIds.has(e.source) || addedNodeIds.has(e.target)))) return refuse;
  for (const c of plan.changes) {
    if (c.kind === 'remove-edge' && edges.some(e => e.id === c.edge.id)) return refuse;
    if (c.kind === 'set-edge-handle') {
      const current = edges.find(e => e.id === c.edgeId);
      if (!current || !same(current[handleKey(c.end)], c.after)) return refuse;
    }
    if (c.kind === 'set-node-field') {
      const current = nodes.find(n => n.id === c.nodeId);
      if (!current || !same((current.data as Record<string, unknown> | undefined)?.[c.field], c.after)) return refuse;
    }
    if (c.kind === 'set-forecast' && !same(forecast, c.after)) return refuse;
  }

  edges = edges.filter(e => !addedEdgeIds.has(e.id));
  nodes = nodes.filter(n => !addedNodeIds.has(n.id));
  for (const c of plan.changes) {
    if (c.kind === 'set-edge-handle') {
      edges = edges.map(e => (e.id === c.edgeId ? withEdgeHandle(e, c.end, c.before, c.dataBefore) : e));
    } else if (c.kind === 'set-node-field') {
      nodes = nodes.map(n => (n.id === c.nodeId ? withNodeField(n, c.field, c.before) : n));
    } else if (c.kind === 'set-forecast') {
      forecast = c.before;
    }
  }
  const removed = plan.changes
    .filter((c): c is Extract<FixChange, { kind: 'remove-edge' }> => c.kind === 'remove-edge')
    .sort((a, b) => a.index - b.index);
  for (const c of removed) {
    const at = Math.max(0, Math.min(edges.length, c.index));
    edges = [...edges.slice(0, at), c.edge, ...edges.slice(at)];
  }

  const next = withForecast({ ...project, nodes, edges, updatedAt: freshStamp(project.updatedAt) }, forecast);
  return { project: next, reverted: true };
}

// ---- Writing plans ----

function branchLabel(node: JourneyNode | undefined, handle: string | null): string {
  const b = branchOf({ sourceHandle: handle }, typeOf(node));
  return b?.label ?? 'Next step';
}

/** A new line in the one shape every new line takes (addStep.makeLine), with an id a preview can name. */
export function fixLine(source: JourneyNode, sourceHandle: string | null, target: JourneyNode, targetHandle: string | null): JourneyEdge {
  const line = makeLine(source.id, sourceHandle, target.id, targetHandle, target.data, 'fix', source.data);
  return { ...line, id: `e-fix-${source.id}-${sourceHandle || 'main'}-${target.id}` };
}

/** The sentence for one change, read from the change itself so the preview is the edit. */
export function describeChange(change: FixChange, nodes: readonly JourneyNode[], edges: readonly JourneyEdge[]): string {
  const byId = nodeLookup([...nodes, ...(change.kind === 'add-node' ? [change.node] : [])]);
  // Names sit inside the sentence (nameInSentence) and a closing name keeps its own "?" (T09).
  const nameOf = (id: string) => (byId.has(id) ? nameInSentence(stepName(byId.get(id))) : 'a step that is no longer on the map');
  switch (change.kind) {
    case 'add-edge': {
      const e = change.edge;
      return endSentence(`Adds a line from "${branchLabel(byId.get(e.source), handleOf(e.sourceHandle))}" on ${nameOf(e.source)} to ${nameOf(e.target)}`);
    }
    case 'remove-edge':
      return endSentence(`Removes the line from ${nameOf(change.edge.source)} to ${nameOf(change.edge.target)}`);
    case 'set-edge-handle': {
      const e = edges.find(x => x.id === change.edgeId);
      const route = e ? ` from ${nameOf(e.source)} to ${nameOf(e.target)}` : '';
      return change.end === 'source'
        ? `Draws the line${route} from the step's main exit instead of "${change.before}".`
        : `Draws the line${route} into the step's main entry instead of "${change.before}".`;
    }
    case 'add-node':
      return endSentence(`Adds ${nameInSentence(stepName(change.node))}`);
    case 'set-node-field':
      return endSentence(`Sets ${change.field} on ${nameOf(change.nodeId)}`);
    case 'set-forecast':
      return 'Updates the forecast settings.';
  }
}

/** A plan with its sentences written from its changes, or null when it would not apply now. */
export function buildPlan(project: ProjectLike, key: string, title: string, changes: FixChange[], lines?: string[]): FixPlan | null {
  if (changes.length === 0) return null;
  const nodes = project.nodes || [];
  const edges = project.edges || [];
  const plan: FixPlan = { key, title, changes, lines: lines ?? changes.map(c => describeChange(c, nodes, edges)) };
  return applyFixPlan(project, plan).applied ? plan : null;
}

function only<T>(items: T[]): T | null {
  return items.length === 1 ? items[0] : null;
}

/** True when nothing leaves this step from this exit. */
function exitFree(edges: readonly JourneyEdge[], nodeId: string, handle: string): boolean {
  return !edges.some(e => e.source === nodeId && handleOf(e.sourceHandle) === handle);
}

const RECOVERY_SOURCES: Record<string, { type: string; handle: string }> = {
  checkout_recovery: { type: 'landing-page', handle: 'abandon' },
  upsell_recovery: { type: 'upsell', handle: 'rescue' }
};

/**
 * The one structural answer to an issue, or null when there is none or more than one. Only lines,
 * and a page's checkoutMode, are ever changed: a headline or a button is the person's to write, so
 * those checks get no fix.
 */
export function planDesignFix(project: ProjectLike, issue: DesignIssue): FixPlan | null {
  const nodes = Array.isArray(project?.nodes) ? project.nodes : [];
  const edges = Array.isArray(project?.edges) ? project.edges : [];
  const byId = nodeLookup(nodes);
  const key = `fix:${issue.key}`;

  switch (issue.check) {
    case 'broken-line': {
      const index = edges.findIndex(e => e.id === issue.edgeId);
      if (index === -1) return null;
      return buildPlan(project, key, 'Remove the broken line', [{ kind: 'remove-edge', edge: edges[index], index }]);
    }

    case 'hidden-line': {
      const index = edges.findIndex(e => e.id === issue.edgeId);
      if (index === -1) return null;
      const edge = edges[index];
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) return null;
      const changes: FixChange[] = [];
      let sourceHandle = handleOf(edge.sourceHandle);
      let targetHandle = handleOf(edge.targetHandle);
      if (branchOf(edge, typeOf(source)) === null && sourceHandle !== null && STEP_BRANCHES[typeOf(source) as keyof typeof STEP_BRANCHES]?.some(b => b.handle === null)) {
        changes.push({ kind: 'set-edge-handle', edgeId: edge.id, end: 'source', before: edge.sourceHandle ?? null, after: null, dataBefore: edge.data?.sourceHandle as string | null | undefined });
        sourceHandle = null;
      }
      const repaired = { ...edge, sourceHandle };
      if (lineIsDrawable(repaired, byId) === false && targetHandle !== null && lineIsDrawable({ ...repaired, targetHandle: null }, byId)) {
        changes.push({ kind: 'set-edge-handle', edgeId: edge.id, end: 'target', before: edge.targetHandle ?? null, after: null, dataBefore: edge.data?.targetHandle as string | null | undefined });
        targetHandle = null;
      }
      const cleared = { ...edge, sourceHandle, targetHandle };
      const others = edges.filter(e => e.id !== edge.id);
      // Repair only when the repaired line is one the map would accept as a new line. Otherwise
      // it would silently replace or duplicate a line the person can see, so it is removed.
      const verdict = checkConnection({ source: edge.source, target: edge.target, sourceHandle, targetHandle }, nodes, others);
      if (changes.length > 0 && lineIsDrawable(cleared, byId) && verdict.kind === 'add') {
        return buildPlan(project, key, 'Repair the hidden line', changes);
      }
      return buildPlan(project, key, 'Remove the hidden line', [{ kind: 'remove-edge', edge, index }]);
    }

    case 'branch-missing': {
      const source = issue.nodeId ? byId.get(issue.nodeId) : undefined;
      if (!source) return null;
      const type = typeOf(source);
      const handle = issue.branch && issue.branch !== 'main' ? issue.branch : null;
      if (type === 'upsell' && (handle === 'accepted' || handle === 'declined')) {
        const target = only(nodes.filter(n => typeOf(n) === 'thank-you'));
        if (!target) return null;
        return buildPlan(project, key, `Connect "${branchLabel(source, handle)}"`, [{ kind: 'add-edge', edge: fixLine(source, handle, target, null) }]);
      }
      if (type === 'ad-source' && handle === null) {
        const led = new Set(edges.filter(e => lineIsDrawable(e, byId)).map(e => e.target));
        const target = only(nodes.filter(n => (typeOf(n) === 'landing-page' || typeOf(n) === 'ab-split') && !led.has(n.id)));
        if (!target) return null;
        return buildPlan(project, key, 'Connect the traffic source', [{ kind: 'add-edge', edge: fixLine(source, null, target, null) }]);
      }
      return null;
    }

    case 'button-skips-form': {
      const page = issue.nodeId ? byId.get(issue.nodeId) : undefined;
      if (!page || typeOf(page) !== 'landing-page') return null;
      const before = (page.data as { checkoutMode?: unknown })?.checkoutMode;
      return buildPlan(project, key, 'Open a form first', [{ kind: 'set-node-field', nodeId: page.id, field: 'checkoutMode', before, after: 'lead-gate' }], [
        `Sets ${nameInSentence(stepName(page))} to 2-Step Lead Gate, so its published button opens a name, email and phone form first.`
      ]);
    }

    case 'unreachable': {
      const seq = issue.nodeId ? byId.get(issue.nodeId) : undefined;
      if (!seq || typeOf(seq) !== 'follow-up-sequence') return null;
      const rule = RECOVERY_SOURCES[String((seq.data as { sequenceType?: unknown })?.sequenceType)];
      if (!rule || edges.some(e => e.target === seq.id)) return null;
      const source = only(nodes.filter(n => typeOf(n) === rule.type && exitFree(edges, n.id, rule.handle)));
      if (!source) return null;
      return buildPlan(project, key, 'Link the recovery sequence', [{ kind: 'add-edge', edge: fixLine(source, rule.handle, seq, 'retention-in') }]);
    }

    default:
      return null;
  }
}
