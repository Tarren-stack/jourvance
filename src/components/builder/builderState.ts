// The page builder's editing state (LANDING_BUILDER_PLAN.md Wave 2; LANDING_BUILDER_DESIGN.md
// sections 4, 5 and 7): one reducer over the document, the selection, the device being edited and
// an undo history of 50 steps each way.
//
// Pure on purpose: no React, no DOM and no clock (an action that may merge with the one before it
// carries its own time), so `node --test` loads this file as it is. Its only value import is the
// model, which is plain JavaScript.
//
// Three rules hold for every action below:
// 1. A change to the tree goes through the model's non-mutating functions (insertNode, moveNode,
//    removeNode, duplicateNode). A prop, style or theme edit builds the next document without
//    touching the current one and runs validateBuilderDoc on it.
// 2. A refused change leaves the document as the very same object and puts the model's reason in
//    `notice`, so the shell can show it and the live region can say it.
// 3. A style edit writes the layer of the device being edited and no other. The three "hide on"
//    switches and the CSS class are the two written exceptions (design section 2): the merchant
//    sees three switches and one class, and the reducer writes the layers that make the cascade
//    show exactly that.

import {
  STYLE_KEYS,
  SECTION_PROPS,
  WIDGET_REGISTRY,
  duplicateNode,
  findNode,
  insertNode,
  moveNode,
  removeNode,
  validateBuilderDoc,
  walk
} from '../../lib/pageBuilder/model.mjs';
import type {
  BuilderColumn,
  BuilderDevice,
  BuilderDoc,
  BuilderNode,
  BuilderProblem,
  BuilderSection,
  BuilderTheme,
  DeviceStyle,
  StyleValues
} from '../../types/pageBuilder';

/** How many steps undo and redo each keep. */
export const UNDO_LIMIT = 50;
/** Two edits with the same coalesce key this close together are one undo step. */
export const COALESCE_MS = 1000;

export interface BuilderNotice {
  text: string;
  /** Grows on every notice, so the same words said twice are still a new announcement. */
  seq: number;
  /** The field a refusal belongs to, when the change came from one ("props.url"). */
  target?: string;
}

export interface BuilderState {
  doc: BuilderDoc;
  /** The document as it was last written into the step. `dirty` is doc !== savedDoc. */
  savedDoc: BuilderDoc;
  selectedId: string | null;
  hoveredId: string | null;
  device: BuilderDevice;
  /** Older documents, oldest first. */
  past: BuilderDoc[];
  /** Undone documents, the next redo first. */
  future: BuilderDoc[];
  dirty: boolean;
  /** The last refusal, in the model's words. Cleared by the next change that lands. */
  notice: BuilderNotice | null;
  /** The last sentence for the polite live region: a change that landed, or a refusal. */
  announcement: BuilderNotice | null;
  /** The coalesce key and time of the last change, so a run of edits is one undo step. */
  lastEdit: { key: string; at: number } | null;
  seq: number;
}

export type ThemePatch = Partial<Omit<BuilderTheme, 'colors' | 'fonts'>> & {
  colors?: Partial<BuilderTheme['colors']>;
  fonts?: Partial<BuilderTheme['fonts']>;
};

/** Merges with the previous change when both carry the same key less than COALESCE_MS apart. */
interface Coalescing {
  coalesce?: string;
  at?: number;
}

export type BuilderAction =
  | { type: 'select'; id: string | null }
  | { type: 'hover'; id: string | null }
  | { type: 'setDevice'; device: BuilderDevice }
  | ({ type: 'insert'; parentId: string | null; index: number; node: BuilderNode; select?: string } & Coalescing)
  | ({ type: 'move'; id: string; parentId: string | null; index: number } & Coalescing)
  | { type: 'remove'; id: string }
  | { type: 'duplicate'; id: string }
  | ({ type: 'setProps'; id: string; props: Record<string, unknown>; target?: string } & Coalescing)
  | ({ type: 'setStyle'; id: string; values: Partial<Record<keyof StyleValues, unknown>>; target?: string } & Coalescing)
  | { type: 'setVisibility'; id: string; hidden: Record<BuilderDevice, boolean> }
  | ({ type: 'setClass'; id: string; className: string } & Coalescing)
  | ({ type: 'setTheme'; theme: ThemePatch; target?: string } & Coalescing)
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'replaceDoc'; doc: BuilderDoc }
  | { type: 'markSaved'; doc: BuilderDoc }
  | { type: 'clearNotice' }
  /** A refusal decided outside the reducer (a keyboard move with nowhere to go), said the same way. */
  | { type: 'notify'; text: string };

export function createBuilderState(doc: BuilderDoc, device: BuilderDevice = 'desktop'): BuilderState {
  return {
    doc,
    savedDoc: doc,
    selectedId: null,
    hoveredId: null,
    device,
    past: [],
    future: [],
    dirty: false,
    notice: null,
    announcement: null,
    lastEdit: null,
    seq: 0
  };
}

export const canUndo = (state: BuilderState): boolean => state.past.length > 0;
export const canRedo = (state: BuilderState): boolean => state.future.length > 0;

// ---- Reading the tree ----

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every node id on the page, in page order. */
export function nodeIds(doc: BuilderDoc): string[] {
  const ids: string[] = [];
  walk(doc, node => {
    ids.push(node.id);
  });
  return ids;
}

const hasNode = (doc: BuilderDoc, id: string | null): boolean => !!id && findNode(doc, id) !== null;

/** The chain of nodes from the page down to `id`, the node itself last. Empty when it is not on the page. */
export function ancestry(doc: BuilderDoc, id: string): BuilderNode[] {
  const chain: BuilderNode[] = [];
  const visit = (node: BuilderNode): boolean => {
    chain.push(node);
    if (node.id === id) return true;
    const children = (node as BuilderSection | BuilderColumn).children;
    if (Array.isArray(children)) for (const child of children) if (visit(child as BuilderNode)) return true;
    chain.pop();
    return false;
  };
  for (const section of doc.sections) if (visit(section)) return chain;
  return [];
}

function trimmedText(v: unknown, max = 40): string {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

/**
 * What the outline, the toolbar and every announcement call a node: a section by its name or
 * "Section 2" ("Inner section" inside a column), a column as "Column 1", a widget by its palette
 * label. Never an id.
 */
export function nodeLabel(doc: BuilderDoc, id: string): string {
  const chain = ancestry(doc, id);
  const node = chain[chain.length - 1];
  if (!node) return 'Block';
  if (node.kind === 'section') {
    const label = trimmedText((node.props as { label?: unknown })?.label);
    if (label) return label;
    if (chain.length === 1) return `Section ${doc.sections.indexOf(node as BuilderSection) + 1}`;
    return 'Inner section';
  }
  if (node.kind === 'column') {
    const parent = chain[chain.length - 2] as BuilderSection | undefined;
    const index = parent ? parent.children.indexOf(node as BuilderColumn) : 0;
    return `Column ${index + 1}`;
  }
  const def = (WIDGET_REGISTRY as Record<string, { label: string }>)[node.type];
  return def ? def.label : 'Block';
}

/** A few words of a widget's own copy, for the outline. Empty when it has none. */
export function nodeSnippet(node: BuilderNode): string {
  if (node.kind !== 'widget') return '';
  const p = (node.props || {}) as Record<string, unknown>;
  for (const key of ['text', 'label', 'heading', 'headline', 'title', 'caption', 'buttonText']) {
    const s = trimmedText(p[key], 32);
    if (s) return s;
  }
  if (Array.isArray(p.items) && p.items.length) return `${p.items.length} ${p.items.length === 1 ? 'item' : 'items'}`;
  return '';
}

/**
 * Where a node sits, in words, for the live region: "the page, position 2 of 3" for a section,
 * "Offer, column 2, position 1 of 4" for a widget, with the inner section named first when the
 * widget sits inside one.
 */
export function placeOf(doc: BuilderDoc, id: string): string {
  const chain = ancestry(doc, id);
  const node = chain[chain.length - 1];
  if (!node) return 'the page';
  const parent = chain[chain.length - 2] as BuilderSection | BuilderColumn | undefined;
  if (!parent) return `the page, position ${doc.sections.indexOf(node as BuilderSection) + 1} of ${doc.sections.length}`;
  const siblings = parent.children as BuilderNode[];
  const position = `position ${siblings.indexOf(node) + 1} of ${siblings.length}`;
  if (parent.kind === 'section') return `${nodeLabel(doc, parent.id)}, ${position}`;
  // A column: name its section and, when the section has more than one, which column.
  const section = chain[chain.length - 3] as BuilderSection | undefined;
  if (!section) return position;
  const columnPart = section.children.length > 1 ? `, column ${section.children.indexOf(parent as BuilderColumn) + 1}` : '';
  const sectionName = nodeLabel(doc, section.id);
  const outer = chain.length >= 5 ? ` in ${nodeLabel(doc, chain[chain.length - 5].id)}` : '';
  return `${sectionName}${outer}${columnPart}, ${position}`;
}

// ---- Problems in plain words ----

const problemMemo = new WeakMap<BuilderDoc, Set<string>>();

function problemKeys(doc: BuilderDoc): Set<string> {
  let keys = problemMemo.get(doc);
  if (!keys) {
    keys = new Set(validateBuilderDoc(doc).problems.map(p => `${p.path}\u0000${p.message}`));
    problemMemo.set(doc, keys);
  }
  return keys;
}

/** The problems `next` has that `prev` did not, so a page saved with an old problem stays editable. */
function newProblems(prev: BuilderDoc, next: BuilderDoc): BuilderProblem[] {
  const old = problemKeys(prev);
  return validateBuilderDoc(next).problems.filter(p => !old.has(`${p.path}\u0000${p.message}`));
}

/** A problem with the label of the field it belongs to in front, when the path names one. */
function describeProblem(problem: BuilderProblem, node: BuilderNode | null): string {
  const styleKey = /\.style\.(?:desktop|tablet|mobile)\.([A-Za-z]+)$/.exec(problem.path);
  if (styleKey && Object.hasOwn(STYLE_KEYS, styleKey[1])) {
    return `${(STYLE_KEYS as Record<string, { label: string }>)[styleKey[1]].label}: ${plainProblem(problem.message)}`;
  }
  const propKey = /\.props\.([A-Za-z]+)(?:\[\d+\](?:\.([A-Za-z]+))?)?$/.exec(problem.path);
  if (propKey && node) {
    const specs: Record<string, { label: string; item?: Record<string, { label: string }> }> =
      node.kind === 'section'
        ? (SECTION_PROPS as unknown as Record<string, { label: string }>)
        : node.kind === 'widget'
          ? ((WIDGET_REGISTRY as unknown as Record<string, { props: Record<string, { label: string; item?: Record<string, { label: string }> }> }>)[node.type]?.props ?? {})
          : {};
    const spec = specs[propKey[1]];
    const label = propKey[2] && spec?.item?.[propKey[2]] ? spec.item[propKey[2]].label : spec?.label;
    if (label) return `${label}: ${plainProblem(problem.message)}`;
  }
  const theme = /^theme\.(?:colors|fonts)?\.?([A-Za-z]+)$/.exec(problem.path);
  if (theme) return `${THEME_FIELD_NAMES[theme[1]] ?? 'Theme'}: ${plainProblem(problem.message)}`;
  const text = plainProblem(problem.message);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The words the theme panel itself uses for each theme setting, so a refusal names the field the merchant sees. */
const THEME_FIELD_NAMES: Readonly<Record<string, string>> = Object.freeze({
  primary: 'Main colour',
  secondary: 'Second colour',
  background: 'Page background',
  surface: 'Card background',
  text: 'Text',
  muted: 'Quiet text',
  heading: 'Heading font',
  body: 'Body font',
  radius: 'Corner radius',
  containerWidth: 'Content width',
  spacingScale: 'Spacing step',
  buttonStyle: 'Button style'
});

/** The model's wording with the code words out of it: a number is a number, and a theme colour is picked from the list. */
function plainProblem(message: string): string {
  return message
    .replace('is not a finite number', 'is not a number')
    .replace('use #rgb, #rrggbb, #rrggbbaa or', 'use a colour code such as #ec4899, or')
    .replace('a theme colour is #rgb, #rrggbb or #rrggbbaa', 'a theme colour is a colour code such as #ec4899')
    .replace(/ or a theme colour such as theme\.primary/, ' or pick a theme colour from the list')
    .replace(/, or theme\.heading or theme\.body/, ', or pick the theme heading or body font')
    .replace('a font is a family name or theme.heading or theme.body', 'a font is a family name, or the theme heading or body font');
}

// ---- Building the next document without touching this one ----

/** A copy of `doc` with node `id` replaced by `change(node)`. Only the path to it is copied. */
function replaceNode(doc: BuilderDoc, id: string, change: (node: BuilderNode) => BuilderNode): BuilderDoc | null {
  let hit = false;
  const visit = (node: BuilderNode): BuilderNode => {
    if (hit) return node;
    if (node.id === id) {
      hit = true;
      return change(node);
    }
    const children = (node as BuilderSection | BuilderColumn).children;
    if (!Array.isArray(children)) return node;
    let changed = false;
    const next = children.map(child => {
      const out = visit(child as BuilderNode);
      if (out !== child) changed = true;
      return out;
    });
    return changed ? ({ ...node, children: next } as BuilderNode) : node;
  };
  const sections = doc.sections.map(s => visit(s) as BuilderSection);
  return hit ? { ...doc, sections } : null;
}

/** A style layer with `values` laid over it: undefined or null clears a key. */
function mergeLayer(layer: StyleValues | undefined, values: Record<string, unknown>): StyleValues {
  const out: Record<string, unknown> = { ...(isPlainObject(layer) ? layer : {}) };
  for (const [key, v] of Object.entries(values)) {
    if (v === undefined || v === null) delete out[key];
    else out[key] = v;
  }
  return out as StyleValues;
}

/** A style with one layer replaced. A tablet or mobile layer left empty is dropped; desktop always stays. */
function withLayer(style: DeviceStyle | undefined, device: BuilderDevice, layer: StyleValues): DeviceStyle {
  const base: DeviceStyle = isPlainObject(style) ? { ...(style as DeviceStyle) } : { desktop: {} };
  if (!isPlainObject(base.desktop)) base.desktop = {};
  if (device === 'desktop') base.desktop = layer;
  else if (Object.keys(layer).length === 0) delete base[device];
  else base[device] = layer;
  return base;
}

/**
 * The layers that make "hidden on desktop, tablet, mobile" read exactly as the three switches say,
 * through the cascade: desktop states its own, and each smaller device states it only where it
 * differs from the device above it.
 */
export function visibilityLayers(style: DeviceStyle | undefined, hidden: Record<BuilderDevice, boolean>): DeviceStyle {
  let next = isPlainObject(style) ? (style as DeviceStyle) : { desktop: {} };
  const want: Array<[BuilderDevice, boolean | undefined]> = [
    ['desktop', hidden.desktop ? true : undefined],
    ['tablet', hidden.tablet !== hidden.desktop ? hidden.tablet : undefined],
    ['mobile', hidden.mobile !== hidden.tablet ? hidden.mobile : undefined]
  ];
  for (const [device, value] of want) {
    const layer = mergeLayer(next[device], { hidden: value });
    next = withLayer(next, device, layer);
  }
  return next;
}

// ---- The reducer ----

function pushLimited(list: BuilderDoc[], doc: BuilderDoc): BuilderDoc[] {
  const next = [...list, doc];
  return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next;
}

function mergesWithLast(state: BuilderState, action: Coalescing): boolean {
  if (!action.coalesce || typeof action.at !== 'number' || !state.lastEdit) return false;
  const gap = action.at - state.lastEdit.at;
  return state.lastEdit.key === action.coalesce && gap >= 0 && gap <= COALESCE_MS;
}

function say(state: BuilderState, text: string, target?: string): { seq: number; notice: BuilderNotice } {
  const seq = state.seq + 1;
  return { seq, notice: target ? { text, seq, target } : { text, seq } };
}

/** A change that landed: the new document, one undo step (or merged into the last), redo cleared. */
function commit(
  state: BuilderState,
  doc: BuilderDoc,
  action: Coalescing,
  extra: Partial<BuilderState>,
  sentence?: string
): BuilderState {
  const merge = mergesWithLast(state, action);
  const spoken = sentence ? say(state, sentence) : null;
  return {
    ...state,
    ...extra,
    doc,
    past: merge ? state.past : pushLimited(state.past, state.doc),
    future: [],
    dirty: doc !== state.savedDoc,
    notice: null,
    announcement: spoken ? spoken.notice : state.announcement,
    lastEdit: action.coalesce && typeof action.at === 'number' ? { key: action.coalesce, at: action.at } : null,
    seq: spoken ? spoken.seq : state.seq
  };
}

/** A refused change: the document stays the same object, the reason becomes the notice. */
function refuse(state: BuilderState, reason: string, target?: string): BuilderState {
  const { seq, notice } = say(state, reason, target);
  return { ...state, notice, announcement: notice, lastEdit: null, seq };
}

function neighbourAfterRemove(doc: BuilderDoc, id: string): string | null {
  const found = findNode(doc, id);
  if (!found) return null;
  const siblings = (found.parent ? found.parent.children : doc.sections) as BuilderNode[];
  const next = siblings[found.index + 1] ?? siblings[found.index - 1];
  if (next) return next.id;
  return found.parent ? found.parent.id : null;
}

/** Validates a document built by hand (a prop, style or theme edit) and commits it or refuses. */
function commitEdit(state: BuilderState, next: BuilderDoc, nodeId: string | null, action: Coalescing & { target?: string }): BuilderState {
  const problems = newProblems(state.doc, next);
  if (problems.length) {
    const node = nodeId ? (findNode(next, nodeId)?.node ?? null) : null;
    return refuse(state, sentenceCase(describeProblem(problems[0], node)), action.target);
  }
  return commit(state, next, action, {});
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'select': {
      const id = action.id && hasNode(state.doc, action.id) ? action.id : null;
      if (id === state.selectedId) return state;
      return { ...state, selectedId: id, notice: null, lastEdit: null };
    }

    case 'hover': {
      const id = action.id && hasNode(state.doc, action.id) ? action.id : null;
      return id === state.hoveredId ? state : { ...state, hoveredId: id };
    }

    case 'setDevice':
      return action.device === state.device ? state : { ...state, device: action.device, lastEdit: null };

    case 'insert': {
      const result = insertNode(state.doc, action.parentId, action.index, action.node);
      if (!result.ok) return refuse(state, sentenceCase(result.reason));
      const select = action.select && hasNode(result.doc, action.select) ? action.select : result.id;
      return commit(state, result.doc, action, { selectedId: select },
        `${nodeLabel(result.doc, select)} added to ${placeOf(result.doc, select)}.`);
    }

    case 'move': {
      const from = findNode(state.doc, action.id);
      if (!from) return refuse(state, 'That block is no longer on the page.');
      const fromParent = from.parent ? from.parent.id : null;
      if (fromParent === (action.parentId ?? null) && from.index === action.index) return state;
      const result = moveNode(state.doc, action.id, action.parentId, action.index);
      if (!result.ok) return refuse(state, sentenceCase(result.reason));
      return commit(state, result.doc, action, { selectedId: action.id },
        `${nodeLabel(result.doc, action.id)} moved to ${placeOf(result.doc, action.id)}.`);
    }

    case 'remove': {
      const label = hasNode(state.doc, action.id) ? nodeLabel(state.doc, action.id) : 'Block';
      const neighbour = neighbourAfterRemove(state.doc, action.id);
      const result = removeNode(state.doc, action.id);
      if (!result.ok) return refuse(state, sentenceCase(result.reason));
      const selectedId = state.selectedId && hasNode(result.doc, state.selectedId) ? state.selectedId : neighbour;
      return commit(state, result.doc, {}, { selectedId, hoveredId: null },
        `${label} removed. Undo brings it back.`);
    }

    case 'duplicate': {
      const result = duplicateNode(state.doc, action.id);
      if (!result.ok) return refuse(state, sentenceCase(result.reason));
      return commit(state, result.doc, {}, { selectedId: result.id },
        `${nodeLabel(result.doc, result.id)} copied to ${placeOf(result.doc, result.id)}. The copy is selected.`);
    }

    case 'setProps': {
      const found = findNode(state.doc, action.id);
      if (!found) return refuse(state, 'That block is no longer on the page.', action.target);
      if (found.node.kind === 'column') return refuse(state, 'A column has no settings of its own. Set its width in Style.', action.target);
      const next = replaceNode(state.doc, action.id, node => {
        const props: Record<string, unknown> = { ...(isPlainObject(node.props) ? node.props : {}) };
        for (const [key, v] of Object.entries(action.props)) {
          if (v === undefined) delete props[key];
          else props[key] = v;
        }
        return { ...node, props } as BuilderNode;
      });
      if (!next) return refuse(state, 'That block is no longer on the page.', action.target);
      if (sameJson(findNode(next, action.id)?.node.props, found.node.props)) return state;
      return commitEdit(state, next, action.id, action);
    }

    case 'setStyle': {
      if (!hasNode(state.doc, action.id)) return refuse(state, 'That block is no longer on the page.', action.target);
      const device = state.device;
      const next = replaceNode(state.doc, action.id, node => ({
        ...node,
        style: withLayer(node.style, device, mergeLayer(node.style?.[device], action.values as Record<string, unknown>))
      }) as BuilderNode);
      if (!next) return refuse(state, 'That block is no longer on the page.', action.target);
      if (sameJson(findNode(next, action.id)?.node.style, findNode(state.doc, action.id)?.node.style)) return state;
      return commitEdit(state, next, action.id, action);
    }

    case 'setVisibility': {
      if (!hasNode(state.doc, action.id)) return refuse(state, 'That block is no longer on the page.');
      const next = replaceNode(state.doc, action.id, node => ({ ...node, style: visibilityLayers(node.style, action.hidden) }) as BuilderNode);
      if (!next) return refuse(state, 'That block is no longer on the page.');
      return commitEdit(state, next, action.id, {});
    }

    case 'setClass': {
      if (!hasNode(state.doc, action.id)) return refuse(state, 'That block is no longer on the page.', 'style.customClass');
      const value = action.className.trim();
      const next = replaceNode(state.doc, action.id, node => ({
        ...node,
        style: withLayer(node.style, 'desktop', mergeLayer(node.style?.desktop, { customClass: value === '' ? undefined : value }))
      }) as BuilderNode);
      if (!next) return refuse(state, 'That block is no longer on the page.', 'style.customClass');
      return commitEdit(state, next, action.id, { ...action, target: 'style.customClass' });
    }

    case 'setTheme': {
      const t = action.theme;
      const theme: BuilderTheme = {
        ...state.doc.theme,
        ...(t as Partial<BuilderTheme>),
        colors: { ...state.doc.theme.colors, ...(t.colors || {}) } as BuilderTheme['colors'],
        fonts: { ...state.doc.theme.fonts, ...(t.fonts || {}) }
      };
      return commitEdit(state, { ...state.doc, theme }, null, action);
    }

    case 'undo': {
      if (!state.past.length) return state;
      const doc = state.past[state.past.length - 1];
      const future = [state.doc, ...state.future].slice(0, UNDO_LIMIT);
      const spoken = say(state, 'Undone.');
      return {
        ...state,
        doc,
        past: state.past.slice(0, -1),
        future,
        dirty: doc !== state.savedDoc,
        selectedId: hasNode(doc, state.selectedId) ? state.selectedId : null,
        hoveredId: hasNode(doc, state.hoveredId) ? state.hoveredId : null,
        notice: null,
        announcement: spoken.notice,
        lastEdit: null,
        seq: spoken.seq
      };
    }

    case 'redo': {
      if (!state.future.length) return state;
      const [doc, ...rest] = state.future;
      const spoken = say(state, 'Redone.');
      return {
        ...state,
        doc,
        past: pushLimited(state.past, state.doc),
        future: rest,
        dirty: doc !== state.savedDoc,
        selectedId: hasNode(doc, state.selectedId) ? state.selectedId : null,
        hoveredId: hasNode(doc, state.hoveredId) ? state.hoveredId : null,
        notice: null,
        announcement: spoken.notice,
        lastEdit: null,
        seq: spoken.seq
      };
    }

    case 'replaceDoc':
      return {
        ...state,
        doc: action.doc,
        savedDoc: action.doc,
        past: [],
        future: [],
        dirty: false,
        selectedId: hasNode(action.doc, state.selectedId) ? state.selectedId : null,
        hoveredId: null,
        notice: null,
        lastEdit: null
      };

    case 'markSaved':
      return { ...state, savedDoc: action.doc, dirty: state.doc !== action.doc };

    case 'clearNotice':
      return state.notice ? { ...state, notice: null } : state;

    case 'notify':
      return refuse(state, sentenceCase(action.text));

    default:
      return state;
  }
}

/** Two JSON-shaped values hold the same data (an edit that changes nothing is not an undo step). */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sentenceCase(s: string): string {
  const t = String(s || '').trim();
  if (!t) return 'That change could not be made.';
  const first = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

// ---- Keyboard moves (design section 7) ----

/**
 * The move Alt+Up or Alt+Down makes: one place within the node's parent. Answers the move action,
 * or a sentence saying why there is nowhere to go.
 */
export function siblingMove(doc: BuilderDoc, id: string, delta: -1 | 1, at?: number): { action: BuilderAction } | { refused: string } {
  const found = findNode(doc, id);
  if (!found) return { refused: 'Select a block first.' };
  const siblings = (found.parent ? found.parent.children : doc.sections) as BuilderNode[];
  const index = found.index + delta;
  if (index < 0) return { refused: `${nodeLabel(doc, id)} is already first in ${found.parent ? nodeLabel(doc, found.parent.id) : 'the page'}.` };
  if (index >= siblings.length) return { refused: `${nodeLabel(doc, id)} is already last in ${found.parent ? nodeLabel(doc, found.parent.id) : 'the page'}.` };
  return {
    action: { type: 'move', id, parentId: found.parent ? found.parent.id : null, index, coalesce: `keyboard-move:${id}`, at }
  };
}

/**
 * The move Alt+Shift+Up or Alt+Shift+Down makes: a widget or inner section into the previous or
 * next column on the page (to its end going up, its start going down); a column into the previous
 * or next section. A section has nowhere further to go: Alt+Up and Alt+Down already reorder it.
 */
export function crossMove(doc: BuilderDoc, id: string, delta: -1 | 1, at?: number): { action: BuilderAction } | { refused: string } {
  const found = findNode(doc, id);
  if (!found) return { refused: 'Select a block first.' };
  const node = found.node;
  if (node.kind === 'section' && !found.parent) {
    return { refused: 'A section moves up and down the page. Use Alt with the up or down arrow.' };
  }
  const wantKind = node.kind === 'column' ? 'section' : 'column';
  const containers: Array<BuilderSection | BuilderColumn> = [];
  walk(doc, n => {
    if (n.id === node.id) return false;
    if (n.kind !== wantKind) return true;
    // An inner section goes only into a top-level column: an inner section's columns cannot take one.
    if (node.kind === 'section' && ancestry(doc, n.id).length !== 2) return true;
    containers.push(n as BuilderSection | BuilderColumn);
    return true;
  });
  const parentId = found.parent ? found.parent.id : null;
  const at0 = containers.findIndex(c => c.id === parentId);
  const target = at0 < 0 ? undefined : containers[at0 + delta];
  if (!target) {
    return { refused: `There is no ${wantKind} ${delta < 0 ? 'before' : 'after'} this one to move ${nodeLabel(doc, id)} into.` };
  }
  const index = delta < 0 ? target.children.length : 0;
  return { action: { type: 'move', id, parentId: target.id, index, coalesce: `keyboard-move:${id}`, at } };
}
