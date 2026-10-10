/**
 * A lazy part of the app whose file did not arrive (ChunkBoundary.tsx). After a deploy, an open tab
 * still asks for the old build's chunk names, and the host no longer has them; without a boundary
 * that failed import unmounted the whole app.
 */

/** What ChunkBoundary says in place of the part that did not load. */
export const CHUNK_NOT_LOADED = 'This part of Jourvance did not load. Reload the page to get the newest version.';

/**
 * True for the error a lazy import rejects with when its file did not arrive: Chrome's
 * "Failed to fetch dynamically imported module", Firefox's "error loading dynamically imported
 * module", Safari's "Importing a module script failed", and Vite's own "Unable to preload CSS".
 * Anything else is a bug in a part that did load, and the boundary passes it on.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  const said = typeof message === 'string' ? message : '';
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(said);
}
