/**
 * Which edge of its trigger a drop-down menu lines up with.
 *
 * The header's Add Step and More menus hang from the right edge of their buttons. When the toolbar
 * wraps (a tablet or a phone), those buttons sit near the left of the screen and a right-aligned
 * menu runs off it, cutting its items in half (found by #11's check:canvas at 768 and 390px). The
 * menu keeps its right alignment when that fits, lines up with the left edge when that fits
 * instead, and otherwise takes the side that loses less. No imports, so node tests can load it.
 */

export const MENU_GUTTER_PX = 8;

export function menuSide(
  trigger: { left: number; right: number },
  menuWidth: number,
  viewportWidth: number,
  gutter: number = MENU_GUTTER_PX
): 'left' | 'right' {
  const rightAlignedStart = trigger.right - menuWidth;
  if (rightAlignedStart >= gutter) return 'right';
  const leftAlignedEnd = trigger.left + menuWidth;
  if (leftAlignedEnd <= viewportWidth - gutter) return 'left';
  const lostRight = gutter - rightAlignedStart;
  const lostLeft = leftAlignedEnd - (viewportWidth - gutter);
  return lostLeft < lostRight ? 'left' : 'right';
}
