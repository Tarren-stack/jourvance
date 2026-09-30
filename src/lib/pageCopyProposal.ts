import type { PageNodeData, AdNodeData, SequenceStep } from '../types/journey';

// The one reading of an /api/ai/copy answer, for the page, ad and sequence editors. It never
// passes the server's template copy (or a client-side placeholder) off as AI, and it never writes
// a field on its own: it turns a real answer into rows the person reviews, then applies only the
// rows they keep. Pure, with type-only imports, so Node tests can load it without a bundler.

export type CopyTarget = 'a' | 'b';
export type PageCopyField = 'headline' | 'subhead' | 'buttonText';
export type AdCopyField = 'headline' | 'body' | 'ctaText';
export type EmailCopyField = 'subject' | 'previewText' | 'body';
// Every field a review card can offer, since all three editors share CopyProposalCard.
export type CopyField = PageCopyField | AdCopyField | EmailCopyField;
export type SuggestedCopy<F extends CopyField = PageCopyField> = Partial<Record<F, string>>;

export const COPY_FIELD_LABELS: Record<CopyField, string> = {
  headline: 'Headline',
  subhead: 'Subheadline',
  buttonText: 'Button text',
  body: 'Body',
  ctaText: 'Button text',
  subject: 'Subject line',
  previewText: 'Preview text'
};

// Named as each editor names the field on screen.
export const AD_COPY_LABELS: Record<AdCopyField, string> = {
  headline: 'Ad headline',
  body: 'Primary text',
  ctaText: 'Button text'
};

export const EMAIL_COPY_LABELS: Record<EmailCopyField, string> = {
  subject: 'Subject line',
  previewText: 'Preview text',
  body: 'Letter body'
};

const COPY_FIELDS: PageCopyField[] = ['headline', 'subhead', 'buttonText'];
const AD_FIELDS: AdCopyField[] = ['headline', 'body', 'ctaText'];
const EMAIL_FIELDS: EmailCopyField[] = ['subject', 'previewText', 'body'];

// The answer's own key for each field: the server calls the button label `cta` and the preview
// line `preview`.
const ANSWER_KEYS: Record<PageCopyField, string> = {
  headline: 'headline',
  subhead: 'subhead',
  buttonText: 'cta'
};
const AD_ANSWER_KEYS: Record<AdCopyField, string> = {
  headline: 'headline',
  body: 'body',
  ctaText: 'cta'
};
const EMAIL_ANSWER_KEYS: Record<EmailCopyField, string> = {
  subject: 'subject',
  previewText: 'preview',
  body: 'body'
};

export type CopyAnswerRead<F extends CopyField = PageCopyField> =
  | { kind: 'suggestion'; copy: SuggestedCopy<F> }
  | { kind: 'unavailable'; message: string };

export interface CopyRow<F extends CopyField = CopyField> {
  field: F;
  label: string;
  current: string;
  suggested: string;
  change: 'fill' | 'replace';
}

const NOTHING_CHANGED = 'Nothing was changed.';

// Model copy must never carry an em dash or a spaced en dash. An unspaced en dash (10-20 ranges)
// and a hyphen (one-click) are ordinary punctuation and stay.
export function cleanSuggestedText(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/(^|\s+)\u2013(\s+|$)/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,(\s*,)+/g, ',')
    .trim()
    .replace(/^,\s*/, '')
    .replace(/\s*,$/, '')
    .trim();
}

// The same rule for a letter body, one line at a time, so its paragraphs survive. A dash that
// opens or closes a line is dropped rather than turned into a comma, which keeps the comma a
// greeting ends with ("Hi [First Name],").
function cleanBodyLine(line: string): string {
  return line
    .replace(/^\s*(?:\u2014|\u2013(?=\s))\s*/, '')
    .replace(/\s*(?:\u2014|(?<=\s)\u2013)\s*$/, '')
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/\s+\u2013\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,(\s*,)+/g, ',')
    .trim();
}

export function cleanSuggestedBody(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(cleanBodyLine)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type RawAnswer = { status: number; body: any } | null;

function readAnswer<F extends CopyField>(
  answer: RawAnswer,
  fields: readonly F[],
  keys: Record<F, string>,
  multiline: readonly F[] = []
): CopyAnswerRead<F> {
  if (!answer) {
    return { kind: 'unavailable', message: `The server could not be reached. ${NOTHING_CHANGED}` };
  }
  const { status } = answer;
  const body = answer.body && typeof answer.body === 'object' ? answer.body : {};
  if (status === 401) {
    return { kind: 'unavailable', message: `Sign in to write with AI. ${NOTHING_CHANGED}` };
  }
  if (status !== 200 || !body.success) {
    const said = typeof body.error === 'string' && body.error.trim() && body.error.length < 200
      ? cleanSuggestedText(body.error)
      : `AI writing failed with status ${status}.`;
    const sentence = /[.!?]$/.test(said) ? said : `${said}.`;
    return { kind: 'unavailable', message: `${sentence} ${NOTHING_CHANGED}` };
  }
  // Only the hub brain writes real copy. The template fallback (budget, hourly limit, an
  // unreachable hub) is placeholder text and must never reach a field dressed up as AI.
  if (body.source !== 'hub-brain') {
    if (body.reason === 'hourly-ai-limit') {
      return {
        kind: 'unavailable',
        message: `You have reached the AI writing limit for this hour. Try again later. ${NOTHING_CHANGED}`
      };
    }
    return { kind: 'unavailable', message: `AI writing is not available right now. ${NOTHING_CHANGED}` };
  }
  const raw = body.copy && typeof body.copy === 'object' ? body.copy : {};
  const copy: SuggestedCopy<F> = {};
  for (const field of fields) {
    const clean = multiline.includes(field) ? cleanSuggestedBody : cleanSuggestedText;
    const text = clean(raw[keys[field]]);
    if (text) copy[field] = text;
  }
  if (Object.keys(copy).length === 0) {
    return { kind: 'unavailable', message: `The AI answer was empty. ${NOTHING_CHANGED}` };
  }
  return { kind: 'suggestion', copy };
}

export function readCopyAnswer(answer: RawAnswer): CopyAnswerRead<PageCopyField> {
  return readAnswer(answer, COPY_FIELDS, ANSWER_KEYS);
}

export function readAdCopyAnswer(answer: RawAnswer): CopyAnswerRead<AdCopyField> {
  return readAnswer(answer, AD_FIELDS, AD_ANSWER_KEYS);
}

export function readEmailCopyAnswer(answer: RawAnswer): CopyAnswerRead<EmailCopyField> {
  return readAnswer(answer, EMAIL_FIELDS, EMAIL_ANSWER_KEYS, ['body']);
}

function textOf(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// One row per suggested field that would actually change something.
function planRows<F extends CopyField>(
  current: (field: F) => string,
  copy: SuggestedCopy<F>,
  fields: readonly F[],
  labels: Record<F, string>
): CopyRow<F>[] {
  const rows: CopyRow<F>[] = [];
  for (const field of fields) {
    const suggested = copy[field];
    if (!suggested) continue;
    const now = current(field);
    if (suggested.trim() === now.trim()) continue;
    rows.push({ field, label: labels[field], current: now, suggested, change: now.trim() === '' ? 'fill' : 'replace' });
  }
  return rows;
}

// The kept fields of one kind. A field of another editor's kind is ignored.
function pick<F extends CopyField>(copy: SuggestedCopy<F>, kept: readonly CopyField[], allowed: readonly F[]): SuggestedCopy<F> {
  const selected: SuggestedCopy<F> = {};
  for (const field of allowed) {
    const text = copy[field];
    if (kept.includes(field) && text) selected[field] = text;
  }
  return selected;
}

function currentText(data: PageNodeData, target: CopyTarget, field: PageCopyField): string {
  const v = target === 'b' ? data.variantB?.[field] ?? '' : data[field] ?? '';
  return typeof v === 'string' ? v : '';
}

// Computed from the live data at render time, so "Now" always shows what the field holds this
// moment.
export function planCopyRows(data: PageNodeData, target: CopyTarget, copy: SuggestedCopy<PageCopyField>): CopyRow<PageCopyField>[] {
  return planRows(field => currentText(data, target, field), copy, COPY_FIELDS, COPY_FIELD_LABELS);
}

// Writes only the selected fields of the chosen version, onto whatever `data` is passed in.
// Pass the CURRENT page data so edits typed while the request ran are kept.
export function applyCopyRows(
  data: PageNodeData,
  target: CopyTarget,
  copy: SuggestedCopy<PageCopyField>,
  fields: readonly CopyField[]
): PageNodeData {
  const selected = pick(copy, fields, COPY_FIELDS);
  if (Object.keys(selected).length === 0) return data;
  if (target === 'b') {
    return { ...data, variantB: { ...(data.variantB || {}), ...selected } };
  }
  return { ...data, ...selected };
}

export function planAdCopyRows(data: AdNodeData, copy: SuggestedCopy<AdCopyField>): CopyRow<AdCopyField>[] {
  return planRows(field => textOf(data[field]), copy, AD_FIELDS, AD_COPY_LABELS);
}

export function applyAdCopyRows(data: AdNodeData, copy: SuggestedCopy<AdCopyField>, fields: readonly CopyField[]): AdNodeData {
  const selected = pick(copy, fields, AD_FIELDS);
  return Object.keys(selected).length === 0 ? data : { ...data, ...selected };
}

export function planEmailCopyRows(step: SequenceStep, copy: SuggestedCopy<EmailCopyField>): CopyRow<EmailCopyField>[] {
  return planRows(field => textOf(step[field]), copy, EMAIL_FIELDS, EMAIL_COPY_LABELS);
}

// Writes the kept fields onto the step with this id in ONE new steps array, built from the steps
// passed in. Pass the CURRENT steps so other letters and edits typed meanwhile are kept.
export function applyEmailCopyRows(
  steps: SequenceStep[],
  stepId: string,
  copy: SuggestedCopy<EmailCopyField>,
  fields: readonly CopyField[]
): SequenceStep[] {
  const selected = pick(copy, fields, EMAIL_FIELDS);
  if (Object.keys(selected).length === 0 || !steps.some(s => s.id === stepId)) return steps;
  return steps.map(s => (s.id === stepId ? { ...s, ...selected } : s));
}

const GOAL_A = 'Landing page copy for this offer: a headline, a one or two sentence subhead and a short button label. Use only what the offer name says. Do not invent results, ingredients, prices, discounts or guarantees.';

export function copyGoal(target: CopyTarget): string {
  return target === 'b' ? `A different angle on the same offer for an A/B test. ${GOAL_A}` : GOAL_A;
}

const NO_INVENTION = 'Use only what the offer name says. Do not invent results, ingredients, prices, discounts, codes or guarantees.';

export const AD_COPY_GOAL = `Ad copy that brings qualified leads to this offer: a headline, one or two sentences of primary text and a short button label. ${NO_INVENTION}`;

export function emailCopyGoal(delay: string | undefined): string {
  const when = delay && delay.trim() ? delay.trim() : 'the first contact';
  return `One follow-up email in a customer journey, sent after ${when}: a subject line, a preview line and a short letter body. Greet the reader as [First Name]. ${NO_INVENTION}`;
}

// Where focus lands when the review card opens: the safe choice whenever something would be
// overwritten, the quick one when every field was empty.
export function initialFocus(rows: CopyRow[]): 'keep' | 'use' {
  return rows.some(r => r.change === 'replace') ? 'keep' : 'use';
}

// "Headline", "Headline and Button text", "Headline, Subheadline and Button text".
export function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
