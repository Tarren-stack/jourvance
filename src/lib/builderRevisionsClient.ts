import { requestAnswer, type ServerAnswer } from './saveOutcome';
import { authHeaders } from './firebase';

/**
 * The page builder's revision history (server/builderRevisions.mjs). Each call answers what came
 * back, or null when no answer came at all, and decides nothing: read it with the helpers below.
 */

export interface BuilderRevisionSummary {
  rev: number;
  nodeId: string;
  publishedAt: string;
  fingerprint: string | null;
  userId: string;
  hasB: boolean;
}

export interface BuilderRevision extends Omit<BuilderRevisionSummary, 'hasB'> {
  document: unknown;
  documentB?: unknown;
}

/** GET /api/journey/:id/builder-revisions?nodeId= : the list, newest first, without documents. */
export async function listBuilderRevisions(journeyId: string, nodeId: string): Promise<ServerAnswer | null> {
  return requestAnswer(
    `/api/journey/${encodeURIComponent(journeyId)}/builder-revisions?nodeId=${encodeURIComponent(nodeId)}`,
    { headers: await authHeaders() }
  );
}

/** GET /api/journey/:id/builder-revisions/:rev?nodeId= : one revision with its document. */
export async function getBuilderRevision(journeyId: string, nodeId: string, rev: number): Promise<ServerAnswer | null> {
  return requestAnswer(
    `/api/journey/${encodeURIComponent(journeyId)}/builder-revisions/${encodeURIComponent(String(rev))}?nodeId=${encodeURIComponent(nodeId)}`,
    { headers: await authHeaders() }
  );
}

/** The summaries from a list answer, or null when it was not a success. */
export function revisionsFrom(answer: ServerAnswer | null): BuilderRevisionSummary[] | null {
  const body = answer?.body as { success?: unknown; revisions?: unknown } | undefined;
  return answer && answer.status >= 200 && answer.status < 300 && body?.success === true && Array.isArray(body.revisions)
    ? (body.revisions as BuilderRevisionSummary[])
    : null;
}

/** The revision from a get answer, or null when it was not a success. */
export function revisionFrom(answer: ServerAnswer | null): BuilderRevision | null {
  const body = answer?.body as { success?: unknown; revision?: unknown } | undefined;
  return answer && answer.status >= 200 && answer.status < 300 && body?.success === true && body.revision && typeof body.revision === 'object'
    ? (body.revision as BuilderRevision)
    : null;
}
