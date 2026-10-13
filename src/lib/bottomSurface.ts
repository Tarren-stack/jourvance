import { useEffect } from 'react';

// A control fixed to the window foot (the edge inspector's Disconnect button, the canvas rule
// notice's Dismiss, the step dock's Next) shares the bottom-right corner with the Ask Jourvance
// bubble. Each such surface calls useBottomSurface(true) while it is showing, which keeps a COUNT
// in data-jv-bottom-surface on <html> (a count, so two surfaces showing at once do not clear each
// other). The bubble's CSS in index.css lifts it while the attribute is present. "0" removes it.

export const BOTTOM_SURFACE_ATTR = 'data-jv-bottom-surface';

interface AttrHost {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Add delta to the count on el, never below zero; at zero the attribute is removed. Answers the new count. */
export function bottomSurfaceCount(el: AttrHost, delta: number): number {
  const current = Number.parseInt(el.getAttribute(BOTTOM_SURFACE_ATTR) ?? '0', 10);
  const next = Math.max(0, (Number.isFinite(current) ? current : 0) + delta);
  if (next === 0) el.removeAttribute(BOTTOM_SURFACE_ATTR);
  else el.setAttribute(BOTTOM_SURFACE_ATTR, String(next));
  return next;
}

/** While active, this surface counts as showing at the window foot. */
export function useBottomSurface(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const root = document.documentElement;
    bottomSurfaceCount(root, 1);
    return () => {
      bottomSurfaceCount(root, -1);
    };
  }, [active]);
}
