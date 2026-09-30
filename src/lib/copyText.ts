// Copying text to the clipboard and saying what really happened. The Copy button on the thank-you
// preview said "Copied!" without ever writing to the clipboard, so a success is claimed here only
// once the browser has confirmed the write. Pure apart from the clipboard it is handed, so
// `node --test` loads it directly.

/** What a copy did: 'ok' once the browser confirmed the write, 'fail' otherwise. */
export type CopyResult = 'ok' | 'fail';

type ClipboardLike = { writeText: (text: string) => Promise<void> };

/**
 * Writes text to the clipboard. 'fail' when there is nothing to copy, no clipboard (an insecure
 * page, an old browser) or the browser refused the write (permission, focus).
 */
export async function copyText(
  text: string,
  clipboard: ClipboardLike | undefined = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
): Promise<CopyResult> {
  if (!text || typeof clipboard?.writeText !== 'function') return 'fail';
  try {
    await clipboard.writeText(text);
    return 'ok';
  } catch {
    return 'fail';
  }
}

/** The Copy button's own label for a result, and 'Copy' before any press. */
export function copyLabel(result: CopyResult | null): string {
  return result === 'ok' ? 'Copied' : result === 'fail' ? 'Could not copy' : 'Copy';
}

/** What a screen reader hears after a press. Empty before any press, so nothing is announced. */
export function copyAnnouncement(result: CopyResult | null, what: string): string {
  if (result === 'ok') return `${what} copied.`;
  if (result === 'fail') return `Could not copy the ${what.toLowerCase()}, so select it and copy it by hand.`;
  return '';
}
