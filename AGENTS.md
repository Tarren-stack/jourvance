# AGENTS.md: Jourvance agent instructions

**Before starting any task, read and follow the [Truth Protocol](.claude/rules/truth-protocol.md).**
It applies to every agent and subagent, including reviews and status reports.
The `.agent/rules/truth-protocol.md` copy must remain identical.

Read [HUB.md](HUB.md) for the app's hub integration and
[JOURNEY_UI_HANDOFF.md](JOURNEY_UI_HANDOFF.md) for the existing handoff and testing precautions.

## Hub rules this spoke adopts

Jourvance is a spoke of the Local AI App Builder hub, and the hub's house rules apply here. The
ones a session will meet, with where each is enforced:

- **Truth Protocol first.** Every claim carries its evidence; a test precondition is an assert or
  a visible `t.skip(reason)`, never an early return; count what ran; failure leads the report.
  Verification is `npx tsc --noEmit`, `npm test`, then BOOT `node server.mjs`, call the changed
  route, and load the page in a browser. A typecheck proves nothing about wiring.
- **No em dash in generated copy.** Model output is stripped in code at the route boundary
  (`cleanModelStrings` in `server/routes/aiJourneyRoutes.mjs`, used by both `/api/ai/*` routes)
  and the prompt names the rule as a first line of defence. Never rewrite text a merchant typed.
- **Honest degradation.** A missing variable, key or connection answers 400 or 503 naming what to
  set, or falls open to local-only behaviour that says so. Never fake data, never pretend a paid
  call happened. Every JSON answer is `{ success, ...payload, error? }`.
- **The spoke holds no database credential.** Durable data goes through the hub's app store over
  the app's own key (`hub-storage.mjs`); media through the hub.
- **Vendored dists are byte copies.** `hub-sdk.js` and `security-sentinel.js` are copied from the
  hub's `hub-sdk-dist/` and `sentinel-dist/`, never edited here; `sentinel-adoption.test.mjs`
  pins both. Change the hub, then copy.
- **Security Sentinel is mounted after the body parser** with the prose shield
  (`server/sentinel-shield.mjs`) around it, and `trust proxy` is set by address
  (`server/proxy-trust.mjs`, the hub's rule), never by count.
- **No secret falls back to a literal in source.** `secrets-in-source.test.mjs` is the gate.
- **Tenancy and intake rules** follow the hub: a route checks ownership against the resource,
  never against a label in the request; a keyless intake is origin-bound, never key-gated.
- **Document in the same commit.** `JOURVANCE_RUNNING_AUDIT.md` gets a dated section at the top
  for every pass, newest first, with what was run and what was not.
