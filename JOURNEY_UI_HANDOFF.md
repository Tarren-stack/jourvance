# Journey UI backlog: handoff plan

Written 2026-09-30 by the Claude Code session that built the journey map backlog (session 7e3d12f8). Read this first, then the backlog doc: https://claude.ai/code/artifact/81b41690-17eb-41fa-9efc-744e82c1eb5a

## Where things stand

All 32 backlog items and follow-ups F1 to F4 are built and verified. **None of it is committed.** Verified on 2026-09-30:

- `npx tsc --noEmit`: clean.
- `node --test *.test.mjs`: 1,746 tests, 1,742 pass, 0 fail, 3 skipped (live-server tests), 1 todo (item A below).
- `CHECK_CANVAS_PORT=5580 npm run check:canvas`: exit 0, 16 scenarios, 24 of 24 keyboard checks.
- `A11Y_PORT=5581 npm run check:a11y`: exit 0.

Durable copies of the finding files (every earlier item with evidence and acceptance criteria) and the item A diff are in `.autoclaw/orchestrator/comms/handoffs/journey-ui-backlog/`. The `/private/tmp` scratch paths named inside them may be gone.

## Step 1: ask the owner about the commit

The owner has not approved a commit. Ask first. Recommended: commit the finished work now, then do the items below as a follow-up commit.

Scope the commit with care. `git status` shows about 298 changed or new files, and some were already modified before this work started (for example `drips.json` and `JOURVANCE_RUNNING_AUDIT.md`). Review `git diff --stat` with the owner and leave out anything they do not recognise. Never commit `.env`, `dist/` or the gitignored strategy docs.

## Step 2: the remaining items, in order

### A. The + Before / + Next buttons still cover badges and line numbers (major)

- **Symptom.** At 390px and 768px after selecting a card, and on blueprint 6 at 1280 and 1440, the + Before / + Next row overlaps a design badge or a line caption.
- **What exists.** `src/lib/edgeLabelLayout.ts` `placeStepAdd` already treats badges and captions as obstacles and returns "hide" when no spot is clear. The wiring that honours "hide" is a ready diff: `.autoclaw/orchestrator/comms/handoffs/journey-ui-backlog/u10-JourneyCanvas.diff`. It is not applied, and `edge-label-layout.test.mjs` has a `todo` test waiting for it.
- **Decision.** The owner delegated these calls, and best practice is option A. Hiding the row must not remove the only way to add a step there.
- **Fix.**
  1. Add "Add step before" and "Add step after" actions to the step panel (`src/components/drawers/StepConnections.tsx`). Reuse the existing add-step path in `src/lib/addStep.ts`.
  2. Apply the diff.
  3. Remove the `todo` flag.
- **Done when.** On the default map and bp6 at 390, 768, 1280 and 1440, at fit and after tapping a card, no + button overlaps a caption, badge, card, handle or toolbar (measure it). A step can still be added before or after from the panel, by keyboard too. `check:canvas` and `check:a11y` still exit 0.

### B. Email Studio inserts invented products and prices (major, pre-existing)

- **Symptom.** `src/components/campaign/EmailBlocks.tsx` (about lines 390 to 415) holds a sample product list, for example "Silk Peptide Restorative Serum", "Velvet Botanical Night Balm", "VIP Favorite" and "Award Winner" badges, prices, and jourvance.com/r/ links. The finding also names `src/lib/offerPresets.ts`, `SequenceEditor.tsx` and `HubEmailSuite.tsx`.
- **House rule.** Never put copy, products, prices, codes or claims the merchant did not enter into a merchant's email or page.
- **Fix.** Product blocks start empty with placeholder hints, or pull the merchant's real Shopify products when a store is connected. Offer presets carry no codes or amounts. grep for every sample name and remove each one.
- **Done when.** No email block, preset or preview contains a product, price, badge or link the merchant did not set (grep plus a unit test).

### C. The journey toolbar takes three rows at 390px when the save status reads "Out of space"

- **Symptom.** The row is 79px (two rows) at 360 to 389px, but 115px (three rows) at 390 to 395px when the status is "Out of space". Publish then sits alone on row 3.
- **Repro.** Make `localStorage.setItem` throw `QuotaExceededError` on the jourvance keys, edit the journey name, and press Save.
- **Fix.** In `src/components/toolbar/CanvasHeader.tsx`, give the long status text a compact form in that band (a short word, with the full sentence as its accessible name and title). Extend `header-row-fit.test.mjs`.
- **Done when.** At 360 to 399px the toolbar is two rows in every save state.

### D. Smaller fixes (each independent)

1. **Delete key.** It does not delete a selected step; only Backspace does, although the code comment says both. Set React Flow's `deleteKeyCode` to both keys in `JourneyCanvas.tsx`. Keep the undo notice.
2. **Connecting notice punctuation.** The notice reads "Lead form: Where should we reach you?, or press Escape to cancel." In `JourneyCanvas.tsx`, use `nameInSentence` / `endSentence` from `src/lib/stepNames.ts`, as the other sentences do.
3. **Minimap on phones.** On bp6 at 390px it covers 16 to 42% of a selected card and hides its output dot. Hide or collapse the MiniMap below 480px, or keep the selected card clear of it in the T06 pan (`JourneyCanvas.tsx`, `src/lib/tapReveal.ts`).
4. **Pan overshoot.** At 390px the phone pan (T06) moves the selected card under the toolbar for about 0.4 seconds before it settles. Pan to the final position in one move.
5. **Notice over the step panel.** At 390px the docked connecting notice covers the step panel's fields. Dock it where it covers neither the card nor the panel's first field, or shorten it.
6. **Top edge of the ad card.** On a touch screen, a tap just inside the ad card's top edge opens Check design instead of selecting the card. Make the design badge's hit area stop at its drawn size (`AdNode.tsx`, `DesignIssueBadge.tsx`).
7. **Page views read 0 after a failed read.** When the event log cannot be read, page views show 0 because `loadEvents` (`server.mjs` / `hub-storage.mjs`) never reports a failure. Make it report the failure so the route answers null ("Unavailable"). Test the route on a bare Express app.
8. **Flaky test.** `journey-save-route.test.mjs` failed once in the F1 409 test with an empty response body. Find the race, for example a server not yet listening or a missing await.
9. **Uncaught errors with no API.** SignupForms, EmailInbox, AudienceDesk, SendingSetup and KlaviyoSync throw an uncaught "Failed to fetch" when `/api` is unreachable. Wrap each load in try/catch and fall back to the view's existing error state.
10. **Invented UTM values.** `generateAdCopyText` in `src/lib/funnelExportGenerators.ts` still adds its own `utm_content` and `utm_term` values (hook_angle_1, customer_journey_builder, problem_agitation). Leave them out unless the user set them.

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
  2. Follow the AutoClaw protocol: write a claim file in `.autoclaw/orchestrator/comms/claims/`, a `task_complete` in `inboxes/shared/`, and a `review_request` to Antigravity. The previous session's handoff note is `.autoclaw/orchestrator/comms/handoffs/journey-ui-backlog-7e3d12f8.json`, and its claim has been released.
