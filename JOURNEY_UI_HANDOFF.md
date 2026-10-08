# Journey UI backlog: handoff plan

Written 2026-09-30 by the Claude Code session that built the journey map backlog (session 7e3d12f8). Read this first, then the [backlog doc](https://claude.ai/code/artifact/81b41690-17eb-41fa-9efc-744e82c1eb5a).

## Where things stand

All 32 backlog items and follow-ups F1 to F4 are built and verified. **None of it is committed.** Verified on 2026-09-30:

- `npx tsc --noEmit`: clean.
- `node --test *.test.mjs`: 1,746 tests, 1,742 pass, 0 fail, 3 skipped (live-server tests), 1 todo (item A below).
- `CHECK_CANVAS_PORT=5580 npm run check:canvas`: exit 0, 16 scenarios, 24 of 24 keyboard checks.
- `A11Y_PORT=5581 npm run check:a11y`: exit 0.

## Step 1: already done

The owner approved it, and all of this work was committed and pushed to `main` on 2026-09-30 as `924d837`. The untracked `shots/` folder (test screenshots) was left out on purpose. Commit the items below as follow-up commits, and only when the owner asks.

## Step 2: completed and verified items

### A. The + Before / + Next buttons still cover badges and line numbers (major) - DONE
- Added "Add step before" and "Add step after" actions to StepConnections drawer panel.
- Wired placeStepAdd obstacle avoidance and "hide" placement in JourneyCanvas.
- Verified in `edge-label-layout.test.mjs` (0 todos remaining), `step-dock.test.mjs`, `check:canvas`, and `check:a11y`.

### B. Email Studio inserts invented products and prices (major, pre-existing) - DONE
- Removed sample product names ("Silk Peptide Restorative Serum", "Velvet Botanical Night Balm", etc.), badges ("VIP Favorite", "Award Winner"), prices, and demo links from `EmailBlocks.tsx` and `offerPresets.ts`.
- Blocks now start empty with clean placeholders or real connected Shopify products.
- Verified with `offer-presets.test.mjs`.

### C. The journey toolbar takes three rows at 390px when the save status reads "Out of space" - DONE
- Added compact label `'No space'` when `saveStatus.action === 'open-library'` in `CanvasHeader.tsx` while preserving the full accessible description.
- Verified with `header-row-fit.test.mjs` (fits two rows across 360px to 399px).

### D. Smaller fixes (each independent) - ALL DONE
1. **Delete key.** Added `deleteKeyCode={['Backspace', 'Delete']}` to `<ReactFlow>` in `JourneyCanvas.tsx`.
2. **Connecting notice punctuation.** Formatted step names using `nameInSentence` in `JourneyCanvas.tsx` to handle question titles cleanly.
3. **Minimap on phones.** Added media query in `index.css` hiding `.react-flow__minimap` below 480px.
4. **Pan overshoot.** Cleaned `scrollBoxOf` in `JourneyCanvas.tsx` so `FocusSelectedStep` immediately recognizes phone scrollers without racing layout heights.
5. **Notice over the step panel.** Adjusted connecting notice typography (11px on small viewports) so it stays compact (~36px) and does not cover panel fields.
6. **Top edge of the ad card.** In `DesignIssueBadge.tsx`, bounded click handling to `getBoundingClientRect()` so touch-snapped clicks outside the badge bubble to the node and select the card.
7. **Page views read 0 after a failed read.** In `hub-storage.mjs` and `server.mjs`, `loadEvents` reports unreadable event logs; in `analyticsRoutes.mjs`, `POST /api/funnel/stats` catches failures and responds 503 (`Unavailable`), tested in `funnel-stats.test.mjs`.
8. **Flaky test.** Explicitly bound `serve()` to `127.0.0.1`, set `Connection: close`, and called `server.closeAllConnections?.()` in `journey-save-route.test.mjs`.
9. **Uncaught errors with no API.** Wrapped initial fetch calls in `SignupForms.tsx`, `EmailInbox.tsx`, `AudienceDesk.tsx`, `SendingSetup.tsx`, and `KlaviyoSync.tsx` in try/catch falling back to error states.
10. **Invented UTM values.** In `src/lib/funnelExportGenerators.ts`, removed hardcoded UTM values (`hook_angle_1`, `customer_journey_builder`, `problem_agitation`) unless explicitly configured by the user, verified in `add-step.test.mjs`.

### E. Leave as is unless the owner asks

- **bp6 step names at phone zoom.** Some are wider than their card at 13px, so the first word ends in an ellipsis. The full name is in the accessible name and the step panel. Accept it; the other option is shortening the blueprint's sample names.
- **ecom blueprint sample offers** (bp6 COMPLETE10 and others). Blueprints are samples, and Check design lists every sample code and claim (R23).
- **Hub copy of the domain registry.** `verifyDomainOwnership` in `server.mjs` mirrors the record to the hub store before the route adds `journeyId`, so only `domains.json` carries the journey tie.
- **Dead client code.** `shopifyClient.ts` `verifyCustomDomain` has no callers.

## Page builder

What it is: a full-screen visual editor for a landing page step, opened from "Open page builder" in the step panel. It edits a document (sections, columns, widgets, a page theme) and the server publishes the SAME HTML the editor draws. Design: `LANDING_BUILDER_DESIGN.md`. Plan and status: `LANDING_BUILDER_PLAN.md`.

### Files

- `src/lib/pageBuilder/model.mjs` (+ `.d.mts`): the document model, validator, theme defaults, `THEME_BUTTON_SHADOWS`, `THEME_NUMBER_RANGES`. `render.mjs`: the renderer. `templates.mjs` (+ `.d.mts`): eight page templates in four groups (Sell, Capture, Proof, Launch). Types in `src/types/pageBuilder.ts`.
- `src/components/builder/`: `BuilderShell` (frame, left panel switch Blocks / Templates / History, autosave), `BuilderCanvas`, `BuilderPalette` (Saved group first), `BuilderInspector`, `BuilderThemePanel` (Global styles), `BuilderTemplates`, `BuilderHistory`, `BuilderRewrite`, and `builderState.ts` (the reducer).
- Server: `server/routes/builderLibraryRoutes.mjs` (saved sections), `server/builderRevisions.mjs` and the hook in `server/routes/journeyRoutes.mjs` (revisions), the `POST /api/ai/builder-rewrite` route in `server/routes/aiJourneyRoutes.mjs`.
- Clients: `src/lib/builderLibraryClient.ts`, `builderRevisionsClient.ts`, `builderRewriteClient.ts`.

### Keyboard rules

- Every key the builder acts on stops inside it. Delete in the builder must never reach the journey map's own Delete handler (it once deleted the landing page step). Keep that guard when adding a key.
- Ctrl/Cmd+C, X and V copy, cut and paste the selected block. They are ignored while typing in a field. Paste works with nothing selected (end of the page) and is dimmed and refused with the model's reason when the nest is illegal. Each paste or cut is one undo step; copy touches neither the page nor the history.
- Escape in an inline edit keeps the text; Control Z takes it back. Escape in the Save section form cancels it.
- The toolbar label hides under 480px so the toolbar stays on one row at 390px; its aria-label still names the block.

### Saved sections, revisions, rewrite

- Saved sections: one hub doc per entry (`builderlib.<safe uid>.<id>`), listed through `listJourneyDocs`, with a local cache in `builder_library.json` (gitignored). Cap 100 entries, 200 KB each. A save the hub refused answers success with `durable:false` and the reason; the shell says so. Section saves use an inline named form, not `window.prompt`.
- Revisions: the last 20 publishes per page, kept in the publish log store under the id `<journeyId>#builder-revisions` (a separate document, because publish and unpublish rebuild the main log and would drop the field). `rev` is the publish number. Restore loads the old document as ONE undo step (`loadDoc`), so it can be undone. The shell reads `journeyId` and `nodeId` from the address (`parseAppLocation`) unless `PageEditor` passes them.
- Rewrite with AI: heading, text, button label and icon list items. The answer goes through `cleanModelStrings` and is applied as one undoable edit. With no hub key the route answers 503 and the control says AI copy is off; there is no template fallback.
- Global styles: eleven optional theme keys. A rule is written only when the value differs from `DEFAULT_THEME`, so a page that sets none renders byte for byte as before.

### Motion

- Theme: `theme.motion` is `none`, `subtle` or `cinematic`; absent means none, so a page that sets nothing renders byte for byte as before. One table, `MOTION_PRESETS` in `src/lib/pageBuilder/model.mjs`, holds the numbers (subtle: 240ms reveal, 180ms interactions; cinematic: 560ms and 220ms; press 80ms). The renderer writes them as five `--jvb-motion-*` custom properties.
- Sections: `props.reveal` is `inherit`, `rise`, `fade` or `none`; the first section never animates. The frame script (`server/routes/publicBuilderScript.mjs`) adds `jvb-motion-on` to the root only when the visitor has no reduced-motion preference and IntersectionObserver exists, then adds `jvb-in` on scroll. Nothing is hidden without script, in print, or under reduced motion. Keep every new published rule inside `@media screen and (prefers-reduced-motion: no-preference)`.
- Editor: `src/components/builder/motion.ts` (selection, drop zone, drop flash, device fade, outline slide on reorder; classes `jv-motion-*`, keyframes `jvbe-*`). "Reduce motion in the editor" is kept per browser in localStorage (`jv_builder_reduce_motion`). The canvas marks reveal sections `jvb-in` (`REVEAL_SELECTOR`, `REVEALED_CLASS` in `BuilderCanvas.tsx`) so a redraw never replays an entrance; Preview motion plays one.
- Known gaps (see the audit, 2026-10-08 motion pass): the exit-intent drawer still slides under reduced motion although the hints say visitors see none; the editor preference does not reach the page's own motion inside the canvas shadow root; a no-scroll full-page capture shows lower sections blank; `builder-serve-browser-check.mjs` failed 2 of 46 motion checks on the last run.
- Tests: `page-builder-motion-{render,editor,fixes,fix2,integration}.test.mjs` at the repo root, `scripts/builder-motion-page-check.mjs` (published page, Chrome), 40 steps in `builder-browser-check.mjs`, 46 in `builder-serve-browser-check.mjs`.

### Tests and the browser check

- Wave 3 suites at the repo root: `page-builder-templates`, `-theme`, `-clipboard`, `-revisions`, `-load-and-saved`, plus `builder-library-route`, `builder-rewrite-route` and the `builder-wave3-*` fix suites. Run with `node --test <file>`.
- `node scripts/builder-browser-check.mjs`: 28 steps in Chrome, including templates, saved section, clipboard, history, global style and AI rewrite. It answers the library, revisions and rewrite routes with recorded JSON in the routes' own shapes, so it does not prove the real server routes.
- The unit tests send saves one at a time; they do not cover concurrent saves or a refused publish-log write (see the audit, 2026-10-08 Wave 3).

## Operator step for the owner

Set `REVIEW_SECRET` in the deployed environment. Review links sent before this change stop working.

## Rules for whoever picks this up

- Never start `server.mjs` or anything that loads `.env`: it holds a live production `HUB_API_KEY`. Test server routes by mounting the route module on a bare Express app; `journey-publish.test.mjs` shows how.
- Browser checks use Playwright from `/Users/tarrenmunoz/antigravity/Local-AI-App-Builder/node_modules/playwright/index.mjs` with Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Abort every non-localhost request and every `/api` request (or stub `/api`). A signed-out journey lives in localStorage `jourvance_active_project`. Avoid port 5000 (macOS AirPlay).
- Node 26 strips TypeScript types. A test may import a `.ts` module only if that module's own value imports are type-only or carry a `.ts` extension.
- House rules:
  - No em dash or spaced en dash in user-facing text.
  - "Unavailable" rather than 0 for unmeasured numbers.
  - Never invent copy, offers, codes or prices.
  - Retry only when retrying can help.
  - 11px minimum text, and no horizontal scroll at 390px.
  - Keyboard and screen-reader users can do everything.
- No new npm dependency without owner sign-off. Commit only when the owner asks.
- When an item ships:
  1. Set its row in the backlog doc to Done and add a change log row. The status dropdown enum is `a7de1590-f954`, index 2 = Done. Remove the item from the doc's "Still open" list.
