/**
 * The journey autosaver: a debounce in front of one save at a time.
 *
 * Save used to be a button and nothing else, so a closed tab lost every edit since the last
 * click. This saves the LATEST content a short while after the last edit, never runs two saves
 * at once (so an older copy can never land after a newer one), and never retries on its own: a
 * failure waits for the next edit, an explicit flush, or the Try again button. Timers are
 * injected so the tests drive them by hand. No imports, so node can load it as it is.
 */

export const AUTOSAVE_DELAY_MS = 900;

export interface AutosaveState {
  /** A save is waiting on its timer. */
  pending: boolean;
  /** A save is running. */
  inFlight: boolean;
  /** The latest content has not landed. */
  dirty: boolean;
}

export interface AutosaveTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AutosaverOptions<T> {
  /** Resolves true when the write landed. A throw counts as false. */
  save: (doc: T) => Promise<boolean> | boolean;
  fingerprint: (doc: T) => string;
  /** Which document this is. Content is compared per key. */
  keyOf: (doc: T) => string;
  /** Read on every schedule. 0 saves at once with no timer. */
  delayMs: () => number;
  /** False holds autosave (the explicit flush still runs). */
  canAutosave?: () => boolean;
  onState?: (state: AutosaveState) => void;
  timers?: AutosaveTimers;
}

export interface Autosaver<T> {
  /** Mark `doc` as already saved, for example a copy just read from the server. */
  baseline(doc: T): void;
  /** The content changed: save it after the delay. */
  schedule(doc: T): void;
  /** Save the latest content now. Resolves true when it has landed, or was already saved. */
  flush(opts?: { force?: boolean }): Promise<boolean>;
  state(): AutosaveState;
  /** Clear the timer only. The saver keeps working, so a StrictMode remount is harmless. */
  cancelTimer(): void;
}

const defaultTimers: AutosaveTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export function createAutosaver<T>(opts: AutosaverOptions<T>): Autosaver<T> {
  const timers = opts.timers || defaultTimers;
  const canAutosave = () => (opts.canAutosave ? opts.canAutosave() : true);

  let latest: T | undefined;
  const savedFp = new Map<string, string>();
  let failedFp: string | null = null;
  let timer: unknown = null;
  let scheduledFp: string | null = null;
  let inFlight = false;
  // Runs are chained, so at most one save is ever in flight. A request for "the latest" that
  // arrives while one is already waiting joins it rather than queuing a second.
  let tail: Promise<unknown> = Promise.resolve();
  let queuedLatest: Promise<boolean> | null = null;
  let queuedForce = false;
  let last: AutosaveState = { pending: false, inFlight: false, dirty: false };

  const isDirty = (doc: T | undefined) => doc !== undefined && savedFp.get(opts.keyOf(doc)) !== opts.fingerprint(doc);

  const state = (): AutosaveState => ({ pending: timer !== null, inFlight, dirty: isDirty(latest) });

  const emit = () => {
    const next = state();
    if (next.pending === last.pending && next.inFlight === last.inFlight && next.dirty === last.dirty) return;
    last = next;
    opts.onState?.(next);
  };

  const cancelTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    scheduledFp = null;
  };

  const runDoc = async (doc: T, force: boolean): Promise<boolean> => {
    const key = opts.keyOf(doc);
    const fp = opts.fingerprint(doc);
    if (!force && savedFp.get(key) === fp) return true;
    inFlight = true;
    emit();
    let ok = false;
    try {
      ok = (await opts.save(doc)) === true;
    } catch {
      ok = false;
    }
    inFlight = false;
    if (ok) {
      savedFp.set(key, fp);
      failedFp = null;
      rearmIfBehind();
    } else {
      failedFp = fp;
    }
    emit();
    return ok;
  };

  // schedule() judges "clean" against what has LANDED, not against what is on its way. Undo back
  // to the saved content while an edit's save is in flight reads as clean, so nothing is queued,
  // and then the edit lands over it. So after a save lands, if the latest content is now behind
  // and nothing is set to save it, arm the normal delay for it. A failure re-arms nothing: it
  // moved nothing, so schedule's judgement was right, and it never retries on its own.
  const rearmIfBehind = () => {
    if (latest === undefined || timer !== null || queuedLatest !== null) return;
    if (!isDirty(latest) || !canAutosave()) return;
    const fp = opts.fingerprint(latest);
    if (fp === failedFp) return;
    arm(fp);
  };

  /** Save the latest content after the delay, or at once when the delay is 0. */
  const arm = (fp: string) => {
    const delay = opts.delayMs();
    if (delay <= 0) {
      void enqueueLatest(false);
      return;
    }
    scheduledFp = fp;
    timer = timers.setTimeout(() => {
      timer = null;
      scheduledFp = null;
      void enqueueLatest(false);
      emit();
    }, delay);
  };

  const chain = (step: () => Promise<boolean>): Promise<boolean> => {
    const run = tail.then(step, step);
    tail = run.catch(() => undefined);
    return run;
  };

  const enqueueDoc = (doc: T) => chain(() => runDoc(doc, false));

  const enqueueLatest = (force: boolean): Promise<boolean> => {
    if (queuedLatest) {
      if (force) queuedForce = true;
      return queuedLatest;
    }
    queuedForce = force;
    const run = chain(() => {
      queuedLatest = null;
      const f = queuedForce;
      queuedForce = false;
      return latest === undefined ? Promise.resolve(true) : runDoc(latest, f);
    });
    queuedLatest = run;
    return run;
  };

  return {
    baseline(doc) {
      latest = doc;
      savedFp.set(opts.keyOf(doc), opts.fingerprint(doc));
      cancelTimer();
      emit();
    },

    schedule(doc) {
      // Leaving a journey with edits that have not landed: save it now, before `latest` moves on.
      if (latest !== undefined && isDirty(latest) && opts.keyOf(latest) !== opts.keyOf(doc) && canAutosave()) {
        cancelTimer();
        void enqueueDoc(latest);
      }
      latest = doc;
      if (!isDirty(doc) || !canAutosave()) {
        cancelTimer();
        emit();
        return;
      }
      const fp = opts.fingerprint(doc);
      if (fp === failedFp) {
        // The same content just failed. Retrying on every re-render would hammer a broken server.
        cancelTimer();
        emit();
        return;
      }
      if (timer !== null && scheduledFp === fp) return;
      cancelTimer();
      arm(fp);
      emit();
    },

    flush(flushOpts) {
      cancelTimer();
      const run = enqueueLatest(!!flushOpts?.force);
      emit();
      return run;
    },

    state,

    cancelTimer() {
      cancelTimer();
      emit();
    }
  };
}

/** Asked before signing out, only when saving failed. */
export const SIGN_OUT_QUESTION =
  'Your latest changes did not reach your account. Sign out anyway? They stay in this browser.';
