import test from 'node:test';
import assert from 'node:assert/strict';

// The address used to be only /canvas, and App lowercased the whole path before choosing a page,
// so /canvas/<id> fell through to the home page. src/lib/journeyRoute.ts is now the one reading of
// /canvas/:journeyId?step=<nodeId>.

const { parseAppLocation, buildAppPath, historyMode, isJourneyId } = await import('./src/lib/journeyRoute.ts');

const canvas = (journeyId, step = null) => ({ page: 'canvas', journeyId, step });

test('a bare /canvas names no journey and no step', () => {
  assert.deepEqual(parseAppLocation('/canvas', ''), { page: 'canvas', journeyId: null, step: null });
  assert.deepEqual(parseAppLocation('/canvas/', ''), { page: 'canvas', journeyId: null, step: null });
});

test('a journey address carries its id and step', () => {
  assert.deepEqual(parseAppLocation('/canvas/lead-capture-core', '?step=node-ad-1'), canvas('lead-capture-core', 'node-ad-1'));
});

test('only the first segment is case-folded, so a mixed-case id keeps its case', () => {
  assert.deepEqual(parseAppLocation('/Canvas/Journey_AB', ''), canvas('Journey_AB'));
});

test('a malformed or extra segment names no journey and never throws', () => {
  assert.deepEqual(parseAppLocation('/canvas/%E0%A4%A', ''), canvas(null));
  assert.deepEqual(parseAppLocation('/canvas/a/b', ''), canvas(null));
  assert.deepEqual(parseAppLocation('/canvas/..', ''), canvas(null));
});

test('public pages, unknown paths and a step off the canvas', () => {
  assert.deepEqual(parseAppLocation('/about', ''), { page: 'about', journeyId: null, step: null });
  assert.deepEqual(parseAppLocation('/nope', ''), { page: 'home', journeyId: null, step: null });
  assert.deepEqual(parseAppLocation('/', '?step=n1'), { page: 'home', journeyId: null, step: null });
  assert.equal(parseAppLocation('/blog', '?step=n1').step, null);
});

test('a step with a control character or over 200 characters is ignored', () => {
  assert.equal(parseAppLocation('/canvas/x', '?step=a%0Ab').step, null);
  assert.equal(parseAppLocation('/canvas/x', `?step=${'s'.repeat(201)}`).step, null);
  assert.equal(parseAppLocation('/canvas/x', `?step=${'s'.repeat(200)}`).step, 's'.repeat(200));
});

test('buildAppPath encodes the id, keeps foreign parameters and round-trips', () => {
  const path = buildAppPath(canvas('a b/c', 'n1'), '?utm_source=x');
  assert.equal(path, '/canvas/a%20b%2Fc?utm_source=x&step=n1');
  const [pathname, query] = path.split('?');
  assert.deepEqual(parseAppLocation(pathname, `?${query}`), canvas('a b/c', 'n1'));
});

test('buildAppPath removes the step when there is none, and off the canvas', () => {
  assert.equal(buildAppPath(canvas('j1'), '?step=old&utm_source=x'), '/canvas/j1?utm_source=x');
  assert.equal(buildAppPath({ page: 'about', journeyId: null, step: 'n1' }, '?step=old'), '/about');
  assert.equal(buildAppPath({ page: 'home', journeyId: null, step: null }, ''), '/');
  assert.equal(buildAppPath(canvas(null), ''), '/canvas');
});

test('historyMode: a step is replaced, a journey or page is pushed, nothing new is none', () => {
  assert.equal(historyMode(canvas('j1', 'n1'), canvas('j1', 'n2')), 'replace');
  assert.equal(historyMode(canvas('j1'), canvas('j1', 'n2')), 'replace');
  assert.equal(historyMode(canvas(null), canvas('j1')), 'replace');
  assert.equal(historyMode(canvas('j1'), canvas('j2')), 'push');
  assert.equal(historyMode(canvas('j1', 'n1'), { page: 'about', journeyId: null, step: null }), 'push');
  assert.equal(historyMode({ page: 'home', journeyId: null, step: null }, canvas('j1')), 'push');
  assert.equal(historyMode(canvas('j1', 'n1'), canvas('j1', 'n1')), 'none');
});

test('isJourneyId', () => {
  assert.equal(isJourneyId('lead-capture-core'), true);
  assert.equal(isJourneyId('x'.repeat(120)), true);
  assert.equal(isJourneyId(''), false);
  assert.equal(isJourneyId('x'.repeat(121)), false);
  assert.equal(isJourneyId('\n'), false);
  assert.equal(isJourneyId('..'), false);
  assert.equal(isJourneyId('.'), false);
  assert.equal(isJourneyId(42), false);
});
