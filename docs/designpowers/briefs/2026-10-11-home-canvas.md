# Homepage canvas example

The owner asked to replace the homepage mockup with an example of the real canvas.
The existing editor is the visual reference. This scoped request supplies the direction;
no new visual identity or onboarding flow is needed.

Visitors should recognize the product before opening it. Keyboard, mobile, low-vision,
and screen-reader visitors must be able to understand the same four-step journey.

Use the starter lead-capture graph and the editor's actual React Flow cards, connection
renderer, metric builder, and semantic zoom. Keep sample content and unavailable
measurements honest. An isolated, read-only diagram cannot change the active journey.
Provide named step controls and a text explanation outside the diagram. Show the full
map on wide screens and a full-size step on phones. Avoid automatic motion.

Alternatives considered: a screenshot would drift as the editor changes; embedding the
whole editor would bring editing and storage behavior into a marketing preview.

## Implementation and verification plan

- Replace only the existing mockup with a preview component. Preserve prior homepage edits.
- Reuse actual canvas components and a copy of the existing starter graph.
- Add keyboard-accessible step navigation, overview, responsive framing, and a studio CTA.
- Verify typecheck, unit suite, isolated real-server homepage, and Chrome desktop/mobile
  interactions, read-only behavior, storage preservation, and reduced motion.
- Review against this brief and record evidence and limitations in the running audit.

No production integration calls, deployment, new dependency, or changes to saved journeys.

## Completion and critique

The requested replacement is implemented locally. The independent design critic and
accessibility reviewer raised eager loading, 320px clipping, and missing text equivalents.
All were fixed and source-reviewed again. Main-agent verification passed 168 Chrome
assertions, typecheck/build, and 2,747 unit tests with 3 live-server skips. Detailed
evidence, earlier failures, and untested conditions are in the running audit.
No deployment or production-service verification is claimed.
