import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { iconTile, type StepKindStyle } from '../../lib/stepKinds';
import { publishStateLabel } from '../../lib/publishState';
import { publishTone, usePublishStatus } from './PublishStatus';

// What a card shows when the map is zoomed out (F3, src/lib/semanticZoom.ts): one key figure, its
// type icon and step name, and, for a page, whether it is live. At the phone's fit ('compact') the
// icon and name stay and the rest goes. It lies over the card's own box
// and is hidden until JourneyCanvas marks the map 'summary' or 'compact'; the card's detail rows
// (data-jv-detail-row) fade out then but keep their space, so no handle or line moves. Every
// size is in index.css, scaled by --jv-title-scale so the name stays 14px on screen.
//
// Render it as the LAST child of a card's root. The root is not positioned, so, like the design
// badge, its containing block is .react-flow__node, which is the card's own box. It is
// aria-hidden and takes no pointer: the step keeps its spoken name (React Flow's aria-label),
// and a press lands on the card or a handle as it always did. The step panel shows every detail.

/**
 * The card's icon tile (StepIcon's 28px box, from the same iconTile table) drawn as an SVG that is
 * 1em square, so it is always the size of the name beside it. StepIcon is drawn in px, and a px icon
 * scaled by the zoom variable stayed full size when the card's height capped the name's font: it
 * then made the first line taller than the name's line-height, and a short card cut the second line
 * of the name mid-glyph instead of ending it with an ellipsis.
 */
const SummaryIcon: React.FC<{ kind: StepKindStyle; icon: LucideIcon }> = ({ kind, icon: Icon }) => {
  const t = iconTile(kind.shape, kind.color);
  const side = Number(t.shape.width);
  const radius = t.shape.borderRadius === '50%' ? side / 2 : Number(t.shape.borderRadius);
  const at = (28 - side) / 2;
  const glyph = t.glyphSize;
  // A 1px border drawn inside the box, as box-sizing: border-box draws it on the tile.
  return (
    <svg className="jv-step-summary__icon" data-step-shape={kind.shape} viewBox="0 0 28 28" style={{ color: kind.color }}>
      <rect
        x={at + 0.5}
        y={at + 0.5}
        width={side - 1}
        height={side - 1}
        rx={radius - 0.5}
        fill={String(t.shape.background)}
        stroke={String(t.shape.border).replace(/^1px solid /, '')}
        strokeWidth={1}
        transform={kind.shape === 'diamond' ? 'rotate(45 14 14)' : undefined}
      />
      <Icon x={14 - glyph / 2} y={14 - glyph / 2} size={glyph} />
    </svg>
  );
};

export interface SummaryFigure {
  label: string;
  value: string;
}

export const StepSummary: React.FC<{
  nodeId: string;
  kind: StepKindStyle;
  icon: LucideIcon;
  name: string;
  figure: SummaryFigure;
}> = ({ nodeId, kind, icon, name, figure }) => {
  const { states } = usePublishStatus();
  const state = states.get(nodeId) ?? null;
  const tone = state ? publishTone(state) : null;
  return (
    <div className="jv-step-summary" aria-hidden="true">
      <div className="jv-step-summary__row jv-step-summary__more">
        <span className="jv-step-summary__figure">
          <span className="jv-step-summary__label">{figure.label}</span> {figure.value}
        </span>
      </div>
      {/* The icon leads the name's first line, so it stays at every zoom and costs no height. A
          name with no space (a page address) sets the icon in its first line's indent instead, or
          a narrow card would put the icon on a line of its own and the address on the next; the
          address then wraps after a hyphen or slash, and a part too long for its line ends in an
          ellipsis on that line and is never broken (U02). */}
      <div data-jv-title className={`jv-step-summary__name${/\s/.test(name.trim()) ? '' : ' jv-step-summary__name--address'}`}>
        <SummaryIcon kind={kind} icon={icon} />
        <span className="jv-step-summary__text">{name}</span>
      </div>
      {state && tone && (
        <div className="jv-step-summary__row jv-step-summary__more jv-step-summary__publish" style={{ color: tone.color }}>
          <span
            className="jv-step-summary__dot"
            style={{ background: tone.dashed ? 'transparent' : tone.color, borderColor: tone.color }}
          />
          <span className="jv-step-summary__figure">{publishStateLabel(state)}</span>
        </div>
      )}
    </div>
  );
};
