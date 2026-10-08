# Jourvance running audit

Living notes. Newest pass is at the top. Add a dated section when something is checked again. Do not mark an item fixed unless the code or a test run shows it.

Checked: 2026-10-08. DEPLOYED: jourvance.com serves c137590 (the lead-capture fix, the Sentinel, the page builder Waves 0 to 3). Read the newest section first.

## 2026-10-08 — Deployed: c137590 is live on jourvance.com

The push ran into one remote commit the local history lacked, `a650b87` "boot again and hold fixture mail", the deploy that was live. Its only change, the fixture-mail block in `server.mjs`, was already in the local tree byte for byte, so the merge keeps the local file (the textual merge had declared the same constant twice and did not parse). Merged in a separate worktree so the running motion agents were not disturbed, verified there (`npx tsc --noEmit` exit 0; `route-context-gate` and `sentinel-adoption` 8 passed, 0 failed; the cockpit built; a sandboxed boot answered 200 with no page error and no policy violation), and pushed as `c137590`.

Render, asked through its API: `build_in_progress`, then `update_in_progress`, then `live c137590` with `a650b87` deactivated. The two deploys before `a650b87` had failed, so this was watched rather than assumed.

Live checks by the main session on jourvance.com after the swap: `/__sentinel/status` answers with the six patches (that route exists only in the new code); the Content-Security-Policy header carries `connect.facebook.net`, `analytics.tiktok.com` and `www.googletagmanager.com` in `script-src`, with `x-frame-options: DENY` and `nosniff`; `/api/x/../health` is 403; `POST /api/public/lead` with an empty body answers 400 in 0.14 s. The full lead path (a lead that reaches `noteSegmentChanges`) was not posted live, because it would write a record into the owner's account; it is pinned by `public-lead-route-answers.test.mjs`.

Known on the worktree: `seeded-codes.test.mjs` reads the gitignored `drips.json` directly and fails on any checkout without it. It passes in the main tree. Not fixed.

## 2026-10-08: The page builder, Wave 3: templates, saved sections, clipboard, history, global styles, rewrite

Wave 3 is built, but two reviewers refuted it: review found defects that are NOT fixed in this section.

**Defects found by review, open (reproduced by the adversarial reviewer on a scratchpad copy of the real `server.mjs` with a mock hub, not re-run by me):**

- Medium: the saved-section cap of 100 can be beaten by concurrent saves. The route lists, checks `own.length >= 100`, then writes. 95 seeded plus 20 concurrent POSTs gave 115; 95 plus 40 with 400 ms list latency gave 135. Sequential saves stop at 100. The route test only sends saves one at a time. `server/routes/builderLibraryRoutes.mjs` near line 100.
- Medium: a publish answers success when the hub refused the publish-log write (`savePublishLog` results are ignored at `server/routes/journeyRoutes.mjs` lines 647 and 720; the ignore predates Wave 3). After a fresh disk the revision number repeats and `addRevisions` replaces that version in history: VERSION-TWO was silently lost to VERSION-THREE.
- Medium (UI review, read from code, not driven): a failed library delete shows as a green success note (`BuilderShell.tsx` near line 245); the partial-library notice shows the server's raw reason with "journey store" and "cache" wording (`BuilderPalette.tsx` near line 134).
- Low: delete ignores `durable:false`; History says "with a B version" unexplained and the Restore busy state is not announced; the rewrite budget map clears for everyone past 5000 uids; `dev-test-token` signs in when `NODE_ENV` is not production (whether the live service sets it is UNKNOWN); a body over 1 MB gets Express's HTML 413; `cleanModelStrings` can leave a trailing comma after a final em dash.
- Held: auth and tenancy on all new routes (401 without a token, cross-merchant reads and deletes 404), the model text cleaning, the 30 an hour rewrite budget, `__proto__` node ids.

**What changed:** eight page templates; saved sections (hub doc per entry, local cache); copy, cut and paste; eleven global style theme keys with a panel; the last 20 publishes as revisions with an undoable Restore; Rewrite with AI on four text kinds. Files and storage are in `JOURNEY_UI_HANDOFF.md`, "Page builder".

### Evidence

- Reported by the integration agent, not re-run by me: `npx tsc --noEmit` exit 0; focused suites 502 of 502; `npm test` 2309 tests, 2306 passed, 0 failed, 3 skipped; `npx vite build` exit 0; browser check 28 of 28, exit 0. Two planted faults went red and were restored `cmp` identical: `if (false && problems.length)` in `loadDoc` (unit, 4 pass 1 fail) and `rev.rev + 1` in `BuilderHistory.tsx` (browser, 25 of 28).
- Reported by the runtime verifier, not re-run by me: `tsc` exit 0; `npm test` 2327 tests, 2324 passed, 0 failed, 3 skipped (the count differs from the integration agent's 2309 and the 2198 before; nobody explained the difference); `vite build` exit 0; browser check 28 of 28; route-context gate 3 of 3; no em dash in the builder files; sandboxed boot clean with one 401 console error, not traced.
- Reported by the adversarial reviewer: the three scratch attacks above, plus 23 of 23 existing route tests green while missing both medium defects.
- Reported by the design reviewer: findings read from code only; Chrome was not driven.
- Parallel Opus and Sonnet subagents were requested; the integration agent had no agent tool and worked alone. I (the docs writer) ran nothing; these notes were written from the reports.

### What the review rounds fixed, and what is left

The workflow ran two adversarial review rounds (tenancy and money, runtime, accessibility and copy), each followed by an Opus fix round. The docs agent wrote the section above before the second fix round, so its defect list is the list that was found, not the list that remains. Fix round 1 took the first round's findings (the jargon in the AI-off sentence, the missing delete control for saved sections, focus lost on save, on template replace and on retry, the prototype-key crash in the revisions routes, a delete that answered success after a failed hub remove, a publish that hid a failed revisions write, the revisions log id that a crafted journey id could collide with). Fix round 2 took eight of the second round's eleven (a failed delete shown as success, raw server reasons in the palette notice, the delete confirm ignoring `durable`, the "with a B version" wording and the unannounced Restore busy state, the library cap beatable by concurrent saves, a publish answering success when the publish-log write was refused). Left alone, each named by the reviewer and judged pre-existing and outside the Wave 3 files: the hourly AI budget map is cleared for every user once it holds 5,000 ids (`server/routes/authWorkspaceRoutes.mjs`); `dev-test-token` signs a request in whenever `NODE_ENV` is not production (same file). The main session probed the live site with that token on 2026-10-08: `/api/workspaces` and `/api/journeys` both answered 401, so it is not open on jourvance.com. The third leftover (Express's default 413 page) was judged not a defect.

### Evidence, main session, after the last fix round

- `npx tsc --noEmit` exit 0. `npm test` 2336 tests, 2333 passed, 0 failed, 3 skipped (2198 before Wave 3). `npx vite build` built. `route-context-gate.test.mjs` 3 passed. No em dash in the builder, page-builder, library or revisions files or the new tests.
- `node scripts/builder-browser-check.mjs`: 28 of 28 steps, 57 outside requests blocked, nothing reached a server. Driven: apply the Product drop template with its confirm and undo; save a section (with the honest "not to your account yet" note on the local fallback) and insert it from the palette with fresh ids; copy, paste, cut and toolbar paste; a global style changing the canvas gap; History restoring version 7 and undo bringing the page back; the AI-off sentence when the rewrite route answers 503.
- Screenshots `templates.png` (Templates view with thumbnails in Sell, Capture, Proof, Launch groups) and `history.png` (History view with a restorable version and the global styles panel) read.

### Left open

- Not reviewed for contrast or focus after fix round 2: the Templates and History views and the save form; the toolbar with a section selected at 390px was not measured.
- The 57 blocked outside requests in the browser check are not itemised.
- The saved-section store was not exercised against a real hub; its hub paths are covered through the stubbed context and the route gate only.
- The two pre-existing findings above are not fixed. The budget-map clear is a fairness bug under load; the development token is closed on the live site by `NODE_ENV`, which is not pinned anywhere in this repo.
- Not deployed. The lead-capture fix (4008608) is still not deployed either.

## 2026-10-08: The page builder editor, polish pass

Wave 2 polish, done by a Sonnet agent against the list the previous section left open.

**Fixed, each found by driving it in Chrome:** the desktop canvas is drawn at 1280 and scaled into the frame (tablet 1024 scaled, mobile 390 as it is), with the editor's marks outside the scaled layer so no scale is divided out; a pointer drag from the canvas grip moved nothing, because the toolbar (and so the drag's source) was removed when the drag began and the drop found no block (the toolbar is hidden now, not removed); the selection toolbar stuck out of a 390px window and covered the text of a short block (it keeps inside the frame and drops below a short block); Escape in an inline edit keeps the text (design section 7) and Control Z takes it back; the empty-block hints were 2.7 to 1 on a white page (opaque backdrop now); refusals said "Theme containerWidth", "finite number" and "theme.primary" (the theme panel's own names and plain words now); layout names read "33 / 67" (now "2 columns, narrow first (33 / 67)"); `acorn` is a devDependency (8.19.0) so the route-context gate no longer finds it only in the hub checkout; blueprint cards are named groups and each button names its blueprint (they were never inert `div`s: the card holds a real button, so a card cannot also be a button).

**Production policy:** the builder was opened under the real Content-Security-Policy on a sandboxed boot of `server.mjs` (no hub key). `style-src 'self' 'unsafe-inline'` allows the shadow root's `<style>`: 0 violations, the shadow stylesheet applied (button background read from it, then changed). Nothing was widened.

### Evidence

Main session re-ran: `npx tsc --noEmit` exit 0; `npm test` 2198 tests, 2195 passed, 0 failed, 3 skipped (2165 before, plus 33 new in three files); `npx vite build` built; no em dash in the builder files; the two screenshots (desktop scaled at about 0.62 with the selection outline on its block; a 390px window with Desktop chosen, toolbar inside the window) read. Reported by the agent, not re-run here: `scripts/builder-browser-check.mjs` 22 of 22 steps (was 8); the sandboxed boot under the real policy with 0 violations and an http image as the positive control; four planted faults each turning a unit test or a browser step red, restored `cmp` identical.

### Not verified

- Google Fonts and product images in the canvas: every outside request is blocked by the check, so they were never fetched. The policy allows `fonts.googleapis.com`; the header was read, the font was not loaded.
- The deploy: nothing here is deployed.

## 2026-10-08 — The page builder editor

Wave 2 core, built by an Opus agent against `LANDING_BUILDER_DESIGN.md` sections 4 to 7. `src/components/builder/`: a reducer with 50 steps of undo and redo whose style edits land only on the active device layer; a Shadow DOM canvas that draws the SAME HTML the server publishes, with hover and selection overlays, drop zones, a selection toolbar and inline text editing; `@dnd-kit` for the palette, the canvas and the outline with keyboard pick-up and screen reader announcements; palette, outline, inspector (Content, Style with the device switch and "Set for mobile only" hints, Advanced), theme panel; a full-screen shell with autosave through the node's own save callback. "Open page builder" and "Convert to page builder" in the step panel, with "Back to simple editor" behind a confirm (publish state does not say whether the live page has a builder layout, so the button is always shown). Seven section layouts in the palette, because the design had no way to add a section.

**Found by driving it in Chrome, fixed, and pinned:** Delete inside the builder deleted the landing page STEP. React redraws inside the keypress, the focused outline row leaves the page, and the journey map's own Delete handler no longer sees the guard around it. Every key the builder acts on now stops inside it and focus lost to a redraw returns to the same row. Also: Space in an edited button label pressed the button, so an edited button is swapped for a span while editing.

### Evidence

- Main session re-ran: `npx tsc --noEmit` exit 0; the three editor suites 105 passed, 0 failed; `npm test` 2165 tests, 2162 passed, 0 failed, 3 skipped; `npx vite build` built; no em dash in the builder files. Screenshots `1-builder-open` and `4-mobile-padding` read.
- Reported by the agent: `scripts/builder-browser-check.mjs` 8 of 8 steps in Chrome (open and convert, drag a heading into a column, reorder two sections, set mobile padding 8 with desktop still 36, undo twice, close and read the saved document back from localStorage, the Delete key guard); six planted faults each turned a test or the browser check red, including "Delete in the builder deleted the journey step"; the nine suites that pin PageEditor stayed 176 of 176.
- Dependency: `@dnd-kit/core` 6.3.1, `sortable` 10.0.0, `utilities` 3.2.2, MIT.

### Left for the polish pass

- With Desktop chosen the canvas is about 790px wide at 1440, under the 1024 tablet breakpoint, so the desktop view is drawn squeezed; a narrow window cuts the Continue label.
- Not driven in a browser: the theme panel, list, colour and date fields, hide-on switches, a pointer drag from the canvas grip, a dnd-kit keyboard drag of an outline row, a widget dropped between sections, Google Fonts and product images in the canvas (every outside request was blocked), the production policy around the canvas (`server.mjs` was never started by the agent).
- Inline edit Escape reverts (the task said so) where the design doc said keep; blur keeps.

## 2026-10-08 — Lead capture hung on every owned page since September 27, and thirteen routes with it

Found by the Wave 1b browser check, which posted a lead and never got an answer. `POST /api/public/lead` calls `noteSegmentChanges` in `server/routes/emailRoutes.mjs`, which calls `predictionAccount`, a function that lives in `server.mjs` and was never put on the context when the email routes were split out of the main file in commit `4d6b3c0` (2026-09-27). Express 4 does not answer a rejected async handler, so the visitor's form hung. The live deploy `a650b87` carries it: the file there uses the name twice and defines it nowhere (`git show`, main session).

A gate written for the bug class (`route-context-gate.test.mjs`, acorn with its own scope tracker, over every route module that reads a context) found fourteen such names in the email routes on the committed tree: `rememberAdminCatalog`, `cleanLibrary`, `cleanSteps`, `historicSpend`, `predictionLine`, `overlayPrediction`, `predictionAccount`, `enrollFlowsForTrigger`, `messageStatsFor`, `holdoutReport`, `cleanHoldout`, `smartSendConflict`, `assignSmartSend`, `sequenceRevenue`, plus one name the public routes destructure that the server never passed (harmless, never called). So the letter library, holdout, smart send, the segment entry flows and the attributed revenue readouts have been throwing at request time too. This is the same shape as `noteAttrMap` (crashed boot) and `loadBehaviorBag` (prediction refresh), the third and fourth times it bit.

### What changed

The fourteen names are on `emailCtx` in `server.mjs` and destructured in `emailRoutes.mjs` (33 lines, no refactor). `route-context-gate.test.mjs` fails on any function a route module calls that is not passed through its context, any destructured name the server does not pass, and any context key the server does not declare. `public-lead-route-answers.test.mjs` mounts the real email and public routes with the real context shape and requires a lead post to answer 2xx within two seconds.

### Evidence

- Main session: `node --check` on both files; the gate and the lead test 4 passed, 0 failed with the fix; with the two fixed files stashed (the committed tree) 2 passed, 2 failed, the gate naming the missing functions by line. Restored, diff identical.
- Reported by the Sonnet agent: `npm test` 2060 tests, 2057 passed, 0 failed, 3 skipped; sandboxed boot clean; the lead test before the fix failed with `ReferenceError: predictionAccount is not defined` and after it passed in 37 ms.
- Done by an agent, re-run here: the gate and the lead test. Not re-run here: the full suite (another agent is mid-build on the editor and the typecheck is red on its half-written files).

### Left open

- NOT DEPLOYED. jourvance.com is still serving `a650b87`. This commit on its own is worth a deploy before the builder.
- The gate needs `acorn`, found today at the hub checkout's `node_modules`; a standalone clone of this spoke would fail the gate's first test until `acorn` is a devDependency here. Not added, because another agent holds `package.json` right now.
- Only the lead path has a runtime test; the other thirteen names are held statically by the gate.

## 2026-10-08 — Landing page builder: survey, plan, Wave 0

The owner asked for the landing page editor to become a full drag-and-drop builder in the Elementor shape, built by Opus and Sonnet agents with the main session planning, reviewing and committing. An Opus survey (read-only) mapped Aura's builder (a port of the hub's portable landing builder: a flat list of 27 block types, a srcdoc iframe canvas, @dnd-kit, undo, autosave, no nesting, no per-device styles, two drag paths broken in code) against Jourvance's fixed-field editor and template renderer. The decisions are in `LANDING_BUILDER_PLAN.md`: extend Jourvance's own page model (the page stays a journey node and every pinned renderer test stays), an Elementor-class document (section, column, widget, per-device style layers, global theme), one plain-JavaScript renderer shared by the server and the editor's canvas, a Shadow DOM canvas instead of an iframe, @dnd-kit, saved sections in the hub app store.

**Wave 0 (Opus) landed the foundation:** `src/types/pageBuilder.ts`, `src/lib/pageBuilder/model.mjs` with its `.d.mts` (validation by path, the device cascade, tree operations that never mutate, migration of today's flat fields into widgets with every rendered field carried into exactly one prop, the widget registry with fallbacks pinned word for word to today's page), `builder?: BuilderDoc` on `PageNodeData`, and `LANDING_BUILDER_DESIGN.md` (the real page JSON generated by the code, the renderer contract, sanitiser rules, embed allowlist, drop-zone rules, inspector schema, keyboard rules, ten open questions with defaults). Decisions accepted from its report: conversion keeps today's one offer card as one section with a product column and a copy column; an empty headline converts to an empty heading, never to invented copy; a builder page serves version A only until A/B is designed; the frame binds the first product and checkout button in page order.

### Evidence

- Re-run by the main session: `npx tsc --noEmit` exit 0; `node --test page-builder-model.test.mjs` 56 passed, 0 failed; `npm test` 1857 tests, 1854 passed, 0 failed, 3 skipped (1801 before, plus 56).
- Reported by the Wave 0 agent, not re-planted here: five planted faults each turned the model test red (removeNode keeping the node, the duplicate-id check off, the seeded trust-badge filter off, a `__proto__` key slipping through a clone, an em dash in the design doc), each restore `cmp` identical; a `checkJs` pass with `@satisfies` showed `model.mjs` matches the types and a planted wrong default failed it.
- No em dash in any of the five new files (grep, main session).
- Nothing under `server/` changed; no dependency added; the renderer and the editor are not built yet.

### Found on the way

- `journey-save-route.test.mjs` F1 failed once under the full parallel run with "Unexpected end of JSON input" and passed 8 of 8 alone and on three further full runs. The agent read it as load flakiness: that test listens without the loopback bind and `Connection: close` the handoff applied to its sibling. Not fixed; worth the same fix.
- The `@satisfies` type check of `model.mjs` is not a gate in the repo; drift between the JavaScript and the types is unguarded until a tsconfig for it is added.

## 2026-10-08 — The rail is docked, and a blueprint shows its map before it loads

Two owner requests. The left rail floated 10px inside the workspace body as an absolutely positioned card over the studio, so its 64px (240px expanded) covered the left edge of whatever was open. It is a flex sibling now (`src/index.css` `.jv-workspace-row` / `.jv-workspace-main`): full height beside the toolbar and the studio, reserving its width at rest, hovered and pinned, so the column is laid out beside it and nothing is covered. The toolbar's own brand mark is hidden on desktop (`.jv-header-brand`) because the rail carries one; on a phone the rail is the same drawer it was. The Blueprints confirm prompt draws the funnel the blueprint builds (`src/lib/blueprintPreview.ts`, `src/components/modals/BlueprintPreviewMap.tsx`) above Replace and Create new. Steps are ranked left to right from the lines, so no two boxes overlap on any of the 74 shipped blueprints, and a loop back is a dashed return.

The preview was finished by a Sonnet subagent on the owner's instruction to orchestrate; its typecheck, suite, red run and browser run were re-run or re-read here before this entry.

### Evidence

- `npx tsc --noEmit` exited 0. `npm test`: 1801 tests, 1798 passed, 0 failed, 3 skipped (re-run by the main session).
- `blueprint-preview.test.mjs` (4 tests) was seen red with every rank forced to 0, then restored byte-identical (reported by the subagent, not re-planted here).
- Chrome on a sandboxed boot of `/canvas` at 1440x900: the rail is 64x900 at 0,0 and the toolbar-and-studio column starts at x=64; hovered, 240 and 240; the toolbar brand is `display: none`; at 390px the rail is hidden and the column starts at 0. Measured by `getBoundingClientRect`, screenshots read. Then: hover the rail, click Blueprints, click "Direct-to-Consumer Product Drop": the preview SVG is visible with 4 step boxes (the blueprint has 4 nodes) and its bottom edge (461) sits above the Replace (477) and Create new (542) buttons.

### Left on purpose, and found on the way

- The blueprint cards are clickable `div`s, not buttons, so they are not reachable from the keyboard. Found by the browser check's selector failing; not fixed in this pass.
- Only one blueprint was opened in the browser; the no-overlap rule is pinned by the test over all 74.
- Replace and Create new were not clicked; their behaviour is unchanged.

## 2026-10-07 — Truth protocol and hub rules, applied to the app

The owner asked for the app to be checked against `truth-protocol.md` and for every hub rule to be adopted. The protocol copies in `.claude/rules/` and `.agent/rules/` are byte-identical to the hub's. Neither they nor `CLAUDE.md` and `AGENTS.md` were tracked in git until this pass. Both agent files now carry the same "Hub rules this spoke adopts" block.

### What was out of order, and what changed

- **Four tests used an early return as a precondition** (`boot-safety` twice, `upsell-recovery`, `canvas-browser-check`), which the protocol's section 3 names: the runner counts a return as a pass. Each is a visible `t.skip(reason)` now, and the upsell file-backed half is its own test.
- **No Security Sentinel.** The hub's drop-in that every spoke vendors was absent: no CSP, no hardened headers, no rate limit, no posture report, and no `trust proxy` setting at all. `security-sentinel.js` is a byte copy of the hub's `sentinel-dist`, mounted after the body parser (the virtual-patch scan reads `req.body`), inside the prose shield its own header prescribes (`server/sentinel-shield.mjs`: on a document route every string is blanked for the scan and put back before the route; the URL and the query string are scanned everywhere). `trust proxy` is set by address through `server/proxy-trust.mjs`, a port of the hub's rule (the socket peer, loopback, private ranges, `TRUSTED_PROXY_CIDRS`, and at most one Cloudflare hop, which ends the walk). Without it the Sentinel's per-IP limit behind Render would have been one bucket for the whole site.
- **The vendored SDK had diverged both ways.** This folder's `hub-sdk.js` carried `webhook.setCallback`, which the hub dist lacked, and the hub dist carried a newer landing middleware and `onlyIfNewer` that this folder lacked. The method is in the hub dist and `SDK_REFERENCE.md` now (uncommitted in the hub checkout), and this folder's copy is the dist, byte for byte. `sentinel-adoption.test.mjs` pins both copies against the hub when it is beside this checkout, and skips visibly when it is not.
- **Two secrets fell back to literals in source:** the mail-link signing key (`jourvance_internal_salt_key_84920`, which signs unsubscribe links) and the domain-token salt (`jourvance_domain_salt_2026`). Each now falls back to `HUB_API_KEY`, then to a key minted once per process with a boot warning. `secrets-in-source.test.mjs` is the gate. **Consequence on the live site:** `SESSION_SECRET` is not set on Render, so a domain verification token started before this deploy will not match after it; the merchant reads the token again from the app. No merchant had a verified sender, and whether any had a pending domain was not checked.
- **`/api/ai/copy` returned model copy with no em dash strip and no rule in the prompt**, where `/api/ai/journey-plan` had both. It uses the same `cleanModelStrings` now. Four hand-written em dash placeholders in `server/webhookHealth.mjs` read `unknown`.
- **A pre-existing error, found only because the server was booted:** `accountEvents` in `server/routes/emailRoutes.mjs` reads `loadBehaviorBag` off the route context and the server never passed it, so every prediction refresh threw `ReferenceError` (the 300 s boot log carried it). It is passed and pinned now. It was in commit `12025c8`.

### Evidence

- `npx tsc --noEmit` exited 0. `npm test`: 1797 tests, 1794 passed, 0 failed, 3 skipped (the skips need `JOURVANCE_LIVE_TEST_URL`).
- Seen red, each by planting the fault and inverting the plant: the mount-order pin (restore mounted before the Sentinel: 5 passed, 1 failed), the one-Cloudflare-hop latch (removed: the Worker-chain case failed), and the context binding (removed: 3 passed, 1 failed). Every restored file was compared byte for byte with its pre-plant copy.
- The hub's `npm run test:seo-fix`, which imports the changed dist, ran 44 tests, 44 passed.
- **Booted and loaded.** `node server.mjs` ran from an empty data directory with `HUB_API_KEY`, `HUB_URL`, `MAIL_EVENT_SECRET`, `PUBLIC_BASE_URL` and `INTERNAL_CRON_SECRET` all empty (the shell value wins over `.env`, checked with a throwaway file). Real Chrome through Playwright loaded `/` with status 200, `#root` holding one child, 6,456 characters of text including the headline "Map, Build & Convert Your Entire Customer Journey", no page error and no CSP violation. The first boot DID show one: the CSP refused the hub's `tracker.js` because the tag in `index.html` names `https://zeluslabs.dev` whatever `HUB_URL` says, so that origin is on `extraScriptSrc` now. One console line remains, a 401 from the page's own session check with no token; it predates this pass and was not chased. Probes from node: `/__sentinel/status` 200; `POST /api/email/provider-event` 401 "Mail event secret is not configured"; `POST /api/email/senders` with no token 401; a `<script>` body on `/api/user/*` 403 (scanned), `/api/x/../health` 403, `/wp-login.php` 403. A 75 s boot after the context fix logged no error line, where the 300 s boot before it logged the `ReferenceError`; there is no positive control that the tick ran in those 75 s.

### Not done, and whose it is

- The hub cockpit actions from the previous section (resume sending, set `replyTo`) still need the operator. Unchanged.
- The hub-side dist and reference edits are uncommitted in the hub checkout. Every spoke scaffolded from the hub also mounts the Sentinel with no `trust proxy` setting; `server/proxy-trust.mjs` here is a port, and the rule belongs in the hub's `sentinel-dist` so every spoke gets it once. Not done here.
- The Sentinel's rate limit has no per-user key: sign-in is a bearer token the middleware cannot verify cheaply, so the fairness bucket is the address at 240 a minute on `/api`. Not measured against the cockpit's real request rate.
- The email studio, the canvas and the sign-in flow were not loaded in the browser; only the public homepage was. The `frame-src` entry for Firebase Auth is reasoned from the SDK's helper iframe, not observed.

## 2026-10-07 — Letters send as the merchant

Custom sending domains were half wired. A merchant could register a domain (`POST /api/email/senders` relays to the hub with the merchant uid as `accountId`), get the DNS records back, verify them, or have `domain-connect` write them into Namecheap. None of it was used: `deliverLetter` in `server.mjs` called `hub.email.send` with no `accountId` and no `senderId`, and the hub's `resolveSenderIdentity` only picks an account's sender when the send names the account. Every letter left as `noreply@zeluslabs.dev` however many domains the merchant verified.

### What changed

`deliverLetter` now sends `accountId: userId` beside `jourvanceUid`. The hub uses the account's VERIFIED sender when one exists and the app default otherwise, so a pending domain changes nothing. A verified domain sender is still behind the hub's DMARC gate: a domain with no DMARC record is refused with the record named, unless the operator turns on the override in hub Setup. The hub's scope check was read before this change: with no `contactScope` on the call and `eventsOnlyAccounts: false` on the live app, `accountId` is read only as the sender selector and the send stays on the ordinary path.

`mail-events.test.mjs` pins `accountId: userId` inside `deliverLetter`. The pin was seen red: with that line removed the file was 3 passed, 1 failed; restored, 4 passed, and the restored region is byte-identical to the pre-plant copy.

`reports/Klaviyo email suite gaps.md` carries a dated retirement banner. The body is unchanged. The banner names what was checked against the code: fifteen block kinds in `email-doc.mjs`, the graph compiler in `email-flows.mjs`, feeds in `email-feeds.mjs`, the 50 orders, 20 repeat customers and 90 days floor in `email-predict.mjs`.

### Evidence

`npx tsc --noEmit` exited 0. `npm test` was 1786 tests, 1783 passed, 0 failed, 3 skipped (the skips need `JOURVANCE_LIVE_TEST_URL`). Live hub status for `jourvance`, read with the app key: `mode: live`, `replyTo: ""`, `overrideGuard: false`, `eventsOnlyAccounts: false`, `deliveryGuard` 1 send, 1 bounce, health `bounce: danger`.

### Still blocked, and on whom

- **Hub sending for jourvance is still paused** by the bounce guard. Resuming needs the operator in the hub cockpit: `POST /api/email/deliverability/resume` is `requireHubAdmin` and wants a recovery test to the configured From mailbox with a signed delivery receipt from the last 30 minutes, or the "override deliverability guard" switch in Setup. `ADMIN_TOKEN` is empty in the parent `.env`, so no script here can do it.
- **Hub `replyTo` is still empty.** Setting it to `support@jourvance.com` is `POST /api/email/connect`, also operator-only. Same cockpit screen.
- `saas-growth-funnel` is still served. `boot-safety.test.mjs` keeps it on purpose as the dev funnel page. Left alone.
- No merchant has a verified sender on the live hub yet, so the new field has changed no real letter.

## 2026-10-08 — support@jourvance.com receives mail

The contact page and footer already linked `mailto:support@jourvance.com`. The domain had Namecheap email forwarding turned on and no aliases, so that address had nowhere to go. `support` now forwards to `tlm@tarrenmunoz.com`, the same address Namecheap has as the registrant contact and the app uses as the operator. The website records are unchanged: apex A `216.24.57.1`, `www` CNAME `jourvance.onrender.com.`, email type `FWD`.

The first destination tried was `Tarren@zelusmarketing.com`, because that is where `support@zeluslabs.dev` forwards. Google returned 550 5.1.1 for that mailbox. The bounce suppression SendGrid stored for `support@jourvance.com` was deleted. The forward was then pointed at `tlm@tarrenmunoz.com`. A second check from `noreply@zeluslabs.dev`, subject "Jourvance support address is on", message id `Zx6FO4PBQwCJ0q9IxqKElg`, is `delivered` in SendGrid activity. Bounce, block, and invalid lists for `support@jourvance.com` are empty. The Gmail inbox was not opened.

This address receives mail. It does not send as `support@jourvance.com`. A reply from the operator inbox still shows `tlm@tarrenmunoz.com`. Hub `replyTo` is still empty. `support@zeluslabs.dev` still forwards to `Tarren@zelusmarketing.com`.

Hub sending for the jourvance app is paused. Deliverability is one sent broadcast, one recipient, one bounce, bounce rate 1, health `bounce: danger`. That bounce is the earlier letter to `tarren@zelusmedia.com`. The guard was not overridden. A hub test send to `support@jourvance.com` (`bc_muyswg1i8of1`) failed for that pause and did not leave the hub.

## 2026-10-07 — Mail can send

The hub app `jourvance` is `mode: live`, `live: true`, From `noreply@zeluslabs.dev`, From name Jourvance, `senderVerified: true`. `zeluslabs.dev` is an authenticated SendGrid domain. SendGrid accepted one message (`bc_muyqj0ghch8g`, sandbox false). Gmail answered 550 5.1.1 for `tarren@zelusmedia.com`: that mailbox does not exist. The bounce suppression for that address was removed. Delivered stayed 0 because of that recipient, not because the send stayed in sandbox.

`https://jourvance.com` is deploy `a650b87` and is live. `POST /api/email/provider-event` with no secret now says the secret did not match, so the running process loaded `MAIL_EVENT_SECRET`. The same deploy restores `noteAttrMap`, which had been crashing boot, and stops fixture enrolments and fixture carts before the runner can send them. Render env for this service is `APP_ID`, `HUB_URL`, `HUB_API_KEY`, `PUBLIC_BASE_URL`, and `MAIL_EVENT_SECRET`.

The hub deploy `0025d0e` is live. Webhook status is configured, signed, and `callback: true`. The callback URL is `https://jourvance.com/api/email/provider-event`. SendGrid still posts to `https://zeluslabs.dev/api/email/webhook/sendgrid/jourvance`.

## 2026-10-07 — Secret and public URL are set; the running site has not loaded them

The hub does handle the mail. SendGrid for the `jourvance` app was not pointed at it. `POST /api/email/webhook/setup` on the live hub now answers success. Status is `configured: true`, `signed: true`, and the webhook URL is `https://zeluslabs.dev/api/email/webhook/sendgrid/jourvance`. The hub email status at the same time was `connected: true`, `mode: sandbox`, `live: false`.

`MAIL_EVENT_SECRET` (43 characters, no line break) and `PUBLIC_BASE_URL=https://jourvance.com` are in this folder's `.env` and on the Render service `jourvance` (`srv-daodtqp42hec739fkt1g`). `https://jourvance.com` is the live Express app (`www` points at `jourvance.onrender.com`). The value of the secret is not written here.

The process answering `https://jourvance.com/api/email/provider-event` still returns "Mail event secret is not configured, so bounces are not recorded." Render applies env changes on the next successful deploy. The last deploys, from 2026-09-28 through 2026-10-02, are `update_failed`. The 2026-10-02 build succeeded, then `node server.mjs` exited with `ReferenceError: noteAttrMap is not defined` at `server.mjs`. That name is still only a reference in the route context, in this tree and on `main`. This pass did not deploy.

The running hub does not have `POST /api/email/webhook/callback`. That route answers 404, and webhook status has no `callback` field. The forward code is in the parent `server-email.ts` on disk. SendGrid can reach the hub. The hub cannot be told to forward to Jourvance until that process is the one SendGrid posts to.

## 2026-10-07 — Mail events are wired and still off

Item 5 in the improvement list is this pass. The hub can now forward a signed open, click, bounce, or complaint to Jourvance, and Jourvance can store it on the account that sent the letter. Nothing is being stored yet. `MAIL_EVENT_SECRET` and `PUBLIC_BASE_URL` are still unset in `.env`, so the report still says opens stay blank, and boot does not call the hub.

### What changed

**A signed SendGrid batch can be forwarded.** After the hub has already decided to answer 200, it posts `{ events: [...] }` to the spoke callback with the header `x-jourvance-mail-secret`. An unsigned post is not forwarded. A save that answers 503 is not forwarded, so SendGrid can deliver that post again. The forward does not change the status SendGrid sees. Dropped, deferred, and processed events are left out. A blocked bounce is a soft bounce. A spam report is a complaint. A row with no account id or no email is left out. The request does not follow a redirect, and it gives up after 4 seconds.

**The callback is a separate route.** `POST /api/email/webhook/callback` registers or clears it. The address has to be https, with no password in it, and the path has to be `/api/email/provider-event`. Localhost, `.local`, and a numeric address are refused. An empty `url` clears the address and the secret. Webhook setup is unchanged: it still points SendGrid at the hub.

**The callback secret is sealed.** `eventCallbackSecret` is on `CONFIG_SECRET_PATHS` with the SendGrid key and the inbound token. `redactConfig` does not return the address or the secret. Webhook status adds `callback: true` or `callback: false`.

**A letter can name itself.** `deliverLetter` sends `jourvanceUid` and `jourvanceMessageId` when the account id is set. The hub writes `jourvance_uid` on that letter. It writes `jourvance_message_id` only when the send has one recipient. A value with a line break is not written.

**The spoke route stores the batch.** `POST /api/email/provider-event` takes one event or `{ events: [...] }` up to 1000. The same `providerEventId` for the same account is stored once, including a retry of a bounce or an unsubscribe. A hard bounce, a blocked bounce, a complaint, and an unsubscribe still update that account's suppressions. An open attaches the campaign, flow, and message id when this account already has that send. `knownSend` and `emailTouchFields` are in scope on that route. A matching secret used to throw before any row was stored.

**Opens stay blank until both settings are real.** `opensStored` is true only when `MAIL_EVENT_SECRET` is 16 to 200 characters with no line break and `PUBLIC_BASE_URL` is a public https origin. The campaign report and the sending screen say "Opens stay blank until MAIL_EVENT_SECRET and a public https PUBLIC_BASE_URL are set." No Jourvance open pixel was added. On listen, the spoke registers the callback only when both of those are already set and the hub key is set. Otherwise it logs that mail events stay off. The log does not include the secret. `.env` was not edited.

### Evidence

`npx tsc --noEmit` exited 0. `npm test` (`node --test`) was 1785 tests, 1782 passed, 0 failed, 3 skipped. The skips run only when `JOURVANCE_LIVE_TEST_URL` is set. It was not set. `mail-events.test.mjs` covers the origin check, the batch, dedupe, the attached send, and the suppression update. It uses a temporary app. It does not import `server.mjs`, and it does not call SendGrid or the live hub.

The parent hub file `server-email.ts` was checked with `node --import tsx --test test/email-delivery-routes.test.ts`: 27 tests, 27 passed, 0 failed. That run extracts the send and the SendGrid webhook without booting the hub. A signed delivered event is forwarded. An unsigned event, a bad signature, and a save that answers 503 are not.

### Left on purpose

- `MAIL_EVENT_SECRET` and `PUBLIC_BASE_URL` are still unset. Opens stay blank. Boot does not register a callback.
- The hub change is in the parent repo on disk. The process SendGrid posts to does not forward until it is running this code. This pass did not start that process.
- `hub-sdk.js` in this folder has `webhook.setCallback`. A later copy of an older SDK would drop that method.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are still unset. Checkout returns 503 and charges nothing.
- No live store was connected. The Klaviyo gap report was not rewritten. It still says six block kinds. The builder has fifteen.
- Sample page copies on the hub were not deleted. `saas-growth-funnel` is still served.
- Nothing was committed. The homepage, the billing dialog, and the email studio were not opened.

## 2026-10-07 — One document per account

Item 4 in the improvement list below is this pass. The process still keeps one combined value in memory and one combined local file, which is what the loaders already read. The hub copy is one document per account. A second account's save no longer replaces the first account's hub document. The API was not started, so the live hub was not migrated. The next boot that has a hub key is what splits the documents that are there now.

### What changed

**Sixteen collections split by account.** `hub-storage.mjs` covers contacts, orders, checkouts, campaigns, discounts, events, redirects, reviews, templates, email programs, signup forms, predictions, behavior, catalog memory, Klaviyo, and drips. An account slice is `{ _jourvanceAccount, value }` at `store.<collection>.u.<account>`. Rows with no owner stay on `store.<collection>.none` and are not given an owner. A uid that is not a safe path segment is hashed in the name. The account id in the document is what round-trips.

**Drip sequences stay one shared document.** `store.drips.sequences` holds the sequence definitions. Enrollments split per `userId`. Editing a sequence still changes it for every account. Drips are not gated on the plan.

**Boot loads every workspace and every published page.** Names are read in batches of 20. There is no first-50 cut on those two lists. A local workspace or page whose `updatedAt` is newer than the hub copy is kept and written back. The operator journey list is still the newest 50 and still returns the total. The signed-in journey list was already paging every journey for that user.

**A newer local file is written back.** Freshness is the whole collection, for this one process. If the local file has rows and is strictly newer than the newest hub document for that collection, and it is not the mirror just written (`storage-sync.json`, gitignored), the local file is put back as per-account documents. If the hub is newer or equal, the hub wins and the local file is rewritten. An empty local file does not wipe a hub that has data. A failed put does not advance the mirror stamp. The old "1 MB cap" in the honest pass is the wrong limit: a hub document can be up to 6.4 MB. The split is still required because one write was every account, and `drips.json` was already about 515 KB.

**The same email can belong to two accounts.** A lead matches email only inside the same owner, and it does not adopt an unowned row. Waitlist and inquiry update an unowned contact only. Klaviyo profile upsert and Klaviyo list tags find this account's row only. Shopify customer sync finds email and `contactOwnerId` together, stamps `userId`, and reports `customerCount`, `totalCustomers`, and `totalInCrm` as this account's contacts. A new synced id is `cust_<uid>_<shopifyId>`. `GET /api/workspace/:wsId/shopify/discounts` returns rows whose `userId` is the signed-in user. Saving a discount skips a rule owned by a different user. Events and redirects keep the last 20,000 per owner only when the combined list is longer than 20,000.

**Billing stays mounted.** Checkout is unchanged. Its registration now sits just after the AI journey route so the existing source check, which wants that route directly after auth, still passes.

### Evidence

`npx tsc --noEmit` exited 0. `npm test` (`node --test`) was 1781 tests, 1778 passed, 0 failed, 3 skipped. The skips run only when `JOURVANCE_LIVE_TEST_URL` is set. It was not set. `tenant-store.test.mjs` covers the split, the shared sequences, local-versus-hub freshness, batches past 50 names, a legacy document becoming account documents, 60 workspaces and 55 pages on boot, 25 workspaces on `listWorkspaces`, and a lead for one account leaving the other account's same email unchanged. Those tests use a temporary directory and a fake hub. They do not call the live hub, and they do not import `server.mjs`.

### Left on purpose

- Sequence definitions are still global. One edit is every account.
- `GET /api/discounts/core-status` still finds a code across every account.
- Shopify order sync still writes `ordersCount` from the length of the combined orders file. Customer counts are this account's. Order rows written by that sync do carry `userId`.
- A public discount lookup by store domain is unchanged.
- The operator journey list is still the newest 50.
- `MAIL_EVENT_SECRET` and `PUBLIC_BASE_URL` are still unset. Opens stay blank.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are still unset. Checkout returns 503 and charges nothing.
- No live store was connected. The Klaviyo gap report was not rewritten. It still says six block kinds. The builder has fifteen.
- Sample page copies on the hub were not deleted. `saas-growth-funnel` is still served.
- Nothing was committed. The homepage and the billing dialog were not clicked.

## 2026-10-07 — Billing is the backend

The homepage rewrite in the honesty section was reverted. `HomePage.tsx`, `PublicHeader.tsx`, and `PublicFooter.tsx` are back to the committed pricing copy, including Growth Pro at $49 a month and $39 a month billed annually. The nav says Pricing and Subscription Plan again.

Growth Pro checkout is `POST /api/billing/checkout`. It is a Stripe subscription: 4900 cents monthly, or 46800 cents for the year. The signed-in user id is on the session. A paid `checkout.session.completed` sets that account to `pro` and sets `planTier` on their workspaces. `customer.subscription.deleted` sets the account back to starter. A second workspace is still refused for a starter account. A pro account is not refused. With no `STRIPE_SECRET_KEY`, checkout returns 503 and does not charge. With no `STRIPE_WEBHOOK_SECRET`, the webhook returns 503 and does not change a plan. Neither variable was set. Stripe was not called.

The billing dialog still shows the same plan names, prices, and feature list. The button is Continue to checkout and posts to `/api/billing/checkout`. It no longer says there is no credit card, and it no longer says an onboarding team will verify the store. The old waitlist route still records a `growth_pro_waitlist` tag. That tag is not a paid plan.

`node --test billing.test.mjs honesty-copy.test.mjs` passed, 12 tests. `tsc --noEmit` exited 0. The full suite was not re-run after this revert. The API was not started.

Drips are not gated on the plan. Every current account is starter, and stopping their mail was not part of this pass.

## 2026-10-07 — Honesty copy

This pass did the five items the boot section left open. The billing section above puts the homepage prices back and replaces the "billing is not connected" copy with a Stripe checkout. The API was not started. Nothing was committed. The page was not opened in a browser. Evidence for this pass was `npx tsc --noEmit` (exit 0) and `npm test` (`node --test`): 1765 tests, 1762 passed, 0 failed, 3 skipped. The skips are live checks that run only when `JOURVANCE_LIVE_TEST_URL` is set. It was not set. That suite ran before the billing section reverted the homepage.

### What changed

**The public site no longer sells a plan.** `HomePage.tsx` and `BillingModal.tsx` say billing is not connected, the product is in use, and there is no paid plan and no price. The Starter column and its unenforced limits are gone. The onboarding-team line is gone. The savings sentence that claimed over $2,400 a year and a 10x smoother experience is gone. Header, account menu, and footer doors that said Pricing or Subscription Plan now say Waitlist. The waitlist form posts only `email`, `storeDomain`, and `source: billing_waitlist`. The server tags the contact `waitlist` and answers "You are on the waitlist." It does not store a plan or a billing cycle.

**Operator checks use one function.** `AppSidebar.tsx` and `CanvasHeader.tsx` call `isOperator(user)`. The operator dashboard sentence uses `OPERATOR_EMAIL` from `src/lib/firebase.ts`. The address is not written a second time in those three files.

**The unused Shopify simulate handlers are gone.** `ShopifySyncModal.tsx` no longer posts to the simulate routes, and it no longer carries the Elena Rostova or Marcus Shopper handlers. The buttons were already absent. `POST` simulate-order and simulate-abandoned-checkout still return HTTP 410. `rfm-engine.test.mjs` still uses the name Elena Rostova as fixture data.

**Opens say why they are blank.** `GET /api/email/analytics` returns `opensStored`, true only when `MAIL_EVENT_SECRET` is a non-empty string. The campaign report and the sending screen show "Opens stay blank until MAIL_EVENT_SECRET is set." when that flag is not true. Numeric cells stay blank. The secret was not set, and the hub was not pointed at it.

**`npm test` runs the suite.** `package.json` script `test` is `node --test`. The suite above is that command.

**A page named `demo.myshopify.com` is a page again.** The boot pass refused every page whose store domain was in `FAKE_STORE_DOMAINS`. That hid the lead and review checks, which use `demo.myshopify.com` as a stand-in store, so checkout came back null and the public reviews list came back empty. `isSamplePublicPage` now refuses the other four domains (`scaletech`, `luxeglow`, `glowbotanics`, `rosebotanics` on `.myshopify.com`), the three sample hosts, and the six sample slugs. `realStoreDomain` still blanks a checkout link to `demo.myshopify.com` when the server's own function is used. The tests pass their own function, which is how they check the discount query.

### Left on purpose

- Competitor prices stay on the homepage: Unbounce $99/mo, Instapage $149/mo, ActiveCampaign $49/mo, ConvertKit $29/mo, Typeform $35/mo, Jotform $39/mo, Zapier $29/mo, a landing-page and email line at $49, a form plugin at $19, the column "The Fragmented Stack ($250+/mo)", and a form mock that reads "$5,000 - $15,000 / mo". Those are other products' prices. This page does not quote a Jourvance price or a savings amount.
- `saas-growth-funnel` is still served, with discount code `GROWTH20`.
- A third workspace still returns 402 after two exist. The error text now says another workspace is not available and billing is not connected. The cap and the email bypass are unchanged.
- `MAIL_EVENT_SECRET` is still unset.
- Contacts, events, drips, and behavior are still one hub document per collection. Boot still loads the first 50 workspace docs and the first 50 published pages.
- No live store was connected.
- The Klaviyo gap report was not rewritten. It still says six block kinds. The code has fifteen.
- The six customer JSON files stay gitignored and staged for removal from the index. Working copies remain. Nothing was committed.
- The homepage, the billing modal, and the email report were not clicked. Source tests and the typecheck are what cover that copy.

## 2026-10-07 — Boot is held

This pass did the three changes that had to land before `node server.mjs` is safe to start against the live hub. The API was still not started. Evidence is `node --check` on `server.mjs` and `server/routes/publicRoutes.mjs`, plus `node --test boot-safety.test.mjs upsell-recovery.test.mjs` (21 passed, 0 failed).

### What changed

**Fixture mail is stopped.** `drips.json` has 61 enrollments. 52 are `stopped` with `stoppedReason` `fixture`. 9 are `converted_exit`. None are `active`. `loadDrips` in `server.mjs` runs `holdFixtureEnrollments` and, when that changes a row, calls `saveDrips`. An active enrollment whose address is on the fixture-domain list becomes `stopped` before the 60-second runner. The in-process runner still starts 10 seconds after listen. It sends only `status === 'active'`.

**The cron route has no password in source.** `POST /api/internal/cron/drips` is mounted only when `INTERNAL_CRON_SECRET` is a non-empty string. `.env.example` says the route does not exist until that variable is set, and it ships no value. `.env` was not edited. The variable is still unset, so a boot today does not mount the route.

**Sample pages are not served.** Hosts `glowbotanics.com`, `wave5luxury.com`, and `wave9brand.com` answer 404 with `This address is not a published page.` Slugs `glow-elixir`, `wave5-elixir`, `wave9-radiance`, `vip-glow-kit`, `duo-glow-bundle`, and `wave4-elixir` are refused on read. This pass also refused a page whose store domain was any of `FAKE_STORE_DOMAINS`. The honesty section above narrows that: `demo.myshopify.com` no longer hides the page. `scaletech`, `luxeglow`, `glowbotanics`, and `rosebotanics` on `.myshopify.com` still do. `reportSamplePages()` runs after hub rehydration and before listen, deletes the matching cache keys, and writes `public_pages.json`. The local file now has one key, `saas-growth-funnel`. Hub copies of the refused pages are not deleted. A read that finds one returns no page.

**Six customer JSON files are gitignored.** `events.json`, `drips.json`, `checkouts.json`, `discounts.json`, `email_programs.json`, and `signup_forms.json` match the ignore already used for `contacts.json` and `orders.json`. They are staged for removal from the git index. The working copies are still on disk. Nothing has been committed. The next commit will drop those six files from the repository if that staged removal stays in the index.

### Still on disk, and still served

`saas-growth-funnel` remains. It belongs to `dev-test-user-id`, has discount code `GROWTH20`, an order bump priced at 29, and no store domain. It is not on the sample-host or sample-slug list, so `/p/saas-growth-funnel` still renders it.

### What this pass did not do

The honesty section above did these five. They were open when this section was written.

- The public site and the billing modal still show Growth Pro at $49 a month and $39 annually. Nothing charges for it.
- `AppSidebar.tsx` and `CanvasHeader.tsx` still compare against a written-in address. They do not call `isOperator`.
- The Shopify sync modal still contains the unused simulate handlers.
- The email report still leaves opens blank. It does not yet say that `MAIL_EVENT_SECRET` is unset. That variable is still unset.
- `package.json` still has no `test` script. The other test files were not run.
- Contacts, events, drips, and behavior are still one hub document per collection for every account. Boot still loads the first 50 workspace docs and the first 50 published pages.
- No live store was connected. No lead, send, click, or order was recorded on purpose.
- The Klaviyo gap report was not rewritten.

## 2026-10-07 — Honest pass

### Short answer

The boot-safety section above supersedes three claims in this pass: the cron password in source, the 52 active enrollments, and the sample pages for glowbotanics, wave5luxury, wave9brand, vip-glow-kit, duo-glow-bundle, and wave4-elixir. The price, the single hub document, the split operator check, and the rest of this pass are unchanged.

The app is wired. Canvas, email, attribution, Shopify, publish, and the public pages each call a route that exists. Mail, flows, and reports are built to stay blank until this store has real events. That part is in good shape.

It is not ready to treat as a finished product. The public site sells a $49 Growth Pro plan that nothing charges for, and it says the free plan cannot do things the server already does for every account. A fallback cron secret is hardcoded. Opens, clicks, and last-touch revenue stay empty until `MAIL_EVENT_SECRET` is set, and it is not set. All of one account’s contacts, events, and drips still sit in a single document. Local fixture mail is due right now, so starting the API against the live hub would try to send it.

The previous version of this file is not a reliable status list. It marks invented coupons, curated reviews, a beauty demo catalog, and a paid plan as finished product. Later honesty work removed a lot of that. Where this section and the old roadmap disagree, trust this section.

### What I actually checked

- Every `fetch('/api/...')` in `src/` matches a route in `server.mjs` or `server/routes/`. Publish, unpublish, preview, publication, and journey save go through `requestAnswer` and those routes exist too.
- `saveJourney` keeps `forecast`, `workspaceId`, and `shopifyStoreDomain` (`server.mjs`).
- A 60-second in-process runner calls `processUserAutomationsTick`. `POST /api/internal/cron/drips` is a second door to the same runner.
- Order and checkout simulation return HTTP 410. The sync modal still contains the old handlers (`Elena Rostova`, `Marcus Shopper`). They are not rendered.
- Shopify webhooks, pixel, lead, review, unsubscribe (`/u/:token`), and click redirect (`/r/:code`) are mounted.
- Email block kinds in `email-doc.mjs` are heading, text, button, divider, image, html, split, columns, table, spacer, social, header, video, product, and coupon.
- Flow starters in `email_programs.json` for the dev account (viewed product, added to cart, price drop, back in stock, sunset) are saved off.
- `.env` sets `APP_ID`, `HUB_URL`, `HUB_API_KEY`, and `PORT=3005`. It does not set `MAIL_EVENT_SECRET`, `MAIL_LINK_SECRET`, `PUBLIC_BASE_URL`, or `INTERNAL_CRON_SECRET`.
- Nothing was listening on port 3005 or 5173.
- `package.json` has no `test` script. There are 155 `*.test.mjs` files.

### What is wired

| Surface | Talks to | Notes |
| --- | --- | --- |
| Map | `POST /api/journey/:id`, `GET /api/journey/:id`, `POST /api/funnel/stats` | Stats poll overlays recorded counts. Missing rates stay empty or 0% from real zeros, not from a demo. |
| Publish | `POST /api/journey/:id/publish` and `unpublish`, `GET /api/journey/:id/publication` | Slug ownership is checked. Pages render from `server/routes/publicRoutes.mjs`. |
| Email studio | suite, flows, campaigns, audience, lists, segments, forms, inbox, SMS, Klaviyo, sending | Tabs in `HubEmailSuite.tsx` call those routes. Empty hub answers stay empty. |
| Attribution | `GET /api/reports/attribution` and the CSV route | Scoped to the signed-in account. |
| Shopify | connect, products, discounts, order import, webhook register, webhook health | A domain alone does not connect. Simulation is off. |
| Public site | `/`, `/p/:slug`, `POST /api/public/lead`, waitlist, inquiry | Vite on 5173 proxies `/api` and `/p` to port 3005. |
| Operator | `GET /api/admin/journeys`, `GET /api/admin/summary` | Server allows one verified operator email. |

Journeys go to the hub app store when `HUB_API_KEY` is set, with a local cache. Contacts, orders, events, drips, campaigns, checkouts, discounts, redirects, programs, forms, predictions, behavior, catalog memory, and Klaviyo state go through `hub-storage.mjs` the same way. On boot, if the hub has a document, that document replaces the local file.

### What will mislead someone

**The $49 plan is copy, not a product.** `HomePage.tsx` and `BillingModal.tsx` show Starter at $0 and Growth Pro at $49 a month or $39 billed annually. The upgrade button posts to `/api/public/waitlist` and stores a `growth_pro_waitlist` tag. There is no charge, no plan field on the account, and no check that limits journeys, drips, Shopify, or AI. The free column says automated drips and multi-store sync are excluded. The runner and the Shopify routes do not look at a plan. The success line says an onboarding team will verify the store. Nothing in the server does that.

This conflicts with the product rule already written down: do not sell a Pro plan, and do not write one.

**Opens and revenue stay blank on purpose, and the switch that would fill them is off.** `POST /api/email/provider-event` returns 401 when `MAIL_EVENT_SECRET` is empty. The secret is empty. Campaign tables therefore keep opened, clicked, delivered, and last-touch revenue blank even after the hub sends mail. That is honest. It is also easy to read as a broken report. The hub has to be pointed at that route with the same secret before any of those cells can fill.

**One document holds every tenant.** `store.contacts`, `store.events`, `store.drips`, and the rest are each a single hub document for the whole app. `drips.json` is already about 515 KB. A document store with a 1 MB cap fails on the next real account, and one bad write is every account. Restart loads at most 50 workspace docs and 50 published pages from the hub list (`hub-storage.mjs`). A 51st store or page is absent after a fresh boot until something else writes it.

Hub copy wins over the disk on startup even when the disk is newer. A put that had not flushed yet is gone.

**The cron door uses a password that is in the source.** `INTERNAL_CRON_SECRET` falls back to a string in `server.mjs` when the env var is missing. Anyone who can read the repo and reach the server can POST `/api/internal/cron/drips` and run the sender for every account that has due mail.

**Operator checks do not share one email.** `src/lib/firebase.ts` reads `VITE_OPERATOR_EMAIL`. `PublicHeader.tsx` uses that helper. `AppSidebar.tsx` and `CanvasHeader.tsx` compare against the address written in the file. Change the env var and the public header and the studio chrome disagree about who is the operator. The server has its own default of the same address.

**Vite does not proxy `/u`, `/r`, or `/review`.** Those routes exist on the API. Generated links use `PUBLIC_BASE_URL` or `http://localhost:3005`, so mail links hit Express. Opening the same path on port 5173 does not.

**Dead simulate code is still in the sync modal.** The buttons are gone. The functions still POST to the 410 routes and still name fake shoppers. Wiring a button back would look like success and then do nothing, because a non-success response sets no error.

**Two status documents are stale.**

- `reports/Klaviyo email suite gaps.md` still says the builder has six block kinds, one order split, and no product or coupon block. The code has the fifteen kinds above, a real graph runner, feeds, and a prediction that stays off until this store qualifies.
- The old roadmap at the bottom of the previous audit claimed curated reviews, `SAVE10`, `GIVE15`, and a luxury demo catalog as shipped. Current tests forbid those stand-ins unless the merchant saved the code. Do not use that roadmap to decide what to build.

### What is on disk right now

These counts are the local files, not a live customer.

| File | What is in it | Tracked in git |
| --- | --- | --- |
| `contacts.json` | 40 people. Domains include example.com and invented store names (`scaletech.io`, `acmecommerce.com`, `botanicalglow.com`, and others). | No |
| `orders.json` | 0 | No |
| `events.json` | 58 events: 50 leads, 6 page views, 1 upsell accept, 1 decline. 52 of the emails are `@example.com`. | Yes |
| `drips.json` | 4 shared sequences, 61 enrollments. 52 are still `active` and every `nextStepDueAt` is already past. | Yes |
| `campaigns.json` | 0 | No |
| `checkouts.json` | 5 | Yes |
| `email_programs.json` | Bags for `dev-test-user-id`, `usr_wave4_operator`, `usr_default`. Flow starters are off. | Yes |
| `signup_forms.json` | One dev-test bag | Yes |
| `public_pages.json` | 10 entries, including `vip-glow-kit`, `glow-elixir` on `offer.glowbotanics.com`, `wave5-elixir` on `offer.wave5luxury.com`, `wave9-radiance` on `offer.wave9brand.com`. | No |
| `workspaces.json` | Two dev-test workspaces | No |
| `behavior.json` | One key, `user_test_1` | No |

`events.json`, `drips.json`, `checkouts.json`, `discounts.json`, `email_programs.json`, and `signup_forms.json` are committed. `contacts.json` and `orders.json` are gitignored. That split is accidental. The committed drip file is the dangerous one: 49 welcome enrollments and 3 cart enrollments are active and due. The runner sends when the hub is ready and the address is present. It does not check that the address is a fixture. Starting `node server.mjs` with the current `.env` will try to send those.

Sample domains the honesty rules name (`glowbotanics`, and the wave luxury hosts) are still published in the local page file. They are not in git. They would still be served.

### How to improve it

In the order that changes whether the app tells the truth.

1. **Take the price off the public site and the billing modal.** Say the product is in use and that billing is not connected. Delete the Starter limits that the server does not enforce. Delete the line about an onboarding team. A waitlist can stay if it says it is a waitlist.
2. **Pause or delete the 52 due fixture enrollments before the next API boot**, or run with no hub key. Otherwise the 60-second runner treats them as customers.
3. **Require `INTERNAL_CRON_SECRET`.** If it is unset, do not mount the cron route. Do not ship a fallback.
4. **Stop storing every tenant in one document.** One doc per account for contacts, events, drips, and behavior. On boot, if the local file is newer than the hub doc, keep the local file and write it back. Load every workspace and page, not the first 50.
5. **Turn on mail events deliberately.** Set `MAIL_EVENT_SECRET`, set `PUBLIC_BASE_URL` to the public https origin, and point the hub’s open, click, bounce, and complaint posts at `/api/email/provider-event`. Until that is done, the email report should keep saying that opens are not being stored. It already leaves the cell blank. The sending screen should say the same thing in one sentence.
6. **Use `isOperator` everywhere.** Sidebar and canvas header should call the helper in `firebase.ts`. The dashboard sentence should use that same address, not a second copy.
7. **Quarantine fixture data.** Gitignore the same JSON files the other customer files use, and stop serving `glowbotanics` and the wave sample hosts. Add a boot note when a published page’s domain is on the sample list.
8. **Retire or rewrite the Klaviyo gap report** so it matches `email-doc.mjs`, `email-flows.mjs`, `email-feeds.mjs`, `email-predict.mjs`, and `email-map.mjs`. Building more Klaviyo-shaped features before one real store has a recorded send, click, and order will make the suite larger and the empty states harder to trust.
9. **Add `npm test` and run it.** A claim that 200 or 1,700 tests passed is not evidence unless the command is in `package.json` and someone ran it. This pass did not.
10. **Prove one real path before adding a phase.** Connect one store with its own token. Publish one page. Record one lead with a `jv_vid`. Accept one send at the hub. Store one click. Attribute one order. If that path is boring and the numbers match the JSON, the app is working. The canvas, the forecaster, and the email graph are already ahead of that path.

### What is in good shape and should stay

- Flows, letters, forms, and holdout stay off until someone turns them on.
- Predicted value is not written until this account has 50 orders, 20 repeat customers, and 90 days. The report does not say “optimal.”
- A coupon preview shows the word Code and does not mint. A code is minted on a real send.
- Hard bounces, complaints, unsubscribes, and repeated soft bounces suppress marketing. Order letters stay separate.
- Klaviyo is an optional key and an optional sender. Import does not subscribe people. Rebuilt flows stay off.
- Discount codes are not used as a channel guess. Orders that never hit a Jourvance page stay off the funnel.
- The map, the email screen, and attribution agree to show a blank instead of a made-up rate.

### File size, because it is how bugs hide

| File | Lines |
| --- | --- |
| `server/routes/publicRoutes.mjs` | 5222 |
| `server.mjs` | 4879 |
| `src/components/drawers/PageEditor.tsx` | 3517 |
| `src/components/campaign/HubEmailSuite.tsx` | 3220 |
| `server/routes/emailRoutes.mjs` | 1543 |
| `server/routes/shopifyRoutes.mjs` | 1455 |
| `src/App.tsx` | 1312 |
| `server/routes/analyticsRoutes.mjs` | 1053 |

Route files exist, and the public page renderer is now the largest file. A change to a landing page, an upsell, a review portal, and a lead form still lands in one module.

## Update log

- **2026-10-07, billing checkout.** Restored the homepage Growth Pro prices. `POST /api/billing/checkout` starts a Stripe subscription at $49 a month or $468 a year. A paid webhook sets the account to pro. No Stripe key is set, so checkout returns 503 and charges nothing. `billing.test.mjs` and `honesty-copy.test.mjs` passed (12). `tsc --noEmit` exited 0. The API was not started.
- **2026-10-07, honesty copy.** Took Growth Pro and the Starter limits off the homepage and the billing modal. Waitlist stays, and it records no plan. Sidebar and canvas header call `isOperator`. The operator line uses `OPERATOR_EMAIL`. Unused Shopify simulate handlers are deleted. The email report and the sending screen say opens stay blank until `MAIL_EVENT_SECRET` is set. `npm test` is `node --test`: 1762 passed, 0 failed, 3 skipped. A page on `demo.myshopify.com` loads again. The other sample hosts, slugs, and four sample store domains stay refused. `tsc --noEmit` exited 0. The API was not started. Nothing was committed.
- **2026-10-07, boot hold.** Stopped the 52 active fixture enrollments (`stoppedReason` `fixture`, 0 active left). The cron route mounts only when `INTERNAL_CRON_SECRET` is set. Sample hosts and the three leftover sample storefronts (`vip-glow-kit`, `duo-glow-bundle`, `wave4-elixir`) are refused on read and removed from the local page file. `saas-growth-funnel` remains. Six customer JSON files are gitignored and staged for removal from the index, not committed. `node --check` passed. `boot-safety.test.mjs` and `upsell-recovery.test.mjs` passed (21 tests). The API was not started.
- **2026-10-07.** Replaced the previous roadmap. It had marked durability, the drip runner, slug ownership, and code-splitting as fixed, and those code checks hold. It had also marked a $49 plan, invented coupons, curated reviews, and a demo catalog as product, and those do not match the current honesty rules or the current tests. This pass did not click the UI and did not run the 155 test files.
