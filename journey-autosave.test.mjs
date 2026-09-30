import test from 'node:test';
import assert from 'node:assert/strict';

// Save used to be a button and nothing else. src/lib/journeyAutosave.ts saves the latest content
// 900ms after the last edit, runs one save at a time so an older copy never lands after a newer
// one, and never retries on its own. The timers here are driven by hand.

const {
  AUTOSAVE_DELAY_MS, createAutosaver,
  SIGN_OUT_QUESTION
} = await import('./src/lib/journeyAutosave.ts');

function fakeTimers() {
  let now = 0;
  let seq = 0;
  const due = new Map();
  return {
    timers: {
      setTimeout(fn, ms) { const id = ++seq; due.set(id, { at: now + ms, fn }); return id; },
      clearTimeout(id) { due.delete(id); }
    },
    get now() { return now; },
    count: () => due.size,
    async advanceTo(t) {
      for (;;) {
        const next = [...due.entries()].filter(([, d]) => d.at <= t).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        due.delete(next[0]);
        next[1].fn();
        await settle();
      }
      now = t;
      await settle();
    }
  };
}

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

const doc = (id, v) => ({ id, v, stamp: Math.random() });

/** A save whose answers the test hands out one at a time. */
function manualSave() {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const save = d => {
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise(resolve => {
      calls.push({ doc: d, resolve: ok => { active--; resolve(ok); } });
    });
  };
  return { save, calls, get maxActive() { return maxActive; } };
}

function saver(extra = {}) {
  const clock = fakeTimers();
  const saves = [];
  const states = [];
  const s = createAutosaver({
    save: d => { saves.push(d); return true; },
    fingerprint: d => `${d.id}:${d.v}`,
    keyOf: d => d.id,
    delayMs: () => AUTOSAVE_DELAY_MS,
    onState: st => states.push(st),
    timers: clock.timers,
    ...extra
  });
  return { s, clock, saves, states };
}

test('edits at 0, 500 and 1000ms save once, at 1900ms, holding the 1000ms document', async () => {
  const { s, clock, saves } = saver();
  s.baseline(doc('j', 0));
  s.schedule(doc('j', 1));
  await clock.advanceTo(500);
  s.schedule(doc('j', 2));
  await clock.advanceTo(1000);
  const last = doc('j', 3);
  s.schedule(last);
  await clock.advanceTo(1899);
  assert.equal(saves.length, 0);
  await clock.advanceTo(1900);
  assert.equal(saves.length, 1);
  assert.equal(saves[0], last);
  assert.equal(s.state().dirty, false);
  await clock.advanceTo(10000);
  assert.equal(saves.length, 1);
});

test('two saves are never in flight at once, and the newest document is the one saved next', async () => {
  const m = manualSave();
  const { s, clock } = saver({ save: m.save });
  s.baseline(doc('j', 0));
  s.schedule(doc('j', 1));
  await clock.advanceTo(900);
  assert.equal(m.calls.length, 1);
  assert.equal(s.state().inFlight, true);
  s.schedule(doc('j', 2));
  await clock.advanceTo(1900);
  const newest = doc('j', 3);
  s.schedule(newest);
  await clock.advanceTo(3000);
  assert.equal(m.calls.length, 1, 'nothing else starts while save 1 is unresolved');
  m.calls[0].resolve(true);
  await settle();
  assert.equal(m.calls.length, 2, 'exactly one more save runs');
  assert.equal(m.calls[1].doc, newest);
  m.calls[1].resolve(true);
  await clock.advanceTo(10000);
  assert.equal(m.calls.length, 2);
  assert.equal(m.maxActive, 1);
  assert.equal(s.state().dirty, false);
});

test('undo back to the saved content while an edit saves: the undone content is saved after the edit lands', async () => {
  // Cmd+Z about 1s after an edit. The reverted document reads as clean against what has landed,
  // so schedule() queued nothing, and the in-flight edit then landed over it for good.
  const m = manualSave();
  const { s, clock } = saver({ save: m.save });
  s.baseline(doc('j', 0));
  s.schedule(doc('j', 1));
  await clock.advanceTo(900);
  assert.equal(m.calls.length, 1);
  const reverted = doc('j', 0);
  s.schedule(reverted);
  await clock.advanceTo(1000);
  assert.equal(clock.count(), 0, 'no timer while the reverted content still reads as landed');
  m.calls[0].resolve(true);
  await settle();
  assert.deepEqual(s.state(), { pending: true, inFlight: false, dirty: true }, 'the landed edit leaves the canvas behind');
  await clock.advanceTo(1000 + AUTOSAVE_DELAY_MS - 1);
  assert.equal(m.calls.length, 1);
  await clock.advanceTo(1000 + AUTOSAVE_DELAY_MS);
  assert.equal(m.calls.length, 2, 'the reverted content saves after the normal delay');
  assert.equal(m.calls[1].doc, reverted);
  m.calls[1].resolve(true);
  await clock.advanceTo(60000);
  assert.equal(m.calls.length, 2);
  assert.deepEqual(s.state(), { pending: false, inFlight: false, dirty: false });
  assert.equal(m.maxActive, 1);

  // With no delay it saves straight after the edit lands.
  const z = manualSave();
  const zero = saver({ save: z.save, delayMs: () => 0 });
  zero.s.baseline(doc('j', 0));
  zero.s.schedule(doc('j', 1));
  await settle();
  zero.s.schedule(doc('j', 0));
  z.calls[0].resolve(true);
  await settle();
  assert.equal(z.calls.length, 2);
  assert.equal(z.calls[1].doc.v, 0);
});

test('undo during a save that then fails re-arms nothing, and a held saver re-arms nothing', async () => {
  const m = manualSave();
  const { s, clock } = saver({ save: m.save });
  s.baseline(doc('j', 0));
  s.schedule(doc('j', 1));
  await clock.advanceTo(900);
  s.schedule(doc('j', 0));
  m.calls[0].resolve(false);
  await clock.advanceTo(60000);
  assert.equal(m.calls.length, 1, 'the failed edit moved nothing, so the reverted content is still the saved one');
  assert.equal(s.state().dirty, false);

  let may = true;
  const h = manualSave();
  const held = saver({ save: h.save, canAutosave: () => may });
  held.s.baseline(doc('j', 0));
  held.s.schedule(doc('j', 1));
  await held.clock.advanceTo(900);
  held.s.schedule(doc('j', 0));
  may = false;
  h.calls[0].resolve(true);
  await held.clock.advanceTo(60000);
  assert.equal(h.calls.length, 1, 'held: waits for an edit or an explicit save');
  assert.equal(held.s.state().dirty, true);
  const flushed = held.s.flush();
  await settle();
  assert.equal(h.calls.length, 2, 'the explicit save still reaches it');
  assert.equal(h.calls[1].doc.v, 0);
  h.calls[1].resolve(true);
  assert.equal(await flushed, true);
  assert.equal(held.s.state().dirty, false);
});

test('a new object with the same content saves nothing and does not restart the timer', async () => {
  const { s, clock, saves } = saver();
  s.baseline(doc('j', 0));
  s.schedule(doc('j', 0));
  assert.equal(clock.count(), 0);
  s.schedule(doc('j', 1));
  await clock.advanceTo(600);
  s.schedule(doc('j', 1));
  await clock.advanceTo(900);
  assert.equal(saves.length, 1, 'the timer from 0ms still fired at 900ms');
});

test('a failure stays dirty and is not retried until the content changes or a flush asks', async () => {
  let fail = true;
  const saves = [];
  const { s, clock } = saver({ save: d => { saves.push(d); return !fail; } });
  s.baseline(doc('j', 0));
  s.schedule(doc('j', 1));
  await clock.advanceTo(900);
  assert.equal(saves.length, 1);
  assert.equal(s.state().dirty, true);
  s.schedule(doc('j', 1));
  await clock.advanceTo(5000);
  assert.equal(saves.length, 1, 'the same content is not retried');
  s.schedule(doc('j', 2));
  await clock.advanceTo(5899);
  assert.equal(saves.length, 1);
  await clock.advanceTo(5900);
  assert.equal(saves.length, 2, 'a changed edit retries after 900ms');
  assert.equal(await s.flush(), false);
  assert.equal(saves.length, 3, 'flush retries at once');
  fail = false;
  assert.equal(await s.flush(), true);
  assert.equal(s.state().dirty, false);
});

test('a save that throws counts as a failure', async () => {
  const { s, clock } = saver({ save: () => { throw new Error('offline'); } });
  s.baseline(doc('j', 0));
  s.schedule(doc('j', 1));
  await clock.advanceTo(900);
  assert.deepEqual(s.state(), { pending: false, inFlight: false, dirty: true });
  assert.equal(await s.flush(), false);
  const rejects = saver({ save: async () => { throw new Error('500'); } });
  rejects.s.baseline(doc('j', 0));
  rejects.s.schedule(doc('j', 1));
  assert.equal(await rejects.s.flush(), false);
  assert.equal(rejects.s.state().dirty, true);
});

test('flush: clean resolves true without saving, force saves once, in flight waits for the latest', async () => {
  const { s, saves } = saver();
  s.baseline(doc('j', 0));
  assert.equal(await s.flush(), true);
  assert.equal(saves.length, 0);
  assert.equal(await s.flush({ force: true }), true);
  assert.equal(saves.length, 1);

  const m = manualSave();
  const b = saver({ save: m.save });
  b.s.baseline(doc('j', 0));
  b.s.schedule(doc('j', 1));
  await b.clock.advanceTo(900);
  assert.equal(m.calls.length, 1);
  const latest = doc('j', 2);
  b.s.schedule(latest);
  let answered = null;
  b.s.flush().then(ok => { answered = ok; });
  await settle();
  assert.equal(answered, null, 'not answered while the older save runs');
  m.calls[0].resolve(true);
  await settle();
  assert.equal(answered, null, 'the older save landing is not the latest content landing');
  assert.equal(m.calls.length, 2);
  assert.equal(m.calls[1].doc, latest);
  m.calls[1].resolve(true);
  await settle();
  assert.equal(answered, true);
  assert.equal(b.clock.count(), 0, 'the flush cancelled the timer');
});

test('switching journeys saves the one being left at once, then the new one after the delay', async () => {
  const { s, clock, saves } = saver();
  const a = doc('A', 1);
  s.baseline(doc('A', 0));
  s.schedule(a);
  await clock.advanceTo(300);
  const b = doc('B', 1);
  s.schedule(b);
  await settle();
  assert.equal(saves.length, 1);
  assert.equal(saves[0], a);
  await clock.advanceTo(1199);
  assert.equal(saves.length, 1);
  await clock.advanceTo(1200);
  assert.equal(saves.length, 2);
  assert.equal(saves[1], b);
});

test('baseline marks a copy as saved, and a held saver starts no timer until it may save', async () => {
  let may = false;
  const { s, clock, saves } = saver({ canAutosave: () => may });
  const loaded = doc('j', 5);
  s.baseline(loaded);
  s.schedule(loaded);
  assert.equal(saves.length, 0);
  s.schedule(doc('j', 6));
  assert.equal(clock.count(), 0, 'held: no timer');
  assert.deepEqual(s.state(), { pending: false, inFlight: false, dirty: true });
  await clock.advanceTo(5000);
  assert.equal(saves.length, 0);
  assert.equal(await s.flush({ force: true }), true, 'the explicit save still works while held');
  assert.equal(saves.length, 1);
  may = true;
  s.schedule(doc('j', 7));
  await clock.advanceTo(5899);
  assert.equal(saves.length, 1);
  await clock.advanceTo(5900);
  assert.equal(saves.length, 2);
  // cancelTimer is for unmount only: the saver keeps working (a StrictMode remount).
  s.schedule(doc('j', 8));
  s.cancelTimer();
  assert.equal(clock.count(), 0);
  s.schedule(doc('j', 9));
  await clock.advanceTo(7000);
  assert.equal(saves.length, 3);
  assert.equal(saves[2].v, 9);
});

test('with no delay the save runs at once and is never pending', async () => {
  const { s, clock, saves, states } = saver({ delayMs: () => 0 });
  s.baseline(doc('j', 0));
  s.schedule(doc('j', 1));
  assert.equal(clock.count(), 0);
  await settle();
  assert.equal(saves.length, 1);
  s.schedule(doc('j', 2));
  await settle();
  assert.equal(saves.length, 2);
  assert.ok(states.every(st => st.pending === false));
});

test('onState fires only when a field changes', async () => {
  const { s, clock, states } = saver();
  s.baseline(doc('j', 0));
  s.schedule(doc('j', 1));
  s.schedule(doc('j', 2));
  s.schedule(doc('j', 3));
  assert.equal(states.length, 1);
  assert.deepEqual(states[0], { pending: true, inFlight: false, dirty: true });
  await clock.advanceTo(2000);
  for (let i = 1; i < states.length; i++) assert.notDeepEqual(states[i], states[i - 1]);
  assert.deepEqual(states.at(-1), { pending: false, inFlight: false, dirty: false });
});

test('the sign-out question is plain and carries no em dash or spaced en dash', () => {
  for (const q of [SIGN_OUT_QUESTION]) {
    assert.ok(q.length > 20);
    assert.doesNotMatch(q, /—/);
    assert.doesNotMatch(q, / – /);
  }
  assert.equal(AUTOSAVE_DELAY_MS, 900);
});
