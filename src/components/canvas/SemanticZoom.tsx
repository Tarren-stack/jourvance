import React from 'react';
import { useStoreApi } from '@xyflow/react';
import { semanticZoomVars } from '../../lib/semanticZoom';

/**
 * Semantic zoom (F3, src/lib/semanticZoom.ts). Writes the zoom's detail level and sizes onto the
 * .react-flow element as data-jv-detail, --jv-title-scale (and the compact name's
 * --jv-compact-title-scale, U02), --jv-handle-hit, --jv-zoom and
 * --jv-caption-scale, which index.css reads to swap each card's detail rows for its summary, to size
 * the handles' hit areas and to keep line captions and design-check badges 11px on screen (T02). It
 * subscribes to the store rather than calling useStore, and writes at most once per animation frame,
 * so a zoom frame re-renders no card (and not even this component). Must render inside <ReactFlow>,
 * which provides the store.
 */
export function SemanticZoom() {
  const store = useStoreApi();

  React.useEffect(() => {
    let frame = 0;
    let written = '';
    const write = () => {
      frame = 0;
      const { transform, domNode } = store.getState();
      if (!domNode) return;
      const v = semanticZoomVars(transform[2]);
      const key = `${v.detail} ${v.titleScale} ${v.compactTitleScale} ${v.handleHitPx} ${v.zoom} ${v.captionScale}`;
      if (key === written && domNode.dataset.jvDetail === v.detail) return;
      written = key;
      domNode.dataset.jvDetail = v.detail;
      domNode.style.setProperty('--jv-title-scale', String(v.titleScale));
      domNode.style.setProperty('--jv-compact-title-scale', String(v.compactTitleScale));
      domNode.style.setProperty('--jv-handle-hit', `${v.handleHitPx}px`);
      domNode.style.setProperty('--jv-zoom', String(v.zoom));
      domNode.style.setProperty('--jv-caption-scale', String(v.captionScale));
    };
    write();
    const unsubscribe = store.subscribe((s, prev) => {
      if (s.transform[2] === prev.transform[2] && s.domNode === prev.domNode) return;
      if (!frame) frame = requestAnimationFrame(write);
    });
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [store]);

  return null;
}
