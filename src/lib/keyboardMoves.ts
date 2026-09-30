/**
 * Steps moved with the arrow keys (C05).
 *
 * React Flow moves a selected step when Arrow or Shift+Arrow is pressed on it, and reports that as
 * position changes with no drag, so onNodeDragStop never runs. The canvas used to pass on only
 * pointer drops, so a keyboard move lived on screen alone: a reload put the step back, Undo stayed
 * off, and the next drag's undo step swept the move up with it.
 *
 * The queue holds those moves and hands them over as ONE commit once the presses stop, so a run of
 * presses is one undo step, or at once when anything else is pressed or clicked, so Undo right
 * after the arrows takes back the move. Pure apart from the timer, so node can test it.
 */

export interface XY {
  x: number;
  y: number;
}

/** A run of presses closer together than this is one move, and one undo step. */
export const KEY_MOVE_SETTLE_MS = 300;

/** Keys that are part of a keyboard move. Any other key, and any pointer press, commits it first. */
export const MOVE_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift']);

/** True when this event must commit a waiting move before it does anything else. */
export function commitsWaitingMove(e: { type: string; key?: string }): boolean {
  if (e.type === 'pointerdown') return true;
  return e.type === 'keydown' && !MOVE_KEYS.has(String(e.key ?? ''));
}

interface ChangeLike {
  type: string;
  id?: string;
  position?: XY;
  dragging?: boolean;
}

/**
 * The positions a batch of React Flow node changes settles, leaving out a pointer drag in
 * progress. A drag's last change also has dragging false; onNodeDragStop, which runs straight
 * after it, discards it from the queue and pushes the drop itself.
 */
export function settledPositions(changes: readonly ChangeLike[]): Map<string, XY> {
  const out = new Map<string, XY>();
  for (const c of changes) {
    if (c.type !== 'position' || !c.id || !c.position || c.dragging) continue;
    out.set(c.id, { x: c.position.x, y: c.position.y });
  }
  return out;
}

/** The nodes with the moved ones at their new place; every other node is the same object. */
export function applyMoves<T extends { id: string; position: XY }>(nodes: readonly T[], moves: ReadonlyMap<string, XY>): T[] {
  return nodes.map(n => {
    const position = moves.get(n.id);
    return position ? { ...n, position } : n;
  });
}

export interface MoveQueue {
  /** Takes a batch of node changes; a settled position waits, and restarts the settle timer. */
  add(changes: readonly ChangeLike[]): void;
  /** Commits whatever waits, now. Nothing waiting commits nothing. */
  flush(): void;
  /** Drops whatever waits, uncommitted: a pointer drop pushes those positions itself. */
  discard(): void;
  pending(): boolean;
}

export interface MoveTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: MoveTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export function createMoveQueue(
  commit: (moves: Map<string, XY>) => void,
  timers: MoveTimers = realTimers,
  settleMs: number = KEY_MOVE_SETTLE_MS
): MoveQueue {
  let waiting = new Map<string, XY>();
  let handle: unknown = null;
  const stop = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  const flush = () => {
    stop();
    if (waiting.size === 0) return;
    const moves = waiting;
    waiting = new Map();
    commit(moves);
  };
  return {
    add(changes) {
      const moves = settledPositions(changes);
      if (moves.size === 0) return;
      for (const [id, p] of moves) waiting.set(id, p);
      stop();
      handle = timers.set(flush, settleMs);
    },
    flush,
    discard() {
      stop();
      waiting = new Map();
    },
    pending: () => waiting.size > 0
  };
}
