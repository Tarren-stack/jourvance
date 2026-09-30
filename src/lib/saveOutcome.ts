/**
 * What a save or a publish actually achieved, read from the server's answer.
 *
 * The canvas used to show "Saved!" and "Funnel Successfully Published!" whatever happened: the
 * save swallowed every fetch error, and a failed publish fell back to marking pages live on the
 * client. These functions turn the answer (or its absence) into one honest state, with a sentence
 * a person can act on and a flag that says whether trying again can help.
 */

export type SaveStatus =
  | { kind: 'idle' }
  /** Saved to the signed-in account and backed up. */
  | { kind: 'saved'; savedUpdatedAt: string }
  /** Signed out: kept in this browser only. */
  | { kind: 'browser-only'; savedUpdatedAt: string }
  /** The server kept it but could not back it up, so a restart could lose it. */
  | { kind: 'not-backed-up'; savedUpdatedAt: string }
  /**
   * `action: 'open-library'`: the fix is in the journey library (this browser is out of space), so
   * the banner offers a button that opens it in place of Try again.
   */
  | { kind: 'failed'; message: string; retryable: boolean; action?: 'open-library' };

export interface Refusal {
  message: string;
  retryable: boolean;
}

/** A parsed server answer; `null` means the request never got one (offline, DNS, CORS). */
export interface ServerAnswer {
  status: number;
  body: unknown;
}

/** Send a request and read its JSON answer; null when no answer came back at all. */
export async function requestAnswer(url: string, init: RequestInit): Promise<ServerAnswer | null> {
  try {
    const res = await fetch(url, init);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch {
    return null;
  }
}

const bodyError = (body: unknown): string => {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error.trim() : '';
};

const retryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

const LEADS = {
  save: { lead: 'Not saved', offline: ' Your changes are kept in this browser.' },
  publish: { lead: 'Not published', offline: '' },
  unpublish: { lead: 'Still live', offline: '' },
  rename: { lead: 'Not renamed', offline: '' },
  preview: { lead: 'No preview', offline: '' }
} as const;

function refusal(action: keyof typeof LEADS, answer: ServerAnswer | null): Refusal {
  const { lead, offline } = LEADS[action];
  if (!answer) {
    return {
      message: `${lead} because the server could not be reached.${offline} Check your connection and try again.`,
      retryable: true
    };
  }
  if (answer.status === 401) {
    return { message: `${lead} because your sign-in has expired. Sign in again, then try once more.`, retryable: false };
  }
  const said = bodyError(answer.body);
  return {
    message: said ? `${lead}. ${said}` : `${lead}. The server answered with status ${answer.status}.`,
    retryable: retryableStatus(answer.status)
  };
}

const succeeded = (answer: ServerAnswer | null): answer is ServerAnswer =>
  !!answer && answer.status >= 200 && answer.status < 300 && (answer.body as { success?: unknown } | null)?.success === true;

/** The save state for an answer to POST /api/user/:uid/journey/:id. */
export function saveOutcome(answer: ServerAnswer | null, savedUpdatedAt: string): SaveStatus {
  if (!succeeded(answer)) return { kind: 'failed', ...refusal('save', answer) };
  const durable = (answer.body as { durable?: unknown }).durable;
  return durable === false
    ? { kind: 'not-backed-up', savedUpdatedAt }
    : { kind: 'saved', savedUpdatedAt };
}

/** Said when a browser save failed because this browser's storage for the site is full. */
export const BROWSER_OUT_OF_SPACE = 'This browser is out of space for journeys. Remove one you no longer need, or sign in to save to your account.';

/**
 * The save state when signed out, where this browser's copy is the only save. A refused write is
 * a failure: the status must not say "Saved in this browser" when closing the tab would lose it.
 * `full` (journeyStorage.ts keepJourney) says storage is full: retrying cannot help, removing a
 * journey from the library can.
 */
export function browserSaveOutcome(kept: boolean, savedUpdatedAt: string, full = false): SaveStatus {
  if (kept) return { kind: 'browser-only', savedUpdatedAt };
  if (full) return { kind: 'failed', message: BROWSER_OUT_OF_SPACE, retryable: false, action: 'open-library' };
  return {
    kind: 'failed',
    message: 'Not saved. This browser would not store the journey, so closing this tab would lose your changes. Sign in to save it to your account.',
    retryable: false
  };
}

/**
 * Why a publish did not put anything live, or null when it did. A success that published no
 * page is reported too: the success screen would otherwise announce live pages that do not exist.
 */
export function publishRefusal(answer: ServerAnswer | null): Refusal | null {
  if (!succeeded(answer)) {
    const refused = refusal('publish', answer);
    // Some pages went live and the server's sentence says which, so it must not lead "Not published".
    if (publishedPartly(answer)) {
      const said = bodyError(answer!.body);
      return { message: said ? `Partly published. ${said}` : 'Partly published. Some pages could not be saved. Publish again.', retryable: refused.retryable };
    }
    return refused;
  }
  const pages = (answer.body as { publishedPages?: unknown }).publishedPages;
  if (!Array.isArray(pages) || pages.length === 0) {
    return {
      message: 'Nothing was published because this journey has no landing page or A/B split yet. Add a landing page, then publish.',
      retryable: false
    };
  }
  return null;
}

/** A refused publish that still put some pages live (the server's `partial: true`). */
export function publishedPartly(answer: ServerAnswer | null): boolean {
  return !!answer && (answer.body as { partial?: unknown } | null)?.partial === true;
}

/**
 * What a successful publish still needs to say, or null: an old address that could not be taken
 * down (`stillLive`), or pages kept on this server only (`durable: false`).
 */
export function publishWarning(answer: ServerAnswer | null): string | null {
  if (!succeeded(answer)) return null;
  const body = answer.body as { stillLive?: unknown; durable?: unknown };
  const stillLive = Array.isArray(body.stillLive) ? body.stillLive.filter((u): u is string => typeof u === 'string' && !!u) : [];
  const parts: string[] = [];
  if (stillLive.length) {
    parts.push(`${stillLive.length === 1 ? 'An old address may' : 'Old addresses may'} still be live: ${stillLive.join(', ')}. Publish again or take the funnel offline to take ${stillLive.length === 1 ? 'it' : 'them'} down.`);
  }
  if (body.durable === false) {
    parts.push('These pages are live on this server only. They were not saved to storage, so a restart could take them offline.');
  }
  return parts.length ? parts.join(' ') : null;
}

/** Why an unpublish did not take the funnel offline, or null when it did. */
export function unpublishRefusal(answer: ServerAnswer | null): Refusal | null {
  return succeeded(answer) ? null : refusal('unpublish', answer);
}

/** Why a rename from the journey library did not reach the account copy, or null when it did. */
export function renameRefusal(answer: ServerAnswer | null): Refusal | null {
  return succeeded(answer) ? null : refusal('rename', answer);
}

/** A preview link from POST /api/journey/:id/preview, or why there is none. */
export type PreviewOutcome =
  | { kind: 'ready'; url: string; expiresAt: string }
  | { kind: 'refused'; message: string; retryable: boolean };

/**
 * The preview link in an answer. Only a success carrying a /p/preview/ link and an expiry that
 * parses is ready: the panel shows how long the link works, so a link without one is no link.
 */
export function previewOutcome(answer: ServerAnswer | null): PreviewOutcome {
  if (!succeeded(answer)) return { kind: 'refused', ...refusal('preview', answer) };
  const { url, expiresAt } = answer.body as { url?: unknown; expiresAt?: unknown };
  if (typeof url !== 'string' || !url.startsWith('/p/preview/') || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))) {
    return { kind: 'refused', message: 'No preview. The server did not send a preview link.', retryable: true };
  }
  return { kind: 'ready', url, expiresAt };
}

/** Save states that no longer describe the canvas once it has been edited since. */
export function isStale(status: SaveStatus, currentUpdatedAt: string): boolean {
  return 'savedUpdatedAt' in status && status.savedUpdatedAt !== currentUpdatedAt;
}
