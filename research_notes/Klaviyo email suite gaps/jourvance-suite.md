# Jourvance email suite (code inventory)

Audit of what Jourvance implements in `server.mjs`, `klaviyo.mjs`, `src/types/journey.ts`, and `src/components/campaign/*`. Claims below are from those files. This is not a redesign.

Hub vs owned, in one line: Jourvance owns programs, custom flows, drip queue, signup forms, fixed segments, campaign records, and Klaviyo import. Delivery, lint, inbox, SMS consent/send, domains, event webhooks, and “live” blocks are `proxyHub` or direct `hub.email.*` calls. `GET /api/email/flows` returns hub flows when the hub has any; account flows live on `GET /api/email/flow-map`.

## 1. Email content blocks the builder can create and send

### Takeaway
`cleanBlocks` accepts exactly six kinds: `heading`, `text`, `button`, `divider`, `image`, `html`. The builder UI offers the first five. `html` is kept for Klaviyo template paste-in and is not an “Add html” button.

### Cited Findings
- Allowed kinds are `['heading', 'text', 'button', 'divider', 'image', 'html']`; anything else is stored as `text`. Max 24 blocks. Text cap 4000 characters; `html` cap 60000. Button stores `label` (80) and `url` (500). Image stores `url` (500) and `alt` (140). — [server.mjs `cleanBlocks`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `blocksToHtml` renders heading as `<h1>`, text as `<p>` with newlines to `<br>`, divider as `<hr>`, button as a black inline link only if `safeMailUrl` accepts `http:`/`https:`, image as `<img>` only for an http(s) `url` (image URL is not token-filled), html through `sanitizeMailHtml` (script tags, `on*` attributes, and `javascript:` stripped; tokens inside html are not filled). Footer text is the fixed line “Sent by Jourvance for this store.” — [server.mjs `blocksToHtml`, `sanitizeMailHtml`, `safeMailUrl`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `blocksToText` emits heading/text as text, divider as `---`, button as label plus URL, image as empty, html as tags stripped. — [server.mjs `blocksToText`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Builder type is `kind: 'heading' | 'text' | 'button' | 'divider' | 'image'`. Buttons labeled Add heading / text / button / divider / image. Copy says “Stack a heading, text, a button, or a divider” and does not mention image or html, but image is in the add list. Send posts subject, text, and html from `/api/email/programs/preview` with `merge: 'keep'` to `/api/email/campaign/send`. — [EmailPrograms.tsx `Block`, `BlockEditor`, `sendDraft`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/EmailPrograms.tsx)
- Flow email steps use the same `cleanBlocks`. The map editor writes a single `kind: 'text'` body unless the first block is already `kind: 'html'` (Klaviyo template), in which case the body is not editable and the UI says Klaviyo tags are filled only when Klaviyo sends. — [EmailFlowMap.tsx email editor](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/EmailFlowMap.tsx)
- Automation cards collapse a step back to one `kind: 'text'` block. Transactional letters use the block editor. — [EmailPrograms.tsx `AutomationCard`, `LetterCard`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/EmailPrograms.tsx)
- The older broadcast modal is one subject, optional preview string, and a plain textarea body, not blocks. — [HubEmailSuite.tsx broadcast form](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/HubEmailSuite.tsx)
- Canvas sequence steps are `{ channel: 'email' | 'sms', delay: string, subject, previewText?, body }` with no block kinds. Test send posts raw HTML `<p>` of the body to `/api/email/send`. Klaviyo/Shopify export is clipboard text, not a send. — [journey.ts `SequenceStep`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/types/journey.ts); [SequenceEditor.tsx `sendTestEmail`, `copyForKlaviyo`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/drawers/SequenceEditor.tsx)
- Drip steps store `subject`, `previewText`, `body`, `discountVoucher`. The tick sends `subject` and `text: tagOutboundLinks(step.body)` only. No blocks, and `previewText` / `discountVoucher` are not passed to `hub.email.send`. — [server.mjs `INITIAL_DRIP_SEQUENCES`, `POST /api/drips/sequences`, `POST /api/drips/process-tick`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)

### Inferences
- A “block” the product can both edit and send as structured HTML is heading, text, button, divider, or image. `html` is a storage/render kind, not a builder control.
- Broadcasts from the modal are a single plain-text body. The builder path is the one that sends rendered block HTML.

### Gaps
- What the hub does with unknown HTML after Jourvance hands it off is not in this repo.

## 2. Personalization tokens that are filled

### Takeaway
`fillMailTokens` replaces `{{key}}` only when that key is present on the vars object. The filled keys that the code actually sets are `first_name`, `order_number`, `order_total`, `currency`, `line_items`, `tracking_line`, and `refund_amount`. Unknown tokens are deleted on program/flow sends and left in place on builder preview-with-keep. Drip and broadcast sends do not call `fillMailTokens`.

### Cited Findings
- Regex is `\{\{\s*([a-zA-Z0-9_]+)\s*\}\}`. Missing or empty values become `''` unless `keepUnknown` is true, in which case the token string is kept. — [server.mjs `fillMailTokens`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `orderMailVars` sets `first_name` (first word of the name, else `there`), `order_number`, `order_total` (two decimals), `currency` (default `USD`), `line_items` (quantity × title, or a fixed “item list was not on this notice” sentence), `tracking_line`, `refund_amount`. — [server.mjs `orderMailVars`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Sample preview vars are `first_name: Alex`, `order_number: #1001`, `order_total: 48.00`, `currency: USD`, `line_items`, `tracking_line`, `refund_amount`. `POST /api/email/programs/preview` uses those unless `merge === 'keep'`. — [server.mjs `SAMPLE_MAIL_VARS`, `POST /api/email/programs/preview`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Order, shipping, cancel, and refund webhooks pass `orderMailVars` into `sendTransactional`. Post-purchase enrollment uses the same vars. Lead and checkout flow enrollment pass only `{ first_name }`. Quiet-buyer flow enrollment uses `orderMailVars(order)`. Manual enroll passes `first_name` from the typed name. — [server.mjs order/checkout webhooks, `enrollFlowsForTrigger` call sites, `POST /api/email/flows/:id/enroll`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Flow SMS uses `fillMailTokens(step.message, vars)`. Flow email subject/body use it inside `deliverLetter`. — [server.mjs `processCustomFlows`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Default drip copy contains `{{first_name}}` and `{{abandoned_checkout_url}}`, but `process-tick` sends `step.body` through `tagOutboundLinks` only. No drip token map was found. — [server.mjs `INITIAL_DRIP_SEQUENCES`, drip send inside `process-tick`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Campaign send stores `previewText` on the campaign row and sends `subject`, `text`, optional `html`, and `to`. It does not call `fillMailTokens` and does not pass `previewText` to `hub.email.send`. Builder send uses `merge: 'keep'`, so `{{tokens}}` stay in the HTML. — [server.mjs `POST /api/email/campaign/send`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs); [EmailPrograms.tsx `sendDraft`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/EmailPrograms.tsx)
- `{{ unsubscribe_link }}` and `{% unsubscribe %}` appear only inside clipboard export strings in the flows tab, not in `blocksToHtml` or send payloads. — [HubEmailSuite.tsx `formatStepForPlatform`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/HubEmailSuite.tsx)
- Canvas copy replaces the literal phrases `[First Name]` and `[Checkout Link]` with Klaviyo/Shopify liquid, not Jourvance tokens. — [SequenceEditor.tsx `copyForKlaviyo`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/drawers/SequenceEditor.tsx)
- Image `src` and `alt`, and raw `html` blocks, are not passed through `fillMailTokens`. Button `url` and `label` are. — [server.mjs `blocksToHtml`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)

### Inferences
- Per-recipient merge exists for transactional letters, default automations, and custom-flow emails/SMS. Broadcasts are one body to many addresses.
- `{{abandoned_checkout_url}}` in the default drip bodies is not a filled token.

### Gaps
- Whether the hub adds its own merge tags, preview header, or unsubscribe footer after `hub.email.send` is not visible in this repo.

## 3. Flow triggers, node types, splits, delays, A/B, re-entry, filters

### Takeaway
Custom flows have six triggers and five node types. The only split is a yes/no “ordered since enroll” check. Delays are whole hours, 0 to 90 days. There is no A/B node, no re-entry, and no profile filter beyond that one order check. A step can have only one incoming path.

### Cited Findings
- `FLOW_TRIGGERS`: `lead_capture`, `exit_intent`, `checkout_abandonment`, `order_paid`, `quiet_buyer`, `manual`. `cleanFlow` rejects an id that is not `flow_[a-z0-9]+`, forces exactly one `trigger` node, and allows node types `trigger`, `delay`, `email`, `condition`, `sms` only. Max 24 nodes, 40 edges, 40 flows. New flows are created `enabled: false`. — [server.mjs `FLOW_TRIGGERS`, `cleanFlow`, `POST /api/email/flows`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Condition nodes are forced to `field: 'ordered_since_enroll'`. `compileFlow` allows `branch` `yes`/`no` only on conditions, throws if a non-condition has a branch, throws “Each step can be reached from only one path” on a second visit, and throws if the graph is deeper than 24 or has no email or SMS after the start. Delays are added onto the next step’s `delayHours` (0 to `24 * 90`). An ending delay with nothing after it is dropped. — [server.mjs `cleanFlow`, `compileFlow`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Enrollment skip: if the same email already has that flow in `active`, `completed`, or `handed_to_klaviyo`, it is not enrolled again. No re-entry field exists. Quiet-buyer scan skips if any enrollment row exists for that flow and email. — [server.mjs `enrollFlowsForTrigger`, `processCustomFlows`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- At send time, `quiet_buyer` and `checkout_abandonment` enrollments become `converted_exit` if an order for that email is recorded at or after `enrolledAt`. A condition step sets branch `yes` when that same order check is true, else `no`. Empty branch jumps to the next sibling or completes. A failed send sets `lastError` and does not advance, so the next tick retries. Statuses written: `active`, `completed`, `stopped`, `converted_exit`, `handed_to_klaviyo`. — [server.mjs `processCustomFlows`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Triggers fire from: public lead (`exit_intent` if `exit_intent`/`exitIntent` is set, else `lead_capture`), Shopify checkout webhook (`checkout_abandonment`), Shopify order webhook (`order_paid`), quiet-buyer scan inside `processCustomFlows` (called from `processAccountAutomations` via `POST /api/drips/process-tick`), and `POST /api/email/flows/:id/enroll` only when the flow is enabled and `trigger === 'manual'`. — [server.mjs `/api/public/lead`, checkout and order webhooks, `POST /api/email/flows/:id/enroll`, `POST /api/drips/process-tick`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- If `sendWith === 'klaviyo'` and the flow has `klaviyoFlowId`, enrollment calls `enterKlaviyoFlow` once and does not send the copied letters. If Klaviyo is the sender and no email node is linked and there is no SMS text, the flow is skipped. Per-step Klaviyo handoff uses that step’s `klaviyoFlowId` instead of `deliverLetter`. — [server.mjs `enrollFlowsForTrigger`, `processCustomFlows`, `klaviyoIsSender`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Map UI triggers and buttons match the server: Add wait, Add email, Add text, Add order check, Yes email, No email. Condition copy: “Yes means an order was recorded after they joined.” Quiet days input is 1–365, default 45. — [EmailFlowMap.tsx `TRIGGERS`, attach buttons](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/EmailFlowMap.tsx)
- `GET /api/email/flow-map` also draws non-editable chains for default automations (`kind: 'automation'`) and drip sequences (`kind: 'sequence'`). Those are not the editable graph. — [server.mjs `chainGraph`, `GET /api/email/flow-map`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Canvas `follow-up-sequence` nodes store steps and optional `klaviyoFlowId` / `klaviyoWhen` (`lead_capture`, `exit_intent`, `checkout_abandonment`, `order_paid`). `handoffMapNodes` starts that Klaviyo flow when Klaviyo is the sender. The node itself is not compiled by `compileFlow`. — [journey.ts `SequenceNodeData`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/types/journey.ts); [server.mjs `handoffMapNodes`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Search for an A/B flow node, re-entry flag, or profile filter other than `ordered_since_enroll`: not found in `cleanFlow` / `compileFlow`. Klaviyo `ab-test` is collapsed to one path on import (see section 12). Landing-page `abTestingEnabled` / `variantB` is page traffic, not an email node. — [server.mjs `cleanFlow`; page variant around `abTestingEnabled`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)

### Inferences
- “Split” in this product means one order-since-join check with yes and no edges, not a conditional builder.
- Flows do not run on a clock by themselves. Something must call `POST /api/drips/process-tick` (the suite has a “run the queue” action).

### Gaps
- No scheduler for the tick was found in the email routes. Whether an external cron calls `process-tick` is outside these files.

## 4. Automations and transactional letters that exist by default (and that they start off)

### Takeaway
Four transactional letters and two automations ship in code. `enabled` is `Boolean(over.enabled)`, so a new account has them off until `POST /api/email/programs/:id` turns one on. Shopify is still described as sending its own notifications (`shopifyStillSends: true`).

### Cited Findings
- Transactional ids: `order_confirmation` (topic `orders/create`), `shipping_confirmation` (`fulfillments/create`), `order_cancelled` (`orders/cancelled`), `refund` (`refunds/create`). Each default is a heading block plus a text block using the tokens in section 2. — [server.mjs `TRANSACTIONAL_DEFAULTS`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Automations: `post_purchase` trigger `order_paid`, steps at 24h and 72h; `winback` trigger `quiet_buyer`, `quietAfterDays: 45`, one step at 0h. Comment: “Letters stay off until this account turns them on.” `userProgramBag` sets `enabled: Boolean(over.enabled)`. — [server.mjs `AUTOMATION_DEFAULTS`, `userProgramBag`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `sendTransactional` returns `status: 'off'` when disabled, `already_sent` when `dedupeKey` is in `sentKeys`, and `klaviyo` / `ok: false` when Klaviyo is the sender (it does not send the Jourvance letter). `enrollAutomation` returns false when Klaviyo is the sender, the automation is off, or that email is already `active` or `completed`. — [server.mjs `sendTransactional`, `enrollAutomation`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Order webhook calls `sendTransactional(..., 'order_confirmation')` and `enrollAutomation(..., 'post_purchase')`. Fulfillment, cancel, and refund webhooks call the matching letter. Winback enrollment happens inside `processAccountAutomations` when enabled, for the latest order at least 45 days old, and exits `converted_exit` if a newer order appears. Automation steps cap at 8; delay hours cap at 90 days. — [server.mjs webhooks, `processAccountAutomations`, `cleanSteps`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `suitePayload` sets `shopifyStillSends: true` and `hubConnected: hubReady`. — [server.mjs `suitePayload`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Separate from those two automations, `INITIAL_DRIP_SEQUENCES` always includes `drip_seq_default` (Welcome, trigger `lead_capture`, 3 steps at 0/24/48 hours, `smartExitOnPurchase: true`) and `drip_seq_cart_recovery` (trigger `checkout_abandonment`, steps labeled 1h and 24h). They are inserted if missing. They are not behind an `enabled` flag; flow-map marks sequences `enabled: true`. Leads and checkouts auto-enroll them unless Klaviyo is the sender. There is no default `exit_intent` drip sequence; exit leads look one up and enroll only if a sequence with that `triggerType` exists. — [server.mjs `INITIAL_DRIP_SEQUENCES`, `loadDrips`, `/api/public/lead`, checkout webhook](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Checkout drip enrollment sets `nextStepDueAt` to now plus 1 hour, not the first step’s `delayHours`. A second recovery path in the same tick sends one hardcoded “Your checkout is still open” email when a checkout has been `pending` for at least 2,700,000 ms (45 minutes), and does not use the drip step body. — [server.mjs checkout webhook enrollment; cart loop in `process-tick`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `DripSequence.triggerType` in types is `'lead_capture' | 'exit_intent' | 'abandoned_cart' | 'manual'`. The checkout webhook matches `checkout_abandonment`, not `abandoned_cart`. Create-sequence does not whitelist `triggerType`. — [journey.ts `DripSequence`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/types/journey.ts); [server.mjs `POST /api/drips/sequences`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)

### Inferences
- Turning on a transactional letter does not turn off Shopify’s own notification. The code states that explicitly.
- Default drips are a second, always-present queue beside the off-by-default automations.

### Gaps
- `discountVoucher` is stored on drip steps and cleared in a migration, and no send path reads it. Whether a merchant can set it from the current UI was not found in the campaign components (the create API accepts it).

## 5. Broadcasts / campaigns (A/B? scheduling? segments?)

### Takeaway
Broadcasts are immediate sends to one of six fixed segments, or a local tag with no email. There is no A/B variant and no schedule field. `openRate` and `clickRate` are stored as `null` at send time.

### Cited Findings
- `POST /api/email/campaign/send` requires subject and body or html. `sendMode === 'shopify_push'` tags matching contacts `jourvance-segment-${segmentId}` and sets status `tagged-locally`, `sentAt: null`. The response says Shopify was not emailed. Any other mode calls `hub.email.send` once with `to: [emails]`, records an `email_sent` event per address, status `sent`. — [server.mjs `POST /api/email/campaign/send`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Segment switch: `vip` totalSpent ≥ 100, `repeat` ordersCount ≥ 2, `buyers` ordersCount > 0, `leads` ordersCount === 0, `exit_rescue` tag `Exit-Intent-Rescue`, default `all` is `acceptsMarketing !== false`. Only `all` applies the marketing filter. Empty match returns 400 and sends nothing. — [server.mjs campaign segment `switch`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Saved campaign fields include `previewText`, `segment`, `segmentName`, `recipients`, `openRate: null`, `clickRate: null`, `attributedSales: 0`, `sendMode`. No `scheduledAt` or variant fields are written. — [server.mjs campaign record](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `GET /api/email/broadcasts` returns `loadCampaigns()` for the user. Demo rows are stripped by `isDemoRecord`, including a row whose `openRate === 52.4` and `clickRate === 24.8`. — [server.mjs `GET /api/email/broadcasts`, `isDemoRecord`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- UI: campaigns tab lists broadcasts with segment name, preview string, open %, click %, and `attributedSales`. Modal has direct vs “Push to Shopify Email” (button copy says it tags Shopify Admin; server only tags local contacts), segment `<select>`, subject, preview preheader, textarea body. No date picker and no A/B controls. Builder send is the same endpoint with `sendMode: 'direct'`. — [HubEmailSuite.tsx broadcast list and modal](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/HubEmailSuite.tsx); [EmailPrograms.tsx `sendDraft`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/EmailPrograms.tsx)
- Search for campaign `ab`, `variant`, or `schedule` on this route: not found.

### Inferences
- “Shopify Email sync” in the modal is a local tag, not a Shopify Email API call.
- Reported open/click on a broadcast stay blank unless some other writer sets `openRate`/`clickRate`. This send route does not.

### Gaps
- `workspaceId` is read from the body and not used in the handler.

## 6. Signup forms (types, targeting rules that exist vs do not)

### Takeaway
Jourvance forms are `popup`, `bar`, or `embed`, created off, and injected onto that account’s published landing pages. The only timing rule is popup `delaySeconds` (0–120). URL, device, exit-intent, frequency, and teaser rules were not found.

### Cited Findings
- `cleanSignupForm` keeps id `form_[a-z0-9]+`, type in `popup|bar|embed` (else `embed`), `enabled`, `name`, `headline`, `body`, `buttonText`, `successMessage`, and `delaySeconds` only when type is `popup` (clamped 0–120). Max 20 forms. `POST /api/email/forms` forces `enabled: false`. — [server.mjs `cleanSignupForm`, form routes](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `signupSnippetForSlug` renders enabled forms into the published page: embed in the body, bar fixed to the bottom, popup hidden until `delaySeconds`. Fields are email (required) and name. Submit posts `/api/public/lead` with `formId`. Unknown or disabled form id returns 404. Submissions counted as contacts tagged `form:${id}`. — [server.mjs `signupSnippetForSlug`, `presentSignupForm`, lead `formId` check](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Snippet is appended only when `withTracking` is called with `includeForms`. — [server.mjs `withTracking`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- UI edits name, headline, body, button, success, popup seconds, and type. It states the form appears on published landing pages. It shows a count of `hubForms` and says those render where the email service’s tracker is installed. Jourvance does not edit hub forms. — [SignupForms.tsx](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/SignupForms.tsx)
- Search in `cleanSignupForm` for URL contains, device, exit intent, scroll, frequency cap, or teaser: not found. Page exit-intent is a separate landing-page lead flag (`exit_intent`), not a signup-form rule. — [server.mjs `cleanSignupForm`; lead `exitIntent`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)

### Inferences
- Targeting that exists: published pages of this account, form type, on/off, and a popup delay. Nothing else.

### Gaps
- `GET /api/email/forms` lists `hub.email.forms.list()` but this repo does not show how those hub forms are targeted.

## 7. Audience, segments, consent, unsubscribe

### Takeaway
Audience is the account’s contacts. Six segments are hard-coded. Email consent is a boolean `acceptsMarketing`, set true on a Jourvance lead, from Shopify’s marketing state, or from Klaviyo `SUBSCRIBED` and not suppressed. There is no unsubscribe route or List-Unsubscribe header in this repo.

### Cited Findings
- `GET /api/email/audience` maps contacts to email, name, phone, `status: acceptsMarketing !== false ? 'active' : 'unsubscribed'`, tags, totalSpent, ordersCount, joinedAt. — [server.mjs `GET /api/email/audience`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `GET /api/email/segments` returns fixed ids `all`, `vip`, `repeat`, `buyers`, `leads`, `exit_rescue` with the same predicates as the campaign switch. `all` is the only one filtered by `acceptsMarketing !== false`. Type `AudienceSegment.filterKey` is that same union. — [server.mjs `GET /api/email/segments`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs); [journey.ts `AudienceSegment`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/types/journey.ts)
- Audience tab filters client-side with the same predicates plus a search box. It does not create segments. — [HubEmailSuite.tsx audience filter](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/HubEmailSuite.tsx)
- Public lead sets `acceptsMarketing: true` and `subscribedAt`. Shopify customer sync sets `acceptsMarketing` from `email_marketing_consent.state === 'subscribed'`. Klaviyo import sets it only when consent is `SUBSCRIBED` and suppression is empty; otherwise `klaviyoConsent` is `suppressed`, the consent string lowercased, or `unknown`. — [server.mjs `/api/public/lead`; Shopify customer mapping; klaviyo.mjs `contactFromProfile`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/klaviyo.mjs)
- Suppressed profiles are not pushed and are refused by `enterKlaviyoFlow` (`status: 'suppressed'`). Profile push “does not subscribe the person.” List handoff copy: “They were not subscribed.” — [server.mjs `enterKlaviyoFlow`, file comment above Klaviyo routes, `syncKlaviyo`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Lead also calls `hub.email.subscribers.add` when the hub is connected. Failure is logged and does not fail the lead. — [server.mjs `/api/public/lead`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Search for an unsubscribe HTTP route, `List-Unsubscribe`, or a click that sets `acceptsMarketing` false: not found under `src` and `server.mjs`. The only `{{ unsubscribe_link }}` is clipboard export text. A landing-page string says “You can unsubscribe anytime” and is not a link handler. SMS opt-out is a separate hub proxy (section 8). — [HubEmailSuite.tsx `formatStepForPlatform`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/HubEmailSuite.tsx); [server.mjs page HTML near “unsubscribe anytime”](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `blocksToHtml` does not append an unsubscribe link or the physical address collected in Sending setup. — [server.mjs `blocksToHtml`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)

### Inferences
- “Unsubscribed” in the audience list means `acceptsMarketing === false`. Nothing in these email routes was found that sets that flag from a recipient click.
- VIP/repeat/buyer/lead/exit sends can include people with `acceptsMarketing === false` because those filters do not check it.

### Gaps
- No custom segment rule builder (AND/OR, properties, events) exists in these routes.

## 8. SMS

### Takeaway
SMS sending, consent, audience, and history are hub proxies. Jourvance adds a flow node of type `sms` that sends only if the hub audience already has that email or phone.

### Cited Findings
- Routes: `GET /api/sms/status`, `/audience`, `/history` proxy `hub.email.sms.status/audience/history`. `POST /api/sms/consent` requires email and phone and sends `opted_in` or `opted_out`. `POST /api/sms/send` requires a message, caps explicit recipients at 50, and refuses a blank recipient list unless `confirm === 'opted-in'`. A blast with `sent === 0` and `sandbox > 0` is returned as not delivered. — [server.mjs SMS routes](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `sendFlowSms` loads `hub.email.sms.audience()`, matches email or last-10 digits of phone, and returns `no_consent` if no phone is on that list. It then calls `hub.email.sms.send`. Success records `sms_sent`. Sandbox and deferred are failures. — [server.mjs `sendFlowSms`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Flow SMS message max 480 characters. Empty SMS fails compile with “A text step needs a message.” — [server.mjs `cleanFlow`, `compileFlow`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `SmsPanel` shows provider, from number, live/mode, opted-in count, blast/message counts, record opt-in/out, and send to listed numbers or the full opted-in list. Copy: provider key is connected on the email service. — [SmsPanel.tsx](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/SmsPanel.tsx)
- Canvas sequence `channel: 'sms'` is a stored step, not the flow `sms` node. No code path was found that sends those canvas SMS steps through `sendFlowSms`. — [journey.ts `SequenceStep`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/types/journey.ts)

### Inferences
- Jourvance does not store an SMS opt-in flag on `contacts.json`. Consent lives on the hub audience the proxy reads.

### Gaps
- Quiet hours, SMS smart send, and keyword opt-in were not found in Jourvance. A hub `deferred` status is surfaced as “waiting for the service sending window,” which may be the hub’s window, not a Jourvance rule.

## 9. Inbox and replies

### Takeaway
Inbox is entirely `hub.email.inbox` through `proxyHub`. Jourvance does not store messages. The UI can list, set autopilot, draft, reply, send the draft, and archive.

### Cited Findings
- `GET /api/email/inbox` proxies `hub.email.inbox.list({ accountId, status })`. Policy get/set proxies `policy` / `setPolicy`. Autopilot is forced to `off`, `draft`, or `auto` (default `off`). Draft proxies `inbox.draft` with optional `direction`. Reply proxies `inbox.reply` with `text` and `useDraft === true`. Status is forced to `archived`, `ignored`, or `new` (default `archived`). — [server.mjs inbox routes](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- UI shows from, subject, text or snippet, status, receivedAt, `aiDraft.text`, counts, and buttons Off / Draft only / Send when confident. Copy says a draft is not sent until the user replies, and auto “lets the email service reply on its own when it clears its own bar.” The visible status button only sends `archived`. — [EmailInbox.tsx](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/EmailInbox.tsx)
- Receiving setup is separate: `GET/POST /api/email/inbound` proxy `hub.email.inboundParse.status/setup`. The GET adds `accountAddress` as `acct-${uid}@${hostname}` when a hostname is returned. — [server.mjs inbound routes](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)

### Inferences
- “Send when confident” is a hub policy flag. Jourvance does not implement the confidence check.

### Gaps
- Message shape beyond what `EmailInbox` reads (`id`, `from`, `subject`, `text`, `snippet`, `status`, `receivedAt`, `aiDraft`) is defined by the hub response, not this repo.

## 10. Deliverability, tracking pixels, open/click, domains, branded links

### Takeaway
Lint, domain auth, event-webhook setup, and live blocks are hub proxies. Jourvance does not inject an open pixel. Link handling that Jourvance owns is `tagOutboundLinks` (UTM plus cart attributes), and it is not applied to block HTML. Local analytics leave open, click, and delivery null until a campaign record already has numeric rates or the hub analytics call returns data.

### Cited Findings
- `POST /api/email/lint` proxies `hub.email.lint({ subject, html })`. The builder shows `warnings`, `error`, or `score`. — [server.mjs lint route](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs); [EmailPrograms.tsx Check this letter](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/EmailPrograms.tsx)
- Senders: list via `hub.email.senders.list`. Create proxies `type` `single_sender` or `domain` (UI posts only `domain`), plus domain, fromEmail, fromName, replyTo, physicalAddress, accountId. Verify, auth report, and delete proxy the hub. `POST /api/email/domain-connect` proxies `hub.email.connectDomain`. — [server.mjs sender routes](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs); [SendingSetup.tsx](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/SendingSetup.tsx)
- `GET/POST /api/email/events-webhook` proxy `hub.email.webhook.status/setup`. UI copy: configured vs “Opens and clicks are not being recorded yet,” and “Domain authentication, reply receiving, and open tracking come from the email service.” — [SendingSetup.tsx Opens and clicks](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/SendingSetup.tsx)
- No open-pixel `<img>` is added in `blocksToHtml`. Search for a branded-link or click-redirect host in the email send path: not found. `tagOutboundLinks` rewrites http(s) URLs in a text body to add `utm_source=email` and `utm_medium=email` if missing, and on paths containing `/cart/` adds `attributes[jv_vid]`, `attributes[jv_slug]`, `attributes[jv_journey]`. Used for campaign text and drip text, not for `blocksToHtml`. — [server.mjs `tagOutboundLinks`, `blocksToHtml`, campaign send](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- `GET /api/email/analytics` returns `hub.email.analytics()` when that call returns data. Otherwise it averages `openRate`/`clickRate` only on sent campaigns where those fields are numbers, sets `deliveryRate: null`, `totalSent` from `recipients`, and `activeSubscribers` to contact count (not the marketing filter). New sends write `openRate: null`. No route was found that writes hub open/click events back onto campaign rows. — [server.mjs `GET /api/email/analytics`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Live blocks: `GET/POST/DELETE /api/email/live` proxy `hub.email.live.list/create/remove`. Create forwards `name`, `kind`, `deadline`, `beforeUrl`, `afterUrl`, `stockUrl`, `stockPath`, `stockThreshold` with no local validation. The UI creates only `kind: 'image'` with before URL, after URL, and a deadline, and describes a flip at open time. It does not send the stock fields. — [server.mjs live routes](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs); [SendingSetup.tsx Live at open](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/SendingSetup.tsx)
- `deliverLetter` treats hub `sandbox === true` or `broadcast.status === 'sandbox'` as not delivered. It records `email_sent` only after the hub accepts the send. — [server.mjs `deliverLetter`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Page `trackingSnippet` is a Jourvance visitor/UTM script for published pages, not an email open pixel. — [server.mjs `trackingSnippet`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)

### Inferences
- Jourvance can ask the hub to record events and can display hub analytics. It does not itself count opens or clicks.
- “Branded links” as a Jourvance short-link domain: not found.

### Gaps
- The hub’s pixel, branded-link, and spam-score implementations are not in this repo. Lint `warnings`/`score` are displayed if the hub returns them.

## 11. Shopify catalog, product blocks, coupons, price drop, back in stock

### Takeaway
Shopify products, variants, and discount codes exist for landing pages and checkout links. They are not email content blocks. There is no product, coupon, recommendation, price-drop, or back-in-stock email kind. A live-block proxy accepts stock fields the UI never sends.

### Cited Findings
- `GET /api/workspace/:wsId/shopify/products` loads up to 50 products from the Admin API or the public catalog for the page builder. It is not referenced by `cleanBlocks` or the email components. — [server.mjs products route](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Order letters render `line_items` as text lines `quantity × title`, not product cards, images, or prices per line (order total is a separate token). — [server.mjs `orderMailVars`, `TRANSACTIONAL_DEFAULTS`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Discount codes are page/checkout data: lead checkout URL gets `?discount=`, order records store `discountCode`, upsell checkout links append `discount`. Drip `discountVoucher` is saved and not read at send. No email block inserts a generated coupon. — [server.mjs `/api/public/lead` checkout URL; drip send](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Search for `price drop`, `price_drop`, `back in stock`, `back_in_stock`, `recommendation`, and `kind: 'product'` in `*.mjs`, `*.ts`, `*.tsx`: not found, except live-create forwards `stockUrl`, `stockPath`, `stockThreshold` to the hub and the UI does not set them. — [server.mjs `POST /api/email/live`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs); [SendingSetup.tsx](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/SendingSetup.tsx)
- A countdown element `.reservation-countdown` exists in published landing-page HTML, not in email blocks. — [server.mjs page template](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Klaviyo metric handoff refuses `added to cart` and `viewed product`. Commerce metrics for cancel/refund/fulfill are allowed only when `reason === 'order'`. Started checkout only when `reason === 'checkout'`. — [klaviyo.mjs `metricHandoffAllowed`, `COMMERCE_METRICS`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/klaviyo.mjs)

### Inferences
- Catalog-driven email (product block, coupon block, price drop, back in stock, recommendations) is not implemented in Jourvance. The closest stock hook is an unexposed field on a hub live-block proxy.

### Gaps
- What the hub does with `stockUrl` / `stockThreshold` if a caller posted them directly is not defined here.

## 12. Klaviyo import limits (what rebuild does and does not copy)

### Takeaway
Sync rebuilds up to 40 non-archived flows as waits, emails, and texts, off. An order-since-flow-start split can become the order check. Every other split keeps one path. A/B becomes one path. Templates are fetched as one `html` block when Klaviyo returns HTML. Profiles, list tags, and a 40-profile push are separate from the flow graph.

### Cited Findings
- `flowFromKlaviyo` copies `time-delay` (`delayHours`, weeks/days/hours, minutes rounded to hours, cap 90 days). `delay_until_weekdays` is noted as “copied as a plain wait.” `send-email` becomes an email node: subject from `subject_line` or name, body is preview text if present, else a sentence that the template was not copied. `template_id` is stored. `send-sms` copies `message.body` up to 480 chars; empty SMS is skipped. — [klaviyo.mjs `flowFromKlaviyo`, `delayHours`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/klaviyo.mjs)
- `conditional-split` / `trigger-split` become a `condition` node only when `splitOrderPolarity` matches exactly one `profile-metric` condition on Placed Order or Ordered Product, timeframe `flow-start` or empty, and a measurement that means ordered vs not. Yes is wired to the ordered path. Any other split: if both sides have a send, the Yes path is kept and the No path is noted as left out; otherwise the side that contains a letter or SMS is kept. — [klaviyo.mjs `splitOrderPolarity`, split branch](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/klaviyo.mjs)
- `ab-test` notes “An A/B test was rebuilt as one path. Jourvance does not pick a winner” and walks `links.next` or the side that has a send. Any other action type is noted as “A ${type} step was left out” and the walker continues on `next` or `yes`. Joins note “Two paths join again later” and keep the shared steps on the first path. Graphs stop at 24 nodes. — [klaviyo.mjs `flowFromKlaviyo`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/klaviyo.mjs)
- Trigger mapping: list or “added to list” → `lead_capture`; metric name matching started checkout → `checkout_abandonment`; placed order or ordered product → `order_paid`; otherwise `manual`, with a note. File header: “Flow splits are not rewritten into Jourvance's order check, because that check means something else,” except the one polarity case above. There is no API to drop someone into a flow by id; entry is list add or metric event. — [klaviyo.mjs `jourvanceTrigger`, `flowEntryFrom`, file comment](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/klaviyo.mjs)
- `importKlaviyoFlows` fetches `/api/templates/{id}` and, if HTML exists, replaces the email blocks with one `kind: 'html'` block (`templatesCopied`). Flows already `enabled` are left unchanged (`leftOn`). Saved copies are `enabled: false`. Id is `flow_k` plus the Klaviyo id. Notes are capped at 16. `readFlowCatalog` skips archived flows and stops at 40 (connect uses limit 20). Sync adds a note when more than 40 flows exist. — [server.mjs `importKlaviyoFlows`, `readFlowCatalog` call in `syncKlaviyo`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs); [klaviyo.mjs `readFlowCatalog`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/klaviyo.mjs)
- Profiles: up to 15 pages per sync (`pullKlaviyoProfiles`). Lists: 20 names. List membership: 3 pages of 100 emails, tagged `Klaviyo: {list name}` only if the contact is already local. Push: at most 40 contacts that are dirty, or have no profile id and `acceptsMarketing === true`, excluding suppressed. Push uses profile-import and does not call a subscribe endpoint. — [server.mjs `pullKlaviyoProfiles`, `pullKlaviyoLists`, `pullListEmails`, `syncKlaviyo`, `pushKlaviyoContact`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Not copied, from the walker and comments: profile filters that are not the single placed-order check, A/B winner selection, weekday waits as weekdays, template HTML when the template request fails (subject and a placeholder or preview sentence remain), actions that are not delay/email/SMS/that split, archived flows, flows past the 40 cap, and any flow that is already turned on. `metricHandoffAllowed` blocks Added to Cart and Viewed Product handoffs. — [klaviyo.mjs `flowFromKlaviyo`, `metricHandoffAllowed`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/klaviyo.mjs)
- UI states the same limits: rebuild waits, letters, and texts; order split becomes the order check; other splits keep the path that has a letter; rebuilt flows stay off; a profile push does not subscribe anyone. — [KlaviyoSync.tsx](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/KlaviyoSync.tsx)

### Inferences
- A rebuilt email is not the Klaviyo design unless the template HTML fetch succeeds. Preview text is used as the text body only until HTML replaces the blocks.
- Campaigns, segments, forms, and universal content from Klaviyo are not part of `flowFromKlaviyo` or `syncKlaviyo`.

### Gaps
- The code notes unknown action types by their Klaviyo type string at runtime. A fixed list of every Klaviyo action name (update profile, webhook, internal alert, and so on) is not enumerated in source; they all hit `A ${type} step was left out.`

## 13. Analytics shown in the email UI

### Takeaway
The Deliverability tab shows four numbers: active contacts, average open rate, average click rate, and inbox delivery rate, or an em dash when null. Campaign rows also show open %, click %, recipient count, and attributed sales (stored 0 on send). Drip cards show enrollment counters and a sales sum that is every order for an enrolled email, not last-touch email revenue.

### Cited Findings
- Analytics type in the suite is `totalSent`, `avgOpenRate`, `avgClickRate`, `deliveryRate`, `activeSubscribers`. The tab renders Active Contacts (`activeSubscribers`), Average Open Rate, Average Click Rate, and Inbox Delivery Rate. Copy says they show up only after a sent campaign reports them. `totalSent` is fetched and not shown in that four-card grid. — [HubEmailSuite.tsx analytics tab](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/HubEmailSuite.tsx); [server.mjs `GET /api/email/analytics`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Campaign cards show recipients, open rate or `—`, click rate or `—`, and `attributedSales` formatted as dollars. Send writes `attributedSales: 0` and null rates. — [HubEmailSuite.tsx broadcast row](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/HubEmailSuite.tsx); [server.mjs campaign record](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Drip UI shows `activeEnrollments`, `totalCompleted`, `totalExitedPurchased`, and `attributedSales`. `recomputeDripCounters` sets attributed sales to the sum of order totals for any order whose email is in that sequence’s enrollments, with no channel filter. — [HubEmailSuite.tsx drip cards](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/HubEmailSuite.tsx); [server.mjs `recomputeDripCounters`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Flow map shows `active` enrollment count, `stepCount`, and `compileError` per custom flow. Signup forms show `submissions`. SMS panel shows hub opted-in count and log sizes. Inbox shows hub counts. Sending shows verified vs not, DNS rows, and whether the event webhook is configured. — [server.mjs `presentCustomFlow`, `presentSignupForm`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs); [SmsPanel.tsx, EmailInbox.tsx, SendingSetup.tsx](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/components/campaign/SendingSetup.tsx)
- Sequence node type fields `avgOpenRate` and `avgClickRate` exist on the canvas node. They are not computed by the email analytics route. — [journey.ts `SequenceNodeData`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/src/types/journey.ts)
- A separate attribution report (`GET /api/reports/attribution`) includes an email channel bucket from UTM, not from open/click events. That screen is attribution, not the email Deliverability tab. — [server.mjs `GET /api/reports/attribution`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)

### Inferences
- The email UI can look like it has open/click/delivery metrics. On the local fallback those rates stay blank because sends store null. If the hub analytics payload is returned, those hub numbers replace the local ones wholesale.

### Gaps
- The hub analytics object’s extra fields, if any, are not typed beyond the five fields the UI reads. `activeSubscribers.toLocaleString()` will throw if the hub omits that field; that is a UI assumption, not proof the hub always sends it.

## 14. Explicit absences verified by search

### Takeaway
Product block, spacer, social block, countdown block, universal content, smart send, email A/B node, recommendation, price drop, back in stock, and an unsubscribe handler were not found as email features. Preview text is stored and displayed, not sent as a preheader. Coupon and segment exist, but not as Klaviyo-style email objects.

### Cited Findings
- `kind` allow-list does not include product, spacer, social, countdown, coupon, or recommendation. Repo search for `kind: 'product'`, `kind: 'spacer'`, `kind: 'social'`, `kind: 'countdown'`, `universalContent`, `smartSend`, `smart_send`, `price_drop`, `back_in_stock`, `List-Unsubscribe`: no matches in `*.mjs` / `*.ts` / `*.tsx` except `{{ unsubscribe_link }}` in clipboard export. — [server.mjs `cleanBlocks`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs); search of the repo
- Countdown: `.reservation-countdown` is landing-page HTML, not an email block. — [server.mjs page template](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- A/B: no email node type. Klaviyo `ab-test` is one path. Page `abTestingEnabled` is a landing-page variant. — [klaviyo.mjs `ab-test` branch](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/klaviyo.mjs); [server.mjs `abTestingEnabled`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Segment: six fixed server segments, not a user-defined definition with rules. — [server.mjs `GET /api/email/segments`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Unsubscribe: no route that opts a contact out of email. SMS `opted_out` is the hub consent proxy only. — [server.mjs `POST /api/sms/consent`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Coupon: page discount codes and an unused drip `discountVoucher` field. Not an email block. — [server.mjs drip step and lead checkout URL](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Preview text: field on drip steps, campaign records, canvas steps, and the broadcast form. Campaign send does not pass it to `hub.email.send`. Flow nodes have no `previewText` field. Klaviyo preview text is copied into the text block body, not a preheader. — [server.mjs campaign send; klaviyo.mjs `send-email`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/klaviyo.mjs)
- Smart send: not found. The only related behavior is skipping a second enrollment while one is active/completed/handed to Klaviyo, and `converted_exit` after a later order. — [server.mjs `enrollFlowsForTrigger`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)
- Social: `hub-sdk.js` has a social suite, and the word “social” appears in page copy. No email social-icon block exists in `cleanBlocks`. — [server.mjs `cleanBlocks`](file:///Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance/server.mjs)

### Inferences
- The searches the assignment named (product block, countdown, spacer, social, A/B test, segment, unsubscribe, coupon, recommendation, price drop, back in stock, universal content, preview text, smart send) split into “absent,” “present only outside email,” or “stored but not sent,” as listed above. None of them is a working Klaviyo-equivalent email feature in this codebase.

### Gaps
- Hub-side features can still exist behind `hub.email.live`, `hub.email.lint`, and `hub.email.analytics` without a Jourvance implementation. This audit did not read the hub server.
