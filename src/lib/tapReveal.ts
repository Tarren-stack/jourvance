// Keeping a tapped step on screen in the stacked phone layout (T06), and when the map's own tools
// fold into one row.
//
// Below 768px the step panel stacks under the map, and a tap on a step scrolls the panel heading
// into view (R02, dockReveal.ts). That scroll pushed the tapped card up behind the header, so the
// strip of map left between the header and the panel showed only the zoom controls and the minimap,
// and nothing on screen said which step was open apart from the panel title. Once the scroll has
// settled the map now pans, with no zoom change, so the card (and its + Before / + Next pills) sits
// centred in the part of the map still on screen, clear of the controls and minimap when there is
// room.
//
// Pure rules only, in screen pixels, so the node tests can run them without a browser.

/** A box in screen (client) pixels. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Space kept between the card and a control it is moved clear of. */
export const REVEAL_GAP = 8;
/** A visible strip of map shorter than this shows nothing useful, so the map is left alone. */
export const REVEAL_MIN_BAND_PX = 48;
/** The panel's own scroll starts a frame after the tap, so wait at least this long for it. */
export const REVEAL_MIN_WAIT_MS = 320;
/** A scroll counts as settled after this long with no scroll event. */
export const REVEAL_QUIET_MS = 150;
/** Pan by now even if something keeps scrolling. */
export const REVEAL_MAX_WAIT_MS = 1500;

/**
 * Below this map width the tools row (Tidy layout, Numbers, Retention flows) and the Lines legend
 * fold into one "Map tools" button. The row needs about 470px on one line; at 1024 and wider the map
 * is at least 660px, so nothing changes there.
 */
export const MAP_TOOLS_COMPACT_BELOW_PX = 560;

/** True when the map is too narrow for its tools to sit on one row. */
export function mapToolsCompact(mapWidth: number): boolean {
  return mapWidth > 0 && mapWidth < MAP_TOOLS_COMPACT_BELOW_PX;
}

/** The smallest box holding every box given, or null for none. */
export function unionBox(boxes: ScreenBox[]): ScreenBox | null {
  const real = boxes.filter(b => b.right > b.left && b.bottom > b.top);
  if (real.length === 0) return null;
  return {
    left: Math.min(...real.map(b => b.left)),
    top: Math.min(...real.map(b => b.top)),
    right: Math.max(...real.map(b => b.right)),
    bottom: Math.max(...real.map(b => b.bottom))
  };
}

/**
 * The part of the map on screen: the map's box clipped by the box that scrolls it and by the window.
 * Null when none of it shows.
 */
export function visibleBand(map: ScreenBox, clip: ScreenBox | null, view: { width: number; height: number }): ScreenBox | null {
  const band = {
    left: Math.max(map.left, clip?.left ?? -Infinity, 0),
    top: Math.max(map.top, clip?.top ?? -Infinity, 0),
    right: Math.min(map.right, clip?.right ?? Infinity, view.width),
    bottom: Math.min(map.bottom, clip?.bottom ?? Infinity, view.height)
  };
  return band.right > band.left && band.bottom > band.top ? band : null;
}

const overlaps = (a: ScreenBox, b: ScreenBox) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (a: ScreenBox, b: ScreenBox) => a.left >= b.left && a.top >= b.top && a.right <= b.right && a.bottom <= b.bottom;

/**
 * How far to move the map, in screen pixels, so `target` (the tapped card and its pills) sits
 * centred in `band`, the part of the map on screen. `obstacles` are the controls drawn over the map
 * (the tools, the zoom controls, the minimap): the card is centred in the room they leave when it
 * fits there, and in the whole strip otherwise. Null when the card is already wholly in the strip
 * and clear of them, or when the strip is too short to show it usefully.
 */
export function revealShift(
  target: ScreenBox,
  band: ScreenBox | null,
  obstacles: ScreenBox[] = [],
  gap: number = REVEAL_GAP
): { dx: number; dy: number } | null {
  if (!band || band.bottom - band.top < REVEAL_MIN_BAND_PX || band.right <= band.left) return null;
  if (inside(target, band) && !obstacles.some(o => overlaps(o, target))) return null;
  const width = target.right - target.left;
  const height = target.bottom - target.top;
  const cx = (band.left + band.right) / 2;
  const mid = (band.top + band.bottom) / 2;
  // The room the controls leave in the column the card will sit in.
  let top = band.top;
  let bottom = band.bottom;
  for (const o of obstacles) {
    if (o.bottom <= band.top || o.top >= band.bottom) continue;
    if (o.right <= cx - width / 2 || o.left >= cx + width / 2) continue;
    if ((o.top + o.bottom) / 2 < mid) top = Math.max(top, o.bottom + gap);
    else bottom = Math.min(bottom, o.top - gap);
  }
  const cy = bottom - top >= height ? (top + bottom) / 2 : mid;
  const dx = Math.round(cx - (target.left + target.right) / 2);
  const dy = Math.round(cy - (target.top + target.bottom) / 2);
  return dx === 0 && dy === 0 ? null : { dx, dy };
}

/** Space kept between the window's bottom edge and a notice docked there, as its sides keep. */
export const NOTICE_DOCK_GAP = 16;

/** Where the map's notice goes: `top` in screen px, and whether it has left the map for the window's foot. */
export interface NoticePlace {
  top: number;
  docked: boolean;
}

/**
 * Where the map's notice goes (U01). Its usual place (`home`) is above the zoom controls and the
 * minimap, and on a phone, once a tapped card has been panned into the strip of map still showing
 * (T06), that place sat over the card: the connecting notice covered 82 to 90% of it. So the notice
 * keeps its home while that is wholly in the strip and clear of the selected card (with its
 * + Before / + Next pills), and otherwise takes the first place in the strip clear of the card AND
 * of the map's own controls (`obstacles`: the tools, the zoom controls, the minimap): just under the
 * card, just over it, beside a control, at the foot of the strip or at its top.
 *
 * On a phone the strip is often too short for that: 172 to 210px at 390, with a 76 to 90px card
 * and pills, the zoom controls and minimap across its foot, and a connecting notice of 91 to 109px
 * (four or five lines). Any place in it then covers the card or the controls the notice tells the
 * user to zoom with, so when `view` (the window) leaves room under the strip the notice docks at the
 * window's foot, off the map, NOTICE_DOCK_GAP above its edge. Only with no room there either does it
 * take a place clear of the card that covers fewest controls, and failing that the one covering
 * least of the card, never more than home. `notice` gives its width and height (a move changes
 * neither). With no card or no strip it stays home.
 */
export function noticePlace(
  notice: ScreenBox,
  home: number,
  band: ScreenBox | null,
  card: ScreenBox | null,
  obstacles: ScreenBox[] = [],
  view: { height: number } | null = null,
  gap: number = REVEAL_GAP
): NoticePlace {
  const height = notice.bottom - notice.top;
  const stay = { top: home, docked: false };
  if (!band || !card || !(height > 0)) return stay;
  const at = (top: number): ScreenBox => ({ left: notice.left, right: notice.right, top, bottom: top + height });
  const inStrip = (top: number) => top >= band.top - 0.5 && top + height <= band.bottom + 0.5;
  if (inStrip(home) && !overlaps(at(home), card)) return stay;
  const shown = obstacles.filter(o => overlaps(o, band));
  // Last, the strip's very foot and top, for a strip with no room for the gap as well.
  const inBand = [
    card.bottom + gap,
    card.top - gap - height,
    ...shown.flatMap(o => [o.top - gap - height, o.bottom + gap]),
    band.bottom - gap - height,
    band.top + gap,
    band.bottom - height,
    band.top
  ]
    .map(top => Math.round(top))
    .filter(inStrip);
  const clear = inBand.filter(top => !overlaps(at(top), card));
  const covered = (top: number) => shown.filter(o => overlaps(at(top), o)).length;
  const open = clear.find(top => covered(top) === 0);
  if (open !== undefined) return { top: open, docked: false };
  const dock = view ? Math.round(view.height - NOTICE_DOCK_GAP - height) : -Infinity;
  if (dock >= band.bottom - 0.5 && dock >= 0) return { top: dock, docked: true };
  if (clear.length > 0) return { top: clear.reduce((best, top) => (covered(top) < covered(best) ? top : best)), docked: false };
  // A strip too short for both: cover as little of the card as it can, and never more than home.
  const area = (top: number) => {
    const b = at(top);
    return Math.max(0, Math.min(b.right, card.right) - Math.max(b.left, card.left)) * Math.max(0, Math.min(b.bottom, card.bottom) - Math.max(b.top, card.top));
  };
  return { top: inBand.reduce((best, top) => (area(top) < area(best) ? top : best), home), docked: false };
}
