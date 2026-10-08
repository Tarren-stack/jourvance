# Jourvance running audit

Living notes. Newest pass is at the top. Add a dated section when something is checked again. Do not mark an item fixed unless the code or a test run shows it.

Checked: 2026-10-07, hub rules pass. The app was BOOTED sandboxed and loaded in Chrome this time. Read the newest section first.

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
