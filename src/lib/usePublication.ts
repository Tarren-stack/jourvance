import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JourneyEdge, JourneyNode } from '../types/journey';
import { authHeaders } from './firebase';
import { requestAnswer, previewOutcome, type PreviewOutcome } from './saveOutcome';
import { publicationRead, stepPublishStates, type PublicationRead, type StepPublishState } from './publishState';

/**
 * Reads what is live for the open journey (GET /api/journey/:id/publication) and makes preview
 * links. The read runs on load, when auth or the journey changes, and on refresh() (after a
 * publish, an unpublish or "Check again"). Never on the stats poll.
 */

export type { PreviewOutcome } from './saveOutcome';

export interface UsePublicationOptions {
  /** False until the first auth answer, so a signed-in user never sees "Not published" early. */
  authReady: boolean;
  signedIn: boolean;
  journeyId: string;
  workspaceId?: string | null;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  /** App's save. A preview shows the SAVED copy, so it saves first. */
  save: () => Promise<boolean>;
}

export interface Publication {
  read: PublicationRead;
  states: Map<string, StepPublishState>;
  refresh: () => void;
  preview: (nodeId: string) => Promise<PreviewOutcome>;
}

export function usePublication({ authReady, signedIn, journeyId, workspaceId, nodes, edges, save }: UsePublicationOptions): Publication {
  const [refreshCount, setRefreshCount] = useState(0);
  const [fetched, setFetched] = useState<{ key: string; read: PublicationRead } | null>(null);
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  // A read belongs to the request that made it; any change of these starts over at "checking".
  const requestKey = `${authReady}|${signedIn}|${journeyId}|${refreshCount}`;

  useEffect(() => {
    if (!authReady || !signedIn || !journeyId) return;
    let cancelled = false;
    (async () => {
      const headers = await authHeaders();
      const answer = await requestAnswer(`/api/journey/${encodeURIComponent(journeyId)}/publication`, { headers });
      if (!cancelled) setFetched({ key: requestKey, read: publicationRead(answer) });
    })();
    return () => { cancelled = true; };
    // requestKey is built from exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, signedIn, journeyId, refreshCount]);

  const read: PublicationRead = useMemo(() => {
    if (!authReady) return { kind: 'checking' };
    if (!signedIn) return { kind: 'signed-out' };
    return fetched && fetched.key === requestKey ? fetched.read : { kind: 'checking' };
  }, [authReady, signedIn, fetched, requestKey]);

  const states = useMemo(() => stepPublishStates(nodes, edges, read), [nodes, edges, read]);

  const refresh = useCallback(() => setRefreshCount(c => c + 1), []);

  const preview = useCallback(async (nodeId: string): Promise<PreviewOutcome> => {
    if (!signedIn) {
      return { kind: 'refused', message: 'No preview. Sign in first: a preview shows the copy saved to your account.', retryable: false };
    }
    if (!(await saveRef.current())) {
      return { kind: 'refused', message: 'No preview, because the journey could not be saved first. Fix the save problem above, then try again.', retryable: false };
    }
    const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
    const answer = await requestAnswer(`/api/journey/${encodeURIComponent(journeyId)}/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ nodeId, workspaceId: workspaceId || undefined })
    });
    return previewOutcome(answer);
  }, [signedIn, journeyId, workspaceId]);

  return { read, states, refresh, preview };
}
