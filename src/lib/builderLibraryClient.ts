import { authHeaders } from './firebase';
import { requestAnswer, type ServerAnswer } from './saveOutcome';
import type { BuilderNode } from '../types/pageBuilder';

/**
 * The saved sections library's calls to this app's own server (server/routes/builderLibraryRoutes.mjs).
 * Each one answers what came back, or null when no answer came at all, and never decides what it
 * means; `readLibraryList`, `readLibrarySave` and `readLibraryDelete` do that.
 */

export interface LibraryItem {
  id: string;
  name: string;
  section: BuilderNode;
  createdAt: string;
}

export interface LibraryList {
  items: LibraryItem[];
  /** False when the account store answered only part of the list; `reason` says why. */
  complete: boolean;
  reason?: string;
}

export type LibraryOutcome<T> =
  | { ok: true; durable: boolean; reason?: string; value: T }
  | { ok: false; error: string; retryable: boolean };

const OFFLINE = 'Your saved sections could not be reached. Check your connection and try again.';

const jsonHeaders = async () => ({ 'Content-Type': 'application/json', ...(await authHeaders()) });

export async function listLibrary(): Promise<ServerAnswer | null> {
  return requestAnswer('/api/builder/library', { headers: await authHeaders() });
}

export async function saveLibraryItem(name: string, section: BuilderNode): Promise<ServerAnswer | null> {
  return requestAnswer('/api/builder/library', { method: 'POST', headers: await jsonHeaders(), body: JSON.stringify({ name, section }) });
}

export async function deleteLibraryItem(id: string): Promise<ServerAnswer | null> {
  return requestAnswer(`/api/builder/library/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeaders() });
}

const failure = (answer: ServerAnswer | null): { ok: false; error: string; retryable: boolean } => {
  if (!answer) return { ok: false, error: OFFLINE, retryable: true };
  const error = (answer.body as { error?: unknown } | null)?.error;
  return {
    ok: false,
    error: typeof error === 'string' && error.trim() ? error.trim() : OFFLINE,
    retryable: answer.status === 408 || answer.status === 429 || answer.status >= 500
  };
};

const durability = (body: unknown): { durable: boolean; reason?: string } => {
  const b = (body ?? {}) as { durable?: unknown; reason?: unknown };
  return { durable: b.durable === true, ...(typeof b.reason === 'string' && b.reason ? { reason: b.reason } : {}) };
};

export function readLibraryList(answer: ServerAnswer | null): LibraryOutcome<LibraryList> {
  const b = answer?.body as { success?: boolean; items?: unknown; complete?: unknown; reason?: unknown } | undefined;
  if (!answer || answer.status !== 200 || !b?.success || !Array.isArray(b.items)) return failure(answer);
  return {
    ok: true,
    durable: true,
    value: {
      items: b.items as LibraryItem[],
      complete: b.complete !== false,
      ...(typeof b.reason === 'string' && b.reason ? { reason: b.reason } : {})
    }
  };
}

export function readLibrarySave(answer: ServerAnswer | null): LibraryOutcome<LibraryItem> {
  const b = answer?.body as { success?: boolean; item?: LibraryItem } | undefined;
  if (!answer || answer.status !== 200 || !b?.success || !b.item) return failure(answer);
  return { ok: true, ...durability(answer.body), value: b.item };
}

export function readLibraryDelete(answer: ServerAnswer | null): LibraryOutcome<null> {
  const b = answer?.body as { success?: boolean } | undefined;
  if (!answer || answer.status !== 200 || !b?.success) return failure(answer);
  return { ok: true, ...durability(answer.body), value: null };
}
