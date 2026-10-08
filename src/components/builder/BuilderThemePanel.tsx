// The page builder's theme panel (LANDING_BUILDER_DESIGN.md section 2, "Theme"): the six theme
// colours, a heading and a body font from a short Google Fonts list, the corner radius, the
// widest the content runs, the spacing step and the button style. Every value goes through the
// reducer's setTheme, which runs the model's check, so a colour or a font the page could not
// draw is refused with the model's reason.
//
// Global styles (Wave 3): heading and body type, the link colour, the button's corners and shadow,
// and the padding and gap every section starts with. A key the document leaves out reads as
// DEFAULT_THEME's value, which is how the page drew before these settings existed.

import React from 'react';
import { DEFAULT_THEME, THEME_BUTTON_SHADOWS, THEME_COLOR_KEYS, THEME_NUMBER_RANGES } from '../../lib/pageBuilder/model.mjs';
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

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900].map(w => ({ value: String(w), label: String(w) }));

const SHADOW_WORDS: Record<string, string> = { none: 'None', soft: 'Soft', medium: 'Medium', strong: 'Strong' };

type NumberKey = 'headingScale' | 'headingLineHeight' | 'bodySize' | 'bodyLineHeight' | 'sectionPaddingY' | 'sectionGap';

/** The label, step and hint of each numeric global style; the range is the model's own. */
const NUMBER_FIELDS: Array<{ key: NumberKey; label: string; step: number; hint: (min: number, max: number) => string }> = [
  { key: 'headingScale', label: 'Heading size', step: 0.05, hint: (a, b) => `1 is the built-in size. From ${a} to ${b} times.` },
  { key: 'headingLineHeight', label: 'Heading line height', step: 0.05, hint: (a, b) => `As a multiple of the heading size, from ${a} to ${b}.` },
  { key: 'bodySize', label: 'Body text size', step: 1, hint: (a, b) => `From ${a} to ${b}.` },
  { key: 'bodyLineHeight', label: 'Body line height', step: 0.05, hint: (a, b) => `As a multiple of the text size, from ${a} to ${b}.` },
  { key: 'sectionPaddingY', label: 'Section padding, top and bottom', step: 4, hint: (a, b) => `Every section starts with this; a section's own padding wins. From ${a} to ${b}.` },
  { key: 'sectionGap', label: 'Space between sections', step: 4, hint: (a, b) => `From ${a} to ${b}.` }
];

const RANGES = THEME_NUMBER_RANGES as Record<string, { min: number; max: number; unit: string }>;

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

      <p id="jvb-global-styles" style={{ margin: '14px 0 6px', fontSize: '12px', fontWeight: 700, color: '#E2E8F0' }}>Global styles</p>
      <p style={{ ...hintStyle, margin: '0 0 8px' }}>These apply to every block that has no setting of its own.</p>
      {NUMBER_FIELDS.map(f => {
        const range = RANGES[f.key];
        const unit = range.unit === 'x' ? 'times' : range.unit || undefined;
        return (
          <NumberField
            key={f.key}
            label={f.label}
            unit={unit}
            value={theme[f.key] ?? (DEFAULT_THEME[f.key] as number)}
            min={range.min}
            max={range.max}
            step={f.step}
            hint={f.hint(range.min, range.max)}
            error={errorFor(`theme.${f.key}`)}
            onChange={v => { if (v !== undefined) set({ [f.key]: v }, `theme.${f.key}`); }}
          />
        );
      })}
      <SelectField
        label="Heading weight"
        value={String(theme.headingWeight ?? DEFAULT_THEME.headingWeight)}
        options={WEIGHTS}
        error={errorFor('theme.headingWeight')}
        onChange={v => set({ headingWeight: Number(v) }, 'theme.headingWeight')}
      />
      <SelectField
        label="Body weight"
        value={String(theme.bodyWeight ?? DEFAULT_THEME.bodyWeight)}
        options={WEIGHTS}
        error={errorFor('theme.bodyWeight')}
        onChange={v => set({ bodyWeight: Number(v) }, 'theme.bodyWeight')}
      />
      <ColorField
        label="Link colour"
        value={theme.linkColor ?? DEFAULT_THEME.linkColor}
        hint="Links inside text. Not set goes back to the main colour."
        error={errorFor('theme.linkColor')}
        onChange={v => set({ linkColor: (v ?? 'theme.primary') as BuilderTheme['linkColor'] }, 'theme.linkColor')}
      />
      <NumberField
        label="Button corner radius"
        unit="px"
        value={theme.buttonRadius ?? undefined}
        min={RANGES.buttonRadius.min}
        max={RANGES.buttonRadius.max}
        step={1}
        placeholder="Follows the page"
        hint="Left empty, buttons follow the corner radius and the button style."
        error={errorFor('theme.buttonRadius')}
        onChange={v => set({ buttonRadius: v === undefined ? null : v }, 'theme.buttonRadius')}
      />
      <SelectField
        label="Button shadow"
        value={theme.buttonShadow ?? DEFAULT_THEME.buttonShadow ?? 'none'}
        options={(THEME_BUTTON_SHADOWS as ReadonlyArray<string>).map(v => ({ value: v, label: SHADOW_WORDS[v] ?? v }))}
        error={errorFor('theme.buttonShadow')}
        onChange={v => set({ buttonShadow: v as NonNullable<BuilderTheme['buttonShadow']> }, 'theme.buttonShadow')}
      />
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
