// A journey switch that is refused (#18, finding C45): the sentence appears in ONE place, and
// "Try again" is offered only when trying again can help.
//
// The real useJourneyNavigation.ts is bundled with esbuild (already installed with Vite) against a
// stub React whose hooks are plain functions, so its switch functions run in Node and every
// setState is recorded. Signed out there is no account to save to and retrying does not free
// browser storage, so that refusal is not retryable and never mentions the account. The library
// dialog shows a refusal itself, so a switch it starts passes `inline` and the header notice stays
// empty; a switch from anywhere else (Back, a deep link, a blueprint) still uses the notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const lib = await import('./src/lib/journeyLibrary.ts');

const REACT_STUB = `
  // Every setState call, in order, where the test can read it.
  globalThis.__reactLog = [];
  const log = globalThis.__reactLog;
  export function useState(init) {
    const value = typeof init === 'function' ? init() : init;
    return [value, next => { log.push(next); }];
  }
  export const useRef = current => ({ current });
  export const useCallback = fn => fn;
  export const useMemo = fn => fn();
  export const useEffect = () => {};
`;
const CLIENT_STUB = `
  export const calls = [];
  export async function getAccountJourney(id) { calls.push(['get', id]); return null; }
  export async function saveAccountJourney(uid, p) { calls.push(['save', p.id]); return null; }
`;

const bundled = await build({
  entryPoints: [new URL('./src/lib/useJourneyNavigation.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
      b.onResolve({ filter: /\/journeyClient$/ }, () => ({ path: 'journeyClient', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: a.path === 'react' ? REACT_STUB : CLIENT_STUB, loader: 'js' }));
    }
  }]
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

// ---- A browser whose storage refuses every journey copy ----
globalThis.window = {
  location: { pathname: '/canvas/journey-open', search: '' },
  history: { state: null, replaceState() {}, pushState() {} },
  addEventListener() {},
  removeEventListener() {}
};
globalThis.localStorage = {
  getItem: () => null,
  setItem: key => { if (String(key).startsWith('jourvance_journey:')) throw new Error('QuotaExceededError'); },
  removeItem() {},
  key: () => null,
  length: 0
};
console.error = () => {}; // journeyStorage logs the refused write

const project = {
  id: 'journey-open', name: 'Spring launch', businessType: 'shop', offerHeadline: '', goal: 'sales',
  updatedAt: '2026-09-01T00:00:00.000Z',
  nodes: [{ id: 'node-page-1', type: 'landing-page', position: { x: 0, y: 0 }, data: { type: 'landing-page', label: 'Page' } }],
  edges: []
};

function nav({ user = null, saveOk = false, saveStatus = { kind: 'idle' } } = {}) {
  globalThis.__reactLog.length = 0;
  const hook = mod.useJourneyNavigation({
    project,
    setProject() {},
    user,
    authReady: true,
    saveStatus,
    setSaveStatus() {},
    handleSave: async () => saveOk,
    activePage: 'canvas',
    setActivePage() {},
    selectedNodeId: null,
    setSelectedNodeId() {},
    setSelectedEdgeId() {},
    initialMissingId: null,
    initialStep: null
  });
  // Every notice the hook put in the header, in order (pending is the only other state and a boolean).
  const notices = () => globalThis.__reactLog.filter(v => v && typeof v === 'object' && 'message' in v);
  return { hook, notices };
}

test('signed out, a refused switch says what will help and offers no retry', async () => {
  assert.equal(lib.SWITCH_REFUSED_LOCAL, 'Still on this journey, because this browser could not keep it. Free some space or sign in, then try again.');
  assert.doesNotMatch(lib.SWITCH_REFUSED_LOCAL, /account|—|\s–\s/);
  const { hook, notices } = nav();
  const refusal = await hook.startJourney({ ...project, id: 'journey-new' });
  assert.deepEqual(refusal, { message: lib.SWITCH_REFUSED_LOCAL, retryable: false });
  // Outside the dialog the header is the only place to say it.
  assert.deepEqual(notices(), [refusal]);
});

test('a duplicate started from the library dialog is refused in the dialog only', async () => {
  const { hook, notices } = nav();
  const refusal = await hook.duplicateJourneyById(project.id, { inline: true });
  assert.deepEqual(refusal, { message: lib.SWITCH_REFUSED_LOCAL, retryable: false });
  assert.deepEqual(notices(), [], 'the header must not repeat the dialog\'s sentence');
});

test('an open started from the library dialog is refused in the dialog only', async () => {
  const { hook, notices } = nav();
  const missing = await hook.openJourney('journey-gone', { inline: true });
  assert.deepEqual(missing, { message: lib.NOT_IN_BROWSER, retryable: false });
  assert.deepEqual(notices(), []);
  // The same open from Back or a deep link still reaches the header.
  const again = await hook.openJourney('journey-gone');
  assert.deepEqual(notices(), [again]);
});

test('signed in, an unsaved journey that will not save or park keeps the retryable refusal', async () => {
  const { hook, notices } = nav({ user: { uid: 'u1' }, saveOk: false, saveStatus: { kind: 'failed', message: 'x', retryable: true } });
  const refusal = await hook.startJourney({ ...project, id: 'journey-new' });
  assert.deepEqual(refusal, { message: lib.SWITCH_REFUSED, retryable: true });
  assert.deepEqual(notices(), [refusal]);
  // A saved journey is held by the account, so a refused browser copy does not stop the switch.
  const saved = nav({ user: { uid: 'u1' }, saveStatus: { kind: 'idle' } });
  assert.equal(await saved.hook.startJourney({ ...project, id: 'journey-new' }), null);
});

test('the library dialog passes inline on open and duplicate', () => {
  const dialog = readFileSync(new URL('./src/components/modals/JourneyLibraryDialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /run\(\(\) => onOpen\(row\.id, \{ inline: true \}\), true\)/);
  assert.match(dialog, /run\(\(\) => onDuplicate\(row\.id, \{ inline: true \}\), true\)/);
  // The dialog still shows every refusal it is handed.
  assert.match(dialog, /\{refusal && \(\s*<p role="alert"[^>]*>\s*\{refusal\.message\}/);
});
