import { authHeaders } from './firebase';
import type { ServerAnswer } from './saveOutcome';
import type { JourneyAiBrief } from './journeyAi';

export interface AICopyRequest {
  nodeType: 'ad' | 'page' | 'email';
  businessType?: string;
  offerHeadline: string;
  goal?: string;
}

// The raw /api/ai/copy answer, with no fallback copy of any kind, and the only client for that
// route. The caller reads `source` itself (pageCopyProposal's readCopyAnswer, readAdCopyAnswer and
// readEmailCopyAnswer), so template text can never pass for AI. Null means the request never got
// an answer.
export async function requestAICopyAnswer(req: AICopyRequest): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch('/api/ai/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(req)
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch {
    return null;
  }
}

/** A whole-journey draft can take a while; past this the request is given up. */
export const JOURNEY_PLAN_TIMEOUT_MS = 75_000;

// The raw /api/ai/journey-plan answer for journeyAi.aiPlanOutcome to read. Null means the request
// never got an answer: offline, aborted because the dialog closed, or past the timeout.
export async function requestJourneyPlan(brief: JourneyAiBrief, signal?: AbortSignal): Promise<ServerAnswer | null> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (signal?.aborted) return null;
  signal?.addEventListener('abort', stop);
  const timer = setTimeout(stop, JOURNEY_PLAN_TIMEOUT_MS);
  try {
    const res = await fetch('/api/ai/journey-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(brief),
      signal: controller.signal
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}
