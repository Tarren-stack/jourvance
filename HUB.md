# Jourvance (Spoke Integration Guide)

Jourvance (`jourvance.com`) is a dedicated visual customer journey builder and conversion pipeline spoke within the Zelus Labs ecosystem.

## App Identity
* **App ID:** `jourvance`
* **Domain:** `jourvance.com`
* **Role:** Universal visual customer journey mapping, lead capture flow builder, and conversion analytics.

## Hub SDK Integration
Jourvance communicates with the Zelus Labs Hub via `hub-sdk.js`:
```javascript
import { createHubClient } from "./hub-sdk.js";
const hub = createHubClient({
  hubUrl: process.env.HUB_URL || "https://zeluslabs.dev",
  appId: "jourvance",
  apiKey: process.env.HUB_API_KEY,
});
```

### Services Used:
1. **Brain (RAG Copy):** `hub.brain.query()` augments ad copy, landing page headlines, and follow-up email letters.
2. **Email Dispatch:** `hub.email.*` manages outbound sequence letters without requiring separate mail server config.
3. **Telemetry & A/B Tracking:** Injected tracker `<script src="https://zeluslabs.dev/tracker.js" data-app="jourvance" async></script>` streams visitor funnel events and drop-off beacons directly to the Hub CRM.
