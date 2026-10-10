# Email Studio: the plan

Owner ask (2026-10-08): "I am in the email studio and its confusing, we need to make it more
intuitive. Also I cant click in and edit email sequences, or get to the builder." Build it with
Opus and Sonnet agents; the main session plans, reviews and commits.

This file is the kept plan, in the shape of `LANDING_BUILDER_PLAN.md`. A wave is done when its
acceptance list is green, its evidence is in `JOURVANCE_RUNNING_AUDIT.md`, and the main session
has committed it. Agents never commit.

**How claims are labelled (Truth Protocol).** VERIFIED: the planner read the file or ran the
command in this session, cited by file and line. "Reported by <agent>": a surveyor saw it and the
planner did not re-run it (where the planner re-read the surveyor's own result file, that is
said). INFERRED: reasoning, not checked. UNKNOWN: not known.

The surveys (2026-10-08, session scratchpad `email-survey/`): a **Chrome reproducer** (Opus,
headless Chromium on a scratch copy of HEAD `7b6c767`, secrets blanked, sign-in stood in by
`dev-test-token`, stores empty), a **code map** (Opus, source only) and a **heuristic
evaluation** (Sonnet, source only).

## What the owner sees

### "I can't click in and edit email sequences"

The five starter sequences (Welcome sequence, Shopify Abandoned Cart & Checkout Recovery,
Post-Purchase Courtesy Offer, At-Risk Inactive Client Winback, Post-Purchase Review & Social
Proof Engine) cannot be edited anywhere. Three causes stack.

1. **The cards on the default tab have no click handler.** Email Studio opens on "Automations"
   (`HubEmailSuite.tsx:151`, `useState<EmailStudioTab>(initialTab || 'flows')`, VERIFIED). Each
   sequence is listed there twice: a row from `EmailPrograms.tsx:195-200` (a plain `div`,
   VERIFIED) and a card under "Queue sequences" (`HubEmailSuite.tsx:803-980`). Reported by the
   code map: the only click handlers on the whole tab are Run Queue Tick (720), Webhooks (743),
   Refresh (763), Open Cart (1056) and the exports (1120, 1145, 1170). Reported by the Chrome
   reproducer: 22 clicks on sequence and automation names, every one with no change and
   `cursor: auto`. The planner re-counted its `results-auth.json` (29 targets, 22 clicked, 22
   with nothing happening) and did not re-run the browser.
2. **On the Flow map they are served read-only.** `GET /api/email/flow-map` marks every sequence
   `editable: false` with the note "Shared queue sequence..." (`server.mjs:3611-3622`, VERIFIED)
   and both built-in automations the same way (`server.mjs:3623-3632`, VERIFIED). The edit panel
   renders only when `current?.editable` (`EmailFlowMap.tsx:558`, VERIFIED), a node click only
   calls `setSelected` (`EmailFlowMap.tsx:553`, VERIFIED), and the node does not draw its
   selected state (`EmailFlowMap.tsx:95-108`, VERIFIED). So clicking Welcome's Email node changes
   nothing on screen. Reported by the Chrome reproducer, re-counted by the planner from
   `results-auth.json`: 7 of the 12 Flow map entries (2 automations, 5 sequences) show 0 inputs
   and no Save, and a click on their Email node does nothing. The 5 account flows are editable.
3. **There is nowhere to save an edit.** The sequences are one shared copy for every account,
   loaded from the hub store `store.drips` (`server.mjs:1071`, VERIFIED) and seeded with no
   `userId` (`server.mjs:896-1065`, VERIFIED). The only routes are GET and POST create
   (`server/routes/emailRoutes.mjs:1447`, `:1456`, VERIFIED). The code map's grep found no update
   route.

The surveyors agree. The heuristic evaluation left "is Welcome editable on the Flow map" UNKNOWN.
The browser run and `server.mjs:3617` settle it (read-only), and a browser run plus the server
line is stronger evidence than a source-only reading. One citation was wrong: the Chrome reproducer
placed `chooseFlowId` at `editorReturn.ts:83-86`; it is at `editorReturn.ts:70-73` (VERIFIED).

### "I can't get to the builder"

The block email builder (`BlockEditor`, `EmailBlocks.tsx:137-186`) is mounted in exactly two
places: the Builder tab (`EmailPrograms.tsx:273`) and each order letter (`EmailPrograms.tsx:378`).
Both lines are VERIFIED, and the code map's grep of `src` found no third. There is no way in from
a sequence, an automation or a flow:

- A flow's Email step edits its body in one textarea that rewrites the whole email as a single
  text block on every keystroke (`EmailFlowMap.tsx:737-738`, VERIFIED).
- An automation step is a subject input and a textarea that does the same
  (`EmailPrograms.tsx:323-352`, line 345; reported by the code map and the heuristic evaluation).
- The Builder tab (4th of 12, `HubEmailSuite.tsx:646`) is a blank one-off composer whose only
  outcome is Send (`EmailPrograms.tsx:261-313`, Send at 305, VERIFIED). Nothing loads an existing
  email into it and nothing saves it. Reported by the code map: its draft is lost when you switch
  tabs.

The owner could have meant any of three things: no "edit this email in the builder" anywhere,
a Builder tab that cannot open an existing email, or a builder hidden as the 4th of twelve tabs.
Which one is UNKNOWN, so the plan fixes all three.

### Found on the way, worse than confusing (read these first)

- **The starter Welcome emails are placeholders, and nothing stops them from sending.** The three
  Welcome bodies say "Replace it with ... before anyone receives it" (`server.mjs:911`, `920`,
  `929`, VERIFIED), and a migration rewrites older copy into that placeholder
  (`server.mjs:1100-1116`, VERIFIED). Every captured lead is enrolled in the first `lead_capture`
  sequence unless double opt-in is unconfirmed or Klaviyo is the sender
  (`server/routes/publicRoutes.mjs:4624-4650`, VERIFIED). The runner ticks every 60 seconds
  (`server.mjs:3370-3374`, started at `5122`, VERIFIED), and the sender sends `step.body` as
  written (`server.mjs:3094`, `3120`, VERIFIED). The repo already treats this as a defect for the
  winback seed and fixed only that one (`server/seededOffers.mjs:29-30`, VERIFIED). INFERRED: a
  lead captured on any merchant's page is sent the placeholder Welcome emails whenever the hub is
  sending. Per the audit (recorded 2026-10-07 and 2026-10-08, not re-checked by the planner), hub
  sending for this app was paused by the bounce guard, and that pause may be the only thing holding
  them back. Whether any lead has received one is UNKNOWN. The hub's send log, filtered to
  `medium: 'drip'`, would answer it. Wave 2 skips unedited starter drafts (owner question 1).
- **A copy of a sequence would send twice.** The lead path enrolls the shared sequence AND every
  account flow on the same trigger (`publicRoutes.mjs:4624-4650`, then `:4676-4677`, VERIFIED).
  An "editable copy" that does not stand the shared one down would send two welcome series.
  Decision D5 avoids this.
- **The textareas flatten rich emails** (INFERRED from `EmailFlowMap.tsx:738` and
  `EmailPrograms.tsx:345`; never exercised). Wave 1 retires both. Otherwise, once the builder can
  put an image into an automation step, the old textarea would delete it.

### Sandbox artefacts, and what the live site does instead

- The Chrome run blanked `HUB_API_KEY`, so Inbox, Texts and part of DNS & Deliverability answered
  503 "Email sending is not connected." (reported by the Chrome reproducer). That is the sandbox,
  not the product. Per the audit (2026-10-07, not re-checked), the live service has the hub key
  set, so those reads go to the hub. Whether they render correctly live is UNKNOWN (not driven).
  Underneath is one real bug that shows live whenever a read fails: Inbox prints "No replies have
  arrived for this account." even after "The inbox could not be loaded." (`EmailInbox.tsx:31`,
  `38`, `92`, VERIFIED). Wave 6 fixes it.
- "Opens stay blank until MAIL_EVENT_SECRET and a public https PUBLIC_BASE_URL are set." appeared
  because the run blanked those variables. Per the audit, live has both (not re-checked), so
  INFERRED it does not show live.
- Signed out, every studio read answers 401, and the Flow map shows an empty list with no sentence
  (reported by the Chrome reproducer). That is a real bug, but not the owner's case (INFERRED: the
  owner is signed in). Wave 6.
- **Not artefacts: the dead clicks and the missing path to the builder.** The studio files are the
  same in the deployed commit `4b1cf75` and in HEAD: `git diff --stat 4b1cf75 HEAD` over the
  studio components, `editorReturn.ts`, `flowMapLoad.ts`, `server.mjs`, `emailRoutes.mjs`,
  `publicRoutes.mjs` and `App.tsx` printed nothing (exit 0). That `4b1cf75` is what jourvance.com
  serves comes from the audit and was not re-checked.

### How this work must be tested (a safety finding)

`scratchpad/run-check.mjs` sandboxes nothing. It spawns the repo's own `server.mjs` with a
scratch working directory (`run-check.mjs:5-6`, VERIFIED). But `server.mjs` loads `.env` from its
own directory (`server.mjs:155`, VERIFIED) and writes its stores beside itself (`journeys.json` at
`server.mjs:235`, VERIFIED; the Chrome reproducer lists more). INFERRED: a boot that way reads the
live `.env` for every variable it did not blank, and writes the repo's gitignored stores. The
landing builder waves list that boot in their hand-back, so whether those runs touched the stores
is UNKNOWN (owner question 13). No wave in this plan boots `server.mjs`. Route tests mount a route
module on a bare Express app (`JOURNEY_UI_HANDOFF.md:98`). The browser check answers `/api` with
recorded JSON, as `scripts/builder-browser-check.mjs` does, and never starts the server.

## Decisions

### D1. Five destinations, each with one primary action

| Destination | Absorbs today's tabs | Sections inside (second level) | Primary action |
|---|---|---|---|
| **Flows** (opens here) | Automations, Flow map, Order letters | one list of every flow; the flow editor (the map with the step panel beside it); order emails as a group in the list | New flow |
| **Broadcasts** | Broadcasts, Builder | the list of broadcasts; the composer (the builder plus audience and schedule) | New broadcast |
| **Audience** | Audience, Forms, Inbox | People (lists, segments, RFM), Sign-up forms, Replies, Open checkouts | New segment |
| **Results** | Deliverability (the metrics tab) | one summary row, then the detail | none (read only) |
| **Settings** | DNS & Deliverability, Klaviyo, Texts | Sending, Klaviyo, Texts (Soon), Advanced (Send due emails now, Webhooks, Account timezone) | the section's own (for example Verify domain) |

- The strip is `role="tablist"`. Each destination is `role="tab"` with `aria-selected` and
  `aria-controls`, and Left and Right move between them. The second level is a smaller tablist of
  the same kind. Active state is never colour alone.
- At 360 to 399 px wide the top strip takes at most two rows (today: six rows and 252 px at 390,
  reported by the Chrome reproducer).
- Off the default screen: Run Queue Tick, Webhooks and Refresh (to Settings, Advanced); the
  duplicate "Queue sequences" section and the duplicate rows; the Abandoned checkouts table (to
  Audience, Open checkouts). Hub flows (export only, `GET /api/email/flows`) become a collapsed
  group at the foot of the Flows list, "From the hub, export only".
- Why: top level capped at five to seven (Hick, Miller), one dominant action per screen, setup
  kept out of daily work (`saas-ui-psychology`, loaded for this plan). The two tabs both called
  Deliverability are gone: the metrics are Results, the setup is Settings, Sending.

### D2. One word per concept

| Concept | The one word | Retired in UI copy | Note |
|---|---|---|---|
| Emails (and texts) that send on their own when something happens | **Flow** | automation, sequence, queue sequence, drip, series, program | Matches the canvas's pinned "Edit this flow in Email Studio" and Klaviyo's word |
| A flow every account starts with, edited per account | **Starter flow** | shared queue sequence | Row tag: Starter |
| A flow built into Jourvance that you turn on (After the order, Quiet buyers) | **Built-in flow** | automation | Row tag: Built in |
| Order confirmation, shipping, cancelled, refund | **Order email** | order letter, transactional letter | Row tag: Order email |
| One email in a flow or a broadcast | **Email** | letter, note | "Step" stays for any box on a flow map (Wait, Email, Text, Check) |
| One email sent once to a list or segment | **Broadcast** | campaign, campaign broadcast | "Campaign" means ads elsewhere in Jourvance |
| Where you design an email from blocks | **Builder** | Email builder tab, ESP campaign builder | Never a tab: opened from an email |
| A piece of an email | **Block** | | |
| What starts a flow | **Starts when** | trigger | Already the Flow map's label |
| Running due sends by hand | **Send due emails now** | Run Queue Tick, queue tick | Settings, Advanced |
| Numbers about what was sent | **Results** | Deliverability (metrics), Analytics | |
| Domain, DNS and sender | **Sending** | DNS & Deliverability | |

Unchanged on purpose: the page title "Email Studio & E-Commerce Flows" (pinned by
`email-studio-fit.test.mjs:40-50`) and the canvas node name "Follow-Up Sequence" (pinned across
the SequenceEditor tests, and outside the studio). Code identifiers (`drips`, `programs`,
`EmailPrograms`) are not renamed.

### D3. How a flow is opened for editing

- **From Flows (Wave 4 on):** every row is one button. It opens the flow editor with that flow and
  selects its first email. On a starter flow the step panel says: "This starter flow is shared by
  every account. Your edits to its emails apply to this account only."
- **From today's Automations tab (Wave 1, until Wave 4 replaces it):** each starter card and row,
  and each built-in card, gets "Edit emails"; each email tile on a starter card is a button that
  opens that email.
- **From the canvas step:** "Edit this flow in Email Studio" opens Flows with the linked flow (the
  round trip as today). "Build a flow in Email Studio" (Wave 7) creates a flow from the step's
  emails, links it, saves the journey, then opens it, so the owner never has to come back to
  choose it.
- **On the map:** a node click draws the selection, moves focus to the step panel's heading
  ("Email 2 of 3") and shows the step's fields beside the map at 900 px and wider, below it on
  narrower screens.
- **What each kind allows:** a starter or built-in flow allows editing its emails (subject,
  preview text, the email in the builder) and its waits; its steps and its start stay fixed. An
  account flow allows everything it allows today.

### D4. How the builder is reached

- **From an email in any flow:** the step panel's email field IS the builder (`BlockEditor`, with
  saved blocks). Wave 5 adds Preview at desktop and mobile width, Check this email and Send a test
  to me. The flow's one Save saves it.
- **From Broadcasts:** New broadcast opens the composer, which is the builder plus audience,
  schedule, A/B and holdout. `POST /api/email/campaign/send` already takes `blocks` together with
  all of those (`emailRoutes.mjs:1252-1290`, VERIFIED), so no new send route is needed. The modal
  with a plain textarea body is retired.
- **Standalone:** there is no standalone Builder tab. "Design an email without sending it" is a
  broadcast saved as a draft (Wave 5, owner question 9).
- **Order emails:** already use the builder (`EmailPrograms.tsx:378`). They gain the saved-block
  library, which is passed as `library={[]}` today (VERIFIED).

### D5. Starter flows are edited per account, through the one sender that sends them

A per-account content layer sits over the shared sequence, in the account's own program record,
the way built-in flows already work: `userProgramBag` merges `saved.automations[id].steps` over
the defaults through `cleanSteps` (`server.mjs:1663-1697`, VERIFIED). The drip sender reads the
merged steps, so the trigger, smart exit, checkout link, voucher and review link behave exactly as
now, and nobody is enrolled twice.

Rejected: copying the sequence into a new account flow. The lead path would then enroll both
(`publicRoutes.mjs:4624-4677`, VERIFIED) unless all seven enrollment points
(`publicRoutes.mjs:4627`, `4895`, `5011`; `server.mjs:2985`, `3264`; `shopifyRoutes.mjs:1178`,
`1281`; VERIFIED by grep) learned to stand the shared one down.

An edit reaches people already in the flow from their next due email, because the sender reads
the steps at send time. The Saved sentence says so (D6).

### D6. Empty, failed and not-connected copy

No em dash, no spaced en dash. Retry only where retrying can help. Never "no replies", "none" or
"0" from a read that failed.

| Where | State | Copy | Retry |
|---|---|---|---|
| Flows list | the server did not answer | The flows could not be loaded. The server did not answer. (`FLOW_MAP_UNREACHABLE`, pinned) | yes |
| Flows list | 401 | Sign in to see this account's flows. | no |
| Flows list | any other error | The flows could not be loaded. Try again in a minute. | yes |
| Flows list | loaded, no flows of the account's own | No flows of your own yet. New flow starts one that stays off until you turn it on. | no |
| Flows, any flow | `hubConnected` false | Email sending is not connected on this server, so nothing in these flows sends yet. Your changes still save. | no |
| Step panel | starter draft still unedited (Wave 2) | This email is still the starter draft, so it is skipped and not sent. Edit it and save to send it. | no |
| Step panel | saved | Saved. Every email sent from now on uses this version, including for people already in this flow. | no |
| Step panel | save not answered | The server did not answer, so these emails may not be saved. (new `FLOW_MAP_WRITE_UNREACHABLE.content`) | the Save button |
| Broadcasts | failed read | Broadcasts could not be loaded. | yes |
| Broadcasts | loaded, none | No broadcasts yet. New broadcast opens the builder. | no |
| Results | loading | Loading results. | no |
| Results | failed | Results could not be loaded. | yes |
| Results | nothing sent | Nothing has been sent yet, so there are no results. | no |
| Replies | failed | The replies could not be loaded. (and never "No replies have arrived" beside it) | yes |
| Replies | not connected | Replies cannot be read while email sending is not connected. | no |
| Builder | test send while not connected | A test cannot be sent while email sending is not connected. | no |
| Texts | failed status read | Text messaging status could not be loaded. (today a console warning only, `SmsPanel.tsx:47-49`, reported by the code map) | yes |

The live site, as opposed to the sandbox's 503s: INFERRED that the not-connected sentences appear
only on a server with no hub key. A paused hub is not "not connected". The pause belongs in
Settings, Sending; whether that section shows a pause today is UNKNOWN.

### D7. The editor round trip is kept

The six rules come from `src/lib/editorReturn.ts:1-92` and the comments at `App.tsx:145-156` and
`621-638`. `JOURNEY_UI_HANDOFF.md` has no round-trip section of its own (VERIFIED: its item B is
about invented products).

1. A step opens Email Studio only after the journey saved (`openAfterSave`); a failed save keeps
   the user on the step and says `STUDIO_NOT_OPENED`.
2. The return lives in App state only; a reload lands on the map with no banner.
3. One return per trip; leaving Email Studio clears it.
4. Every way back goes through `showCanvas`; while the banner shows, it is the only way back.
5. A missing linked flow is reported only when the list really loaded and the step asked for it.
6. The canvas frames the returned step at no more than 100% zoom.

What changes, and why the rules still hold:

- A button inside the studio (Edit emails) passes `fromStep={false}`, so it never shows "The flow
  this step links to was not found." Rule 5 stays true.
- `'map'` stays a valid `EmailStudioTab` value, meaning Flows with the editor open, because
  `App.tsx` passes it (`editor-return-wiring.test.mjs:56`, VERIFIED).
- Wave 7's "Build a flow" creates and links the flow, then opens the studio through the same
  `openAfterSave`, so rule 1 holds.

### D8. What stays unchanged

The server's send rules, triggers, smart exit, coupon minting and Klaviyo handoff; what an account
flow can do in the editor; the round trip; the page title; Link Shopify Store and Back to Canvas;
the SequenceEditor drawer until Wave 7; every route that exists today (Wave 1 adds one, Wave 5 adds
one); no new npm dependency.

### D9. Pinned tests and the one-line changes they need

| Test and line | Pins today | Change | Wave |
|---|---|---|---|
| `editor-return.test.mjs:113` | `<EmailFlowMap initialFlowId={openFlowId}` | becomes `<EmailFlowMap initialFlowId={mapFlowId \|\| openFlowId}` | 1 |
| `editor-return.test.mjs:117` | `load(initialFlowId, true)` | becomes `load(initialFlowId, fromStep)`, plus an assertion that HubEmailSuite passes `fromStep={!mapFlowId}` | 1 |
| `flow-map-load.test.mjs:94` | the six write keys | adds `'content'` | 1 |
| `flow-map-load.test.mjs:104` | exactly 9 fetch lines, "three reads and six writes" | 10, "three reads and seven writes" | 1 |
| `flow-map-load.test.mjs:108` | the write route table | adds `` ['content', '`/api/email/flow-content/${next.id}`, {'] `` | 1 |
| `email-studio-fit.test.mjs:26` | finds the Soon badge by the literal `{(tab as any).badge}` | the literal that renders the badge after it moves to Settings | 3 |
| `email-studio-fit.test.mjs:21` | more than 50 font sizes in `HubEmailSuite.tsx` | none needed if it stays above 50: 193 today, 31 in the Automations tab, 66 in lines 2298 to 3225 (VERIFIED count). If a split takes it under 50, read every studio file instead | 4, 5 |
| `email-stats.test.mjs:49-50` | `statText(seq.attributedSales` in `HubEmailSuite.tsx` (at line 880, on the starter card) | the starter row in the new Flows list prints revenue through the same helper; if it lives in a new file, the needle reads that file | 4 |
| `seeded-offers.test.mjs:247` | scans `setBroadcast(Subject\|PreviewText\|Body)(...)` in `HubEmailSuite.tsx` with `\|\| []` | when the composer moves, point it at the new file AND assert at least one match, or it passes while checking nothing | 5 |
| `editor-return-wiring.test.mjs:56` | `initialTab={funnelReturn ? 'map' : undefined}` | none: `'map'` stays valid | all |
| `flow-map-load.test.mjs:63` | `<h2 ref={headingRef} tabIndex={-1}...>Flow map</h2>` | none: the editor keeps that heading | all |
| `honesty-copy.test.mjs` | `OPENS_UNSTORED` in `HubEmailSuite.tsx` and `SendingSetup.tsx` | none, unless Results moves out of `HubEmailSuite.tsx`; then the pin reads the new file | 3 |
| eleven files that read `SequenceEditor.tsx` | its source shapes | listed pin by pin in the audit before Wave 7 edits anything | 7 |

### D10. How every wave is verified

Each agent reads `.claude/rules/truth-protocol.md` and this file before starting. Before
hand-back it runs `npx tsc --noEmit`, `npm test`, `npx vite build --outDir <its scratchpad>` and
`node scripts/email-studio-browser-check.mjs`, and reads each exit code directly (never through
`| tail`). Every new test is seen red under a named planted fault, then restored by inverting the
exact edit and confirmed with `cmp` against a copy taken before the plant. Never start
`server.mjs`, never run `scratchpad/run-check.mjs`, never read `.env`. Evidence is labelled. Also
binding: no em dash in user-facing copy, 11 px minimum text, no horizontal scroll at 390 px,
keyboard and screen reader can do everything, no new dependency.

Skills each agent loads before designing: Waves 1, 3 and 4 load `cognitive-accessibility` and
`interaction-design`; Wave 6 loads `accessible-content` and `voice-and-tone`; Wave 8 loads
`design-review`, `heuristic-evaluation` and `synthetic-user-testing`.

## Waves

### Wave 1 (Opus): open a sequence, edit its emails in the builder

The smallest diff that ends both dead clicks. It ships alone and restructures no layout.

**Server**

1. `email-flow-content.mjs` (new, repo root, plain ESM, imports nothing; cleaners are injected):
   - `stepsFromChain({ nodes, edges }, baseSteps)` answers `{ ok: true, steps }` or
     `{ ok: false, error }`. It walks from the trigger along single edges. Each email node takes
     the next base step in order (subject, previewText, blocks). A delay node before an email gives
     that step's `delayHours`. It refuses any other node type, a branch, a cycle, or an email count
     different from `baseSteps.length`.
   - `mergeAccountSteps(sharedSteps, accountSteps)` answers the shared steps, each with `subject`,
     `previewText`, `blocks` and `delayHours` taken from the account row with the same `id`.
     `id`, `stepNumber` and `discountVoucher` always come from the shared step. An account row
     whose id is not in the shared list is ignored; a step with no account row is unchanged.
   - `cleanAccountSequences(input, cleanSteps)`: at most 20 ids matching `^[A-Za-z0-9_-]{1,60}$`,
     each row through the injected `cleanSteps`, built so that `__proto__` and `constructor` are
     plain ids that never match a sequence.
2. `server.mjs`:
   - `userProgramBag` returns `sequences: cleanAccountSequences(saved.sequences, cleanSteps)`, and
     `writeUserPrograms` writes `sequences` with the
     `bag.sequences !== undefined ? bag.sequences : previous.sequences` fallback. Both build the
     record from an explicit field list (`server.mjs:1712`, `1791-1810`, VERIFIED), so leaving
     either out drops every edit on the next unrelated save.
   - `sequenceStepsFor(seq, bag)` is `mergeAccountSteps(seq.steps || [], bag.sequences?.[seq.id]?.steps)`.
   - `chainGraph` (`server.mjs:3480-3501`) also puts `previewText` on each email node. Today it
     carries only subject and blocks (`server.mjs:3495`, VERIFIED), so a save from the map would
     wipe every preview text.
   - `GET /api/email/flow-map`: sequences draw from `sequenceStepsFor(seq, bag)` and gain
     `contentEditable: true`; automations gain `contentEditable: true`; both notes become D3's
     sentences.
   - The drip sender in `processUserAutomationsTick`: read the bag once per tick, set
     `const steps = sequenceStepsFor(seq, bag)`, and read `steps` (never `seq.steps`) for the step
     (`server.mjs:3094`), the length check (`3164`) and the next step's delay (`3166-3167`). The
     email is `step.blocks?.length ? step.blocks : [{ kind: 'text', text: step.body || '' }]`
     (today a text block only, `server.mjs:3120`).
   - Mount the new route module with its own context literal. `route-context-gate.test.mjs` scans
     every `server/routes/*.mjs` and checks it.
3. `server/routes/emailFlowContentRoutes.mjs` (new): `POST /api/email/flow-content/:id`, behind
   `requireUser`.
   - `:id` resolves against the caller's visible sequences (`!seq.userId || seq.userId === uid`)
     and the built-in automations. Anything else, including another account's sequence, gets the
     same 404, `{ success: false, error: 'That flow is not on this account.' }`, and writes
     nothing.
   - The body `{ nodes, edges }` goes through `stepsFromChain` against the merged steps. A refusal
     is a 400 with one sentence ("These emails could not be saved, because the flow's steps
     changed. Reload it and try again.") and writes nothing.
   - A sequence saves `bag.sequences[id] = { steps }`. An automation saves
     `row.steps = cleanSteps(...)` and keeps `enabled`.
   - The answer is `{ success: true, flow }`, in the shape of a flow-map row.
4. `server/routes/emailRoutes.mjs`, `GET /api/drips/sequences`: apply the ownership filter the
   flow map uses (today it returns every sequence, `emailRoutes.mjs:1447-1453`, VERIFIED), and
   return the merged steps, so the Automations cards show the account's own subjects.

**Client**

5. `HubEmailSuite.tsx`:
   - Add `mapFlowId` and `mapNodeId` state, and `openFlowInMap(flowId, nodeId?)`, which sets both
     and then calls `setActiveTab('map')`. A click on the tab strip clears both.
   - Each starter card header gets a button "Edit emails" with `aria-label` "Edit emails in
     <name>". Each email tile (`884-930`) becomes a `<button type="button">` labelled "Email N of
     M", opening `<seq.id>_email_<index>` (the id `chainGraph` gives, `server.mjs:3491`, VERIFIED).
   - Render `<EmailFlowMap initialFlowId={mapFlowId || openFlowId} initialNodeId={mapNodeId} fromStep={!mapFlowId} />`.
   - The "Completed 3-Steps" label (874) and "Step N of 3" (956) read the real step count.
6. `EmailPrograms.tsx`:
   - Add an `onOpenFlow?: (id: string) => void` prop. The starter rows (195-200) get "Edit emails".
     Their `id` is the sequence id (`server.mjs:2849-2854`, VERIFIED).
   - `AutomationCard` loses its subject inputs, its textarea and Save steps. Each step reads
     "Email N: <subject> · wait N hours", the card gets "Edit emails", and Turn on and Turn off stay.
   - The contradictory intro (189-192) becomes: "Starter flows run for every new lead or checkout.
     Built-in flows stay off until you turn them on."
7. `EmailFlowMap.tsx`:
   - `FlowView` gains `contentEditable?: boolean`. Props gain `initialNodeId?: string` and
     `fromStep = true`, and the mount effect calls `load(initialFlowId, fromStep)`.
   - Once the list loads, select `initialNodeId` if the chosen flow has it. Otherwise, for a
     content-editable flow opened from inside the studio, select its first email.
   - `MailNode` reads `selected` and draws a 2 px `#f472b6` border.
   - The step panel shows for `current?.editable || current?.contentEditable`. Flow-level controls
     stay `editable` only: Name, Starts when, Re-entry, timezone, the Add buttons, Remove step,
     Connect, Delete, Turn on and off.
   - On the email node, both kinds get Subject, Preview text and
     `<BlockEditor blocks={selectedNode.blocks} onChange={(blocks) => patchNode(selectedNode.id, { blocks })} />`
     in place of the textarea. The Klaviyo HTML branch (`blocks[0].kind === 'html'`) is unchanged.
     Status, smart skip, send time, transactional, holdout, from name, reply-to and the Klaviyo
     picker stay `editable` only, because the drip sender reads none of them
     (`server.mjs:3094-3135`, VERIFIED).
   - On a wait node of a content-editable flow: one number field, "Wait, in hours", from 1 to 2160.
     `cleanSteps` clamps at 2160 (`server.mjs:1667`, VERIFIED). 0 is refused, because the sender
     reads 0 as 24 (`server.mjs:3167`, VERIFIED).
   - Above the node's fields, `<h3 ref={stepHeadingRef} tabIndex={-1}>Email 2 of 3</h3>`. When a
     node is selected, focus moves to that heading and it scrolls into view with
     `behavior: 'auto'`.
   - Save on a content-editable flow is a new `saveContent(next)`: one
     ``sendFlowWrite(async () => fetch(`/api/email/flow-content/${next.id}`, {`` line, then the
     pinned `if (!sent.answered) { setNotice(FLOW_MAP_WRITE_UNREACHABLE.content); return; }`.
   - `FlowNode.blocks` widens to the `MailBlock` type from `EmailBlocks.tsx`.
8. `src/lib/flowMapLoad.ts`: add `content: 'The server did not answer, so these emails may not be saved.'`.

**Tests** (each seen red under its plant)

- `email-flow-content.test.mjs` (pure):
  - `stepsFromChain` round-trips the five seeded sequences and the two built-in flows. Read the
    seeds out of `server.mjs` without booting it, the way `seeded-offers.test.mjs:20-26` does.
  - It refuses an extra email, a missing email, a branch, a cycle and an unknown node type. Delays
    land on the right step.
  - Image, button and columns blocks survive.
  - `mergeAccountSteps` keeps `id`, `stepNumber` and `discountVoucher` from the shared step, and
    still matches by id after the shared list is reordered.
  - `__proto__` and `constructor` ids change nothing.
  - Plants: merge by index instead of by id; drop `blocks` in the merge.
- `email-flow-content-route.test.mjs`: mounts the module on a bare Express app with a stub context
  (the `stubCtx` proxy at `seeded-offers.test.mjs:28`).
  - No user is 401.
  - A save on a shared sequence writes only the caller's record.
  - Another account's sequence gets the same 404 body as a missing id, and nothing is written.
  - An automation keeps `enabled`.
  - A malformed graph is 400 and writes nothing.
  - The answer carries the saved subject, preview text and blocks.
  - Plant: remove the ownership filter (the foreign-sequence check goes red).
- `email-studio-open.test.mjs` (source pins):
  - Starter rows and cards carry `type="button"` and "Edit emails". `AutomationCard` has no
    `<textarea`.
  - The email branch of `EmailFlowMap.tsx` mounts `<BlockEditor`, and `MailNode` reads `selected`.
  - The panel gate includes `contentEditable`.
  - The sender calls `sequenceStepsFor(` and no longer reads `seq.steps[enr.currentStepIndex]`.
  - `writeUserPrograms` carries `sequences` with the `previous.sequences` fallback, and
    `chainGraph` writes `previewText`.
  - Plant: drop `contentEditable` from the gate.
- The five Wave 1 pin edits in D9.

**Browser check:** new `scripts/email-studio-browser-check.mjs`, modelled on
`builder-browser-check.mjs`:
- It builds with Vite into a temp dir with an empty envDir, sets `preview.proxy = {}`, aborts every
  request that leaves the preview origin, and runs real Chrome at 1440x900.
- Every `/api` request is answered with JSON in the real routes' shapes, built from the seeds read
  out of `server.mjs` and the `chainGraph` shape. The stub for `POST /api/email/flow-content/:id`
  records each body.
- It never starts `server.mjs`. It proves the client, not the server routes; the route test covers
  those.

Steps:

1. `open`: sidebar "Email Studio"; the studio heading is visible.
2. `starter-open`: on Automations, press "Edit emails" on Welcome sequence. Flow map is active,
   Welcome is selected, and the step heading reads "Email 1 of 3" and holds focus.
3. `email-open`: back on Automations, press "Email 2 of 3" on the Welcome card. Email 2 is
   selected.
4. `node-selected`: click the Wait node. Its border colour differs from an unselected node's, and
   the panel shows "Wait, in hours".
5. `builder-in-step`: on Email 1, press "Add image" and "Add button" in the panel. Both blocks
   appear.
6. `save-content`: Save. The stub received one POST to `/api/email/flow-content/drip_seq_default`
   whose nodes carry the edited subject, the preview text and both new blocks, and the Saved
   sentence is in the status region.
7. `cards-show-edit`: on Automations, the Welcome card shows the edited subject.
8. `built-in`: "Edit emails" on After the order opens it with the builder, and that card has no
   textarea.
9. `account-flow`: on Viewed a product, the Email step shows the builder and the existing advanced
   options, and Save posts blocks to `/api/email/flows/<id>`.
10. `save-unanswered`: the flow-content stub aborts, and the notice reads
    `FLOW_MAP_WRITE_UNREACHABLE.content`.
11. `keyboard`: Tab reaches "Edit emails", Enter opens the editor, and focus is on the step
    heading.
12. `narrow`: at 390x844 with the builder open, `document.documentElement.scrollWidth` is 390.
13. `no-dash`: the studio's visible text holds no em dash and no spaced en dash.

Plant for the check: remove the onClick from "Edit emails" (step 2 goes red).

**Acceptance**

- Every starter flow and both built-in flows open from Automations into an editor where their
  emails are edited in the builder and saved. Account flows' emails are edited in the builder.
- `npx tsc --noEmit` exit 0. The three new suites pass, each seen red. The five changed pins pass.
  `route-context-gate.test.mjs` passes. `npm test`: 0 fail, and the count only grows.
- The browser check passes all 13 steps and was seen red once. `vite build` exit 0.
- No em dash in any touched file. No server boot. `git status` lists only the files named here,
  plus the audit section and this file's Status row.

### Wave 2 (Sonnet): starter drafts are skipped, and a starter flow can be turned off

It follows Wave 1 (same sender lines, same `sequences` record). Owner question 1 must be answered
before it merges, because it changes what live leads receive.

- `email-flow-content.mjs` gains `isStarterDraft(step)`: true when the effective step's body is,
  word for word, a seeded placeholder (`server.mjs:911`, `920`, `929`, `1110`, `1115`), and never
  for a step the merchant edited.
- The sender skips an unedited starter draft and moves the enrollment on. `history` records
  `status: 'skipped', reason: 'starter_draft'` (the meaning of a flow's "Draft, skipped"). Nothing
  is sent and nothing is counted as sent.
- Per-account switch: `bag.sequences[id].enabled`, where absent means on (today's behaviour). One
  helper, `starterFlowOnFor(uid, seqId)`, is called at the seven enrollment points in D5. The Flow
  map header and the starter cards get Turn on and Turn off, posting `{ enabled }` to the
  flow-content route.
- At `server.mjs:3167`, a stored 0 is no longer read as 24; only an absent delay is.
- Tests:
  - `starter-drafts.test.mjs`: the predicate over every seed, and an edited body never matches.
    Plant: match on subject only.
  - The route test grows `enabled` cases.
  - A source pin that all seven call sites call the helper (count 7). Plant: remove one call.
- Browser steps:
  - `starter-draft-note`: Welcome's Email 1 shows the D6 starter-draft sentence until edited, and
    it is gone after Save.
  - `starter-off`: Turn off on Welcome posts `{ enabled: false }`, and the row reads Off.
- Acceptance: as Wave 1's gates. The planted reds are reported.

### Wave 3 (Opus): five destinations

- `src/lib/emailStudioNav.ts` (new): the destinations, their sections, and `LEGACY_TAB`, which maps
  all twelve of today's keys (`'map'` included) to a destination and section. `EmailStudioTab`
  stays exported from `HubEmailSuite.tsx`.
- `HubEmailSuite.tsx`:
  - The strip becomes the D1 tablist (five tabs, keyboard per the WAI-ARIA tabs pattern), with a
    second-level tablist per destination.
  - Today's panels move under it without changes to their insides.
  - The "Hub Engine" badge goes (owner question 10). Run Queue Tick and Webhooks move to Settings,
    Advanced, renamed per D2. The Abandoned checkouts table moves to Audience, Open checkouts.
- Tests:
  - `email-studio-nav.test.mjs`: every legacy key maps; `'map'` lands on the Flows editor; no two
    sections share a label; no label has a dash. Plant: drop `sending` from `LEGACY_TAB`.
  - Source pins for `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls` and the arrow
    keys.
  - The D9 badge pin edit.
- Browser steps:
  - `nav-five`: exactly five top-level tabs, one selected.
  - `nav-keyboard`: ArrowRight moves both the selection and the focus.
  - `nav-from-step`: opened from a canvas step, the studio lands on Flows with the linked flow in
    the editor, and Back to funnel lands on the step.
  - `nav-390`: the strip takes at most two rows, with no horizontal scroll.
  - `nav-active`: the active tab reads 4.5 to 1 and is marked by more than colour.
- Acceptance: as Wave 1's gates. A run of the canvas check (`npm run check:canvas`) stays green,
  because the return lands on the canvas.

### Wave 4 (Opus): Flows is one list and one editor

- One list from `/api/email/flow-map`, plus the four order emails as one-email flows, plus the hub
  flows group.
  - A row shows: name, tag (Starter, Built in, Order email, or none), "Starts when" in words from
    `TRIGGER_META`, On or Off, the number of emails from the real steps, and enrolled through
    `statText`.
  - The duplicate starter cards, the duplicate rows and `AutomationCard` are removed.
- The flow-content route accepts an order-email id, saving subject and blocks the way
  `POST /api/email/programs/:id` does for the transactional kind (`emailRoutes.mjs:363-368`,
  VERIFIED), so one route serves every content edit.
- Editor layout: the map on the left and the step panel on the right at 900 px and wider. Flow
  settings (name, starts when, re-entry, timezone) are collapsed under "Flow settings". Delete asks
  first, naming the flow.
- Tests:
  - `email-flows-list.test.mjs`: the row model from a flow-map payload counts emails from the steps
    (never a constant), puts each flow in the list once, and words the start from `TRIGGER_META`.
    Plant: a constant count.
  - A pin that Delete confirms.
  - The D9 `email-stats` and font-size pins.
- Browser steps:
  - `flows-one-list`: each of the 12 flows and 4 order emails appears exactly once.
  - `flows-row-open`.
  - `order-email-builder`.
  - `delete-asks`: Cancel keeps the flow.
  - `panel-beside` at 1440: the panel's left edge is right of the map's right edge.
  - `panel-below` at 390.
- Acceptance: as Wave 1's gates.

### Wave 5 (Opus): Broadcasts with the builder

- New broadcast opens one composer with:
  - Subject, Preview text, and the builder with the saved-block library.
  - Audience include and exclude, Schedule, A/B, Holdout and the text add-on, taken from today's
    modal (`HubEmailSuite.tsx:2298-2808`).
  - Preview at desktop and mobile width, Check this email, and Send a test to me
    (`POST /api/email/send`, `server.mjs:4525`, VERIFIED to exist).
  - Send or Schedule behind a confirm that names the audience count the server reported, never the
    unmeasured fallback `count: 0` (`EmailPrograms.tsx:277`, VERIFIED).
- Drafts: a small new route module, `GET`, `POST` and `DELETE` at `/api/email/broadcast-drafts`,
  storing drafts in the account's program record (added to both explicit field lists). Owner
  question 9.
- The Builder tab is retired; its legacy key maps to Broadcasts, New broadcast. The textarea modal
  is retired.
- Tests:
  - A drafts route test: the tenancy 404 has the same body as a missing draft; a size cap; a write
    then a read.
  - A composer payload unit test: blocks, schedule, A/B and holdout as `campaign/send` reads them.
    Plant: drop `blocks`.
  - The D9 `seeded-offers` repoint.
- Browser steps:
  - `broadcast-new`: the builder is visible.
  - `broadcast-draft`: save, leave, come back; it is there.
  - `broadcast-test-send`.
  - `broadcast-confirm`: Send asks, naming the count.
  - `broadcast-payload`: the send stub received blocks and the schedule.
- Acceptance: as Wave 1's gates.

### Wave 6 (Sonnet): honest states and one vocabulary

- The D6 table, everywhere:
  - Flows: 401, other errors, empty.
  - Broadcasts: today a failed read shows "No broadcasts dispatched yet", `HubEmailSuite.tsx:1326`.
  - Results: today the tab renders nothing while `analytics` is null, `HubEmailSuite.tsx:2244`,
    VERIFIED.
  - Replies: `EmailInbox.tsx:92`.
  - Texts: `SmsPanel.tsx:47-49`.
  - `loadData`'s `.catch(() => ({}))` (`HubEmailSuite.tsx:271-280`, VERIFIED) becomes a per-list
    `loading | loaded | failed` state, the way `loadedCountSuffix` already works for Shopify Sync.
- The D2 vocabulary across the studio's visible copy. Enrollments are filtered by sequence id
  (today every card lists all of them, lines 934 and 953). "Smart Exit on Purchase Active" shows
  only when `smartExitOnPurchase` is true (847). The hard-coded hub-flow trigger goes (1113).
- Tests:
  - `email-studio-states.test.mjs`: each failure path renders its failure sentence and not the
    empty sentence. Plant: Inbox prints "No replies" after a failure.
  - A pin that the retired words are absent from the visible strings.
- Browser steps: `states-401`, `states-500`, `states-unanswered` and `states-empty`, for each
  destination, with stubs answering those statuses.
- Acceptance: as Wave 1's gates.

### Wave 7 (Opus): the canvas step and its flow are one thing

- "Build a flow in Email Studio" creates an account flow from the step's emails: subject, preview
  text, body as text blocks, delays as waits, and a start from the step's context or By hand. It
  links `jourvanceFlowId`, saves the journey through `openAfterSave`, and opens the new flow.
- SequenceEditor's "Flow Steps" become a read-only summary of the linked flow's emails, with "Edit
  in Email Studio" (owner question 6). Reported by the code map, from a grep, not run: the server
  never sends the step's own letters.
- The blueprint fields `hubFlowId` and `exportFormat` are read by nothing (reported by the code
  map). Map them to a created flow, or drop them.
- Before editing, the agent writes every SequenceEditor pin in the eleven test files (D9) and its
  change into the audit.
- Tests:
  - A unit test for a new pure `flowFromStepLetters` in `editorReturn.ts`. Plant: drop the delays.
  - A wiring pin that `openAfterSave` still wraps the open.
- Browser step `canvas-build-flow`: from the canvas, Build opens the Flows editor with the new flow
  selected and the step's subjects. Back to funnel lands on the step, and the step's picker shows
  the new flow chosen.
- Acceptance: as Wave 1's gates, plus `npm run check:canvas` and `npm run check:a11y` green.

### Wave 8 (Sonnet reviewers, then an Opus fix round): review and documentation

- `design-review` and `synthetic-user-testing` run on the built studio with the browser check's
  stubs. The heuristic evaluation's three tasks each take at most three clicks from the studio's
  first screen: edit the Welcome flow's second email; design an email from scratch; see what is
  live and turn one flow off.
- An adversarial reviewer gets the code, not this plan's conclusions. It is told to break tenancy
  on the flow-content and drafts routes, and to find a path where an edit is lost.
- The fix round. Then `JOURNEY_UI_HANDOFF.md` gets an "Email Studio" section (files, routes, the
  round trip, the browser check), and the audit gets its entry.

## Open questions for the owner (answered by default as written)

1. Skip unedited starter drafts (Wave 2), so the placeholder Welcome emails never send? Default
   yes. This changes what live leads receive.
2. Do edits to a starter flow apply to this account only? Default yes. The shared copy stays the
   base for every other account.
3. List order emails inside Flows? Default yes.
4. Hub flows as a collapsed export-only group at the foot of Flows? Default yes.
5. "Flow" as the one word, not "Automation"? Default Flow.
6. Retire the canvas step's own letters into its linked flow (Wave 7)? Default yes.
7. Texts (Soon) under Settings until it ships? Default yes.
8. Remove the Builder tab once New broadcast opens the builder? Default yes.
9. Keep broadcast drafts in the account's own record? Default yes.
10. Remove the "Hub Engine" badge? Default yes.
11. Allow adding or removing steps in a starter flow (a full copy that turns the starter off for
    this account)? Default no, not in this plan.
12. Keep "Opens stay blank until MAIL_EVENT_SECRET ..." naming variables to a merchant (pinned by
    `honesty-copy.test.mjs`)? Default unchanged in this plan.
13. Before Wave 1, should the main session check whether earlier `run-check.mjs` boots changed
    the repo's gitignored stores (their modification times against those runs)? Default yes, and
    nothing is restored without asking.

## Status

| Wave | State | Evidence |
|---|---|---|
| Survey | done 2026-10-08 | three surveyor notes in the session scratchpad (`email-survey/`); "What the owner sees" above |
| Plan | written 2026-10-08, reviewed by the main session; owner questions answered by default | this file |
| 1 | done 2026-10-08 | audit entry (Email Studio, Wave 1): tsc exit 0, npm test 2553 (2550 pass, 0 fail, 3 skipped), email-studio browser check 17 of 17, builder check 40 of 40, vite build exit 0, all re-run by the main session; planted reds and three review lenses reported by the agents |
| 2 | done 2026-10-08, owner said go | audit entry (Email Studio, Wave 2): drafts skipped, per-account switch at all seven enrolment writes plus the cart reminders; tsc exit 0, npm test 2612 (2609 pass, 0 fail, 3 skipped), studio browser check 34 of 34, builder check 40 of 40, vite build exit 0, all re-run by the main session |
| 3 | done 2026-10-08, commit a90f6bb | audit entry (Email Studio, Waves 3 and 4): five destinations, keyboard tablist; browser steps nav-five, nav-moved, nav-keyboard, nav-active, nav-390, nav-from-step |
| 4 | done 2026-10-08, commit a90f6bb | same audit entry: one Flows list, order emails as flows, editor beside the map; tsc exit 0, npm test 2586 (2583 pass, 0 fail, 3 skipped), studio browser check 32 of 32, builder check 40 of 40, check:canvas green, vite build exit 0, all re-run by the main session |
| 5 | done 2026-10-09 | audit entry (Email Studio, Waves 5 and 6): one broadcast composer with the builder, drafts route, Builder tab retired; six browser steps |
| 6 | done 2026-10-09 | same audit entry: studioLoad rules, one line per list, vocabulary pin; tsc exit 0, npm test 2666 (2663 pass, 0 fail, 3 skipped), studio browser check 48 of 48 three times, builder check 40 of 40, vite build exit 0, all re-run by the main session; the studio check flaked for the agents (cause unknown) |
| 7 | done 2026-10-09 (re-run by the main session: tsc exit 0, npm test 2702 with 0 fail, studio check 51 of 51 twice, builder 40 of 40, check:canvas and check:a11y green, vite build exit 0) | not committed; the Wave 7 fix round's notes (session scratchpad `waves78/audit-notes-wave7-fix.md`) report its own planted reds; seen by the Wave 8 fix round on the tree that holds Waves 7 and 8: tsc exit 0, npm test 2702 (2699 pass, 0 fail, 3 skipped), studio browser check 51 of 51 (canvas-build-flow among them) in each of the three runs after the last code change, check:canvas exit 0 (16 scenarios, 24 of 24 keyboard checks, 62 contrast pairs unmeasured), check:a11y exit 0 (22 PASS, 0 FAIL), builder check 40 of 40 |
| 8 | done 2026-10-09, same re-run | not committed; notes for the audit in the session scratchpad (`waves78/audit-notes-wave8.md`); `JOURNEY_UI_HANDOFF.md` has its Email Studio section. Seven majors fixed, each with a test seen red under a planted fault and restored (cmp); of ten minors seven fixed or partly fixed, three left open with reasons. Counts: tsc exit 0, the touched test files plus route-context-gate 107 of 107, npm test 2702 (2699 pass, 0 fail, 3 skipped), studio browser check 51 of 51 three times (one run took 373 s, cause unknown), check:canvas, check:a11y and the builder check as in row 7 |

## Open list, 2026-10-09

Re-run by the main session and committed (audit entry "the open list closed"). Each item of the "Still open" list in the audit's Waves 7 and 8 entry, as the working
tree stands after the open-list builders and their fix round. "Done" means the code is in the tree and
its tests ran green; the runs, counts and planted reds are in the session scratchpad
(`openlist/audit-notes-*.md`), and what a builder reported and the fix round did not re-run is marked
there as reported.

| Item | State | Where, and why |
|---|---|---|
| All flows had no grouping | done | `groupFlowRows` and `FLOW_GROUPS` (`src/lib/emailFlowsList.ts`): Your flows, Starter flows, Built-in flows and Order emails, each a heading over its own list in `EmailFlowsList.tsx` |
| A starter row read On while all its emails were drafts | done | `flowStateText`: "On, nothing sends yet: every email is still a draft", or how many are still drafts, in amber when the sender skips any. A review noted the line wraps on a phone; it is left as it is, because nothing is cut off, and nothing measures the row's height at 390 |
| The custom-flow sender wrote its whole stale copy back | done | `layFlowPass` (`server.mjs`) lays only the pass's own changes onto the record read after its sends. From the review, two more rules: a row stopped meanwhile (a deleted flow's) stays stopped, and a row the pass made and already mailed is kept over one added for the same person meanwhile (`bag.passMailed`), so a first email is not sent twice |
| A crash mid-send lost a broadcast's record | done | `deliverClaimed` saves the record as sending before anyone is mailed, and one a stopped server left is reported `interrupted` and refused a retry. From the review, a delivery that throws: the route answers 500 instead of hanging, saves who it reached as stopped, or removes the record when it reached nobody so a retry may send (`CAMPAIGN_NOT_SENT`); one scheduled broadcast that throws no longer stops the account's whole pass |
| Leaving the studio with an unsaved broadcast draft did not ask | done | `leaveStudioOk` (`src/lib/studioLeave.ts`) on App's two ways out of the studio, with the composer reporting its unsaved state. The one question for a flow edit and a draft at once is unit-tested only |
| `hubFlowId` and `exportFormat` were neither mapped nor dropped | done, dropped | Nothing read them; removed from `src/data/ecomBlueprints.ts` and `src/types/journey.ts`, and an old saved journey that carries them still loads (`blueprint-legacy-fields.test.mjs`). The Wave 7 bullet above that says to map or drop them is history |
| The studio browser check flaked about one run in five | still open | Cause unknown. 36 runs under machine load and a throttled page never went red (reported by the flake investigation). One review run went red: "open" timed out on a detached button, and the page reported `Failed to fetch dynamically imported module` for the `BlueprintModal` chunk. A concurrent rebuild is ruled out for that run: the check builds into a temp dir of its own, and the run's later contexts passed, which they do not when the file is missing (planted). Aborting that one request in the first context gives the same shape (6 of 57 steps, the same runtime error). A red run now says what the preview answered for each asset and whether the file is still in its build output. The flake investigation's hardening patch (a whole-run deadline, a bounded teardown, seconds per step) is not applied, because it fixes no shown cause; it waits for the owner |

Found in this round and still open:

- `POST /api/email/flows` and `POST /api/email/attribution-windows` answer 200 when the account
  record's size cap refused the write (reported by the server builder; in files no builder held).
- App renders the lazy `BlueprintModal` on load with no error boundary, so a chunk that does not
  arrive unmounts the whole app, as a deploy that replaces chunk names can make happen (seen under
  the planted missing chunk; not fixed).
- An interrupted broadcast reads "Not sent" in All broadcasts, with its `lastError` not shown
  (reported by the server builder, not checked).
