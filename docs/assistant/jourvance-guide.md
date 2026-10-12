# Jourvance guide

This guide is what Ask Jourvance reads from when someone asks how to use the app. It describes only what the screens and the server do.

## Journey canvas and steps

A journey is a map of the steps a customer moves through, from the ad to the thank-you page. Each step is a card on the canvas (`Funnel Canvas`). Lines between cards show where a person goes next.

- Add a step with `Add Step` in the toolbar, or from the step palette in the sidebar. Click a card to open its panel and edit it.
- `Edit Canvas` is the mode for building. `Live ROAS` shows spend, gross and return totals on the same map.
- Undo and Redo sit in the toolbar. The save status reads `Saved`, `Saved in this browser`, `Unsaved changes` or `Saved, not backed up`. Press `Save` to save at once.
- `Test Lead Flow` walks the map as a visitor would. It is a simulation, and the follow-ups it shows are marked as not sent.
- `Audit` (also shown as Check design) opens design checks on your lines and pages. They do not test your live pages.

The step kinds:
- `Ad Source` is where traffic comes from: a Meta ad, a Google search ad, a TikTok ad or organic traffic. You write the `Ad Headline`, the `Primary Text / Caption`, the `Call-To-Action Button` text and a `UTM Campaign Tag`. The preview shows how the ad would look. Jourvance does not place the ad.
- `Landing Page` holds your offer: headline, copy, a Shopify product, an optional discount code and an optional order bump.
- There is no separate checkout step. Checkout is a setting on the landing page, `Checkout Flow Mode`, with the choices `Direct to Checkout` and `2-Step Lead Gate`. With no Shopify store connected, the published button opens an email form instead of a checkout.
- `Lead Capture Form` collects emails. You set the `Form Heading`, the `Submit Button Text` and the `Post-Submit Confirmation Message`.
- `Follow-Up Sequence` is the emails sent after someone joins, leaves checkout or buys. On the canvas it is read only. Edit its emails in Email Studio.
- `Post-Purchase Upsell` is an offer shown after an order. You can set it as an upsell or as a `Downsell Step`. Pick the product with `Browse Catalog` or enter a `Shopify Variant ID`.
- `Thank-you page` is what a customer sees after ordering. Its buttons show only when you add a link for them.
- `A/B Traffic Splitter` sends visitors to one of two pages and keeps each visitor on the same page. You can lock the winner with `Lock Branch A` or `Lock Branch B`.

To connect steps, drag a line between cards or use the `Connections` section in the step panel. `Add step before` and `Add step after` put a new step on an existing line.

<!-- sources: src/components/navigation/AppSidebar.tsx, src/components/toolbar/CanvasHeader.tsx, src/components/drawers/AdEditor.tsx, src/components/drawers/PageEditor.tsx, src/components/drawers/FormEditor.tsx, src/components/drawers/UpsellEditor.tsx, src/components/drawers/ThankYouEditor.tsx, src/components/drawers/AbSplitEditor.tsx, src/components/drawers/StepConnections.tsx, src/components/preview/LiveFunnelModal.tsx, src/components/drawers/PreFlightAuditDrawer.tsx, src/components/preview/PublishModal.tsx, src/lib/stepKinds.ts -->

## Email Studio

Open `Email Studio` from the sidebar. It has five parts: `Flows`, `Broadcasts`, `Audience`, `Results` and `Settings`. It opens on `Flows`. Back to the canvas with `Back to Canvas`.

Flows are emails that send on their own when something happens. `All flows` lists them in groups: Your flows, Starter flows, Built-in flows and Order emails.
- A starter flow takes every new lead or checkout until you turn it off.
- A built-in flow stays off until you turn it on.
- Order emails are the confirmation, shipping, cancelled and refund emails.
- `New flow` makes a flow of your own. It stays off until you turn it on.
- Choose a flow to open it in the editor, with its first email. `Flow map` shows the steps: Wait, Email, Text and Check.
- A starter email that you have not edited is a draft, and drafts are skipped. Edit it and save to send it.
- Saving an email applies to everyone who gets it from then on, including people already in the flow.

Broadcasts are one email sent once to a list or a segment. `New broadcast` opens the builder. You write the email with blocks, choose who gets it (`Send to`) and who is left out (`Leave out`), and pick `When to send`. A postal address and an unsubscribe link are added when it sends. A send counts only when the email service accepts it.

`Audience` has `People` (your contacts, with tiers such as VIP and At-Risk), Sign-up forms, `Replies` and `Open checkouts`. `Results` shows what was sent, opened and clicked.

`Settings` has `Sending`, `Klaviyo`, `Texts` and `Advanced`.
- `Sending` is where you set the sending domain and the sender. Enter the domain, then `Register Domain Identity`. Add the DNS records it shows at your domain host. `Audit DNS Records` checks any domain you type.
- The sender is set with `From email`, `From name` and `Physical address`. A postal address is needed in the footer of marketing email.
- `Klaviyo` is optional. You paste a private key and Jourvance copies your Klaviyo flows in, turned off.
- `Texts` carries a Soon badge. Text sending is not available yet.
- `Advanced` has `Send due emails now`, which sends what is due at once. The server also checks every minute.

If email sending is not connected on the server, nothing in the flows sends yet, and your changes still save.

<!-- sources: src/lib/emailStudioNav.ts, src/lib/emailFlowsList.ts, src/lib/studioVocabulary.ts, src/components/campaign/HubEmailSuite.tsx, src/components/campaign/EmailFlowsList.tsx, src/components/campaign/BroadcastComposer.tsx, src/components/campaign/SendingSetup.tsx, src/components/campaign/KlaviyoSync.tsx, src/components/campaign/SmsPanel.tsx, EMAIL_STUDIO_PLAN.md -->

## Attribution reports

Open `Attribution` from the sidebar. It ties ad clicks, page views, email sends, email clicks and Shopify orders to the same path, so you can see which channel an order came from.
- Choose the range: `Last 7 Days`, `Last 30 Days` or `All Time`.
- Channel comes from the ad click, the page or the email. A discount code stays on the order.
- The table shows each channel with its leads, orders, attributed revenue and ROAS. A lead journey shows the acquisition view only. A journey that sells also shows the offers and ROI views.
- Recovered revenue counts orders that came back after a checkout was left or an upsell was declined.
- `Export CSV` downloads the report.
- Ad spend is a number you enter on the `Ad Source` step. Jourvance does not read spend from an ad account, so ROAS and cost per visit are blank until you enter it. The toolbar shows `Spend not entered` in that case.
- A figure that could not be loaded is shown as unavailable. It is not shown as zero.
- The leak finder on this screen names the biggest measured drop between steps. It names one only when enough people were counted before it.
- `ROAS Forecaster` is separate. It is a what-if tool for modelling traffic, order value and breakeven before you run ads.

<!-- sources: src/components/analytics/AttributionReports.tsx, src/components/analytics/JourneyLeakFinder.tsx, src/components/drawers/AdEditor.tsx, src/components/drawers/FinancialSimulatorDrawer.tsx, src/components/toolbar/CanvasHeader.tsx -->

## Publish and custom domains

Press `Publish Funnel` in the toolbar to put the landing pages, upsells and thank-you pages of the open journey on the web. A window then lists each live page with its link, and says which revision is live.
- Each step's panel has a `Publish status` section: Published, Unpublished changes, Not published or Live, changes unknown. If you changed a step after it went live, visitors still see the older version until you publish again.
- `Preview changes` saves your work and makes a private preview link that works for one hour. It is available on landing pages and upsells.
- `Take Funnel Offline` in the publish window takes the pages down.
- A published page link can carry UTM tags. The window offers `Open page with test UTMs` to try attribution.

To use your own address, such as offer.yourbrand.com, enter it in the `Custom Brand Subdomain` field on the landing page.
1. At your domain host, add a CNAME record that points to cname.jourvance.com.
2. If the domain is already connected to another store, the window asks for a TXT record to prove you own it. It shows the exact name and value.
3. Select `Check DNS`. It reports whether the record matches and whether the certificate is active.
4. DNS can take time to spread. If the check says it is not ready, try again later.

A custom domain can be used by only one of your journeys at a time. If another journey already has it, take that journey offline or remove the domain from its page, then publish again.

`Export Assets` builds files for hosting a funnel yourself.

<!-- sources: src/components/preview/PublishModal.tsx, src/components/drawers/StepPublishPanel.tsx, src/lib/publishState.ts, src/lib/dnsCheckOutcome.ts, src/components/drawers/PageEditor.tsx, src/components/export/ExportAssetsModal.tsx, server/routes/journeyRoutes.mjs -->

## Shopify connect and sync

Connect a store with `Connect Shopify Store`. It is in the sidebar, and `Manage Shopify Store` replaces it once a store is connected. Each workspace has its own store.
1. In your Shopify admin, open Settings, then Apps and sales channels, then Develop apps.
2. Create an app that can read products, orders and customers and write price rules.
3. Install it and copy the Admin API access token. It starts with shpat_.
4. Paste the store's .myshopify.com domain and the token into Jourvance. Also paste the app's API secret key, which Jourvance uses to check order and checkout webhooks. Without it, those webhooks are refused.
5. Select `Connect Shopify Store`. A token from a different store is refused.
6. Select `Register these webhooks with Shopify` so Shopify sends order and checkout events. Webhooks need a public https address.

After that:
- `Browse Catalog` on a landing page or upsell lists your products. Picking one fills in the variant for 1-click checkout.
- `Shopify Sync` opens the sync window. `Sync Recent Orders` imports orders. Webhook addresses and discount tools are in the same window.
- Orders are tagged in Jourvance with the funnel they came through. The window says the tags stay on the Jourvance order.
- Open checkouts that were not finished show in Email Studio under `Open checkouts`.
- `Send Test Ping` checks that webhooks work. It does not touch real customers.
- A discount code set on a page can be created in Shopify from the page editor.

You can disconnect a store from the connect window. People already imported stay in Jourvance.

<!-- sources: src/components/shopify/ShopifyConnectModal.tsx, src/components/modals/ShopifySyncModal.tsx, src/components/modals/ShopifyProductPickerModal.tsx, src/components/navigation/AppSidebar.tsx, src/components/drawers/PageEditor.tsx -->

## Blueprints and the library

A blueprint is a ready-made journey layout. Open `Blueprints` from the sidebar.
- `Turnkey Library` holds the starter blueprints. `Use Blueprint` loads one onto your canvas, and it replaces the journey you have open. If you have a Shopify catalog loaded, the blueprint links your products. If not, it starts with clean layouts.
- `My Team Blueprints` holds blueprints you saved. They are shared across your workspaces.
- `Save as Blueprint` saves the open journey as a blueprint. You give it a name, a type and notes. After saving you get a share link.
- `Import via Share Code` loads a blueprint someone shared. Paste the code, such as bp_abc123, or the full link.

Your own journeys are listed in `Your journeys`. You can open, rename, duplicate or remove them there. When you are signed in they are saved to your account. When you are signed out, they are kept in this browser only, and the list says so.

<!-- sources: src/components/modals/BlueprintModal.tsx, src/components/modals/SaveBlueprintModal.tsx, src/components/modals/JourneyLibraryDialog.tsx, src/components/toolbar/CanvasHeader.tsx -->

## Draft with AI and the hourly limit

`Draft with AI` writes the copy for a whole journey: an ad, the pages and the emails. Open it from the sidebar. You need to be signed in.
1. Answer `What are you promoting?`. Include price, what is included and who it is for, because the AI uses only what you write.
2. Fill in who it is for, the business type and where the traffic comes from.
3. Optionally turn on `Test two versions of the landing page` or `Add an upsell offer after checkout`.
4. Select `Draft my journey`. It can take up to a minute.
5. Review the draft. Read the assumptions and the claims to check, fix any problems it lists, then tick that you read every page and email.
6. Create it. You can add it as a new journey or replace the one on your canvas. Replacing saves your current journey to your account first when you are signed in.

Nothing is published or sent by a draft. Prices come from your store, so link a product before you publish.

The AI rewrite buttons in the page builder use the same budget. Each draft or rewrite counts toward an hourly limit of 30 per person, unless the server owner set another number. The limit is a rolling hour. When you reach it, the message says how many minutes to wait.

If AI drafting is not set up on the server, the window says so and points you to blueprints. If the AI service does not answer, nothing changes and you can try again.

<!-- sources: src/components/modals/AiJourneyBuilder.tsx, server/routes/aiJourneyRoutes.mjs, server/routes/authWorkspaceRoutes.mjs, src/components/builder/BuilderRewrite.tsx -->

## Billing (Starter and Pro)

Open `Subscription Plan` from the account menu to see the plans.
- `Starter Studio` is free. The card lists 1 active customer journey, the lead funnel blueprint and the node canvas.
- `Growth Pro` costs $49 a month, or $39 a month billed once a year ($468). The card lists unlimited customer journeys, 24/7 automated drips and cart recovery, multi-store Shopify attribution, the AI copywriting assistant and custom domain publishing.
- Choose monthly or annual, enter your email and optionally your store address, then `Continue to checkout`. Payment is taken on the next page, on Stripe's checkout. Jourvance does not see or store your card.
- After a successful payment the account becomes Pro.
- If the subscription is canceled in Stripe, the account returns to Starter.

What the code enforces today: Starter allows two workspaces. Creating a third shows "Upgrade to Pro to connect additional Shopify stores and create more workspaces." Pro has no workspace limit.

The code has no check that stops a Starter account from using the other items on the Pro list, so do not say that Starter is blocked from them. The plan card is the promise. If someone asks where to cancel, say there is no cancel button in the app.

If Stripe is not set up on the server, checkout cannot start and says so.

<!-- sources: src/components/billing/BillingModal.tsx, server/billing.mjs, server/routes/authWorkspaceRoutes.mjs -->

## Account and workspaces

Select `Sign In` to sign in or create a free account. You can `Continue with Google` or use an email and password of at least 6 characters.
- Signed in, your journeys are saved to your account and open on any device.
- Signed out, you can still build. Journeys stay in this browser only, and clearing the browser data would remove them.
- A workspace holds one Shopify store and its journeys' settings. `Create Workspace` adds one, and the workspace selector switches between them. Starter allows two.
- Account settings in the sidebar show who you are signed in as, and have `Subscription Plan` and `Sign Out`.
- The `Launch Playbook` lists milestones to go live: connect a store, pick a blueprint, set the offer, pass the checks and publish.

<!-- sources: src/components/auth/AuthModal.tsx, src/components/navigation/AppSidebar.tsx, src/components/toolbar/WorkspaceSelector.tsx, src/components/modals/LaunchPlaybookModal.tsx, src/components/modals/JourneyLibraryDialog.tsx, server/billing.mjs -->

## What Jourvance does not do

Say these plainly instead of guessing.
- It does not run or buy ads. The ad step is copy and a preview. You place the ad in Meta, Google or TikTok yourself.
- It does not read ad spend from ad accounts. You enter spend by hand.
- The assistant answers questions. It does not edit your journey, send email, publish a page or change a setting for you.
- It does not store card details. Payment happens on Stripe's page.
- It does not take a cut of your sales or charge per lead or per transaction.
- It does not send text messages yet. Texts is marked Soon.
- It does not publish or send anything from an AI draft. You review and create it first.
- It does not guarantee results. ROAS Forecaster numbers are what-ifs from your own inputs.
- It does not cancel a subscription in the app.
- It has no checkout step. Checkout runs through your Shopify store.
- If a number is not in the account data the assistant was given, it should say it does not have it and point to the screen that shows the nearest thing, such as `Attribution`.

<!-- sources: src/components/drawers/AdEditor.tsx, src/components/billing/BillingModal.tsx, src/components/public/HomePage.tsx, src/components/campaign/SmsPanel.tsx, src/components/modals/AiJourneyBuilder.tsx, src/components/drawers/FinancialSimulatorDrawer.tsx, server/billing.mjs -->
