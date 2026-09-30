/**
 * Where a list the UI puts a count on stands. A count is a measurement, so it is shown only once the
 * list was actually read: before that, or after the read failed, there is no number to show, and a 0
 * would tell the owner "nothing here" when nobody looked (U08: "Abandoned Checkouts (0)" with the
 * checkouts never loaded).
 */
export type ListLoad = 'loading' | 'loaded' | 'failed';

/** " (3)" once the list was loaded, "" while it loads or after its load failed. Never a 0 nobody measured. */
export function loadedCountSuffix(load: ListLoad, count: number): string {
  return load === 'loaded' && Number.isFinite(count) && count >= 0 ? ` (${count})` : '';
}
