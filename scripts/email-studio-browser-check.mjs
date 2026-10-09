#!/usr/bin/env node
// The Email Studio browser check (EMAIL_STUDIO_PLAN.md Waves 1 to 6): node scripts/email-studio-browser-check.mjs
//
// What it does, from /canvas, in real Chrome at 1440x900. "All flows" is the Flows destination's first
// section, the screen the Automations tab was before Wave 3; the steps reach it through the tablists.
//   open             the sidebar's Email Studio opens the studio; its heading is visible
//   counts           (Wave 4) each starter row counts its own emails from its steps ("3 emails", "1 email"), and
//                    in the opened "People in starter flows" an enrollment reads "Step 1 of 2" for a two-email
//                    flow, never a literal 3; (Wave 2 fix) an active one reads "In the flow" and one the sender
//                    took out because its flow was off reads "Taken out, flow turned off"
//   flows-one-list   (Wave 4) All flows holds each of the 12 flows and the 4 order emails exactly once, each the
//                    only button of its name on the page; the order emails are the last four, in their own
//                    group; one row of each kind reads its tag, its start in TRIGGER_META's words, On or Off,
//                    its counted emails and Enrolled through statText; the hub's flows are a closed group
//                    under the list and their flow is not shown; (Wave 2 fix) Welcome's row says its 3 emails
//                    are still starter drafts and not sent, and no other row says so
//   starter-open     on All flows, the Welcome flow row: Flows and its Flow map are the selected tabs,
//                    Welcome flow is the chosen flow, its first email is drawn selected, and the
//                    step heading reads "Email 1 of 3" and holds focus
//   starter-draft-note (Wave 2) on Welcome's email 1, the step panel says the D6 starter-draft sentence under the
//                    starter note; it stays while the email's text is edited and not saved; Save posts the new
//                    text and the sentence is gone from email 1 while email 2, still the draft, keeps it. The
//                    server marks a draft (starterDraft on the email node), the client never reads the words.
//                    The step puts the stub's account back as it found it, so the steps after it start from the seeds
//   email-open       back on All flows, the Welcome row opens email 1, and a click on email 2 on the map
//                    selects it: on screen, drawn selected, and its subject is in the Subject field
//   node-selected    a click on the Wait node draws it with a border colour an unselected node does not
//                    have, the node stays on screen while focus moves to the step heading, and the panel
//                    shows "Wait, in hours"
//   builder-in-step  on email 1, a new subject and preview text, then "Add image" and "Add button" in
//                    the step panel's builder: both blocks appear
//   save-content     "Unsaved changes" shows; Save, with the stub's answer held: Save reads Saving, the
//                    status says Saving and never Saved until the answer is released; then the stub has
//                    exactly one POST to /api/email/flow-content/drip_seq_default whose email node carries
//                    the new subject, the preview text and both new blocks, the Saved sentence is ON
//                    SCREEN beside a Save that is on screen, stays, and "Unsaved changes" is gone; an edit
//                    after it takes the Saved sentence away and brings "Unsaved changes" back
//   cards-show-edit  (Wave 4: no cards) Welcome, opened again from All flows, shows the saved subject and
//                    preview text
//   built-in         the All flows list holds no textarea or input; After the order's row reads Built in and
//                    Off, its Turn on posts { kind: 'automation', enabled: true } once and the row reads On,
//                    Turn off puts it back; the row opens it on the map with the builder in the step panel
//   account-flow     on Viewed a product, the Email step shows the builder and the advanced options,
//                    and Save posts its blocks to /api/email/flows/flow_viewedproduct
//   save-unanswered  the flow-content request is aborted, and the notice reads
//                    FLOW_MAP_WRITE_UNREACHABLE.content
//   unsaved-kept     with that edit still unsaved, choosing another flow in the editor's picker asks first;
//                    Cancel keeps the flow and the edit
//   strip-clears     after a row opened Welcome, the section strip's All flows then Flow map opens the plain map:
//                    the first flow, nothing selected, not the flow the button asked for
//   keyboard         Tab from the All flows tab reaches the Welcome row, Enter opens the map, and focus
//                    is on the step heading; Enter on a focused step on the map selects it the same way.
//                    Once React Flow has drawn the new map's steps, neither selection draws one hidden
//                    (a MutationObserver watches every step's style), and each step takes focus at once
//   narrow           at 390x844 with the builder open, document.documentElement.scrollWidth is 390, the
//                    studio does not scroll sideways, and no control in it sticks out past either edge
//   flows-row-open   (Wave 4) the Added to cart row opens that account flow with its email chosen and focus on
//                    "Email 1 of 1"; its settings are closed under "Flow settings", and Enter opens them on
//                    its name and closes them
//   order-email-builder (Wave 4) the Order confirmation row opens it with the builder and no preview text
//                    field; Preview sample asks once with marketing false; a new subject and a button save as
//                    one POST to /api/email/flow-content/order_confirmation; Turn on on All flows posts
//                    { kind: 'transactional', enabled: true }
//   delete-asks      (Wave 4) Delete on Price drop asks first, naming it; Cancel sends no DELETE and it stays
//   new-flow         (Wave 4 fix) All flows has New flow: one click posts { name: 'New flow', trigger: 'manual' } to
//                    /api/email/flows once and opens the new flow on its email, drawn selected, focus on
//                    "Email 1 of 1" and the builder showing; from the plain Flow map its own New flow does the same
//   delete-confirmed (Wave 4 fix) Delete, accepted, sends one DELETE for the flow it named; focus is on the Flow map
//                    heading and the status says it was deleted; both new flows are deleted so All flows is 16 rows
//   row-switches     (Wave 4 fix) Viewed a product turns on and off from its row through /api/email/flows/:id with
//                    { enabled } alone; while the answer is held the switch reads Saving and its name begins with
//                    Saving
//   starter-off      (Wave 2) Welcome's row reads On; Turn off Welcome flow posts exactly { enabled: false } to
//                    /api/email/flow-content/drip_seq_default, the row reads Off and its switch Turn on, and the
//                    status says what happens to the people in it (starterOffNotice); in the editor Welcome's
//                    header says "Off for this account" beside a switch that reads Turn on and posts
//                    { enabled: true }, then says "On for this account" beside Turn off, and back on All flows
//                    the row reads On; no "Always on" sentence is left on the list
//   panel-beside     (Wave 4) at 1440 the step panel's left edge is right of the map's right edge, and every
//                    step on the map is drawn inside the map's box
//   panel-below      (Wave 4) at 390 the step panel is below the map, the map's steps inside its box, nothing
//                    past an edge, scrollWidth 390
//   nav-five         (Wave 3) the "Email Studio" tablist holds exactly Flows, Broadcasts, Audience, Results and
//                    Settings, one selected and one Tab stop; each opens with its own sections (a second
//                    tablist, one selected, Results none), and every aria-controls names a tabpanel that the
//                    tab labels; Chrome's own computed name for the Texts tab (asked over CDP) is "Texts Soon";
//                    no Hub Engine badge
//   nav-moved        the Flows list no longer shows Run Queue Tick, Webhooks or the checkouts table; Settings,
//                    Advanced has "Send due emails now", which posts /api/drips/process-tick once and says what
//                    it did in a status region, and Webhooks, which opens the guide and closes by its named
//                    button; Audience, Open checkouts shows the checkouts table with the stub's checkout, which
//                    reads Pending, and (Wave 2 fix) a checkout stopped because Cart recovery was off, which
//                    reads "Stopped, flow turned off" and never Pending
//   nav-keyboard     on the destination strip ArrowRight, ArrowLeft, Home and End each move the selection AND
//                    the focus, wrapping at both ends; Tab reaches the open destination's selected section,
//                    where the arrows and End do the same; Shift+Tab goes back to the destination. The panel
//                    holding the content (Results', which has no sections, or the open section's) is the
//                    Tab stop after its tab
//   nav-active       on both strips the selected tab's text reads at least 4.5 to 1 on its background, every
//                    other tab's too, and the selected tab is marked by a bar and a heavier weight that no
//                    other tab has, not by colour alone; Texts' Soon badge, unselected and then selected, reads
//                    at least 4.5 to 1 on its own fill and is at least 11px
//   nav-390          at 390x844, for every destination: the destination strip takes at most two rows, its
//                    section strip at most two, neither scrolls sideways, no tab is past an edge, and the
//                    page's scrollWidth is 390
//   broadcast-new    (Wave 5) Broadcasts' sections are All broadcasts and New broadcast (no Builder tab); All
//                    broadcasts' New broadcast opens the composer with focus on its "New broadcast" heading; the
//                    builder shows all 15 Add buttons and starts with a heading and a paragraph; the saved-block
//                    library from GET /api/email/suite is offered and Insert copy adds its block; Send to offers
//                    the segments and the list with the counts the stubs reported and no unmeasured 0; no modal;
//                    at 390 nothing in the studio is past an edge and the page does not scroll sideways
//   broadcast-draft  a subject, the heading and the words, then Save draft: one POST to /api/email/broadcast-drafts
//                    with no id, carrying them and the settings, and the saved sentence; (fix round) while the
//                    words are unsaved a beforeunload is cancelled (the browser asks before a reload drops them),
//                    and once saved it is not; New broadcast (nothing unsaved, so it does not ask) empties the
//                    composer; Flows and back to Broadcasts reads Drafts again, it lists the draft, and Open
//                    draft puts back its subject, heading and words
//   broadcast-test-send  Send a test to me renders the draft's blocks through POST /api/email/programs/preview once,
//                    then POSTs /api/email/send once, to the typed address only, with that html (it carries the
//                    heading and the words); server.mjs's /api/email/send takes html, not blocks
//   broadcast-preview-check  Preview draws the draft in an iframe wider than 600px and says the route's label in a
//                    status region, Mobile width draws it at 375px with its words in it; Check this email posts
//                    the rendered html to /api/email/lint once and says the score and the warning; (fix round)
//                    an edit to the words hides the preview and says it changed, and putting the words back
//                    shows it again; it ends at Mobile width with the A/B, text and link groups open
//   broadcast-confirm  with Send to set to VIP Whales, Send now asks first, naming the segment and the count the
//                    segments stub reported; Cancel sends nothing and says so; (fix round) then at 390, with the
//                    375px preview, the three groups open and that sentence in the sticky bar, nothing is past
//                    an edge, the preview is inside the screen, and the page does not scroll sideways
//   broadcast-payload  At a clock time, then Schedule asks naming the time and the count; accepted, the
//                    campaign/send stub has one body whose blocks are the draft's (no flattened body), when clock,
//                    sendAt the typed time, the whales pick, A/B and holdout off; All broadcasts then has focus
//                    on its heading, says it was scheduled, and the sent draft was deleted and is gone from Drafts;
//                    the send carries a requestId
//   broadcast-send-guards (fix round) a new broadcast with a subject and blank blocks: Send now says to add words
//                    and asks nothing; with words, a send the server never answers says so, and Send now again
//                    carries the SAME requestId (campaign/send refuses a second copy), then lands on All broadcasts
//   broadcast-audience-failed (fix round) with the segments read failing, the composer says so with Retry, and
//                    Send now says who gets it could not be loaded, asks nothing and posts nothing; Retry loads it
//   broadcast-replace-delete (fix round) "Unsaved changes" is a status region; a written draft over unsaved work
//                    asks COMPOSER_REPLACE first and Cancel keeps the work; accepted, its words call nothing a
//                    note; Save draft, then Delete on All broadcasts asks, sends one DELETE, says so and puts
//                    focus on the Drafts heading
//   nav-from-step    the canvas entry: Back to Canvas, the follow-up step on the map, its flow picker set to
//                    Viewed a product, then "Edit this flow in Email Studio" (signed out, the journey saves to
//                    this browser first). The studio lands on Flows, Flow map, with that flow chosen and the
//                    Back to funnel banner; Back to funnel lands on the canvas with the step selected and
//                    focus on the button that left
//   states-mixed     (fix round) only the postal address read and the audience read fail: Sending says
//                    the postal address failure in its one alert with a Retry named for it, Save Postal
//                    Footer says POSTAL_NOT_SAVED and posts nothing, and once the read answers Retry loads it
//                    and Save posts once; Texts says the phone count failure in its one alert, and its Retry
//                    counts the phones once the audience answers
//   states-401       (Wave 6, D6) a fresh context whose studio reads all answer 401, as requireUser answers a
//                    signed-out reader: on every screen (All flows, People in starter flows, Flow map, All
//                    broadcasts, People, Sign-up forms, Replies, Open checkouts, Results, Sending, Klaviyo, Texts)
//                    the screen's sign-in sentence is in an alert with no button to try again, and its empty
//                    sentence ("No replies have arrived for this account.", "No broadcasts yet. ...", "Not
//                    connected.") is not on screen; Replies, Sending and Texts each raise one alert for
//                    their one cause; no uncaught page error
//   states-500       the same walk with every studio read answering 500: each screen's failure sentence in an
//                    alert with a Retry named for it ("Retry: <failure>", retryLabel), no button named only
//                    Retry, Try again or Loading, and never its empty sentence; one alert on Replies, Sending
//                    and Texts; on Replies a Retry that fails again redraws the failure as a new node and
//                    keeps focus on Retry
//   states-unanswered the same walk with every studio read aborted (fetch rejects): each failure sentence says
//                    the server did not answer, with a named Retry, and never the empty sentence
//   states-empty     the same walk with every list answered and empty (the flow map holds only the starter,
//                    built-in and order flows): each screen says its empty sentence ("No flows of your own
//                    yet. ...", "Nothing has been sent yet, so there are no results.") and no screen draws a
//                    failure. The four states steps share nothing with the page above, so each one runs
//                    whatever an earlier step did
//   no-dash          the studio's visible text and its aria-label, placeholder and title values, read on
//                    every screen above, hold no em dash and no spaced en dash; on the Flows screens (All flows,
//                    Flow map) they never say the retired "letter" (D2); (Wave 6) on every states screen
//                    they say none of D2's retired words (studioVocabulary.ts), once the subjects and preview
//                    texts of the server's seeded flows are taken out (fix round: never their names)
//   runtime          no uncaught page error
//
// Usage: node scripts/email-studio-browser-check.mjs [--shots <dir>]
// Exit 0 pass, 1 a step failed, 2 could not run (Playwright or Chrome missing, the seeds could not be
// read, the build failed, the port could not be bound).
//
// Safety, as scripts/builder-browser-check.mjs: it never reads .env (Vite's envDir is an empty temp
// dir), never starts server.mjs, sets preview.proxy to {} so the preview forwards nothing, aborts every
// request that leaves the preview origin, builds into a temp dir it removes afterwards, and writes
// nothing inside the repo. It reads server.mjs as TEXT only, for the seeds and chainGraph.
//
// Every /api request the studio makes is answered AT THE ROUTE GUARD with recorded JSON in the real
// routes' shapes: the starter flows are INITIAL_DRIP_SEQUENCES, the built-in flows AUTOMATION_DEFAULTS
// and the order emails TRANSACTIONAL_DEFAULTS, all read out of server.mjs without booting it; the flow
// map rows are drawn by server.mjs's own chainGraph, the starter flows' rows by its own presentSequenceRow
// (with email-flow-content.mjs's isStarterDraft and starterFlowOn), and the order emails' rows by its own
// presentOrderEmailRow; the account flows are shopify-signals.mjs's
// starter flows and the triggers email-flows.mjs's TRIGGER_META. The flow-content and flows stubs
// record each body and keep what they saved in memory, the way the server keeps it per account. This
// proves the client. The server route is email-flow-content-route.test.mjs's.
//
// Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), CHROME_PATH, CHECK_STUDIO_PORT.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, preview } from 'vite';
import { routeVerdict } from '../src/lib/canvasCheckRules.ts';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from '../src/lib/defaultBlueprint.ts';
import { FLOW_MAP_UNREACHABLE, FLOW_MAP_WRITE_UNREACHABLE } from '../src/lib/flowMapLoad.ts';
import { FLOWS_EMPTY, FLOWS_FAILED, FLOWS_SIGN_IN } from '../src/lib/emailFlowsList.ts';
import {
  BROADCASTS_LIST, BROADCASTS_READ, FORMS_LIST, FORMS_READ, KLAVIYO_READ, PEOPLE_LIST, PEOPLE_READ, PHONES_READ, POSTAL_NOT_SAVED, POSTAL_READ,
  REPLIES_LIST, REPLIES_READ, RESULTS_LIST, RESULTS_READ, SENDING_READ, STARTER_PEOPLE_LIST, STARTER_PEOPLE_READ, TEXTS_READ, UNANSWERED_TAIL,
  retryLabel
} from '../src/lib/studioLoad.ts';
import { retiredIn } from '../src/lib/studioVocabulary.ts';
import { TRIGGER_META } from '../email-flows.mjs';
import { isStarterDraft, mergeAccountSteps, starterFlowOn } from '../email-flow-content.mjs';
import { signalStarterFlows } from '../shopify-signals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORAGE_KEY = 'jourvance_active_project';
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PINK = 'rgb(244, 114, 182)';
const WELCOME = 'drip_seq_default';
const NEW_SUBJECT = 'Welcome, from the studio check';
const NEW_PREVIEW = 'A preview line from the studio check';
const IMAGE_URL = 'https://images.example.test/studio-check.png';
const BUTTON_URL = 'https://shop.example.test/studio-check';
const SAVED_CONTENT = 'Saved. Every email sent from now on uses this version, including for people already in this flow.';
const SAVED_FLOW = 'Saved. It sends only after you turn it on, and each email only once it comes due.';
const SAVING_CONTENT = 'Saving these emails.';
const UNSAVED = 'Unsaved changes';
const UNHEARD_SUBJECT = 'A subject the server never hears about';
/** Wave 3: the one checkout the stub reports, and the step on the default journey that links a flow. */
const CHECKOUT_EMAIL = 'cart-check@example.test';
const SEQ_STEP = 'node-seq-1';
const STEP_FLOW = 'flow_viewedproduct';
const DESTINATIONS = ['Flows', 'Broadcasts', 'Audience', 'Results', 'Settings'];
/** Wave 4: the one hub flow the stub reports (export only), an order email edit, and the flow Delete is asked about. */
const HUB_FLOW_NAME = 'Hub welcome, kept for export';
const NEW_ORDER_SUBJECT = 'Order {{order_number}} is in, from the studio check';
const ORDER_BUTTON_URL = 'https://shop.example.test/order-check';
const DELETE_FLOW = 'flow_pricedrop';
/** Wave 4 fix round said this where a starter row's switch is now (Wave 2); it must be gone. */
const STARTER_NO_SWITCH = 'Always on. A starter flow cannot be turned off.';
/** Wave 2, D6: the step panel on a starter email the server marks as still the seeded draft (emailFlowsList.ts). */
const STARTER_DRAFT_NOTE = 'This email is still the starter draft, so it is skipped and not sent. Edit it and save to send it.';
const DRAFT_EDIT = 'Hey {{first_name}},\n\nThanks for joining. Here is the first real note, from the studio check.';
/** Wave 2 fix round: a row whose emails are still starter drafts, and what Turn off says for a starter flow (emailFlowsList.ts). */
const WELCOME_DRAFTS = '3 are still starter drafts, so they are not sent';
const starterOffSaid = name => `${name} is off. Nobody new joins it, and anyone already in it whose next email comes due while it is off leaves it, so turning it back on sends nothing they missed.`;
/** Wave 2 fix round: an enrollment and a checkout the sender stopped because their starter flow was off. */
const TAKEN_OUT_EMAIL = 'taken-out@example.test';
const STOPPED_CHECKOUT_EMAIL = 'cart-stopped@example.test';
/** The step panel's notes on a starter and on a built-in flow (server.mjs STARTER_FLOW_NOTE, BUILT_IN_FLOW_NOTE). */
const STARTER_FLOW_NOTE = 'This starter flow is shared by every account. Your edits to its emails apply to this account only.';
const BUILT_IN_FLOW_NOTE = 'This built-in flow is on this account only. You can edit its emails and waits here. Its steps and what starts it stay fixed. Turn it on or off from All flows.';
/** The flow-content route's refusals (EMAIL_STUDIO_PLAN.md Wave 1, item 3). */
const NOT_ON_ACCOUNT = 'That flow is not on this account.';
/** Wave 5: the broadcast composer. What the check writes, the one saved block, and what the stubs count. */
const BC_SUBJECT = 'Spring restock, from the studio check';
const BC_HEADING = 'Back in stock, from the studio check';
const BC_WORDS = 'The spring candles are back. Written in the broadcast builder by the studio check.';
const TEST_ADDRESS = 'me@example.test';
const SCHEDULE_AT = '2030-01-15T09:30';
const WHALES_COUNT = 3;
const LIBRARY_ROW = { id: 'lib_check', name: 'Studio check footer', block: { id: 'lib_check_b', kind: 'text', text: 'A saved footer, from the library' } };
const DRAFT_SAVED = 'Draft saved. It is under Drafts in All broadcasts, and nothing was sent.';
/** Fix round: BroadcastComposer.tsx's COMPOSER_REPLACE and the sentences the send guards and the stale preview say. */
const COMPOSER_REPLACE = 'Replace the broadcast you are writing? Changes that are not saved as a draft will be lost.';
const BLANK_EMAIL = 'Add words, a picture or a button to the email before sending.';
const AUDIENCE_UNLOADED = 'Who gets it could not be loaded, so nothing was sent.';
const PREVIEW_STALE = 'The email changed after this preview, so the preview is hidden.';
const PREVIEW_LABEL = 'Sample preview. The name and example product are samples.';
const VIP_SUBJECT = 'A thank-you to our most loyal clients';
/** emailRoutes.mjs GET /api/email/segments rows (counts the stub's own), and one list (GET /api/email/lists). */
const STUB_SEGMENTS = [
  { id: 'all', name: 'All marketing', description: 'Accepts marketing, and is not suppressed or unsubscribed.', definition: 'Accepts marketing, and is not suppressed or unsubscribed.', count: 7, filterKey: 'all', builtin: true },
  { id: 'whales', name: 'VIP Whales (Platinum)', description: 'Recorded spend is at least $500.', definition: 'Recorded spend is at least $500.', count: WHALES_COUNT, filterKey: 'whales', builtin: true },
  { id: 'at_risk', name: 'At-Risk Inactive Clients', description: 'Inactive for 90+ days without a purchase.', definition: 'Inactive for 90+ days without a purchase.', count: 2, filterKey: 'at_risk', builtin: true }
];
const STUB_LISTS = [{ id: 'list_check', name: 'Studio check list', createdAt: '2026-10-01T00:00:00.000Z', count: 2 }];
const STEPS_CHANGED = "These emails could not be saved, because the flow's steps changed. Reload it and try again.";
/** Wave 6: the Flows list intro (EmailFlowsList.tsx), now that a starter flow can be turned off. */
const FLOWS_INTRO = 'A starter flow takes every new lead or checkout until you turn it off.';
/** Wave 6: HubEmailSuite.tsx's Open checkouts sentences (checkoutsFailure and the empty line). */
const CHECKOUTS_EMPTY = 'No open checkouts yet. A checkout someone starts in your Shopify store and does not finish shows here.';

const say = line => console.log(line);

// ---- The seeds, read out of server.mjs as text (the way seeded-offers.test.mjs reads them) ----

function readSeeds() {
  const src = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
  const literal = name => {
    const start = src.indexOf(`const ${name} = [`);
    const end = src.indexOf('\n];\n', start);
    if (start < 0 || end < start) throw new Error(`server.mjs does not define ${name}`);
    return src.slice(src.indexOf('[', start), end + 2);
  };
  const fn = name => {
    const start = src.indexOf(`function ${name}(`);
    const end = src.indexOf('\nfunction ', start + 1);
    if (start < 0 || end < start) throw new Error(`server.mjs does not define function ${name}`);
    return src.slice(start, end);
  };
  // server.mjs block(): the only helper the two program seeds call.
  const block = (id, kind, text, extra) => ({ id, kind, text: text || '', ...(extra || {}) });
  const sequences = new Function(`return ${literal('INITIAL_DRIP_SEQUENCES')}`)().filter(seq => !seq.userId);
  const automations = new Function('block', `return ${literal('AUTOMATION_DEFAULTS')}`)(block);
  const transactional = new Function('block', `return ${literal('TRANSACTIONAL_DEFAULTS')}`)(block);
  const chainGraph = new Function(`${fn('chainGraph')}\nreturn chainGraph;`)();
  // Wave 4: an order email's flow-map row, drawn by server.mjs's own presenter and trigger table.
  const triggersAt = src.indexOf('const ORDER_EMAIL_TRIGGERS = {');
  if (triggersAt < 0) throw new Error('server.mjs does not define ORDER_EMAIL_TRIGGERS');
  const orderTriggers = src.slice(triggersAt, src.indexOf('\n', triggersAt));
  const presentOrderEmailRow = new Function(`${fn('chainGraph')}\n${orderTriggers}\n${fn('presentOrderEmailRow')}\nreturn presentOrderEmailRow;`)();
  // Wave 2: a starter flow's row, drawn by server.mjs's own presenter over an account bag, with its notes.
  const notesAt = src.indexOf('// D3: what the step panel says');
  const notesEnd = src.indexOf('\n// A starter flow (a shared drip sequence)', notesAt);
  if (notesAt < 0 || notesEnd < notesAt) throw new Error('server.mjs does not define the step panel notes before presentSequenceRow');
  // chainGraph alone, to its closing brace: fn() runs on to the next function and would bring the notes twice.
  const chainAt = src.indexOf('function chainGraph(');
  const chainOnly = src.slice(chainAt, src.indexOf('\n}\n', chainAt) + 3);
  const presentSequenceRow = new Function('mergeAccountSteps', 'isStarterDraft', 'starterFlowOn',
    `${chainOnly}\n${fn('sequenceStepsFor')}\n${src.slice(notesAt, notesEnd)}\n${fn('presentSequenceRow')}\nreturn presentSequenceRow;`)(mergeAccountSteps, isStarterDraft, starterFlowOn);
  if (!sequences.some(seq => seq.id === WELCOME)) throw new Error(`the seeds have no ${WELCOME}`);
  return { sequences, automations, transactional, chainGraph, presentOrderEmailRow, presentSequenceRow };
}

// ---- Recorded answers for the studio's routes ----

/** server.mjs cleanSteps, for a seed that has not been edited: the shape the bag holds. */
const programSteps = steps => steps.map((step, i) => ({
  id: String(step.id || `step_${i + 1}`),
  delayHours: Math.max(0, Math.min(2160, Number(step.delayHours) || 0)),
  subject: String(step.subject || 'A note from the store'),
  previewText: String(step.previewText || ''),
  blocks: step.blocks
}));

/** The account's memory: what each stub saved, and what each write carried. */
function newState(seeds) {
  const flows = signalStarterFlows().map(flow => ({ ...flow, enabled: false }));
  return {
    seeds,
    accountSequences: {},
    // Wave 2: the starter flows this account turned off, by id.
    starterOff: {},
    automationSteps: Object.fromEntries(seeds.automations.map(row => [row.id, programSteps(row.steps)])),
    automationEnabled: {},
    // Each order email as the account's program record holds it: off, with the seed's subject and blocks.
    orderEmails: Object.fromEntries(seeds.transactional.map(row => [row.id, { enabled: false, subject: row.subject, blocks: row.blocks }])),
    flows,
    contentMode: 'answer',
    // A promise the flow-content answer waits on, so a step can look at the page while it is open.
    contentHold: null,
    contentPosts: [],
    contentAborted: [],
    flowPosts: [],
    // A promise an account flow's save waits on (POST /api/email/flows/:id), and each New flow's body.
    flowHold: null,
    creates: [],
    programPosts: [],
    previewPosts: [],
    deletes: [],
    tickPosts: 0,
    // Wave 5: the broadcast drafts the stub keeps, and every broadcast write.
    drafts: [],
    draftPosts: [],
    draftDeletes: [],
    campaignPosts: [],
    // Fix round: 'abort' drops a campaign/send after recording it; 'fail' answers the segments read 500.
    campaignMode: 'answer',
    segmentsMode: 'answer',
    testSends: [],
    lintPosts: [],
    answered: []
  };
}

/** server.mjs sequenceStepsFor: the shared steps, with this account's content laid over them by id. */
function sequenceSteps(state, seq) {
  const own = state.accountSequences[seq.id] || [];
  return seq.steps.map(step => {
    const row = own.find(item => item.id === step.id);
    return row ? { ...step, subject: row.subject, previewText: row.previewText, blocks: row.blocks, delayHours: row.delayHours } : step;
  });
}

/** server.mjs presentSequenceRow over this account's bag: its own emails and whether it turned the flow off. */
const sequenceRow = (state, seq) => state.seeds.presentSequenceRow(seq, {
  sequences: { [seq.id]: { steps: state.accountSequences[seq.id] || [], ...(state.starterOff[seq.id] ? { enabled: false } : {}) } }
});

const automationRow = (state, row) => ({
  id: row.id, name: row.name, kind: 'automation', editable: false, contentEditable: true, enabled: state.automationEnabled[row.id] === true,
  trigger: row.trigger, ...state.seeds.chainGraph(row.id, state.automationSteps[row.id]), note: BUILT_IN_FLOW_NOTE
});

/** An order email as the flow map draws it: server.mjs's presentOrderEmailRow over this account's record. */
const orderRow = (state, row) => state.seeds.presentOrderEmailRow({ ...row, ...state.orderEmails[row.id] });

/** server.mjs presentCustomFlow, for an account with no sends yet. */
const customRow = flow => ({
  id: flow.id, name: flow.name, kind: 'flow', editable: true, enabled: flow.enabled === true, trigger: flow.trigger,
  quietAfterDays: flow.quietAfterDays || null, reentry: flow.reentry || 'once', reentryDays: flow.reentryDays || 30,
  exitOnOrder: flow.exitOnOrder === true, dateField: '', dateOffsetDays: 0, dateRepeat: 'once', lookbackDays: flow.lookbackDays || null,
  dropMode: flow.dropMode || '', dropValue: flow.dropValue ?? null, stockThreshold: flow.stockThreshold || null,
  stockMinimum: flow.stockMinimum || null, variantId: flow.variantId || '', klaviyoFlowId: '', nodes: flow.nodes, edges: flow.edges,
  // enrolled: email-map.mjs enrollmentCount answers null, not 0, while nobody has joined.
  sunset: flow.sunset === true, enrolled: null, note: (flow.notes || []).join(' '), stats: null, active: 0,
  stepCount: flow.nodes.filter(node => node.type === 'email' || node.type === 'sms').length, compileError: ''
});

/**
 * The flow-content route's walk (EMAIL_STUDIO_PLAN.md item 1, stepsFromChain): from the trigger along
 * single edges, each email takes the next base step in order, a wait before it gives its delayHours,
 * and anything else, a branch, a cycle or a different email count is refused.
 */
function stepsFromChain(body, baseSteps) {
  const nodes = Array.isArray(body?.nodes) ? body.nodes : [];
  const edges = Array.isArray(body?.edges) ? body.edges : [];
  let at = nodes.find(node => node.type === 'trigger');
  if (!at) return null;
  const seen = new Set([at.id]);
  const steps = [];
  let wait = 0;
  for (;;) {
    const out = edges.filter(edge => edge.source === at.id);
    if (!out.length) break;
    if (out.length > 1) return null;
    const next = nodes.find(node => node.id === out[0].target);
    if (!next || seen.has(next.id)) return null;
    seen.add(next.id);
    if (next.type === 'delay') wait = Number(next.delayHours) || 0;
    else if (next.type === 'email') {
      const base = baseSteps[steps.length];
      if (!base) return null;
      steps.push({ id: base.id, subject: String(next.subject || ''), previewText: String(next.previewText || ''), blocks: next.blocks || [], delayHours: wait });
      wait = 0;
    } else return null;
    at = next;
  }
  return steps.length === baseSteps.length ? steps : null;
}

/** Answers one studio route with recorded JSON, 'abort' for a request the check refuses on purpose, or false. */
function studioAnswer(req, u, state) {
  const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const p = u.pathname;
  const method = req.method();
  const { seeds } = state;
  state.answered.push(`${method} ${p}`);
  if (method === 'GET' && /^\/api\/journey\/[^/]+$/.test(p)) return json(200, { success: true, journey: null });
  // App's own read (server/routes/authWorkspaceRoutes.mjs): an account with no stored workspace yet.
  if (method === 'GET' && p === '/api/workspaces') return json(200, { success: true, workspaces: [] });
  if (method === 'GET' && p === '/api/email/flow-map') {
    return json(200, {
      success: true, hubConnected: true, timezone: '', triggers: TRIGGER_META,
      flows: [
        ...state.flows.map(customRow), ...seeds.automations.map(row => automationRow(state, row)), ...seeds.sequences.map(seq => sequenceRow(state, seq)),
        ...seeds.transactional.map(row => orderRow(state, row))
      ]
    });
  }
  const content = /^\/api\/email\/flow-content\/([^/]+)$/.exec(p);
  if (method === 'POST' && content) {
    if (state.contentMode === 'abort') {
      state.contentAborted.push(p);
      return 'abort';
    }
    const body = JSON.parse(req.postData() || '{}');
    state.contentPosts.push({ id: content[1], body });
    const seq = seeds.sequences.find(item => item.id === content[1]);
    const auto = seeds.automations.find(item => item.id === content[1]);
    const letter = seeds.transactional.find(item => item.id === content[1]);
    // An order email is one email with no wait; its subject and blocks are kept, as the route does.
    if (letter) {
      const own = state.orderEmails[letter.id];
      const steps = stepsFromChain(body, [{ id: letter.id, subject: own.subject, previewText: '', blocks: own.blocks, delayHours: 0 }]);
      if (!steps || steps[0].delayHours) return json(400, { success: false, error: STEPS_CHANGED });
      state.orderEmails[letter.id] = { ...own, subject: steps[0].subject.trim() || own.subject, blocks: steps[0].blocks };
      return json(200, { success: true, flow: orderRow(state, letter) });
    }
    if (!seq && !auto) return json(404, { success: false, error: NOT_ON_ACCOUNT });
    // Wave 2: { enabled } alone turns a starter flow on or off for this account; the emails stay.
    if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
      if (!seq || body.nodes !== undefined || typeof body.enabled !== 'boolean') return json(400, { success: false, error: 'This flow was not turned on or off.' });
      state.starterOff[seq.id] = body.enabled === false;
      return json(200, { success: true, flow: sequenceRow(state, seq) });
    }
    const steps = stepsFromChain(body, seq ? sequenceSteps(state, seq) : state.automationSteps[auto.id]);
    if (!steps) return json(400, { success: false, error: STEPS_CHANGED });
    if (seq) {
      state.accountSequences[seq.id] = steps;
      return json(200, { success: true, flow: sequenceRow(state, seq) });
    }
    state.automationSteps[auto.id] = steps;
    return json(200, { success: true, flow: automationRow(state, auto) });
  }
  // server.mjs POST /api/email/flows: a new flow, off, made with one email, first in the account's list.
  if (method === 'POST' && p === '/api/email/flows') {
    const body = JSON.parse(req.postData() || '{}');
    state.creates.push(body);
    const flow = {
      id: `flow_check${state.creates.length}`, name: String(body.name || 'New flow'), enabled: false, trigger: body.trigger || 'manual',
      nodes: [{ id: 'n_start', type: 'trigger' }, { id: 'n_mail', type: 'email', subject: 'A note from the store', blocks: [{ id: 'n_mail_b', kind: 'text', text: '' }] }],
      edges: [{ id: 'e_start', source: 'n_start', target: 'n_mail', branch: '' }]
    };
    state.flows.unshift(flow);
    return json(200, { success: true, flow: customRow(flow) });
  }
  const flowSave = /^\/api\/email\/flows\/([^/]+)$/.exec(p);
  if (method === 'POST' && flowSave) {
    const body = JSON.parse(req.postData() || '{}');
    state.flowPosts.push({ id: flowSave[1], body });
    const index = state.flows.findIndex(flow => flow.id === flowSave[1]);
    if (index < 0) return json(404, { success: false, error: NOT_ON_ACCOUNT });
    state.flows[index] = { ...state.flows[index], ...body, id: state.flows[index].id };
    return json(200, { success: true, flow: customRow(state.flows[index]) });
  }
  // server.mjs DELETE /api/email/flows/:id. Recorded, so a Delete that should have asked is seen.
  const flowDelete = /^\/api\/email\/flows\/([^/]+)$/.exec(p);
  if (method === 'DELETE' && flowDelete) {
    state.deletes.push(flowDelete[1]);
    state.flows = state.flows.filter(flow => flow.id !== flowDelete[1]);
    return json(200, { success: true });
  }
  // emailRoutes.mjs POST /api/email/programs/preview, the sample branch (its label is the route's own).
  if (method === 'POST' && p === '/api/email/programs/preview') {
    const body = JSON.parse(req.postData() || '{}');
    state.previewPosts.push(body);
    return json(200, {
      success: true, sample: true, label: 'Sample preview. The name and example product are samples.', subject: String(body.subject || ''),
      html: `<!doctype html><html><body><h1>Sample for the studio check</h1><p>${String(body.subject || '')}</p>${(Array.isArray(body.blocks) ? body.blocks : []).map(b => `<p>${String(b.text || b.label || '')}</p>`).join('')}</body></html>`, text: '', untranslated: [], hidden: 0
    });
  }
  // emailRoutes.mjs POST /api/email/programs/:id: Turn on and Turn off for a built-in flow or an order email.
  const program = /^\/api\/email\/programs\/([^/]+)$/.exec(p);
  if (method === 'POST' && program) {
    const body = JSON.parse(req.postData() || '{}');
    state.programPosts.push({ id: program[1], body });
    if (body.kind === 'automation' && seeds.automations.some(row => row.id === program[1])) state.automationEnabled[program[1]] = body.enabled === true;
    else if (body.kind !== 'automation' && state.orderEmails[program[1]]) state.orderEmails[program[1]].enabled = body.enabled === true;
    else return json(404, { success: false, error: 'That built-in flow is not on this account.' });
    return json(200, { success: true, suite: {} });
  }
  if (method === 'GET' && p === '/api/email/suite') {
    return json(200, {
      success: true,
      suite: {
        hubConnected: true, shopifyStillSends: true, postalAddress: '', timezone: '',
        installed: seeds.sequences.map(seq => ({ id: seq.id, name: seq.name, trigger: seq.triggerType, steps: seq.steps.length, source: 'drip' })),
        automations: seeds.automations.map(row => ({
          id: row.id, name: row.name, trigger: row.trigger, description: row.description, enabled: false,
          quietAfterDays: row.quietAfterDays || null, steps: state.automationSteps[row.id], activeEnrollments: 0
        })),
        transactional: seeds.transactional.map(row => ({
          id: row.id, name: row.name, shopifyNotification: row.shopifyNotification, shopifyTopic: row.shopifyTopic,
          enabled: false, subject: row.subject, blocks: row.blocks
        })),
        library: [LIBRARY_ROW]
      }
    });
  }
  if (method === 'GET' && p === '/api/drips/sequences') {
    return json(200, {
      success: true,
      sequences: seeds.sequences.map(seq => ({ ...seq, steps: sequenceSteps(state, seq), attributedSales: null })),
      revenueNote: 'Last-touch revenue uses a click within 5 days, or an open within 5 days when there is no click. Blank until one of those is stored.'
    });
  }
  // One person part way through a two-email starter flow, so the enrollment row's "Step N of M" is drawn.
  if (method === 'GET' && p === '/api/drips/enrollments') {
    const cart = seeds.sequences.find(seq => seq.steps.length === 2);
    return json(200, {
      success: true,
      enrollments: cart ? [{
        id: 'enr_check_1', sequenceId: cart.id, customerEmail: 'reader@example.test', currentStepIndex: 0, status: 'active',
        enrolledAt: '2026-10-01T00:00:00.000Z', nextStepDueAt: '2026-10-02T00:00:00.000Z', history: []
      }, {
        // Wave 2: the sender took this one out when its email came due while the flow was off.
        id: 'enr_check_2', sequenceId: cart.id, customerEmail: TAKEN_OUT_EMAIL, currentStepIndex: 0, status: 'stopped',
        stoppedReason: 'flow_off', stoppedAt: '2026-10-02T00:00:30.000Z',
        enrolledAt: '2026-10-01T00:00:00.000Z', nextStepDueAt: '2026-10-02T00:00:00.000Z', history: []
      }] : []
    });
  }
  // One hub flow (emailRoutes.mjs GET /api/email/flows, hub.email.flows.list's shape), so the export-only group is drawn.
  if (method === 'GET' && p === '/api/email/flows') {
    return json(200, {
      success: true,
      flows: [{ id: 'hub_flow_check', name: HUB_FLOW_NAME, category: 'welcome', active: true, steps: [{ type: 'email', subject: 'Hello from the hub', previewText: '', delay: 'Immediately', body: 'Kept on the hub.' }] }]
    });
  }
  if (method === 'GET' && p === '/api/email/broadcasts') return json(200, { success: true, broadcasts: [] });
  if (method === 'GET' && p === '/api/email/analytics') {
    return json(200, {
      success: true,
      analytics: {
        totalSent: 0, sent: 0, delivered: null, opened: null, clicked: null, unsubscribed: null, revenue: null, prefetchOpens: null,
        avgOpenRate: null, avgClickRate: null, deliveryRate: null, activeSubscribers: 0,
        windows: { emailClickDays: 5, emailOpenDays: 5, smsClickDays: 5 }, opensStored: true, windowNote: ''
      }
    });
  }
  if (method === 'GET' && p === '/api/email/audience') {
    return json(200, {
      success: true,
      rfmConfig: { atRiskDays: 90, lapsedDays: 180, vipSilver: 100, vipGold: 250, vipPlatinum: 500, coolingDays: 60, autoWinbackEnabled: false, allowUnlimitedDiscountUse: false },
      rfmSummary: { whales: 0, gold: 0, silver: 0, atRisk: 0, lapsed: 0, repeatBuyers: 0, totalBuyers: 0, leads: 0, totalContacts: 0 },
      subscribers: []
    });
  }
  if (method === 'GET' && p === '/api/email/segments') {
    if (state.segmentsMode === 'fail') return json(500, { success: false, error: 'The segments read failed in the studio check.' });
    return json(200, { success: true, totalAudience: 7, segments: STUB_SEGMENTS });
  }
  if (method === 'GET' && p === '/api/email/lists') return json(200, { success: true, lists: STUB_LISTS });
  // Wave 5: server/routes/broadcastDraftRoutes.mjs, kept in memory as the account's record keeps it.
  if (method === 'GET' && p === '/api/email/broadcast-drafts') return json(200, { success: true, drafts: state.drafts, limit: 20 });
  if (method === 'POST' && p === '/api/email/broadcast-drafts') {
    const body = JSON.parse(req.postData() || '{}');
    state.draftPosts.push(body);
    if (body.id && !state.drafts.some(d => d.id === body.id)) return json(404, { success: false, error: 'That draft is not on this account.' });
    const draft = {
      id: body.id || `bd_check${state.draftPosts.length}`, userId: 'check', subject: body.subject, previewText: body.previewText,
      blocks: body.blocks, settings: body.settings, updatedAt: '2026-10-08T12:00:00.000Z'
    };
    state.drafts = [draft, ...state.drafts.filter(d => d.id !== draft.id)];
    return json(200, { success: true, draft, drafts: state.drafts, limit: 20 });
  }
  const draftDelete = /^\/api\/email\/broadcast-drafts\/([^/]+)$/.exec(p);
  if (method === 'DELETE' && draftDelete) {
    state.draftDeletes.push(draftDelete[1]);
    if (!state.drafts.some(d => d.id === draftDelete[1])) return json(404, { success: false, error: 'That draft is not on this account.' });
    state.drafts = state.drafts.filter(d => d.id !== draftDelete[1]);
    return json(200, { success: true, drafts: state.drafts, limit: 20 });
  }
  // emailRoutes.mjs POST /api/email/campaign/send: a scheduled send is saved and nothing goes out.
  if (method === 'POST' && p === '/api/email/campaign/send') {
    const body = JSON.parse(req.postData() || '{}');
    state.campaignPosts.push(body);
    if (state.campaignMode === 'abort') return 'abort';
    return json(200, body.when === 'now'
      ? { success: true, recipientCount: WHALES_COUNT, message: `Sent to ${WHALES_COUNT} recipients.` }
      : { success: true, recipientCount: 0, message: 'Scheduled. Nothing was sent.' });
  }
  // server.mjs POST /api/email/send (a test), and POST /api/email/lint (hub.email.lint's { score, warnings, checks }).
  if (method === 'POST' && p === '/api/email/send') {
    state.testSends.push(JSON.parse(req.postData() || '{}'));
    return json(200, { success: true, sent: { success: true } });
  }
  if (method === 'POST' && p === '/api/email/lint') {
    state.lintPosts.push(JSON.parse(req.postData() || '{}'));
    return json(200, { success: true, score: 92, warnings: ['Add a plain text version.'], checks: [{ id: 'unsub', label: 'Unsubscribe link', level: 'pass' }] });
  }
  // One open checkout (shopifyRoutes.mjs, loadCheckouts' shape), so Audience, Open checkouts draws its table.
  if (method === 'GET' && /^\/api\/workspace\/[^/]+\/shopify\/abandoned-checkouts$/.test(p)) {
    return json(200, {
      success: true,
      checkouts: [{
        id: 'chk_check_1', userId: 'check', customerEmail: CHECKOUT_EMAIL, totalPrice: 42.5, currency: 'USD',
        lineItems: [{ title: 'Studio check candle', quantity: 1, price: 42.5 }], recoveryStatus: 'pending',
        abandonedCheckoutUrl: 'https://shop.example.test/checkouts/check', createdAt: '2026-10-01T00:00:00.000Z'
      }, {
        // Wave 2: stopped by the sender because this account turned Cart recovery off.
        id: 'chk_check_2', userId: 'check', customerEmail: STOPPED_CHECKOUT_EMAIL, totalPrice: 18, currency: 'USD',
        lineItems: [{ title: 'Studio check matches', quantity: 1, price: 18 }], recoveryStatus: 'stopped', stoppedReason: 'flow_off',
        abandonedCheckoutUrl: 'https://shop.example.test/checkouts/stopped', createdAt: '2026-10-01T00:00:00.000Z'
      }]
    });
  }
  // server.mjs POST /api/drips/process-tick: processUserAutomationsTick's summary for an account with nothing due.
  if (method === 'POST' && p === '/api/drips/process-tick') {
    state.tickPosts += 1;
    return json(200, { success: true, processedCount: 0, convertedExitCount: 0, activeRemaining: 1 });
  }
  if (method === 'GET' && p === '/api/email/predictions') {
    return json(200, { success: true, ready: false, orders: 0, repeatCustomers: 0, historyDays: null, method: null, sampleSize: null, storeGapDays: null, computedAt: null, missing: 'This account has no orders yet.' });
  }
  if (method === 'GET' && p === '/api/klaviyo') return json(200, { success: true, klaviyo: { connected: false, keyOnFile: false, sendWith: 'jourvance', flows: [] } });
  state.answered.pop();
  return false;
}

// ---- Wave 6: the studio's reads answered one way, for the states steps ----

/** The studio's own GETs. The app shell's reads (the journey, the workspaces) and every write stay as studioAnswer answers them. */
const STATE_READS = [/^\/api\/email\//, /^\/api\/drips\//, /^\/api\/sms\//, /^\/api\/klaviyo$/, /^\/api\/workspace\/[^/]+\/shopify\/abandoned-checkouts$/];

/** What each studio list answers in the states-empty step: a list the server read, holding nothing. */
const EMPTY_ANSWERS = {
  '/api/email/flows': { success: true, flows: [] },
  '/api/email/broadcasts': { success: true, broadcasts: [], followUpNote: '' },
  '/api/email/analytics': {
    success: true,
    analytics: {
      totalSent: 0, sent: 0, delivered: null, opened: null, clicked: null, unsubscribed: null, revenue: null, prefetchOpens: null,
      avgOpenRate: null, avgClickRate: null, deliveryRate: null, activeSubscribers: 0,
      windows: { emailClickDays: 5, emailOpenDays: 5, smsClickDays: 5 }, opensStored: true, windowNote: ''
    }
  },
  '/api/email/audience': {
    success: true,
    rfmConfig: { atRiskDays: 90, lapsedDays: 180, vipSilver: 100, vipGold: 250, vipPlatinum: 500, coolingDays: 60, autoWinbackEnabled: false, allowUnlimitedDiscountUse: false },
    rfmSummary: { whales: 0, gold: 0, silver: 0, atRisk: 0, lapsed: 0, repeatBuyers: 0, totalBuyers: 0, leads: 0, totalContacts: 0 },
    subscribers: []
  },
  '/api/email/segments': { success: true, totalAudience: 0, segments: [] },
  '/api/email/lists': { success: true, lists: [] },
  '/api/drips/sequences': { success: true, sequences: [], revenueNote: '' },
  '/api/drips/enrollments': { success: true, enrollments: [] },
  '/api/email/inbox': { success: true, messages: [], counts: {} },
  '/api/email/inbox/policy': { success: true, policy: { autopilot: 'off' } },
  '/api/sms/status': { success: true, configured: false, live: false },
  '/api/email/forms': { success: true, forms: [], hubForms: [], hubError: '', hubConnected: true },
  '/api/klaviyo': { success: true, klaviyo: { connected: false, keyOnFile: false, sendWith: 'jourvance', flows: [] } },
  '/api/email/senders': { success: true, senders: [] },
  '/api/email/inbound': { success: true, receiving: false },
  '/api/email/events-webhook': { success: true },
  '/api/email/live': { success: true, blocks: [] },
  '/api/email/broadcast-drafts': { success: true, drafts: [], limit: 20 }
};

/**
 * One studio GET, answered as `mode` says: '401' as requireUser answers a signed-out reader, '500' a
 * server error, 'unanswered' aborted (fetch rejects), 'empty' each list read and empty. The flow map's
 * empty answer is the real one for an account with no flow of its own: the starter, built-in and
 * order flows every account has.
 */
function statesAnswer(mode, req, u, state) {
  const p = u.pathname;
  if (req.method() !== 'GET' || !STATE_READS.some(re => re.test(p))) return studioAnswer(req, u, state);
  const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  state.answered.push(`GET ${p} (${mode})`);
  if (mode === 'unanswered') return 'abort';
  if (mode === '401') return json(401, { success: false, error: 'Sign in to continue.' });
  if (mode === '500') return json(500, { success: false, error: 'The studio check answered 500.' });
  // states-mixed: only these reads fail (while state.mixedFails still holds them); the rest answer as empty.
  if (mode === 'mixed' && (state.mixedFails || []).includes(p)) return json(500, { success: false, error: 'The studio check answered 500.' });
  if (Object.prototype.hasOwnProperty.call(EMPTY_ANSWERS, p)) return json(200, EMPTY_ANSWERS[p]);
  if (/\/shopify\/abandoned-checkouts$/.test(p)) return json(200, { success: true, checkouts: [] });
  return studioAnswer(req, u, state) || json(200, { success: true });
}

// ---- Plumbing (as builder-browser-check.mjs) ----

function parseArgs(argv) {
  const opts = { shots: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--shots') opts.shots = path.resolve(argv[++i] ?? '');
    else throw new Error(`Unknown argument ${argv[i]}.`);
  }
  return opts;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitUntil(fn, ms, every = 100) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) return null;
    await new Promise(r => setTimeout(r, every));
  }
}

// ---- Facts read in the page ----

/** The focused element: its tag, text, accessible label, and the flow it opens when it is a Flows list row. */
const focused = page => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim(), label: el.getAttribute('aria-label') || '', row: el.getAttribute('data-flow-row') || '' } : null;
});

/** The border of one step on the map (the node's own drawn box). */
const nodeBorder = (page, id) => page.evaluate(nodeId => {
  const box = document.querySelector(`.react-flow__node[data-id="${nodeId}"] > div`);
  if (!box) return null;
  const cs = getComputedStyle(box);
  return { color: cs.borderTopColor, width: cs.borderTopWidth };
}, id);

/** The studio's root (the scroller the title sits in): its visible text, then every aria-label, placeholder and title in it. */
const studioText = page => page.evaluate(() => {
  const h1 = [...document.querySelectorAll('h1')].find(h => /Email Studio/.test(h.textContent || ''));
  let root = h1;
  while (root && root.parentElement && getComputedStyle(root).overflowY !== 'auto') root = root.parentElement;
  if (!root) return '';
  const said = [...root.querySelectorAll('[aria-label], [placeholder], [title]')]
    .flatMap(el => ['aria-label', 'placeholder', 'title'].map(name => el.getAttribute(name)).filter(Boolean));
  return `${root.innerText}\n${said.join('\n')}`;
});

/** Where one element sits against the viewport: on screen means its whole box is inside it. */
const boxOf = (page, selector, text) => page.evaluate(([sel, want]) => {
  const el = [...document.querySelectorAll(sel)].find(e => want == null || (e.textContent || '').trim() === want);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), viewport: window.innerHeight, onScreen: r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight };
}, [selector, text ?? null]);

/** The text of every status region on the page. */
const statusTexts = page => page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map(el => (el.textContent || '').trim()));

/** The chosen flow in the editor: the option the "Flow to edit" picker shows (Wave 4; it was a second list). */
const chosenFlow = page => page.evaluate(() => {
  const picker = document.getElementById('flow-picker');
  if (!picker) return null;
  return (picker.selectedOptions[0]?.textContent || '').trim();
});

/**
 * The rows of the Flows list as drawn: each row button's name (the element its aria-labelledby names),
 * its description (the elements its aria-describedby names, joined), the group it sits in and the flow
 * it opens. Wave 4: one row per flow, each one button.
 */
const flowRowsOnPage = page => page.evaluate(() => [...document.querySelectorAll('[data-flow-row]')].map(button => {
  const text = attr => (button.getAttribute(attr) || '').split(/\s+/).filter(Boolean).map(id => (document.getElementById(id)?.textContent || '').trim()).join(' | ');
  const list = button.closest('ul');
  return {
    id: button.getAttribute('data-flow-row'),
    name: text('aria-labelledby'),
    meta: text('aria-describedby'),
    group: list ? (list.getAttribute('aria-label') || document.getElementById(list.getAttribute('aria-labelledby') || '')?.textContent || '').trim() : '',
    visible: button.getBoundingClientRect().height > 0
  };
}));

/** The box of the editor's map and of its step panel (EmailFlowMap data-flow-map). */
const editorBoxes = page => page.evaluate(() => {
  const box = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
  };
  // The map's steps that are drawn past its left or right edge (fitted to another width, they are cut off).
  const mapBox = document.querySelector('[data-flow-map="map"]')?.getBoundingClientRect();
  const steps = [...document.querySelectorAll('[data-flow-map="map"] .react-flow__node')].map(el => ({ id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }));
  const outside = mapBox ? steps.filter(({ r }) => r.left < mapBox.left - 0.5 || r.right > mapBox.right + 0.5).map(({ id, r }) => `${id} ${Math.round(r.left)}..${Math.round(r.right)}`) : [];
  return { map: box('[data-flow-map="map"]'), panel: box('[data-flow-map="panel"]'), page: document.documentElement.scrollWidth, width: window.innerWidth, steps: steps.length, outside };
});

/**
 * One tablist, found by its aria-label: its tabs' names, the selected ones, the Tab stops, and the tabs
 * whose aria-controls does not name a tabpanel labelled by that tab. Null when there is no such list.
 */
const tablist = (page, label) => page.evaluate(name => {
  const list = [...document.querySelectorAll('[role="tablist"]')].find(l => l.getAttribute('aria-label') === name);
  if (!list) return null;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const nameOf = t => (t.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    names: tabs.map(nameOf),
    selected: tabs.filter(t => t.getAttribute('aria-selected') === 'true').map(nameOf),
    stops: tabs.filter(t => t.tabIndex === 0).map(nameOf),
    unlinked: tabs.filter(t => {
      const panel = document.getElementById(t.getAttribute('aria-controls') || '');
      return !panel || panel.getAttribute('role') !== 'tabpanel' || panel.getAttribute('aria-labelledby') !== t.id;
    }).map(nameOf)
  };
}, label);

/** The focused tab: its name, the tablist it is in, and the selected tab of that list. */
const focusedTab = page => page.evaluate(() => {
  const el = document.activeElement;
  const list = el && el.closest('[role="tablist"]');
  const nameOf = t => (t.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    focus: el && el.getAttribute('role') === 'tab' ? nameOf(el) : `${el ? el.tagName.toLowerCase() : 'none'} "${el ? nameOf(el).slice(0, 30) : ''}"`,
    list: list ? list.getAttribute('aria-label') : '',
    selected: list ? [...list.querySelectorAll('[role="tab"][aria-selected="true"]')].map(nameOf) : []
  };
});

/** When focus is on a tabpanel itself, the id of the tab that labels it; otherwise the focused tag. */
const focusedPanel = page => page.evaluate(() => {
  const el = document.activeElement;
  if (el && el.getAttribute('role') === 'tabpanel') return el.getAttribute('aria-labelledby');
  return `${el ? el.tagName.toLowerCase() : 'none'} "${el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) : ''}"`;
});

/** Controls in the studio that stick out past either edge, and whether the studio or the page scrolls sideways. */
const studioPastEdge = page => page.evaluate(() => {
  const w = window.innerWidth;
  const h1 = [...document.querySelectorAll('h1')].find(h => /Email Studio/.test(h.textContent || ''));
  let root = h1;
  while (root && root.parentElement && getComputedStyle(root).overflowY !== 'auto') root = root.parentElement;
  const bad = [];
  let seen = 0;
  for (const el of root.querySelectorAll('button, input, select, textarea, a[href], [role="group"]')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.closest('.react-flow__viewport')) continue;
    seen++;
    if (r.left < -0.5 || r.right > w + 0.5) bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  return { bad, seen, width: w, pageScroll: document.documentElement.scrollWidth, studioScroll: root.scrollWidth, studioClient: root.clientWidth };
});

// ---- The run ----

async function runChecks(browser, origin, shots, blocked, seeds) {
  // The Welcome starter flow's name as server.mjs seeds it ("Welcome flow"; "Welcome sequence" until D2).
  const WELCOME_NAME = seeds.sequences.find(s => s.id === WELCOME).name;
  const results = [];
  const state = newState(seeds);
  const texts = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', async route => {
    const req = route.request();
    if (routeVerdict(req.url(), origin) === 'continue') return route.continue();
    try {
      const u = new URL(req.url());
      if (u.origin === origin) {
        const answer = studioAnswer(req, u, state);
        if (answer === 'abort') return route.abort();
        // A held flow-content answer: the body is recorded already, the reply waits for the step.
        if (answer && state.contentHold && req.method() === 'POST' && u.pathname.startsWith('/api/email/flow-content/')) await state.contentHold;
        if (answer && state.flowHold && req.method() === 'POST' && /^\/api\/email\/flows\/[^/]+$/.test(u.pathname)) await state.flowHold;
        if (answer) return route.fulfill(answer);
      }
    } catch {}
    blocked.push(`${req.method()} ${req.url().slice(0, 100)}`);
    return route.abort();
  });
  await context.addInitScript(([key, value]) => {
    // The page only: a sandboxed preview iframe (an order email's Preview sample) refuses storage.
    if (window.top !== window) return;
    if (sessionStorage.getItem('jv-studio-check-seeded')) return;
    sessionStorage.setItem('jv-studio-check-seeded', '1');
    localStorage.setItem(key, value);
  }, [STORAGE_KEY, JSON.stringify(DEFAULT_LEAD_CAPTURE_PROJECT)]);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', err => errors.push(String(err?.message || err)));
  // Every dialog is answered Cancel, and its message kept, except the one after acceptNextDialog is set.
  const dialogs = [];
  let acceptNextDialog = false;
  page.on('dialog', d => {
    dialogs.push(d.message());
    if (acceptNextDialog) {
      acceptNextDialog = false;
      d.accept().catch(() => {});
      return;
    }
    d.dismiss().catch(() => {});
  });

  const shot = async name => {
    if (!shots) return;
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
  };
  const keepText = async where => texts.push({ where, text: await studioText(page) });

  const step = async (name, fn) => {
    try {
      const notes = await fn();
      results.push({ name, ok: true, notes: notes || '' });
      say(`ok    ${name}${notes ? `: ${notes}` : ''}`);
      return true;
    } catch (err) {
      results.push({ name, ok: false, notes: String(err?.message || err) });
      say(`FAIL  ${name}: ${String(err?.message || err).split('\n')[0]}`);
      // A Playwright timeout's first line names no target: print the end of its call log, which says what
      // was waited on and why it never became clickable.
      if (/Timeout \d+ms exceeded/.test(String(err?.message || ''))) {
        for (const line of String(err.message).split('\n').map(l => l.trim()).filter(Boolean).slice(1).slice(-4)) say(`      ${line.slice(0, 240)}`);
      }
      await shot(`failed-${name}`).catch(() => {});
      return false;
    }
  };
  const expect = (cond, message) => {
    if (!cond) throw new Error(message);
  };
  const ran = [];
  const go = async (name, fn) => {
    if (ran.length && ran[ran.length - 1] === false) {
      results.push({ name, ok: false, notes: 'not run: an earlier step failed' });
      say(`skip  ${name}: not run, an earlier step failed`);
      ran.push(false);
      return;
    }
    ran.push(await step(name, fn));
  };

  const tab = name => page.getByRole('tab', { name, exact: true });
  /** True when the tab with this name is the selected one in its tablist. */
  const isSelected = async name => (await tab(name).getAttribute('aria-selected')) === 'true';
  // Flows, then its All flows section: the screen the Automations tab was before Wave 3.
  const toFlowList = async () => {
    await tab('Flows').click();
    await tab('All flows').click();
    await page.getByText(FLOWS_INTRO, { exact: false }).first().waitFor({ state: 'visible' });
    // Wave 4: the rows come from the list's own read, after its intro is drawn.
    await page.locator('[data-flow-row]').first().waitFor({ state: 'visible' });
    const settled = (await isSelected('Flows')) && (await isSelected('All flows')) && !(await isSelected('Flow map'));
    if (!settled) throw new Error(`after Flows, All flows the tabs read Flows ${await isSelected('Flows')}, All flows ${await isSelected('All flows')}, Flow map ${await isSelected('Flow map')}`);
  };
  const stepHeading = async text => waitUntil(async () => {
    const f = await focused(page);
    return f && f.tag === 'h3' && f.text === text ? f : null;
  }, 5000);
  const content = () => page.getByRole('group', { name: 'Email content' });
  /**
   * Focuses one map step in the page, at once. Right after a selection the map is drawn again, and a
   * step React Flow has not measured is hidden and refuses focus: every step blanked for a frame until
   * each node carried its last measured size (EmailFlowMap nodeSizes). One try, so that comes back red.
   */
  const focusNode = async id => {
    const t = await page.evaluate(nodeId => {
      const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
      const visibility = el ? getComputedStyle(el).visibility : 'missing';
      el?.focus();
      return { ok: !!el && document.activeElement === el && el.tabIndex === 0, visibility };
    }, id);
    expect(t.ok, `the map step ${id} did not take focus at once: ${JSON.stringify(t)}`);
    return `${id} took focus at once (visibility ${t.visibility})`;
  };
  const saveButton = () => page.getByRole('button', { name: 'Save', exact: true });
  /** Chooses a flow in the editor's picker (Wave 4: it was a button in a second list on the map). */
  const pickFlow = name => page.getByLabel('Flow to edit', { exact: true }).selectOption({ label: name });
  /** The All flows row that opens one flow: one button, named by the flow. */
  const flowRow = name => page.getByRole('button', { name, exact: true });
  /** One row of the Flows list as drawn, by the flow's name. */
  const rowOf = async name => (await flowRowsOnPage(page)).find(row => row.name === name) || null;

  await go('open', async () => {
    await page.goto(`${origin}/canvas`);
    const studio = page.getByRole('button', { name: 'Switch to Email Studio view' });
    await studio.waitFor({ state: 'visible', timeout: 20000 });
    await studio.click();
    const heading = page.getByRole('heading', { level: 1, name: /Email Studio/ });
    await heading.waitFor({ state: 'visible', timeout: 15000 });
    await page.getByText(FLOWS_INTRO, { exact: false }).first().waitFor({ state: 'visible' });
    await keepText('All flows');
    await shot('1-studio-open');
    return `"${(await heading.textContent()).trim()}" is visible and All flows is showing`;
  });

  await go('counts', async () => {
    // Wave 4: the starter cards' "Completed all N emails" went with the cards. Each row counts the
    // emails of its own flow from its steps, and the one people table counts an enrollment's step
    // against its own flow, never a literal 3.
    const notes = [];
    for (const seq of seeds.sequences) {
      const row = await rowOf(seq.name);
      const want = seq.steps.length === 1 ? '1 email' : `${seq.steps.length} emails`;
      expect(row, `no All flows row for ${seq.name}`);
      expect(row.meta.includes(` · ${want}`), `${seq.name}'s row reads "${row.meta}", not "${want}"`);
      notes.push(`${seq.name}: ${want}`);
    }
    const group = page.getByText('People in starter flows', { exact: true });
    await group.click();
    await page.getByRole('cell', { name: 'reader@example.test', exact: true }).waitFor({ state: 'visible' });
    const text = await studioText(page);
    expect(text.includes('Step 1 of 2'), 'the people table does not say "Step 1 of 2" for the two-email flow');
    expect(!/Completed 3-Steps|Step \d+ of 3\b/.test(text.replace(/Email \d+ of 3/g, '')), 'a literal 3 is still counted');
    // Wave 2 fix: each person's status cell reads what the sender did, and a stopped one is never "In the flow".
    const statusOf = email => page.evaluate(address => {
      const row = [...document.querySelectorAll('tr')].find(tr => (tr.cells[0]?.textContent || '').trim() === address);
      return row ? (row.cells[3]?.textContent || '').trim() : null;
    }, email);
    const active = await statusOf('reader@example.test');
    const takenOut = await statusOf(TAKEN_OUT_EMAIL);
    expect(active === 'In the flow', `the active enrollment's status reads ${JSON.stringify(active)}`);
    expect(takenOut === 'Taken out, flow turned off', `the enrollment taken out because its flow was off reads ${JSON.stringify(takenOut)}`);
    await group.click();
    return `the rows say ${notes.join(' | ')}; the people table says Step 1 of 2, "${active}" and "${takenOut}"`;
  });

  await go('flows-one-list', async () => {
    // Wave 4: one list. Each of the 12 flows and the 4 order emails is exactly one row, and one button
    // on the whole page; the order emails are their own group at the foot; the hub's flows are a
    // closed group under it and are not rows.
    const want = [...state.flows.map(f => f.name), ...seeds.automations.map(a => a.name), ...seeds.sequences.map(q => q.name), ...seeds.transactional.map(t => t.name)];
    expect(want.length === 16 && new Set(want).size === 16, `the stub has ${want.length} flows, ${new Set(want).size} names`);
    const rows = await flowRowsOnPage(page);
    const names = rows.map(r => r.name);
    const notOnce = want.filter(n => names.filter(x => x === n).length !== 1);
    expect(notOnce.length === 0, `not listed exactly once: ${notOnce.join(', ')}; the rows are ${names.join(', ')}`);
    expect(rows.length === 16, `${rows.length} rows, not 16: ${names.join(', ')}`);
    expect(rows.every(r => r.visible), `a row is not drawn: ${rows.filter(r => !r.visible).map(r => r.name).join(', ')}`);
    for (const name of want) {
      const count = await page.getByRole('button', { name, exact: true }).count();
      expect(count === 1, `${count} buttons on the page are named "${name}"`);
    }
    const orders = seeds.transactional.map(t => t.name);
    expect(JSON.stringify(rows.slice(-4).map(r => r.name)) === JSON.stringify(orders), `the last four rows are ${JSON.stringify(rows.slice(-4).map(r => r.name))}`);
    expect(rows.slice(-4).every(r => r.group === 'Order emails') && rows.slice(0, 12).every(r => r.group === 'Flows'), `groups: ${JSON.stringify(rows.map(r => r.group))}`);
    // One of each kind says its tag, its start in TRIGGER_META's words, On or Off, and its counted emails.
    const label = id => TRIGGER_META.find(t => t.id === id).label;
    const checks = [
      [WELCOME_NAME, ['Starter', `Starts when: ${label('lead_capture')}`, ' On ', '3 emails', ` ${WELCOME_DRAFTS} `, 'Enrolled Unavailable', 'Last-touch revenue Unavailable']],
      ['After the order', ['Built in', `Starts when: ${label('order_paid')}`, ' Off ', '2 emails', 'Enrolled Unavailable']],
      ['Order confirmation', ['Order email', `Starts when: ${label('order_paid')}`, ' Off ', '1 email']],
      ['Viewed a product', [`Starts when: ${label('product_viewed')}`, ' Off ', '1 email', 'Enrolled Unavailable']]
    ];
    for (const [name, parts] of checks) {
      const row = rows.find(r => r.name === name);
      const missing = parts.filter(part => !row.meta.includes(part.trim()) || (part.startsWith(' ') && !row.meta.includes(`·${part}·`)));
      expect(missing.length === 0, `${name}'s row reads "${row.meta}", without ${JSON.stringify(missing)}`);
    }
    expect(!rows.find(r => r.name === 'Viewed a product').meta.includes('|'), 'an account flow carries a tag');
    // Wave 2 fix: only Welcome's emails are still the starter drafts, so no other row says so.
    const saysDrafts = rows.filter(r => /starter draft/.test(r.meta)).map(r => r.name);
    expect(JSON.stringify(saysDrafts) === JSON.stringify([WELCOME_NAME]), `rows that say they hold starter drafts: ${JSON.stringify(saysDrafts)}`);
    expect(!rows.find(r => r.name === 'Order confirmation').meta.includes('Enrolled'), 'an order email says Enrolled');
    // The hub flows: a closed group at the foot, export only, its flow not a row and not shown.
    const hub = await page.evaluate(() => {
      const summary = [...document.querySelectorAll('summary')].find(el => (el.textContent || '').trim() === 'From the hub, export only');
      const details = summary?.closest('details');
      return summary ? { open: details.open, afterList: !!(document.querySelector('[data-flow-row]')?.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING) } : null;
    });
    expect(hub, 'there is no "From the hub, export only" group');
    expect(hub.open === false && hub.afterList, `the hub group is ${JSON.stringify(hub)}`);
    expect(!(await page.getByText(HUB_FLOW_NAME, { exact: true }).isVisible()), `the hub flow "${HUB_FLOW_NAME}" shows while its group is closed`);
    await keepText('All flows, one list');
    await shot('flows-one-list');
    return `16 rows, each once and the only button of its name (${names.length} drawn); the order emails last in their own group; the four kinds read as stubbed; the hub group closed under the list`;
  });

  await go('starter-open', async () => {
    // Wave 4: the Welcome flow row (it was "Edit emails" on a row and on a card).
    const edit = flowRow(WELCOME_NAME);
    const count = await edit.count();
    expect(count === 1, `${count} buttons named "${WELCOME_NAME}" on All flows`);
    await edit.click();
    const f = await stepHeading('Email 1 of 3');
    expect(f, `focus is on ${JSON.stringify(await focused(page))}, not the "Email 1 of 3" step heading`);
    // Flows, and its Flow map section, are the selected tabs.
    const active = (await isSelected('Flows')) && (await isSelected('Flow map'));
    expect(active, `Flows selected ${await isSelected('Flows')}, Flow map selected ${await isSelected('Flow map')}`);
    const chosen = await chosenFlow(page);
    expect(chosen === WELCOME_NAME, `the chosen flow is "${chosen}"`);
    const border = await waitUntil(async () => {
      const b = await nodeBorder(page, `${WELCOME}_email_0`);
      return b && b.color === PINK ? b : null;
    }, 3000);
    expect(border && border.width === '2px', `email 1 is drawn ${JSON.stringify(await nodeBorder(page, `${WELCOME}_email_0`))}`);
    const subject = await page.locator('#flow-step-subject').inputValue();
    expect(subject === seeds.sequences.find(s => s.id === WELCOME).steps[0].subject, `the Subject field reads "${subject}"`);
    // The step panel says whose emails these are (D3), right under the heading that holds focus.
    const said = await page.evaluate(() => {
      const h3 = document.activeElement;
      return h3 && h3.nextElementSibling ? (h3.nextElementSibling.textContent || '').trim() : '';
    });
    expect(said === STARTER_FLOW_NOTE, `under the step heading: "${said}"`);
    await keepText('Flow map, Welcome email 1');
    await shot('2-starter-open');
    return `1 "${WELCOME_NAME}" row; Flows, Flow map selected, Welcome chosen, email 1 drawn ${border.width} ${border.color}, focus on h3 "${f.text}"`;
  });

  await go('starter-draft-note', async () => {
    // Wave 2, D6: the server marks Welcome's emails as the seeded drafts; the panel says so, under the note.
    expect(await stepHeading('Email 1 of 3') || (await focused(page))?.text === 'Email 1 of 3', 'Welcome email 1 is not the step on screen');
    const note = page.getByText(STARTER_DRAFT_NOTE, { exact: true });
    const shown = await waitUntil(async () => ((await note.isVisible()) ? true : null), 3000);
    expect(shown, `Welcome's email 1 does not say "${STARTER_DRAFT_NOTE}"`);
    const order = await page.evaluate(([starterNote, draftNote]) => {
      const draft = [...document.querySelectorAll('[data-starter-draft]')].find(el => (el.textContent || '').trim() === draftNote);
      return draft ? { before: (draft.previousElementSibling?.textContent || '').trim(), count: document.querySelectorAll('[data-starter-draft]').length, starter: starterNote } : null;
    }, [STARTER_FLOW_NOTE, STARTER_DRAFT_NOTE]);
    expect(order && order.before === STARTER_FLOW_NOTE && order.count === 1, `the draft sentence sits after "${order?.before}", ${order?.count} of them`);
    await keepText('Flow map, a starter draft');
    // Edited and not saved: still the draft the server holds, so it still says so.
    await content().getByRole('textbox', { name: 'Text', exact: true }).first().fill(DRAFT_EDIT);
    expect(await page.getByText(UNSAVED, { exact: true }).isVisible(), `"${UNSAVED}" is not shown after editing the text`);
    expect(await note.isVisible(), 'the sentence went before the edit was saved');
    const posts = state.contentPosts.length;
    await saveButton().click();
    const saved = await waitUntil(async () => ((await statusTexts(page)).includes(SAVED_CONTENT) ? true : null), 5000);
    expect(saved, `no Saved after Save: ${JSON.stringify(await statusTexts(page))}`);
    const post = state.contentPosts[posts];
    const mail = post?.body.nodes?.find(node => node.id === `${WELCOME}_email_0`);
    expect(mail && mail.blocks.some(b => b.kind === 'text' && b.text === DRAFT_EDIT), `Save did not post the edited text: ${JSON.stringify(mail?.blocks)}`);
    const gone = await waitUntil(async () => (!(await note.isVisible()) ? true : null), 5000);
    expect(gone, 'the sentence still shows on email 1 after its edit was saved');
    // Email 2 is still the draft, so it still says so: the mark is per email and comes from the server.
    await page.click(`.react-flow__node[data-id="${WELCOME}_email_1"]`);
    expect(await stepHeading('Email 2 of 3'), 'email 2 did not take the step heading');
    const second = await waitUntil(async () => ((await note.isVisible()) ? true : null), 3000);
    expect(second, 'email 2, still the draft, does not say so');
    await shot('starter-draft-note');
    // The steps after this one start from the seeds, as they did before this step existed.
    state.accountSequences = {};
    state.contentPosts = [];
    return `email 1 said "${STARTER_DRAFT_NOTE}" under the starter note, kept it while edited, and lost it once Save posted the new text; email 2 still says it`;
  });

  await go('email-open', async () => {
    // Wave 4: the email tiles went with the starter cards. The row opens email 1; email 2 is chosen on the map.
    await toFlowList();
    await flowRow(WELCOME_NAME).click();
    expect(await stepHeading('Email 1 of 3'), 'the Welcome row did not open on email 1');
    await page.click(`.react-flow__node[data-id="${WELCOME}_email_1"]`);
    const f = await stepHeading('Email 2 of 3');
    expect(f, `focus is on ${JSON.stringify(await focused(page))}, not "Email 2 of 3"`);
    const border = await waitUntil(async () => {
      const b = await nodeBorder(page, `${WELCOME}_email_1`);
      return b && b.color === PINK ? b : null;
    }, 3000);
    expect(border, 'email 2 is not drawn selected');
    const seen = await boxOf(page, `.react-flow__node[data-id="${WELCOME}_email_1"]`);
    expect(seen?.onScreen, `email 2 is off screen once its heading took focus: ${JSON.stringify(seen)}`);
    const subject = await page.locator('#flow-step-subject').inputValue();
    const want = seeds.sequences.find(s => s.id === WELCOME).steps[1].subject;
    expect(subject === want, `the Subject field reads "${subject}", not "${want}"`);
    return `email 2 selected and drawn ${border.color}; Subject reads "${subject}"`;
  });

  await go('node-selected', async () => {
    const waitId = `${WELCOME}_wait_1`;
    await page.click(`.react-flow__node[data-id="${waitId}"]`);
    const selected = await waitUntil(async () => {
      const b = await nodeBorder(page, waitId);
      return b && b.color === PINK ? b : null;
    }, 3000);
    const other = await nodeBorder(page, `${WELCOME}_email_0`);
    expect(selected, `the Wait node is drawn ${JSON.stringify(await nodeBorder(page, waitId))}`);
    expect(other && other.color !== selected.color, `an unselected node is drawn ${JSON.stringify(other)}, the same as the selected one`);
    const field = page.getByLabel('Wait, in hours', { exact: true });
    await field.waitFor({ state: 'visible' });
    const value = await field.inputValue();
    expect(value === String(seeds.sequences.find(s => s.id === WELCOME).steps[1].delayHours), `the wait field reads ${value}`);
    const f = await stepHeading('Wait before email 2');
    expect(f, `focus is on ${JSON.stringify(await focused(page))}`);
    // The heading takes focus without moving the step just chosen off screen.
    const seen = await boxOf(page, `.react-flow__node[data-id="${waitId}"]`);
    expect(seen?.onScreen, `the Wait step is off screen once its heading took focus: ${JSON.stringify(seen)}`);
    await shot('4-wait-selected');
    return `Wait drawn ${selected.width} ${selected.color}, unselected ${other.width} ${other.color}; "Wait, in hours" reads ${value}`;
  });

  await go('builder-in-step', async () => {
    await page.click(`.react-flow__node[data-id="${WELCOME}_email_0"]`);
    expect(await stepHeading('Email 1 of 3'), 'email 1 did not take the step heading');
    await page.locator('#flow-step-subject').fill(NEW_SUBJECT);
    await page.locator('#flow-step-preview').fill(NEW_PREVIEW);
    const group = content();
    const before = await group.getByRole('button', { name: 'Remove', exact: true }).count();
    await group.getByRole('button', { name: 'Add image', exact: true }).click();
    await group.getByLabel('Image address', { exact: true }).fill(IMAGE_URL);
    await group.getByRole('button', { name: 'Add button', exact: true }).click();
    await group.getByLabel('Button link', { exact: true }).fill(BUTTON_URL);
    const after = await group.getByRole('button', { name: 'Remove', exact: true }).count();
    expect(after === before + 2, `the builder holds ${after} blocks after adding two to ${before}`);
    await keepText('Flow map, builder open');
    await shot('5-builder-in-step');
    return `${before} block, then ${after} after Add image and Add button, with the image address and button link filled`;
  });

  await go('save-content', async () => {
    const unsaved = () => page.getByText(UNSAVED, { exact: true }).isVisible();
    expect(await unsaved(), `"${UNSAVED}" is not shown after the edits`);
    let release = () => {};
    state.contentHold = new Promise(resolve => { release = resolve; });
    try {
      await saveButton().click();
      const reached = await waitUntil(() => (state.contentPosts.length === 1 ? true : null), 5000);
      expect(reached, 'the flow-content POST did not reach the stub');
      // The server has not answered: Save reads Saving, and nothing says Saved.
      const saving = page.getByRole('button', { name: 'Saving', exact: true });
      expect(await saving.isVisible(), 'Save does not read Saving while the request is open');
      expect((await saving.getAttribute('aria-disabled')) === 'true', 'Saving is not aria-disabled');
      await page.waitForTimeout(300);
      const during = await statusTexts(page);
      expect(!during.includes(SAVED_CONTENT), `Saved was said before the server answered: ${JSON.stringify(during)}`);
      expect(during.includes(SAVING_CONTENT), `while the request is open the status says ${JSON.stringify(during)}`);
    } finally {
      release();
      state.contentHold = null;
    }
    const status = await waitUntil(async () => ((await statusTexts(page)).includes(SAVED_CONTENT) ? true : null), 5000);
    expect(status, `no status region says "${SAVED_CONTENT}": ${JSON.stringify(await statusTexts(page))}`);
    // Seen, not only heard: the sentence and the Save that was pressed are both on screen.
    const said = await boxOf(page, '[role="status"]', SAVED_CONTENT);
    const button = await boxOf(page, 'button', 'Save');
    expect(said?.onScreen, `the Saved sentence is off screen: ${JSON.stringify(said)}`);
    expect(button?.onScreen, `Save is off screen: ${JSON.stringify(button)}`);
    await page.waitForTimeout(600);
    expect((await statusTexts(page)).includes(SAVED_CONTENT), 'the Saved sentence went away by itself');
    expect(!(await unsaved()), `"${UNSAVED}" still shows after Saved`);
    expect(state.contentPosts.length === 1, `${state.contentPosts.length} flow-content POSTs, not one`);
    const post = state.contentPosts[0];
    expect(post.id === WELCOME, `the POST went to ${post.id}`);
    const mail = post.body.nodes.find(node => node.id === `${WELCOME}_email_0`);
    expect(mail && mail.subject === NEW_SUBJECT, `the email node's subject is ${JSON.stringify(mail?.subject)}`);
    expect(mail.previewText === NEW_PREVIEW, `the email node's preview text is ${JSON.stringify(mail.previewText)}`);
    const kinds = mail.blocks.map(b => b.kind);
    expect(mail.blocks.some(b => b.kind === 'image' && b.url === IMAGE_URL), `no image block with the address: ${JSON.stringify(kinds)}`);
    expect(mail.blocks.some(b => b.kind === 'button' && b.url === BUTTON_URL), `no button block with the link: ${JSON.stringify(kinds)}`);
    const others = post.body.nodes.filter(node => node.type === 'email' && node.id !== mail.id);
    expect(others.every(node => typeof node.previewText === 'string' && node.previewText.length > 0), 'another email in the POST lost its preview text');
    // An edit after Saved: the sentence no longer covers what is on screen, so it goes.
    await page.locator('#flow-step-preview').fill(`${NEW_PREVIEW}, edited after the save`);
    const cleared = await waitUntil(async () => (!(await statusTexts(page)).includes(SAVED_CONTENT) ? true : null), 2000);
    expect(cleared, `Saved still shows after a new edit: ${JSON.stringify(await statusTexts(page))}`);
    expect(await unsaved(), `"${UNSAVED}" is not shown after the new edit`);
    return `Saving shown and Saved withheld while the answer was held; then one POST to /api/email/flow-content/${post.id}; email 1 carries "${mail.subject}", "${mail.previewText}" and blocks ${kinds.join(', ')}; Saved on screen at ${said.top}..${said.bottom} of ${said.viewport} with Save at ${button.top}; a later edit cleared it`;
  });

  await go('cards-show-edit', async () => {
    // Wave 4: there are no cards to show a subject. The saved edit is what Welcome opens with when it
    // is opened again from All flows (the editor reads the flow map afresh).
    await toFlowList();
    await flowRow(WELCOME_NAME).click();
    expect(await stepHeading('Email 1 of 3'), 'the Welcome row did not open on email 1');
    const shown = await waitUntil(async () => ((await page.locator('#flow-step-subject').inputValue()) === NEW_SUBJECT ? true : null), 5000);
    expect(shown, `Welcome's email 1 opens with "${await page.locator('#flow-step-subject').inputValue()}", not the saved "${NEW_SUBJECT}"`);
    const line = await page.locator('#flow-step-preview').inputValue();
    expect(line === NEW_PREVIEW, `its preview text is "${line}", not the saved "${NEW_PREVIEW}"`);
    expect(!(await page.getByText(UNSAVED, { exact: true }).isVisible()), `"${UNSAVED}" shows on a flow just opened`);
    await shot('7-card-shows-edit');
    return `opened again from All flows, Welcome's email 1 reads "${NEW_SUBJECT}" and "${NEW_PREVIEW}"`;
  });

  await go('built-in', async () => {
    // Wave 4: AutomationCard is gone. The list edits nothing itself (no textarea, no input), the
    // built-in flow's row says what it is, Turn on and Turn off sit beside it and send only that, and
    // the row opens it on the map with the builder.
    await toFlowList();
    const fields = await page.evaluate(() => {
      const section = [...document.querySelectorAll('section')].find(el => el.querySelector('h2')?.textContent?.trim() === 'All flows');
      return section ? { textareas: section.querySelectorAll('textarea').length, inputs: section.querySelectorAll('input').length } : null;
    });
    expect(fields, 'there is no All flows section');
    expect(fields.textareas === 0 && fields.inputs === 0, `the All flows list holds ${fields.textareas} textareas and ${fields.inputs} inputs`);
    const before = await rowOf('After the order');
    expect(before.meta.includes('Built in') && before.meta.includes('· Off ·'), `the row reads "${before.meta}"`);
    const posts = state.programPosts.length;
    await page.getByRole('button', { name: 'Turn on After the order', exact: true }).click();
    const on = await waitUntil(async () => ((await rowOf('After the order'))?.meta.includes('· On ·') ? true : null), 5000);
    expect(on, `after Turn on the row reads "${(await rowOf('After the order'))?.meta}"`);
    const sent = state.programPosts.slice(posts);
    expect(sent.length === 1 && sent[0].id === 'post_purchase' && JSON.stringify(sent[0].body) === JSON.stringify({ kind: 'automation', enabled: true }), `Turn on sent ${JSON.stringify(sent)}`);
    const said = await waitUntil(async () => (await statusTexts(page)).find(t => t.startsWith('After the order is on.')) || null, 3000);
    expect(said, `no status region says it is on: ${JSON.stringify(await statusTexts(page))}`);
    await page.getByRole('button', { name: 'Turn off After the order', exact: true }).click();
    const off = await waitUntil(async () => ((await rowOf('After the order'))?.meta.includes('· Off ·') ? true : null), 5000);
    expect(off && state.programPosts.length === posts + 2, `after Turn off the row reads "${(await rowOf('After the order'))?.meta}", ${state.programPosts.length - posts} posts`);
    await flowRow('After the order').click();
    const f = await stepHeading('Email 1 of 2');
    expect(f, `focus is on ${JSON.stringify(await focused(page))}`);
    const chosen = await chosenFlow(page);
    expect(chosen === 'After the order', `the chosen flow is "${chosen}"`);
    await content().getByRole('button', { name: 'Add image', exact: true }).waitFor({ state: 'visible' });
    await keepText('Flow map, After the order');
    await shot('8-built-in');
    return `the list holds no textarea or input; Turn on posted ${JSON.stringify(sent[0].body)} and the row read On, Turn off put it back; the row opened After the order with the builder, focus on "${f.text}"`;
  });

  await go('account-flow', async () => {
    await pickFlow('Viewed a product');
    await page.click('.react-flow__node[data-id="n_mail"]');
    expect(await stepHeading('Email 1 of 1'), `focus is on ${JSON.stringify(await focused(page))}`);
    const group = content();
    await group.getByRole('button', { name: 'Add divider', exact: true }).click();
    for (const option of ['Send at their hour', 'Transactional, no marketing unsubscribe', 'Skip if this account emailed them in the last 16 hours']) {
      expect(await page.getByText(option, { exact: true }).count() >= 1, `the advanced option "${option}" is not shown`);
    }
    expect(await page.getByRole('button', { name: 'Add wait', exact: true }).count() === 1, 'the flow-level Add wait is not shown on an account flow');
    await saveButton().click();
    const post = await waitUntil(() => state.flowPosts.find(row => row.id === 'flow_viewedproduct') || null, 5000);
    expect(post, 'no POST reached /api/email/flows/flow_viewedproduct');
    const mail = post.body.nodes.find(node => node.id === 'n_mail');
    const kinds = (mail?.blocks || []).map(b => b.kind);
    expect(kinds.includes('text') && kinds.includes('divider'), `the posted email blocks are ${JSON.stringify(kinds)}`);
    const status = await waitUntil(async () => ((await statusTexts(page)).includes(SAVED_FLOW) ? true : null), 5000);
    expect(status, `the status region says ${JSON.stringify(await statusTexts(page))}`);
    await keepText('Flow map, Viewed a product');
    await shot('9-account-flow');
    return `builder and advanced options shown; POST /api/email/flows/flow_viewedproduct carried blocks ${kinds.join(', ')}`;
  });

  await go('save-unanswered', async () => {
    state.contentMode = 'abort';
    try {
      await pickFlow(WELCOME_NAME);
      // Email 1: the map keeps the last flow's view when another flow is chosen in the picker, and
      // email 1 sits near the top of every chain, so it is on screen.
      await page.click(`.react-flow__node[data-id="${WELCOME}_email_0"]`);
      expect(await stepHeading('Email 1 of 3'), 'email 1 did not take the step heading');
      await page.locator('#flow-step-subject').fill(UNHEARD_SUBJECT);
      const posts = state.contentPosts.length;
      await saveButton().click();
      const status = await waitUntil(async () => ((await statusTexts(page)).includes(FLOW_MAP_WRITE_UNREACHABLE.content) ? true : null), 5000);
      expect(status, `the status region says ${JSON.stringify(await statusTexts(page))}`);
      expect(state.contentAborted.length === 1, `${state.contentAborted.length} flow-content requests were aborted, not one`);
      expect(state.contentPosts.length === posts, 'an aborted save was recorded as answered');
      return `the request to ${state.contentAborted[0]} was aborted and the notice reads "${FLOW_MAP_WRITE_UNREACHABLE.content}"`;
    } finally {
      state.contentMode = 'answer';
    }
  });

  await go('unsaved-kept', async () => {
    expect(await page.getByText(UNSAVED, { exact: true }).isVisible(), `"${UNSAVED}" is not shown after a save the server never answered`);
    const before = dialogs.length;
    await pickFlow('Viewed a product');
    const asked = await waitUntil(() => (dialogs.length > before ? dialogs[dialogs.length - 1] : null), 3000);
    expect(asked, 'choosing another flow with unsaved edits asked nothing');
    // The check answers Cancel: the flow and the edit stay.
    await page.waitForTimeout(300);
    const chosen = await chosenFlow(page);
    expect(chosen === WELCOME_NAME, `after Cancel the chosen flow is "${chosen}"`);
    const subject = await page.locator('#flow-step-subject').inputValue();
    expect(subject === UNHEARD_SUBJECT, `after Cancel the Subject field reads "${subject}"`);
    return `asked "${asked}"; Cancel kept ${WELCOME_NAME} and its unsaved subject`;
  });

  await go('strip-clears', async () => {
    await toFlowList();
    await flowRow(WELCOME_NAME).click();
    expect(await stepHeading('Email 1 of 3'), 'the Welcome row did not open Welcome on email 1');
    await toFlowList();
    await tab('Flow map').click();
    await page.getByRole('heading', { level: 2, name: 'Flow map', exact: true }).waitFor({ state: 'visible' });
    const first = state.flows[0].name;
    const chosen = await waitUntil(async () => (await chosenFlow(page)) || null, 5000);
    expect(chosen === first, `the plain Flow map tab chose "${chosen}", not the first flow "${first}"`);
    await page.waitForTimeout(400);
    const headings = await page.evaluate(() => [...document.querySelectorAll('h3')].map(h => (h.textContent || '').trim()).filter(t => /^(Email|Wait|Text) /.test(t)));
    expect(headings.length === 0, `a step is selected on the plain Flow map: ${JSON.stringify(headings)}`);
    return `the section strip opened the plain map on "${chosen}" with no step selected`;
  });

  await go('keyboard', async () => {
    await toFlowList();
    await tab('All flows').focus();
    let reached = null;
    let presses = 0;
    // Wave 4: the Welcome flow row (it was the first "Edit emails" button).
    for (; presses < 80 && !reached; presses++) {
      await page.keyboard.press('Tab');
      const f = await focused(page);
      if (f && f.tag === 'button' && f.row === WELCOME) reached = { ...f, label: `${WELCOME_NAME} row` };
    }
    expect(reached, `Tab did not reach the ${WELCOME_NAME} row in ${presses} presses from the All flows tab`);
    await page.keyboard.press('Enter');
    const f = await waitUntil(async () => {
      const now = await focused(page);
      return now && now.tag === 'h3' && /^Email 1 of \d+$/.test(now.text) ? now : null;
    }, 5000);
    expect(f, `after Enter focus is on ${JSON.stringify(await focused(page))}`);
    expect(await page.getByRole('heading', { level: 2, name: 'Flow map', exact: true }).isVisible(), 'the Flow map is not showing');
    // On the map itself: Enter on a focused step selects it and hands focus to its heading. Each step
    // is a focusable element (React Flow gives it tabindex 0); it is focused in the page, and the check
    // asserts it holds focus before Enter is pressed. Enter on Edit emails just mounted the map, and
    // React Flow hides a step until its first measurement, which nothing before it could have taken;
    // so the first focus waits for every step to be drawn, at most 5 seconds. The one-try focus that
    // matters is the second one, straight after a selection, when every size is already known.
    const drawn = await waitUntil(() => page.evaluate(() => {
      const steps = [...document.querySelectorAll('.react-flow__node')];
      return steps.length && steps.every(el => getComputedStyle(el).visibility === 'visible') ? steps.length : 0;
    }), 5000, 20);
    expect(drawn, 'the map steps were still hidden 5 seconds after Edit emails opened the map');
    // From here every step is measured, so a selection must never draw one hidden, not even for a
    // frame (nodeSizes carries each size into the rebuilt map). A focus attempt, timed by a poll,
    // can miss a one-frame blank, so a MutationObserver records every step drawn hidden.
    const watching = await page.evaluate(() => {
      const box = document.querySelector('.react-flow__nodes');
      if (!box) return false;
      const seen = (window.__studioHiddenSteps = []);
      const note = el => {
        if (el instanceof HTMLElement && el.classList.contains('react-flow__node') && el.style.visibility === 'hidden') seen.push(el.getAttribute('data-id'));
      };
      window.__studioHiddenWatch = new MutationObserver(records => {
        for (const r of records) {
          note(r.target);
          r.addedNodes.forEach(note);
        }
      });
      window.__studioHiddenWatch.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
      return true;
    });
    expect(watching, 'the map has no .react-flow__nodes box to watch');
    const focusWait = await focusNode(`${WELCOME}_wait_1`);
    await page.keyboard.press('Enter');
    const onMap = await stepHeading('Wait before email 2');
    expect(onMap, `Enter on the focused Wait step left focus on ${JSON.stringify(await focused(page))}`);
    // Back to email 1 the same way, so the builder is open for the narrow step.
    const focusEmail = await focusNode(`${WELCOME}_email_0`);
    await page.keyboard.press('Enter');
    expect(await stepHeading('Email 1 of 3'), `Enter on the focused email 1 left focus on ${JSON.stringify(await focused(page))}`);
    const hidden = await page.evaluate(() => {
      window.__studioHiddenWatch.disconnect();
      return window.__studioHiddenSteps;
    });
    expect(hidden.length === 0, `two selections drew measured map steps hidden ${hidden.length} times: ${[...new Set(hidden)].join(', ')}`);
    return `${presses} Tab presses from the All flows tab reached "${reached.label}"; Enter opened the map with focus on "${f.text}"; Enter on a focused map step moved focus to "${onMap.text}", then back to email 1 (${drawn} map steps drawn, then ${focusWait}; ${focusEmail}, straight after a selection; no step drawn hidden by either selection)`;
  });

  await go('narrow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await content().waitFor({ state: 'visible' });
    const f = await studioPastEdge(page);
    expect(f.seen >= 20, `only ${f.seen} controls were measured, so the scan proves nothing`);
    expect(f.pageScroll === 390, `document.documentElement.scrollWidth is ${f.pageScroll}, not 390`);
    expect(f.studioScroll <= f.studioClient, `the studio scrolls sideways: ${f.studioScroll} > ${f.studioClient}`);
    expect(f.bad.length === 0, `${f.bad.length} controls past an edge: ${f.bad.slice(0, 4).join(' | ')}`);
    await keepText('Flow map at 390');
    await shot('12-narrow');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    return `at 390: page scrollWidth ${f.pageScroll}, studio ${f.studioScroll}/${f.studioClient}, ${f.seen} controls, none past either edge`;
  });

  // ---- Wave 4: Flows is one list and one editor ----

  await go('flows-row-open', async () => {
    // D3: a row opens the editor on its flow with the first email chosen, an account flow too.
    await toFlowList();
    await flowRow('Added to cart').click();
    const f = await stepHeading('Email 1 of 1');
    expect(f, `the Added to cart row left focus on ${JSON.stringify(await focused(page))}, not "Email 1 of 1"`);
    expect((await isSelected('Flows')) && (await isSelected('Flow map')), `Flows selected ${await isSelected('Flows')}, Flow map selected ${await isSelected('Flow map')}`);
    const chosen = await chosenFlow(page);
    expect(chosen === 'Added to cart', `the chosen flow is "${chosen}"`);
    const border = await waitUntil(async () => {
      const b = await nodeBorder(page, 'n_mail');
      return b && b.color === PINK ? b : null;
    }, 3000);
    expect(border, `its email is drawn ${JSON.stringify(await nodeBorder(page, 'n_mail'))}`);
    // Its settings sit closed under "Flow settings", so the step comes first; Enter opens and closes them.
    const summary = page.locator('summary', { hasText: 'Flow settings' });
    expect((await summary.count()) === 1 && (await summary.isVisible()), 'there is no Flow settings disclosure');
    const name = page.locator('#flow-settings-name');
    expect(!(await name.isVisible()), 'the flow name shows while Flow settings is closed');
    await summary.focus();
    await page.keyboard.press('Enter');
    await name.waitFor({ state: 'visible' });
    const value = await name.inputValue();
    expect(value === 'Added to cart', `the name field reads "${value}"`);
    await page.keyboard.press('Enter');
    await name.waitFor({ state: 'hidden' });
    await keepText('Flow map, Added to cart');
    await shot('flows-row-open');
    return `the row opened Added to cart with its email drawn ${border.color} and focus on "${f.text}"; Flow settings was closed, Enter opened it on "${value}" and closed it`;
  });

  await go('order-email-builder', async () => {
    // An order email is a one-email flow: the row opens it in the editor with the builder, it shows no
    // preview text (it keeps none), it keeps its sample preview, it saves through the one content route,
    // and it turns on from All flows as the transactional kind.
    await toFlowList();
    const seed = seeds.transactional.find(t => t.id === 'order_confirmation');
    await flowRow(seed.name).click();
    const f = await stepHeading('Email 1 of 1');
    expect(f, `the ${seed.name} row left focus on ${JSON.stringify(await focused(page))}`);
    const chosen = await chosenFlow(page);
    expect(chosen === seed.name, `the chosen flow is "${chosen}"`);
    const subject = await page.locator('#flow-step-subject').inputValue();
    expect(subject === seed.subject, `the Subject field reads "${subject}"`);
    expect((await page.locator('#flow-step-preview').count()) === 0, 'an order email shows a preview text field it does not keep');
    await content().getByRole('button', { name: 'Add button', exact: true }).waitFor({ state: 'visible' });
    const note = await page.evaluate(() => {
      const h3 = document.activeElement;
      return h3 && h3.nextElementSibling ? (h3.nextElementSibling.textContent || '').trim() : '';
    });
    expect(note.includes(`“${seed.shopifyNotification}”`) && note.endsWith('Turn it on or off from All flows.'), `under the step heading: "${note}"`);
    const previews = state.previewPosts.length;
    await page.getByRole('button', { name: 'Preview sample', exact: true }).click();
    await page.locator('iframe[title="Order email preview"]').waitFor({ state: 'visible' });
    const asked = state.previewPosts.slice(previews);
    expect(asked.length === 1 && asked[0].subject === seed.subject && asked[0].marketing === false, `the preview asked ${JSON.stringify(asked)}`);
    await page.locator('#flow-step-subject').fill(NEW_ORDER_SUBJECT);
    const group = content();
    await group.getByRole('button', { name: 'Add button', exact: true }).click();
    await group.getByLabel('Button link', { exact: true }).fill(ORDER_BUTTON_URL);
    const posts = state.contentPosts.length;
    await saveButton().click();
    const savedOrder = 'Saved. Every order email sent from now on uses this version.';
    const status = await waitUntil(async () => ((await statusTexts(page)).includes(savedOrder) ? true : null), 5000);
    expect(status, `the status region says ${JSON.stringify(await statusTexts(page))}`);
    const sent = state.contentPosts.slice(posts);
    expect(sent.length === 1 && sent[0].id === seed.id, `the save went to ${JSON.stringify(sent.map(r => r.id))}`);
    const mail = sent[0].body.nodes.find(node => node.type === 'email');
    expect(sent[0].body.nodes.length === 2 && mail, `the save carried ${sent[0].body.nodes.length} nodes`);
    expect(mail.subject === NEW_ORDER_SUBJECT, `the email node's subject is ${JSON.stringify(mail.subject)}`);
    expect(mail.blocks.some(b => b.kind === 'button' && b.url === ORDER_BUTTON_URL), `the email node's blocks are ${JSON.stringify(mail.blocks.map(b => b.kind))}`);
    await keepText('Flow map, Order confirmation');
    await shot('order-email-builder');
    await toFlowList();
    const before = state.programPosts.length;
    await page.getByRole('button', { name: `Turn on ${seed.name}`, exact: true }).click();
    const on = await waitUntil(async () => ((await rowOf(seed.name))?.meta.includes('· On ·') ? true : null), 5000);
    const toggled = state.programPosts.slice(before);
    expect(on, `after Turn on the row reads "${(await rowOf(seed.name))?.meta}"`);
    expect(toggled.length === 1 && toggled[0].id === seed.id && JSON.stringify(toggled[0].body) === JSON.stringify({ kind: 'transactional', enabled: true }), `Turn on sent ${JSON.stringify(toggled)}`);
    return `${seed.name} opened with the builder and no preview text field; Preview sample asked once with marketing false; Save posted one email with "${NEW_ORDER_SUBJECT}" and a button to /api/email/flow-content/${seed.id}; Turn on posted ${JSON.stringify(toggled[0].body)}`;
  });

  await go('delete-asks', async () => {
    // Delete asks first, naming the flow; the check answers Cancel, and nothing is deleted.
    await toFlowList();
    const flow = state.flows.find(item => item.id === DELETE_FLOW);
    expect(flow, `the stub has no ${DELETE_FLOW}`);
    await flowRow(flow.name).click();
    expect(await stepHeading('Email 1 of 1'), `the ${flow.name} row did not open its email`);
    const before = dialogs.length;
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const asked = await waitUntil(() => (dialogs.length > before ? dialogs[dialogs.length - 1] : null), 3000);
    expect(asked, 'Delete asked nothing');
    expect(asked.startsWith(`Delete the flow "${flow.name}"?`), `Delete asked "${asked}"`);
    await page.waitForTimeout(400);
    expect(state.deletes.length === 0, `a DELETE reached the server after Cancel: ${JSON.stringify(state.deletes)}`);
    expect((await chosenFlow(page)) === flow.name, `after Cancel the chosen flow is "${await chosenFlow(page)}"`);
    await toFlowList();
    expect((await flowRow(flow.name).count()) === 1, `${flow.name} is gone from All flows after Cancel`);
    return `Delete asked "${asked}"; Cancel sent nothing and ${flow.name} is still listed`;
  });

  // ---- Wave 4 fix round ----

  await go('new-flow', async () => {
    // Designing an email from scratch: New flow on All flows, and nothing else, puts a new email in the builder.
    await toFlowList();
    const button = page.getByRole('button', { name: 'New flow', exact: true });
    expect((await button.count()) === 1, `${await button.count()} buttons named New flow on All flows`);
    const before = state.creates.length;
    await button.click();
    const f = await stepHeading('Email 1 of 1');
    expect(f, `after New flow, focus is on ${JSON.stringify(await focused(page))}, not "Email 1 of 1"`);
    const sent = state.creates.slice(before);
    expect(sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify({ name: 'New flow', trigger: 'manual' }), `New flow posted ${JSON.stringify(sent)}`);
    expect((await isSelected('Flows')) && (await isSelected('Flow map')), `Flows selected ${await isSelected('Flows')}, Flow map selected ${await isSelected('Flow map')}`);
    const first = await page.evaluate(() => document.getElementById('flow-picker')?.value || '');
    expect(first === `flow_check${state.creates.length}` && (await chosenFlow(page)) === 'New flow', `the chosen flow is ${first} "${await chosenFlow(page)}"`);
    const border = await waitUntil(async () => {
      const b = await nodeBorder(page, 'n_mail');
      return b && b.color === PINK ? b : null;
    }, 3000);
    expect(border, `its email is drawn ${JSON.stringify(await nodeBorder(page, 'n_mail'))}`);
    await content().getByRole('button', { name: 'Add image', exact: true }).waitFor({ state: 'visible' });
    await keepText('Flow map, a new flow');
    // From the plain Flow map (the section strip), the editor's own New flow opens its email the same way.
    await tab('All flows').click();
    await tab('Flow map').click();
    await page.getByLabel('Flow to edit', { exact: true }).waitFor({ state: 'visible' });
    const again = state.creates.length;
    await page.getByRole('button', { name: 'New flow', exact: true }).click();
    const g = await stepHeading('Email 1 of 1');
    expect(g, `after the editor's New flow, focus is on ${JSON.stringify(await focused(page))}`);
    expect(state.creates.length === again + 1, `the editor's New flow posted ${state.creates.length - again} times`);
    const second = await page.evaluate(() => document.getElementById('flow-picker')?.value || '');
    expect(second === `flow_check${state.creates.length}`, `the editor's New flow left ${second} chosen`);
    await content().getByRole('button', { name: 'Add image', exact: true }).waitFor({ state: 'visible' });
    return `one click on All flows' New flow opened ${first} on its email (drawn ${border.color}, focus on "${f.text}", builder showing); Flow map then its New flow opened ${second} the same way`;
  });

  await go('delete-confirmed', async () => {
    // Delete, accepted: one DELETE for the flow it named, focus on the Flow map heading, and a status that says so.
    const names = [];
    for (let i = 0; i < 2; i++) {
      const id = await page.evaluate(() => document.getElementById('flow-picker')?.value || '');
      const name = await chosenFlow(page);
      expect(/^flow_check\d$/.test(id) && name === 'New flow', `before Delete the chosen flow is ${id} "${name}"`);
      const deletes = state.deletes.length;
      const asked = dialogs.length;
      acceptNextDialog = true;
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      const question = await waitUntil(() => (dialogs.length > asked ? dialogs[dialogs.length - 1] : null), 3000);
      expect(question && question.startsWith('Delete the flow "New flow"?'), `Delete asked ${JSON.stringify(question)}`);
      const gone = await waitUntil(() => (state.deletes.length > deletes ? true : null), 3000);
      expect(gone && JSON.stringify(state.deletes.slice(deletes)) === JSON.stringify([id]), `the DELETEs were ${JSON.stringify(state.deletes.slice(deletes))}, not [${id}]`);
      const f = await waitUntil(async () => {
        const at = await focused(page);
        return at && at.tag === 'h2' && at.text === 'Flow map' ? at : null;
      }, 3000);
      expect(f, `after Delete focus is on ${JSON.stringify(await focused(page))}, not the Flow map heading`);
      const said = await waitUntil(async () => ((await statusTexts(page)).includes('The flow "New flow" was deleted.') ? true : null), 3000);
      expect(said, `the status says ${JSON.stringify(await statusTexts(page))}`);
      const left = await page.evaluate(gid => [...(document.getElementById('flow-picker')?.options || [])].some(o => o.value === gid), id);
      expect(!left, `${id} is still in the picker after Delete`);
      names.push(id);
    }
    expect(acceptNextDialog === false, 'a Delete was never asked');
    await toFlowList();
    const rows = await flowRowsOnPage(page);
    expect(rows.length === 16 && !rows.some(r => r.name === 'New flow'), `All flows has ${rows.length} rows: ${rows.map(r => r.name).join(', ')}`);
    return `Delete, accepted, sent one DELETE each for ${names.join(' and ')}; focus went to the Flow map heading and the status said it was deleted; All flows is 16 rows again`;
  });

  await go('row-switches', async () => {
    // An account's own flow turns on and off from its row; the switch's name begins with what it shows.
    const name = 'Viewed a product';
    expect((await rowOf(name))?.meta.includes('· Off ·'), `${name}'s row reads "${(await rowOf(name))?.meta}"`);
    const posts = state.flowPosts.length;
    let release = () => {};
    state.flowHold = new Promise(resolve => { release = resolve; });
    let busy;
    try {
      await page.getByRole('button', { name: `Turn on ${name}`, exact: true }).click();
      busy = await waitUntil(() => page.evaluate(n => {
        const b = [...document.querySelectorAll('button[aria-label]')].find(el => (el.getAttribute('aria-label') || '').endsWith(` ${n}`) && (el.textContent || '').trim() === 'Saving');
        return b ? { text: (b.textContent || '').trim(), label: b.getAttribute('aria-label') } : null;
      }, name), 3000);
    } finally {
      release();
      state.flowHold = null;
    }
    expect(busy, 'the switch never read Saving while its answer was held');
    expect(busy.label === `Saving ${name}`, `while saving the switch shows "${busy.text}" and is named "${busy.label}"`);
    const on = await waitUntil(async () => ((await rowOf(name))?.meta.includes('· On ·') ? true : null), 5000);
    expect(on, `after Turn on the row reads "${(await rowOf(name))?.meta}"`);
    await page.getByRole('button', { name: `Turn off ${name}`, exact: true }).click();
    const off = await waitUntil(async () => ((await rowOf(name))?.meta.includes('· Off ·') ? true : null), 5000);
    expect(off, `after Turn off the row reads "${(await rowOf(name))?.meta}"`);
    const sent = state.flowPosts.slice(posts);
    expect(JSON.stringify(sent) === JSON.stringify([{ id: STEP_FLOW, body: { enabled: true } }, { id: STEP_FLOW, body: { enabled: false } }]), `the switch sent ${JSON.stringify(sent)}`);
    await keepText('All flows, switches');
    return `Turn on and Turn off on ${name} sent ${JSON.stringify(sent.map(r => r.body))} to /api/email/flows/${STEP_FLOW}; held, the switch showed "${busy.text}" named "${busy.label}"`;
  });

  await go('starter-off', async () => {
    // Wave 2: a starter flow turns off for this account, from its row and from the editor's header.
    const name = WELCOME_NAME;
    expect((await rowOf(name))?.meta.includes('· On ·'), `${name}'s row reads "${(await rowOf(name))?.meta}"`);
    expect(!(await studioText(page)).includes(STARTER_NO_SWITCH), `the list still says "${STARTER_NO_SWITCH}"`);
    const posts = state.contentPosts.length;
    await page.getByRole('button', { name: `Turn off ${name}`, exact: true }).click();
    const off = await waitUntil(async () => ((await rowOf(name))?.meta.includes('· Off ·') ? true : null), 5000);
    expect(off, `after Turn off the row reads "${(await rowOf(name))?.meta}"`);
    const sentOff = state.contentPosts.slice(posts);
    expect(JSON.stringify(sentOff) === JSON.stringify([{ id: WELCOME, body: { enabled: false } }]), `Turn off sent ${JSON.stringify(sentOff)}`);
    expect(await page.getByRole('button', { name: `Turn on ${name}`, exact: true }).isVisible(), 'the switch does not read Turn on once the row is Off');
    const said = await waitUntil(async () => ((await statusTexts(page)).includes(starterOffSaid(name)) ? true : null), 3000);
    expect(said, `the status says ${JSON.stringify(await statusTexts(page))}`);
    await keepText('All flows, a starter flow off');
    // The editor's header: Welcome is off there too, and Turn on there sends only { enabled: true }.
    await flowRow(name).click();
    expect(await stepHeading('Email 1 of 3'), 'the Welcome row did not open on email 1');
    const header = page.locator(`[data-flow-header-switch="${WELCOME}"]`);
    await header.waitFor({ state: 'visible' });
    expect((await header.textContent()).trim() === 'Turn on', `the header switch reads "${(await header.textContent()).trim()}" on a flow that is off`);
    // Wave 2 fix: the state is said in words beside the switch, which names only the action.
    const headerState = page.locator(`[data-flow-header-state="${WELCOME}"]`);
    const stateText = async () => ((await headerState.count()) ? (await headerState.textContent()).trim() : null);
    expect((await stateText()) === 'Off for this account' && (await headerState.isVisible()), `beside the switch of a flow that is off: ${JSON.stringify(await stateText())}`);
    const before = state.contentPosts.length;
    await header.click();
    const flipped = await waitUntil(async () => ((await header.textContent()).trim() === 'Turn off' ? true : null), 5000);
    expect(flipped, `after Turn on the header switch reads "${(await header.textContent()).trim()}"`);
    expect((await stateText()) === 'On for this account', `beside the switch once it is on: ${JSON.stringify(await stateText())}`);
    const sentOn = state.contentPosts.slice(before);
    expect(JSON.stringify(sentOn) === JSON.stringify([{ id: WELCOME, body: { enabled: true } }]), `the header switch sent ${JSON.stringify(sentOn)}`);
    expect(!(await page.getByText(UNSAVED, { exact: true }).isVisible()), `"${UNSAVED}" shows after only turning the flow on`);
    await keepText('Flow map, a starter flow turned on in the header');
    await toFlowList();
    const on = await waitUntil(async () => ((await rowOf(name))?.meta.includes('· On ·') ? true : null), 5000);
    expect(on, `back on All flows the row reads "${(await rowOf(name))?.meta}"`);
    return `Turn off ${name} sent ${JSON.stringify(sentOff[0].body)}, the row read Off and its switch Turn on, and the status said what happens to the people in it; the editor header said Off for this account beside Turn on, sent ${JSON.stringify(sentOn[0].body)} and said On for this account beside Turn off; the row reads On again`;
  });

  await go('panel-beside', async () => {
    // From 900px wide the step panel sits beside the map: its left edge is right of the map's right edge.
    await flowRow(WELCOME_NAME).click();
    expect(await stepHeading('Email 1 of 3'), 'the Welcome row did not open on email 1');
    // The map is fitted once its steps are measured; let that settle, then measure once.
    await page.waitForTimeout(500);
    const b = await editorBoxes(page);
    expect(b.width === 1440 && b.map && b.panel, `at ${b.width}: ${JSON.stringify(b)}`);
    expect(b.steps >= 6 && b.outside.length === 0, `${b.outside.length} of ${b.steps} map steps are drawn past the map's edge ${b.map.left}..${b.map.right}: ${b.outside.join(', ')}`);
    expect(b.panel.left >= b.map.right, `the panel's left edge ${b.panel.left} is not right of the map's right edge ${b.map.right}`);
    expect(b.map.width >= 300 && b.panel.width >= 300, `map ${b.map.width}px, panel ${b.panel.width}px wide`);
    expect(b.panel.top < b.map.bottom, `the panel starts at ${b.panel.top}, under the map's foot ${b.map.bottom}`);
    expect(b.page === 1440, `document.documentElement.scrollWidth is ${b.page}`);
    await shot('panel-beside');
    return `at 1440: map ${b.map.left}..${b.map.right}, panel ${b.panel.left}..${b.panel.right}, both from ${b.map.top} and ${b.panel.top}; all ${b.steps} map steps inside the map`;
  });

  await go('panel-below', async () => {
    // On a narrower screen the panel is below the map, and nothing scrolls sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      // As narrow: let the media query and React settle, then measure once.
      await page.waitForTimeout(500);
      const b = await editorBoxes(page);
      expect(b.width === 390 && b.map && b.panel, `at 390: ${JSON.stringify(b)}`);
      expect(b.panel.top >= b.map.bottom, `the panel's top ${b.panel.top} is not below the map's foot ${b.map.bottom}`);
      expect(b.steps >= 6 && b.outside.length === 0, `${b.outside.length} of ${b.steps} map steps are drawn past the map's edge ${b.map.left}..${b.map.right}: ${b.outside.join(', ')}`);
      expect(b.panel.left < b.map.right, `the panel ${b.panel.left}..${b.panel.right} sits beside the map ${b.map.left}..${b.map.right}`);
      expect(b.page === 390, `document.documentElement.scrollWidth is ${b.page}, not 390`);
      const f = await studioPastEdge(page);
      expect(f.bad.length === 0, `${f.bad.length} controls past an edge: ${f.bad.slice(0, 4).join(' | ')}`);
      await keepText('Flow map at 390, panel below');
      await shot('panel-below');
      return `at 390: map ${b.map.top}..${b.map.bottom}, panel from ${b.panel.top}; all ${b.steps} map steps inside the map; page scrollWidth ${b.page}; ${f.seen} controls, none past an edge`;
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(300);
    }
  });

  // ---- Wave 3: five destinations ----

  await go('nav-five', async () => {
    const top = await tablist(page, 'Email Studio');
    expect(top, 'there is no tablist named "Email Studio"');
    expect(JSON.stringify(top.names) === JSON.stringify(DESTINATIONS), `the destination tabs are ${JSON.stringify(top.names)}`);
    expect(top.selected.length === 1, `selected destinations: ${JSON.stringify(top.selected)}`);
    expect(top.stops.length === 1 && top.stops[0] === top.selected[0], `Tab stops ${JSON.stringify(top.stops)} for the selected ${JSON.stringify(top.selected)}`);
    expect(top.unlinked.length === 0, `aria-controls that name no tabpanel labelled by its tab: ${JSON.stringify(top.unlinked)}`);
    const seen = [];
    // Each destination is reached from another one, so "opens on its first section" is a real move:
    // a click on the destination already selected changes nothing, by design. Flows comes last.
    for (const name of [...DESTINATIONS.slice(1), DESTINATIONS[0]]) {
      await tab(name).click();
      const now = await tablist(page, 'Email Studio');
      expect(now.selected.length === 1 && now.selected[0] === name, `after ${name} the selected destinations are ${JSON.stringify(now.selected)}`);
      expect(now.unlinked.length === 0, `on ${name}, unlinked: ${JSON.stringify(now.unlinked)}`);
      const sections = await tablist(page, `${name} sections`);
      if (name === 'Results') {
        expect(!sections, 'Results, one section, draws a second strip with one tab');
        seen.push('Results (no second strip)');
        continue;
      }
      expect(sections, `${name} has no "${name} sections" tablist`);
      expect(sections.selected.length === 1 && sections.selected[0] === sections.names[0], `${name} opened on ${JSON.stringify(sections.selected)}, not its first section`);
      expect(sections.stops.length === 1 && sections.unlinked.length === 0, `${name} sections: ${JSON.stringify(sections)}`);
      seen.push(`${name} (${sections.names.join(', ')})`);
      if (name === 'Settings') {
        // The badge is read as a word of its own: Chrome's computed name, asked over CDP, not the DOM text.
        const cdp = await context.newCDPSession(page);
        try {
          const { result } = await cdp.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('[role="tab"]')].find(t => /^Texts/.test((t.textContent || '').trim()))` });
          expect(result?.objectId, 'there is no Texts tab');
          const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
          const said = nodes?.[0]?.name?.value;
          expect(said === 'Texts Soon', `Chrome names the Texts tab "${said}"`);
          seen.push(`Chrome names it "${said}"`);
        } finally {
          await cdp.detach().catch(() => {});
        }
      }
    }
    const text = await studioText(page);
    expect(!text.includes('Hub Engine'), 'the Hub Engine badge is still shown');
    await tab('Flows').click();
    return `five destinations, one selected and one Tab stop, every aria-controls linked: ${seen.join('; ')}; no Hub Engine`;
  });

  await go('nav-moved', async () => {
    await toFlowList();
    // The buttons moved (the list's own sentence may still point at Send due emails now), and so did the table.
    const buttons = [];
    for (const name of ['Run Queue Tick', 'Send due emails now', 'Webhooks']) {
      if (await page.getByRole('button', { name, exact: true }).count()) buttons.push(name);
    }
    expect(buttons.length === 0, `the Flows list still has the buttons ${JSON.stringify(buttons)}`);
    const flows = await studioText(page);
    const left = ['Shopify Abandoned Checkouts Queue', CHECKOUT_EMAIL, STOPPED_CHECKOUT_EMAIL].filter(t => flows.includes(t));
    expect(left.length === 0, `the Flows list still shows ${JSON.stringify(left)}`);
    expect(await page.getByRole('button', { name: 'Refresh', exact: true }).count() === 1, 'Refresh left the Flows list');
    // Settings, Advanced: Send due emails now asks the server once and says what it did.
    await tab('Settings').click();
    await tab('Advanced').click();
    const send = page.getByRole('button', { name: 'Send due emails now', exact: true });
    await send.waitFor({ state: 'visible' });
    const before = state.tickPosts;
    await send.click();
    const said = await waitUntil(async () => (await statusTexts(page)).find(t => t.startsWith('Processed ')) || null, 5000);
    expect(state.tickPosts === before + 1, `${state.tickPosts - before} POSTs to /api/drips/process-tick, not one`);
    expect(said, `no status region says what the send did: ${JSON.stringify(await statusTexts(page))}`);
    await keepText('Settings, Advanced');
    await shot('nav-advanced');
    // Webhooks opens its guide, which closes by a named button.
    await page.getByRole('button', { name: 'Webhooks', exact: true }).click();
    const guide = page.getByRole('heading', { name: 'Outbound Webhook Relay', exact: true });
    await guide.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Close the webhook guide', exact: true }).click();
    await guide.waitFor({ state: 'hidden' });
    // Audience, Open checkouts: the table, with the stub's one checkout.
    await tab('Audience').click();
    await tab('Open checkouts').click();
    await page.getByRole('heading', { name: 'Shopify Abandoned Checkouts Queue', exact: true }).waitFor({ state: 'visible' });
    expect((await studioText(page)).includes(CHECKOUT_EMAIL), `Open checkouts does not list ${CHECKOUT_EMAIL}`);
    // Wave 2 fix: a checkout stopped because Cart recovery was off says so, and never reads Pending.
    const checkoutStatus = email => page.evaluate(address => {
      const row = [...document.querySelectorAll('tr')].find(tr => [...tr.cells].some(td => (td.textContent || '').trim() === address));
      return row ? (row.cells[row.cells.length - 2]?.textContent || '').trim() : null;
    }, email);
    const pendingSays = await checkoutStatus(CHECKOUT_EMAIL);
    const stoppedSays = await checkoutStatus(STOPPED_CHECKOUT_EMAIL);
    expect(pendingSays === 'Pending', `the pending checkout's status reads ${JSON.stringify(pendingSays)}`);
    expect(stoppedSays === 'Stopped, flow turned off', `the checkout stopped because Cart recovery was off reads ${JSON.stringify(stoppedSays)}`);
    await keepText('Audience, Open checkouts');
    await shot('nav-checkouts');
    return `Flows list holds none of ${['Run Queue Tick', 'Send due emails now', 'the checkouts table'].join(', ')} and keeps Refresh; Send due emails now posted once and said "${said}"; Webhooks opened and closed; Open checkouts lists ${CHECKOUT_EMAIL}`;
  });

  await go('nav-keyboard', async () => {
    // Results has no second strip, so its panel is the Tab stop after its tab.
    await tab('Results').click();
    await page.keyboard.press('Tab');
    const resultsPanel = await focusedPanel(page);
    expect(resultsPanel === 'email-studio-tab-results', `Tab from the Results tab reached ${resultsPanel}, not the Results panel`);
    await toFlowList();
    await tab('Flows').focus();
    const log = [];
    const press = async (key, want, list) => {
      await page.keyboard.press(key);
      const at = await waitUntil(async () => {
        const f = await focusedTab(page);
        return f.focus === want && f.list === list && f.selected.length === 1 && f.selected[0] === want ? f : null;
      }, 2000);
      expect(at, `${key} left ${JSON.stringify(await focusedTab(page))}; wanted "${want}" focused and selected in "${list}"`);
      log.push(`${key} ${want}`);
    };
    for (const [key, want] of [['ArrowRight', 'Broadcasts'], ['ArrowRight', 'Audience'], ['ArrowLeft', 'Broadcasts'], ['End', 'Settings'], ['ArrowRight', 'Flows'], ['ArrowLeft', 'Settings'], ['Home', 'Flows'], ['End', 'Settings']]) {
      await press(key, want, 'Email Studio');
    }
    // One Tab stop per strip: Tab reaches the open destination's selected section.
    await page.keyboard.press('Tab');
    const into = await focusedTab(page);
    expect(into.list === 'Settings sections' && into.focus === 'Sending', `Tab from the Settings tab reached ${JSON.stringify(into)}`);
    await press('ArrowRight', 'Klaviyo', 'Settings sections');
    await press('End', 'Advanced', 'Settings sections');
    expect(await page.getByRole('button', { name: 'Send due emails now', exact: true }).isVisible(), 'End on the sections did not open Advanced');
    // The open section's panel is the next Tab stop, and Shift+Tab comes back to its tab.
    await page.keyboard.press('Tab');
    const panel = await focusedPanel(page);
    expect(panel === 'email-studio-section-tab-advanced', `Tab from the Advanced tab reached ${panel}, not the Advanced panel`);
    await page.keyboard.press('Shift+Tab');
    const again = await focusedTab(page);
    expect(again.list === 'Settings sections' && again.focus === 'Advanced', `Shift+Tab from the Advanced panel reached ${JSON.stringify(again)}`);
    await page.keyboard.press('Shift+Tab');
    const back = await focusedTab(page);
    expect(back.list === 'Email Studio' && back.focus === 'Settings', `Shift+Tab from the sections reached ${JSON.stringify(back)}`);
    return `Tab from Results reached its panel; ${log.join(', ')}; Tab reached Sending; from Advanced, Tab reached its panel and Shift+Tab came back; Shift+Tab went back to Settings`;
  });

  await go('nav-active', async () => {
    // On Settings, Advanced from the step before: both strips are drawn.
    const readStrips = () => {
      const parse = c => {
        const m = /rgba?\(([^)]+)\)/.exec(c || '');
        if (!m) return null;
        const p = m[1].split(',').map(s => parseFloat(s));
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
      };
      const lin = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      // The colour behind an element: its own and its ancestors' backgrounds laid over the first opaque one.
      const ground = el => {
        const layers = [];
        for (let n = el; n; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
          const c = parse(cs.backgroundColor);
          if (c && c[3] > 0) layers.push(c);
          if (c && c[3] >= 1) break;
        }
        if (!layers.length || layers[layers.length - 1][3] < 1) return null;
        let rgb = layers.pop().slice(0, 3);
        while (layers.length) {
          const [r, g, b, a] = layers.pop();
          rgb = [r * a + rgb[0] * (1 - a), g * a + rgb[1] * (1 - a), b * a + rgb[2] * (1 - a)];
        }
        return rgb;
      };
      const ratioOf = el => {
        const bg = ground(el);
        const fg = parse(getComputedStyle(el).color);
        if (!bg || !fg) return null;
        const text = [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])];
        const [a, b] = [lum(text), lum(bg)];
        return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
      };
      // A bar: a child drawn with a bottom border at least 2px thick and at least 12px wide.
      const hasBar = t => [...t.querySelectorAll('span')].some(s => {
        const cs = getComputedStyle(s);
        return parseFloat(cs.borderBottomWidth) >= 2 && cs.borderBottomStyle !== 'none' && s.getBoundingClientRect().width >= 12;
      });
      return [...document.querySelectorAll('[role="tablist"]')]
        .filter(l => /^(Email Studio|.+ sections)$/.test(l.getAttribute('aria-label') || ''))
        .map(l => ({
          list: l.getAttribute('aria-label'),
          tabs: [...l.querySelectorAll('[role="tab"]')].map(t => ({
            name: (t.textContent || '').trim(),
            selected: t.getAttribute('aria-selected') === 'true',
            ratio: ratioOf(t),
            weight: Number(getComputedStyle(t).fontWeight),
            bar: hasBar(t),
            // A badge in a tab (Texts' Soon): a text span on a fill of its own, measured on that fill.
            badges: [...t.querySelectorAll('span')]
              .filter(s => !s.children.length && (s.textContent || '').trim() && (parse(getComputedStyle(s).backgroundColor) || [0, 0, 0, 0])[3] > 0)
              .map(s => ({ text: (s.textContent || '').trim(), ratio: ratioOf(s), px: parseFloat(getComputedStyle(s).fontSize) }))
          }))
        }));
    };
    const lists = await page.evaluate(readStrips);
    expect(lists.length === 2, `${lists.length} studio tablists are drawn, not two: ${JSON.stringify(lists.map(l => l.list))}`);
    const notes = [];
    for (const { list, tabs } of lists) {
      const on = tabs.filter(t => t.selected);
      const off = tabs.filter(t => !t.selected);
      expect(on.length === 1 && off.length >= 1, `${list}: ${on.length} selected of ${tabs.length}`);
      const [sel] = on;
      expect(sel.ratio !== null && sel.ratio >= 4.5, `${list}: the selected "${sel.name}" reads ${sel.ratio} to 1`);
      const faint = off.filter(t => t.ratio === null || t.ratio < 4.5);
      expect(faint.length === 0, `${list}: tabs under 4.5 to 1: ${JSON.stringify(faint)}`);
      expect(sel.bar, `${list}: the selected "${sel.name}" has no bar, so only colour marks it`);
      const barred = off.filter(t => t.bar);
      expect(barred.length === 0, `${list}: unselected tabs with the bar: ${barred.map(t => t.name).join(', ')}`);
      const heaviest = Math.max(...off.map(t => t.weight));
      expect(sel.weight > heaviest, `${list}: the selected weight ${sel.weight} is not above the others' ${heaviest}`);
      notes.push(`${list}: "${sel.name}" ${sel.ratio}:1, bar, weight ${sel.weight} over ${heaviest}; others from ${Math.min(...off.map(t => t.ratio))}:1`);
    }
    // The Soon badge, unselected (above) and selected: at least the 11px floor (D10), and 4.5 to 1 on its own fill.
    const badgeNotes = [];
    const checkBadges = strips => {
      for (const { list, tabs } of strips) for (const t of tabs) for (const b of t.badges) {
        expect(b.ratio !== null && b.ratio >= 4.5, `${list}: the badge "${b.text}" on "${t.name}" reads ${b.ratio} to 1`);
        expect(b.px >= 11, `${list}: the badge "${b.text}" on "${t.name}" is ${b.px}px, under the 11px floor`);
        badgeNotes.push(`${t.selected ? 'selected' : 'unselected'} ${b.ratio}:1 at ${b.px}px`);
      }
    };
    checkBadges(lists);
    await page.getByRole('tab', { name: /^Texts/ }).click();
    const withTexts = await page.evaluate(readStrips);
    expect(withTexts.flatMap(l => l.tabs).some(t => t.selected && t.badges.length), 'Texts was chosen, and no selected tab carries a badge');
    checkBadges(withTexts);
    expect(badgeNotes.length === 2, `${badgeNotes.length} badges were measured, not the Soon badge twice: ${badgeNotes.join('; ')}`);
    notes.push(`the Soon badge ${badgeNotes.join(', ')}`);
    return notes.join('; ');
  });

  await go('nav-390', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const notes = [];
    try {
      for (const name of DESTINATIONS) {
        await tab(name).click();
        const m = await page.evaluate(dest => {
          const measure = label => {
            const l = [...document.querySelectorAll('[role="tablist"]')].find(x => x.getAttribute('aria-label') === label);
            if (!l) return null;
            const boxes = [...l.querySelectorAll('[role="tab"]')].map(t => t.getBoundingClientRect());
            return {
              rows: new Set(boxes.map(r => Math.round(r.top))).size,
              height: Math.round(l.getBoundingClientRect().height),
              scroll: l.scrollWidth,
              client: l.clientWidth,
              out: boxes.filter(r => r.left < -0.5 || r.right > window.innerWidth + 0.5).length
            };
          };
          return { top: measure('Email Studio'), sections: measure(`${dest} sections`), page: document.documentElement.scrollWidth };
        }, name);
        expect(m.top, `on ${name} the destination strip is gone`);
        expect(m.top.rows <= 2, `on ${name} the destination strip takes ${m.top.rows} rows (${m.top.height}px)`);
        expect(m.top.scroll <= m.top.client && m.top.out === 0, `on ${name} the destination strip runs sideways: ${JSON.stringify(m.top)}`);
        if (m.sections) {
          expect(m.sections.rows <= 2, `${name}'s section strip takes ${m.sections.rows} rows (${m.sections.height}px)`);
          expect(m.sections.scroll <= m.sections.client && m.sections.out === 0, `${name}'s section strip runs sideways: ${JSON.stringify(m.sections)}`);
        }
        expect(m.page === 390, `on ${name} document.documentElement.scrollWidth is ${m.page}, not 390`);
        notes.push(`${name} ${m.top.rows} rows ${m.top.height}px${m.sections ? `, sections ${m.sections.rows} rows ${m.sections.height}px` : ''}`);
      }
      await shot('nav-390');
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(300);
    }
    return `at 390: ${notes.join('; ')}; page scrollWidth 390 on each`;
  });

  // ---- Wave 5: Broadcasts with the builder ----
  const composerGroup = () => page.getByRole('group', { name: 'Email content' });
  /** True when a beforeunload is cancelled, which is what makes the browser ask before a reload or a closed tab. */
  const leaveAsks = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  const focusedHeading = async text => waitUntil(async () => {
    const f = await focused(page);
    return f && f.tag === 'h2' && f.text === text ? f : null;
  }, 5000);
  const sawStatus = async text => waitUntil(async () => ((await statusTexts(page)).some(t => t.includes(text)) ? true : null), 5000);
  /** The blocks the composer holds, as the draft it saved last carried them. */
  let savedBlocks = null;
  let savedDraftId = '';

  await go('broadcast-new', async () => {
    await tab('Broadcasts').click();
    await page.getByRole('heading', { level: 2, name: 'All broadcasts', exact: true }).waitFor({ state: 'visible' });
    const sections = await tablist(page, 'Broadcasts sections');
    expect(sections && JSON.stringify(sections.names) === JSON.stringify(['All broadcasts', 'New broadcast']), `the Broadcasts sections are ${JSON.stringify(sections?.names)}`);
    expect((await page.getByRole('tab', { name: 'Builder', exact: true }).count()) === 0, 'a Builder tab is still drawn');
    await page.getByRole('button', { name: 'New broadcast', exact: true }).click();
    const f = await focusedHeading('New broadcast');
    expect(f, `New broadcast left focus on ${JSON.stringify(await focused(page))}`);
    expect(await isSelected('New broadcast'), 'the New broadcast section is not the selected tab');
    // The builder itself: the Add buttons and the two blocks a new broadcast starts with.
    const group = composerGroup();
    await group.getByRole('button', { name: 'Add image', exact: true }).waitFor({ state: 'visible' });
    const adds = await group.getByRole('button', { name: /^Add (heading|text|button|divider|image|HTML|columns|split|table|spacer|social links|header|video|product|coupon)$/ }).count();
    expect(adds === 15, `${adds} Add buttons in the builder, not the 15 block kinds`);
    expect(await group.getByLabel('Heading', { exact: true }).isVisible() && await group.getByLabel('Text', { exact: true }).isVisible(), 'a new broadcast does not start with a heading and a paragraph');
    // The saved-block library, read from the suite, is offered and inserts a copy.
    await group.getByText(LIBRARY_ROW.name, { exact: true }).waitFor({ state: 'visible' });
    await group.getByRole('button', { name: 'Insert copy', exact: true }).click();
    const inserted = await waitUntil(async () => {
      const values = await group.getByLabel('Text', { exact: true }).evaluateAll(els => els.map(el => el.value));
      return values.includes(LIBRARY_ROW.block.text) ? values : null;
    }, 3000);
    expect(inserted, `Insert copy did not add the saved block "${LIBRARY_ROW.block.text}"`);
    // Send to: the server's own counts, and no count nobody measured.
    const options = await page.getByLabel('Send to').locator('option').allTextContents();
    expect(options.some(t => t.startsWith(`VIP Whales (Platinum) (${WHALES_COUNT} contacts)`)), `Send to offers ${JSON.stringify(options)}`);
    expect(options.some(t => t === `List · ${STUB_LISTS[0].name} (${STUB_LISTS[0].count} contacts)`), `Send to offers no list: ${JSON.stringify(options)}`);
    expect(!options.some(t => /\(0\)|\(0 contacts\)/.test(t)), `Send to offers an unmeasured 0: ${JSON.stringify(options)}`);
    expect((await page.locator('[role="dialog"], [aria-modal="true"]').count()) === 0, 'a modal is open');
    await keepText('Broadcasts, New broadcast');
    await shot('broadcast-new');
    // At phone width the composer fits: nothing past an edge, no sideways scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    try {
      const edge = await studioPastEdge(page);
      expect(edge.bad.length === 0, `past an edge at 390: ${edge.bad.slice(0, 4).join(' | ')}`);
      expect(edge.pageScroll === 390 && edge.studioScroll <= edge.studioClient, `at 390 the page is ${edge.pageScroll} wide, the studio ${edge.studioScroll} of ${edge.studioClient}`);
      await keepText('Broadcasts, New broadcast at 390');
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(300);
    }
    return `All broadcasts' New broadcast opened the New broadcast section with focus on its heading; the builder shows ${adds} Add buttons and starts with a heading and a paragraph; the library's "${LIBRARY_ROW.name}" inserted a copy; Send to offers "VIP Whales (Platinum) (${WHALES_COUNT} contacts)" and no unmeasured 0; at 390 nothing is past an edge`;
  });

  await go('broadcast-draft', async () => {
    const group = composerGroup();
    await page.getByLabel('Subject', { exact: true }).fill(BC_SUBJECT);
    await group.getByLabel('Heading', { exact: true }).fill(BC_HEADING);
    await group.getByLabel('Text', { exact: true }).first().fill(BC_WORDS);
    expect(await page.getByText('Unsaved changes', { exact: true }).isVisible(), 'the composer does not say it has unsaved changes');
    // Fix round: a reload or a closed tab would drop these words, so the browser is told to ask first.
    expect(await leaveAsks(), 'with unsaved words a beforeunload is not cancelled, so a reload drops them without asking');
    const before = state.draftPosts.length;
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    expect(await sawStatus(DRAFT_SAVED), `after Save draft the status says ${JSON.stringify(await statusTexts(page))}`);
    const posts = state.draftPosts.slice(before);
    expect(posts.length === 1 && !posts[0].id, `Save draft posted ${JSON.stringify(posts.map(b => ({ id: b.id, subject: b.subject })))}`);
    const words = (posts[0].blocks || []).map(b => b.text);
    expect(posts[0].subject === BC_SUBJECT && words.includes(BC_HEADING) && words.includes(BC_WORDS) && words.includes(LIBRARY_ROW.block.text), `the draft carried ${JSON.stringify({ subject: posts[0].subject, words })}`);
    expect(posts[0].settings && posts[0].settings.include === 'all' && posts[0].settings.sendWhen === 'now', `the draft's settings are ${JSON.stringify(posts[0].settings)}`);
    expect((await page.getByText('Unsaved changes', { exact: true }).count()) === 0, '"Unsaved changes" stays after the save');
    expect(!(await leaveAsks()), 'after the save a beforeunload is still cancelled, so a reload asks over nothing unsaved');
    savedBlocks = posts[0].blocks;
    savedDraftId = state.drafts[0]?.id || '';
    // Leave: a new broadcast (nothing unsaved, so it does not ask), then Flows, then back.
    await tab('All broadcasts').click();
    const dialogsBefore = dialogs.length;
    await page.getByRole('button', { name: 'New broadcast', exact: true }).click();
    await focusedHeading('New broadcast');
    expect(dialogs.length === dialogsBefore, `New broadcast asked "${dialogs[dialogs.length - 1]}" with nothing unsaved`);
    expect((await page.getByLabel('Subject', { exact: true }).inputValue()) === '', 'New broadcast kept the saved subject');
    await tab('Flows').click();
    await page.getByRole('heading', { level: 2, name: 'All flows', exact: true }).waitFor({ state: 'visible' });
    const reads = state.answered.filter(a => a === 'GET /api/email/broadcast-drafts').length;
    await tab('Broadcasts').click();
    const open = page.getByRole('button', { name: `Open draft ${BC_SUBJECT}`, exact: true });
    await open.waitFor({ state: 'visible' });
    expect(state.answered.filter(a => a === 'GET /api/email/broadcast-drafts').length > reads, 'the Drafts list was not read again from the server');
    await keepText('Broadcasts, All broadcasts with a draft');
    await open.click();
    expect(await focusedHeading('Edit broadcast draft'), `Open draft left focus on ${JSON.stringify(await focused(page))}`);
    const subject = await page.getByLabel('Subject', { exact: true }).inputValue();
    const heading = await composerGroup().getByLabel('Heading', { exact: true }).inputValue();
    const texts = await composerGroup().getByLabel('Text', { exact: true }).evaluateAll(els => els.map(el => el.value));
    expect(subject === BC_SUBJECT && heading === BC_HEADING && texts.includes(BC_WORDS), `the reopened draft reads ${JSON.stringify({ subject, heading, texts })}`);
    await keepText('Broadcasts, a draft opened');
    return `Save draft posted one new draft with the subject, the heading, the words and the library's block; a reload would have asked before the save and not after it; after New broadcast, Flows and back, Drafts (read again) listed it, and Open draft put back "${subject}", its heading and its words`;
  });

  await go('broadcast-test-send', async () => {
    const previews = state.previewPosts.length;
    const tests = state.testSends.length;
    await page.getByLabel('Your address for tests', { exact: true }).fill(TEST_ADDRESS);
    await page.getByRole('button', { name: 'Send a test to me', exact: true }).click();
    expect(await sawStatus(`The email service accepted a test to ${TEST_ADDRESS}.`), `after Send a test to me the status says ${JSON.stringify(await statusTexts(page))}`);
    const asked = state.previewPosts.slice(previews);
    expect(asked.length === 1 && JSON.stringify(asked[0].blocks) === JSON.stringify(savedBlocks), `the test was rendered from ${JSON.stringify(asked.map(a => (a.blocks || []).map(b => b.kind)))}, not the draft's blocks`);
    const sent = state.testSends.slice(tests);
    expect(sent.length === 1, `${sent.length} POSTs reached /api/email/send`);
    expect(JSON.stringify(sent[0].recipients) === JSON.stringify([{ email: TEST_ADDRESS, name: 'Test' }]), `the test went to ${JSON.stringify(sent[0].recipients)}`);
    expect(String(sent[0].subject).startsWith('Test: ') && String(sent[0].html).includes(BC_WORDS) && String(sent[0].html).includes(BC_HEADING), `the test carried ${JSON.stringify({ subject: sent[0].subject, html: String(sent[0].html).slice(0, 160) })}`);
    return `one preview of the draft's ${savedBlocks.length} blocks, then one POST /api/email/send to ${TEST_ADDRESS} whose html carries the heading and the words`;
  });

  await go('broadcast-preview-check', async () => {
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const desktop = page.locator('iframe[title="Broadcast preview at desktop width"]');
    await desktop.waitFor({ state: 'visible' });
    expect(await sawStatus(PREVIEW_LABEL), `the preview's label is not said in a status region: ${JSON.stringify(await statusTexts(page))}`);
    const wide = Math.round((await desktop.boundingBox()).width);
    await page.getByRole('button', { name: 'Mobile width', exact: true }).click();
    const mobile = page.locator('iframe[title="Broadcast preview at mobile width"]');
    await mobile.waitFor({ state: 'visible' });
    const narrow = Math.round((await mobile.boundingBox()).width);
    expect(wide > 600 && narrow === 375, `the preview is ${wide}px at desktop width and ${narrow}px at mobile width`);
    expect((await page.getByRole('button', { name: 'Mobile width', exact: true }).getAttribute('aria-pressed')) === 'true', 'Mobile width is not marked pressed');
    const inside = await mobile.contentFrame().locator('body').innerText();
    expect(inside.includes(BC_WORDS), `the preview shows "${inside.slice(0, 120)}"`);
    await page.getByRole('button', { name: 'Desktop width', exact: true }).click();
    const lints = state.lintPosts.length;
    await page.getByRole('button', { name: 'Check this email', exact: true }).click();
    expect(await sawStatus('Check score 92. Add a plain text version.'), `after Check this email the status says ${JSON.stringify(await statusTexts(page))}`);
    expect(state.lintPosts.length === lints + 1 && state.lintPosts[lints].subject === BC_SUBJECT && String(state.lintPosts[lints].html).includes(BC_WORDS), `the check posted ${JSON.stringify(state.lintPosts.slice(lints).map(l => l.subject))}`);
    await keepText('Broadcasts, preview and check');
    await shot('broadcast-preview');
    // Fix round: an edit after the preview hides it and says so; the words put back show it again.
    const words = composerGroup().getByLabel('Text', { exact: true }).first();
    expect((await words.inputValue()) === BC_WORDS, `the first Text block reads ${JSON.stringify(await words.inputValue())}`);
    await words.fill(`${BC_WORDS} Edited after the preview.`);
    expect(await sawStatus(PREVIEW_STALE), `after an edit the status says ${JSON.stringify(await statusTexts(page))}`);
    expect((await page.locator('iframe[title^="Broadcast preview"]').count()) === 0, 'the preview of the old email is still drawn after an edit');
    await words.fill(BC_WORDS);
    await desktop.waitFor({ state: 'visible' });
    expect(!(await statusTexts(page)).some(t => t.includes(PREVIEW_STALE)), 'with the words put back the preview still says it changed');
    // Left at Mobile width with every group open, for the 390 check in broadcast-confirm.
    await page.getByRole('button', { name: 'Mobile width', exact: true }).click();
    await mobile.waitFor({ state: 'visible' });
    for (const name of ['A/B test and holdout', 'A text message with it', 'Link tracking']) {
      const summary = page.locator('summary', { hasText: name });
      if (!(await summary.evaluate(el => el.parentElement.open))) await summary.click();
      expect(await summary.evaluate(el => el.parentElement.open), `the "${name}" group did not open`);
    }
    return `Preview drew the draft at ${wide}px and at ${narrow}px with its words and said "${PREVIEW_LABEL}" in a status region; Check this email posted the rendered html once and said the score and the warning; an edit hid the preview and said it changed, and the words put back showed it again`;
  });

  await go('broadcast-confirm', async () => {
    await page.getByLabel('Send to').selectOption('whales');
    const posts = state.campaignPosts.length;
    const asked = dialogs.length;
    await page.getByRole('button', { name: 'Send now', exact: true }).click();
    const msg = await waitUntil(async () => (dialogs.length > asked ? dialogs[dialogs.length - 1] : null), 5000);
    expect(msg, 'Send now did not ask first');
    expect(msg.startsWith(`Send "${BC_SUBJECT}" now to VIP Whales (Platinum)?`) && msg.includes(`The server counted ${WHALES_COUNT} contacts in this segment who accept marketing.`), `Send now asked "${msg}"`);
    expect(!/—| – /.test(msg), `the question has a dash: ${msg}`);
    expect(await sawStatus('Nothing was sent.'), `after Cancel the status says ${JSON.stringify(await statusTexts(page))}`);
    expect(state.campaignPosts.length === posts, `Cancel still posted ${state.campaignPosts.length - posts} sends`);
    // Fix round: at 390 with the 375px preview, every group open and that sentence in the sticky bar.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    let edgeNote = '';
    try {
      const mobile = page.locator('iframe[title="Broadcast preview at mobile width"]');
      expect(await mobile.isVisible(), 'the mobile preview is not drawn for the 390 check');
      const frame = await mobile.boundingBox();
      expect(frame.x >= -0.5 && frame.x + frame.width <= 390.5, `at 390 the preview runs ${Math.round(frame.x)}..${Math.round(frame.x + frame.width)}`);
      const sticky = await page.evaluate(() => {
        const p = [...document.querySelectorAll('[role="status"]')].find(el => (el.textContent || '').trim() === 'Nothing was sent.');
        const r = p ? p.parentElement.getBoundingClientRect() : null;
        return r ? { left: r.left, right: r.right } : null;
      });
      expect(sticky && sticky.left >= -0.5 && sticky.right <= 390.5, `at 390 the sticky bar with its status runs ${JSON.stringify(sticky)}`);
      const edge = await studioPastEdge(page);
      expect(edge.bad.length === 0, `past an edge at 390: ${edge.bad.slice(0, 4).join(' | ')}`);
      expect(edge.pageScroll === 390 && edge.studioScroll <= edge.studioClient, `at 390 the page is ${edge.pageScroll} wide, the studio ${edge.studioScroll} of ${edge.studioClient}`);
      await keepText('Broadcasts, the composer at 390 with every group open');
      edgeNote = `; at 390 the ${Math.round(frame.width)}px preview, the open groups and the sticky bar are inside the screen (${edge.seen} controls measured)`;
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(300);
    }
    return `Send now asked "${msg}"; Cancel sent nothing${edgeNote}`;
  });

  await go('broadcast-payload', async () => {
    await page.getByLabel('When to send', { exact: true }).selectOption('clock');
    await page.getByLabel(/^Date and time, in the account timezone/).fill(SCHEDULE_AT);
    const schedule = page.getByRole('button', { name: 'Schedule', exact: true });
    await schedule.waitFor({ state: 'visible' });
    const posts = state.campaignPosts.length;
    const asked = dialogs.length;
    acceptNextDialog = true;
    await schedule.click();
    const sent = await waitUntil(async () => (state.campaignPosts.length > posts ? state.campaignPosts.slice(posts) : null), 5000);
    expect(sent && sent.length === 1, `Schedule posted ${sent ? sent.length : 0} sends`);
    const msg = dialogs[asked] || '';
    expect(msg.startsWith(`Schedule "${BC_SUBJECT}" for VIP Whales (Platinum) on 2030-01-15 at 09:30`) && msg.includes(`${WHALES_COUNT} contacts`), `Schedule asked "${msg}"`);
    const body = sent[0];
    expect(Array.isArray(body.blocks) && JSON.stringify(body.blocks) === JSON.stringify(savedBlocks), `the send carried blocks ${JSON.stringify((body.blocks || []).map(b => b.kind))}, not the draft's`);
    expect(!('body' in body) && !('bodyText' in body), `the send also carried a flattened body: ${Object.keys(body).join(', ')}`);
    expect(body.when === 'clock' && body.sendAt === SCHEDULE_AT, `the send's schedule is ${JSON.stringify({ when: body.when, sendAt: body.sendAt })}`);
    expect(JSON.stringify(body.include) === JSON.stringify([{ type: 'segment', id: 'whales' }]) && body.subject === BC_SUBJECT, `the send named ${JSON.stringify({ include: body.include, subject: body.subject })}`);
    expect(JSON.stringify(body.holdout) === JSON.stringify({ enabled: false }) && JSON.stringify(body.ab) === JSON.stringify({ variable: 'off' }), `A/B and holdout read ${JSON.stringify({ ab: body.ab, holdout: body.holdout })}`);
    expect(typeof body.requestId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.requestId), `the send carried requestId ${JSON.stringify(body.requestId)}`);
    // The answer: All broadcasts, its sentence, focus on its heading, and the sent draft gone from Drafts.
    expect(await focusedHeading('All broadcasts'), `after the schedule focus is on ${JSON.stringify(await focused(page))}`);
    expect(await sawStatus('Scheduled. Nothing was sent. Its draft was removed from Drafts.'), `after the schedule the status says ${JSON.stringify(await statusTexts(page))}`);
    expect(state.draftDeletes.includes(savedDraftId), `the scheduled draft ${savedDraftId} was not deleted: ${JSON.stringify(state.draftDeletes)}`);
    expect((await page.getByRole('button', { name: `Open draft ${BC_SUBJECT}`, exact: true }).count()) === 0, 'the scheduled draft is still listed under Drafts');
    await keepText('Broadcasts, after a schedule');
    return `Schedule asked "${msg.slice(0, 90)}..." and posted one send with the draft's ${body.blocks.length} blocks, when clock at ${body.sendAt}, to whales; All broadcasts says it was scheduled and its draft removed`;
  });

  // ---- Fix round: what Send refuses, a retry, a failed audience, the replace question, Delete ----
  /** Waits for a dialog after `asked`, or answers null. */
  const nextDialog = async asked => waitUntil(async () => (dialogs.length > asked ? dialogs[dialogs.length - 1] : null), 3000);

  await go('broadcast-send-guards', async () => {
    await page.getByRole('button', { name: 'New broadcast', exact: true }).click();
    await focusedHeading('New broadcast');
    const subject = 'Guard check, from the studio check';
    await page.getByLabel('Subject', { exact: true }).fill(subject);
    let posts = state.campaignPosts.length;
    let asked = dialogs.length;
    await page.getByRole('button', { name: 'Send now', exact: true }).click();
    expect(await sawStatus(BLANK_EMAIL), `Send now with blank blocks says ${JSON.stringify(await statusTexts(page))}`);
    expect(dialogs.length === asked, `Send now with blank blocks asked "${dialogs[dialogs.length - 1]}"`);
    expect(state.campaignPosts.length === posts, 'Send now with blank blocks posted a send');
    // With words: a send the server never answers, then Send now again for the same email.
    await composerGroup().getByLabel('Text', { exact: true }).first().fill('Guard check words.');
    state.campaignMode = 'abort';
    acceptNextDialog = true;
    await page.getByRole('button', { name: 'Send now', exact: true }).click();
    const lost = await waitUntil(async () => (state.campaignPosts.length > posts ? state.campaignPosts[posts] : null), 5000);
    expect(lost, 'the first Send now posted nothing');
    expect(await sawStatus('The server did not answer, so this broadcast may or may not have gone out.'), `after an unanswered send the status says ${JSON.stringify(await statusTexts(page))}`);
    state.campaignMode = 'answer';
    posts = state.campaignPosts.length;
    asked = dialogs.length;
    acceptNextDialog = true;
    await page.getByRole('button', { name: 'Send now', exact: true }).click();
    const retry = await waitUntil(async () => (state.campaignPosts.length > posts ? state.campaignPosts[posts] : null), 5000);
    expect(retry, 'Send now again posted nothing');
    expect(dialogs.length > asked, 'Send now again did not ask first');
    expect(typeof lost.requestId === 'string' && lost.requestId.length >= 8 && retry.requestId === lost.requestId, `the retry carried requestId ${JSON.stringify(retry.requestId)}, the unanswered send ${JSON.stringify(lost.requestId)}`);
    expect(await focusedHeading('All broadcasts'), `after the send focus is on ${JSON.stringify(await focused(page))}`);
    expect(await sawStatus(`Sent to ${WHALES_COUNT} recipients.`), `after the send the status says ${JSON.stringify(await statusTexts(page))}`);
    return `blank blocks: "${BLANK_EMAIL}" and nothing asked or posted; an unanswered send and Send now again carried one requestId (${lost.requestId.slice(0, 8)}...), and the answered one landed on All broadcasts`;
  });

  await go('broadcast-audience-failed', async () => {
    state.segmentsMode = 'fail';
    try {
      await page.getByRole('button', { name: 'New broadcast', exact: true }).click();
      await focusedHeading('New broadcast');
      await page.getByText('The segments could not be loaded. Try again in a minute.', { exact: true }).waitFor({ state: 'visible' });
      expect((await page.getByLabel('Send to').count()) === 0, 'Send to is offered with the segments not loaded');
      await page.getByLabel('Subject', { exact: true }).fill('Audience check, from the studio check');
      await composerGroup().getByLabel('Text', { exact: true }).first().fill('Audience check words.');
      const posts = state.campaignPosts.length;
      const asked = dialogs.length;
      await page.getByRole('button', { name: 'Send now', exact: true }).click();
      expect(await sawStatus(AUDIENCE_UNLOADED), `Send now with no audience loaded says ${JSON.stringify(await statusTexts(page))}`);
      expect(dialogs.length === asked, `Send now with no audience loaded asked "${dialogs[dialogs.length - 1]}"`);
      expect(state.campaignPosts.length === posts, 'Send now with no audience loaded posted a send');
    } finally {
      state.segmentsMode = 'answer';
    }
    // Fix round: Retry is named for what failed (retryLabel), so it is told from any other Retry.
    await page.getByRole('button', { name: retryLabel('The segments could not be loaded. Try again in a minute.'), exact: true }).click();
    await page.getByLabel('Send to').waitFor({ state: 'visible' });
    return `the failed read said so with Retry and no Send to; Send now said "${AUDIENCE_UNLOADED}" and asked and posted nothing; Retry loaded Send to`;
  });

  await go('broadcast-replace-delete', async () => {
    // The work from broadcast-audience-failed is unsaved, and the sticky bar says so in a status region.
    const unsavedStatus = page.locator('[role="status"]', { hasText: /^Unsaved changes$/ });
    expect((await unsavedStatus.count()) === 1, `"Unsaved changes" is in ${await unsavedStatus.count()} status regions`);
    const subjectField = page.getByLabel('Subject', { exact: true });
    const before = await subjectField.inputValue();
    await page.locator('summary', { hasText: 'Start from a written draft' }).click();
    const vip = page.getByRole('button', { name: 'VIP thank-you', exact: true });
    let asked = dialogs.length;
    await vip.click();
    const question = await nextDialog(asked);
    expect(question === COMPOSER_REPLACE, `a written draft over unsaved work asked ${JSON.stringify(question)}`);
    expect((await subjectField.inputValue()) === before, 'Cancel on the replace question still replaced the email');
    acceptNextDialog = true;
    asked = dialogs.length;
    await vip.click();
    expect((await nextDialog(asked)) === COMPOSER_REPLACE, 'the second VIP thank-you did not ask');
    await waitUntil(async () => ((await subjectField.inputValue()) === VIP_SUBJECT ? true : null), 3000);
    const preheader = await page.getByLabel('Preview text', { exact: true }).inputValue();
    const words = await composerGroup().getByLabel('Text', { exact: true }).first().inputValue();
    expect(words.includes('Replace this text with your real message'), `the written draft reads ${JSON.stringify(words.slice(0, 120))}`);
    const noted = [VIP_SUBJECT, preheader, words].filter(text => /\bnotes?\b/i.test(text));
    expect(noted.length === 0, `the written draft calls the email a note: ${JSON.stringify(noted)}`);
    await keepText('Broadcasts, a written draft');
    // Save it, then delete it from All broadcasts.
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    expect(await sawStatus(DRAFT_SAVED), `after Save draft the status says ${JSON.stringify(await statusTexts(page))}`);
    await tab('All broadcasts').click();
    const remove = page.getByRole('button', { name: `Delete draft ${VIP_SUBJECT}`, exact: true });
    await remove.waitFor({ state: 'visible' });
    const deletes = state.draftDeletes.length;
    asked = dialogs.length;
    acceptNextDialog = true;
    await remove.click();
    const confirmDelete = await nextDialog(asked);
    expect(confirmDelete === `Delete the draft "${VIP_SUBJECT}"? This cannot be undone.`, `Delete asked ${JSON.stringify(confirmDelete)}`);
    await waitUntil(async () => (state.draftDeletes.length > deletes ? true : null), 5000);
    expect(state.draftDeletes.length === deletes + 1, `Delete sent ${state.draftDeletes.length - deletes} DELETEs`);
    expect(await sawStatus(`Deleted the draft "${VIP_SUBJECT}".`), `after Delete the status says ${JSON.stringify(await statusTexts(page))}`);
    const f = await waitUntil(async () => {
      const now = await focused(page);
      return now && now.tag === 'h3' && now.text === 'Drafts' ? now : null;
    }, 3000);
    expect(f, `after Delete focus is on ${JSON.stringify(await focused(page))}`);
    expect((await remove.count()) === 0, 'the deleted draft is still listed');
    return `"Unsaved changes" is a status region; VIP thank-you over unsaved work asked "${COMPOSER_REPLACE}", Cancel kept it, OK wrote "${VIP_SUBJECT}" with no "note"; Delete asked, sent one DELETE, said so, and focus is on the Drafts heading`;
  });

  await go('nav-from-step', async () => {
    // The canvas entry, as an owner takes it. Signed out, the journey saves to this browser, and only
    // a save that landed opens the studio (openAfterSave).
    await tab('Flows').click();
    await page.getByRole('button', { name: 'Back to Canvas', exact: true }).click();
    const node = page.locator(`.react-flow__node[data-id="${SEQ_STEP}"]`);
    await node.waitFor({ state: 'visible', timeout: 15000 });
    await node.click();
    const picker = page.getByLabel('Jourvance flow for this follow-up', { exact: true });
    await picker.waitFor({ state: 'visible' });
    const listed = await waitUntil(async () => ((await picker.locator(`option[value="${STEP_FLOW}"]`).count()) ? true : null), 5000);
    expect(listed, `the step's flow picker never listed ${STEP_FLOW}`);
    await picker.selectOption(STEP_FLOW);
    await page.getByRole('button', { name: 'Edit this flow in Email Studio', exact: true }).click();
    await page.getByRole('heading', { level: 2, name: 'Flow map', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    const want = state.flows.find(f => f.id === STEP_FLOW)?.name;
    const chosen = await waitUntil(async () => (await chosenFlow(page)) || null, 5000);
    expect((await isSelected('Flows')) && (await isSelected('Flow map')), `Flows selected ${await isSelected('Flows')}, Flow map selected ${await isSelected('Flow map')}`);
    expect(chosen === want, `the studio chose "${chosen}", not the step's flow "${want}"`);
    const back = page.getByRole('button', { name: 'Back to funnel', exact: true });
    expect(await back.isVisible(), 'the Back to funnel banner is not shown');
    expect((await page.getByRole('button', { name: 'Back to Canvas', exact: true }).count()) === 0, 'Back to Canvas shows while the banner is the way back');
    await shot('nav-from-step');
    await back.click();
    await page.waitForSelector(`.react-flow__node[data-id="${SEQ_STEP}"].selected`, { timeout: 8000 });
    const f = await waitUntil(async () => {
      const now = await focused(page);
      return now && now.tag === 'button' && now.text === 'Edit this flow in Email Studio' ? now : null;
    }, 5000);
    expect(f, `after Back to funnel focus is on ${JSON.stringify(await focused(page))}`);
    expect((await page.getByRole('heading', { level: 1, name: /Email Studio/ }).count()) === 0, 'the studio is still showing');
    return `step ${SEQ_STEP} with "${want}" chosen opened Flows, Flow map on "${chosen}" under the Back to funnel banner; Back to funnel selected ${SEQ_STEP} with focus on "${f.text}"`;
  });

  // ---- Wave 6: honest states (D6). Each step opens the studio in a fresh context whose studio reads
  // all answer one way, and walks every destination. They share nothing with the page above, so each one
  // runs whatever an earlier step did. ----
  const unansweredSays = failed => `${failed} ${UNANSWERED_TAIL}`;
  const saysFor = (read, list) => ({ 401: read.signIn, 500: read.failed, unanswered: unansweredSays(read.failed), empty: list ? list.empty : null });
  const STATE_SCREENS = [
    { where: 'All flows', path: ['Flows', 'All flows'], says: { 401: FLOWS_SIGN_IN, 500: FLOWS_FAILED, unanswered: FLOW_MAP_UNREACHABLE, empty: FLOWS_EMPTY }, empty: FLOWS_EMPTY },
    { where: 'People in starter flows', path: ['Flows', 'All flows'], disclose: 'People in starter flows', says: saysFor(STARTER_PEOPLE_READ, STARTER_PEOPLE_LIST), empty: STARTER_PEOPLE_LIST.empty },
    { where: 'Flow map', path: ['Flows', 'Flow map'], says: { 401: FLOWS_SIGN_IN, 500: FLOWS_FAILED, unanswered: FLOW_MAP_UNREACHABLE, empty: null }, empty: null },
    { where: 'All broadcasts', path: ['Broadcasts', 'All broadcasts'], says: saysFor(BROADCASTS_READ, BROADCASTS_LIST), empty: BROADCASTS_LIST.empty },
    { where: 'People', path: ['Audience', 'People'], says: saysFor(PEOPLE_READ, PEOPLE_LIST), empty: PEOPLE_LIST.empty },
    { where: 'Sign-up forms', path: ['Audience', 'Sign-up forms'], says: saysFor(FORMS_READ, FORMS_LIST), empty: FORMS_LIST.empty },
    // oneAlert (fix round): two reads fail together here, and one cause is said in one alert.
    { where: 'Replies', path: ['Audience', 'Replies'], says: saysFor(REPLIES_READ, REPLIES_LIST), empty: REPLIES_LIST.empty, oneAlert: true },
    {
      where: 'Open checkouts', path: ['Audience', 'Open checkouts'], empty: CHECKOUTS_EMPTY,
      says: { 401: "Sign in to see this account's open checkouts.", 500: 'Open checkouts could not be loaded.', unanswered: 'Open checkouts could not be loaded. The server did not answer.', empty: CHECKOUTS_EMPTY }
    },
    { where: 'Results', path: ['Results'], says: saysFor(RESULTS_READ, RESULTS_LIST), empty: RESULTS_LIST.empty },
    { where: 'Sending', path: ['Settings', 'Sending'], says: saysFor(SENDING_READ, null), empty: null, oneAlert: true },
    // "Not connected." is a claim about the Klaviyo connection, so only an answer may say it.
    { where: 'Klaviyo', path: ['Settings', 'Klaviyo'], says: { ...saysFor(KLAVIYO_READ, null), empty: 'Not connected.' }, empty: 'Not connected.' },
    { where: 'Texts', path: ['Settings', /^Texts/], says: saysFor(TEXTS_READ, null), empty: null, oneAlert: true }
  ];
  const statesStep = mode => async () => {
    const aRead = mode === 'unanswered' ? 'an unanswered read' : `a ${mode} read`;
    const sstate = newState(seeds);
    // An account with no flow of its own: the flow map holds only the starter, built-in and order flows.
    sstate.flows = [];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      await ctx.route('**/*', async route => {
        const req = route.request();
        if (routeVerdict(req.url(), origin) === 'continue') return route.continue();
        try {
          const u = new URL(req.url());
          if (u.origin === origin) {
            const answer = statesAnswer(mode, req, u, sstate);
            if (answer === 'abort') return route.abort();
            if (answer) return route.fulfill(answer);
          }
        } catch {}
        blocked.push(`${req.method()} ${req.url().slice(0, 100)}`);
        return route.abort();
      });
      await ctx.addInitScript(([key, value]) => {
        if (window.top !== window) return;
        if (sessionStorage.getItem('jv-studio-check-seeded')) return;
        sessionStorage.setItem('jv-studio-check-seeded', '1');
        localStorage.setItem(key, value);
      }, [STORAGE_KEY, JSON.stringify(DEFAULT_LEAD_CAPTURE_PROJECT)]);
      const sp = await ctx.newPage();
      sp.setDefaultTimeout(8000);
      const pageErrors = [];
      sp.on('pageerror', err => pageErrors.push(String(err?.message || err)));
      sp.on('dialog', d => d.dismiss().catch(() => {}));
      await sp.goto(`${origin}/canvas`);
      const studio = sp.getByRole('button', { name: 'Switch to Email Studio view' });
      await studio.waitFor({ state: 'visible', timeout: 20000 });
      await studio.click();
      await sp.getByRole('heading', { level: 1, name: /Email Studio/ }).waitFor({ state: 'visible', timeout: 15000 });
      const stab = name => sp.getByRole('tab', typeof name === 'string' ? { name, exact: true } : { name });
      const seen = [];
      for (const screen of STATE_SCREENS) {
        // A click that times out names its screen, its target and Playwright's last reasons, so a failure
        // says which tab or disclosure could not be reached and why.
        const named = (what, err) => new Error(`${screen.where}: ${what} could not be clicked: ${String(err?.message || err).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400)}`);
        for (const name of screen.path) await stab(name).click().catch(err => { throw named(`the ${name} tab`, err); });
        if (screen.disclose) {
          const summary = sp.locator('summary', { hasText: screen.disclose });
          if (!(await summary.evaluate(el => el.parentElement?.open === true))) await summary.click().catch(err => { throw named(`"${screen.disclose}"`, err); });
        }
        const want = screen.says[mode];
        if (want) {
          const shown = await waitUntil(async () => ((await studioText(sp)).includes(want) ? true : null), 6000);
          expect(shown, `${screen.where}: "${want}" is not on screen`);
        }
        const text = await studioText(sp);
        if (mode === 'empty') {
          const failures = await sp.locator('[role="alert"]').evaluateAll(els => els.filter(el => el.getBoundingClientRect().height > 0).map(el => (el.textContent || '').trim().slice(0, 80)));
          expect(failures.length === 0, `${screen.where}: lists that answered empty drew a failure: ${JSON.stringify(failures)}`);
        } else {
          if (screen.empty) expect(!text.includes(screen.empty), `${screen.where}: ${aRead} says "${screen.empty}"`);
          const alert = sp.locator('[role="alert"]', { hasText: want });
          expect((await alert.count()) >= 1, `${screen.where}: "${want}" is not said in an alert`);
          const buttons = await alert.first().getByRole('button').count();
          if (mode === '401') expect(buttons === 0, `${screen.where}: a signed-out read offers ${buttons} button(s) to try again`);
          else {
            expect(buttons >= 1, `${screen.where}: ${aRead} offers no Retry`);
            // Fix round: the Retry is named for the read it tries again, and no button is only "Retry".
            // The failure may carry the server's own words after the screen's sentence (Open checkouts does).
            const nameRe = new RegExp(`^${retryLabel(want).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
            const named = await alert.first().getByRole('button', { name: nameRe }).count();
            const bare = await sp.getByRole('button', { name: /^(Retry|Retrying|Try again|Loading)$/ }).count();
            expect(named >= 1, `${screen.where}: no Retry is named "${retryLabel(want)}..."`);
            expect(bare === 0, `${screen.where}: ${bare} button(s) named only Retry, Try again or Loading`);
          }
          if (mode === '500' && screen.where === 'Replies') {
            // Fix round: a Retry that fails again with the same words draws the failure as a new node (so a
            // screen reader says it again), and keyboard focus stays on Retry.
            const box = alert.first();
            await box.locator('span').first().evaluate(el => { el.setAttribute('data-check-round', 'before'); });
            await box.getByRole('button', { name: retryLabel(want), exact: true }).click();
            const redrawn = await waitUntil(async () => ((await sp.locator('[role="alert"] [data-check-round="before"]').count()) === 0
              && (await sp.locator('[role="alert"]', { hasText: want }).count()) >= 1 ? true : null), 5000);
            expect(redrawn, `${screen.where}: a Retry that failed again left the same failure node, so it is not said again`);
            const f = await waitUntil(async () => {
              const now = await focused(sp);
              return now && now.tag === 'button' && now.label === retryLabel(want) ? now : null;
            }, 3000);
            expect(f, `${screen.where}: after the Retry failed again focus is on ${JSON.stringify(await focused(sp))}`);
          }
          if (screen.oneAlert) {
            const shown = await sp.locator('[role="alert"]').evaluateAll(els => els.filter(el => el.getBoundingClientRect().height > 0).map(el => (el.textContent || '').trim().slice(0, 80)));
            expect(shown.length === 1, `${screen.where}: one cause raised ${shown.length} alerts: ${JSON.stringify(shown)}`);
          }
        }
        texts.push({ where: `states-${mode}: ${screen.where}`, text });
        if (shots) await sp.screenshot({ path: path.join(shots, `states-${mode}-${screen.where.replace(/\W+/g, '-')}.png`) });
        seen.push(screen.where);
      }
      expect(pageErrors.length === 0, `page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
      return mode === 'empty'
        ? `every list answered empty: ${seen.length} screens each said their empty sentence where they have one, and none drew a failure (${seen.join(', ')})`
        : `every studio read ${mode === 'unanswered' ? 'aborted' : `answered ${mode}`}: ${seen.length} screens each said their failure in an alert, ${mode === '401' ? 'with no button to try again' : 'with a Retry named for it and no button named only Retry'}, Replies, Sending and Texts with one alert each, and none said its empty sentence (${seen.join(', ')})${mode === '500' ? '; on Replies a Retry that failed again redrew its failure and kept focus' : ''}`;
    } finally {
      await ctx.close();
    }
  };
  // Fix round: two reads fail while every other read answers, a case the four steps below cannot draw
  // because each answers every read one way. Sending's postal address (GET /api/email/suite) and Texts'
  // phone count (GET /api/email/audience). Like them, it shares nothing with the page above.
  ran.push(await step('states-mixed', async () => {
    const sstate = newState(seeds);
    sstate.flows = [];
    sstate.mixedFails = ['/api/email/suite', '/api/email/audience'];
    const postal = [];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      await ctx.route('**/*', async route => {
        const req = route.request();
        if (routeVerdict(req.url(), origin) === 'continue') return route.continue();
        try {
          const u = new URL(req.url());
          if (u.origin === origin) {
            // emailRoutes.mjs POST /api/email/postal: { success: true, physicalAddress }.
            if (req.method() === 'POST' && u.pathname === '/api/email/postal') {
              postal.push(req.postDataJSON());
              sstate.answered.push('POST /api/email/postal (mixed)');
              return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, physicalAddress: '' }) });
            }
            const answer = statesAnswer('mixed', req, u, sstate);
            if (answer === 'abort') return route.abort();
            if (answer) return route.fulfill(answer);
          }
        } catch {}
        blocked.push(`${req.method()} ${req.url().slice(0, 100)}`);
        return route.abort();
      });
      await ctx.addInitScript(([key, value]) => {
        if (window.top !== window) return;
        if (sessionStorage.getItem('jv-studio-check-seeded')) return;
        sessionStorage.setItem('jv-studio-check-seeded', '1');
        localStorage.setItem(key, value);
      }, [STORAGE_KEY, JSON.stringify(DEFAULT_LEAD_CAPTURE_PROJECT)]);
      const sp = await ctx.newPage();
      sp.setDefaultTimeout(8000);
      const pageErrors = [];
      sp.on('pageerror', err => pageErrors.push(String(err?.message || err)));
      sp.on('dialog', d => d.dismiss().catch(() => {}));
      await sp.goto(`${origin}/canvas`);
      const studio = sp.getByRole('button', { name: 'Switch to Email Studio view' });
      await studio.waitFor({ state: 'visible', timeout: 20000 });
      await studio.click();
      await sp.getByRole('heading', { level: 1, name: /Email Studio/ }).waitFor({ state: 'visible', timeout: 15000 });
      const stab = name => sp.getByRole('tab', typeof name === 'string' ? { name, exact: true } : { name });
      const visibleAlerts = () => sp.locator('[role="alert"]').evaluateAll(els => els.filter(el => el.getBoundingClientRect().height > 0).map(el => (el.textContent || '').trim().slice(0, 80)));
      const onScreen = async want => waitUntil(async () => ((await studioText(sp)).includes(want) ? true : null), 6000);

      // Sending: the senders loaded and the postal address did not.
      await stab('Settings').click();
      await stab('Sending').click();
      expect(await onScreen(POSTAL_READ.failed), `Sending: "${POSTAL_READ.failed}" is not on screen`);
      expect(!(await studioText(sp)).includes(SENDING_READ.failed), `Sending: the senders read loaded, yet "${SENDING_READ.failed}" is said`);
      const sendingAlerts = await visibleAlerts();
      expect(sendingAlerts.length === 1 && sendingAlerts[0].includes(POSTAL_READ.failed), `Sending: alerts ${JSON.stringify(sendingAlerts)}`);
      texts.push({ where: 'states-mixed: Sending', text: await studioText(sp) });
      // Save Postal Footer from the empty field saves nothing while the stored address is unread. It is
      // aria-disabled, which Playwright treats as disabled, but a person can still press it, so the
      // click is forced to reach the guard the way their click does.
      const save = sp.getByRole('button', { name: 'Save Postal Footer', exact: true });
      expect((await save.getAttribute('aria-disabled')) === 'true', `Save Postal Footer is not marked unavailable while the address is unread (aria-disabled ${await save.getAttribute('aria-disabled')})`);
      await save.click({ force: true });
      expect(await onScreen(POSTAL_NOT_SAVED), `Save Postal Footer with the address unread does not say "${POSTAL_NOT_SAVED}"`);
      await new Promise(r => setTimeout(r, 300));
      expect(postal.length === 0, `Save Postal Footer with the address unread posted ${JSON.stringify(postal)}`);
      const retry = sp.getByRole('button', { name: retryLabel(POSTAL_READ.failed), exact: true });
      expect((await retry.count()) === 1, `Sending: ${await retry.count()} Retry button(s) named "${retryLabel(POSTAL_READ.failed)}"`);
      // Positive control: once the read answers, Retry loads it and the same button saves.
      sstate.mixedFails = ['/api/email/audience'];
      await retry.click();
      const loaded = await waitUntil(async () => ((await studioText(sp)).includes(POSTAL_READ.failed) ? null : true), 6000);
      expect(loaded, 'Sending: Retry with the address read answering did not clear its failure');
      expect(!(await studioText(sp)).includes(POSTAL_NOT_SAVED), `Sending: the address loaded, yet "${POSTAL_NOT_SAVED}" is still said`);
      expect((await save.getAttribute('aria-disabled')) === null, 'Save Postal Footer is still marked unavailable once the address loaded');
      await save.click();
      expect(await waitUntil(async () => (postal.length === 1 ? true : null), 4000), `Save Postal Footer after the address loaded posted ${postal.length} time(s)`);

      // Texts: the status loaded and the phone count did not.
      await stab(/^Texts/).click();
      expect(await onScreen(PHONES_READ.failed), `Texts: "${PHONES_READ.failed}" is not on screen`);
      expect(!(await studioText(sp)).includes(TEXTS_READ.failed), `Texts: the status read loaded, yet "${TEXTS_READ.failed}" is said`);
      const textsAlerts = await visibleAlerts();
      expect(textsAlerts.length === 1 && textsAlerts[0].includes(PHONES_READ.failed), `Texts: alerts ${JSON.stringify(textsAlerts)}`);
      const phoneRetry = sp.getByRole('button', { name: retryLabel(PHONES_READ.failed), exact: true });
      expect((await phoneRetry.count()) === 1, `Texts: ${await phoneRetry.count()} Retry button(s) named "${retryLabel(PHONES_READ.failed)}"`);
      texts.push({ where: 'states-mixed: Texts', text: await studioText(sp) });
      sstate.mixedFails = [];
      await phoneRetry.click();
      expect(await onScreen('contacts have phones on file'), 'Texts: Retry with the audience answering did not count the phones');
      expect(pageErrors.length === 0, `page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
      return `Sending said "${POSTAL_READ.failed}" in its one alert, Save Postal Footer said "${POSTAL_NOT_SAVED}" and posted nothing, then Retry loaded it and Save posted once; Texts said "${PHONES_READ.failed}" in its one alert with a named Retry, which counted the phones`;
    } finally {
      await ctx.close();
    }
  }));
  for (const mode of ['401', '500', 'unanswered', 'empty']) ran.push(await step(`states-${mode}`, statesStep(mode)));

  await go('no-dash', async () => {
    expect(texts.length >= 6, `only ${texts.length} screens were read`);
    const dashed = [];
    for (const { where, text } of texts) {
      expect(text.length > 200, `the studio text read on "${where}" is ${text.length} characters, so it proves nothing`);
      for (const line of text.split('\n')) if (/—| – /.test(line)) dashed.push(`${where}: ${line.trim().slice(0, 80)}`);
    }
    expect(dashed.length === 0, `dashes: ${dashed.slice(0, 4).join(' | ')}`);
    // D2 retires "letter" for one email. The Flows screens are this wave's; the others are counted, not judged.
    const flowsScreen = where => /^(All flows|Flow map)/.test(where);
    const lettered = texts.flatMap(({ where, text }) => text.split('\n').filter(line => /\bletters?\b/i.test(line)).map(line => ({ where, line: line.trim().slice(0, 80) })));
    const onFlows = lettered.filter(row => flowsScreen(row.where));
    expect(onFlows.length === 0, `the Flows screens say "letter": ${onFlows.slice(0, 4).map(r => `${r.where}: ${r.line}`).join(' | ')}`);
    const flowScreens = texts.filter(t => flowsScreen(t.where)).length;
    // Wave 6 (D2): on every states screen, none of the retired words, once the subjects and preview
    // texts of the server's seeded flows (an email's own words, which the owner edits) are taken out.
    // A seeded flow's NAME is not taken out: no owner can rename a starter, built-in or order flow, so
    // its name is the studio's own copy ("Welcome sequence" passed here while it was exempt).
    const seeded = [...seeds.sequences, ...seeds.automations, ...seeds.transactional]
      .flatMap(row => [row.subject, ...(row.steps || []).flatMap(step => [step.subject, step.previewText])])
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    const stateScreens = texts.filter(t => t.where.startsWith('states-'));
    expect(stateScreens.length >= 40, `only ${stateScreens.length} states screens were read`);
    const retired = stateScreens.flatMap(({ where, text }) => text.split('\n').flatMap(line => retiredIn(line, seeded).map(word => `${where}: "${word}" in ${line.trim().slice(0, 80)}`)));
    expect(retired.length === 0, `retired words (D2): ${retired.slice(0, 4).join(' | ')}`);
    return `${texts.length} screens read with their aria-label, placeholder and title values, no em dash and no spaced en dash; "letter" on none of the ${flowScreens} Flows screens, and on ${lettered.length - onFlows.length} lines of the others (not judged here); none of D2's retired words on the ${stateScreens.length} states screens`;
  });

  await go('runtime', async () => {
    expect(errors.length === 0, `page errors: ${errors.slice(0, 3).join(' | ')}`);
    return 'no uncaught page error';
  });

  await context.close();
  return { results, state };
}

async function main(cleanup) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    say(`check:email-studio could not run. ${err.message}`);
    return 2;
  }
  let seeds;
  try {
    seeds = readSeeds();
  } catch (err) {
    say(`check:email-studio could not run. The seeds could not be read: ${err.message}`);
    return 2;
  }
  const pwPath = process.env.PLAYWRIGHT_MODULE || path.resolve(ROOT, '../../node_modules/playwright/index.mjs');
  if (!fs.existsSync(pwPath)) {
    say(`check:email-studio could not run. Playwright was not found at ${pwPath}.`);
    return 2;
  }
  const chromePath = process.env.CHROME_PATH || DEFAULT_CHROME;
  if (!fs.existsSync(chromePath)) {
    say(`check:email-studio could not run. Chrome was not found at ${chromePath}.`);
    return 2;
  }
  const { chromium } = await import(pathToFileURL(pwPath).href);
  if (opts.shots) fs.mkdirSync(opts.shots, { recursive: true });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-studio-check-'));
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-studio-env-'));
  cleanup.dirs.push(work, envDir);
  const outDir = path.join(work, 'dist');
  try {
    await build({ root: ROOT, envDir, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  } catch (err) {
    say(`check:email-studio could not run. The app did not build: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }
  let origin;
  let port;
  try {
    port = Number(process.env.CHECK_STUDIO_PORT) || (await freePort());
    const server = await preview({
      root: ROOT,
      envDir,
      logLevel: 'warn',
      build: { outDir },
      preview: { host: '127.0.0.1', port, strictPort: true, proxy: {}, open: false }
    });
    cleanup.server = server;
    origin = new URL(server.resolvedUrls.local[0]).origin;
  } catch (err) {
    say(`check:email-studio could not run. The preview could not bind port ${port ?? 'on 127.0.0.1'}: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }

  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  cleanup.browser = browser;
  const blocked = [];
  say('Email Studio browser check: /canvas, then Email Studio, at 1440x900.');
  const { results, state } = await runChecks(browser, origin, opts.shots, blocked, seeds);
  const failed = results.filter(r => !r.ok);
  say(`${results.length - failed.length} of ${results.length} steps passed.`);
  const routes = [...new Set(state.answered)].sort();
  say(`Answered ${state.answered.length} studio requests with recorded JSON (${routes.length} distinct: ${routes.join(', ')}).`);
  const apiBlocked = blocked.filter(b => /\/api\//.test(b) && b.includes(origin));
  const hosts = [...new Set(blocked.map(b => b.split(' ')[1]?.split('/')[2] ?? ''))].filter(Boolean).sort();
  say(`Blocked ${blocked.length} other requests (${hosts.join(', ') || 'none'}), ${apiBlocked.length} of them /api requests on the preview: ${[...new Set(apiBlocked.map(b => b.replace(origin, '')))].join(', ') || 'none'}. Nothing reached a server.`);
  return failed.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cleanup = { dirs: [], server: null, browser: null, done: false };
  const finish = async () => {
    if (cleanup.done) return;
    cleanup.done = true;
    await cleanup.browser?.close().catch(() => {});
    await cleanup.server?.close().catch(() => {});
    for (const d of cleanup.dirs) fs.rmSync(d, { recursive: true, force: true });
  };
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      finish().finally(() => process.exit(2));
    });
  }
  main(cleanup)
    .catch(err => {
      say(`check:email-studio could not run. ${String(err?.message || err).split('\n')[0]}`);
      return 2;
    })
    .then(async code => {
      await finish();
      process.exit(code);
    });
}
