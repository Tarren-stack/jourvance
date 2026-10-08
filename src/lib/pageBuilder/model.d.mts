// Types for model.mjs, declared against src/types/pageBuilder.ts. model.mjs stays plain
// JavaScript so the server can import it without a TypeScript loader; this file is what the
// editor's TypeScript sees.

import type {
  BuilderColumn,
  BuilderDevice,
  BuilderDoc,
  BuilderNode,
  BuilderOpResult,
  BuilderSection,
  BuilderTheme,
  BuilderValidation,
  BuilderVisitor,
  BuilderWidget,
  BuilderWidgetOf,
  FoundNode,
  MigrateOptions,
  PropSpec,
  SectionProps,
  StyleSpec,
  StyleValues,
  ThemeColorKey,
  WidgetGroup,
  WidgetPropsMap,
  WidgetRegistry,
  WidgetType
} from '../../types/pageBuilder';
import type { PageNodeData } from '../../types/journey';

export declare const BUILDER_VERSION: 1;
export declare const BREAKPOINTS: Readonly<{ tablet: 1024; mobile: 640 }>;
export declare const DEVICES: ReadonlyArray<BuilderDevice>;
export declare const LIMITS: Readonly<{
  maxNodes: number;
  maxString: number;
  maxColumns: number;
  maxListItems: number;
  maxUrl: number;
}>;
export declare const THEME_COLOR_KEYS: ReadonlyArray<ThemeColorKey>;
export declare const DEFAULT_THEME: Readonly<BuilderTheme>;
export declare const VIDEO_HOSTS: ReadonlyArray<string>;
export declare const STYLE_KEYS: Readonly<Record<keyof StyleValues, StyleSpec>>;
export declare const SECTION_PROPS: Readonly<Record<keyof SectionProps, PropSpec>>;
export declare const SECTION_DEFAULTS: Readonly<SectionProps>;
export declare const WIDGET_REGISTRY: Readonly<WidgetRegistry>;
export declare const WIDGET_GROUPS: ReadonlyArray<{ id: WidgetGroup; label: string }>;
export declare const LEGACY_STARTER_TEXT: ReadonlyArray<string>;
export declare const LEGACY_PLACEHOLDER_VARIANT_IDS: ReadonlyArray<string>;

export declare function createEmptyPage(
  theme?: Partial<Omit<BuilderTheme, 'colors' | 'fonts'>> & {
    colors?: Partial<BuilderTheme['colors']>;
    fonts?: Partial<BuilderTheme['fonts']>;
  }
): BuilderDoc;
export declare function mintId(prefix?: string): string;

export declare function createNode(kind: 'section'): BuilderSection;
export declare function createNode(kind: 'column'): BuilderColumn;
export declare function createNode<T extends WidgetType>(kind: 'widget', type: T): BuilderWidgetOf<T>;

export declare function propsWithDefaults(node: BuilderSection): SectionProps;
export declare function propsWithDefaults<T extends WidgetType>(node: BuilderWidgetOf<T>): WidgetPropsMap[T];
export declare function propsWithDefaults(node: BuilderNode): Record<string, unknown>;

export declare function validateBuilderDoc(doc: unknown): BuilderValidation;
export declare function resolveStyle(node: { style?: BuilderNode['style'] } | null | undefined, device: BuilderDevice): StyleValues;
export declare function countNodes(docOrNode: BuilderDoc | BuilderNode): number;

export declare function walk(doc: BuilderDoc, visitor: BuilderVisitor): void;
export declare function findNode(doc: BuilderDoc, id: string): FoundNode | null;

export declare function insertNode(doc: BuilderDoc, parentId: string | null, index: number, node: BuilderNode): BuilderOpResult;
export declare function moveNode(doc: BuilderDoc, id: string, parentId: string | null, index: number): BuilderOpResult;
export declare function removeNode(doc: BuilderDoc, id: string): BuilderOpResult;
export declare function duplicateNode(doc: BuilderDoc, id: string): BuilderOpResult;

export declare function migrateLegacyPage(
  pageData: Partial<PageNodeData> | null | undefined,
  options?: MigrateOptions
): BuilderDoc;

export type { BuilderWidget };
