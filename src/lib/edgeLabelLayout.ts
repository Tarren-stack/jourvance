// Where each line's rate caption sits on the map (Aura's JourneyLabelLayout rule): a caption
// stays on its line if it can, otherwise it moves off with a thin leader back to the line.
// Two changes from Aura. Handles are obstacles too, because a caption over a handle stops a new
// line being dragged from that step. And a caption that has to leave its line makes the shortest
// straight move that clears everything (an axis sweep), in place of Aura's 24px ring search,
// which on the default map put captions 170 to 204px away over the wrong card. A move whose leader
// would run along another line, or straight on from its end, is passed over while any other move
// is clear, since that leader reads as the other line leading to the caption (R06).
//
// Everything here is in map units (React Flow's flow coordinates), so pan and zoom never move a
// caption relative to its line. No imports, so Node's test runner can load this file directly.
//
// Below zoom 1 a caption counter-scales so its text stays 11px on screen (T02, semanticZoom.ts), so
// the layout is given that scale: every caption box, gap and move grows by it. A caption that then
// has no clear spot within CAPTION_MAX_MOVE of its line shows its figure only ('compact'), and one
// that has no room even for that is not drawn ('hidden'), rather than cover a card, a handle or
// another caption. Its words stay in the pill's accessible name and the line panel either way. At
// scale 1 (zoom 1 and above) every caption is 'full' and placed exactly as before.

export interface Point {
  x: number;
  y: number;
}

/** Top-left corner plus size, in map units. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelRequest {
  id: string;
  width: number;
  height: number;
  /** The line's own midpoint (getSmoothStepPath's labelX, labelY). */
  midX: number;
  midY: number;
  /** The line's SVG path. */
  path: string;
  /** The caption's size showing its figure only, when it has a shorter form (T02). */
  compactWidth?: number;
  compactHeight?: number;
}

/** How much of a caption is drawn: all of it, its figure only, or nothing (it still takes focus). */
export type CaptionForm = 'full' | 'compact' | 'hidden';

export interface LabelPlacement {
  /** Caption centre. */
  x: number;
  y: number;
  /** The point on the line the caption belongs to; the leader starts here. */
  anchorX: number;
  anchorY: number;
  /** True when the caption sits off its line and needs a leader. */
  displaced: boolean;
  /** The midpoint this placement was computed for, so a line that has since moved can drop it. */
  forX: number;
  forY: number;
  /** How much of the caption fits there. Always 'full' at scale 1. */
  form: CaptionForm;
}

export interface PlaceOptions {
  /**
   * The captions' drawn scale (captionLayoutScale in semanticZoom.ts), about their own centres. Boxes,
   * gaps, handle clearance and the longest move all grow by it, so they keep their size on screen.
   */
  scale?: number;
}

export interface NodeGeometry {
  id: string;
  box: Box;
  handles: Box[];
}

export interface HandleLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of React Flow's InternalNode this file reads. Handle boxes are node-relative. */
export interface InternalNodeLike {
  id: string;
  hidden?: boolean;
  measured?: { width?: number; height?: number };
  internals: {
    positionAbsolute: Point;
    handleBounds?: { source?: HandleLike[] | null; target?: HandleLike[] | null } | null;
  };
}

export interface Rect {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Clear space kept between a caption and anything else. */
export const LABEL_GAP = 8;
/** Extra keep-out around a handle, so its whole grab area stays free. */
export const HANDLE_CLEARANCE = 10;
/** Moves within this many px of the shortest count as a tie and are settled by direction order. */
export const DIRECTION_TIE = 24;
/** Lines longer than this try 20% along before the midpoint, as Aura does. */
export const LONG_LINE = 450;
export const ANCHOR_FRACTIONS = [0.35, 0.65, 0.2, 0.8, 0.1, 0.9];
export const MAX_SWEEP_STEPS = 64;
/** A caption further than this from its anchor gets a leader. */
export const LEADER_MIN = 2;
/**
 * Below zoom 1, the furthest a caption may move off its line, in px on screen (times the scale in map
 * units). Further than this its leader reads as belonging to whatever it crosses, so the caption
 * tries its figure only, and failing that is not drawn.
 */
export const CAPTION_MAX_MOVE = 120;
/** Slate 400: 7.4:1 on the canvas (#0B0F19), and no line kind uses it. */
export const LEADER_COLOR = '#94A3B8';
/** A leader parallel to another line and this close to it reads as part of that line. */
export const LEADER_ALONG_OFFSET = 6;
/** ...and so does one that starts or ends this close to it in the same direction (R06). */
export const LEADER_JOIN_GAP = 32;
/** Parallel means within about 10 degrees (the sine of the angle between them). */
const LEADER_PARALLEL_SIN = 0.17;

const NUMBER_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/** A polyline for a smooth-step path. Smooth-step paths hold only M, L and Q commands. */
export function pathPoints(d: string): Point[] {
  const points: Point[] = [];
  if (typeof d !== 'string') return points;
  const commandRe = /([MLQ])([^MLQ]*)/g;
  let match: RegExpExecArray | null;
  while ((match = commandRe.exec(d)) !== null) {
    const nums = (match[2].match(NUMBER_RE) || []).map(Number);
    if (match[1] === 'Q') {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        const cx = nums[i];
        const cy = nums[i + 1];
        const ex = nums[i + 2];
        const ey = nums[i + 3];
        const from = points[points.length - 1] || { x: cx, y: cy };
        for (const t of [0.25, 0.5, 0.75]) {
          const u = 1 - t;
          points.push({
            x: u * u * from.x + 2 * u * t * cx + t * t * ex,
            y: u * u * from.y + 2 * u * t * cy + t * t * ey
          });
        }
        points.push({ x: ex, y: ey });
      }
    } else {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        points.push({ x: nums[i], y: nums[i + 1] });
      }
    }
  }
  return points;
}

export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** The point a fraction f of the way along the polyline. */
export function pointAlong(points: Point[], f: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { x: points[0].x, y: points[0].y };
  const target = pathLength(points) * Math.min(1, Math.max(0, f));
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + seg >= target && seg > 0) {
      const t = (target - walked) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += seg;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}

/** Shortest distance from a point to the polyline. */
export function distanceToPath(point: Point, points: Point[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)) : 0;
    const dist = Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
    if (dist < best) best = dist;
  }
  return best;
}

/**
 * True when a leader from anchor to caption lies along one of the other lines, or carries straight
 * on from one: parallel, within LEADER_ALONG_OFFSET of it, and overlapping it or within
 * LEADER_JOIN_GAP of its end. Such a leader looks like that line running on into the caption, so
 * the caption reads as the other line's (R06: bp6's TAKE leader ran up the retention line).
 */
export function leaderRunsAlong(anchor: Point, caption: Point, lines: Point[][]): boolean {
  const len = Math.hypot(caption.x - anchor.x, caption.y - anchor.y);
  if (len <= LEADER_MIN) return false;
  const ux = (caption.x - anchor.x) / len;
  const uy = (caption.y - anchor.y) / len;
  const reach = LEADER_ALONG_OFFSET + LEADER_JOIN_GAP;
  const minX = Math.min(anchor.x, caption.x) - reach;
  const maxX = Math.max(anchor.x, caption.x) + reach;
  const minY = Math.min(anchor.y, caption.y) - reach;
  const maxY = Math.max(anchor.y, caption.y) + reach;
  for (const points of lines) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      // Cheap reject: a segment wholly outside the leader's box grown by the reach.
      if (Math.max(a.x, b.x) < minX || Math.min(a.x, b.x) > maxX || Math.max(a.y, b.y) < minY || Math.min(a.y, b.y) > maxY) continue;
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (seg < 1) continue;
      if (Math.abs(ux * (b.y - a.y) - uy * (b.x - a.x)) / seg > LEADER_PARALLEL_SIN) continue;
      const offset = (p: Point) => Math.abs((p.x - anchor.x) * uy - (p.y - anchor.y) * ux);
      if (offset(a) > LEADER_ALONG_OFFSET || offset(b) > LEADER_ALONG_OFFSET) continue;
      const ta = (a.x - anchor.x) * ux + (a.y - anchor.y) * uy;
      const tb = (b.x - anchor.x) * ux + (b.y - anchor.y) * uy;
      const gap = Math.max(0, Math.min(ta, tb) - len, -Math.max(ta, tb));
      if (gap <= LEADER_JOIN_GAP) return true;
    }
  }
  return false;
}

/** True when the boxes come closer than gap on both axes (Aura's inequality). */
export function boxesOverlap(a: Box, b: Box, gap: number = LABEL_GAP): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/** A card's box and its handle boxes in map units, or null when it is hidden or not measured yet. */
export function nodeGeometry(n: InternalNodeLike | null | undefined): NodeGeometry | null {
  if (!n || n.hidden) return null;
  const width = n.measured?.width;
  const height = n.measured?.height;
  if (!width || !height) return null;
  const pos = n.internals?.positionAbsolute;
  if (!pos) return null;
  const handles: Box[] = [];
  const bounds = n.internals.handleBounds;
  for (const list of [bounds?.source, bounds?.target]) {
    if (!list) continue;
    for (const h of list) {
      handles.push({ x: pos.x + h.x, y: pos.y + h.y, width: h.width, height: h.height });
    }
  }
  return { id: n.id, box: { x: pos.x, y: pos.y, width, height }, handles };
}

/**
 * Every card box, plus every handle box grown by HANDLE_CLEARANCE on each side, times the caption
 * scale so the clearance keeps its size on screen when the map is zoomed out.
 */
export function obstaclesFor(nodes: Iterable<NodeGeometry | null | undefined>, scale: number = 1): Box[] {
  const out: Box[] = [];
  const clearance = HANDLE_CLEARANCE * Math.max(1, Number.isFinite(scale) ? scale : 1);
  for (const n of nodes) {
    if (!n) continue;
    out.push({ ...n.box });
    for (const h of n.handles) {
      out.push({
        x: h.x - clearance,
        y: h.y - clearance,
        width: h.width + clearance * 2,
        height: h.height + clearance * 2
      });
    }
  }
  return out;
}

/**
 * A box on screen (a getBoundingClientRect) in map units, for the map's pane at `pane` and React
 * Flow's transform [x, y, zoom]. Used for what floats over the map, so a caption keeps out from under it.
 */
export function screenBoxToFlow(
  rect: { left: number; top: number; width: number; height: number },
  pane: { left: number; top: number },
  transform: [number, number, number]
): Box {
  const [tx, ty, zoom] = transform;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return { x: (rect.left - pane.left - tx) / z, y: (rect.top - pane.top - ty) / z, width: rect.width / z, height: rect.height / z };
}

/**
 * A box scaled about a point of its own (0 0 its top-left corner, 1 0 its top-right, 0.5 0.5 its
 * centre), as CSS scales an element about its transform-origin: a counter-scaled badge or caption.
 */
export function scaleBox(box: Box, scale: number, originX: number = 0.5, originY: number = 0.5): Box {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const ox = box.x + box.width * originX;
  const oy = box.y + box.height * originY;
  return { x: ox - (ox - box.x) * s, y: oy - (oy - box.y) * s, width: box.width * s, height: box.height * s };
}

/**
 * One string for the geometry placement depends on. It runs as a store selector on every store
 * update, pan frames included, so it is one loop that builds no intermediate arrays.
 */
export function geometryKey(nodes: Iterable<InternalNodeLike>): string {
  let key = '';
  for (const n of nodes) {
    if (!n || n.hidden) continue;
    const pos = n.internals?.positionAbsolute;
    key += n.id + ':' + Math.round(pos?.x || 0) + ',' + Math.round(pos?.y || 0) + ','
      + Math.round(n.measured?.width || 0) + 'x' + Math.round(n.measured?.height || 0);
    const bounds = n.internals?.handleBounds;
    if (bounds) {
      if (bounds.source) {
        for (const h of bounds.source) {
          key += '|' + Math.round(h.x) + ',' + Math.round(h.y) + ',' + Math.round(h.width) + ',' + Math.round(h.height);
        }
      }
      key += '/';
      if (bounds.target) {
        for (const h of bounds.target) {
          key += '|' + Math.round(h.x) + ',' + Math.round(h.y) + ',' + Math.round(h.width) + ',' + Math.round(h.height);
        }
      }
    }
    key += ';';
  }
  return key;
}

function centredBox(x: number, y: number, width: number, height: number): Box {
  return { x: x - width / 2, y: y - height / 2, width, height };
}

function hitsOf(box: Box, occupied: Box[], gap: number = LABEL_GAP): Box[] {
  const hits: Box[] = [];
  for (const o of occupied) {
    if (boxesOverlap(box, o, gap)) hits.push(o);
  }
  return hits;
}

function insideAny(p: Point, occupied: Box[]): boolean {
  for (const o of occupied) {
    if (p.x >= o.x && p.x <= o.x + o.width && p.y >= o.y && p.y <= o.y + o.height) return true;
  }
  return false;
}

type Direction = 'up' | 'down' | 'left' | 'right';
const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

/** Moves the caption along one axis, each time just past everything it hits, until it is clear. */
function sweep(anchor: Point, w: number, h: number, dir: Direction, occupied: Box[], gap: number = LABEL_GAP): Point | null {
  let x = anchor.x;
  let y = anchor.y;
  for (let step = 0; step < MAX_SWEEP_STEPS; step++) {
    const hits = hitsOf(centredBox(x, y, w, h), occupied, gap);
    if (hits.length === 0) return { x, y };
    if (dir === 'up') {
      let top = Infinity;
      for (const b of hits) top = Math.min(top, b.y);
      y = top - gap - h / 2 - 0.5;
    } else if (dir === 'down') {
      let bottom = -Infinity;
      for (const b of hits) bottom = Math.max(bottom, b.y + b.height);
      y = bottom + gap + h / 2 + 0.5;
    } else if (dir === 'left') {
      let left = Infinity;
      for (const b of hits) left = Math.min(left, b.x);
      x = left - gap - w / 2 - 0.5;
    } else {
      let right = -Infinity;
      for (const b of hits) right = Math.max(right, b.x + b.width);
      x = right + gap + w / 2 + 0.5;
    }
  }
  return hitsOf(centredBox(x, y, w, h), occupied, gap).length === 0 ? { x, y } : null;
}

type LineInfo = { points: Point[]; minX: number; maxX: number; minY: number; maxY: number };
type Spot = { x: number; y: number; anchor: Point };

/**
 * A clear spot for a w x h caption: (a) on its line, else (b) the shortest move off it, no further
 * than maxMove. Null when neither is clear.
 */
function findSpot(
  id: string,
  anchors: Point[],
  w: number,
  h: number,
  occupied: Box[],
  lineOf: Map<string, LineInfo>,
  gap: number,
  tie: number,
  maxMove: number
): Spot | null {
  // (a) A spot on the line itself.
  for (const a of anchors) {
    if (hitsOf(centredBox(a.x, a.y, w, h), occupied, gap).length === 0) return { x: a.x, y: a.y, anchor: a };
  }

  // (b) The shortest move off the line, trying anchors in open space before buried ones.
  const reach = LEADER_ALONG_OFFSET + LEADER_JOIN_GAP;
  const tier1 = anchors.filter(a => !insideAny(a, occupied));
  const tier2 = anchors.filter(a => insideAny(a, occupied));
  for (const tier of [tier1, tier2]) {
    const found: { x: number; y: number; anchor: Point; dist: number; dirIndex: number; anchorIndex: number }[] = [];
    tier.forEach((a, anchorIndex) => {
      DIRECTIONS.forEach((dir, dirIndex) => {
        const p = sweep(a, w, h, dir, occupied, gap);
        if (!p) return;
        const dist = Math.hypot(p.x - a.x, p.y - a.y);
        if (dist <= maxMove) found.push({ ...p, anchor: a, dist, dirIndex, anchorIndex });
      });
    });
    if (found.length === 0) continue;
    // A leader that runs along another line is left out while any move does not (R06). Only
    // lines within reach of some candidate leader are asked about.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const f of found) {
      x0 = Math.min(x0, f.x, f.anchor.x); x1 = Math.max(x1, f.x, f.anchor.x);
      y0 = Math.min(y0, f.y, f.anchor.y); y1 = Math.max(y1, f.y, f.anchor.y);
    }
    const lines: Point[][] = [];
    for (const [other, l] of lineOf) {
      if (other === id || l.maxX < x0 - reach || l.minX > x1 + reach || l.maxY < y0 - reach || l.minY > y1 + reach) continue;
      lines.push(l.points);
    }
    const clear = lines.length === 0 ? found : found.filter(f => !leaderRunsAlong(f.anchor, f, lines));
    const pool = clear.length > 0 ? clear : found;
    let shortest = Infinity;
    for (const f of pool) shortest = Math.min(shortest, f.dist);
    const close = pool.filter(f => f.dist <= shortest + tie);
    close.sort((a, b) => a.dirIndex - b.dirIndex || a.anchorIndex - b.anchorIndex);
    return close[0];
  }
  return null;
}

/**
 * Places every caption, in edge-id order so the result never depends on DOM order. Captions with
 * no size yet are left out, so their edges fall back to their own midpoints. With a scale above 1
 * (the map zoomed out, T02) a caption is placed at its drawn size, and one with no clear spot close
 * to its line falls back to its figure only and then to hidden, never onto something else.
 */
export function placeEdgeLabels(labels: LabelRequest[], obstacles: Box[], options: PlaceOptions = {}): Map<string, LabelPlacement> {
  const result = new Map<string, LabelPlacement>();
  const scale = Number.isFinite(options.scale) && (options.scale as number) > 1 ? (options.scale as number) : 1;
  const scaled = scale > 1;
  const gap = LABEL_GAP * scale;
  const tie = DIRECTION_TIE * scale;
  const maxMove = scaled ? CAPTION_MAX_MOVE * scale : Infinity;
  const sorted = labels
    .filter(l => l && l.width > 0 && l.height > 0)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const occupied: Box[] = obstacles.map(o => ({ ...o }));
  // Every line on the map, captioned yet or not, with its bounds, so a leader can keep off the others.
  const lineOf = new Map<string, LineInfo>();
  for (const l of labels) {
    if (!l || lineOf.has(l.id)) continue;
    const pts = pathPoints(l.path);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    lineOf.set(l.id, { points: pts, minX, maxX, minY, maxY });
  }

  for (const label of sorted) {
    const points = lineOf.get(label.id)?.points ?? pathPoints(label.path);
    const mid: Point = { x: label.midX, y: label.midY };
    const longLine = points.length > 1 && pathLength(points) > LONG_LINE;
    const anchors: Point[] = longLine ? [pointAlong(points, 0.2), mid] : [mid];
    if (points.length > 1) {
      for (const f of ANCHOR_FRACTIONS) {
        if (!(longLine && f === 0.2)) anchors.push(pointAlong(points, f));
      }
    }

    // The whole caption first; zoomed out, then its figure alone when that is shorter.
    const forms: { form: CaptionForm; w: number; h: number }[] = [{ form: 'full', w: label.width * scale, h: label.height * scale }];
    const cw = label.compactWidth ?? 0;
    const ch = label.compactHeight ?? 0;
    if (scaled && cw > 0 && ch > 0 && cw < label.width) forms.push({ form: 'compact', w: cw * scale, h: ch * scale });

    let chosen: Spot | null = null;
    let form: CaptionForm = 'full';
    let size = forms[0];
    for (const f of forms) {
      chosen = findSpot(label.id, anchors, f.w, f.h, occupied, lineOf, gap, tie, maxMove);
      if (chosen) {
        form = f.form;
        size = f;
        break;
      }
    }

    if (!chosen) {
      // (c) Nowhere clear. At scale 1 the midpoint, as before this layout existed. Zoomed out the
      // caption is not drawn at all, and takes no space from the captions after it.
      chosen = { x: mid.x, y: mid.y, anchor: mid };
      form = scaled ? 'hidden' : 'full';
    }

    if (form !== 'hidden') occupied.push(centredBox(chosen.x, chosen.y, size.w, size.h));
    result.set(label.id, {
      x: chosen.x,
      y: chosen.y,
      anchorX: chosen.anchor.x,
      anchorY: chosen.anchor.y,
      displaced: form !== 'hidden' && Math.hypot(chosen.x - chosen.anchor.x, chosen.y - chosen.anchor.y) > LEADER_MIN,
      forX: label.midX,
      forY: label.midY,
      form
    });
  }
  return result;
}

/**
 * How much of a design-check badge is drawn zoomed out: its "! N" at 11px on screen, grown up and
 * left from its card's corner ('full') or up and right from it ('full-right'); a small amber dot with
 * no text on the corner ('dot'); or nothing ('hidden'). It keeps its focus and its name in every
 * form, and shows whole while it holds keyboard focus.
 */
export type BadgeForm = 'full' | 'full-right' | 'dot' | 'hidden';

export interface BadgeRequest {
  /** The step the badge sits on (its card's node id). */
  nodeId: string;
  /** The badge's box at scale 1, in map units: its card's corner, as the card lays it out. */
  box: Box;
}

export interface BadgePlacement {
  form: BadgeForm;
  /** What the badge covers in this form, in map units, or null when it is not drawn. */
  box: Box | null;
}

/**
 * Keep-out around another card's handle, in screen px from the handle's edge (times the scale in map
 * units): the radius of its 24px hit circle, so a badge never takes a press meant to start a line.
 */
export const BADGE_HANDLE_CLEARANCE = 12;
/** Keep-out around its own card's handles, in screen px from the dot: they draw above it (index.css). */
export const BADGE_OWN_HANDLE_CLEARANCE = 2;
/** The dot form's size against the 11px badge: about 13 by 10px on screen, on the card's corner. */
export const BADGE_DOT_SCALE = 0.5;

/**
 * The form each design-check badge takes at the scale it is drawn at (T02, captionScale in
 * semanticZoom.ts). An 11px badge counter-scales about its bottom-right corner, 10px down and 10px out
 * from its card's top-right corner (index.css), so it grows up and left, away from the step name; far
 * enough out it is bigger than the card and reaches the card above, its handles and its name. It is
 * drawn whole only where it clears every other card, the hit circle of every other card's handle
 * (BADGE_HANDLE_CLEARANCE), its own card's handle dots and every badge already placed: grown up and
 * left, or else up and right (about its bottom-left corner, over the card's edge). Failing both it is
 * a dot on the corner under the same rule, and failing that it is not drawn. Its own card is not an
 * obstacle, since the badge belongs on it. At scale 1 (zoom 1 and above) every badge is 'full', as
 * before T02. Deterministic: badges are taken in node id order.
 */
export function placeBadges(
  badges: BadgeRequest[],
  nodes: Iterable<NodeGeometry | null | undefined>,
  scale: number
): Map<string, BadgePlacement> {
  const result = new Map<string, BadgePlacement>();
  const s = Number.isFinite(scale) && scale > 1 ? scale : 1;
  const geometry = [...nodes].filter((n): n is NodeGeometry => !!n);
  if (s === 1) {
    for (const b of badges) if (b) result.set(b.nodeId, { form: 'full', box: { ...b.box } });
    return result;
  }
  // A handle's keep-out is a circle about its centre, past its dot by the clearance, as its hit area is.
  const circles: { x: number; y: number; r: number; node: string }[] = [];
  for (const n of geometry) {
    for (const h of n.handles) {
      circles.push({ x: h.x + h.width / 2, y: h.y + h.height / 2, r: Math.max(h.width, h.height) / 2, node: n.id });
    }
  }
  const reaches = (box: Box, c: { x: number; y: number }, r: number) => {
    const dx = Math.max(box.x - c.x, 0, c.x - (box.x + box.width));
    const dy = Math.max(box.y - c.y, 0, c.y - (box.y + box.height));
    return Math.hypot(dx, dy) < r;
  };
  const placed: Box[] = [];
  const sorted = badges
    .filter(b => b && b.box.width > 0 && b.box.height > 0)
    .slice()
    .sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
  for (const b of sorted) {
    const cards = geometry.filter(n => n.id !== b.nodeId).map(n => n.box);
    const clear = (box: Box) =>
      [...placed, ...cards].every(o => !boxesOverlap(box, o, 0)) &&
      circles.every(c => !reaches(box, c, c.r + (c.node === b.nodeId ? BADGE_OWN_HANDLE_CLEARANCE : BADGE_HANDLE_CLEARANCE) * s));
    const candidates: [BadgeForm, Box][] = [
      ['full', scaleBox(b.box, s, 1, 1)],
      ['full-right', scaleBox(b.box, s, 0, 1)],
      ['dot', scaleBox(b.box, s * BADGE_DOT_SCALE, 1, 1)]
    ];
    const hit = candidates.find(([, box]) => clear(box));
    const form: BadgeForm = hit ? hit[0] : 'hidden';
    const box = hit ? hit[1] : null;
    if (box) placed.push(box);
    result.set(b.nodeId, { form, box });
  }
  return result;
}

/** Clear space, in screen px, kept between a selected step's + Before / + Next and anything else. */
export const ADD_SLOT_GAP = 4;
/** How far, in screen px, the row may move from a resting spot to get clear before that spot is given up. */
export const ADD_SLOT_MAX_MOVE = 40;
/**
 * When no spot keeps ADD_SLOT_GAP from every caption, the space, in screen px, the row may keep from
 * one instead before it covers one (T07).
 */
export const ADD_SLOT_CLOSE_GAP = 1;
/**
 * A row that slid past a spot nearer another card stops only where it is this much nearer its own
 * card, in screen px, than any other (T07).
 */
export const ADD_SLOT_OWN_MARGIN = 8;
/**
 * Zoomed out, captions keep 11px on screen (T02), so they take more of the space around a card, and
 * a row that finds nothing clear within ADD_SLOT_MAX_MOVE may move this far, in screen px, before
 * it gives up and is hidden (U10).
 */
export const ADD_SLOT_FAR_MOVE = 80;

/** What is on the map around a selected step, in the same units as its card and its row. */
export interface StepAddObstacles {
  /** Line captions and each line's + Step. */
  captions: Box[];
  /**
   * Every design-check badge as drawn (U10). Kept clear exactly as a caption is, at every zoom: a
   * badge under the row cannot be pressed, and a press on what shows of it starts + Next instead.
   */
  badges?: Box[];
  /** Every other step's card. */
  cards: Box[];
  /** Every handle on the map, the selected step's own included. */
  handles: Box[];
  /**
   * What floats over the map and the space past its edges (T07): the tools and legend, the zoom
   * controls, the minimap, and a band beyond each edge (mapEdgeBands). A row under one of them
   * cannot be clicked, so no spot may touch one, not even the fallbacks.
   */
  overlays?: Box[];
}

export interface StepAddSpot {
  /** The row's top-left corner. */
  x: number;
  y: number;
  /** Which side of the card the row ended up on. */
  side: 'above' | 'below' | 'right' | 'left';
  /**
   * 'clear' when it touches nothing, 'close' when it covers nothing but sits nearer a caption or a
   * badge than the gap, and 'hidden' when every spot would cover something or read as another
   * step's (U10). A canvas that knows the rule does not draw a hidden row, as a caption or a badge
   * with no room is not drawn, except while a pill in it holds keyboard focus; x and y are then the
   * spot fallback names, so a row that is drawn after all can still be seen and pressed.
   */
  fit: 'clear' | 'close' | 'hidden';
  /**
   * Only when hidden: what the spot at x and y gives up, best first (STEP_ADD_FALLBACKS). 'badge' covers
   * a design-check badge but no caption, 'caption' covers a caption too, 'crowded' is nearer another
   * card than its own, and 'card' covers another card or a handle. Each of those is clear of every
   * overlay and of its own card, so it can be pressed. 'rest' is the resting spot, which can be under
   * the tools when a card is scrolled up to them.
   */
  fallback?: StepAddFallback;
}

/** What a hidden row's spot gives up, best first (StepAddSpot.fallback). */
export const STEP_ADD_FALLBACKS = ['badge', 'caption', 'crowded', 'card', 'rest'] as const;
export type StepAddFallback = (typeof STEP_ADD_FALLBACKS)[number];

/**
 * The four bands past a frame's edges, as screen rects: whatever sits in one is cut off by the map's
 * edge, so a caption or a step's row placed there cannot be read or clicked. far is how far each
 * band reaches, well past any move.
 */
export function mapEdgeBands(
  pane: { left: number; top: number; width: number; height: number },
  far: number = 1e6
): { left: number; top: number; width: number; height: number }[] {
  if (!(pane.width > 0 && pane.height > 0)) return [];
  const right = pane.left + pane.width;
  const bottom = pane.top + pane.height;
  return [
    { left: pane.left - far, top: pane.top - far, width: far, height: pane.height + 2 * far },
    { left: right, top: pane.top - far, width: far, height: pane.height + 2 * far },
    { left: pane.left, top: pane.top - far, width: pane.width, height: far },
    { left: pane.left, top: bottom, width: pane.width, height: far }
  ];
}

/**
 * The part of the first rect inside every other, as a screen rect: the map as far as it is on screen
 * when a scroller or the window has cut some of it off. Empty (width or height 0) when they miss.
 */
export function intersectRects(
  first: { left: number; top: number; width: number; height: number },
  ...others: { left: number; top: number; width: number; height: number }[]
): { left: number; top: number; width: number; height: number } {
  let left = first.left;
  let top = first.top;
  let right = first.left + first.width;
  let bottom = first.top + first.height;
  for (const o of others) {
    left = Math.max(left, o.left);
    top = Math.max(top, o.top);
    right = Math.min(right, o.left + o.width);
    bottom = Math.min(bottom, o.top + o.height);
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** A screen rect as a Box. */
export function rectToBox(r: { left: number; top: number; width: number; height: number }): Box {
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/** Shortest distance between two boxes, 0 when they touch or overlap. */
export function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

/**
 * Where a selected step's + Before / + Next row goes (R22). It rests above the card's top-right
 * corner, where a caption that left its line often sits too, and where on a branch the card above
 * and its bottom handles can be close. So the row tries spots around the card (above it, below it
 * and beside it, each allowed to move at most ADD_SLOT_MAX_MOVE away, or along the card) and takes
 * the first that covers no caption, no badge, no other card and no handle, and that is nearer its
 * own card than any other, so it never reads as another step's buttons. A slide goes on past a spot
 * that is clear but nearer another card, as far as its reach, rather than giving the side up (T07).
 * When no spot keeps the gap from the captions and badges it takes one that touches one but covers
 * none ('close'). The map's overlays and edges (T07) are in the way of every spot: a card scrolled up
 * under the tools or to the top edge puts its row below it instead, slid right past the corner when a
 * caption holds the space under the card's left. The last spots slide the row left past the card's
 * corner, above and below, and up and down past its ends beside it (U10). When nothing fits it is
 * 'hidden' (U10): a row over a badge took the press meant for the badge. A hidden row still gets the
 * best spot that can be pressed, the first of: clear of every caption but over a badge; over a caption
 * but clear of every card and handle ('caption' before U10); nearer another card ('crowded'); over
 * another card or a handle. Each is clear of every overlay, and only when none is does it rest at the
 * corner, where it can be under the tools. A canvas that draws a hidden row, because a pill in it has
 * keyboard focus or because it does not know the rule, so draws it where it can be seen and pressed.
 * Any units, so long as everything shares them (the canvas uses screen px).
 */
export function placeStepAdd(
  card: Box,
  row: { width: number; height: number },
  around: StepAddObstacles,
  rest: number = 8,
  gap: number = ADD_SLOT_GAP,
  maxMove: number = ADD_SLOT_MAX_MOVE,
  beyond: boolean = true
): StepAddSpot {
  const w = row.width;
  const h = row.height;
  const sized = (list: Box[] | undefined) => (list || []).filter(b => b && b.width > 0 && b.height > 0);
  // A badge is kept clear exactly as a caption is (U10).
  const captions = [...sized(around.captions), ...sized(around.badges)];
  const cards = sized(around.cards);
  const handles = sized(around.handles);
  // An overlay only has to be off the row for the row to be clicked, so the gap is not kept from
  // one: each is taken in by the gap, and a row may sit right against the tools or the controls
  // rather than cover a caption to keep its distance.
  const overlays = sized(around.overlays)
    .map(o => ({ x: o.x + gap, y: o.y + gap, width: o.width - 2 * gap, height: o.height - 2 * gap }))
    .filter(o => o.width > 0 && o.height > 0);
  const alongX = Math.max(0, card.width - w);
  const alongY = Math.max(0, card.height - h);
  const right = card.x + card.width - w;
  const above = card.y - rest - h;
  const below = card.y + card.height + rest;
  const besideRight = card.x + card.width + rest;
  const besideLeft = card.x - rest - w;
  // [side, start x, start y, direction, furthest move], in order of preference: the first one with
  // a clear spot wins. Above the card first, where the row has always been: lifted at the top-right
  // corner, then slid left along the card, then lifted at the top-left corner. Then the same below
  // the card, then beside it. Then above and below again, slid right past the card's corner by at
  // most the furthest move (T07): with the tools over the space above a card near the top of the map,
  // the space below it can hold a caption at its left and room at its right. Last, unless beyond is
  // false (U10), above and below slid left past the card's other corner, and beside it moved up past
  // its top or down past its bottom: zoomed out on a phone the row is wider than the card, the map is
  // a strip about 210px tall, and the space right above and below a card is where its neighbours'
  // captions and badges are. Out there a row can be as near another card as its own, so these stop
  // only where it is ADD_SLOT_OWN_MARGIN nearer its own, as a slide that passed another card's spot does.
  type Spot = [StepAddSpot['side'], number, number, Direction, number, boolean?];
  const spots: Spot[] = [
    ['above', right, above, 'up', maxMove],
    ['above', right, above, 'left', alongX],
    ['above', card.x, above, 'up', maxMove],
    ['below', right, below, 'down', maxMove],
    ['below', right, below, 'left', alongX],
    ['below', card.x, below, 'down', maxMove],
    ['right', besideRight, card.y, 'down', alongY],
    ['left', besideLeft, card.y, 'down', alongY],
    ['above', right, above, 'right', maxMove],
    ['below', right, below, 'right', maxMove],
    ...(beyond
      ? ([
          ['above', right, above, 'left', alongX + maxMove, true],
          ['below', right, below, 'left', alongX + maxMove, true],
          ['right', besideRight, card.y, 'up', maxMove, true],
          ['left', besideLeft, card.y, 'up', maxMove, true],
          ['right', besideRight, card.y + alongY, 'down', maxMove, true],
          ['left', besideLeft, card.y + alongY, 'down', maxMove, true]
        ] as Spot[])
      : [])
  ];
  // How much nearer another card is than the row's own: 0 or more when the row reads as that card's.
  const lead = (b: Box) => {
    const own = boxGap(b, card);
    let nearest = Infinity;
    for (const c of cards) nearest = Math.min(nearest, boxGap(b, c));
    return own - nearest;
  };
  const hits = (b: Box, blocks: Box[]) => blocks.filter(o => boxesOverlap(b, o, gap));
  // With ownNearest false a clear spot is taken even when it is nearer another card (a fallback).
  const choose = (blocks: Box[], ownNearest: boolean = true): StepAddSpot | null => {
    for (const [side, x0, y0, dir, reach, strict] of spots) {
      let x = x0;
      let y = y0;
      let found = false;
      // How much nearer its own card the row must be: any amount, until the slide has passed a spot
      // that reads as another card's, and from then on ADD_SLOT_OWN_MARGIN, so where it stops it does
      // not sit on the line between the two and read as the other card's all the same. The U10 spots
      // (strict) keep that margin from the start.
      let margin = strict ? ADD_SLOT_OWN_MARGIN : 0;
      // Each move is at least a pixel, so a slide ends by its reach.
      for (let step = 0; step < MAX_SWEEP_STEPS + reach + 1; step++) {
        if (Math.hypot(x - x0, y - y0) > reach + 0.001) break;
        const box = { x, y, width: w, height: h };
        const hit = hits(box, blocks);
        let by = 0;
        if (hit.length === 0) {
          const nearer = ownNearest ? lead(box) : -Infinity;
          if (nearer < -margin) {
            found = true;
            break;
          }
          // Clear but nearer another card: slide on (T07), since further along, still within reach,
          // the row can be clear and plainly nearer its own. Each gap changes by at most a pixel for
          // each pixel moved, so the lead cannot fall by the margin in less than half the difference:
          // move that far, or a pixel.
          margin = ADD_SLOT_OWN_MARGIN;
          by = Math.max(1, (nearer + margin) / 2);
        }
        // Just past everything it hits, as sweep() moves a caption.
        if (dir === 'up') y = hit.length ? Math.min(...hit.map(b => b.y)) - gap - h - 0.5 : y - by;
        else if (dir === 'down') y = hit.length ? Math.max(...hit.map(b => b.y + b.height)) + gap + 0.5 : y + by;
        else if (dir === 'right') x = hit.length ? Math.max(...hit.map(b => b.x + b.width)) + gap + 0.5 : x + by;
        else x = hit.length ? Math.min(...hit.map(b => b.x)) - gap - w - 0.5 : x - by;
      }
      if (found) return { x, y, side, fit: 'clear' };
    }
    return null;
  };
  // The card itself is in the way too, so no slide ends up over it.
  const solid = [...cards, ...handles, ...overlays, card];
  const clear = choose([...captions, ...solid]);
  if (clear) return clear;
  // Then a spot that touches a caption or a badge but covers none of it (T07): a hairline apart rather
  // than the gap, since a caption with a row right against it still reads and opens whole, and one the
  // row covers may not. Each is taken in so that ADD_SLOT_CLOSE_GAP of it is kept instead.
  const inset = Math.max(0, gap - ADD_SLOT_CLOSE_GAP);
  const edges = (list: Box[]) =>
    list
      .map(o => ({ x: o.x + inset, y: o.y + inset, width: o.width - 2 * inset, height: o.height - 2 * inset }))
      .filter(o => o.width > 0 && o.height > 0);
  const close = choose([...edges(captions), ...solid]);
  if (close) return { ...close, fit: 'close' };
  // Nowhere that covers nothing and reads as this step's: hidden (U10), at the best spot that can
  // still be pressed, for a canvas that draws it all the same (see placeStepAdd's comment).
  const hidden = (spot: StepAddSpot | null, fallback: StepAddFallback): StepAddSpot | null =>
    spot && { ...spot, fit: 'hidden', fallback };
  const lines = sized(around.captions);
  const overBadge =
    captions.length > lines.length ? hidden(choose([...lines, ...solid]) ?? choose([...edges(lines), ...solid]), 'badge') : null;
  return (
    overBadge ??
    hidden(choose(solid), 'caption') ??
    hidden(choose(solid, false), 'crowded') ??
    hidden(choose([...overlays, card], false), 'card') ?? { x: right, y: above, side: 'above', fit: 'hidden', fallback: 'rest' }
  );
}

/**
 * placeStepAdd for the canvas, which knows the zoom (T02). Design-check badges are kept clear at every
 * zoom (U10). From zoom 1 up the row may move ADD_SLOT_MAX_MOVE, as it always could. Zoomed out, where
 * captions and badges keep 11px on screen, it may also move ADD_SLOT_FAR_MOVE. It takes the first spot
 * clear of everything: the spots R22 and T07 tried, within each move in turn, and only then the ones
 * past the card's other corner and ends (U10), so a row that fitted before sits where it did. Failing
 * that, the first spot against a caption or a badge ('close'), and otherwise it is hidden, at the first
 * of the best fallback any move found (STEP_ADD_FALLBACKS).
 */
export function placeStepAddZoomed(
  card: Box,
  row: { width: number; height: number },
  around: StepAddObstacles,
  zoomedOut: boolean,
  rest: number = 8,
  gap: number = ADD_SLOT_GAP
): StepAddSpot {
  const moves = zoomedOut ? [ADD_SLOT_MAX_MOVE, ADD_SLOT_FAR_MOVE] : [ADD_SLOT_MAX_MOVE];
  const tries: [number, boolean][] = [...moves.map(m => [m, false] as [number, boolean]), ...moves.map(m => [m, true] as [number, boolean])];
  const rank = (s: StepAddSpot) =>
    s.fit === 'clear' ? 0 : s.fit === 'close' ? 1 : 2 + STEP_ADD_FALLBACKS.indexOf(s.fallback ?? 'rest');
  let best: StepAddSpot | null = null;
  for (const [move, beyond] of tries) {
    const spot = placeStepAdd(card, row, around, rest, gap, move, beyond);
    if (spot.fit === 'clear') return spot;
    if (!best || rank(spot) < rank(best)) best = spot;
  }
  return best as StepAddSpot;
}

/** True when a placement was computed for the line's current midpoint. */
export function placementFits(p: LabelPlacement, labelX: number, labelY: number): boolean {
  return Math.abs(p.forX - labelX) <= 0.5 && Math.abs(p.forY - labelY) <= 0.5;
}

const PLACEMENT_FIELDS: (keyof LabelPlacement)[] = ['x', 'y', 'anchorX', 'anchorY', 'forX', 'forY'];

/** Same keys, and every field within half a pixel, so a re-layout that changed nothing re-renders nothing. */
export function samePlacements(a: Map<string, LabelPlacement>, b: Map<string, LabelPlacement>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, pa] of a) {
    const pb = b.get(key);
    if (!pb || pa.displaced !== pb.displaced || (pa.form ?? 'full') !== (pb.form ?? 'full')) return false;
    for (const f of PLACEMENT_FIELDS) {
      if (Math.abs((pa[f] as number) - (pb[f] as number)) > 0.5) return false;
    }
  }
  return true;
}

function rectsOverlap(a: Rect, b: Rect, tolerance: number): boolean {
  return (
    a.left < b.right - tolerance &&
    a.right > b.left + tolerance &&
    a.top < b.bottom - tolerance &&
    a.bottom > b.top + tolerance
  );
}

/** A drawn design-check badge for findCollisions: its rect, and the id of its own card's rect. */
export interface BadgeRect extends Rect {
  card?: string;
}

/**
 * For browser checks: every caption that overlaps a card, a handle, a badge or another caption by
 * more than tolerance px, and every badge that overlaps a card other than its own, any handle or
 * another badge, as 'caption / other' strings. Plain rects, so it runs in Node on rects collected
 * in the page.
 */
export function findCollisions(
  input: { captions: Rect[]; cards?: Rect[]; handles?: Rect[]; badges?: BadgeRect[] },
  tolerance = 1
): string[] {
  const out: string[] = [];
  const captions = input.captions || [];
  const badges = input.badges || [];
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i];
    for (const card of input.cards || []) {
      if (rectsOverlap(c, card, tolerance)) out.push(`${c.id} / ${card.id}`);
    }
    for (const handle of input.handles || []) {
      if (rectsOverlap(c, handle, tolerance)) out.push(`${c.id} / ${handle.id}`);
    }
    for (const badge of badges) {
      if (rectsOverlap(c, badge, tolerance)) out.push(`${c.id} / ${badge.id}`);
    }
    for (let j = i + 1; j < captions.length; j++) {
      if (rectsOverlap(c, captions[j], tolerance)) out.push(`${c.id} / ${captions[j].id}`);
    }
  }
  for (let i = 0; i < badges.length; i++) {
    const b = badges[i];
    for (const card of input.cards || []) {
      if (card.id !== b.card && rectsOverlap(b, card, tolerance)) out.push(`${b.id} / ${card.id}`);
    }
    for (const handle of input.handles || []) {
      if (rectsOverlap(b, handle, tolerance)) out.push(`${b.id} / ${handle.id}`);
    }
    for (let j = i + 1; j < badges.length; j++) {
      if (rectsOverlap(b, badges[j], tolerance)) out.push(`${b.id} / ${badges[j].id}`);
    }
  }
  return out;
}

/** The class of React Flow's viewport portal: the layer after the steps that captions render into. */
export const VIEWPORT_PORTAL_SELECTOR = '.react-flow__viewport-portal';

interface QueryRoot {
  querySelector(selector: string): { isConnected?: boolean } | null;
}

const portalCache = new WeakMap<object, { isConnected?: boolean }>();

/**
 * React Flow's viewport portal inside one flow's root, found once per root. The provider asks on
 * every store update (about 30 a keystroke), so a DOM query each time is what made typing slow on
 * a large map (R16). Only a found, still-attached element is kept, so a miss is asked again.
 */
export function viewportPortalOf<T extends { isConnected?: boolean }>(
  root: QueryRoot | null | undefined
): T | null {
  if (!root) return null;
  const cached = portalCache.get(root);
  if (cached && cached.isConnected !== false) return cached as T;
  const found = root.querySelector(VIEWPORT_PORTAL_SELECTOR);
  if (found) portalCache.set(root, found);
  else portalCache.delete(root);
  return (found as T) ?? null;
}
