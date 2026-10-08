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
