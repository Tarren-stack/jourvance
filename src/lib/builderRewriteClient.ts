import type { ServerAnswer } from './saveOutcome';

/**
 * The page builder's call to POST /api/ai/builder-rewrite. It answers what came back and never
 * writes text itself: when the AI is off or refuses, the person keeps what they had.
 */

export type RewriteKind = 'heading' | 'text' | 'button' | 'list';

export type RewriteResult =
  | { ok: true; text: string }
  | { ok: true; items: string[] }
  | { ok: false; message: string; retryable: boolean };

/**
 * What the merchant reads when the AI is off. The route's `error` for that case names the hub key,
 * which a merchant has no way to set, so its `reason: 'ai-unavailable'` is answered with this.
 */
export const REWRITE_UNAVAILABLE = 'Writing with AI is not available right now. Your text is unchanged, and you can still edit it yourself.';

const FAILED: RewriteResult = { ok: false, message: 'Could not reach the server. Nothing changed. Try again.', retryable: true };

/** Reads the server's answer into a result. Pure, so it is testable without a network. */
export function readRewriteAnswer(answer: ServerAnswer | null): RewriteResult {
  if (!answer) return FAILED;
  const b = (answer.body && typeof answer.body === 'object' ? answer.body : {}) as Record<string, unknown>;
  if (answer.status === 200 && b.success === true) {
    if (Array.isArray(b.items)) {
      const items = b.items.filter((i): i is string => typeof i === 'string' && i.length > 0);
      if (items.length) return { ok: true, items };
    }
    if (typeof b.text === 'string' && b.text) return { ok: true, text: b.text };
  }
  if (b.reason === 'ai-unavailable') return { ok: false, message: REWRITE_UNAVAILABLE, retryable: false };
  const message = typeof b.error === 'string' && b.error ? b.error : 'The rewrite did not work. Nothing changed. Try again.';
  return { ok: false, message, retryable: b.retryable !== false && answer.status !== 429 };
}

/** Ask for one rewrite. `text` for a list is its items joined by new lines. */
export async function rewriteBuilderText(kind: RewriteKind, text: string, brief?: string): Promise<RewriteResult> {
  // Loaded here so readRewriteAnswer above stays importable by node's test runner, which cannot
  // resolve these extensionless modules (or firebase) at load time.
  const [{ requestAnswer }, { authHeaders }] = await Promise.all([import('./saveOutcome'), import('./firebase')]);
  const answer = await requestAnswer('/api/ai/builder-rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ kind, text, ...(brief ? { brief } : {}) })
  });
  return readRewriteAnswer(answer);
}
