// Semantic zoom for the journey map (F3), decided in one place.
//
// At fit-to-screen the map runs at about 0.64 at 1440px and 0.24 at 390px, so a card's 13px step
// name drew at 8px and 3px. Below FULL_DETAIL_MIN_ZOOM each card swaps its detail rows for a
// summary that draws the step name at SUMMARY_TITLE_SCREEN_PX on screen whatever the zoom, and at
// 1 and above nothing changes. JourneyCanvas writes the answer onto the .react-flow element as CSS
// custom properties and one data attribute, so a zoom frame never re-renders a card; index.css
// reads them.
//
// Line captions and the design-check badge (T02) counter-scale below zoom 1 so their 11px text
// stays 11px on screen: --jv-caption-scale. The caption layout (EdgeLabelLayout) places them at
// that size, stepped, and shows a caption that cannot fit whole as its figure only, or not at all,
// and a badge that would reach another card or a handle as a dot on its corner, or not at all.
//
// Pure: no imports, so node --test loads it directly.

/** The card's own step name size, in flow px (the 13px line under each card's kind label). */
export const CARD_TITLE_PX = 13;

/** The floor every other piece of map text keeps (#19), in rendered px for a card's step name. */
export const TITLE_MIN_RENDERED_PX = 11;

/**
 * The lowest zoom a card still shows every detail at: the in-flow 13px name then renders at 11px
 * or more (13 x 0.85 = 11.05), so a card title is never drawn under the floor at any zoom.
 */
export const FULL_DETAIL_MIN_ZOOM = 0.85;

/**
 * Below this the summary drops its figure row and publish row and keeps the icon and name. Under
 * it a card is too narrow for "Visitors Unavailable" on one line, and the shortest card (an ad or
 * a form, about 175 flow px tall) has no room for that figure on two lines as well as two lines
 * of name.
 */
export const COMPACT_MAX_ZOOM = 0.45;

/** What the summary's step name renders at on screen (acceptance: 13px or more). */
export const SUMMARY_TITLE_SCREEN_PX = 14;

/**
 * What a compact name renders at on screen (U02): the 13px the step names must keep, not the
 * summary's 14px. At the phone's fit a card is about 60px across, and a name breaks only between
 * words, so every px of width is a whole word more that fits.
 */
export const COMPACT_TITLE_SCREEN_PX = 13;

/** No scale past this, whatever the zoom: index.css also caps the name by the card's height. */
export const TITLE_SCALE_MAX = 10;

/** Every connection handle takes the pointer over at least this much of the screen across its dot (U01). */
export const HANDLE_HIT_SCREEN_PX = 24;

/** The drawn dot, in flow px (.custom-handle in index.css). The hit area is never smaller. */
export const HANDLE_DOT_PX = 10;

/**
 * The hit area's widest, in flow px, so a zoomed-out card can still be dragged: at 104 two
 * handles on one edge (an upsell's Accepted and Declined, a split's A and B, about 100 px apart)
 * barely touch, and a 260 px card keeps its middle for the drag. 104 is 24px on screen down to
 * zoom 0.23, below the 390px fit of the default map and bp6.
 */
export const HANDLE_HIT_MAX_FLOW_PX = 104;

/**
 * How far past its dot's centre, out of its card, an output handle's hit area may reach, in flow px
 * (T03). Two neighbouring handles face each other across the gap between their cards: an output on
 * one card's right edge, the next card's input on its left. A 98px circle about each dot overlapped
 * the other's, so on a phone a press just right of an output dot grabbed the next card's input. The
 * hit area keeps its HANDLE_HIT_SCREEN_PX size but slides back into its own card by whatever it
 * would reach past these. The closest facing pair on any map the app opens is 58.7 flow px apart,
 * centre to centre (the default map's ad and landing page), so an output reaches almost to the
 * middle of that gap and an input well short of it: the output, which starts a line, keeps the gap
 * up to its middle, and no area covers another handle's dot or reaches past the middle towards it.
 * An output does not move above zoom 0.43, and at zoom 1 and above (a 24 flow px circle) neither
 * does an input.
 */
export const HANDLE_OUT_REACH_SOURCE_FLOW_PX = 28;

/** The same for an input handle: half the 24px circle it has at zoom 1, so it never moves there. */
export const HANDLE_OUT_REACH_TARGET_FLOW_PX = 12;

/**
 * How far past its dot's centre a handle's hit area may reach INTO its own card, on screen (U01).
 * A press on a card body selects the card and never starts a line. Sliding the area into the card
 * (T03) had it reach 17 to 21px into a 64px card at the phone's fit, and on a touch screen the
 * browser snaps a tap onto a target that near, so 12 of 18 off-centre taps on a card armed a line.
 * With a mouse the area reaches at most this far in; on a coarse pointer (COARSE_POINTER_QUERY) only
 * the dot itself does. The outward reach and the width along the edge stay as T03 set them, so
 * zoomed out an area is still HANDLE_HIT_SCREEN_PX across its dot but shorter than that along its
 * own axis (about 12 to 20px with a mouse at the fits, a few px on a finger at the phone's): a line
 * is started there by zooming in, which the connecting notice says on a touch screen. The drawn dot
 * is never cut, so from zoom 1.6 up the dot alone reaches past this (HANDLE_DOT_PX / 2 x the zoom).
 */
export const HANDLE_IN_REACH_FINE_SCREEN_PX = 8;

/** The same on a coarse pointer (a finger): nothing past the dot. */
export const HANDLE_IN_REACH_COARSE_SCREEN_PX = 0;

/** index.css draws the coarse reach under this media query, and the connecting notice reads it. */
export const COARSE_POINTER_QUERY = '(any-pointer: coarse)';

export type PointerKind = 'fine' | 'coarse';

/** --jv-zoom moves in these steps, so a smooth zoom writes it no more often than it must. */
export const ZOOM_VAR_STEP = 0.005;

/** A line caption's text and the design-check badge's "! N", in flow px (ConversionEdge, DesignIssueBadge). */
export const CAPTION_PX = 11;

/** What a caption and a badge render at on screen below zoom 1 (T02): the 11px floor, never less. */
export const CAPTION_SCREEN_PX = 11;

/**
 * The caption layout re-runs only when the caption's scale crosses one of these steps (1.1, 1.21,
 * ...), so a smooth zoom from 1 to 0.1 lays the captions out about 25 times, never once a frame.
 */
export const CAPTION_LAYOUT_STEP = 1.1;

export type DetailLevel = 'full' | 'summary' | 'compact';

export interface SemanticZoomVars {
  detail: DetailLevel;
  /** Multiplies CARD_TITLE_PX (and the figure's 11px) for the summary: --jv-title-scale. */
  titleScale: number;
  /** Multiplies CARD_TITLE_PX for the compact name (U02): --jv-compact-title-scale. */
  compactTitleScale: number;
  /** The handle hit area's diameter in flow px: --jv-handle-hit. */
  handleHitPx: number;
  /**
   * The zoom rounded DOWN to a ZOOM_VAR_STEP: --jv-zoom. index.css hides a compact name whose
   * height cap would draw it under the floor, and a rounded-down zoom can only hide it early.
   */
  zoom: number;
  /**
   * Scales a line caption and the design-check badge about their own centres, so their 11px text
   * renders at CAPTION_SCREEN_PX on screen below zoom 1: --jv-caption-scale. 1 at zoom 1 and above.
   */
  captionScale: number;
}

const finiteZoom = (zoom: number): number => (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);

export function detailLevel(zoom: number): DetailLevel {
  const z = finiteZoom(zoom);
  if (z >= FULL_DETAIL_MIN_ZOOM) return 'full';
  return z < COMPACT_MAX_ZOOM ? 'compact' : 'summary';
}

/**
 * The summary name's scale: SUMMARY_TITLE_SCREEN_PX (or screenPx) on screen, never under 1 (the
 * card's own size) and rounded UP to a twentieth, so a smooth zoom writes the variable in steps and
 * the name never lands under its target.
 */
export function titleScale(zoom: number, screenPx: number = SUMMARY_TITLE_SCREEN_PX): number {
  const z = finiteZoom(zoom);
  const raw = screenPx / (CARD_TITLE_PX * z);
  const stepped = Math.ceil(raw * 20 - 1e-9) / 20;
  return Math.min(TITLE_SCALE_MAX, Math.max(1, stepped));
}

/** The compact name's scale: titleScale worked out for COMPACT_TITLE_SCREEN_PX (U02). */
export function compactTitleScale(zoom: number): number {
  return titleScale(zoom, COMPACT_TITLE_SCREEN_PX);
}

/** The handle hit area's diameter in flow px: HANDLE_HIT_SCREEN_PX on screen, within its bounds. */
export function handleHitPx(zoom: number): number {
  const z = finiteZoom(zoom);
  return Math.min(HANDLE_HIT_MAX_FLOW_PX, Math.max(HANDLE_DOT_PX, Math.ceil(HANDLE_HIT_SCREEN_PX / z)));
}

export interface HandleHitReach {
  /** How far the hit area reaches past the dot's centre out of the card, in flow px. */
  out: number;
  /** How far it reaches past the dot's centre into its own card, in flow px. */
  in: number;
  /** Its width along the card's edge, centred on the dot, in flow px. */
  across: number;
}

/**
 * How far a hit area may reach into its card past the dot's centre, in flow px (U01), as index.css
 * works it out: HANDLE_IN_REACH_*_SCREEN_PX divided by --jv-zoom (zoomVar, rounded down, so it
 * reads at most a hair over the screen figure).
 */
export function handleInReachCap(zoom: number, pointer: PointerKind = 'fine'): number {
  const screen = pointer === 'coarse' ? HANDLE_IN_REACH_COARSE_SCREEN_PX : HANDLE_IN_REACH_FINE_SCREEN_PX;
  return screen / zoomVar(zoom);
}

/**
 * Where a handle's hit area reaches (T03, U01), as index.css draws it: handleHitPx across, and
 * along its own axis from HANDLE_OUT_REACH_*_FLOW_PX out of its card to handleInReachCap into it.
 * The dot's own box always takes a press, so `in` is never under half the dot.
 * scripts/a11y-browser-check.mjs (handleTargets) measures the drawn area.
 */
export function handleHitReach(zoom: number, kind: 'source' | 'target', pointer: PointerKind = 'fine'): HandleHitReach {
  const d = handleHitPx(zoom);
  const cap = kind === 'source' ? HANDLE_OUT_REACH_SOURCE_FLOW_PX : HANDLE_OUT_REACH_TARGET_FLOW_PX;
  const out = Math.min(d / 2, cap);
  const inward = Math.max(HANDLE_DOT_PX / 2, Math.min(d - out, handleInReachCap(zoom, pointer)));
  return { out, in: inward, across: d };
}

/**
 * True when a finger is left a dot drawn under its own HANDLE_DOT_PX to aim at (U01): on a coarse
 * pointer, with the map zoomed out. The connecting notice then says to zoom in rather than promise a
 * dot that is easy to tap. Never on a fine pointer, whose areas still reach into the card.
 */
export function handleTargetsTight(zoom: number, pointer: PointerKind): boolean {
  return pointer === 'coarse' && finiteZoom(zoom) < 1;
}

/** The zoom rounded down to a ZOOM_VAR_STEP (the 1e-9 only keeps 0.2 from reading as 0.195). */
export function zoomVar(zoom: number): number {
  const z = finiteZoom(zoom);
  const steps = Math.floor(z / ZOOM_VAR_STEP + 1e-9);
  return Math.round(steps * ZOOM_VAR_STEP * 1000) / 1000;
}

/**
 * The caption and badge scale, from the zoom --jv-zoom holds (rounded down, so it can only read a
 * little large): CAPTION_SCREEN_PX on screen, never under 1, rounded UP to a thousandth.
 */
export function captionScale(zoom: number): number {
  const z = zoomVar(zoom);
  const raw = CAPTION_SCREEN_PX / (CAPTION_PX * z);
  return Math.max(1, Math.ceil(raw * 1000 - 1e-9) / 1000);
}

/**
 * The scale the caption layout places captions at: captionScale rounded UP to a CAPTION_LAYOUT_STEP
 * power. It is never less than the scale drawn, and a caption scales about its own centre, so each
 * drawn caption sits inside the box the layout kept clear for it.
 */
export function captionLayoutScale(zoom: number): number {
  const s = captionScale(zoom);
  if (s <= 1) return 1;
  const k = Math.ceil(Math.log(s) / Math.log(CAPTION_LAYOUT_STEP) - 1e-9);
  const stepped = Math.ceil(CAPTION_LAYOUT_STEP ** k * 10000) / 10000;
  return Math.max(s, stepped);
}

export function semanticZoomVars(zoom: number): SemanticZoomVars {
  return {
    detail: detailLevel(zoom),
    titleScale: titleScale(zoom),
    compactTitleScale: compactTitleScale(zoom),
    handleHitPx: handleHitPx(zoom),
    zoom: zoomVar(zoom),
    captionScale: captionScale(zoom)
  };
}

/** A step name's size on screen: its computed font size times the map's zoom. */
export function renderedTitlePx(fontPx: number, zoom: number): number {
  return fontPx * finiteZoom(zoom);
}
