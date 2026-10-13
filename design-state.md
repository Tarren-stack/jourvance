# Design state: Jourvance founder story and public voice

Updated 2026-10-09 by Codex.

## Brief

- Problem: bring the founder perspective already established on About into the public-page copy.
- Readers: business owners and marketers, including mobile, keyboard, and heading-navigation readers.
- Success: a short homepage story links to About, and the shared footer, feature
  introductions, Contact, and blog reflect a practical marketing perspective.
- Current brief and plan: [Public founder voice](docs/designpowers/briefs/2026-10-09-public-founder-voice.md).
- Earlier brief: [About story](docs/designpowers/briefs/2026-10-08-about-story.md).

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
| 2026-10-09 | Owner | Extend the approved founder voice to the public pages | Approved the homepage, footer, Contact, and blog suggestions. |
| 2026-10-09 | Codex | One compact homepage founder section with an About link | Keep the full biography on About and make it discoverable. |
| 2026-10-09 | Codex | Practical feature descriptions and approachable introductions | Carry the perspective through customer tasks without repeating the biography. |
| 2026-10-09 | Codex after content review | Say "I've spent eight years in marketing" | Avoid implying a founding date the owner did not supply. |

## Open questions

None required for this authorized edit.

## Artifacts and verification

Current pass: [Public founder voice brief and plan](docs/designpowers/briefs/2026-10-09-public-founder-voice.md).
HomePage, PublicFooter, ContactPage, and BlogPage copy is updated. Final verification:
typecheck and build exit 0; 2,747 tests passed with 3 live-server skips; 111 Chrome
assertions passed on desktop, phone, and a 200% reflow model. The founder link's
keyboard navigation, focus, target size, and text contrast were checked. Viewed
screenshots of the founder note, Contact, and blog. Full evidence and omissions are
in `JOURVANCE_RUNNING_AUDIT.md`, 2026-10-09 Founder voice across the public pages.
This pass is included in the public-pages commit. Deployment was not checked.
The following results describe the previous About page pass only.

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

2026-10-09: the same content-writer agent reviewed the public-page diff and flagged
the implied founding chronology in the homepage quote. Codex applied the suggested
wording, then built and browser-checked it. The review was source-only.

## Design debt

No About-copy blocker found. CSS zoom on the existing app shell overflowed; the
corrected harness models browser-zoom reflow using a narrower CSS viewport. This is
not a whole-site accessibility or product audit; untested areas are named in the audit.

2026-10-09: no blocker found in the changed public copy or founder link. Existing
article claims and pricing/performance copy remain outside this focused pass. One
empty mobile homepage div appeared in the wide-element diagnostic; no changed text
overflowed. See the audit for the source-based inference about the decorative glow.

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

Follow-up, 2026-10-11: the owner requested fictional data and an upsell/downsell
example. The preview now uses a separate six-step store campaign with a $49 kit,
$24 upsell, $12 downsell, both accept/decline paths, order confirmation, and three
post-purchase emails. The editor's real UpsellNode and ThankYouNode join the existing
shared cards. Demo labels, accessible branch descriptions, and sample figures come
with the isolated example; no live snapshot or connected resource IDs are fabricated.
Typecheck/build passed; unit suite 2,751 passed, 3 live-server skips; 332 Chrome
assertions passed across desktop and mobile widths. A broken downsell handle made
the new branch and arithmetic tests fail, then all 4 new tests passed after restoration
in a temporary copy. Viewed desktop and phone screenshots. Included in the
public-pages commit. Deployment was not checked. Full evidence is in the running audit.
