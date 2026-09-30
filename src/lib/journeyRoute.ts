/**
 * The one reading of the app's address: which page is open, which journey, and which step.
 *
 * The address used to be only /canvas, and both the first parse and the Back handler lowercased
 * the whole path, so /canvas/<id> fell through to the home page. Every journey and step now has
 * an address, /canvas/:journeyId?step=<nodeId>, and only the first segment is case-folded: a
 * journey id keeps its case.
 *
 * Pure: no imports, so `node --test` loads it directly.
 */

export type AppPage = 'home' | 'about' | 'blog' | 'contact' | 'canvas';

export interface AppRoute {
  page: AppPage;
  /** Canvas only: the journey the address names, or null for a bare /canvas. */
  journeyId: string | null;
  /** Canvas only: the step (node id) the address names. */
  step: string | null;
}

const PAGES: readonly AppPage[] = ['home', 'about', 'blog', 'contact', 'canvas'];
const CONTROL = /[\u0000-\u001f\u007f]/;

export const JOURNEY_ID_MAX = 120;
export const STEP_ID_MAX = 200;

/** A journey id an address may carry: 1 to 120 characters, no control characters, never '.' or '..'. */
export function isJourneyId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= JOURNEY_ID_MAX
    && !CONTROL.test(value)
    && value !== '.'
    && value !== '..';
}

const isStepId = (value: string | null): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= STEP_ID_MAX && !CONTROL.test(value);

/** Reads a pathname and query string. Anything unknown is the home page, never an error. */
export function parseAppLocation(pathname: string, search: string): AppRoute {
  const segments = String(pathname || '').split('/');
  // '/canvas/x' splits to ['', 'canvas', 'x']; a single trailing slash adds one empty segment.
  if (segments[0] === '') segments.shift();
  if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();

  const first = (segments[0] || '').toLowerCase();
  const page: AppPage = (PAGES as readonly string[]).includes(first) ? (first as AppPage) : 'home';
  if (page !== 'canvas') return { page, journeyId: null, step: null };

  let journeyId: string | null = null;
  if (segments.length === 2) {
    try {
      const decoded = decodeURIComponent(segments[1]);
      journeyId = isJourneyId(decoded) ? decoded : null;
    } catch {
      journeyId = null;
    }
  }

  let step: string | null = null;
  try {
    step = new URLSearchParams(search || '').get('step');
  } catch {
    step = null;
  }
  return { page, journeyId, step: isStepId(step) ? step : null };
}

/**
 * The address for a route. Query parameters the app does not own (utm_source and the like) are
 * kept; `step` is written only on the canvas, and removed everywhere else.
 */
export function buildAppPath(route: AppRoute, currentSearch: string): string {
  const params = new URLSearchParams(currentSearch || '');
  let path: string;
  if (route.page === 'home') path = '/';
  else if (route.page === 'canvas') path = '/canvas' + (route.journeyId ? '/' + encodeURIComponent(route.journeyId) : '');
  else path = '/' + route.page;

  if (route.page === 'canvas' && route.step) params.set('step', route.step);
  else params.delete('step');

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export type HistoryMode = 'push' | 'replace' | 'none';

/**
 * How a change of address enters the browser history. Choosing a step only replaces, so Back
 * moves between journeys and pages rather than between clicks; turning a bare /canvas into the
 * open journey's own address replaces too. Everything else is a new entry.
 */
export function historyMode(from: AppRoute, to: AppRoute): HistoryMode {
  if (buildAppPath(from, '') === buildAppPath(to, '')) return 'none';
  if (from.page === to.page && from.journeyId === to.journeyId) return 'replace';
  if (from.page === 'canvas' && from.journeyId === null && to.page === 'canvas') return 'replace';
  return 'push';
}
