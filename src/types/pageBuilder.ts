// The landing page builder's document, decided in one place (LANDING_BUILDER_PLAN.md, Wave 0).
//
// A page that carries `builder` is a tree: sections hold columns, a column holds widgets or one
// level of inner section, and an inner section's columns hold widgets only. Every node has an id,
// a kind, props and a style with a desktop layer and optional tablet and mobile layers that
// cascade desktop, then tablet, then mobile. The rules that make a document valid live in
// src/lib/pageBuilder/model.mjs (validateBuilderDoc); this file is only their shapes.
//
// Types only, and every one erasable: no enums, no namespaces, no parameter properties, so Node
// strips this file for the tests and the server never needs a TypeScript loader for it.

/** The device a style layer applies to. Tablet starts at 1024px and below, mobile at 640px and below. */
export type BuilderDevice = 'desktop' | 'tablet' | 'mobile';

/** What a node is. An inner section is a 'section' that sits inside a column. */
export type BuilderNodeKind = 'section' | 'column' | 'widget';

/** The theme colour slots a colour value may name as `theme.<slot>`. */
export type ThemeColorKey = 'primary' | 'secondary' | 'background' | 'surface' | 'text' | 'muted';

/** A theme colour reference, for example `theme.primary`. */
export type ThemeColorToken = `theme.${ThemeColorKey}`;

/**
 * A colour: `#rgb`, `#rrggbb`, `#rrggbbaa` or a theme token. The template type cannot check the
 * hex digits, so validateBuilderDoc does.
 */
export type BuilderColor = `#${string}` | ThemeColorToken;

/** A font for one element: a theme slot (`theme.heading`, `theme.body`) or a Google Fonts family name. */
export type BuilderFont = 'theme.heading' | 'theme.body' | (string & {});

/**
 * A link: `http://` or `https://` with a host, a site-relative path that starts with one slash, or
 * an anchor on the same page (`#offer`). Empty means no link.
 */
export type BuilderUrl = string;

export type BuilderAlign = 'start' | 'center' | 'end' | 'stretch';
export type BuilderTextAlign = 'left' | 'center' | 'right' | 'justify';
export type BuilderVerticalAlign = 'top' | 'middle' | 'bottom';
export type BuilderBorderStyle = 'none' | 'solid' | 'dashed' | 'dotted';
export type BuilderShadow = 'none' | 'sm' | 'md' | 'lg' | 'xl';
export type BuilderFontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

/**
 * One device layer of a node's style. Every key is optional: a key a layer leaves out is
 * inherited from the layer above it (tablet from desktop, mobile from tablet). Lengths are CSS
 * pixels unless the comment says otherwise. A value is refused, never clamped, when it is out of
 * range (model.mjs STYLE_KEYS holds the ranges).
 */
export interface StyleValues {
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;

  backgroundColor?: BuilderColor;
  backgroundImage?: BuilderUrl;
  /** Focal point of the background image, 0 to 100 percent from the left. */
  backgroundFocalX?: number;
  /** Focal point of the background image, 0 to 100 percent from the top. */
  backgroundFocalY?: number;
  backgroundOverlayColor?: BuilderColor;
  /** Overlay strength, 0 to 100 percent. */
  backgroundOverlayOpacity?: number;

  borderWidth?: number;
  borderStyle?: BuilderBorderStyle;
  borderColor?: BuilderColor;
  borderRadius?: number;
  shadow?: BuilderShadow;

  fontFamily?: BuilderFont;
  fontSize?: number;
  fontWeight?: BuilderFontWeight;
  /** Unitless multiple of the font size. */
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: BuilderTextAlign;
  textColor?: BuilderColor;

  /** Width as a percentage of the parent, 1 to 100. A column's width on this device. */
  width?: number;
  maxWidth?: number;
  /** Where the node sits across its parent. */
  align?: BuilderAlign;
  /** Where a section's or column's content sits from top to bottom. */
  verticalAlign?: BuilderVerticalAlign;
  minHeight?: number;

  /** Hidden on this device and, by the cascade, on the smaller ones until a layer sets it false. */
  hidden?: boolean;
  /** Space separated class names. Desktop layer only: a class cannot change per device. */
  customClass?: string;
}

/** A node's style: the desktop layer always, tablet and mobile only where they differ. */
export interface DeviceStyle {
  desktop: StyleValues;
  tablet?: StyleValues;
  mobile?: StyleValues;
}

/** The page's theme. Colours are plain hex here; nodes refer to them as `theme.<slot>`. */
export interface BuilderTheme {
  colors: Record<ThemeColorKey, string>;
  /** Google Fonts family names. */
  fonts: { heading: string; body: string };
  /** Corner radius for cards and buttons, in pixels. */
  radius: number;
  /** The spacing step in pixels that spacing presets multiply. */
  spacingScale: number;
  buttonStyle: 'solid' | 'outline' | 'pill';
  /** Widest the boxed content runs, in pixels. */
  containerWidth: number;
}

// ---- Layout props ----

export interface SectionProps {
  /** The name the outline shows. Never published. */
  label: string;
  /** The id a link can jump to (`#offer`). Letters, digits, hyphens and underscores; empty for none. */
  anchor: string;
  /** boxed keeps content within the theme's container width; full runs edge to edge. */
  contentWidth: 'boxed' | 'full';
  /** Space between columns, in pixels. */
  columnGap: number;
  /** The largest device on which the columns stack into one. */
  stackOn: 'tablet' | 'mobile' | 'never';
}

/** A column has no props of its own: its width, alignment and spacing are style. */
export type ColumnProps = Record<string, never>;

// ---- Widget props, one per widget type ----

export interface HeadingProps {
  text: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  link: BuilderUrl;
}

export interface TextProps {
  /** A markdown subset: paragraphs, bold, italic, links and lists. */
  text: string;
}

export interface ImageProps {
  src: BuilderUrl;
  /** Required by the editor before publish; empty only for a decorative image. */
  alt: string;
  caption: string;
  link: BuilderUrl;
  fit: 'cover' | 'contain';
  aspect: 'auto' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';
}

export interface ButtonProps {
  label: string;
  url: BuilderUrl;
  newTab: boolean;
  variant: 'primary' | 'secondary' | 'outline';
  size: 'sm' | 'md' | 'lg';
  fullWidth: boolean;
}

/** A spacer's height is its style (minHeight), so it can differ per device. */
export type SpacerProps = Record<string, never>;

export interface DividerProps {
  lineStyle: 'solid' | 'dashed' | 'dotted';
  thickness: number;
  color: BuilderColor;
  /** Length of the line as a percentage of its column, 5 to 100. */
  length: number;
}

export interface VideoProps {
  /** A YouTube or Vimeo address. Any other host is refused (the page's frame-src is closed). */
  url: BuilderUrl;
  /** The frame's accessible name. */
  title: string;
  aspect: '16:9' | '4:3' | '1:1' | '9:16';
  /** Seconds into the video to start. */
  startAt: number;
}

export interface IconListItem {
  text: string;
}

export interface IconListProps {
  icon: 'check' | 'star' | 'arrow' | 'dot';
  items: IconListItem[];
}

export interface TestimonialItem {
  quote: string;
  name: string;
  role: string;
  avatarUrl: BuilderUrl;
  /** 1 to 5 stars, or 0 for no stars. */
  rating: number;
}

export interface TestimonialsProps {
  layout: 'grid' | 'stack';
  items: TestimonialItem[];
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqProps {
  items: FaqItem[];
  openFirst: boolean;
}

export interface CountdownProps {
  /** The line before the clock. Empty reads as the page's own fallback. */
  text: string;
  /** evergreen counts each visitor's own minutes down; deadline counts down to one moment. */
  mode: 'evergreen' | 'deadline';
  minutes: number;
  /** ISO 8601 date and time, used when mode is deadline. */
  deadline: string;
  /** What the line says once the clock reaches zero. Empty reads as the page's own fallback. */
  expiredText: string;
}

export interface HtmlEmbedProps {
  /** Sanitised by the renderer: no script, no event handlers, no javascript: links. */
  html: string;
  /** What the outline and a screen reader call the embed. */
  title: string;
}

export type LeadFieldMode = 'hidden' | 'optional' | 'required';

export interface LeadFormProps {
  heading: string;
  buttonText: string;
  nameField: LeadFieldMode;
  phoneField: LeadFieldMode;
  successText: string;
  /** message thanks the visitor in place; checkout continues to the store as the modal does. */
  afterSubmit: 'message' | 'checkout';
}

export interface ProductHeroProps {
  productId: string;
  variantId: string;
  collectionId: string;
  title: string;
  price: string;
  /** The store product's own image. Wins over imageUrl when both are set, as today. */
  productImage: BuilderUrl;
  imageUrl: BuilderUrl;
  imageAlt: string;
  showPrice: boolean;
}

export interface CheckoutButtonProps {
  label: string;
  discountCode: string;
  /** direct goes to the cart; lead-gate asks for the email first. */
  checkoutMode: 'direct' | 'lead-gate';
  /** checkout records a checkout start; add records an add to cart. */
  cartAction: 'checkout' | 'add';
  /** Show "Code X is ready at checkout" with the button when a code is set. */
  showCodeNote: boolean;
  fullWidth: boolean;
}

export interface OrderBumpProps {
  productId: string;
  variantId: string;
  headline: string;
  description: string;
  title: string;
  price: string;
  image: BuilderUrl;
}

export interface ReviewsWallProps {
  headline: string;
  minRating: number;
  photos: boolean;
}

export interface StockCountProps {
  text: string;
  /** Units left. Shown as a line of its own only when text is empty. 0 means not set. */
  count: number;
}

export interface TrustBadgeProps {
  text: string;
  icon: 'none' | 'shield' | 'lock' | 'star';
}

/** Every widget type and its props. Columns are layout, not a widget. */
export interface WidgetPropsMap {
  heading: HeadingProps;
  text: TextProps;
  image: ImageProps;
  button: ButtonProps;
  spacer: SpacerProps;
  divider: DividerProps;
  video: VideoProps;
  iconList: IconListProps;
  testimonials: TestimonialsProps;
  faq: FaqProps;
  countdown: CountdownProps;
  htmlEmbed: HtmlEmbedProps;
  leadForm: LeadFormProps;
  productHero: ProductHeroProps;
  checkoutButton: CheckoutButtonProps;
  orderBump: OrderBumpProps;
  reviewsWall: ReviewsWallProps;
  stockCount: StockCountProps;
  trustBadge: TrustBadgeProps;
}

export type WidgetType = keyof WidgetPropsMap;

export type WidgetGroup = 'basic' | 'media' | 'content' | 'proof' | 'commerce';

// ---- Nodes ----

export interface BuilderSection {
  id: string;
  kind: 'section';
  props: SectionProps;
  style: DeviceStyle;
  /** At least one column. */
  children: BuilderColumn[];
}

export interface BuilderColumn {
  id: string;
  kind: 'column';
  props: ColumnProps;
  style: DeviceStyle;
  /** Widgets, or inner sections when this column belongs to a top-level section. */
  children: Array<BuilderWidget | BuilderSection>;
}

/** A widget of one type, its props typed by that type. */
export interface BuilderWidgetOf<T extends WidgetType> {
  id: string;
  kind: 'widget';
  type: T;
  props: WidgetPropsMap[T];
  style: DeviceStyle;
}

/** Any widget, discriminated by `type`. A widget never has children. */
export type BuilderWidget = { [T in WidgetType]: BuilderWidgetOf<T> }[WidgetType];

export type BuilderNode = BuilderSection | BuilderColumn | BuilderWidget;

/** The document a builder page stores at PageNodeData.builder. */
export interface BuilderDoc {
  version: number;
  theme: BuilderTheme;
  sections: BuilderSection[];
}

// ---- What the model answers ----

export interface BuilderProblem {
  /** Where the problem is, for example `sections[0].children[1].props.url`. Empty for the document. */
  path: string;
  message: string;
}

export interface BuilderValidation {
  ok: boolean;
  problems: BuilderProblem[];
}

/** A tree operation's answer: a new document, or the reason it was refused. Never a throw. */
export type BuilderOpResult =
  | { ok: true; doc: BuilderDoc; id: string; reason?: undefined }
  | { ok: false; reason: string; doc?: undefined; id?: undefined };

export interface FoundNode {
  node: BuilderNode;
  /** The section or column holding the node, or null for a top-level section. */
  parent: BuilderSection | BuilderColumn | null;
  index: number;
}

export interface WalkInfo {
  parent: BuilderSection | BuilderColumn | null;
  index: number;
  /** 0 for a top-level section, 1 for its columns, and so on. */
  depth: number;
  path: string;
}

/** Return false to skip a node's children. */
export type BuilderVisitor = (node: BuilderNode, info: WalkInfo) => boolean | void;

// ---- The widget registry ----

/** How one prop is checked and edited. The inspector draws its fields from these. */
export type PropSpec =
  | { kind: 'string'; label: string; multiline?: boolean; markdown?: boolean }
  | { kind: 'anchor'; label: string }
  | { kind: 'html'; label: string }
  | { kind: 'url'; label: string; video?: boolean }
  | { kind: 'color'; label: string }
  | { kind: 'number'; label: string; min: number; max: number; integer?: boolean; unit?: string }
  | { kind: 'boolean'; label: string }
  | { kind: 'enum'; label: string; values: ReadonlyArray<string | number> }
  | { kind: 'datetime'; label: string }
  | { kind: 'list'; label: string; itemLabel: string; max: number; item: Record<string, PropSpec> };

/** Where a style key sits in the inspector's Style tab. */
export type StyleGroup = 'spacing' | 'background' | 'border' | 'typography' | 'layout' | 'advanced';

/** How one style key is checked. Every value is checked before it can reach CSS. */
export type StyleSpec =
  | { kind: 'number'; group: StyleGroup; label: string; min: number; max: number; unit: string }
  | { kind: 'color'; group: StyleGroup; label: string }
  | { kind: 'url'; group: StyleGroup; label: string }
  | { kind: 'enum'; group: StyleGroup; label: string; values: ReadonlyArray<string | number> }
  | { kind: 'boolean'; group: StyleGroup; label: string }
  | { kind: 'font'; group: StyleGroup; label: string }
  | { kind: 'className'; group: StyleGroup; label: string; desktopOnly: true };

export interface WidgetDefinition<T extends WidgetType = WidgetType> {
  type: T;
  label: string;
  group: WidgetGroup;
  /** One line for the palette tooltip. */
  description: string;
  defaultProps: WidgetPropsMap[T];
  defaultStyle: DeviceStyle;
  /** Prop paths edited in place on the canvas. `items.*.text` is every item's text. */
  inlineEditable: string[];
  /** What the published page shows when a prop is empty, word for word from today's renderer. */
  fallbacks: Partial<Record<keyof WidgetPropsMap[T] & string, string>>;
  props: Record<string, PropSpec>;
}

export type WidgetRegistry = { [T in WidgetType]: WidgetDefinition<T> };

export interface MigrateOptions {
  /** Build version B of an A/B page, the way the live page merges variantB over version A. */
  variant?: 'a' | 'b';
}
