# Design state: Jourvance About page story

Updated 2026-10-08 by Codex.

## Brief

- Problem: the existing About page does not tell the founder's story supplied by the owner.
- Readers: business owners and marketers, including mobile, keyboard, and heading-navigation readers.
- Success: the rendered page identifies Tarren Munoz and his eight years in marketing,
  explains why he built Jourvance, and retains a usable path to Canvas Studio.
- Brief and plan: [About story](docs/designpowers/briefs/2026-10-08-about-story.md).

## Principles and direction

Personal, practical, plain language. Preserve the existing visual style. Ground
biographical facts in the owner's message and describe growth as the product's purpose.
No separate taste calibration; the existing page is the visual reference.

## Decisions log

| Date | Agent | Decision | Reason |
| --- | --- | --- | --- |
| 2026-10-08 | Codex | First-person founder story and named sign-off | The owner asked to tell his own story. |
| 2026-10-08 | Codex | Replace generic claims with practical principles | Keep the whole About page consistent with the story. |
| 2026-10-08 | Codex | Responsive story padding and a level-two CTA heading | Support longer copy and logical heading navigation. |

## Open questions

None required for this authorized edit.

## Artifacts and verification

Implementation: `src/components/public/AboutPage.tsx`. Typecheck and build passed.
The release rerun passed with 2,557 passes and 3 live-server skips after localhost access was
enabled. Chrome verification passed 28 assertions across desktop, phone, and a 200%
reflow model, including the real route and keyboard CTA. Details and limitations:
`JOURVANCE_RUNNING_AUDIT.md`, 2026-10-08 About page commit and push verification.
The owner authorized commit and push; live deployment has not been checked.

## Handoff chain

Codex drafted and browser-verified the page. The independent content-writer agent
reviewed the source against the owner's story and reported no material copy issue;
it did not run browser checks. Its handoff was: "The copy is personal and practical.
No wording changes are needed from this review."

## Design debt

No About-copy blocker found. CSS zoom on the existing app shell overflowed; the
corrected harness models browser-zoom reflow using a narrower CSS viewport. This is
not a whole-site accessibility or product audit; untested areas are named in the audit.

## 2026-10-11: Homepage canvas example

Owner direction: replace the mockup below the hero with an example of the real canvas.
Brief and plan: [Homepage canvas](docs/designpowers/briefs/2026-10-11-home-canvas.md).
Use the actual cards, connections, starter graph, metrics, and semantic zoom in an
isolated read-only React Flow instance. Named step controls and text descriptions
provide keyboard and screen-reader access. Mobile opens on a full-size step.
Existing public founder-copy work is preserved. Verification: typecheck and isolated
build exit 0; final unit suite 2,747 passed and 3 skipped (green, never fault-planted);
168 Chrome assertions passed at 1440, 390, 640 and 320px. Viewed desktop and phone
screenshots. Browser behavior checks caught framing and narrow-width defects before
the fix; removing an edge also made the connection assertion reject the diagram.
No live services, screen-reader speech, full accessibility scanner or deployment check.
Full evidence and omissions are in the running audit's 2026-10-11 section.

Designpowers review handoff: preview_review flagged eager module loading and 320px
clipping; preview_accessibility flagged missing accessible card details. Codex fixed
all three, reran the browser checks, and both reviewers confirmed the source fixes.
No unresolved findings from this scoped review. No commit or push in this pass.

Release follow-up, 2026-10-11: owner requested commit and push. The isolated staged
version passed typecheck/build, 2,747 tests (3 live-server skips), and 168 Chrome
assertions. Earlier founder-copy edits remain outside this commit. Deployment is
not verified. See the running audit's release-verification section for evidence.
