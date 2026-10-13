// Draft this email with AI in Email Studio, the browser side (ASK_JOURVANCE_PLAN.md, Wave 3, W3.B).
// src/lib/emailDraft.ts is pure, so it is imported directly: the request body, the one reading of the
// route's answer, how a kept draft lands (subject filled, preview only when the draft has one,
// paragraphs APPENDED up to the block cap, never a block the person wrote replaced), and the drafting
// session the control runs, driven here with a request the test controls so the stale-reply rule is
// pinned by behaviour. The control's markup is bundled with esbuild and rendered with react-dom/server
// in each state, the way workspace-selector-keyboard.test.mjs renders its component. Firebase is
// stubbed in the bundle: nothing here signs in or reaches a network. The click paths (Keep, Discard,
// Stop, a reply after the broadcast was replaced, Keep never under the fixed bar) run in a real
// browser in scripts/email-draft-browser-check.mjs (npm run check:email-draft).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import {
  groundingLine, briefCount, briefProblem, emailDraftBody, readDraftOutcome, readDraft, draftToBlocks, draftFit, applyDraftToComposer, keptSentence,
  createDraftSession, DRAFT_LIMITS, EMAIL_BLOCK_CAP, BRIEF_PROBLEM, DRAFT_UNREACHABLE, DRAFT_SIGNED_OUT, DRAFT_UNREADABLE, DRAFT_TOO_MANY,
  DRAFT_BUSY, DRAFT_STOPPED, DRAFT_DISCARDED, GROUNDING_ACCOUNT, GROUNDING_GENERAL
} from './src/lib/emailDraft.ts';
import { readEmailCopyAnswer, readCopyAnswer } from './src/lib/pageCopyProposal.ts';
import { draftWouldClip } from './server/routes/broadcastDraftRoutes.mjs';
import { cleanFlow } from './email-flows.mjs';
import { cleanBlockList } from './email-doc.mjs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const EM = '\u2014';
const EN = '\u2013';

const DRAFT = { subject: 'Spring glaze class is open', previewText: 'Book a seat this week', paragraphs: ['Our spring glaze class is open.', 'Book a seat on the class page.'], cta: { label: 'Book a seat' } };

// A factory like the composer's: fresh ids, blank blocks, and the kinds it can make.
function factory(kinds = ['text', 'button']) {
  let n = 0;
  return {
    kinds,
    make: (kind) => (kind === 'button' ? { id: `f${++n}`, kind: 'button', label: 'Open', url: '' } : { id: `f${++n}`, kind: 'text', text: '', level: 0 })
  };
}
const textBlocks = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, kind: 'text', text: `Mine ${i}`, level: 0 }));

// ---- The pure module ----

test('groundingLine: each line claims no more than is known, the profile line only for account grounding', () => {
  assert.equal(GROUNDING_ACCOUNT, 'Uses your business profile, when the AI has it.');
  assert.equal(GROUNDING_GENERAL, 'Uses general guidance, not your profile.');
  assert.equal(groundingLine('account'), GROUNDING_ACCOUNT);
  for (const other of ['app', null, undefined, '', 'Account', 1]) assert.equal(groundingLine(other), GROUNDING_GENERAL, String(other));
});

test('the brief: counted trimmed against 300, "Too long." in words past it, refused empty or over with the server’s sentence', () => {
  assert.equal(DRAFT_LIMITS.brief, 300);
  assert.equal(briefCount(''), '0 of 300 characters');
  assert.equal(briefCount('  hello  '), '5 of 300 characters');
  assert.equal(briefCount('x'.repeat(300)), '300 of 300 characters');
  assert.equal(briefCount('x'.repeat(301)), '301 of 300 characters. Too long.');
  assert.equal(briefProblem(''), BRIEF_PROBLEM);
  assert.equal(briefProblem('   '), BRIEF_PROBLEM);
  assert.equal(briefProblem('x'.repeat(300)), '');
  assert.equal(briefProblem(` ${'x'.repeat(300)} `), '', 'spaces around it are not counted');
  assert.equal(briefProblem('x'.repeat(301)), BRIEF_PROBLEM);
  assert.equal(BRIEF_PROBLEM, 'Describe the email in up to 300 characters.');
});

test('emailDraftBody: the subject rides as a hint only when it fits, the trigger only on a flow step', () => {
  assert.deepEqual(emailDraftBody({ kind: 'broadcast', brief: ' Spring class ', subject: ' Spring ', trigger: 'order_paid' }), { kind: 'broadcast', brief: 'Spring class', subjectHint: 'Spring' });
  assert.deepEqual(emailDraftBody({ kind: 'broadcast', brief: 'b', subject: 'x'.repeat(121) }), { kind: 'broadcast', brief: 'b' }, 'a long subject is left out, never refused');
  assert.equal(emailDraftBody({ kind: 'broadcast', brief: 'b', subject: 'x'.repeat(120) }).subjectHint.length, 120);
  assert.deepEqual(emailDraftBody({ kind: 'flow-step', brief: 'b', subject: '', trigger: 'order_paid' }), { kind: 'flow-step', brief: 'b', flowTrigger: 'order_paid' });
  assert.deepEqual(emailDraftBody({ kind: 'flow-step', brief: 'b' }), { kind: 'flow-step', brief: 'b' });
});

test('readDraftOutcome: no answer, signed out, each refusal with the server’s sentence, and Retry only where it helps', () => {
  assert.deepEqual(readDraftOutcome(null), { ok: false, error: DRAFT_UNREACHABLE, retryable: true });
  assert.deepEqual(readDraftOutcome({ status: 401, body: { error: 'Sign in to continue.' } }), { ok: false, error: DRAFT_SIGNED_OUT, retryable: false });
  const off = { success: false, error: 'AI drafting is not set up on this server. Write the email yourself.', reason: 'ai-unavailable', retryable: false };
  assert.deepEqual(readDraftOutcome({ status: 503, body: off }), { ok: false, error: off.error, retryable: false });
  assert.deepEqual(
    readDraftOutcome({ status: 429, body: { success: false, error: 'You have reached this hour’s AI limit. Try again in 3 minutes.', retryable: false, retryAfterSeconds: 125 } }),
    { ok: false, error: 'You have reached this hour’s AI limit. Try again in 3 minutes.', retryable: false, retryAfterSeconds: 125 }
  );
  assert.equal(readDraftOutcome({ status: 502, body: { success: false, error: 'The AI service did not answer. Nothing changed. Try again in a minute.', retryable: true } }).retryable, true);
  assert.deepEqual(readDraftOutcome({ status: 500, body: {} }), { ok: false, error: 'Nothing was drafted. The server answered with status 500.', retryable: true });
  assert.deepEqual(readDraftOutcome({ status: 400, body: { success: false, error: 'Describe the email in up to 300 characters' } }), { ok: false, error: 'Describe the email in up to 300 characters.', retryable: false }, 'a sentence ends with a stop');
  assert.equal(readDraftOutcome({ status: 503, body: { success: false, error: 'x'.repeat(400) } }).error, 'Nothing was drafted. The server answered with status 503.', 'an over-long error is not shown');
});

test('a 429 that names no wait is the Sentinel’s limit: its own line, and no Retry', () => {
  assert.equal(DRAFT_TOO_MANY, 'Too many requests from this connection. Wait a minute and try again.');
  for (const body of [{ success: false, error: 'Rate limit exceeded (Security Sentinel).' }, {}, { retryAfterSeconds: 0 }, { retryAfterSeconds: 'soon' }, { retryable: true }]) {
    assert.deepEqual(readDraftOutcome({ status: 429, body }), { ok: false, error: DRAFT_TOO_MANY, retryable: false }, JSON.stringify(body));
  }
});

test('readDraftOutcome: a draft only from the hub brain, checked again here, with its grounding', () => {
  assert.deepEqual(readDraftOutcome({ status: 200, body: { success: true, draft: DRAFT, grounding: 'account', source: 'hub-brain' } }), { ok: true, draft: DRAFT, grounding: 'account' });
  assert.deepEqual(readDraftOutcome({ status: 200, body: { success: true, draft: DRAFT, grounding: 'app', source: 'hub-brain' } }).grounding, 'app');
  assert.equal(readDraftOutcome({ status: 200, body: { success: true, draft: DRAFT, source: 'hub-brain' } }).grounding, null);
  assert.equal(readDraftOutcome({ status: 200, body: { success: true, draft: DRAFT, grounding: 'main', source: 'hub-brain' } }).grounding, null);
  for (const body of [
    { success: true, draft: DRAFT, source: 'template' },
    { success: true, draft: DRAFT },
    { success: true, draft: { ...DRAFT, subject: ' ' }, source: 'hub-brain' },
    { success: true, draft: { ...DRAFT, paragraphs: [] }, source: 'hub-brain' },
    { success: true, draft: { ...DRAFT, paragraphs: [3, ''] }, source: 'hub-brain' },
    { success: true, source: 'hub-brain' }
  ]) {
    assert.deepEqual(readDraftOutcome({ status: 200, body }), { ok: false, error: DRAFT_UNREADABLE, retryable: true }, JSON.stringify(body).slice(0, 80));
  }
  assert.deepEqual(readDraft({ subject: 'S', paragraphs: ['P', 4, '  '], cta: { label: ' ' } }), { subject: 'S', previewText: '', paragraphs: ['P'] });
  assert.equal(readDraft({ subject: 'S', paragraphs: Array(9).fill('p') }).paragraphs.length, DRAFT_LIMITS.paragraphs);
});

test('the preview and block caps are the stores’ own: 140 characters (broadcast store and cleanFlow) and 24 blocks', () => {
  assert.equal(DRAFT_LIMITS.previewText, 140);
  // The broadcast draft store refuses a preview past the cap; the client never offers one.
  assert.equal(draftWouldClip({ previewText: 'p'.repeat(DRAFT_LIMITS.previewText) }), false);
  assert.equal(draftWouldClip({ previewText: 'p'.repeat(DRAFT_LIMITS.previewText + 1) }), true);
  // cleanFlow keeps exactly that many characters of a flow email's preview.
  const flow = (previewText) => cleanFlow({ id: 'flow_abc', trigger: 'manual', nodes: [{ id: 'n1', type: 'trigger' }, { id: 'n2', type: 'email', subject: 'S', previewText, blocks: [] }], edges: [] }).nodes.find((n) => n.id === 'n2');
  assert.equal(flow('p'.repeat(DRAFT_LIMITS.previewText)).previewText.length, DRAFT_LIMITS.previewText);
  assert.equal(flow('p'.repeat(DRAFT_LIMITS.previewText + 1)).previewText.length, DRAFT_LIMITS.previewText);
  assert.equal(EMAIL_BLOCK_CAP, 24);
  assert.equal(cleanBlockList(textBlocks(EMAIL_BLOCK_CAP + 1)).length, EMAIL_BLOCK_CAP);
  assert.equal(draftWouldClip({ blocks: textBlocks(EMAIL_BLOCK_CAP) }), false);
  assert.equal(draftWouldClip({ blocks: textBlocks(EMAIL_BLOCK_CAP + 1) }), true);
});

test('draftToBlocks: one text block per paragraph through the factory, then a button only when the editor has one', () => {
  const blocks = draftToBlocks(DRAFT, factory());
  assert.deepEqual(blocks, [
    { id: 'f1', kind: 'text', text: DRAFT.paragraphs[0], level: 0 },
    { id: 'f2', kind: 'text', text: DRAFT.paragraphs[1], level: 0 },
    { id: 'f3', kind: 'button', label: 'Book a seat', url: '' }
  ]);
  assert.deepEqual(draftToBlocks(DRAFT, factory(['text'])).map((b) => b.kind), ['text', 'text'], 'no button block when the factory makes none');
  assert.deepEqual(draftToBlocks({ ...DRAFT, cta: undefined }, factory()).map((b) => b.kind), ['text', 'text']);
});

test('applyDraftToComposer: one new object, subject filled, every block already there kept first and untouched', () => {
  const mine = [{ id: 'b_heading', kind: 'heading', text: 'My own heading' }, { id: 'b_text', kind: 'text', text: 'My own words.', level: 0 }];
  const state = { id: 'd1', subject: 'Old subject', previewText: 'Old preview', blocks: mine, settings: { include: 'all' } };
  const frozen = JSON.stringify(state);
  const next = applyDraftToComposer(state, DRAFT, factory());
  assert.notEqual(next, state);
  assert.equal(JSON.stringify(state), frozen, 'the state passed in is not changed');
  assert.equal(next.subject, DRAFT.subject);
  assert.equal(next.previewText, DRAFT.previewText);
  assert.equal(next.id, 'd1');
  assert.equal(next.settings, state.settings);
  assert.equal(next.blocks.length, 5);
  assert.equal(next.blocks[0], mine[0], 'the person’s blocks are the same objects, in the same order');
  assert.equal(next.blocks[1], mine[1]);
  assert.deepEqual(next.blocks.slice(2).map((b) => b.text ?? b.label), [...DRAFT.paragraphs, 'Book a seat']);
});

test('a draft with no preview text keeps the preview the person typed, and Keep does not claim it filled one', () => {
  const state = { subject: 'Mine', previewText: 'My own preview I typed', blocks: [] };
  for (const previewText of ['', undefined]) {
    const draft = { ...DRAFT, previewText };
    assert.equal(applyDraftToComposer(state, draft, factory()).previewText, 'My own preview I typed', JSON.stringify(previewText));
    assert.equal(keptSentence(draft, factory()), 'Filled in the subject, and added 2 paragraphs and a button at the end of the email. Add the button’s link before it goes out.');
  }
  assert.equal(applyDraftToComposer(state, DRAFT, factory()).previewText, DRAFT.previewText, 'a draft that has one fills it');
});

test('Keep never takes an email past 24 blocks: paragraphs first, then the button, and it says what did not fit', () => {
  const draft = { ...DRAFT, paragraphs: ['One.', 'Two.', 'Three.'] };
  let fit = draftFit(draft, factory(), 22);
  assert.deepEqual([fit.blocks.length, fit.paragraphs, fit.button, fit.leftParagraphs, fit.leftButton], [2, 2, false, 1, true]);
  const next = applyDraftToComposer({ subject: '', previewText: '', blocks: textBlocks(22) }, draft, factory());
  assert.equal(next.blocks.length, EMAIL_BLOCK_CAP);
  assert.deepEqual(next.blocks.slice(22).map((b) => b.text), ['One.', 'Two.']);
  assert.equal(
    keptSentence(draft, factory(), { existingBlocks: 22 }),
    'Filled in the subject and the preview text, and added 2 paragraphs at the end of the email. 1 paragraph and the button did not fit, because an email keeps at most 24 blocks.'
  );
  fit = draftFit(draft, factory(), 21);
  assert.deepEqual([fit.paragraphs, fit.button, fit.leftParagraphs, fit.leftButton], [3, false, 0, true]);
  assert.equal(keptSentence(draft, factory(), { existingBlocks: 21 }), 'Filled in the subject and the preview text, and added 3 paragraphs at the end of the email. The button did not fit, because an email keeps at most 24 blocks.');
  assert.equal(applyDraftToComposer({ subject: '', previewText: '', blocks: textBlocks(24) }, draft, factory()).blocks.length, EMAIL_BLOCK_CAP, 'a full email gets nothing added');
  assert.equal(keptSentence(draft, factory(), { existingBlocks: 30, saveHint: 'Nothing was sent.' }), 'Filled in the subject and the preview text. 3 paragraphs and the button did not fit, because an email keeps at most 24 blocks. Nothing was sent.');
  assert.equal(keptSentence({ ...DRAFT, paragraphs: ['One.'], cta: undefined }, factory(), { preview: false }), 'Filled in the subject, and added 1 paragraph at the end of the email.');
});

test('the AI Polish answer carries its grounding only when /api/ai/copy named one', () => {
  const body = { success: true, source: 'hub-brain', copy: { subject: 'S', preview: 'P', body: 'B' } };
  assert.equal(readEmailCopyAnswer({ status: 200, body: { ...body, grounding: 'account' } }).grounding, 'account');
  assert.equal(readEmailCopyAnswer({ status: 200, body: { ...body, grounding: 'app' } }).grounding, 'app');
  assert.ok(!Object.hasOwn(readEmailCopyAnswer({ status: 200, body }), 'grounding'), 'no grounding named, none carried');
  assert.ok(!Object.hasOwn(readEmailCopyAnswer({ status: 200, body: { ...body, grounding: 'main' } }), 'grounding'));
  assert.deepEqual(readCopyAnswer({ status: 200, body: { success: true, source: 'hub-brain', copy: { headline: 'H' } } }), { kind: 'suggestion', copy: { headline: 'H' } });
});

// ---- The drafting session, driven with a request the test controls ----

function harness() {
  const calls = [];
  const states = [];
  const request = (body, signal) => new Promise((resolve) => calls.push({ body, signal, resolve }));
  const session = createDraftSession(request, (s) => states.push(s));
  return { session, calls, states };
}
const answer = (draft = DRAFT) => ({ ok: true, draft, grounding: 'account' });
const flush = () => new Promise((r) => setTimeout(r, 0));

test('the session: a write sends the brief with the subject and trigger, shows busy, then the proposal', async () => {
  const { session, calls } = harness();
  session.toggle();
  assert.equal(session.state.open, true);
  session.setBrief('Spring class is open.');
  const done = session.write({ kind: 'flow-step', subject: 'Mine', trigger: 'order_paid' });
  assert.equal(session.state.phase.state, 'busy');
  assert.deepEqual(calls[0].body, { kind: 'flow-step', brief: 'Spring class is open.', subjectHint: 'Mine', flowTrigger: 'order_paid' });
  session.write({ kind: 'flow-step' });
  assert.equal(calls.length, 1, 'a second write while busy sends nothing');
  calls[0].resolve(answer());
  await done;
  assert.deepEqual(session.state.phase, { state: 'proposal', draft: DRAFT, grounding: 'account' });
});

test('the session drops a reply that lands after Stop, after the form closed or after dispose (the stale-reply guard)', async () => {
  for (const end of ['stop', 'toggle', 'dispose']) {
    const { session, calls } = harness();
    session.toggle();
    session.setBrief('Spring class is open.');
    const done = session.write({ kind: 'broadcast' });
    session[end]();
    assert.equal(calls[0].signal.aborted, true, `${end} aborts the request`);
    const before = session.state;
    calls[0].resolve(answer());
    await done;
    assert.equal(session.state, before, `${end}: the late reply changed nothing`);
    assert.notEqual(session.state.phase.state, 'proposal', end);
    if (end === 'stop') assert.equal(session.state.notice, DRAFT_STOPPED);
  }
  // And a reply to a request a newer write replaced (Retry pressed after an error) is dropped too.
  const { session, calls } = harness();
  session.toggle();
  session.setBrief('b');
  const first = session.write({ kind: 'broadcast' });
  calls[0].resolve({ ok: false, error: 'The AI service did not answer. Nothing changed. Try again in a minute.', retryable: true });
  await first;
  const second = session.write({ kind: 'broadcast' });
  calls[1].resolve(answer());
  await second;
  assert.equal(session.state.phase.state, 'proposal');
});

test('the session: the refusal line clears as soon as the brief can be sent again, and nothing is sent over the limit', async () => {
  const { session, calls } = harness();
  session.toggle();
  session.setBrief('x'.repeat(301));
  await session.write({ kind: 'broadcast' });
  assert.equal(session.state.notice, BRIEF_PROBLEM);
  assert.equal(calls.length, 0);
  session.setBrief('x'.repeat(302));
  assert.equal(session.state.notice, BRIEF_PROBLEM, 'still over: still said');
  session.setBrief('x'.repeat(300));
  assert.equal(session.state.notice, '', 'back under the limit: gone at once');
});

test('the session: Keep applies once and says what the editor answered, Discard changes nothing', async () => {
  const { session, calls } = harness();
  session.toggle();
  session.setBrief('b');
  let done = session.write({ kind: 'broadcast' });
  calls[0].resolve(answer());
  await done;
  session.discard();
  assert.equal(session.state.notice, DRAFT_DISCARDED);
  assert.equal(session.state.open, true);
  done = session.write({ kind: 'broadcast' });
  calls[1].resolve(answer());
  await done;
  const applied = [];
  session.keep((d) => { applied.push(d); return 'Kept it.'; });
  session.keep((d) => { applied.push(d); return 'Twice.'; });
  assert.deepEqual(applied, [DRAFT], 'applied once');
  assert.deepEqual([session.state.open, session.state.phase.state, session.state.notice], [false, 'idle', 'Kept it.']);
  await flush();
});

// ---- The control, rendered ----

const ROOT = new URL('.', import.meta.url).pathname;
const out = await build({
  stdin: {
    contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { EmailDraftView, draftBlockFactory, DRAFT_TOGGLE_LABEL, DRAFT_PROPOSAL_LINE } from './src/components/campaign/BroadcastComposer.tsx';
      export { draftBlockFactory, DRAFT_TOGGLE_LABEL, DRAFT_PROPOSAL_LINE };
      export const render = props => renderToStaticMarkup(React.createElement(EmailDraftView, props));`,
    resolveDir: ROOT,
    loader: 'tsx'
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [{
    name: 'stub-firebase',
    setup(b) {
      b.onResolve({ filter: /\/lib\/firebase$/ }, () => ({ path: 'firebase', namespace: 'jv-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'jv-stub' }, () => ({ contents: 'export const auth = { currentUser: null }; export const authHeaders = async () => ({});', loader: 'js' }));
    }
  }]
});
const dir = mkdtempSync(join(tmpdir(), 'jv-email-draft-'));
const file = join(dir, 'email-draft-view.mjs');
writeFileSync(file, out.outputFiles[0].text);
const view = await import(pathToFileURL(file).href);
rmSync(dir, { recursive: true, force: true });

const noop = () => {};
const markup = (over = {}) => view.render({
  idBase: 'dr', open: false, brief: '', phase: { state: 'idle' }, notice: '', preview: true,
  onToggle: noop, onBrief: noop, onWrite: noop, onStop: noop, onRetry: noop, onKeep: noop, onDiscard: noop, ...over
});
const tagOf = (html, text) => {
  const at = html.indexOf(`>${text}<`);
  assert.ok(at > 0, `"${text}" renders`);
  const start = html.lastIndexOf('<', at);
  return html.slice(start, at + 1);
};
/** The text of the status line inside the form card, and of the one under the button. */
const statusText = (html, which = 'status') => {
  const m = new RegExp(`<p role="status" data-email-draft-${which}=""[^>]*>([^<]*)</p>`).exec(html);
  assert.ok(m, `the ${which} line is in the page`);
  return m[1];
};
const formOf = (html) => {
  const at = html.indexOf('data-email-draft-form=""');
  assert.ok(at > 0, 'the form card renders');
  return html.slice(html.lastIndexOf('<div', at), html.indexOf('data-email-draft-after'));
};
const unescape = (s) => s.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');

test('closed: one button named "Draft this email with AI" that says its form is collapsed, and the line under it already in the page', () => {
  assert.equal(view.DRAFT_TOGGLE_LABEL, 'Draft this email with AI');
  const html = markup({ notice: 'Filled in the subject.' });
  const tag = tagOf(html, 'Draft this email with AI');
  assert.match(tag, /^<button type="button"/);
  assert.match(tag, /aria-expanded="false"/);
  assert.doesNotMatch(tag, /aria-controls=/, 'no aria-controls pointing at a form that is not in the page');
  assert.doesNotMatch(html, /<textarea/);
  assert.equal(statusText(html, 'after'), 'Filled in the subject.', 'what Keep did is said under the button once the form closes');
  assert.ok(!html.includes('>Draft with AI<'), 'never the sidebar journey builder’s name');
});

test('open: the brief in the page font with its label, its count against 300 and no maxlength, and Write a draft', () => {
  const html = markup({ open: true, brief: 'Spring class', notice: 'Old words.' });
  const tag = tagOf(html, 'Draft this email with AI');
  assert.match(tag, /aria-expanded="true"/);
  assert.match(tag, /aria-controls="dr-form"/);
  assert.match(html, /id="dr-form"/);
  assert.match(html, /<label for="dr-brief"[^>]*>What should this email say\?<\/label>/);
  const area = /<textarea[^>]*>/.exec(html)[0];
  assert.match(area, /id="dr-brief"/);
  assert.match(area, /font-family:inherit/, 'not the browser’s monospace');
  assert.doesNotMatch(area, /maxlength/i, 'the count says the limit; the box never cuts the person off');
  assert.match(area, /aria-describedby="dr-help dr-count"/);
  assert.doesNotMatch(area, /aria-invalid/);
  assert.match(html, /id="dr-count"[^>]*>12 of 300 characters</);
  assert.match(tagOf(html, 'Write a draft'), /^<button type="button"/);
  assert.equal(statusText(html), 'Old words.', 'while open the line is the one inside the card');
  assert.equal(statusText(html, 'after'), '');
});

test('over 300: the count says "Too long." in words as well as colour, and the refusal line is in the card', () => {
  const html = markup({ open: true, brief: 'x'.repeat(301), notice: BRIEF_PROBLEM });
  assert.match(html, /id="dr-count"[^>]*>301 of 300 characters\. Too long\.</);
  assert.match(/<textarea[^>]*>/.exec(html)[0], /aria-invalid="true"/);
  assert.equal(statusText(html), BRIEF_PROBLEM);
});

test('busy: Writing a draft is aria-disabled, Stop is offered, and the busy line is inside the form card under them', () => {
  const html = markup({ open: true, brief: 'b', phase: { state: 'busy' } });
  assert.match(tagOf(html, 'Writing a draft'), /aria-disabled="true"/);
  assert.match(tagOf(html, 'Stop'), /^<button type="button"/);
  assert.equal(statusText(html), DRAFT_BUSY);
  const form = formOf(html);
  assert.ok(form.includes('>Stop<') && form.indexOf('>Writing a draft<') < form.indexOf('data-email-draft-status'), 'under the buttons, inside the card');
  assert.doesNotMatch(markup({ open: true, brief: 'b' }), />Stop</, 'no Stop when nothing is being written');
});

test('an error: the server’s sentence inside the form card, with Retry there only when retrying can help', () => {
  const sentence = 'The AI service did not answer. Nothing changed. Try again in a minute.';
  let html = markup({ open: true, brief: 'b', phase: { state: 'error', error: sentence, retryable: true } });
  assert.equal(statusText(html), sentence);
  const form = formOf(html);
  assert.ok(form.includes('>Retry<'), 'Retry is inside the card');
  const retry = tagOf(html, 'Retry');
  assert.match(retry, /^<button type="button"/);
  assert.equal(unescape(/aria-label="([^"]*)"/.exec(retry)[1]), `Retry: ${sentence}`, 'the name starts with the visible word');
  const off = 'AI drafting is not set up on this server. Write the email yourself.';
  html = markup({ open: true, brief: 'b', phase: { state: 'error', error: off, retryable: false } });
  assert.equal(statusText(html), off);
  assert.doesNotMatch(html, />Retry</);
});

test('a proposal: a region named Email draft that opens with "Draft. Not in your email yet." and Keep and Discard, then the words, then the grounding line', () => {
  assert.equal(view.DRAFT_PROPOSAL_LINE, 'Draft. Not in your email yet.');
  const html = markup({ open: true, brief: 'b', phase: { state: 'proposal', draft: DRAFT, grounding: 'account' } });
  const region = /<div[^>]*role="region"[^>]*>/.exec(html)?.[0];
  assert.ok(region, 'the proposal is a region');
  assert.match(region, /aria-label="Email draft"/);
  assert.match(region, /tabindex="-1"/, 'it can take focus when it arrives');
  assert.match(region, /scroll-margin-bottom:96px/, 'scrolled into view clear of the fixed Save and Send bar');
  const inside = html.slice(html.indexOf(region));
  const at = (text) => inside.indexOf(`>${text}<`);
  assert.ok(at('Draft. Not in your email yet.') > 0);
  assert.ok(at('Draft. Not in your email yet.') < at('Keep') && at('Keep') < at('Discard') && at('Discard') < at('Subject'), 'the line, Keep and Discard come first');
  for (const text of [DRAFT.subject, DRAFT.previewText, ...DRAFT.paragraphs, DRAFT.cta.label, GROUNDING_ACCOUNT]) assert.ok(at(text) > at('Discard'), text);
  assert.match(tagOf(inside, 'Keep'), /^<button type="button"/);
  assert.match(tagOf(inside, 'Discard'), /^<button type="button"/);
  assert.ok(!html.includes(EM) && !html.includes(EN));

  const general = markup({ open: true, brief: 'b', phase: { state: 'proposal', draft: DRAFT, grounding: null }, preview: false });
  assert.ok(general.includes(`>${GROUNDING_GENERAL}<`));
  assert.ok(!general.includes(DRAFT.previewText), 'no preview text where the email keeps none');
});

test('the composer’s factory makes the blocks EmailBlocks.tsx’s blank() makes, each with a fresh id', () => {
  const blocks = read('./src/components/campaign/EmailBlocks.tsx');
  assert.ok(blocks.includes("if (kind === 'button') return { id, kind, label: 'Open', url: '' };"), 'blank() still makes this button');
  assert.ok(blocks.includes("if (kind === 'text') return { id, kind, text: '', level: 0 };"), 'blank() still makes this text block');
  const strip = ({ id, columns, ...rest }) => rest;
  const a = view.draftBlockFactory.make('text');
  const b = view.draftBlockFactory.make('text');
  const c = view.draftBlockFactory.make('button');
  assert.deepEqual(strip(a), { kind: 'text', text: '', level: 0 });
  assert.deepEqual(strip(c), { kind: 'button', label: 'Open', url: '' });
  assert.ok(a.id && b.id && c.id && new Set([a.id, b.id, c.id]).size === 3, 'fresh ids');
  assert.match(a.id, /^b_/, 'minted by the editor’s own cloneBlock');
  assert.deepEqual([...view.draftBlockFactory.kinds], ['text', 'button']);
});

test('the composer and the flow editor wire the control: keyed on the email, Keep is one update that appends and says what it did', () => {
  const composer = read('./src/components/campaign/BroadcastComposer.tsx');
  const email = composer.indexOf('<h3 id="bc-h-email"');
  const control = composer.indexOf('<EmailDraftControl', email);
  const subject = composer.indexOf('<label style={fieldLabel}>Subject', email);
  assert.ok(email > 0 && control > email && control < subject, 'the control sits in The email, above the subject');
  const tag = composer.slice(control, subject);
  assert.match(tag, /key=\{composer\.generation\}/, 'a new email is a new control, so a late reply for the old one is dropped');
  assert.match(tag, /kind="broadcast"/);
  assert.match(tag, /patch\(applyDraftToComposer\(\{ subject: draft\.subject, previewText: draft\.previewText, blocks: draft\.blocks \}, kept, draftBlockFactory\)\);/);
  assert.match(tag, /return keptSentence\(kept, draftBlockFactory, \{ existingBlocks: draft\.blocks\.length,/);
  assert.match(composer, /const start = \(from\?: BroadcastDraft\) => \{[\s\S]{0,200}setGeneration\(\(n\) => n \+ 1\);/, 'every start() is a new email');
  assert.equal(composer.split('<EmailDraftControl').length - 1, 1, 'one control in the composer');

  const flow = read('./src/components/campaign/EmailFlowMap.tsx');
  const at = flow.indexOf('<EmailDraftControl');
  assert.ok(at > 0, 'the flow editor’s email step has the control');
  const step = flow.slice(at, flow.indexOf('/>', flow.indexOf('keptSentence(', at)));
  assert.match(step, /key=\{selectedNode\.id\}/);
  assert.match(step, /kind="flow-step"/);
  assert.match(step, /trigger=\{current\.trigger\}/);
  assert.match(step, /preview=\{current\.kind !== 'order'\}/);
  assert.match(step, /applyDraftToComposer\(/);
  assert.match(step, /existingBlocks: blocks\.length/);
  assert.match(flow.slice(at - 200, at), /selectedNode\.blocks\?\.\[0\]\?\.kind !== 'html' && \(/, 'never on a copied HTML email');
  assert.ok(at < flow.indexOf('htmlFor="flow-step-subject"'), 'above the step’s subject');
});

test('the new client files carry no em dash or en dash', () => {
  for (const p of ['./src/lib/emailDraft.ts', './src/lib/emailDraftClient.ts', './scripts/email-draft-browser-check.mjs']) {
    const src = read(p);
    assert.ok(!src.includes(EM) && !src.includes(EN), p);
  }
});
