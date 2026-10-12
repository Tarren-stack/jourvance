import { authHeaders } from './firebase';
import type { ServerAnswer } from './saveOutcome';
import type { AssistantScreen } from './assistant';

/** The question can take a while: the hub's brain is asked and retrieval runs first. */
export const ASSISTANT_ASK_TIMEOUT_MS = 60_000;
const OTHER_TIMEOUT_MS = 20_000;

// One call to /api/ai/assistant/*. Null means the request never got an answer: offline, aborted by
// the caller, or past the timeout. The readers in assistant.ts turn the answer into a state.
async function call(method: string, path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<ServerAnswer | null> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (signal?.aborted) return null;
  signal?.addEventListener('abort', stop);
  const timer = setTimeout(stop, timeoutMs);
  try {
    const res = await fetch(path, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(await authHeaders()) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

// GET has no body, so the screen rides in the query as one JSON value.
export const fetchThread = (screen?: AssistantScreen, signal?: AbortSignal) =>
  call('GET', '/api/ai/assistant/thread' + (screen ? `?screen=${encodeURIComponent(JSON.stringify(screen))}` : ''), undefined, OTHER_TIMEOUT_MS, signal);
export const ask = (message: string, screen?: AssistantScreen, signal?: AbortSignal) =>
  call('POST', '/api/ai/assistant/ask', { message, ...(screen ? { screen } : {}) }, ASSISTANT_ASK_TIMEOUT_MS, signal);
export const saveNotes = (notes: string) => call('POST', '/api/ai/assistant/notes', { notes }, OTHER_TIMEOUT_MS);
export const sendFeedback = (answerId: string, rating: 'up' | 'down') =>
  call('POST', '/api/ai/assistant/feedback', { answerId, rating }, OTHER_TIMEOUT_MS);
export const clearThread = () => call('DELETE', '/api/ai/assistant/thread', undefined, OTHER_TIMEOUT_MS);
