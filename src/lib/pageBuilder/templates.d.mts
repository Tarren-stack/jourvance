// Types for templates.mjs, the page builder's starting pages.

import type { BuilderDoc } from '../../types/pageBuilder';

export interface PageTemplate {
  id: string;
  name: string;
  group: string;
  description: string;
  /** Builds a fresh document with fresh ids. Never shares anything with an earlier call. */
  build: () => BuilderDoc;
}

export declare const TEMPLATES: ReadonlyArray<PageTemplate>;
export declare function templateById(id: string): PageTemplate | null;
export declare function buildTemplate(id: string): BuilderDoc | null;
