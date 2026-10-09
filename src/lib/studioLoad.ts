/**
 * Email Studio's reads (EMAIL_STUDIO_PLAN.md D6, Wave 6): what each list says while it loads, when its
 * read failed, and when it loaded and holds nothing. A read that failed never says "none", "no
 * replies" or a 0: a list is called empty only when the server answered with a list that is empty.
 *
 * Pure words and pure rules, no React. The one network helper (studioRead) only settles a fetch, so a
 * read the server never answered comes back as `{ answered: false }` and never rejects. The node tests
 * import this file straight from the .ts (email-studio-states.test.mjs).
 */

/** One read: unanswered (the fetch rejected), or answered with an HTTP status and its JSON body. */
export type StudioRead = { answered: false } | { answered: true; status: number; data: any };

/** Where one list stands after a read. Retry is offered only where retrying can help. */
export type ReadOutcome = { state: 'loaded' } | { state: 'failed'; text: string; retry: boolean };
export type ListState = { state: 'loading' } | ReadOutcome;

export const LIST_LOADING: ListState = { state: 'loading' };

/** What a read's failure says. */
export interface ReadWords {
  /** 401: the reader is signed out. Retrying cannot help. */
  signIn: string;
  /** Any other failure, in one sentence. */
  failed: string;
  /** A route that reads the email service answers 503 while sending is not connected. Retrying cannot help. */
  notConnected?: string;
}

/** What a list says while it loads and once it loaded empty. */
export interface ListWords {
  loading: string;
  empty: string;
}

/** server.mjs proxyHub: `res.status(503).json({ success: false, error: 'Email sending is not connected.' })`. */
export const NOT_CONNECTED_ERROR = /^Email sending is not connected\b/;

/** Added to a list's failure sentence when the server never answered. */
export const UNANSWERED_TAIL = 'The server did not answer.';

/**
 * One read's outcome. `holds` says whether an answered body carries the list (for example
 * `Array.isArray(data.broadcasts)`); a 200 without it is a failure, never an empty list.
 */
export function readOutcome(read: StudioRead, words: ReadWords, holds: (data: any) => boolean): ReadOutcome {
  if (!read.answered) return { state: 'failed', text: `${words.failed} ${UNANSWERED_TAIL}`, retry: true };
  if (read.status === 401) return { state: 'failed', text: words.signIn, retry: false };
  const data = read.data && typeof read.data === 'object' ? read.data : null;
  if (words.notConnected && read.status === 503 && NOT_CONNECTED_ERROR.test(String(data?.error || ''))) {
    return { state: 'failed', text: words.notConnected, retry: false };
  }
  if (read.status >= 400 || !data || data.success === false || !holds(data)) return { state: 'failed', text: words.failed, retry: true };
  return { state: 'loaded' };
}

/**
 * What the reads relayed from the email service hold. server.mjs proxyHub answers every 2xx it relays as
 * `{ success: true, ...data }`, so a body without `success: true` (an empty body, or a page some proxy
 * answered 200 with, which studioRead reads as `{}`) did not come from it: a failure, never an inbox
 * with no replies or a status that loaded. An answer that says success with no messages field is an
 * inbox with none, as before.
 */
export const INBOX_HOLDS = (data: any): boolean => data.success === true && (data.messages == null || Array.isArray(data.messages));
export const REPLY_POLICY_HOLDS = (data: any): boolean => data.success === true && (data.policy == null || typeof data.policy === 'object');
export const TEXTS_HOLDS = (data: any): boolean => data.success === true;

/** Runs one GET. A rejection (no server) comes back as `{ answered: false }`; a body that is not JSON is read as `{}`. */
export async function studioRead(url: string, headers: Record<string, string>): Promise<StudioRead> {
  try {
    const res = await fetch(url, { headers });
    const data = await res.json().catch(() => ({}));
    return { answered: true, status: res.status, data };
  } catch {
    return { answered: false };
  }
}

/**
 * A Retry button's accessible name: the word on the button first, so what a person sees is inside what a
 * screen reader or voice control hears (WCAG 2.5.3), then the failure it answers, so in a list of buttons
 * each Retry says which read it tries again. While that read runs the button says Retrying.
 */
export function retryLabel(failure: string, busy = false): string {
  return `${busy ? 'Retrying' : 'Retry'}: ${String(failure || '').trim()}`;
}

/** The one line a list shows above its rows: nothing, the loading line, the empty line, or its failure. */
export type ListLine =
  | { kind: 'none' | 'loading' | 'empty'; text: string }
  | { kind: 'failed'; text: string; retry: boolean };

/**
 * The line for a list with `count` rows on screen. A failure is said even over rows an earlier read
 * left showing; the empty line only of a list that loaded with nothing in it.
 */
export function listLine(load: ListState, count: number, words: ListWords): ListLine {
  if (load.state === 'loading') return { kind: 'loading', text: words.loading };
  if (load.state === 'failed') return { kind: 'failed', text: load.text, retry: load.retry };
  return count > 0 ? { kind: 'none', text: '' } : { kind: 'empty', text: words.empty };
}

// ---- The words, one set per list (D6). Retry is decided by readOutcome, never here. ----

export const BROADCASTS_READ: ReadWords = { signIn: "Sign in to see this account's broadcasts.", failed: 'Broadcasts could not be loaded.' };
export const BROADCASTS_LIST: ListWords = { loading: 'Loading broadcasts.', empty: 'No broadcasts yet. New broadcast opens the builder.' };

export const RESULTS_READ: ReadWords = { signIn: "Sign in to see this account's results.", failed: 'Results could not be loaded.' };
export const RESULTS_LIST: ListWords = { loading: 'Loading results.', empty: 'Nothing has been sent yet, so there are no results.' };

export const PEOPLE_READ: ReadWords = { signIn: "Sign in to see this account's people.", failed: 'People could not be loaded.' };
export const PEOPLE_LIST: ListWords = { loading: 'Loading people.', empty: 'No people yet. A lead from one of your pages, or a customer synced from Shopify, shows here.' };

export const STARTER_PEOPLE_READ: ReadWords = { signIn: 'Sign in to see who is in the starter flows.', failed: 'The people in starter flows could not be loaded.' };
export const STARTER_PEOPLE_LIST: ListWords = { loading: 'Loading the people in starter flows.', empty: 'Nobody is in a starter flow yet.' };

export const REPLIES_READ: ReadWords = {
  signIn: "Sign in to see this account's replies.",
  failed: 'The replies could not be loaded.',
  notConnected: 'Replies cannot be read while email sending is not connected.'
};
export const REPLIES_LIST: ListWords = { loading: 'Loading replies.', empty: 'No replies have arrived for this account.' };

export const REPLY_POLICY_READ: ReadWords = {
  signIn: "Sign in to see this account's reply policy.",
  failed: 'The reply policy could not be loaded.',
  notConnected: 'The reply policy cannot be read while email sending is not connected.'
};

/** Texts counts the contacts with a phone from the audience read; its failure is said on its own line. */
export const PHONES_READ: ReadWords = { signIn: 'Sign in to count the contacts with a phone.', failed: 'Contacts with a phone could not be counted.' };

export const TEXTS_READ: ReadWords = {
  signIn: 'Sign in to see text messaging status.',
  failed: 'Text messaging status could not be loaded.',
  notConnected: 'Text messaging status cannot be read while email sending is not connected.'
};

export const SEGMENTS_READ: ReadWords = { signIn: "Sign in to see this account's lists and segments.", failed: 'Lists and segments could not be loaded.' };
export const LISTS_LIST: ListWords = { loading: 'Loading lists.', empty: 'No lists on this account yet.' };

export const FORMS_READ: ReadWords = { signIn: "Sign in to see this account's sign-up forms.", failed: 'Sign-up forms could not be loaded.' };
export const FORMS_LIST: ListWords = { loading: 'Loading sign-up forms.', empty: 'No sign-up forms yet.' };

export const SENDING_READ: ReadWords = { signIn: "Sign in to see this account's sending setup.", failed: 'The sending setup could not be loaded.' };

/** Sending, the postal address (GET /api/email/suite). Until it loaded, Save Postal Footer saves nothing. */
export const POSTAL_READ: ReadWords = { signIn: "Sign in to see this account's postal address.", failed: 'The saved postal address could not be loaded.' };
export const POSTAL_NOT_SAVED = 'Nothing was saved. The saved postal address has not loaded, so saving now could replace it. Retry it first.';

export const KLAVIYO_READ: ReadWords = { signIn: "Sign in to see this account's Klaviyo connection.", failed: 'The Klaviyo connection could not be loaded.' };

/** Results: true only when the server measured the sends and counted none. An unmeasured figure is not 0. */
export function nothingSent(analytics: { sent?: number | null; totalSent?: number | null } | null | undefined): boolean {
  if (!analytics) return false;
  const sent = analytics.sent ?? analytics.totalSent;
  return sent === 0;
}

/** The Results line: loading, its failure, "nothing sent", or nothing over the figures. */
export function resultsLine(load: ListState, analytics: { sent?: number | null; totalSent?: number | null } | null | undefined): ListLine {
  if (load.state === 'loaded' && !analytics) return { kind: 'failed', text: RESULTS_READ.failed, retry: true };
  return listLine(load, nothingSent(analytics) ? 0 : 1, RESULTS_LIST);
}
