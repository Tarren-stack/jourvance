// Where the docked step panel sends the view when it is stacked under the map (R02).
//
// Below 768px the dock sits under the map, so a step or line opened with a tap on the map drew its
// panel below the fold: nothing scrolled and the only change on screen was the selection outline.
// A keyboard open was already fine, because focus moving to the panel heading scrolls it in. The
// dock now scrolls the heading into view after a TAP on the map, and only then: a step selected
// from the finder, by + Next, or by the keyboard is shown by its own path. A tap on the step or line
// already open does the same, since it opens nothing new.
//
// A delete from the panel returns focus to the search field (the keyboard rule), but on a phone
// that scrolled the map away after a tapped Disconnect and focused a text field, which can raise
// the on-screen keyboard. A pointer delete in the stacked layout brings the map back into view and
// puts focus on the map region instead, so the person sees what changed.
//
// Pure rules only, so the node tests can run them without a browser.

/** The last click on the map: which step or line it landed on, and when (performance.now()). */
export interface MapTap {
  id: string;
  at: number;
}

/** A tap older than this did not open the panel that just appeared. */
export const TAP_REVEAL_WINDOW_MS = 1000;

interface AttrLike {
  getAttribute(name: string): string | null;
}
/** The one DOM method mapTapId needs, so a test can pass a stand-in. */
export interface ClosestLike {
  closest(selector: string): AttrLike | null;
}

// A control inside a step card is its own action (a badge, a link), not a tap that opens the step.
const NODE_CONTROL = ['button', 'a', 'input', 'select', 'textarea'].map(t => `.react-flow__node ${t}`).join(', ');

/**
 * The id of the step or line a click on the map landed on, or null. `detail` is the click's
 * event.detail: 0 means the keyboard pressed it, and that path moves focus into the panel instead.
 */
export function mapTapId(target: ClosestLike | null, detail: number): string | null {
  if (!target || detail === 0) return null;
  if (target.closest(NODE_CONTROL)) return null;
  const pill = target.closest('[data-jv-edge-label]');
  if (pill) return pill.getAttribute('data-jv-edge-label') || null;
  return target.closest('.react-flow__node, .react-flow__edge')?.getAttribute('data-id') || null;
}

/** True when the step or line that just opened is the one tapped on the map a moment ago. */
export function tapOpensPanel(tap: MapTap | null, openedId: string | null, now: number): boolean {
  if (!tap || !openedId) return false;
  return tap.id === openedId && now - tap.at >= 0 && now - tap.at <= TAP_REVEAL_WINDOW_MS;
}

/**
 * True when a tap landed on the step or line whose panel is already open. That tap changes no
 * selection, so nothing else reveals the panel: a person who scrolled up to look at the map and taps
 * the step they were editing to get back to it would see nothing happen.
 */
export function tapReopensPanel(tapId: string | null, openId: string | null): boolean {
  return Boolean(tapId) && tapId === openId;
}

interface Box {
  top: number;
  bottom: number;
}

/** True when a box is wholly inside the window's height. */
export function boxInView(box: Box, viewportHeight: number): boolean {
  return box.top >= 0 && box.bottom <= viewportHeight;
}

/** True when the dock is stacked under the map (the narrow layout) rather than beside it. */
export function dockStacked(dock: Box | null, map: Box | null): boolean {
  if (!dock || !map) return false;
  return dock.top >= map.bottom - 1;
}

/**
 * Where focus goes once a step or line deleted from the panel is gone: the map region after a
 * pointer delete in the stacked layout, else the search field, or the no-steps message once the
 * journey is empty (the search field is not drawn then).
 */
export function deleteFocusTarget(o: { byPointer: boolean; stacked: boolean; hasSearch: boolean; hasMap: boolean }): 'map' | 'search' | 'empty' {
  if (!o.hasSearch) return 'empty';
  if (o.byPointer && o.stacked && o.hasMap) return 'map';
  return 'search';
}
