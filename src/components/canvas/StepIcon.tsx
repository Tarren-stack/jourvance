import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { iconTile, type StepKindStyle } from '../../lib/stepKinds';

// A card's 28px icon tile, shaped and coloured by the step-kind table: a rounded square, a circle,
// or a diamond with its glyph turned back upright. The card's header label already names the step.
export const StepIcon: React.FC<{ kind: StepKindStyle; icon: LucideIcon }> = ({ kind, icon: Icon }) => {
  const t = iconTile(kind.shape, kind.color);
  return (
    <div aria-hidden="true" data-step-shape={kind.shape} style={t.box}>
      <div style={t.shape}>
        <span style={t.glyph}>
          <Icon size={t.glyphSize} />
        </span>
      </div>
    </div>
  );
};
