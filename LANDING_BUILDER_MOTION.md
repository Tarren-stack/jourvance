# Landing page builder: motion

Owner ask (2026-10-08): "subtle animations" in the page builder, on the published page and in the
editor. Nothing is built for it yet. This file is the spec two parallel builders work from (Part P,
the page; Part E, the editor) and the acceptance list the main session checks before it commits.

Read with: `LANDING_BUILDER_PLAN.md` (decisions, waves), `LANDING_BUILDER_DESIGN.md` (the model and
the renderer contract), `.claude/rules/truth-protocol.md` (binding on every claim in a hand-back).

Surveyed for this spec, at commit c69860a, by reading the files (no code was run to write it):
`src/lib/pageBuilder/model.mjs` (DEFAULT_THEME, `checkTheme`, SECTION_PROPS, SECTION_DEFAULTS,
`createNode`), `render.mjs` (`rootRule`, `staticRules`, `buildCss`, `renderSection`, `render`),
`server/routes/publicBuilderScript.mjs` (`builderFrameScript`, the countdown tick),
`server/routes/publicRoutes.mjs` (where the builder page is assembled, lines 1326 to 1390),
`src/components/builder/BuilderCanvas.tsx`, `BuilderOutline.tsx`, `BuilderShell.tsx`,
`BuilderThemePanel.tsx`, `BuilderInspector.tsx`, `builderState.ts`, `src/index.css`, and, for
reference only, Aura's `src/lib/siteBlocks/render.ts` (`motionCss`, `MOTION_SCRIPT`) and the hub's
portable `LandingBuilder.css`.

## 0. Rules this spec keeps

1. **Motion is off unless the merchant turns it on.** A document with no `theme.motion`, or with
   `theme.motion: "none"`, renders the exact bytes `render()` writes today, for every device
   context. Every existing golden (render, theme, legacy snapshot, serve) passes without an edit.
2. **Nothing is ever hidden by CSS alone.** A section is hidden before its reveal only when the
   frame script has run and has said so (the class `jvb-motion-on` on `#jvb-root`). No script, an
   old browser, a print, a script error before that line, the editor canvas: every section is
   visible.
3. **The visitor's device wins.** Every motion rule sits inside a
   `prefers-reduced-motion: no-preference` media query, and the frame script checks the same query
   before it hides anything. A visitor who asks for less motion gets none, on every level. Since
   fix round 3 this holds for the frame's own motion too (section 3); the one rule set that cannot
   move, the cookie banner's, is switched off in the complement of that query.
4. **Only opacity and transform move** (both run on the compositor), plus the link underline offset,
   which is a few pixels on hover. No layout property is ever animated on the published page.
5. **Nothing loops.** Every animation runs once per trigger. The countdown does not animate at all
   (see section 3), so nothing on the page is "moving content that lasts more than five seconds"
   (WCAG 2.2.2).
6. **The first section never moves.** It is what the visitor sees first; motion there only delays
   the headline.
7. **The editor never hides content.** The canvas draws the published markup and CSS but never runs
   the frame script, so `jvb-motion-on` is never set there except for the length of a "Preview
   motion" run.
8. No new dependency. No em dash or spaced en dash anywhere, in code, copy or this file.

## 1. The page setting: `theme.motion`

A new optional theme key, `motion`, one of `none`, `subtle`, `cinematic`. Absent reads as `none`.
It is NOT added to `DEFAULT_THEME` (existing tests clone `DEFAULT_THEME` into their golden
documents, and `createEmptyPage` and `migrateLegacyPage` copy it; leaving it out keeps every
created and converted document byte for byte as today).

| Level | Reveal duration `--jvb-motion-duration` | Interaction duration `--jvb-motion-fast` | Reveal distance `--jvb-motion-distance` | Button lift `--jvb-motion-lift` | Easing `--jvb-motion-ease` |
|---|---|---|---|---|---|
| `none` (or absent) | no rule written | no rule written | no rule written | no rule written | no rule written |
| `subtle` | `240ms` | `180ms` | `10px` | `-1px` | `cubic-bezier(.2,0,0,1)` (ease-out) |
| `cinematic` | `560ms` | `220ms` | `24px` | `-2px` | `cubic-bezier(.16,1,.3,1)` (a longer ease-out tail) |

Why these numbers:

- `subtle` sits inside the asked range (180 to 260 ms, 8 to 12 px). 240 ms is long enough to read as
  a reveal rather than a flicker and short enough that a fast scroller never waits for text.
- `cinematic` sits inside 420 to 600 ms and 20 to 28 px. 560 ms with the long-tail curve reads as
  deliberate without passing the 600 ms point where a reveal starts to feel like loading.
- Interaction motion stays fast at both levels on purpose: a hover or a press that takes half a
  second feels broken, whatever the page's mood. `cinematic` only lifts the button one pixel more.
- Aura's reference (`motionCss`) uses 12 px at 340 ms and 26 px at 620 ms with plain `ease-out` and
  scroll-driven animations. Jourvance uses one mechanism (IntersectionObserver), plays each reveal
  once rather than scrubbing it with the scroll, and keeps cinematic under 600 ms.

The numbers live in ONE place, a new frozen export in `model.mjs`:

```js
export const THEME_MOTION_LEVELS = Object.freeze(['none', 'subtle', 'cinematic']);
export const MOTION_PRESETS = deepFreeze({
  subtle:    { durationMs: 240, fastMs: 180, distancePx: 10, liftPx: -1, ease: 'cubic-bezier(.2,0,0,1)' },
  cinematic: { durationMs: 560, fastMs: 220, distancePx: 24, liftPx: -2, ease: 'cubic-bezier(.16,1,.3,1)' }
});
```

The renderer and the theme panel's hint text both read `MOTION_PRESETS`; neither writes a number
of its own.

Validation (`checkTheme`): `motion` joins the `known` list; a value that is not one of
`THEME_MOTION_LEVELS` is refused at path `theme.motion` with the message
`"<value>" is not one of none, subtle, cinematic` (the same `quote(v) is not one of ...` shape the
`buttonShadow` check uses).

## 2. Section entrance reveal

### What the visitor sees

When page motion is `subtle` or `cinematic`, every section after the first fades in and rises
`--jvb-motion-distance` as it scrolls into view, once. It does not hide again when scrolled back
up, and it does not play again.

- A section already on screen when the page loads (above the fold, or above the restored scroll
  position) is shown at once with no animation.
- A page opened on a `#fragment`, or a click on an in-page link (`href="#offer"`): the target's
  section, and every section that will be on screen or above it once the browser has scrolled, are
  shown at once with no animation BEFORE the browser measures the jump, so the jump lands on the
  untransformed box and nothing plays on arrival (fix round 1: the jump landed `distance` px low
  and the target played its reveal as the first thing the visitor saw).
- A section that takes keyboard focus before it has been revealed (Tab into a button inside it) is
  shown at once with no transition (one already running is ended), so focus never lands on
  something invisible or fading.
- At the bottom of the page every section still hidden is revealed. A section shorter than the
  observer's bottom margin (10% of the viewport), last on the page, could otherwise never
  intersect and stayed at opacity 0 (fix round 1).
- While sections are held hidden the root clips its vertical overflow (`frameCss`, the one frame
  rule that reaches `#jvb-root`, under `screen` and no-preference and keyed on `jvb-motion-on`),
  so a hidden section's `translateY` never lengthens the page and the page does not shrink under a
  visitor at the bottom when the last section reveals (fix round 1). A browser without
  `overflow: clip` (Safari before 16) still has that shrink. Once nothing is hidden and the last
  reveal has had its time (the level's `--jvb-motion-duration`, read off the root, plus 120ms; a
  second when it cannot be read) the script takes `jvb-motion-on` off, so the clip does not stay on
  for the page's whole life and cut a section's shadow, a negative margin or a focus ring at the
  root's edge (fix round 2).
- An inner section (a section inside a column) never gets a reveal of its own: it moves with the
  section around it. Inside the first section it would have moved the top of the page, and inside
  any other it travelled twice (fix round 1). The inspector shows no Entrance animation for it.
- With JavaScript off, in print, under reduced motion, or in a browser without IntersectionObserver
  or `matchMedia`: every section is visible and nothing moves.

### The per-section override

A new optional section prop, `reveal`, one of `inherit`, `none`, `fade`, `rise`. Absent reads as
`inherit`. It is added to `SECTION_PROPS` (so `checkProps` validates it: a bad value is refused at
`sections[i].props.reveal`) and NOT to `SECTION_DEFAULTS` (so `createNode('section')` keeps its
exact shape).

| `theme.motion` | `reveal` | What the section gets |
|---|---|---|
| absent or `none` | anything | nothing (the setting is kept for later, never rendered) |
| `subtle` or `cinematic` | absent or `inherit` | `data-jvb-reveal="rise"` (fade and rise) |
| `subtle` or `cinematic` | `rise` | `data-jvb-reveal="rise"` |
| `subtle` or `cinematic` | `fade` | `data-jvb-reveal="fade"` (opacity only, no movement) |
| `subtle` or `cinematic` | `none` | nothing |
| any | any, on `sections[0]` | nothing, ever |
| any | any, on an inner section | nothing, ever |

The editor shows it in the section's **Advanced** tab (section 4).

## 3. Interaction motion on the published page

All CSS. All inside `@media (prefers-reduced-motion: no-preference)`. All written only when
`theme.motion` is `subtle` or `cinematic`.

| Element | Rest | Trigger | Motion |
|---|---|---|---|
| `.jvb-btn` (every button and checkout button) | unchanged | hover, only on a device with a real pointer (`@media (hover: hover)`), not disabled | `translateY(var(--jvb-motion-lift))` over `--jvb-motion-fast` |
| `.jvb-btn` | unchanged | press (`:active`, not disabled) | `scale(.98)` in `80ms`, then back over `--jvb-motion-fast` |
| Links in text and embeds (`.jvb-text a`, `.jvb-embed a`) | underline offset `.15em` | hover (real pointer) or `:focus-visible` | underline offset grows to `.3em` over `--jvb-motion-fast` |
| Order bump tick (`.jvb-bump-cb`) | unchanged | becomes checked | one `jvb-tick` pop: `scale(.8)` to `1.12` to `1`, over `--jvb-motion-fast` |
| Countdown clock (`.jvb-countdown-clock`) | unchanged | never | does not animate |

The countdown does not animate. An earlier pass dipped the clock's opacity (`.35` to `1`) each time
the minutes changed, through a `data-jvb-tick` flip in the frame script and two `jvb-digit`
keyframes. It was removed after review: it was the one repeating motion on the page, it had no end
and no control beyond the visitor's OS reduced-motion setting, and it told the visitor nothing the
clock's own text did not. The tick function is as it was before the motion work.

Left as today: the stock pulse dot, FAQ open and close, focus rings, the review photo viewer, and
the frame (lead modal, exit drawer, sticky bar, lightbox, consent) apart from one thing.

The one thing (fix round 3): the frame's own motion plays only for a visitor on a screen with no
reduced-motion preference, whatever `theme.motion` says. A reviewer measured the exit drawer still
sliding (translateY to 0 over about 380ms) and its backdrop fading under
`prefers-reduced-motion: reduce`, while the Motion hint promised those visitors no motion. The
drawer's slide (`transform 0.38s cubic-bezier(0.16, 1, 0.3, 1)`), the backdrop's fade
(`opacity 0.3s ease`) and the lead modal spinner's turn (`jvf-spin 0.8s linear infinite`) moved, with
the same values, out of the drawer's style attributes and the spinner rule into one
`@media screen and (prefers-reduced-motion: no-preference)` block in `frameCss`. The cookie banner's
CSS is written by `withTracking`, which legacy pages share and the legacy snapshot pins byte for byte,
so it stays where it is; `frameCss` turns every banner transition and the accept button's hover lift
off in `@media not screen and (prefers-reduced-motion: no-preference)`, the exact complement of that
query. `page-builder-motion-reduced.test.mjs` pins the CSS, the frame markup and a served page;
`scripts/builder-serve-browser-check.mjs` drives it in Chrome with a no-preference control.

## 4. Editor motion

Every editor motion is off when the OS asks for reduced motion (the existing app-wide
`@media (prefers-reduced-motion: reduce)` block in `src/index.css` already stops every light-DOM
transition and animation) and when the new builder preference **Reduce motion in the editor** is
on. JavaScript-driven motion (the outline FLIP, the flash, the preview) checks the same boolean
and does nothing at all, rather than relying on CSS to cancel it.

### The preference

- A checkbox, **Reduce motion in the editor**, at the end of the Global styles panel
  (`BuilderThemePanel`) under its own small heading **Editor**, with the hint "Only this browser,
  only the editor. The published page follows each visitor's own device setting."
- Stored per viewer in `localStorage` under `jv_builder_reduce_motion` (`"1"` on, absent or `"0"`
  off), every read and write in try/catch; a throwing storage reads as off and the editor still
  works. It is a per-viewer convenience, never part of the document, never saved to the hub.
- `BuilderShell` computes `reduceMotion = osReduce || preference` (the OS query watched with a
  `change` listener) and sets `data-reduce-motion=""` on the builder `<dialog>` when true.
- `src/index.css` adds, after the builder section, a rule that makes the preference behave like the
  OS switch inside the builder:
  `.jv-builder[data-reduce-motion] *, .jv-builder[data-reduce-motion] *::before, .jv-builder[data-reduce-motion] *::after { animation: none !important; transition: none !important; }`
- That rule cannot cross the canvas's shadow boundary, so the drawn page's own transitions (its
  buttons kept their 0.18s transition with the preference on) still played there. Since fix round 3
  the canvas host (`data-jvb-canvas-host`) carries `data-jvbe-motion-off` whenever `reduceMotion` is
  true, and `writeShadow` writes `CANVAS_MOTION_OFF_CSS` last into the shadow root, after the editor
  CSS and the page's CSS: `:host([data-jvbe-motion-off]) #jvb-root`, everything in it and their
  `::before` and `::after` get `animation:none!important;transition:none!important`. It is editor
  CSS; the published page never carries it.

### The motions

| What | Where | How | Duration and curve |
|---|---|---|---|
| Selection outline and its toolbar appear | `BuilderCanvas` | class `jv-motion-appear` (keyframes `jvbe-appear`) on both elements, each keyed by `selectedId` so a new selection replays it and a re-measure does not; `left`/`top` never transition (the marks must track a scroll or a resize with no lag). The keyed toolbar is a new element after Duplicate, Paste, Delete and Cut, so its ref carries keyboard focus to the same button of the new one (`motion.ts` `toolbarFocusMemo` and `toolbarFocusTarget`, fix round 2) | `120ms ease-out`, opacity 0 to 1 |
| Drop zones appear when a drag starts | `BuilderCanvas` `ZoneView` | class `jv-motion-appear` on the zone | `120ms ease-out` |
| Drop zone expands under the pointer | `ZoneView` inner bar and box | class `jv-motion-zone`: `transition: height, width, background-color, border-color, box-shadow` | `150ms ease-out`. Sizes stay as today (a 4px line that becomes 6px under the pointer, a dashed box that tints), so the drop-zone tests and the drag steps are unchanged |
| A dropped, pasted or duplicated block flashes once | `builderState.ts` + `BuilderCanvas` | the reducer sets `flash: { id, seq }` (section 5); the canvas draws one overlay `div[data-jvbe-flash]` over that node's box, `aria-hidden`, `pointer-events: none`, class `jv-motion-flash` (keyframes `jvbe-flash`), removed on `animationend` and in any case after 900 ms | `600ms ease-out`, once: a 2px `#F472B6` outline and `rgba(244, 114, 182, .28)` fill fading to transparent. One flash only (WCAG 2.3.1 is three) |
| Outline rows slide on reorder | `BuilderOutline` | FLIP: before the commit read each row's top by `data-node-id`, after it read again; for each row present both times with a change of 1px or more, set `transform: translateY(<old - new>px)` with no transition, then on the next frame `transition: transform 180ms cubic-bezier(.2,0,0,1)` and `transform: none`, clearing both inline values on `transitionend`. Runs only when the document changed and no drag is in progress (`dragging` false). Not on expand, collapse or selection | `180ms cubic-bezier(.2,0,0,1)` |
| Device switch | `BuilderCanvas` layer (`data-canvas-layer`) | class `jv-motion-device-in` (keyframes `jvbe-device-in`) restarted on the layer by an effect on `[device]` (taken off, one style read, put back), so the animation replays on a switch. The layer is NOT keyed: it holds the shadow root, the observers and the listeners. The class is taken off once it has played (`motion.ts` `removeClassWhenPlayed`, fix round 2), or unticking the editor preference replayed it with no switch | `180ms ease-out`, opacity `.35` to `1` (a fade-through: the new drawing fades up; the old one is not kept, so no double image and no extra render) |
| Preview motion | `BuilderThemePanel` button **Preview motion**, run by `BuilderCanvas` | on the shadow `#jvb-root`: remove `jvb-in` from every `[data-jvb-reveal]`, add `jvb-motion-on`, force one style read, then add `jvb-in` to each, so every non-first section plays its reveal together; after `durationMs + 100` remove `jvb-motion-on`. The canvas is never left with anything hidden. The run is also said (fix round 3): the canvas reports its start and its end through `onMotionPreview`, and the shell speaks "Previewing subtle motion" (or "cinematic") and then "Preview finished" in its one polite live region | the page's own level |

Preview motion is `aria-disabled` with the reason in its hint when page motion is none ("Page
motion is off."), when the OS asks for reduced motion ("Your device asks for reduced motion, so the
preview is off. Visitors who ask for it see no motion either."), or when the editor preference is
on ("Reduce motion in the editor is on.").

The CSS for the editor classes (`jv-motion-appear`, `jv-motion-zone`, `jv-motion-flash`,
`jv-motion-device-in`) goes in `src/index.css` after the builder section, inside one
`@media (prefers-reduced-motion: no-preference)` block, each selector under
`.jv-builder:not([data-reduce-motion])`, with keyframes `jvbe-appear`, `jvbe-flash` and
`jvbe-device-in`. The class names are `jv-motion-*`; only the keyframe names and two canvas
attributes (`data-jvbe-flash`, `data-jvbe-motion-off`) are `jvbe-*`. Do NOT add a new
`@media (prefers-reduced-motion: reduce)` block before the existing first one (line 486 today):
`a11y-canvas.test.mjs` and `a11y.test.mjs` read the FIRST such block.

### The controls

- **Global styles** (`BuilderThemePanel`), a new group **Motion** before the Editor group:
  - A select labelled **Motion** with options **None**, **Subtle**, **Cinematic**; absent reads as
    None. It dispatches `setTheme({ motion })`, which runs the model's check like every theme key.
  - Hint per value, numbers read from `MOTION_PRESETS`:
    - None: "Nothing on the page moves."
    - Subtle: "Sections fade in and rise 10px as they scroll into view, in a quarter of a second. Buttons lift slightly on hover."
    - Cinematic: "Sections fade in and rise 24px in about half a second. Best for a launch page; on a long sales page it can feel slow."
    - Always, after it: "The first section never moves, and visitors whose device asks for less motion see none."
  - The **Preview motion** button.
- **Section, Advanced tab** (`BuilderInspector` `AdvancedTab`), for a top level section only (an
  inner section shows "An inner section moves with the section around it, so it has no entrance
  animation of its own." instead), after the anchor
  field: a select **Entrance animation** with options **Same as the page** (`inherit`), **None**,
  **Fade in** (`fade`), **Fade and rise** (`rise`), dispatching `setProps({ reveal })`. Hints:
  - When page motion is none: "Page motion is off in Global styles, so this section does not move."
  - When the section is the first on the page: "The first section never moves, so the top of the page shows at once."
- The Content tab already lists every `SECTION_PROPS` key except `anchor` (`BuilderInspector.tsx`
  line 359). Its filter must also leave out `reveal`, or the raw enum shows up there.

## 5. How the renderer and the frame express it

### Types (`src/types/pageBuilder.ts`)

```ts
export type ThemeMotion = 'none' | 'subtle' | 'cinematic';
export type SectionReveal = 'inherit' | 'none' | 'fade' | 'rise';
// BuilderTheme gains:  motion?: ThemeMotion;
// SectionProps gains:  reveal?: SectionReveal;
```

`model.d.mts` declares `THEME_MOTION_LEVELS: ReadonlyArray<ThemeMotion>`,
`SECTION_REVEALS: ReadonlyArray<SectionReveal>` and `MOTION_PRESETS` with its exact shape.
`builderState.ts` gains `flash: { id: string; seq: number } | null` on `BuilderState` (Part E).

### HTML

- When the level is `subtle` or `cinematic`, the root becomes
  `<div id="jvb-root" class="jvb" data-jvb-motion="subtle">` (or `"cinematic"`). Otherwise it is
  exactly `<div id="jvb-root" class="jvb">` as today.
- A section that gets a reveal (table in section 2) carries `data-jvb-reveal="rise"` or
  `"fade"` as the LAST attribute of its `<section>` tag, after `id` when an anchor is written:
  `<section class="jvb-sec jvb-n-sec2" id="offer" data-jvb-reveal="rise">`.
- The canvas render (`context.device`) writes the same attributes, so the existing rule "the canvas
  html is byte for byte the published html" still holds.

### CSS

Root custom properties: when the level is on, the root rule (line 1 of the CSS, `#jvb-root{...}`)
gains five custom properties appended after the last custom property it writes today and before
its first plain declaration (`display:flex`):

```
--jvb-motion-duration:240ms;--jvb-motion-fast:180ms;--jvb-motion-distance:10px;--jvb-motion-lift:-1px;--jvb-motion-ease:cubic-bezier(.2,0,0,1)
```

(cinematic: `560ms`, `220ms`, `24px`, `-2px`, `cubic-bezier(.16,1,.3,1)`).

The motion block is appended as the LAST part of the CSS (after the 640px block in the published
CSS, after the per-node rules in device mode), so no existing line moves. It is exactly these
lines, one rule per line, the same for both levels (only the custom property values differ):

```
@media (hover: hover) and (prefers-reduced-motion: no-preference){
#jvb-root .jvb-btn:hover:not(:disabled){transform:translateY(var(--jvb-motion-lift))}
#jvb-root .jvb-text a:hover,#jvb-root .jvb-embed a:hover{text-underline-offset:.3em}
}
@media (prefers-reduced-motion: no-preference){
#jvb-root .jvb-btn{transition:transform var(--jvb-motion-fast) var(--jvb-motion-ease)}
#jvb-root .jvb-btn:active:not(:disabled){transform:scale(.98);transition-duration:80ms}
#jvb-root .jvb-text a,#jvb-root .jvb-embed a{text-underline-offset:.15em;transition:text-underline-offset var(--jvb-motion-fast) var(--jvb-motion-ease)}
#jvb-root .jvb-text a:focus-visible,#jvb-root .jvb-embed a:focus-visible{text-underline-offset:.3em}
#jvb-root .jvb-bump-cb:checked{animation:jvb-tick var(--jvb-motion-fast) var(--jvb-motion-ease)}
@keyframes jvb-tick{0%{transform:scale(.8)}60%{transform:scale(1.12)}100%{transform:scale(1)}}
}
@media screen and (prefers-reduced-motion: no-preference){
#jvb-root.jvb-motion-on [data-jvb-reveal]:not(.jvb-in){opacity:0}
#jvb-root.jvb-motion-on [data-jvb-reveal="rise"]:not(.jvb-in){transform:translateY(var(--jvb-motion-distance))}
#jvb-root.jvb-motion-on [data-jvb-reveal].jvb-in{transition:opacity var(--jvb-motion-duration) var(--jvb-motion-ease),transform var(--jvb-motion-duration) var(--jvb-motion-ease)}
}
```

Notes on that block:

- The hover block comes first so the press rule, later and of equal specificity, wins while a
  button is held.
- These lines are literal strings in `render.mjs`, not built with `rule()`: `rule()` puts a space
  after `#jvb-root`, and `#jvb-root.jvb-motion-on` needs none. Every selector still starts with
  `#jvb-root`, so the serve test's "every rule is scoped to the root" reading holds.
- The hidden state needs BOTH `jvb-motion-on` (set only by the frame script) and `screen`, so a
  page without script, and a printed page, show every section.
- The reveal transition is attached to the `.jvb-in` state only: hiding a below-the-fold section
  when the script adds `jvb-motion-on` is instant (nothing animates out of sight, and
  `document.getAnimations()` is empty right after load), while revealing it animates.
- A revealed section's transform is `none`, not `translateY(0)`, so no containing block is left
  behind for anything positioned inside it.
- No `!important`, no `@import`, no `url(`, and every keyframe name starts with `jvb-`.
- The device CSS (canvas) now holds media queries when motion is on, but never a width query; the
  design doc's sentence "with `context.device` the CSS holds no media query" becomes "holds no
  width media query" (main session, section 6).

### The frame script (`server/routes/publicBuilderScript.mjs`)

`builderFrameScript` gains a motion block placed right after the `const` declarations at the top of
the IIFE, before the countdowns, in its own `try { ... } catch (e) {}`, so a failure anywhere else
in the frame cannot leave sections hidden and a failure here cannot stop the frame:

```js
var jvbRoot = document.getElementById('jvb-root');
var jvbMotion = jvbRoot ? (jvbRoot.getAttribute('data-jvb-motion') || '') : '';
try {
  if (jvbMotion && window.matchMedia && window.matchMedia('(prefers-reduced-motion: no-preference)').matches && 'IntersectionObserver' in window) {
    var fold = window.innerHeight || document.documentElement.clientHeight || 0;
    var revealIo = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) { if (e.isIntersecting) { e.target.classList.add('jvb-in'); revealIo.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px' });
    Array.prototype.forEach.call(jvbRoot.querySelectorAll('[data-jvb-reveal]'), function(el) {
      if (el.getBoundingClientRect().top < fold) el.classList.add('jvb-in');
      else revealIo.observe(el);
    });
    jvbRoot.addEventListener('focusin', function(e) {
      var s = e.target && e.target.closest ? e.target.closest('[data-jvb-reveal]') : null;
      if (s) s.classList.add('jvb-in');
    });
    jvbRoot.classList.add('jvb-motion-on');
  }
} catch (e) {}
```

Fix round 1 grew this block, and `server/routes/publicBuilderScript.mjs` is now the reference for
it: the load check uses the `#fragment` target's top plus the fold as its limit when the page is
opened on one; a `click` listener on `document` settles an in-page jump before it happens; the
`focusin` handler shows the section with its transition off; and `scroll` and `resize` listeners
reveal whatever is still hidden once the page is at its bottom. The observer's bottom margin is
unchanged. `page-builder-motion-fixes.test.mjs` pins each of these over a stub DOM, and the
`fix-*` steps of `scripts/builder-motion-page-check.mjs` pin them in Chrome.

The `jvb-motion-on` line is the LAST statement in the `if`: nothing is hidden until the observer is
watching every hidden section. The countdown's `tick` is unchanged (section 3).

`publicRoutes.mjs` is NOT changed: the script finds the level on the root itself. Consequence, said
plainly: a builder page with no motion is served with a frame script that is longer than today's
(the block is present and does nothing because the root has no `data-jvb-motion`). The `render()`
output, which is what every golden pins, is byte-identical; legacy pages do not use this script at
all and are untouched.

### The byte-identity rule, and how it is proved

Before Part P changes any file, it captures a baseline on the clean tree (c69860a) with a throwaway
script in its scratchpad, and commits only its output, `test-fixtures/page-builder-motion-before.json`:
for each document in the corpus and each context (`{}`, `{device:'desktop'}`, `{device:'tablet'}`,
`{device:'mobile'}`), the sha256 hex and the length of `html` and of `css`, and the `fonts` array.

The corpus: each of the eight templates in `templates.mjs` (`TEMPLATES[i].build()`, then every node
id replaced in `walk` order by `m0`, `m1`, ... so the ids are deterministic); one document holding
one widget of every `WIDGET_REGISTRY` type, ids `w-<type>`, with a stub context that makes the
commerce widgets draw (a `realVariantId` that answers its input, a `formatPrice` that answers
`$<input>`, two reviews); and the three theme cases of `page-builder-theme.test.mjs`
(default, outline, pill).

## 6. File ownership for the two builders

Parallel agents never touch the same file. Neither commits. The main session integrates, runs the
whole loop, updates the docs, and commits.

### PART P (page)

- `src/lib/pageBuilder/model.mjs`, `model.d.mts`: `THEME_MOTION_LEVELS`, `SECTION_REVEALS`,
  `MOTION_PRESETS`, the `motion` theme check, `reveal` in `SECTION_PROPS` (not in
  `SECTION_DEFAULTS`).
- `src/types/pageBuilder.ts`: `ThemeMotion`, `SectionReveal`, `BuilderTheme.motion?`,
  `SectionProps.reveal?`.
- `src/lib/pageBuilder/render.mjs`, `render.d.mts`: root attribute, section attribute, root custom
  properties, the motion block.
- `server/routes/publicBuilderScript.mjs`: the motion block.
- New: `page-builder-motion-render.test.mjs`, `test-fixtures/page-builder-motion-before.json`,
  `scripts/builder-motion-page-check.mjs` (the published-page browser check; a new file no one else
  touches, added to P's list because the reveal can only be proved in a browser).
- Order inside P: model, model.d.mts and the types FIRST (step P1), because Part E's typecheck reads
  them. P1 is small; P reports when it is in.

### PART E (editor)

- `src/components/builder/*`: `BuilderShell.tsx` (reduce-motion boolean, `data-reduce-motion`),
  `BuilderCanvas.tsx` (appear, zones, flash overlay, device fade, preview runner),
  `BuilderOutline.tsx` (FLIP), `BuilderThemePanel.tsx` (Motion group, Preview motion, Editor
  group), `BuilderInspector.tsx` (Entrance animation in Advanced; `reveal` left out of Content),
  `builderState.ts` (`flash`), and a new pure module `src/components/builder/motion.ts`
  (`flipOffsets`, `editorMotionOff`, `readReduceMotionPref`, `writeReduceMotionPref`; value imports
  only with a `.ts` or `.mjs` extension or none, so a node test can import it).
- `src/index.css`: the editor motion rules and the preference rule, appended after the builder
  section.
- `scripts/builder-browser-check.mjs`: the new steps in section 7, appended after `ai-rewrite-off`
  and before `runtime`, plus their lines in the header comment.
- New: `page-builder-motion-editor.test.mjs`.

### The main session

- Integration: until P1 lands, the `reveal` prop does not exist; once it does and before E's
  Inspector change, the Content tab would show it. Integrate both before any check is reported.
- Docs, in the same commit: `LANDING_BUILDER_DESIGN.md` section 2 "Theme" (the `motion` key) and
  section 3 (the attributes, the motion block, "no width media query" in device mode), a row in
  `LANDING_BUILDER_PLAN.md` "Status", a "Motion" paragraph in `JOURNEY_UI_HANDOFF.md` "Page
  builder", and a dated section at the top of `JOURVANCE_RUNNING_AUDIT.md`.

## 7. Acceptance

Done means every line below was run by the agent that claims it, after its last change, with the
exit code read (never through `| tail`) and counts reported, and the main session re-ran the
headline ones. Every new test file and both browser scripts are SEEN RED once: plant a fault, run,
see the named assertion fail, restore by inverting the exact change, `cmp` against a copy taken
before the plant, run green. Existing tests are never edited.

### Whole loop

- A1. `npx tsc --noEmit` exits 0.
- A2. `npm test` exits 0; failed 0; the total only grows from the count measured on c69860a before
  the work starts (each part measures it, the main session re-measures it); skips reported as skips.
- A3. `npx vite build` exits 0.
- A4. These existing suites pass unedited: `page-builder-render`, `page-builder-theme`,
  `page-builder-legacy-snapshot`, `page-builder-serve`, `page-builder-publish`, `page-builder-model`,
  `page-builder-state`, `page-builder-dropzones`, `page-builder-editor-a11y`, `a11y-canvas`, `a11y`.
- A5. `grep` finds no em dash (U+2014) and no spaced en dash in any changed or new file.
- A6. `node scripts/builder-browser-check.mjs` passes every step (28 existing plus the new ones).
- A7. `node scripts/builder-motion-page-check.mjs` passes every step (the spec's thirteen plus the
  six `fix-*` steps fix round 1 added).

### `page-builder-motion-render.test.mjs` (Part P)

- R1. Byte identity: for every corpus document and context in
  `test-fixtures/page-builder-motion-before.json`, today's `render()` gives the same sha256 and
  length for `html` and `css` and the same `fonts`. The same holds with `theme.motion: 'none'`
  added, and with `reveal: 'rise'` set on every section of a page whose motion is absent.
- R2. `validateBuilderDoc` accepts `theme.motion` `none`, `subtle`, `cinematic`; refuses `'fast'`,
  `1`, `null`, `''` and `'Subtle'` each with exactly one problem at path `theme.motion` whose
  message contains `none, subtle, cinematic`. A key that is not a theme setting is still refused.
- R3. `validateBuilderDoc` accepts `props.reveal` `inherit`, `none`, `fade`, `rise` on a section;
  refuses `'slide'` at `sections[1].props.reveal`; `createNode('section').props` has no `reveal`
  key; `DEFAULT_THEME` has no `motion` key.
- R4. `MOTION_PRESETS.subtle`: `durationMs` in 180 to 260, `distancePx` in 8 to 12;
  `MOTION_PRESETS.cinematic`: `durationMs` in 420 to 600, `distancePx` in 20 to 28; each `fastMs`
  below its `durationMs`; both frozen.
- R5. HTML, a four-section subtle page (`sections[0]` with `reveal: 'fade'`, `sections[1]` absent,
  `sections[2]` `'fade'` with anchor `offer`, `sections[3]` `'none'`): the root opens exactly
  `<div id="jvb-root" class="jvb" data-jvb-motion="subtle">`; `sections[0]` has no
  `data-jvb-reveal`; `sections[1]` has `data-jvb-reveal="rise"`; `sections[2]`'s tag ends
  `id="offer" data-jvb-reveal="fade">`; `sections[3]` has none; the count of `data-jvb-reveal` in
  the html is 2. For each device, the canvas html equals the published html.
- R6. CSS, subtle: line 1 contains, in order and contiguous,
  `--jvb-motion-duration:240ms;--jvb-motion-fast:180ms;--jvb-motion-distance:10px;--jvb-motion-lift:-1px;--jvb-motion-ease:cubic-bezier(.2,0,0,1);display:flex`.
  Cinematic: the same with `560ms`, `220ms`, `24px`, `-2px`, `cubic-bezier(.16,1,.3,1)`.
- R7. The CSS ends with exactly the block in section 5 (string equality on the tail), in published
  and in each device mode; everything before that block is byte-identical to the same document
  rendered with motion absent, apart from line 1's five added properties.
- R8. Structure of the motion CSS: no line containing `transition`, `animation`, `transform` or
  `@keyframes` appears outside the three motion media blocks; there is no `!important`, `@import`
  or `url(` in the block; every keyframe name starts with `jvb-`; every rule line in the block
  starts with `#jvb-root` or `@keyframes`; the `opacity:0` rule appears only inside
  `@media screen and (prefers-reduced-motion: no-preference){` and only with `.jvb-motion-on`.
- R9. Frame script: `builderFrameScript({ slug: 's' })` parses (`new Function(script)` does not
  throw); it contains `getAttribute('data-jvb-motion')`,
  `matchMedia('(prefers-reduced-motion: no-preference)')`, `IntersectionObserver`, and
  `focusin`; `classList.add('jvb-motion-on')` appears after the `observe(` call and inside a
  `try {` that opens after `getElementById('jvb-root')` and before the first `[data-jvb-countdown]`.
- Seen red, at least: R5 with the first-section guard planted off (`sections[0]` gets the
  attribute); R7 with `80ms` changed to `90ms`; R1 with one character of the root rule changed for
  a motion-less page.

### `page-builder-motion-editor.test.mjs` (Part E)

- E1. `flipOffsets(before, after)` answers `old - new` for ids in both maps, nothing for an id in
  one only, nothing for a change under 1px.
- E2. `editorMotionOff(false, false)` is false; `(true, false)`, `(false, true)`, `(true, true)`
  are true.
- E3. `readReduceMotionPref` answers true for `'1'`, false for `'0'`, absent, and a storage whose
  `getItem` throws; `writeReduceMotionPref` does not throw when `setItem` throws.
- E4. Reducer: `insert`, `move`, `pasteNode`, `duplicate` and `insertSaved` set `flash.id` to the
  node that landed (the new copy for paste and duplicate, the moved node for move) and raise
  `flash.seq`; a refused paste, `undo`, `redo`, `select`, `setProps`, `setTheme`, `loadDoc` and
  `replaceDoc` leave `flash` as it was.
- E5. Source pins: `BuilderCanvas.tsx` puts `jv-motion-appear` on the selection outline and the
  toolbar, each keyed by `selectedId`; `ZoneView` carries `jv-motion-zone` and `jv-motion-appear`;
  an effect on `[device]` restarts `jv-motion-device-in` on the canvas layer (which is not keyed) and
  returns early when motion is off; the flash overlay has `data-jvbe-flash`, `aria-hidden`, class
  `jv-motion-flash`, and is not drawn when motion is off; `BuilderOutline.tsx` imports `flipOffsets` and
  returns early when motion is off or `dragging`; `BuilderShell.tsx` sets `data-reduce-motion`.
- E6. `src/index.css`: one `@media (prefers-reduced-motion: no-preference)` block holds
  `.jv-builder:not([data-reduce-motion]) .jv-motion-appear` with `jvbe-appear 120ms`,
  `.jv-motion-zone` with `150ms`, `.jv-motion-flash` with `jvbe-flash 600ms`,
  `.jv-motion-device-in` with `jvbe-device-in 180ms`; a
  `.jv-builder[data-reduce-motion] *` rule sets `animation: none !important` and
  `transition: none !important`; the FIRST `@media (prefers-reduced-motion: reduce)` block in the
  file is the same text as on c69860a.
- E7. `BuilderThemePanel.tsx` has a select labelled `Motion` with exactly the three options, a
  `Preview motion` button with `aria-disabled`, and a checkbox labelled
  `Reduce motion in the editor`; the Motion hints are built from `MOTION_PRESETS` (the file
  reads `MOTION_PRESETS.subtle.distancePx` and `MOTION_PRESETS.cinematic.distancePx`, and no hint
  string holds the literals `10px` or `24px`).
- E8. `BuilderInspector.tsx`: the Advanced tab has a select labelled `Entrance animation` with the
  four options in section 4, shown for sections only; the Content tab filter leaves out `reveal`.
- Seen red, at least: E4 with the `flash` assignment removed from `pasteNode`; E1 with the sign
  flipped.

### New steps in `scripts/builder-browser-check.mjs` (Part E)

- `motion-theme`: Global styles, Motion to Subtle: the stored theme holds `motion: 'subtle'`; in
  the canvas shadow root `#jvb-root` has `data-jvb-motion="subtle"` and computed
  `--jvb-motion-duration` `240ms`; the first section has no `data-jvb-reveal` and the second has
  `"rise"`; every section's computed opacity is `1`.
- `motion-section-override`: the second section, Advanced, Entrance animation to Fade in: stored
  `props.reveal` is `fade` and the canvas attribute is `"fade"`; to None: the attribute is gone.
  On the first section the "first section never moves" hint is shown.
- `motion-selection`: selecting a block, the `[data-selection-outline]` element and the
  `role="toolbar"` element have computed `animation-name` `jvbe-appear` and `animation-duration`
  `0.12s`.
- `motion-drop-zone`: during a palette drag, a `[data-zone-id]` bar has a computed
  `transition-duration` that includes `0.15s`.
- `motion-flash`: Paste on the toolbar: a `[data-jvbe-flash]` element appears with
  `animation-name` `jvbe-flash` and is gone within 1500 ms.
- `motion-outline-flip`: with a MutationObserver recording the outline rows' `style` attribute,
  Alt+Down on a section row records at least one value containing `translateY(` and one containing
  `180ms`; 500 ms later no row has an inline transform.
- `motion-device`: switching to Tablet, `[data-canvas-layer]` has `animation-name`
  `jvbe-device-in` and `animation-duration` `0.18s`.
- `motion-preview`: Preview motion: within 1000 ms the shadow `#jvb-root` has `jvb-motion-on` and a
  non-first section has `jvb-in`; 1500 ms later `jvb-motion-on` is gone and every section's opacity
  is `1`. Fix round 3: the builder's one polite live region said "Previewing subtle motion" and then
  "Preview finished".
- `motion-reduced-os`: `page.emulateMedia({ reducedMotion: 'reduce' })`: the dialog has
  `data-reduce-motion`; selection outline `animation-name` is `none`; Paste draws no
  `[data-jvbe-flash]`; the device switch leaves `animation-name` `none`; Alt+Down records no
  `translateY(`; Preview motion is `aria-disabled="true"` and its hint names the device setting.
  Fix round 3: the canvas host has `data-jvbe-motion-off`, a page `.jvb-btn` in the shadow root has
  `transition-duration` `0s`, and nothing in the shadow `#jvb-root` has a transition or an animation.
- `motion-reduced-pref`: back to `no-preference`, check Reduce motion in the editor: localStorage
  `jv_builder_reduce_motion` is `"1"`, the dialog has `data-reduce-motion`, and the same four
  checks as `motion-reduced-os` hold, the shadow root ones included (this is where the preference
  used to stop short: the button kept `0.18s`); uncheck: the attribute is gone, the selection
  animation is back, the host has no `data-jvbe-motion-off` and the page button's `0.18s` is back.
  The stored document does not change across the step.
- Seen red, at least one of these steps with a planted fault (for example the `jv-motion-appear`
  class removed from the toolbar).

### `scripts/builder-motion-page-check.mjs` (Part P)

Builds pages in node from `render()`, `frameCss()` and `builderFrameScript()` exactly as
`publicRoutes.mjs` assembles them, serves each from a fake `http://jvb.test/` origin through
`page.route` (so localStorage works), aborts every other request, Chrome at 1280x800. Exit 0 pass,
1 a step failed, 2 could not run.

- `page-unset`: a motion-less doc: no `data-jvb-motion`, no `data-jvb-reveal`, `#jvb-root` never
  gets `jvb-motion-on`, `.jvb-btn` computed `transition-duration` is `0s`.
- `page-subtle-reveal`: a six-section subtle doc, each section `minHeight` 700: section 1 has no
  attribute and opacity `1`; after load `#jvb-root` has `jvb-motion-on`; section 4 has computed
  opacity `0` and transform `matrix(1, 0, 0, 1, 0, 10)`; after `scrollIntoView`, within 1000 ms it
  has `jvb-in`, opacity `1`, transform `none`, `transition-duration` `0.24s`; scrolled back to the
  top it keeps `jvb-in`.
- `page-above-fold`: a doc whose second section is short and on screen at load: it has `jvb-in`
  at load and `document.getAnimations().length` is 0 right after load.
- `page-focus-reveal`: Tab until focus is on a button inside a hidden section: that section has
  `jvb-in` at once.
- `page-cinematic`: the same doc at cinematic: hidden transform `matrix(1, 0, 0, 1, 0, 24)` and
  `transition-duration` `0.56s` once revealed.
- `page-reduced`: `reducedMotion: 'reduce'`: no `jvb-motion-on`; every section opacity `1` at load
  and after scrolling; `.jvb-btn` `transition-duration` `0s`; hover leaves transform `none`.
- `page-no-js`: a context with JavaScript off: every section opacity `1`.
- `page-print`: JavaScript on, loaded, then `emulateMedia({ media: 'print' })`: a hidden section
  reads opacity `1`.
- `page-button`: subtle, hovering a `.jvb-btn` for 300 ms: transform `matrix(1, 0, 0, 1, 0, -1)`.
- `page-link`: subtle, hovering a link in a text widget for 300 ms: `text-underline-offset` is
  larger than at rest.
- `page-bump-tick`: subtle, clicking the bump checkbox: its `getAnimations()` holds one whose
  `animationName` is `jvb-tick`.
- `runtime`: no page error and no console error on any page above.
- Seen red, at least: the `screen` condition removed from the hidden-state block (`page-print`
  must go red) and the `top < fold` branch removed from the frame script (`page-above-fold` must
  go red).

## 8. Not in this spec, on purpose

- No parallax, no scroll-scrubbed animation, no stagger between columns, no per-widget entrance
  animation, no looping or attention-seeking motion (the stock pulse dot stays still).
- No new motion on the frame (lead modal, exit drawer, sticky bar, consent). It keeps the motion it
  had, which since fix round 3 plays only for a visitor with no reduced-motion preference (section
  3). The cookie banner is shared with the legacy template and pinned by the legacy snapshot, so its
  own CSS is not changed.
- No change to how the canvas is drawn, measured or scaled.

## 9. Open questions for the owner (answered by default as written)

- Should new pages and templates start with motion `subtle`? Default no: a page stays still until
  the merchant picks a level, which keeps every existing template golden and every converted page
  as it is today. Turning it on for templates later is a one-key change in `templates.mjs` plus new
  goldens.
- Should a section's reveal be choosable while page motion is off? Default yes: the choice is kept
  and takes effect when page motion is turned on; the hint says so.
