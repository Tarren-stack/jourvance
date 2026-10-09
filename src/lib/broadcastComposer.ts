/**
 * The broadcast composer's pure rules (EMAIL_STUDIO_PLAN.md Wave 5, D4). New broadcast opens one
 * composer: the builder's blocks, who gets it, when, A/B, holdout and the text add-on. What it sends
 * is POST /api/email/campaign/send, which already takes `blocks` together with all of those
 * (server/routes/emailRoutes.mjs); what it saves is a draft at /api/email/broadcast-drafts
 * (server/routes/broadcastDraftRoutes.mjs, whose cleanDraftSettings keeps the same setting keys).
 *
 * No React here, so the node tests import this file directly.
 */
import type { MailBlock } from '../components/campaign/EmailBlocks';

export type BroadcastWhen = 'now' | 'clock' | 'gradual' | 'smart';
export type AbVariable = '' | 'subject' | 'content' | 'send_time';

/** Every setting the composer keeps beside the email itself. A draft stores these keys as they are. */
export interface BroadcastSettings {
  include: string;
  exclude: string;
  sendWhen: BroadcastWhen;
  sendAt: string;
  gradualPercent: number;
  gradualEvery: 'minute' | 'hour';
  fallbackHour: string;
  explore: boolean;
  smartGradual: boolean;
  smartSkip: boolean;
  utmSource: string;
  utmCampaign: string;
  abVariable: AbVariable;
  abSubject: string;
  abBody: string;
  abHours: number;
  smsMessage: string;
  smsConfirm: boolean;
  holdoutOn: boolean;
  holdoutPercent: number;
}

export interface BroadcastDraft {
  /** The saved draft's id, or '' for a broadcast not saved as a draft. */
  id: string;
  subject: string;
  previewText: string;
  blocks: MailBlock[];
  settings: BroadcastSettings;
}

export const DEFAULT_BROADCAST_SETTINGS: BroadcastSettings = {
  include: 'all',
  exclude: '',
  sendWhen: 'now',
  sendAt: '',
  gradualPercent: 10,
  gradualEvery: 'hour',
  fallbackHour: '',
  explore: false,
  smartGradual: false,
  smartSkip: false,
  utmSource: '',
  utmCampaign: '',
  abVariable: '',
  abSubject: '',
  abBody: '',
  abHours: 4,
  smsMessage: '',
  smsConfirm: false,
  holdoutOn: false,
  holdoutPercent: 10
};

/** A new broadcast: a heading and a paragraph to write in, everyone who accepts marketing, sent now. */
export function emptyBroadcastDraft(): BroadcastDraft {
  return {
    id: '',
    subject: '',
    previewText: '',
    blocks: [
      { id: 'b_heading', kind: 'heading', text: '' },
      { id: 'b_text', kind: 'text', text: '', level: 0 }
    ],
    settings: { ...DEFAULT_BROADCAST_SETTINGS }
  };
}

/** A written body as the builder holds it: one text block, as campaign/send turns a plain body into one. */
export function bodyBlocks(text: string): MailBlock[] {
  return [{ id: 'b_text', kind: 'text', text, level: 0 }];
}

/** A list id starts list_ (emailRoutes.mjs POST /api/email/lists); anything else is a segment. */
export function pickFor(id: string): { type: 'list' | 'segment'; id: string } {
  return { type: id.startsWith('list_') ? 'list' : 'segment', id };
}

/**
 * POST /api/email/campaign/send's body, in the shape that route reads: `blocks` (never a flattened
 * body), `include` and `exclude` picks, `when` with `sendAt` and `gradual`, `ab`, `holdout`, the
 * text add-on and the UTM fields. It is the same body the retired textarea modal sent, with the
 * builder's blocks where its `body` string was.
 */
export function campaignSendBody(draft: BroadcastDraft, workspaceId?: string, requestId?: string) {
  const s = draft.settings;
  const smart = s.sendWhen === 'smart';
  return {
    subject: draft.subject,
    previewText: draft.previewText,
    blocks: draft.blocks,
    segmentId: s.include,
    include: [pickFor(s.include)],
    exclude: s.exclude ? [pickFor(s.exclude)] : [],
    sendMode: 'direct' as const,
    when: s.sendWhen,
    sendAt: s.sendAt,
    gradual: s.sendWhen === 'gradual' || (smart && s.smartGradual)
      ? { percent: s.gradualPercent, every: s.gradualEvery, ...(smart ? { wrap: true } : {}) }
      : undefined,
    fallbackHour: smart && s.fallbackHour !== '' ? Number(s.fallbackHour) : '',
    explore: smart && s.explore,
    smartSkip: s.smartSkip,
    utm: { source: s.utmSource, medium: 'email', campaign: s.utmCampaign },
    ab: s.abVariable ? { variable: s.abVariable, subjectB: s.abSubject, bodyB: s.abBody, offsetHours: s.abHours } : { variable: 'off' },
    smsMessage: s.smsMessage,
    smsConfirm: s.smsConfirm ? 'opted-in' : '',
    holdout: s.holdoutOn ? { enabled: true, percent: s.holdoutPercent } : { enabled: false },
    ...(workspaceId ? { workspaceId } : {}),
    // One id per send the merchant confirmed, kept for a retry of an unanswered one: campaign/send refuses a second copy.
    ...(requestId ? { requestId } : {})
  };
}

/** The draft route's body: the id only when the draft was saved before. */
export function draftRequestBody(draft: BroadcastDraft) {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    subject: draft.subject,
    previewText: draft.previewText,
    blocks: draft.blocks,
    settings: draft.settings
  };
}

/** A stored draft (GET /api/email/broadcast-drafts) as the composer holds it. */
export function draftFromStored(row: any): BroadcastDraft {
  const settings = row && typeof row.settings === 'object' && row.settings ? row.settings : {};
  return {
    id: typeof row?.id === 'string' ? row.id : '',
    subject: String(row?.subject ?? ''),
    previewText: String(row?.previewText ?? ''),
    blocks: Array.isArray(row?.blocks) ? row.blocks : [],
    settings: { ...DEFAULT_BROADCAST_SETTINGS, ...settings }
  };
}

/** What a save would keep, so "unsaved changes" compares content and never the id. */
export function draftSnapshot(draft: BroadcastDraft): string {
  return JSON.stringify([draft.subject, draft.previewText, draft.blocks, draft.settings]);
}

/**
 * True when the blocks hold something a person would receive: words, a picture with an address, a
 * button, a filled cell. A blank heading and paragraph, a divider or a spacer is not an email. The
 * same rule as email-flow-content.mjs emailHasContent, which campaign/send applies; a test holds the
 * two to one answer on the same blocks.
 */
export function blocksHaveContent(blocks: unknown): boolean {
  const has = (block: any): boolean => {
    if (!block || typeof block !== 'object') return false;
    const kind = block.kind;
    if (kind === 'heading' || kind === 'text' || kind === 'html') return typeof block.text === 'string' && block.text.trim() !== '';
    if (kind === 'image') return typeof block.url === 'string' && block.url.trim() !== '';
    if (kind === 'divider' || kind === 'spacer') return false;
    if (kind === 'columns') return (Array.isArray(block.columns) ? block.columns : []).some((column: any) => (Array.isArray(column?.blocks) ? column.blocks : []).some(has));
    if (kind === 'split') return (Array.isArray(block.cells) ? block.cells : []).some(has);
    return typeof kind === 'string' && kind !== '';
  };
  return Array.isArray(blocks) && blocks.some(has);
}

/** What a preview was made from (the preview route reads these three), so an edit after it shows it is stale. */
export function previewKey(draft: BroadcastDraft): string {
  return JSON.stringify([draft.subject, draft.previewText, draft.blocks]);
}

/** True when there is something in the email to lose. */
export function draftHasContent(draft: BroadcastDraft): boolean {
  if (draft.subject.trim() || draft.previewText.trim()) return true;
  return draft.blocks.some((block) => {
    if (block.kind === 'heading' || block.kind === 'text' || block.kind === 'html') return Boolean((block.text || '').trim());
    return block.kind !== 'divider' && block.kind !== 'spacer';
  });
}

/** One choice in Send to and Leave out, with the count the server reported for it, or null when it reported none. */
export interface AudienceOption {
  id: string;
  name: string;
  count: number | null;
  kind: 'segment' | 'list';
  note: string;
}

const counted = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** GET /api/email/segments and GET /api/email/lists, as one list of choices. */
export function audienceOptions(segments: any[], lists: any[]): AudienceOption[] {
  const out: AudienceOption[] = [];
  for (const seg of Array.isArray(segments) ? segments : []) {
    if (!seg || typeof seg.id !== 'string') continue;
    out.push({ id: seg.id, name: String(seg.name || seg.id), count: counted(seg.count), kind: 'segment', note: String(seg.definition || seg.description || '') });
  }
  for (const list of Array.isArray(lists) ? lists : []) {
    if (!list || typeof list.id !== 'string') continue;
    out.push({ id: list.id, name: String(list.name || list.id), count: counted(list.count), kind: 'list', note: '' });
  }
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2026-12-01T09:30" as "2026-12-01 at 09:30". The route reads it in the account timezone, or UTC. */
function whenText(sendAt: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(sendAt || '');
  return m ? `${m[1]} at ${m[2]}` : 'the time you chose';
}

/**
 * The question Send or Schedule asks first. It names the audience and the count the server reported
 * for it, and when the server reported none it says so; it never fills in a number nobody measured.
 * A segment's count is the people in it who accept marketing (GET /api/email/segments); a list's is
 * every contact on it (GET /api/email/lists), and campaign/send skips anyone who cannot receive it.
 */
export function confirmSendText(draft: BroadcastDraft, options: AudienceOption[]): string {
  const s = draft.settings;
  const subject = draft.subject.trim() || 'this broadcast';
  const target = options.find((row) => row.id === s.include);
  const name = target?.name || s.include;
  const lead = s.sendWhen === 'now'
    ? `Send "${subject}" now to ${name}?`
    : s.sendWhen === 'smart'
      ? `Schedule "${subject}" for ${name}, at each person's hour?`
      : s.sendWhen === 'gradual'
        ? `Schedule "${subject}" for ${name}, in batches from ${whenText(s.sendAt)} in the account timezone (UTC when none is saved)?`
        : `Schedule "${subject}" for ${name} on ${whenText(s.sendAt)} in the account timezone (UTC when none is saved)?`;
  let count: string;
  if (target && target.count !== null) {
    count = target.kind === 'list'
      ? `The server counted ${plural(target.count, 'contact', 'contacts')} on this list. Anyone who cannot receive marketing is skipped.`
      : `The server counted ${plural(target.count, 'contact', 'contacts')} in this segment who accept marketing.`;
  } else {
    count = `The server has not reported how many people are in ${name}, so the number who get it is not known here.`;
  }
  const parts = [lead, count];
  if (s.exclude) {
    const left = options.find((row) => row.id === s.exclude)?.name || s.exclude;
    parts.push(`Anyone in ${left} is left out, so it may reach fewer.`);
  }
  if (s.holdoutOn) parts.push(`${s.holdoutPercent}% are held out and get nothing.`);
  if (s.smsMessage.trim()) parts.push('The text message goes out with it.');
  return parts.join(' ');
}

/** POST /api/email/send's body for a test: the email the preview route rendered from the blocks, to one address. */
export function testSendBody(address: string, subject: string, html: string) {
  return {
    recipients: [{ email: address.trim(), name: 'Test' }],
    subject: `Test: ${subject}`,
    html
  };
}

/** Plain enough to catch a typo before a test goes out; the email service decides the rest. */
export function looksLikeAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * The words of POST /api/email/lint's answer ({ score, warnings, checks }): the score, then each
 * warning, then each check that did not pass. A warning or a check may be a string or an object.
 */
export function lintSummary(data: any): string {
  if (!data || data.success === false) return String(data?.error || 'The check could not be run.');
  const text = (row: any) => (typeof row === 'string' ? row : String(row?.detail || row?.label || row?.message || '')).trim();
  const warnings = (Array.isArray(data.warnings) ? data.warnings : []).map(text).filter(Boolean);
  const checks = (Array.isArray(data.checks) ? data.checks : [])
    .filter((row: any) => row && typeof row === 'object' && row.level && row.level !== 'pass' && row.level !== 'ok')
    .map(text)
    .filter((line: string) => line && !warnings.includes(line));
  const score = Number.isFinite(Number(data.score)) && data.score !== null && data.score !== '' ? `Check score ${Number(data.score)}.` : '';
  const said = [score, ...warnings, ...checks].filter(Boolean).join(' ');
  return said || 'The check found nothing to fix.';
}
