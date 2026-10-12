# Ask Jourvance: the assistant bubble and panel

Design brief for sections 2 and 4 of `ASK_JOURVANCE_PLAN.md` (Wave 1A). The content writer
supplies every word the panel shows; this file names the slots. The visual reference is the
product itself: `AiJourneyBuilder.tsx` for the panel and the mobile nav trigger for the bubble.
`design-state.md` records no separate taste calibration, so none was made.

Evidence: code facts cite `path:line` and were read on 2026-10-11. Where the bubble meets other
controls is computed from the CSS, not measured in a browser. Contrast ratios were computed with
the WCAG 2.x relative luminance formula by a scratch script that is not in the repo. Screen
reader phrasing is not tested and is marked as such.

## 1. Brief

Problem: an owner who wants to know how many leads a funnel got, or how to publish, has to leave
their screen to find out. Ask Jourvance answers in place, without covering or changing the work.

Readers: business owners and marketers in the studio (canvas, Email Studio, Attribution), public
page visitors (asked to sign in), phones at 390px, keyboard-only, screen reader and 200% zoom users.

Success: the Wave 2A browser check passes at 1440 and 390: a keyboard-only signed-in user opens
the bubble, sends a suggested question and reads the answer in the log; focus lands where section
7 says on open and returns to the bubble on Escape; the canvas takes a click while it is open.

## 2. Principles

1. **The canvas stays theirs.** A companion, not a dialog: no backdrop, no trap, no edits (plan 2, 6).
2. **Say what happened, never more.** Shared only when the hub said so; saved and saved here only
   are different sentences; a limit names its minutes (plan 2).
3. **Private by default, shared on purpose.** Helpful shares a scrubbed copy and says so the first
   time; Not helpful sends nothing to the hub (plan 2).
4. **One product.** Palette `C`, the trigger's gradient, the house refusal and Retry pattern.
5. **Keyboard and screen reader are first-class.** Every state reachable, named and heard; no
   state shown by colour alone.

## 3. Layout

### 3.1 The bubble

- 52px circle at bottom 20px, right 20px (plan 4), with the trigger's own gradient (#EC4899 to
  #8B5CF6 at 135 degrees) and pink shadow (App.tsx:1092, App.tsx:1098). No border, no visible
  text, no idle motion.
- Icon `MessageCircleQuestionMark` (exported by the installed lucide-react 1.47.0), 22px white,
  `aria-hidden`; `X` while the desktop panel is open. Name `Ask Jourvance`, never changed.
- New answer dot: 10px `C.amber` circle with a 2px `C.panel` ring at the top right, shown when an
  answer lands while the panel is closed, cleared on open.
- Hidden while the narrow sheet is open (the sheet has its own Close) and while printing.

### 3.2 The panel, 380 wide

```text
+---------------------------------------------------+  radius 14, 1px edge #64748B
| (?) Ask Jourvance                  [Clear]  [ X ] |  header 56, h2 17px #F8FAFC
|     subline slot, 12px C.muted                    |
+---------------------------------------------------+  body scrolls from here
| > What the assistant knows about your business    |  <details>, closed by default
|---------------------------------------------------|
|                      +--------------------------+ |  you: right aligned, max 85%,
|                      | How do I publish?        | |  C.violetBg, radius 12, 4 at
|                      +--------------------------+ |  the bottom right corner
| +-----------------------------------------------+ |  answer: full width card,
| | Open the journey, then Publish in the toolbar | |  C.field, radius 10, 14px
| +-----------------------------------------------+ |
| [ Helpful ]  [ Not helpful ]                      |  feedback row, 44 high
| shared line slot, 12px C.muted (first time only)  |
+---------------------------------------------------+  pinned from here
| status, refusal or limit slot (one at a time)     |
| Your question                                     |  visible label 12px
| +-------------------------------------+  +------+ |
| | 1 to 5 rows, then it scrolls        |  | Send | |  Send 44x44, C.primary
| +-------------------------------------+  +------+ |
| Enter sends. Shift+Enter adds a line.  940 / 1,000|  hint 12px; count from 900
+---------------------------------------------------+
```

- Header and input row are pinned; the body between scrolls and holds the notes `<details>`
  above the log. Padding 16px; 12px between messages. Clear shows only while there is a message.
- Notes open: visible label, 5 row box, `n of 2,000` always shown, Save notes, one status line.
- Every control is at least 44 by 44px, the feedback toggles included (14px icon, 13px label).
- The newest message is scrolled into view when the reader was within 80px of the bottom;
  otherwise their scroll is left alone and the arrival is still announced.

### 3.3 Placement

```text
1440 x 900, canvas view, open
+--------------------------------------------------------------------------+
| header row, account at right (zIndex 31)                                 |
| journey toolbar: Add step, More, Publish (zIndex 30)                     |
+----+------------------------------------------+--------------------------+
|rail| map pane                                 | step dock, 420 wide      |
| 64 |                                          |  +--------------------+  |
|    |                                          |  | panel 380          |  |
|    |                                          |  | height: min(600,   |  |
|    |                                          |  | 100dvh less 156)   |  |
|    |  [+]                        +---------+  |  +--------------------+  |
|    |  [-] Controls, bottom left  | MiniMap |  |       12 gap      (X) 52 |
+----+------------------------------------------+--------------------------+
```

The panel's bottom edge is 84px up (bubble 52, offset 20, gap 12) and its top edge never rises
above 72px, so the header row and, at ordinary heights, the toolbar row stay clear. At 1440 it sits
over the step dock (index.css:605-614, 30% of the window within 360 to 420px); the map stays clear.

```text
768 x 1024, canvas view, open             390 x 844, closed         390, sheet open
+-------------------------------------+   +--------------------+   +--------------------+
| header and toolbar (may wrap)       |   | header, toolbar    |   | page, still usable |
+-----------------+-------------------+   | map pane, 62vh     |   | (top 30%)          |
| map pane 408    | dock 360          |   | [Controls]         |   +--------------------+
|             +---------------------+ |   +--------------------+   | Ask J. [Clear] [X] |
|             | panel 380; its left | |   | step dock, stacked |   | > notes summary    |
|             | edge is 40px into   | |   | under the map      |   | log ...            |
|             | the map             | |   |                    |   |                    |
|             +---------------------+ |   |                    |   | [question ] [Send] |
|       +-------+ |                   |   |                    |   | hint, count        |
|       |MiniMap| |              (X)  |   | (nav)          (?) |   |                    |
| (nav) +-------+ |                   |   |                    |   |                    |
+-----------------+-------------------+   +--------------------+   +--------------------+
```

- 768: the card, by the plan's 720px rule, kept because the plan is the contract and 768 gets the
  card either way. The mobile nav trigger shows at this width (index.css:710, 731-733) at the
  bottom left. The open card reaches 40px into the 408px map and over a corner of the MiniMap
  (computed from index.css:605, fitRoom.ts:12 and the panel's 84px foot, not measured).
- 390: bottom sheet, full width, 70dvh (70vh where dvh is unsupported), top corners radius 14, no
  backdrop. The MiniMap is already hidden below 480px (index.css:113-116).
- Short screens (under 560px visible, a landscape phone or 200% zoom): card or sheet takes the
  whole visible height and covers the bubble; Close in the header closes it. Reflows to 320px.

### 3.4 Coexisting with the canvas

Non-modal (`aria-modal="false"`): no backdrop, a click outside never closes it, and the map,
toolbar and dock keep working. Never `aria-modal="true"`: `modalIsOpen` reads that attribute
(modalOpen.ts:16) and the map's undo shortcut goes dead while it is set (useJourneyEditing.ts:187).
Keys pressed inside the panel stay inside it, the house rule at AiJourneyBuilder.tsx:307-308, so
Backspace there never deletes a selected step and Ctrl or Cmd+Z on a panel button never undoes a
map edit; keys outside reach the page as before. The panel stays mounted when closed (`hidden`),
so a draft question, unsaved notes and an answer in flight survive closing, changing views and
reopening. Sign out empties all of it at once.

### 3.5 Narrow screens and the on-screen keyboard

When the keyboard opens, the sheet follows the visual viewport: its foot sits on the top of the
keyboard and its height becomes the smaller of 70% of the screen and the visible area less 8px.
Header and input row stay pinned and the log shrinks between them; under 240px visible the notes
close and the subline hides. The question box is 16px text below 720px so iOS Safari does not
zoom on focus (platform behaviour, not checked on a device), with the Enter key labelled Send
(`enterkeyhint`). Nothing in the repo reads `visualViewport` and the viewport meta has no
`interactive-widget` (index.html:6), so this is UNKNOWN until checked on a real phone; Chrome's
device mode in the browser check opens no keyboard.

### 3.6 What already sits near the bottom right

| Surface | Element | Where | With the bubble |
|---|---|---|---|
| Canvas, 768 up | Step dock fills the right column | App.tsx:1041, index.css:605-614 | Bubble sits over the dock's foot |
| Canvas, 768 up | Disconnect Step Connection, full width at the dock's foot | EdgeInspector.tsx:424-453 | Right end under the bubble (computed) |
| Canvas | MiniMap, bottom right of the map pane | JourneyCanvas.tsx:1880-1885 | Clear at 1440; open card covers a corner at 768 |
| Canvas, phones | Rule notice docked at the window foot, Dismiss at its right end | JourneyCanvas.tsx:1771-1775, 1802-1806 | Dismiss under the bubble (computed) |
| Email Studio | Broadcast actions, sticky at the foot | BroadcastComposer.tsx:721-728 | Wrapped buttons and status can reach it (inferred) |
| Email Studio | Flow notice, sticky at the foot | EmailFlowMap.tsx:1357 | Right end can be under it (inferred) |
| Attribution | No fixed, absolute or bottom-right element (grep) | AttributionReports.tsx | Only the last scrolled row's right end |
| Public | Footer row, plain text spans at the right | PublicFooter.tsx:166-185 | Covered at the end of the scroll; not controls |
| Any | Load failure box, centred, zIndex 10000 | ChunkBoundary.tsx:38-45 | Paints over the bubble |

Both maps keep Controls at the bottom left (JourneyCanvas.tsx:1879; EmailFlowMap.tsx:882 on React
Flow's default); the Forecaster's toast sits inside a z-50 drawer that covers the bubble
(FinancialSimulatorDrawer.tsx:1295). The fix for the three real covers is a 92px clear zone at the
end of those scrollers and right of the docked notice, in files outside Wave 2A (question 1).

## 4. States

One status slot sits above the input; the log holds only messages. Slots are the content writer's.

| State | What shows | Slots |
|---|---|---|
| Signed out | Header, one sentence, Sign in (primary) which calls `onOpenAuth`. No notes, input or Clear | `signedOut.body`, `signedOut.action` |
| Loading the thread | Status line; input shown, Send `aria-disabled` | `loading.status` |
| Empty | Intro line and three suggestion buttons (a number about their business, a how-to, what to do next). A press fills the input and focuses it; it does not send | `empty.intro`, `empty.q1`..`q3` |
| Sending | Question added to the log; status line with spinner; Send shows spinner and busy label, `aria-disabled`; Clear `aria-disabled`; typing the next question is allowed | `sending.status`, `sending.button` |
| Answer | Answer card, then the feedback row. Visually hidden speaker prefix on every message | `speaker.you`, `speaker.assistant` |
| Helpful or Not helpful pressed | `aria-pressed="true"`, `Check` replaces the thumb icon, violet fill; the other unpresses. Not helpful sends nothing to the hub | `feedback.helpful`, `feedback.notHelpful`, `feedback.notHelpfulNote` (optional) |
| Shared, first time | One line under that answer, only when no earlier message carries `shared: true` | `feedback.sharedFirst` |
| Not shared, changed after sharing, failed | One line under the row: why Helpful was not shared (daily cap, hub refused); that a shared copy stays shared; or that the rating did not save, with the toggle back at its last saved state | `feedback.notShared`, `feedback.alreadyShared`, `feedback.failed` |
| Hourly limit | Amber line with the minutes from Retry-After; Send `aria-disabled` with the line as its description; draft kept. When the wait ends the line changes and Retry appears | `limit.status`, `limit.waited`, `limit.retry` |
| Unavailable on this server | Sentence in place of the input row; the notes stay (they save here) | `unavailable.body` |
| Failed | Red alert box with Retry, which asks the same question again; no Retry when not retryable | `failed.body`, `failed.retry`, `failed.final` |
| Over the length | Count says it is over in `C.red` words; Send `aria-disabled`. Never cut silently | `input.over`, `notes.over` |
| Notes editing, saving | Label, help, count, Save notes; Unsaved changes once edited; spinner while saving | `notes.summary`, `.label`, `.help`, `.save`, `.unsaved`, `.saving` |
| Notes saved, saved here only, failed | Status line with the time; or an amber line naming why it stayed on this server (hub off, daily limit of 10, hub refused); or a red line with the text still in the box | `notes.saved`, `notes.savedLocal`, `notes.failed` |
| Clear confirm, done | `window.confirm` (house pattern, EdgeInspector.tsx:430, BroadcastComposer.tsx:771) saying notes stay; then the empty state and a status line | `clear.confirm`, `clear.done` |
| Answer while closed | Dot on the bubble; its description says an answer is waiting | `bubble.newAnswer` |

## 5. Tokens

Colours from `C` (AiJourneyBuilder.tsx:65-78): panel `C.panel`, body text `C.text`, help and meta
`C.muted`, answer card and input fill `C.field`, inner dividers `C.border`, limit and saved-here-only
`C.amber` on `C.amberBg`, failures `C.red` on `C.redBg`, your messages and pressed toggles
`C.violetBg`, panel icon and pressed label `C.violet`, Send `C.primary`; heading `#F8FAFC` and
input text `#F1F5F9` as in that file. Additions, all existing house values: panel edge and input
border `--color-text-dim` #64748B (index.css:17), because `C.panel` is 1.07:1 on the canvas and
1.01:1 on the dock, so a `C.border` edge would vanish; focus ring `#A5B4FC`, 2px, offset 2px, the
AI dialog's (index.css:645-647), offset 3px on the bubble so it lands on the page; pressed border
`#818CF8`. No placeholder; if one is added it is `C.muted`.

| Text or part (ratios to 1) | On | Ratio | Needs |
|---|---|---|---|
| `C.text` #E2E8F0 | `C.panel` #0F172A / `C.field` #1E293B / `C.violetBg` #1B1833 | 14.48 / 11.87 / 13.91 | 4.5 |
| `#F8FAFC` heading | `C.panel` | 17.06 | 3 (large) |
| `C.muted` #94A3B8 | `C.panel` / `C.field` | 6.96 / 5.71 | 4.5 |
| `#F1F5F9` input text, `#CBD5E1` busy label | `C.field` | 13.35, 9.85 | 4.5 |
| `C.violet` #C4B5FD, `C.amber` #FBBF24, `C.red` #FCA5A5 | `C.violetBg`, `C.amberBg` #1F1B0E, `C.redBg` #2A1215 | 9.29, 10.30, 9.25 | 4.5 |
| White | `C.primary` #4F46E5 | 6.29 | 4.5 |
| Input edge #64748B | `C.panel` | 3.75 | 3 (UI) |
| Panel edge #64748B | `--color-bg` #0B0F19 / `--color-surface-1` #111827 | 4.02 / 3.73 | none required; chosen |
| Pressed border #818CF8 | `C.panel` / `C.violetBg` | 5.98 / 5.75 | 3 (UI) |
| Focus ring #A5B4FC | `C.panel` / `C.field` / `--color-bg` | 8.96 / 7.34 / 9.61 | 3 (UI) |
| White icon | gradient #EC4899 / #8B5CF6 / sRGB midpoint #BC52C8 | 3.53 / 4.23 / 4.05 | 3 (graphic) |
| Bubble #EC4899 / #8B5CF6 | `--color-bg` | 5.43 / 4.52 | 3 (UI) |

Not used: `C.border` #334155 as an input edge (1.72 on `C.panel`); `#64748B` as text on `C.field`
(3.07); the focus ring against the bubble's own gradient (1.77), hence the offset.

Type: heading 17px weight 700; messages 14px, line height 1.5; status, refusal and help 13px;
labels, hint, count and subline 12px; question box 14px from 720px up, 16px below. Nothing under
`MIN_TEXT_PX` (11px, a11y.ts:7).

zIndex: **25** for bubble and panel. Above the map's floating tools and notices (20,
JourneyCanvas.tsx:1624, 1775), the problems alert (19, CanvasHeader.tsx:1389) and the return banner
(18, FunnelReturnBanner.tsx:28). Below the journey toolbar (30, CanvasHeader.tsx:725-728, whose
comment says its menus must open over floating map controls) and the header (31,
CanvasHeader.tsx:430-432), so the account, Add step and More menus open over the panel; at the
plan's 45 the panel would paint over them. Below the mobile nav trigger (45, App.tsx:1100, opposite
corner), the nav backdrop (49, AppSidebar.tsx:159), the drawers (z-50, PreFlightAuditDrawer.tsx:258),
the public header (50, PublicHeader.tsx:67), overlay modals from 100 to 10000
(LiveFunnelModal.tsx:718, AiJourneyBuilder.tsx:838, HubEmailSuite.tsx:1978, ChunkBoundary.tsx:43)
and native `<dialog>` modals in the top layer (ModalDialog.tsx:55, BuilderShell.tsx:326).

## 6. Motion

- Open, card: opacity 0 to 1 and 8px up to 0 over 160ms, the drawers' ease-out curve
  (drawerUtilities.css:80). Sheet: 16px up over 200ms, same easing (the drawers' 200ms,
  drawerUtilities.css:78); not a full-height slide, since 590px of travel is a lot.
- Close: instant, as the house drawers animate only on entry (drawerUtilities.css:28).
- Bubble: no idle motion. Hover deepens the shadow over 150ms; press scales to 0.96.
- Busy: the house `.spin` (index.css:484-490) in Send and Save notes, beside words that carry it.
- Reduced motion: the global switch (index.css:492-503) removes every animation, transition and
  smooth scroll, so the panel appears in place and the spinner stands still.

## 7. Focus and keyboard contract

- **Roles:** the bubble is a button named Ask Jourvance with `aria-expanded` and `aria-controls`
  (the panel is always in the DOM), described by a hidden `bubble.newAnswer` while an answer waits.
  The panel is `role="dialog"`, `aria-modal="false"`, labelled by its h2, through `useDialogFocus`
  as non-modal (a11yHooks.ts:47): on the dialog stack, no Tab trap.
- **Focus on open:** the question box from 720px up; below 720px the h2 (`tabIndex -1`), so the
  keyboard does not cover the sheet unasked. Signed out: Sign in. Unavailable: the h2. Sign-in
  finishing while open with focus lost: the question box (the h2 below 720px).
- **Escape:** handled by the panel (keys stop there); closes it whenever focus is inside unless a
  control used the key; never cancels an answer in flight. Outside, the page and stack as now.
- **Focus on close:** the bubble. Below 720px the bubble shows again first, then takes focus.
- **Tab order:** bubble, Clear, Close, notes summary (then notes label, box, Save notes when open),
  suggestions or each answer's two toggles in log order, Retry, question box, Send, then the page.
- **Question box:** Enter sends, Shift+Enter adds a line, Enter during IME composition does
  neither, Enter on an empty box does nothing, Tab leaves.
- **Log:** `role="log"`, `aria-live="polite"`. Each message is an `<article>` starting with the
  visually hidden speaker prefix. Answers never take focus; focus stays in the box.
- **What is heard:** on send, the prefix, the question, then `sending.status`; on an answer, the
  assistant prefix, the answer, then the two toggle names; a refusal once (`role="alert"`); a limit
  and notes outcomes as `role="status"`. Exact phrasing is untested (VoiceOver, NVDA).
- **Feedback:** two buttons with `aria-pressed` and visible text, never icon only. Pressing the pressed
  one again changes nothing (the server has no unrated value).
- **Retry and Clear:** after Retry unmounts, and after Clear done, focus goes to the question box.

## 8. Decisions and open questions

| Date | Decision | Reason |
|---|---|---|
| 2026-10-11 | zIndex 25, not the plan's 45 | Header and toolbar menus (30, 31) must open over the panel; 25 still clears the map's floating parts (20) |
| 2026-10-11 | Desktop panel is a 380 card above the bubble, not a full-height column | A full-height column covers the account menu and Publish |
| 2026-10-11 | Panel edge and input border in `--color-text-dim` | `C.panel` is 1.07:1 on the canvas; `C.border` is 1.72:1 on the panel |
| 2026-10-11 | Focus to the heading on open below 720px | Focusing the box opens the keyboard over the sheet before anyone asked |
| 2026-10-11 | Suggestions fill the box, never send | Every question counts toward the hourly limit and costs credits |
| 2026-10-11 | Clear confirms with `window.confirm` | The house destructive-confirm pattern, at two call sites |
| 2026-10-11 | Keys stop at the panel; Escape handled there | Backspace and undo must not reach the map from inside it |
| 2026-10-11 | First time shared is read from the thread | No browser storage; true across devices and after a clear |
| 2026-10-11 | Entry-only animation, 160ms card, 200ms sheet | Matches the drawers; the global reduced-motion switch removes it |

Open questions for the owner:

1. The bubble covers Disconnect, the phone map notice's Dismiss and maybe the broadcast actions.
   May a follow-up add a 92px clear zone in EdgeInspector, JourneyCanvas and BroadcastComposer?
2. Plan section 4 says zIndex 45 and focus to the input on open; this brief says 25, and the
   heading below 720px. The main session should amend the plan so the builder has one answer.
3. A shared Helpful answer cannot be withdrawn by Not helpful. Is a line saying so enough, or
   should Helpful lock once shared?
4. Hiding the bubble while printing needs a print rule; `index.css` is not on the builder's list.
5. Should a suggestion send at once instead of filling the box?
