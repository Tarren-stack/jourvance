// Types for render.mjs, the landing page builder's renderer. render.mjs stays plain JavaScript so
// the server can import it without a TypeScript loader; this file is what the editor sees.

import type { BuilderDevice, BuilderDoc, BuilderProblem, BuilderWidget } from '../../types/pageBuilder';

/** One verified review the reviews wall may show. */
export interface RenderReview {
  rating: number;
  reviewTitle?: string;
  reviewText?: string;
  tags?: string[];
  photos?: string[];
  customerName?: string;
}

/** What the page cannot know from the document. Every field is optional. */
export interface RenderContext {
  slug?: string;
  journeyId?: string;
  nodeId?: string;
  storeDomain?: string;
  currency?: string;
  /** The A/B version being served. */
  variant?: 'a' | 'b';
  /** The server's one test for a real variant: answers the id, or '' for a placeholder or none. */
  realVariantId?: (variantId: unknown) => string;
  /** The price as the visitor's currency shows it. */
  formatPrice?: (price: string) => string;
  reviews?: {
    summary?: { averageRating?: number | null; totalCount?: number };
    reviews?: RenderReview[];
  };
  /** The canvas: resolved CSS for one device, no media queries. */
  device?: BuilderDevice;
}

export interface RenderResult {
  html: string;
  css: string;
  problems: BuilderProblem[];
  /** Google Fonts family names the page uses, once each. */
  fonts: string[];
}

export interface VideoEmbed {
  provider: 'youtube' | 'vimeo';
  id: string;
  src: string;
  html: string;
}

export declare const STRUCTURAL_WORDS: Readonly<Record<string, string>>;

export declare function render(doc: unknown, context?: RenderContext): RenderResult;
export declare function renderWidget(node: BuilderWidget, context?: RenderContext, state?: object): string;
export declare function sanitizeHtml(html: unknown): string;
export declare function renderMarkdownSubset(text: unknown): string;
export declare function videoEmbed(url: unknown, title?: unknown, startAt?: unknown): VideoEmbed | null;

export type { BuilderDoc };
