// The page builder's theme panel (LANDING_BUILDER_DESIGN.md section 2, "Theme"): the six theme
// colours, a heading and a body font from a short Google Fonts list, the corner radius, the
// widest the content runs, the spacing step and the button style. Every value goes through the
// reducer's setTheme, which runs the model's check, so a colour or a font the page could not
// draw is refused with the model's reason.

import React from 'react';
import { THEME_COLOR_KEYS } from '../../lib/pageBuilder/model.mjs';
import type { BuilderTheme, ThemeColorKey } from '../../types/pageBuilder';
import type { BuilderAction, BuilderNotice } from './builderState';
import { ColorField, NumberField, SelectField, hintStyle } from './BuilderFields';

/** The fonts the theme and the Style tab offer. Every name passes the model's font rule. */
export const FONT_CHOICES: string[] = [
  'Playfair Display',
  'Outfit',
  'Inter',
  'Plus Jakarta Sans',
  'DM Sans',
  'Poppins',
  'Montserrat',
  'Raleway',
  'Work Sans',
  'Space Grotesk',
  'Lora',
  'Merriweather',
  'Libre Baskerville',
  'Cormorant Garamond',
  'Roboto'
];

const COLOR_LABELS: Record<ThemeColorKey, string> = {
  primary: 'Main colour (buttons and links)',
  secondary: 'Second colour (ticks and stock line)',
  background: 'Page background',
  surface: 'Card background',
  text: 'Text',
  muted: 'Quiet text'
};

export interface BuilderThemePanelProps {
  theme: BuilderTheme;
  dispatch: (action: BuilderAction) => void;
  notice: BuilderNotice | null;
}

export const BuilderThemePanel: React.FC<BuilderThemePanelProps> = ({ theme, dispatch, notice }) => {
  const errorFor = (target: string) => (notice && notice.target === target ? notice.text : null);
  const set = (patch: Parameters<typeof dispatchTheme>[1], target: string) => dispatchTheme(dispatch, patch, target);
  const fontOptions = (current: string) => [
    ...FONT_CHOICES.map(f => ({ value: f, label: f })),
    ...(FONT_CHOICES.includes(current) ? [] : [{ value: current, label: current }])
  ];
  return (
    <div>
      <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 700, color: '#E2E8F0' }}>Colours</p>
      {(THEME_COLOR_KEYS as ReadonlyArray<ThemeColorKey>).map(key => (
        <ColorField
          key={key}
          label={COLOR_LABELS[key]}
          value={theme.colors[key]}
          allowTheme={false}
          error={errorFor(`theme.colors.${key}`)}
          onChange={v => {
            if (v) set({ colors: { [key]: v } }, `theme.colors.${key}`);
          }}
        />
      ))}

      <p style={{ margin: '12px 0 6px', fontSize: '12px', fontWeight: 700, color: '#E2E8F0' }}>Fonts</p>
      <SelectField
        label="Heading font"
        value={theme.fonts.heading}
        options={fontOptions(theme.fonts.heading)}
        error={errorFor('theme.fonts.heading')}
        onChange={v => set({ fonts: { heading: v } }, 'theme.fonts.heading')}
      />
      <SelectField
        label="Body font"
        value={theme.fonts.body}
        options={fontOptions(theme.fonts.body)}
        error={errorFor('theme.fonts.body')}
        onChange={v => set({ fonts: { body: v } }, 'theme.fonts.body')}
      />

      <p style={{ margin: '12px 0 6px', fontSize: '12px', fontWeight: 700, color: '#E2E8F0' }}>Shape and size</p>
      <NumberField
        label="Corner radius"
        unit="px"
        value={theme.radius}
        min={0}
        max={64}
        step={1}
        hint="From 0 to 64."
        error={errorFor('theme.radius')}
        onChange={v => { if (v !== undefined) set({ radius: v }, 'theme.radius'); }}
      />
      <NumberField
        label="Content width"
        unit="px"
        value={theme.containerWidth}
        min={480}
        max={1920}
        step={10}
        hint="How wide boxed sections run, from 480 to 1920."
        error={errorFor('theme.containerWidth')}
        onChange={v => { if (v !== undefined) set({ containerWidth: v }, 'theme.containerWidth'); }}
      />
      <NumberField
        label="Spacing step"
        unit="px"
        value={theme.spacingScale}
        min={2}
        max={24}
        step={1}
        hint="The gap between blocks grows with this, from 2 to 24."
        error={errorFor('theme.spacingScale')}
        onChange={v => { if (v !== undefined) set({ spacingScale: v }, 'theme.spacingScale'); }}
      />
      <SelectField
        label="Button style"
        value={theme.buttonStyle}
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'outline', label: 'Outline' },
          { value: 'pill', label: 'Pill (round ends)' }
        ]}
        onChange={v => set({ buttonStyle: v as BuilderTheme['buttonStyle'] }, 'theme.buttonStyle')}
      />
      <p style={hintStyle}>Fonts load from Google Fonts on the published page.</p>
    </div>
  );
};

function dispatchTheme(
  dispatch: (action: BuilderAction) => void,
  patch: Extract<BuilderAction, { type: 'setTheme' }>['theme'],
  target: string
): void {
  dispatch({ type: 'setTheme', theme: patch, target, coalesce: target, at: Date.now() });
}
