// The editor's motion rules (LANDING_BUILDER_MOTION.md section 4), kept pure so a node test can
// import them. Nothing here touches the document or the published page: this is the editor's own
// movement, and it is off when the device asks for reduced motion or the merchant turns it off.

/** The localStorage key of the "Reduce motion in the editor" preference. Per viewer, never saved to the hub. */
export const REDUCE_MOTION_KEY = 'jv_builder_reduce_motion';

/** How long the outline FLIP takes, and the curve it uses. */
export const FLIP_MS = 180;
export const FLIP_EASE = 'cubic-bezier(.2,0,0,1)';

/** The least a row must move, in pixels, before the FLIP bothers to slide it. */
export const FLIP_MIN_PX = 1;

/**
 * The offsets a FLIP starts from: for each id present in both maps, the old top less the new top, so
 * `translateY(offset)` puts the row back where it was. Ids in only one map, and moves under a pixel,
 * answer nothing.
 */
export function flipOffsets(before: ReadonlyMap<string, number>, after: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, was] of before) {
    const now = after.get(id);
    if (now === undefined) continue;
    const delta = was - now;
    if (Math.abs(delta) >= FLIP_MIN_PX) out.set(id, delta);
  }
  return out;
}

/** Whether the editor's own motion is off: the OS asks for less, or the merchant chose it. */
export function editorMotionOff(osReduce: boolean, preference: boolean): boolean {
  return osReduce === true || preference === true;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The stored preference. A missing, unreadable or throwing storage reads as off. */
export function readReduceMotionPref(storage?: StorageLike | null): boolean {
  try {
    const s = storage === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : storage;
    return !!s && s.getItem(REDUCE_MOTION_KEY) === '1';
  } catch {
    return false;
  }
}

/** Stores the preference. A storage that throws is ignored: the editor works without it. */
export function writeReduceMotionPref(on: boolean, storage?: StorageLike | null): void {
  try {
    const s = storage === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : storage;
    if (s) s.setItem(REDUCE_MOTION_KEY, on ? '1' : '0');
  } catch {
    // Not stored; the checkbox still works for this session.
  }
}

/**
 * The device switch's fade (`jv-motion-device-in`, 180ms) must play once per switch. A class left on
 * the layer after its animation replays the fade whenever its rule starts matching again (the
 * "Reduce motion in the editor" box unticked, or the OS setting back to no-preference) with no
 * device change at all. The fallback removes it when no animation ever ran (motion off by the OS).
 */
export const DEVICE_IN_MAX_MS = 400;

interface AnimationEventLike {
  target?: unknown;
  animationName?: string;
}

export interface PlayOnceTarget {
  classList: { remove(name: string): void };
  addEventListener(type: string, fn: (e: AnimationEventLike) => void): void;
  removeEventListener(type: string, fn: (e: AnimationEventLike) => void): void;
}

const playGeneration = new WeakMap<object, number>();

/**
 * Takes `className` off `el` once its `animationName` animation ends, or `maxMs` after the call (or
 * after the animation starts) when it never ends: motion off by the OS, or a fade cut short by the
 * merchant's preference. A cancel is not listened for, because restarting the class fires the old
 * fade's cancel after the new fade has begun. Call it BEFORE the class is restarted: a later call
 * supersedes an earlier one on the same element, so an earlier fallback never cuts a newer fade.
 */
export function removeClassWhenPlayed(
  el: PlayOnceTarget,
  className: string,
  animationName: string,
  maxMs: number,
  setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle: unknown) => void = handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
): void {
  const generation = (playGeneration.get(el) || 0) + 1;
  playGeneration.set(el, generation);
  let timer: unknown = null;
  const ours = (e: AnimationEventLike) => e.target === el && e.animationName === animationName;
  const finish = () => {
    el.removeEventListener('animationstart', started);
    el.removeEventListener('animationend', ended);
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (playGeneration.get(el) === generation) el.classList.remove(className);
  };
  const arm = () => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(finish, maxMs);
  };
  const started = (e: AnimationEventLike) => { if (ours(e)) arm(); };
  const ended = (e: AnimationEventLike) => { if (ours(e)) finish(); };
  el.addEventListener('animationstart', started);
  el.addEventListener('animationend', ended);
  arm();
}

/**
 * The selection toolbar is keyed by the selected id, so it is a new element after any action that
 * moves the selection (Duplicate and Paste select the copy, Delete and Cut select a neighbour). A
 * keyboard user on one of its buttons would be left on the document body. These two carry the
 * focus across: the memo is taken as the old toolbar leaves, the target is chosen as the new one
 * arrives. The same button by its name, else the same position, else the first.
 */
export const TOOLBAR_FOCUS_WINDOW_MS = 1500;

interface ButtonLike {
  getAttribute(name: string): string | null;
}

export interface ToolbarLike<B extends ButtonLike = ButtonLike> {
  contains(node: unknown): boolean;
  querySelectorAll(selector: string): ArrayLike<B>;
}

export interface ToolbarFocusMemo {
  label: string | null;
  index: number;
  at: number;
}

/** What a toolbar that is about to be removed says about the focus inside it; null when focus is elsewhere. */
export function toolbarFocusMemo(toolbar: ToolbarLike | null, active: unknown, now: number): ToolbarFocusMemo | null {
  if (!toolbar || !active || !toolbar.contains(active)) return null;
  const buttons = Array.from(toolbar.querySelectorAll('button'));
  const index = buttons.indexOf(active as ButtonLike);
  if (index < 0) return null;
  return { label: buttons[index].getAttribute('aria-label'), index, at: now };
}

/**
 * The button a newly mounted toolbar should focus, or null. Only when the memo is fresh and focus
 * was actually lost (nothing focused, the body, or an element no longer in the document), so a
 * click elsewhere that happens to change the selection never pulls focus into the toolbar.
 */
export function toolbarFocusTarget<B extends ButtonLike>(
  toolbar: ToolbarLike<B> | null,
  memo: ToolbarFocusMemo | null,
  active: unknown,
  body: unknown,
  now: number
): B | null {
  if (!toolbar || !memo || now - memo.at > TOOLBAR_FOCUS_WINDOW_MS) return null;
  const lost = !active || active === body || (active as { isConnected?: boolean }).isConnected === false;
  if (!lost) return null;
  const buttons = Array.from(toolbar.querySelectorAll('button'));
  if (!buttons.length) return null;
  const byName = memo.label === null ? undefined : buttons.find(b => b.getAttribute('aria-label') === memo.label);
  return byName || buttons[memo.index] || buttons[0];
}
