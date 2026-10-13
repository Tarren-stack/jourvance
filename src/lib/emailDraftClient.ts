import { authHeaders } from './firebase';
import { readDraftOutcome, type DraftOutcome, type EmailDraftRequest } from './emailDraft';

/** A draft asks the hub's brain, which retrieves first; past this the request is given up. */
export const EMAIL_DRAFT_TIMEOUT_MS = 60_000;

// The only client for POST /api/ai/email-draft. It answers the outcome readDraftOutcome reads from
// the server's answer: a draft with its grounding, or the sentence to show and whether Retry can help.
// No answer (offline, aborted by the caller, past the timeout) is an outcome too, never a throw.
export async function requestEmailDraft(body: EmailDraftRequest, signal?: AbortSignal): Promise<DraftOutcome> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (signal?.aborted) return readDraftOutcome(null);
  signal?.addEventListener('abort', stop);
  const timer = setTimeout(stop, EMAIL_DRAFT_TIMEOUT_MS);
  try {
    const res = await fetch('/api/ai/email-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return readDraftOutcome({ status: res.status, body: await res.json().catch(() => ({})) });
  } catch {
    return readDraftOutcome(null);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}
