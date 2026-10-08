// How Email Studio prints a number it may not have. A figure the server did not measure reads
// 'Unavailable', never 0 and never a dash, the same word the journey map uses (journeyMetrics).
// Kept free of value imports so node tests can load it straight from the .ts file.

export const STAT_UNAVAILABLE = 'Unavailable';

/** Shown while opens cannot be stored. Hidden once the secret and a public https origin are both set. */
export const OPENS_UNSTORED = 'Opens stay blank until MAIL_EVENT_SECRET and a public https PUBLIC_BASE_URL are set.';

/** A measured number as text, or 'Unavailable' when it is null, missing or not a finite number. */
export function statText(value: number | null | undefined, format: (n: number) => string = String): string {
  return typeof value === 'number' && Number.isFinite(value) ? format(value) : STAT_UNAVAILABLE;
}

/** Dollars with cents, or 'Unavailable'. */
export function moneyText(value: number | null | undefined): string {
  return statText(value, (n) => `$${n.toFixed(2)}`);
}

/**
 * Joins a name and an optional note with a middle dot, never a dash. Blank parts drop out, so a
 * missing note leaves no trailing separator.
 */
export function withNote(name: string, note?: string | null): string {
  return [name, note].map((part) => String(part ?? '').trim()).filter(Boolean).join(' · ');
}
