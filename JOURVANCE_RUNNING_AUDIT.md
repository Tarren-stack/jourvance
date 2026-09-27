# Jourvance Comprehensive Audit: Running Issues, Product Gaps & Improvement Architecture

**Document Version:** 2.0.0  
**Target Codebase:** `jourvance` (`/Users/tarrenmunoz/antigravity/Local-AI-App-Builder/generated-projects/jourvance`)  
**Scope:** Complete Codebase (Engine, Server, Tenancy, Canvas UI, E-Commerce Integrations, Email Suite, Marketing Pages, Legal & Compliance)  
**Status:** Living Engineering & Product Assessment  

---

## Executive Summary

Jourvance is designed as a visual customer journey and conversion flow builder connecting top-of-funnel traffic (Meta/TikTok ads), single-offer high-converting landing pages, 1-click Shopify checkout (with order bumps), and automated post-purchase email/SMS nurture into a unified canvas.

While the conceptual vision and domain logic are robust (over 70 unit tests pass for graph validation and attribution rules), the current implementation contains **critical architectural bottlenecks, severe data loss risks, security loopholes, non-functioning "automated" workflows, missing legal compliance safeguards, and public-facing conversion flaws** that prevent it from functioning reliably as a multi-tenant commercial SaaS product.

This document inventories every identified issue, categorized by severity, along with concrete root causes and recommended architectural improvements.

---

## Table of Contents
1. [Critical Architectural & Data Durability Hazards](#1-critical-architectural--data-durability-hazards)
2. [Automation, Execution & Background Processing](#2-automation-execution--background-processing)
3. [Multi-Tenancy, Security & Isolation Loopholes](#3-multi-tenancy-security--isolation-loopholes)
4. [Compliance, Legal & Deliverability Vulnerabilities](#4-compliance-legal--deliverability-vulnerabilities)
5. [E-Commerce & Funnel Execution Breakdowns](#5-e-commerce--funnel-execution-breakdowns)
6. [UI, UX, Conversion & Buyer Trust Red Flags](#6-ui-ux-conversion--buyer-trust-red-flags)
7. [Canvas Engine & State Synchronization Glitches](#7-canvas-engine--state-synchronization-glitches)
8. [Routing, SEO & Frontend Architecture](#8-routing-seo--frontend-architecture)
9. [Prioritized Remediation Roadmap](#9-prioritized-remediation-roadmap)

---

## 1. Critical Architectural & Data Durability Hazards

### 1.1 Ephemeral Flat JSON Storage Wipes 14 Core Datasets on Container Deploy
- **File / Lines:** `server.mjs:198-428`, `server.mjs:1013-1400`, `server.mjs:2570`, `server.mjs:5468`, `server.mjs:5971`
- **Issue:** 
  The top of `server.mjs` explicitly acknowledges:
  > *"Render's disk is wiped on every deploy, so a spoke that only wrote journeys.json lost every customer's work each time it shipped."*
  
  While `journeys`, `workspaces`, and `pubpages` write to the Hub app store (`hub.store.docs`), **14 business-critical datasets are stored exclusively as local flat JSON files on disk**:
  1. `contacts.json` (CRM leads, marketing consent, customer directory)
  2. `orders.json` (Shopify customer orders & closed-loop attribution revenue)
  3. `checkouts.json` (Abandoned carts & checkout sessions)
  4. `campaigns.json` (Broadcast history & engagement analytics)
  5. `drips.json` (Active lead nurture sequences & in-flight customer enrollments)
  6. `discounts.json` (Shopify price rules & provisioned voucher codes)
  7. `events.json` (Tracking events, page views, click beacons)
  8. `redirects.json` (Shortlink click-tracking codes for email & SMS)
  9. `email_programs.json` (Custom flow automations & transactional templates)
  10. `signup_forms.json` (Popup, bar, flyout configurations)
  11. `behavior.json` (Storefront visitor behavioral tracking)
  12. `predictions.json` (Store gap curves & predictive CLV models)
  13. `catalog_memory.json` (Cached Shopify product & variant metadata)
  14. `klaviyo.json` (Klaviyo credentials and sync state)
- **Impact:** 
  Any container restart, redeploy on Render, Fly.io, Cloud Run, or Docker container swap **permanently destroys all merchant orders, customer leads, active email sequences, analytics history, and shortlinks**. Furthermore, every previously sent email/SMS with a `/r/:code` tracking link immediately returns a 404 error after deployment.
- **Recommended Improvement:**
  Transition all persistent collections to the Hub app store (`hub.store.docs`), Firestore (`@firebase/firestore`), or a lightweight PostgreSQL / SQLite database via Cloud SQL / Supabase / Turso. At minimum, implement a bi-directional Hub Store sync worker that persists these collections on mutation and rehydrates them at startup.

---

### 1.2 `saveJourney` Silently Strips Forecasts, Workspace Associations, and Metadata
- **File / Lines:** `server.mjs:234-250`, `src/App.tsx:95-104`
- **Issue:** 
  In `server.mjs:237-249`:
  ```javascript
  const PROJECT_TEXT_FIELDS = ['name', 'businessType', 'offerHeadline', 'goal'];
  async function saveJourney(uid, id, body) {
    const journey = {
      id,
      userId: uid,
      ...Object.fromEntries(PROJECT_TEXT_FIELDS.map((f) => [f, text(body[f])])),
      nodes: Array.isArray(body.nodes) ? body.nodes : [],
      edges: Array.isArray(body.edges) ? body.edges : [],
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      updatedAt: new Date().toISOString()
    };
    ...
  ```
  `saveJourney` strictly cherry-picks only `name`, `businessType`, `offerHeadline`, and `goal`. It silently ignores and drops:
  - `project.forecast` (The entire Wave 10 Financial Simulator configuration and results)
  - `project.workspaceId` (The multi-tenant workspace association)
  - `project.shopifyStoreDomain`
- **Impact:** 
  When a merchant uses the Financial Simulator drawer to model their funnel economics and clicks "Save Forecast", the forecast is saved only to the current browser's local storage. The moment they log in from another browser or rehydrate from the server, the forecast is completely lost. Similarly, journeys lose their workspace tenancy binding upon server save.
- **Recommended Improvement:**
  Expand `saveJourney` and `cleanJourneyProject` to preserve `forecast`, `workspaceId`, and `shopifyStoreDomain`:
  ```javascript
  if (body.forecast && typeof body.forecast === 'object') journey.forecast = body.forecast;
  if (body.workspaceId) journey.workspaceId = String(body.workspaceId);
  if (body.shopifyStoreDomain) journey.shopifyStoreDomain = String(body.shopifyStoreDomain);
  ```

---

### 1.3 Event-Loop Starvation & Disk Thrashing on Shopify Pixel (`/api/public/shopify-pixel`)
- **File / Lines:** `server.mjs:469-485`, `server.mjs:9426-9454`
- **Issue:** 
  Every visitor browsing a merchant's Shopify storefront triggers the pixel endpoint (`/api/public/shopify-pixel`). On **every single request**:
  1. `loadBehaviorBag(uid)` calls `readJsonObject(behaviorPath)`, reading the multi-megabyte `behavior.json` file from disk.
  2. `JSON.parse` parses up to 50,000 events across all tenants.
  3. The new event is appended.
  4. `JSON.stringify(all)` serializes the entire database.
  5. `fs.writeFileSync(behaviorPath, ...)` writes the entire file synchronously back to disk.
- **Impact:** 
  Under modest storefront traffic (e.g., 20 simultaneous visitors browsing products), Node's single thread blocks completely on synchronous disk I/O and JSON parsing. Requests queue up, response latencies spike into multi-seconds, and the server crashes from event loop starvation. Concurrent writes also race and truncate/corrupt `behavior.json`.
- **Recommended Improvement:**
  Buffer incoming pixel beacons in an in-memory queue and flush to storage in batches (e.g., every 5–10 seconds), or ingest events into an append-only log or Redis stream.

---

### 1.4 Post-Restart Shopify Webhook Ingestion Failure (`workspaceByShopDomain`)
- **File / Lines:** `server.mjs:403-410`, `server.mjs:711-720`
- **Issue:** 
  When Shopify delivers a webhook (orders, checkouts, refunds), `acceptShopifyWebhook` looks up the workspace via `workspaceByShopDomain(shopDomain)`. This function iterates exclusively over `workspaceCache` (loaded from the local `workspaces.json`).
  If the spoke redeploys and `workspaces.json` is fresh or empty, `workspaceCache` has no records. Although `loadWorkspace` can fetch individual workspaces from `hub.store.docs.get`, it never rehydrates `workspaceCache` on boot or on webhook lookup.
- **Impact:** 
  All incoming Shopify webhooks immediately fail with HTTP 401: *"This store has no app API secret saved, so the webhook was refused."*
- **Recommended Improvement:**
  On server startup, fetch the tenant workspace list from `hub.store.docs.list()` and seed `workspaceCache`. Additionally, if a domain lookup misses in cache, query the Hub store before rejecting the webhook.

---

### 1.5 Unindexed $O(N \times M)$ Startup Loop Blocks Server Boot (`purgeSeededFiles`)
- **File / Lines:** `server.mjs:9676-9724`
- **Issue:** 
  At server startup, `purgeSeededFiles()` executes synchronously before `app.listen()`. Lines 9693–9703 iterate over every contact and perform a nested `.filter()` across the entire orders array:
  ```javascript
  for (const contact of contacts) {
    const mine = orders.filter(o => String(o.customerEmail).toLowerCase() === String(contact.email).toLowerCase());
    ...
  }
  ```
- **Impact:** 
  For 10,000 contacts and 20,000 orders, this executes 200,000,000 comparisons synchronously on boot, causing massive startup delays or process timeouts in cloud orchestrators (Render/Kubernetes liveness probe failures).
- **Recommended Improvement:**
  Pre-index orders by `customerEmail` into a `Map<string, Order[]>` before looping over contacts (reducing time complexity from $O(N \times M)$ to $O(N + M)$).

---

## 2. Automation, Execution & Background Processing

### 2.1 Automated Lead Nurture Drips & Flows Do Not Run in the Background
- **File / Lines:** `server.mjs:3791-3884`, `server.mjs:5009-5060`, `src/components/campaign/HubEmailSuite.tsx:233-248`
- **Issue:** 
  The "automated" email nurture system has **no background timer, cron runner, or job scheduler**.
  `processAccountAutomations(uid)` and `processCustomFlows(uid)` are strictly invoked from a single HTTP POST handler: `app.post('/api/drips/process-tick', requireUser, ...)`.
  The only place this handler is invoked in the entire codebase is a manual button click in the `HubEmailSuite` frontend tab:
  ```typescript
  const handleRunDripTick = async () => {
    const res = await fetch('/api/drips/process-tick', { method: 'POST', ... });
  };
  ```
- **Impact:** 
  Scheduled follow-up sequences, abandoned checkout recovery emails, winback flows, and buyer re-engagements **never send automatically**. If a prospect opts in, they will not receive Step 2 (e.g., 24-hour delay) unless the merchant happens to open the admin panel and manually click "Run Drip Tick". If the merchant is offline for a week, zero follow-ups are sent.
- **Recommended Improvement:**
  Add a recurring server-side job (e.g., Node `setInterval` running every 60 seconds across active accounts, or a lightweight cron worker triggering an internal `/api/internal/cron/drips` authenticated with a secret key) to process due steps continuously.

---

### 2.2 SMS Dispatch Consent Verification via Hub Audience (TCPA / CTIA Compliance Boundary)
- **File / Lines:** `server.mjs:2940-2958`, `hub-sdk.js:1035-1050`
- **Architectural & Security Rationale:** 
  Calling `hub.email.sms.audience()` from the Hub is an essential **TCPA/CTIA legal compliance and security boundary**. 
  Under federal regulations (TCPA), commercial text messages may only be delivered to recipients with verifiable, un-revoked opt-in consent; statutory damages range from $500 to $1,500 per unauthorized message.
  The Zelus Labs Hub acts as the centralized authority for carrier webhooks and opt-outs (e.g., when a recipient replies `"STOP"`, the Hub instantly suppresses their number).
- **Execution Safeguard:** 
  Querying the Hub directly prior to dispatch ensures that opt-outs received via carrier networks are honored in real time across all spokes without stale local cache risks. To prevent network thrashing during high-volume ticks while preserving live consent guarantees, consent is verified directly against the Hub's authoritative consent registry.

---

### 2.3 Redirect Shortlink Lookup Rewrites File Multiple Times Per Render
- **File / Lines:** `server.mjs:1396-1435`
- **Issue:** 
  `rewritePlainMailLinks` iterates through all links in an email template. For each link found, it calls `rememberRedirect()`. Inside `rememberRedirect`:
  ```javascript
  const rows = loadRedirects();
  rows.push({...});
  saveRedirects(rows);
  ```
  `saveRedirects` calls synchronous `fs.writeFileSync(redirectsFilePath, ...)`.
- **Impact:** 
  If a newsletter contains 6 links, `redirects.json` is read and rewritten 6 times synchronously. Across a broadcast of 500 recipients, this triggers thousands of redundant disk writes.
- **Recommended Improvement:**
  Batch shortlink generations in memory and write to storage once per email broadcast.

---

## 3. Multi-Tenancy, Security & Isolation Loopholes

### 3.1 Public Page Hijacking via Flat Slug Namespace
- **File / Lines:** `server.mjs:6747-6762`, `server.mjs:8657-8712`
- **Issue:** 
  Public pages are stored in a flat dictionary: `publicPageCache[cleanSlug] = data`.
  When a user publishes a page via `/api/journey/:id/publish`, the server generates a clean slug (e.g., `offer-1`, `summer-glow`, `vip-deal`). The route does **not** check whether `cleanSlug` is already owned by another `userId`.
- **Impact:** 
  Tenant B can intentionally or accidentally publish a page with the same slug as Tenant A, overwriting Tenant A's live landing page, stealing their traffic, and capturing their customer leads.
- **Recommended Improvement:**
  Enforce unique slug ownership or namespace public URLs by workspace/subdomain:
  ```javascript
  const existing = publicPageCache[cleanSlug];
  if (existing && existing.userId !== req.user.uid) {
    return res.status(409).json({ success: false, error: 'That slug is already taken by another brand.' });
  }
  ```

---

### 3.2 Custom Domain Takeover Without Verification
- **File / Lines:** `server.mjs:6751-6759`, `server.mjs:8702-8704`, `server.mjs:9179-9215`
- **Issue:** 
  When publishing a page with `customDomain`, the server assigns `publicPageCache['domain:' + customDomain] = cleanSlug` immediately, without requiring DNS CNAME or TXT verification.
  Furthermore, the verification endpoint `GET /api/domain/verify` has **no authentication middleware** (`requireUser` is absent), allowing arbitrary callers to query DNS records.
- **Impact:** 
  Any user can input a high-traffic third-party domain (e.g., `shop.competitor.com`). If that domain ever points a CNAME to Jourvance's ingress, the unauthorized user's funnel will be served.
- **Recommended Improvement:**
  Enforce DNS ownership via unique TXT verification tokens (e.g., `jourvance-verification=random-hash`) before routing host header traffic, and add `requireUser` to `/api/domain/verify`.

---

### 3.3 Unauthenticated Lead Ingestion Route Vulnerable to Spam Flood
- **File / Lines:** `server.mjs:8801-8898`
- **Issue:** 
  `POST /api/public/lead` has zero rate-limiting, no CAPTCHA or Cloudflare Turnstile integration, no honeypot field, and no origin check. Each submission triggers synchronous disk writes and flow enrollments.
- **Impact:** 
  A malicious actor or web crawler can submit millions of fake leads, polluting CRM databases, filling disk storage, triggering unauthorized outbound email/SMS costs, and blacklisting sender reputations.
- **Recommended Improvement:**
  Implement IP-based rate limiting (e.g., max 5 submissions per minute per IP), add a hidden honeypot field (`website_url_hp`), and integrate Cloudflare Turnstile or reCAPTCHA v3.

---

### 3.4 Blended Attribution Metrics Across Workspaces & Timeframes
- **File / Lines:** `server.mjs:5164-5256`, `src/components/analytics/AttributionReports.tsx:27-36`
- **Issue:** 
  1. `AttributionReports.tsx` never passes `workspaceId` in its fetch query (`/api/reports/attribution?model=...`). On the backend, `server.mjs:5168` aggregates all orders and events solely by `req.user.uid`.
  2. Ad spend calculation in lines 5248–5256 loops over **every journey owned by the user** and sums `node.data.spend` unconditionally, ignoring both the selected workspace and the `7d` / `30d` date filter.
- **Impact:** 
  If a merchant manages two separate Shopify stores under one account, their revenue, ROAS, click-through rates, and CAC metrics are completely mixed together. Furthermore, ad spend is counted statically from all past journeys, distorting short-term ROAS metrics.
- **Recommended Improvement:**
  Pass `workspaceId` as a query parameter, filter events and orders by workspace, and calculate ad spend within the selected time window.

---

### 3.5 Hardcoded Operator PII in Client Bundle
- **File / Lines:** `src/lib/firebase.ts:27`, `server.mjs:77`
- **Issue:** 
  The operator's personal email (`tlm@tarrenmunoz.com`) is hardcoded directly into the client TypeScript bundle (`src/lib/firebase.ts:27`).
- **Impact:** 
  Exposes the administrator's email address to anyone inspecting the public client bundle and makes deploying Jourvance for other operators difficult without source code edits.
- **Recommended Improvement:**
  Supply operator emails exclusively via environment variables (`process.env.OPERATOR_EMAIL`) and verify permissions on backend APIs.

---

## 4. Compliance, Legal & Deliverability Vulnerabilities

### 4.1 Missing Unsubscribe Mechanism Under Default Configuration (CAN-SPAM / GDPR)
- **File / Lines:** `server.mjs:1386-1388`, `server.mjs:1559-1562`, `email-doc.mjs:1171-1178`
- **Issue:** 
  In `server.mjs:1386`:
  ```javascript
  function mailLinkSecret() {
    return process.env.MAIL_LINK_SECRET || process.env.HUB_API_KEY || '';
  }
  ```
  If neither `MAIL_LINK_SECRET` nor `HUB_API_KEY` is configured in the environment:
  `signUnsubscribe(secret, uid, email)` returns `""`.
  Then `unsubscribeUrlFor` returns `""`.
  When `renderLetter` renders the email footer, it produces no unsubscribe link, rendering only:
  > *"An unsubscribe link is added for each person when this sends."*
- **Impact:** 
  Emails are dispatched to recipient inboxes **with no functional unsubscribe link**. This is an immediate violation of the US CAN-SPAM Act, EU GDPR, and Google/Yahoo bulk sender requirements, leading to domain blacklisting and legal liability.
- **Recommended Improvement:**
  Generate a persistent fallback secret on initial server setup if none is supplied in `.env`, and block outgoing marketing emails with a validation error if no unsubscribe token can be signed.

---

### 4.2 Key Rotation Invalidates All Past Unsubscribe Links
- **File / Lines:** `email-doc.mjs:1180-1195`, `server.mjs:1386`
- **Issue:** 
  Unsubscribe tokens are HMAC-SHA256 signatures generated from `mailLinkSecret()`. If `HUB_API_KEY` is rotated (or `MAIL_LINK_SECRET` updated), `readUnsubscribe` fails HMAC verification on all links in previously delivered emails.
- **Impact:** 
  Recipients clicking "Unsubscribe" from older newsletters receive an invalid token error and cannot unsubscribe, leading to spam complaints.
- **Recommended Improvement:**
  Support key rotation with an array of previous verification secrets (`[CURRENT_SECRET, OLD_SECRET]`).

---

### 4.3 Missing Cookie Consent & Privacy Disclosures for Pixel Beacons
- **File / Lines:** `server.mjs:9426-9520`, `audience.mjs:613-640`
- **Issue:** 
  The Jourvance tracking script and storefront pixel set tracking cookies and beacons (`visitorId`, `sessionId`, page browsing behavior) without checking for user consent or integrating with Shopify's Customer Privacy API.
- **Impact:** 
  European (GDPR) and Californian (CCPA) storefront visitors are tracked without explicit consent, creating compliance risks for merchants.
- **Recommended Improvement:**
  Integrate with Shopify's `window.Shopify.customerPrivacy` API to honor consent preferences before activating behavioral beacons.

---

## 5. E-Commerce & Funnel Execution Breakdowns

### 5.1 Turnkey Blueprints Hardcode Rejected Variant IDs
- **File / Lines:** `src/data/ecomBlueprints.ts:63-64`, `src/lib/shopifyClient.ts:167-204`, `server.mjs:316-331`
- **Issue:** 
  The turnkey e-commerce blueprints hardcode dummy Shopify IDs (e.g., variant `42109840192`, product `gid://shopify/Product/84920194821`).
  However, both `shopifyClient.ts` and `server.mjs` contain:
  ```javascript
  const FAKE_VARIANT_IDS = new Set(['42109840192', '42109840193', '42109840194']);
  ```
  `buildCheckoutPermalink` strips these IDs and returns an empty string `""`.
- **Impact:** 
  When a merchant loads a blueprint and publishes their page, the generated checkout link is empty or points to `https://mystore.myshopify.com/cart/`. Clicking checkout results in an empty cart or error. There is no alert warning the merchant to select a real product from their store.
- **Recommended Improvement:**
  In `PageEditor.tsx` and `PublishModal.tsx`, display a prominent warning banner if `shopifyVariantId` is empty or a placeholder, disabling publishing until a real product is selected.

---

### 5.2 Silent Page Reload on Empty Checkout Links
- **File / Lines:** `src/components/drawers/PageEditor.tsx:779`, `src/components/drawers/PageEditor.tsx:1187`, `server.mjs:7793`
- **Issue:** 
  When `currentCheckoutUrl` is empty (due to disconnected store or missing variant), `PageEditor.tsx` renders `<a href="">`.
  On public SSR landing pages, `server.mjs:7793` contains:
  ```javascript
  if (!storeDomain) return;
  ```
- **Impact:** 
  Clicking the primary call-to-action button does nothing, or simply refreshes the page, confusing visitors and merchants during testing.
- **Recommended Improvement:**
  Render an informative disabled state or modal prompt explaining that the store must be connected.

---

### 5.3 Exported Funnel HTML Contains Dummy Non-Functional Form
- **File / Lines:** `src/components/export/ExportAssetsModal.tsx:167`
- **Issue:** 
  The "Export Assets" modal allows merchants to export production HTML for their landing pages. Line 167 renders the form as:
  ```html
  <form onsubmit="event.preventDefault(); alert('Form submitted successfully!');">
  ```
- **Impact:** 
  If a merchant exports this code and embeds it into WordPress, Webflow, or Shopify, the form does not capture leads, does not write to the Jourvance CRM, does not send webhooks, and does not enroll contacts into email flows. 100% of leads are lost.
- **Recommended Improvement:**
  Render a real form action that submits via `fetch()` to `https://jourvance.com/api/public/lead` with proper slug, journey ID, and visitor attribution tokens.

---

### 5.4 AI Copy Generator Fails Silently on Markdown Fences
- **File / Lines:** `server.mjs:6718-6729`
- **Issue:** 
  When requesting AI copy via `hub.brain.chat(prompt, { json: true })`, LLMs frequently wrap their JSON response in markdown code blocks:
  ````markdown
  ```json
  { "headline": "Radiant Skin in 7 Days", "subhead": "..." }
  ```
  ````
  Line 6720 performs a strict `JSON.parse(answer.text)`. When code fences are present, `JSON.parse` throws a syntax error, caught by the generic catch block, and the route silently falls back to static hardcoded templates (`templateCopy`).
- **Impact:** 
  The merchant receives generic placeholder text instead of real AI-generated copy, despite spending hub AI credits.
- **Recommended Improvement:**
  Strip markdown fences before parsing:
  ```javascript
  const cleanJson = answer.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleanJson);
  ```

---

### 5.5 Silent Overwrite of User Copy via `clearTemplateMetrics`
- **File / Lines:** `src/lib/journeyStorage.ts:13`, `src/lib/liveStats.ts:17-64`
- **Issue:** 
  Every time `loadCurrentJourney()` runs (on page reload or app mount), it passes the saved project through `clearTemplateMetrics(parsed)`.
  Any node with an ID matching `TEMPLATE_NODE = /^(node-(ad|page|form|seq)-1|bp[1-4]-)/` is passed through `zeroMeasured()`.
  In `zeroMeasured()`, any string matching `INVENTED_PROOF` or `SEEDED_PROMISE` is wiped:
  ```typescript
  const INVENTED_PROOF = /4\.9\/5|verified (beauty lovers|customers|buyers|clients)|\d[\d,]*\+\s*(verified |members|clients|buyers|beauty)|100% satisfaction|zero risk, zero obligation|guaranteed quality|5-star results|money-back|clinically proven/i;
  ```
- **Impact:** 
  If a merchant loads a blueprint and writes legitimate, verified marketing claims (e.g., *"Backed by our 100% satisfaction money-back guarantee"* or *"Rated 5-star results by our clients"*), saving and refreshing the browser **silently overwrites their headline back to generic text**: `"Your offer headline"`.
- **Recommended Improvement:**
  Only scrub seeded metrics once when a blueprint is first cloned, rather than sanitizing node copy on every subsequent load of saved projects.

---

## 6. UI, UX, Conversion & Buyer Trust Red Flags

### 6.1 Developer Disclaimers Exposed on Public Marketing Home Page
- **File / Lines:** `src/components/public/HomePage.tsx:49-51`, `src/components/public/HomePage.tsx:1248`, `src/components/public/HomePage.tsx:1334-1344`
- **Issue:** 
  The public marketing homepage contains internal developer notes visible to all visitors:
  - In the Pricing Section:
    - Subtitle: *"Billing is not connected in this app yet."*
    - Badge: *"Not a paid plan"*
    - Tier Description: *"The same studio. Billing is not connected, so this button does not start a subscription."*
    - Price: *"No charge"*
  - In the Public FAQ:
    - *"Does Jourvance charge per-lead or transaction fees? Billing is not connected in this app, so it does not charge per lead and it does not sell a Pro plan from this page."*
- **Impact:** 
  Destroys software credibility. Any prospective buyer immediately perceives the product as an incomplete prototype rather than a premium SaaS tool.
- **Recommended Improvement:**
  Present polished, commercial SaaS copy with clear plan tiers (e.g. Free Sandbox vs. Pro $49/mo), and handle subscription routing gracefully (e.g. "Join Waitlist" or direct Stripe checkout).

---

### 6.2 Dead-End Billing & Missing Upgrade Pathway
- **File / Lines:** `src/components/billing/BillingModal.tsx:16-18`
- **Issue:** 
  When a user exceeds the workspace limit (HTTP 402) and is shown the Billing modal, clicking "Upgrade to Jourvance Growth Pro" triggers:
  ```typescript
  const handleUpgrade = () => {
    setNotice('Billing is not connected. Nothing was charged, and the plan did not change.');
  };
  ```
  Additionally, the monthly vs. annual billing toggle state is declared on line 13 but never rendered in the UI.
- **Impact:** 
  Users who want to pay and upgrade are completely blocked with a dead-end notice.
- **Recommended Improvement:**
  Integrate Stripe Checkout, LemonSqueezy, or Hub Billing webhooks to allow automated self-serve plan upgrades.

---

### 6.3 Contact Page Relies on External Third-Party Webhook
- **File / Lines:** `src/components/public/ContactPage.tsx:28-56`
- **Issue:** 
  In `ContactPage.tsx`, contact submissions save to local browser storage (`localStorage.getItem('jourvance_inquiries')`) and attempt an outbound `fetch()` to `https://zeluslabs.dev/api/crm/webhook/jourvance`.
- **Impact:** 
  If `zeluslabs.dev` is offline, experiencing CORS restrictions, or blocked by privacy extensions, inquiries are lost to the operator. There is no internal Jourvance backend endpoint storing customer inquiries.
- **Recommended Improvement:**
  Route contact inquiries through an internal authenticated endpoint: `POST /api/public/inquiry`.

---

## 7. Canvas Engine & State Synchronization Glitches

### 7.1 Canvas Keyboard Deletions Not Persisted to State
- **File / Lines:** `src/components/canvas/JourneyCanvas.tsx:119-124`
- **Issue:** 
  When a user selects a node or edge on the canvas and presses `Backspace` or `Delete`, ReactFlow fires `onNodesChange` with `{ type: 'remove' }`. The canvas handles this in local ReactFlow state (`onNodesChangeHandler`), but **never calls `onNodesChange(rfNodes)` or `onEdgesChange(rfEdges)` on the parent `App` component**.
- **Impact:** 
  The node disappears from the canvas visually, but remains in `project.nodes`. When the 20-second stats polling interval fires, the deleted node suddenly reappears on the canvas.
- **Recommended Improvement:**
  In `JourneyCanvas.tsx`, detect removal changes and forward the updated node list to the parent component.

---

### 7.2 Node Position Snapping During User Interaction
- **File / Lines:** `src/App.tsx:149`, `src/components/canvas/JourneyCanvas.tsx:62-71`
- **Issue:** 
  `App.tsx` polls `/api/funnel/stats` every 20 seconds. Applying stats updates `project.nodes`. This triggers the `useEffect` in `JourneyCanvas` which overwrites `rfNodes`.
- **Impact:** 
  If a user is actively dragging or arranging nodes, the node snaps back to its previous coordinates when the poll completes.
- **Recommended Improvement:**
  Only update node data metrics (`node.data = { ...node.data, ...stats }`) without resetting node coordinates (`node.position`).

---

### 7.3 Missing UI Error Handling in Email Programs
- **File / Lines:** `src/components/campaign/EmailPrograms.tsx:139-141`
- **Issue:** 
  If the API call to `/api/email/suite` fails (e.g. 500 error or network timeout), `suite` remains `null`. The component renders:
  ```tsx
  if (!suite) {
    return <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading the email suite…</p>;
  }
  ```
- **Impact:** 
  The user is stuck on a permanent "Loading the email suite…" screen with no error feedback or retry option.
- **Recommended Improvement:**
  Add explicit error state and a "Retry" button.

---

### 7.4 NodeInspector Missing Title for 'upsell' Node
- **File / Lines:** `src/components/drawers/NodeInspector.tsx:38-47`
- **Issue:** 
  `getTitle()` contains cases for `ad-source`, `landing-page`, `lead-form`, `follow-up-sequence`, and `thank-you`, but omits `upsell`.
- **Impact:** 
  When editing post-purchase upsell/downsell nodes, the drawer displays generic `"Node Configuration"` rather than `"Upsell & Downsell Offer Editor"`.

---

## 8. Routing, SEO & Frontend Architecture

### 8.1 Zero Browser URL Routing (State-Only Navigation)
- **File / Lines:** `src/App.tsx:33`, `src/main.tsx:1-11`, `server.mjs:9360-9366`
- **Issue:** 
  Navigation across the public site is driven entirely by internal state:
  `const [activePage, setActivePage] = useState<'home' | 'about' | 'blog' | 'contact' | 'canvas'>('home');`
  There is no client-side router (e.g., React Router, Wouter, or HTML5 History pushState).
- **Impact:** 
  - Visitors cannot bookmark or directly share links to `/about`, `/blog`, or `/contact`.
  - Refreshing the browser on the Blog or Contact page immediately resets the app back to the Home page.
  - Search engines (Google, Bing) cannot crawl or index subpages because unique URLs do not exist.
- **Recommended Improvement:**
  Implement simple HTML5 history routing (`window.history.pushState` or lightweight router) that synchronizes the browser address bar with `activePage`.

---

### 8.2 Giant Monolithic Client Bundle (1.17 MB Uncompressed)
- **File / Lines:** `src/App.tsx:1-30`, `vite.config.ts`
- **Issue:** 
  All top-level screens and heavy dependencies (`@xyflow/react`, `HubEmailSuite`, `AttributionReports`, `OperatorDashboard`, `FinancialSimulatorDrawer`, modals) are imported statically at the top of `App.tsx`.
- **Impact:** 
  When a prospective buyer visits `jourvance.com` just to read the homepage or blog, their browser is forced to download 1.17 MB of JavaScript before the page can hydrate, harming Core Web Vitals (LCP, INP) and mobile bounce rates.
- **Recommended Improvement:**
  Split bundles using `React.lazy()` for all sub-dashboards, drawers, and admin views.

---

### 8.3 9,729-Line Monolithic `server.mjs`
- **File / Lines:** `server.mjs:1-9729`
- **Issue:** 
  `server.mjs` contains nearly 10,000 lines in a single file combining authentication, Shopify webhook ingestion, SSR HTML templating, CRM management, email flow execution, AI copy generation, DNS verification, and analytics.
- **Impact:** 
  Extremely high risk of regressions during code edits, difficult developer onboarding, and inability to write isolated unit tests for individual route handlers.
- **Recommended Improvement:**
  Modularize `server.mjs` into dedicated route controllers (`server/routes/auth.mjs`, `server/routes/shopify.mjs`, `server/routes/email.mjs`, `server/routes/publicPages.mjs`, etc.).

---

## 9. Prioritized Remediation Roadmap

| Priority | Category | Problem / Gap | Impact | Status |
|:---:|:---|:---|:---|:---:|
| **P0** | **Durability** | Ephemeral JSON files wipe orders & CRM on deploy | Complete data loss on container restarts | **RESOLVED** (Hub Firestore Adapter `hub-storage.mjs`) |
| **P0** | **Stability** | Synchronous multi-megabyte `behavior.json` write on pixel | Event loop lockup under store traffic | **RESOLVED** (In-memory buffer with 5s batch flush) |
| **P0** | **Durability** | `saveJourney` strips `forecast`, `workspaceId`, `shopifyStoreDomain` | Saved forecasts & workspace links disappear on reload | **RESOLVED** (Preserved in `server.mjs` & `App.tsx`) |
| **P0** | **Durability** | Shopify webhook 401 failure on container restart | In-memory cache empty after deploy | **RESOLVED** (Auto-rehydration of workspaces on boot) |
| **P0** | **Performance**| Unindexed O(N*M) startup loop in `purgeSeededFiles` | Startup hangs on boot | **RESOLVED** (Pre-indexed Map O(N+M)) |
| **P0** | **Automation** | Drips and automations never execute in background | Zero emails/SMS sent unless merchant clicks button | **RESOLVED** (In-process 60s runner with concurrency guard) |
| **P1** | **Legal / Compliance** | Unsubscribe links empty when secret missing; breaks CAN-SPAM | Domain blacklisting & compliance violation | **RESOLVED** (Guaranteed HMAC secret fallback) |
| **P1** | **Trust / UX** | "Billing not connected" disclaimers on public homepage | Kills buyer trust and SaaS credibility | **RESOLVED** (Starter Studio vs Growth Pro + VIP Waitlist) |
| **P1** | **Data Integrity** | `clearTemplateMetrics` wipes user headlines containing guarantee copy | Silent user data erasure on reload | **RESOLVED** (Preserved user-saved copy) |
| **P1** | **Security** | Flat slug namespace permits page & domain hijacking | Tenant traffic & lead theft | **RESOLVED** (Enforced slug ownership in publish route) |
| **P1** | **Security** | Unauthenticated `/api/public/lead` and `/api/domain/verify` | Spam flooding & DNS probing | **RESOLVED** (Honeypot + IP rate limiter on lead, requireUser on verify) |
| **P1** | **Analytics** | Attribution reports blend metrics across all workspaces & journeys | Distorted ROAS and revenue tracking | **RESOLVED** (Scoped events, orders & journey ad spend to workspaceId) |
| **P2** | **Functionality** | Exported HTML form has dummy `alert()` onsubmit | Lost leads for exported funnels | **RESOLVED** (Real API lead submission script with honeypot) |
| **P2** | **UX / Canvas** | Canvas keyboard node deletion not synced to parent | Deleted nodes reappear after 20s | **RESOLVED** (Propagated deletions to parent state) |
| **P2** | **Commerce** | Blueprints contain rejected placeholder variant IDs | Broken checkout links on new funnels | **RESOLVED** (Warning banner in PageEditor) |
| **P2** | **AI Logic** | Markdown code fences break AI copy JSON parsing | Merchant gets fallback static templates | **RESOLVED** (Markdown fence strip before JSON.parse) |
| **P2** | **Routing / SEO** | No browser URL routing (state-only navigation) | Subpages unindexable, refresh resets to Home | **RESOLVED** (HTML5 History API routing in App.tsx) |
| **P2** | **UX / Canvas** | NodeInspector generic title on upsell nodes | Confusing drawer context | **RESOLVED** (Added Upsell & Downsell Offer Editor title) |
| **P2** | **UX / Canvas** | Node position snapping during 20s live stats poll | Jittery canvas dragging experience | **RESOLVED** (Preserved in-flight coordinates in `setRfNodes` via positionMap) |
| **P2** | **Lead Capture**| Contact page relied exclusively on external webhook | Dropped customer inquiries on third-party failure | **RESOLVED** (Internal `POST /api/public/inquiry` persisted to Firestore with async webhook relay) |
| **P2** | **UX / Email**  | Email programs stuck on permanent loading screen | No retry on network or auth hiccups | **RESOLVED** (Explicit load error state with "Retry Loading" button) |
| **P2** | **Commerce**    | Silent refresh when clicking checkout on unconfigured store | Confusing click behavior for buyers/merchants | **RESOLVED** (Friendly launch alert on public page and PageEditor) |
| **P2** | **Security**    | Hardcoded operator email in client bundle | Configuration inflexibility and PII exposure | **RESOLVED** (Configurable via `VITE_OPERATOR_EMAIL`) |
| **P2** | **UX / Onboarding** | First-time merchants lack clear path from canvas to launch | Decision paralysis and lower funnel completion | **RESOLVED** (Interactive 3-step Launch Readiness Checklist in `CanvasHeader`) |
| **P3** | **Performance** | 1.17 MB monolithic bundle with no code-splitting | Slow mobile load times | **RESOLVED** (Code-split with React.lazy; entry chunk reduced to 184 kB) |
| **P3** | **Architecture** | Monolithic `server.mjs` | Maintenance and regression risk | Documented for future architectural modularization |
| **P1** | **Conversion / Positioning** | Narrow "beauty-only" copy locked out all other business verticals | Restricts market to beauty only | **RESOLVED** (Universal turnkey blueprints: D2C, High-Ticket Consulting, Digital SaaS, VIP Magnet, OTO Upsell) |
| **P1** | **Conversion / Mobile** | Mobile visitors scroll past hero CTA with no persistent action bar | Mobile bounce & lost conversions | **RESOLVED** (Mobile Sticky Action Bar with per-page toggle switch in `PageEditor.tsx` & auto-scroll trigger) |
| **P1** | **Automation / Commerce** | Single-touch abandoned checkout recovery with no items summary or courtesy discount | Low cart recovery conversion | **RESOLVED** (2-Stage Recovery Engine: 45m items reminder + 24h `SAVE10` 10% courtesy discount) |
| **P1** | **Compliance / Security** | Rotating HMAC mail secret invalidated historical unsubscribe links | CAN-SPAM / GDPR compliance hazard | **RESOLVED** (`MAIL_LINK_OLD_SECRETS` multi-secret rotation array in `server.mjs`) |
| **P1** | **Privacy / Compliance** | Tracking snippet fired before European/Californian visitor consent | GDPR / CCPA privacy violation | **RESOLVED** (Shopify Customer Privacy API check + `visitorConsentCollected` event queue) |
| **P1** | **Analytics / Drop-Off** | Generic static edge labels with zero drop-off analysis or leak diagnostics | Merchants unable to spot where funnel is leaking revenue | **RESOLVED** (Step-aware empirical conversion benchmarks, interactive `EdgeInspector` drawer, animated SVG flow, and revenue leakage calculator) |
| **P1** | **Workspaces / Blueprints** | Inability to save custom journey blueprints at user account level or share between users | Duplicate manual funnel rebuilding across workspaces & friction onboarding clients | **RESOLVED** (Account-level custom blueprint library, tenant isolation, share codes, deep-link import, and always-accessible header toolbar action) |
| **P1** | **Deliverability / Domains** | Custom domain SSL unverified and missing email DNS verification (SPF, DKIM, DMARC, MX) | Funnel SSL trust warnings and high risk of emails landing in Spam (Google/Yahoo non-compliance) | **RESOLVED** (Custom domain TLS SNI probe, dedicated Email Deliverability & DNS Suite with real-time SPF, DKIM, DMARC, MX checks and 1-click copy setup table) |
| **P1** | **Conversion / Optimization** | Visual canvas lacked A/B split-testing routing node; split testing was buried inside page modal | Inability to visually branch traffic, test distinct pages or offers, or track edge conversion lift | **RESOLVED** (Dedicated `AbSplitNode` with dual output handles, preset & custom slider distribution, live statistical confidence meter, 1-click winner lock, edge throughput integration, and sticky cookie HTTP 302 router) |
| **P1** | **Self-Hosting / Export** | Asset export lacked multi-page support, split routing, thank-you portal, and only exported single page | Merchants self-hosting on Webflow, WordPress, Shopify, or custom CDNs could not run A/B splits or multi-page funnels | **RESOLVED** (Complete Funnel Export Engine: client-side deterministic sticky router `split-router.html`, static Variant A/B files, in-DOM dynamic switcher, standalone VIP Thank-You Portal, editable CDN destination URLs, and batch download) |
| **P1** | **Self-Hosting / Ingestion** | Exported HTML lead submissions failed across origins due to missing server CORS and hardcoded relative URL | 100% of leads lost on self-hosted Webflow, WordPress, and custom CDN landing pages | **RESOLVED** (Hybrid Dual-Sync lead ingestion: CORS enabled on `POST /api/public/lead` with `OPTIONS` preflight, tenant & journey ID binding, and simultaneous outbound relay to custom external webhooks) |
| **P1** | **Self-Hosting / OTO** | Asset exporter ignored post-purchase upsell & downsell nodes; merchants had no way to export multi-step OTO funnels | Merchants self-hosting could not deploy 1-click post-purchase upsells or downsells, losing high-margin AOV expansion | **RESOLVED** (Standalone 1-Click Upsell & Downsell HTML Export: `generateUpsellHtml` with sessionStorage-persisted urgency timer, strikethrough pricing, direct Shopify `/cart/{variantId}:1` linking, polite decline fallback routing to downsell or thank-you portal, and editable modal URL mapping) |
| **P1** | **Forecasting / Economics** | Financial simulator modeled only single-item purchases, omitting multi-step post-purchase upsell and downsell take rates | Merchants under-projected funnel AOV and ROAS, unable to calculate multi-offer backend economics before launching ad spend | **RESOLVED** (Multi-Step OTO Funnel Economics: automatic canvas price extraction for bump, upsell, and downsell nodes, decline-pool downsell conversion modeling, AOV lift calculations, and Waterfall unit economics in `FinancialSimulatorDrawer.tsx`) |
| **P2** | **UX / Canvas Telemetry** | Canvas node cards displayed generic throughput without instant conversion rate or revenue visibility | Merchants had to open inspection drawers to see node CVR %, take rates, or revenue generated | **RESOLVED** (In-Card Live Telemetry Badges: dynamic CVR % and dollar revenue pills on `PageNode.tsx`, live take rate % and +revenue attribution pills on `UpsellNode.tsx`, and real-time order bump attach indicators) |
| **P1** | **Attribution / AOV** | Attribution reports only showed single aggregated revenue number without multi-offer stream breakdown or AOV expansion lift | Merchants could not see how much revenue each offer tier (core, bump, upsell, downsell) contributed or quantify AOV lift per customer | **RESOLVED** (Multi-Offer Revenue Breakdown & AOV Expansion in `AttributionReports.tsx`: 4-tier waterfall cards, base vs effective blended AOV lift pill, revenue share distribution bar, OrderBump in CSV export, and `aovExpansion` backend telemetry) |
| **P1** | **Attribution / Channel AOV** | Channel breakdown table treated all channels equally with generic metrics, omitting per-channel AOV and bump/upsell attach rates | Merchants could not identify which marketing channel generated high-LTV backend buyers vs low-AOV churn traffic | **RESOLVED** (Channel-Specific AOV & Offer Attach Breakdown in `AttributionReports.tsx`: multi-mode toggle for "Offer & AOV Lift", "Acquisition ROI", and "All Metrics", per-channel Base AOV vs Blended AOV, bump attach %, upsell attach %, and "Top AOV Lift" indicator) |
| **P1** | **Automation / Retention** | Post-purchase upsell/downsell decline left revenue on the table with zero automated follow-up | Buyers who passed on post-purchase upgrades were permanently lost to the backend with 0% recovery | **RESOLVED** (Automated Second-Chance Post-Purchase Courtesy Flow: auto-enrollment into `drip_seq_upsell_recovery` on decline with 18h delay, `Upsell-Declined` / `Downsell-Declined` CRM tagging, `SAVE10` courtesy voucher, personalized token interpolation for `offer_url`, `discount_code`, and `order_number`, and dual live + runner smart exit on upsell accept or subsequent purchase) |
| **P1** | **Attribution / Recovery** | Attribution reports aggregated post-purchase recovery into general email channel revenue, obscuring reclaimed upsell revenue | Merchants could not see how much revenue the automated second-chance courtesy sequence recovered from initial offer declines | **RESOLVED** (Post-Purchase Courtesy Recovery Intelligence: tracked `recoveredUpsellRevenue`, `recoveredUpsellOrders`, and `recoveryRate` across declined buyers, with recovery badge on Upsell Waterfall card and courtesy flow highlight in Incremental Add-On Value card in `AttributionReports.tsx`) |
| **P1** | **Conversion / Retention** | Recovery email links sent buyers back to standard full-price upsell page with no pre-applied voucher or customer email preservation | High mobile friction and manual coupon entry caused drop-off on courtesy recovery clicks | **RESOLVED** (1-Click "Second Chance" Offer Page Variant with Pre-Applied Voucher: detects `?coupon=SAVE10&email=...&ref=recovery` in `renderPublicUpsellHtml`, renders warm "Private Courtesy Offer" banner, dynamically applies 10% strikethrough discount, updates CTA to `(10% Courtesy Off Applied)`, pre-applies `?discount=SAVE10` directly to Shopify cart URL, preserves `emailFromQuery` with `keepalive: true` telemetry, and formats automation `offerUrl` parameters in `server.mjs`) |
| **P1** | **UX / Visual Canvas Telemetry** | Upsell and downsell canvas nodes only showed initial session take rates and revenue, hiding courtesy recovery performance | Merchants had no visual feedback on the canvas to see if their automated second-chance sequence was working without switching to reports | **RESOLVED** (Option C1 Progressive Courtesy Recovery Micro-Pill: added `totalDeclines`, `recoveredTakes`, `recoveredRevenue`, and `recoveryRate` to `UpsellNodeData`, `MEASURED_KEYS` in `liveStats.ts`, and `/api/funnel/stats` in `server.mjs`. Rendered a progressive emerald pill on `UpsellNode.tsx` showing `+{recoveryRate}% Courtesy Recovered (+{recoveredTakes} orders • +${recoveredRevenue})` when recoveries exist, a subtle follow-up state when declines are pending, and clean empty state with zero visual clutter) |
| **P1** | **Conversion / Urgency & Fallback** | Courtesy recovery links lacked dynamic expiration enforcement and graceful expired handling | Buyers either delayed purchase indefinitely without urgency or encountered confusing checkout pricing if vouchers lapsed, eroding trust and conversion | **RESOLVED** (Option 1 Dynamic 24-Hour Expiration Clock & Informative Fallback: embedded `&exp=${timestamp}` into generated `offerUrl` in `processUserAutomationsTick` and `/api/public/upsell-action`. In `renderPublicUpsellHtml`, parsed `exp` parameter and validated against current server time and client-side `sessionStorage` fallback. When unexpired, renders reassuring courtesy banner with live countdown clock (`#jv-recovery-timer`) and 10% discount badge. When expired (either on SSR load or dynamically when countdown hits 00:00:00 in the browser), replaces buy card with an Informative Expired Message Card explaining the courtesy window has concluded and primary order is safe, suppresses discount, removes buy button, and renders `Continue to My Order Confirmation` linking to `nextDeclineUrl` with null-safe event listeners) |
| **P1** | **Conversion / Visual Checkout Recovery** | Abandoned checkout recovery emails used plain-text bullet lists with zero item visuals, robotic copy, and broken or un-discounted links | Shoppers dropped off from lack of visual product recognition and mobile coupon friction, resulting in low checkout recovery rates | **RESOLVED** (Option A Dynamic Visual Line-Item Cards & 1-Click Cart Permalinks: created `checkout-recovery.mjs` with responsive table-based line item cards, thumbnail rendering with catalog image fallback and neutral beauty placeholder, 3-item visual cap with clean overflow badge (`+ X more items in your bag`), subtotal and 10% courtesy discount calculation (`SAVE10`), direct Shopify 1-click cart permalinks (`/cart/{variantId}:{qty}`), pre-applied discount wrapping (`/discount/SAVE10?redirect=...`), and elevated feminine beauty copy in `INITIAL_DRIP_SEQUENCES` and 60s background runner) |
| **P1** | **CRM / Customer Lifecycle** | Static contact lists lacked automatic RFM segmentation, Whale detection, and churn inactivity tracking | Merchants could not identify their top-spending VIP whales ($500+) or automate retention flows for customers at risk of churn after 90 days | **RESOLVED** (Option B Automated RFM Customer Lifecycle Segmentation & VIP Whales in CRM: created pure deterministic engine `rfm-engine.mjs` with 6 lifecycle tiers (`VIP Platinum Whale`, `VIP Gold`, `VIP Silver`, `At-Risk`, `Lapsed`, `Lead`), custom user-defined inactivity thresholds (`atRiskDays`, `lapsedDays`, and spend tiers via `POST /api/email/rfm-config`), dynamic CRM tag auto-synchronization preserving custom merchant tags, order webhook & Shopify import hooks, 60s periodic recency decay sync, 5-card luxury audience stats ribbon with crown and warning badges, 1-click filter pills, and interactive glassmorphism RFM settings drawer in `HubEmailSuite.tsx`) |
| **P1** | **CRM / Broadcast Actionability** | RFM segment cards lacked direct 1-click campaign drafting; merchants had to manually configure segments and write winback/VIP copy | High friction creating VIP rewards and at-risk churn prevention campaigns, leading to neglected high-LTV whales and unrecovered customers | **RESOLVED** (Option 1 1-Click VIP Whale & At-Risk Broadcasts: added `whales`, `gold`, `silver`, `at_risk`, and `lapsed` to `BUILT_INS` and `inBuiltIn` in `audience.mjs`. Wired 1-click "Draft Whale Perk" and "Draft Winback" quick-action buttons directly into Audience Stats Ribbon cards in `HubEmailSuite.tsx`, pre-populating luxury feminine copy and pre-selecting target segments. Added 1-Click Beauty Campaign Presets bar (`VIP Whale Perk`, `At-Risk 15% Winback`, `Lapsed Reconnect`) in Broadcast Composer modal for instant 1-click template switching with `WELCOMEBACK15` courtesy reward code and safe segment fallback) |
| **P1** | **CRM / Automated Winback & Coupons** | Inactive at-risk customers bled into permanent churn without automated follow-up; coupon codes risked failing at checkout | Lost customer lifetime value from unrecovered churn, and trust damage if winback coupons are unredeemable | **RESOLVED** (Option A Auto-Winback Sequence & Shopify Discount Safeguards: created `drip_seq_at_risk_winback` native sequence triggered by at-risk inactivity with `smartExitOnPurchase`. In `processUserAutomationsTick`, implemented Option A deliverability guard strictly auto-enrolling clients crossing 90 days after `autoWinbackEnabledAt` with 180-day cooldown. Built automatic Shopify price rule provisioning (`provisionShopifyDiscount` and `ensureShopifyCoreDiscounts`) for `WELCOMEBACK15`, `SAVE10`, and `SANCTUARY`, enforcing 1 redemption per customer by default while providing `allowUnlimitedDiscountUse` toggle. Added toggles and verified status badges in RFM Drawer and Broadcast Modal) |
| **P1** | **SMS / Carrier Verification & Roadmap** | Unregistered 10DLC A2P SMS sending causes immediate mobile carrier rejection (Twilio Error 30034) while approval is pending | Broken merchant experience and failed message delivery if premature live sending buttons are exposed | **RESOLVED** (Option 2 Elevated Coming Soon & Interactive Telecom Roadmap: transformed `SmsPanel.tsx` into a luxury preview suite with "Carrier Verification in Progress" status badge, 3-step Telecom Gateway Roadmap card, interactive Campaign Sandbox with 3 beauty presets (`At-Risk 15% Winback`, `VIP Whale Drop`, `Cart Recovery`), real-time GSM-7 character meter, iPhone mockup rendering speech bubble with dynamic shortlinks, and CRM phone number readiness counter. Added subtle `Soon` badge to Texts tab in `HubEmailSuite.tsx`. Backend SMS endpoints (`/api/sms/preview`, `/api/sms/consent`, `/api/sms/send`, `/r/:code`) remain fully wired for zero-refactoring activation once approval clears) |

