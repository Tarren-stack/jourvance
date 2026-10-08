# Landing page builder: the plan

Owner ask (2026-10-08): turn "edit landing page" into a full drag-and-drop page builder, the
way Aura has one, "think Elementor for WordPress". Take what Aura has, improve what needs it.
Build it with Opus and Sonnet agents; the main session plans, reviews, commits.

This file is the kept plan. A wave is done when its acceptance list is green, its evidence is
in `JOURVANCE_RUNNING_AUDIT.md`, and the main session has committed it. Agents never commit.

## What exists (surveyed 2026-10-08, see the audit entry)

- **Aura** carries a port of the hub's portable landing builder (`feature-library/landing-builder/portable/`, 18 files): a FLAT ordered list of 27 block types, a `srcdoc` iframe canvas drawn by the same renderer that publishes, `@dnd-kit` for palette and outline, 30-step undo, autosave, a page theme (5 colours, font pairing, radius, motion), a section inspector (content, background, spacing), inline plain-text editing, template packs, saved sections in localStorage. No nesting, no per-device styles, no per-element typography, margins, borders or shadows. Two drag paths are broken in Aura (canvas reorder messages unhandled; palette drop target never created).
- **Jourvance** has a fixed-layout form (`src/components/drawers/PageEditor.tsx`, 3,516 lines) over flat fields in `PageNodeData` (`src/types/journey.ts` 72-166), published through `POST /api/journey/:id/publish` into the hub app store and served by one hard-coded template in `server/routes/publicRoutes.mjs` (`renderPublicFunnelHtml`, lines 1150-2849) with a fixed frame: `jv_vid`, consent, pixels, UTM capture, the lead modal posting to `/api/public/lead`, the cart link with bump, discount, currency and UTMs, A/B split, exit intent, sticky bar, reviews wall. Fifteen test files pin that renderer.

## Decisions

1. **Extend Jourvance's model, borrow Aura's editor ideas, do not adopt the hub's landing
   service.** The page stays a `landing-page` journey node and goes through the existing
   publish pipeline (addresses, fingerprints, upsell and thank-you linkage, domains, every
   pinned test). A page without `builder` renders exactly as today.
2. **Elementor-class model from day one:** `page.builder = { version, theme, sections[] }`,
   section → columns[] → widgets[], one optional nested "inner section" level inside a column.
   Every node carries `id`, `kind`, `type` (widgets), `props`, and `style` with `desktop`,
   `tablet?`, `mobile?` layers that cascade desktop → tablet → mobile. Style keys: padding,
   margin, background (colour, image, focal point, overlay), border (width, colour, radius),
   shadow, typography (family, size, weight, line height, letter spacing, align, colour),
   width and alignment, min height, visibility per device, custom class. Theme: colours, two
   fonts, radius, spacing scale, button style, container width.
3. **ONE renderer, plain ESM JavaScript**, at `src/lib/pageBuilder/render.mjs` with a
   `render.d.mts` beside it, imported by the Express server for `/p/*` and by the editor's
   canvas. Render's Node version is unpinned, so nothing the server imports at runtime is
   TypeScript. Per-device styles become scoped CSS with `max-width` media queries at 1024 and
   640; every colour, font and spacing value is validated before it reaches CSS; HTML embeds
   are sanitised (no script, no event handlers, no `javascript:`); embeds are allowlisted
   (YouTube, Vimeo) because the Sentinel's `frame-src` is closed.
4. **The Jourvance frame stays fixed around the blocks:** tracking, consent, pixels, UTM
   capture, exit intent, sticky bar, A/B, head tags. Commerce becomes widgets that reuse
   today's fragments: product hero, checkout button, order bump, lead form, reviews wall,
   countdown, stock count, trust badge. The lead widget posts the exact `/api/public/lead`
   payload the modal posts today.
5. **Canvas in a Shadow DOM, not an iframe.** `frame-ancestors 'none'` forbids framing `/p/`,
   and `@dnd-kit` cannot drop across an iframe boundary, which is why Aura's palette drag is
   dead. A shadow root isolates page CSS from the cockpit's and keeps drop zones, selection
   outlines and inline editing in one document. The canvas renders the SAME HTML string the
   server publishes, so the preview is the page.
6. **Drag and drop with `@dnd-kit`** (core, sortable, utilities; MIT): palette → canvas insert
   at a drop zone, reorder sections, columns and widgets, move a widget between columns,
   keyboard sensor on, announcements for screen readers.
7. **Editor state:** 50-step undo and redo, autosave into the node through the existing
   journey editing hooks (never a second save path), dirty chip, Escape and keyboard rules
   from `JOURNEY_UI_HANDOFF.md`. Saved sections and templates live in the hub app store over
   the app key (`hub.appStore`), never in localStorage, so they follow the merchant.
8. **Migration:** "Convert to builder" maps today's flat fields into a default section list
   (hero with headline, subhead, bullets, button; product and checkout; reviews; countdown;
   trust) and sets `builder`. Reversible until the first publish of the builder page.
9. **No em dash in generated copy** (AI rewrite in the inspector goes through
   `cleanModelStrings`). Every rule in `CLAUDE.md` applies.

## Waves

Each wave: agents read `.claude/rules/truth-protocol.md` and this file; every new test is
seen red under a planted fault; `npx tsc --noEmit`, `npm test`, `npx vite build` and the
sandboxed boot (`scratchpad/run-check.mjs`) run before hand-back; evidence labelled.

### Wave 0, foundation (Opus)

- `src/types/pageBuilder.ts`: the document, node, style, theme types; widget prop types.
- `src/lib/pageBuilder/model.mjs` (+ `.d.mts`): `createEmptyPage`, `validateBuilderDoc`
  (answers problems by path, never throws), `migrateLegacyPage(PageNodeData)`, `resolveStyle
  (node, device)` (the cascade), `walk`, `findNode`, `insertNode`, `moveNode`, `removeNode`,
  `duplicateNode`, id minting, `WIDGET_REGISTRY` (type, label, group, default props, default
  style, which props are inline-editable).
- `PageNodeData.builder?: BuilderDoc` added; nothing else in the node changes.
- `LANDING_BUILDER_DESIGN.md`: the JSON of a real page, the renderer contract, the CSS
  scoping rule, the drop-zone rules, the inspector field schema per widget, the a11y rules.
- Tests: `page-builder-model.test.mjs` (validation refuses every bad shape with a path; the
  cascade; every tree op keeps ids unique and the tree valid; migration of a sample node
  carries every field that is rendered today, pinned against `pagePreviewCopy.ts`).

Acceptance: tests green and seen red; tsc 0; `npm test` count only grows.

### Wave 1, renderer and publish (two Sonnet agents in parallel)

- **1a, renderer:** `render.mjs` renders a `BuilderDoc` to `{ html, css }`; widgets v1:
  heading, text (markdown subset), image, button, spacer, divider, columns, video (allowlist),
  icon list, testimonials, FAQ, countdown, HTML embed (sanitised), lead form, product hero,
  checkout button, order bump, reviews wall, stock count, trust badge. Golden tests per
  widget; per-device CSS pinned; sanitiser pinned with the XSS fixtures from
  `public-inline-script.test.mjs`.
- **1b, publish and frame:** a branch in `publicRoutes.mjs` renders a page that has `builder`
  with the fixed frame around it; the lead widget's payload equals the modal's; a legacy page
  renders byte-identical (snapshot taken BEFORE the change); the publish route carries
  `builder` into the public record; **the pixel origins** (`connect.facebook.net`,
  `analytics.tiktok.com`, `www.googletagmanager.com`) go on the Sentinel's `extraScriptSrc`
  in `server.mjs`, pinned, because the policy committed on 2026-10-07 blocks them (seen in
  the renderer at `publicRoutes.mjs` 1297-1321, not yet deployed).

Acceptance: all fifteen renderer suites green; new golden tests; a sandboxed boot serves a
builder page at `/p/<slug>` and Chrome shows the widgets with no CSP violation.

### Wave 2, the editor (Opus for the core, Sonnet for panels)

- `src/components/builder/`: `BuilderShell` (full-screen from PageEditor's "Open builder"),
  `BuilderCanvas` (shadow root, hover and selection outlines, drop zones, inline text edit),
  `BuilderPalette` (widgets by group, drag or click to add), `BuilderOutline` (tree, sortable),
  `BuilderInspector` (Content, Style, Advanced; device switch; style edits land on the active
  device layer), `builderState.ts` (reducer, undo, redo, autosave through the node).
- `@dnd-kit` added. Keyboard: Tab to a node, Enter to select, arrows to move, Delete, ⌘Z/⌘⇧Z.
- "Convert to builder" and "Back to simple editor" (until first builder publish).
- Tests: reducer and undo; drop-zone resolution; a11y source pins in the style of
  `a11y-drawers.test.mjs`; a Playwright check (`scripts/builder-browser-check.mjs`): open the
  builder, drag a heading from the palette into a column, reorder two sections, set mobile
  padding, publish, fetch `/p/<slug>` and assert the media query and the order.

### Wave 3, library and polish (Sonnet)

- Templates (ported from the hub's packs, Jourvance commerce variants), saved sections in the
  hub app store, copy and paste of nodes, global styles panel, revision list (last 20
  publishes), per-widget AI rewrite through `cleanModelStrings`.
- `design-review` and `accessibility-reviewer` passes; fix round.
- Docs: `JOURNEY_UI_HANDOFF.md` section, `CLIENT_UI.md`-style notes here, audit entry.

## Open questions for the owner (answered by default as written)

- Hub-hosted pages (`hub.landing.*`) stay unused: the page is the journey's. Default yes.
- Breakpoints 1024 and 640. Default yes.
- Fonts: Google Fonts only (already allowed by the CSP). Default yes.

## Status

| Wave | State | Evidence |
|---|---|---|
| Survey | done 2026-10-08 | audit entry |
| 0 | done 2026-10-08 | audit entry; 56 model tests; design doc |
| 1a / 1b | running | |
| 2 | queued | |
| 3 | queued | |
