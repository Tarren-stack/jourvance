// The room a whole-map fit keeps clear for what floats over the map (C01): the tools and the line
// legend in the top-right corner, and the zoom controls and the minimap along the foot. A plain
// padding of 0.2 centres the map in the whole pane, so a map whose height nearly fills the pane put
// its top row under the legend and its bottom row under the minimap, which takes the pointer.
//
// Numbers are screen px. `base` is React Flow's number padding: the fit keeps at least what it
// gave before on every side, and more at the top and foot only where an overlay reaches further.

import type { CanvasFitOptions } from './editorReturn';

/** The minimap's box, as JourneyCanvas draws it, and React Flow's panel margin around it. */
export const MINIMAP_SIZE = { width: 140, height: 90 } as const;
export const PANEL_MARGIN = 15;
/** Clear space between an overlay and the nearest card. */
export const OVERLAY_GAP = 12;

export interface FitPadding {
  x: number;
  top: `${number}px`;
  bottom: `${number}px`;
}

/** What React Flow's number padding gives on one side of a pane `size` px long. */
export const basePaddingPx = (base: number, size: number) => Math.floor((size - size / (1 + base)) * 0.5);

/**
 * Padding for a whole-map fit. `overlayBottom` is how far down the pane the top-right tools and
 * legend reach, `paneHeight` the pane's height. Unmeasured (0 or less) keeps the old padding.
 */
export function overlayFitPadding(base: number, paneHeight: number, overlayBottom: number): number | FitPadding {
  if (!(paneHeight > 0) || !(overlayBottom > 0)) return base;
  const plain = basePaddingPx(base, paneHeight);
  const top = Math.max(plain, Math.ceil(overlayBottom + OVERLAY_GAP));
  const bottom = Math.max(plain, PANEL_MARGIN + MINIMAP_SIZE.height + OVERLAY_GAP);
  return { x: base, top: `${top}px`, bottom: `${bottom}px` };
}

/** A fit framed on one selected step keeps its own padding; a whole-map fit gets the overlay room. */
export function wholeMapFit(options: CanvasFitOptions, padding: number | FitPadding): CanvasFitOptions | (Omit<CanvasFitOptions, 'padding'> & { padding: number | FitPadding }) {
  return options.nodes ? options : { ...options, padding };
}
