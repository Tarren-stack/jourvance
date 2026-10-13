// Ask Jourvance, the source pins for the accessibility and wiring contract (no browser here:
// scripts/assistant-browser-check.mjs renders it). Every panel-copy.md string is held to its file.
// These are source pins, so they hold what the code says and not what it does. The behaviour of the
// suggested actions' bookkeeping (actionRunnable, markActionRun) is tested in assistant-client.test.mjs,
// and the browser check drives the real panel: a run recorded under the wrong key (the plant
// `key + '#'`) leaves the button in place and fails its "the button became the line" assertions.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const bubble = read('./src/components/assistant/AssistantBubble.tsx');
const panel = read('./src/components/assistant/AssistantPanel.tsx');
const entry = read('./src/components/assistant/AskJourvance.tsx');
const lib = read('./src/lib/assistant.ts');
const css = read('./src/index.css');
const app = read('./src/App.tsx');
const leak = read('./src/components/analytics/JourneyLeakFinder.tsx');
const attribution = read('./src/components/analytics/AttributionReports.tsx');
const copy = read('./docs/assistant/panel-copy.md');
const components = { 'AssistantBubble.tsx': bubble, 'AssistantPanel.tsx': panel, 'AskJourvance.tsx': entry };
const all = bubble + panel + entry;

/** The assistant block of index.css: from its header comment to the end of the file. */
const assistantCss = css.slice(css.indexOf('/* Ask Jourvance'));

test('the panel is a non-modal dialog: aria-modal is "false" and never "true"', () => {
  assert.ok(assistantCss.length > 100, 'the Ask Jourvance block is in index.css');
  assert.ok(panel.includes('aria-modal="false"'));
  for (const [name, src] of Object.entries(components)) assert.ok(!src.includes('aria-modal="true"'), name);
  assert.ok(!/aria-modal=\{true\}/.test(all));
  assert.ok(panel.includes('role="dialog"'));
  assert.ok(panel.includes('aria-labelledby={titleId}'));
});

test('the roles and states the contract names are present', () => {
  assert.ok(panel.includes('role="log"'));
  assert.ok(panel.includes('aria-live="polite"'));
  assert.ok(panel.includes('aria-pressed={pressed}'));
  assert.ok(bubble.includes('aria-expanded={open}'));
  assert.ok(bubble.includes('aria-controls={panelId}'));
  assert.ok(bubble.includes("aria-label={PANEL_COPY['bubble.ariaLabel']}"));
  assert.ok(panel.includes("aria-label={PANEL_COPY['feedback.group']}"));
  assert.ok(panel.includes('role="alert"'));
  assert.ok(panel.includes('role="status"'));
});

test('stacking: the bubble and the card at 25; the sheet under 720px at 35, over the toolbar (30) and header (31), under the nav trigger (45)', () => {
  assert.equal((bubble.match(/zIndex: 25/g) || []).length, 1);
  assert.ok(!/zIndex/.test(panel), 'the panel takes its stacking from index.css, so the sheet can differ');
  assert.ok(/\n\.jv-assistant-panel \{\s*position: fixed;\s*z-index: 25;/.test(assistantCss));
  assert.ok(/@media \(max-width: 719px\) \{\s*\.jv-assistant-panel \{\s*z-index: 35;\s*\}/.test(assistantCss));
  assert.ok(!/zIndex:\s*45/.test(all));
  assert.ok(!/z-index:\s*(4[5-9]|[5-9]\d)/.test(assistantCss), 'never as high as the nav trigger or a dialog');
});

test('every Text cell of panel-copy.md appears verbatim in src/lib/assistant.ts', () => {
  const cells = copy.split('\n').filter(l => /^\| [A-Za-z0-9.-]+\.[A-Za-z0-9-]+ \|/.test(l)).map(l => {
    const m = l.match(/^\| (\S+) \| (.*) \|$/);
    return { key: m[1], text: m[2] };
  });
  assert.ok(cells.length >= 53, 'the table has at least its 53 rows (37 plus the 12 per-view suggestions, less the 3 retired, plus the 7 action rows)');
  assert.equal(cells.filter(c => c.key.startsWith('action.')).length, 7, 'the seven action rows are read, hyphenated keys included');
  assert.equal(cells.filter(c => /^suggest\.(canvas|email|attribution|public)\.[123]$/.test(c.key)).length, 12, 'twelve per-view suggestion rows');
  for (const { key, text } of cells) {
    assert.ok(lib.includes(`'${key}': '${text.replace(/'/g, "\\'")}'`), `${key} is verbatim in assistant.ts`);
  }
  assert.ok(cells.some(c => c.text.includes('’')), 'the curly apostrophe is in the table');
});

test('no em dash and no spaced en dash in the four files', () => {
  for (const [name, src] of [...Object.entries(components), ['assistant.ts', lib]]) {
    assert.ok(!src.includes('—'), `${name} has an em dash`);
    assert.ok(!/ – /.test(src), `${name} has a spaced en dash`);
  }
});

test('the print rule hides the bubble and the panel', () => {
  assert.ok(/@media print\s*\{\s*\.jv-assistant-bubble,\s*\.jv-assistant-panel\s*\{\s*display:\s*none;?\s*\}/.test(assistantCss));
});

test('Send and the other busy controls are aria-disabled, never disabled', () => {
  assert.ok(!/(^|[^-])disabled=\{/.test(panel), 'no disabled={ in the panel');
  assert.ok(!/\sdisabled(\s|>|=)/.test(panel.replace(/aria-disabled/g, '')), 'no bare disabled attribute');
  assert.ok(panel.includes('aria-disabled={sendBlocked}'));
});

test('the question box and the notes box never cut silently: no maxLength, Send and Save blocked over the limit', () => {
  assert.ok(!/maxLength/i.test(panel), 'no maxLength anywhere in the panel');
  assert.ok(panel.includes('input.length >= 900 ? countText'), 'the count shows from 900');
  assert.ok(panel.includes('aria-invalid={over}') && panel.includes('aria-invalid={notesOver}'));
  assert.ok(panel.includes('const over = input.length > ASSISTANT_LIMITS.MESSAGE_MAX'));
  assert.ok(panel.includes('const notesOver = notesDraft.length > ASSISTANT_LIMITS.NOTES_MAX'));
  assert.ok(panel.includes('aria-disabled={notesSaving || notesOver}'));
  assert.ok(/id=\{inputStatusId\} role="status"/.test(panel) && /id=\{notesStatusId\} role="status"/.test(panel), 'one always-mounted status per textarea');
  assert.ok(panel.includes('aria-describedby={inputStatusId}') && panel.includes('${notesStatusId}'));
  assert.ok(/\.jv-assistant-warn-text\s*\{[^}]*#FCA5A5/.test(assistantCss), 'the too-long line is #FCA5A5');
  assert.ok(panel.includes('htmlFor={inputId}'));
  assert.ok(panel.includes('<details'));
  assert.ok(panel.includes("e.key === 'Enter' && !e.shiftKey") || /e\.key !== 'Enter' \|\| e\.shiftKey/.test(panel));
});

test('keys stop at the panel so Backspace and undo never reach the map, and Escape closes it', () => {
  assert.ok(/onKeyDown = [\s\S]{0,80}e\.stopPropagation\(\)/.test(panel));
  assert.ok(panel.includes("e.key === 'Escape'"));
});

test('the panel is OFF the dialog stack: it neither imports nor calls openDialog or useDialogFocus', () => {
  for (const [name, src] of Object.entries(components)) {
    assert.ok(!/openDialog|useDialogFocus|a11yHooks/.test(src), name);
  }
});

test('below 720px Tab is trapped in the sheet with nextTrapIndex; from 720px up there is no trap', () => {
  assert.ok(panel.includes("import { FOCUSABLE_SELECTOR, nextTrapIndex } from '../../lib/a11y'"));
  assert.ok(/e\.key === 'Tab'[^\n]*window\.innerWidth < 720/.test(panel));
  assert.ok(/html:has\(\.jv-assistant-panel:not\(\[hidden\]\)\)\s*\{\s*scroll-padding-bottom:\s*72dvh/.test(assistantCss));
});

test('geometry keeps both modes clear of the header: bottom 84px card, 70dvh sheet, both capped at 100dvh less 120px, no short-screen top rule', () => {
  assert.equal((assistantCss.match(/max-height: calc\(100dvh - 120px\)/g) || []).length, 2);
  assert.ok(/\.jv-assistant-panel \{[^}]*bottom: 84px/.test(assistantCss));
  assert.ok(!/max-height: 559px/.test(assistantCss));
  assert.ok(!/top: 8px/.test(assistantCss));
  assert.ok(/\.jv-assistant-panel\[data-signed-out="true"\]\s*\{\s*height: auto/.test(assistantCss));
  assert.ok(panel.includes("data-signed-out={signedIn ? 'false' : 'true'}"));
});

test('Sign In closes the panel before it opens the auth dialog', () => {
  assert.ok(/onClose\(\);\s*onOpenAuth\(\);/.test(panel));
});

test('the empty-state line is not drawn (no box means no "ask below"; suggestions carry the state)', () => {
  assert.ok(!panel.includes("PANEL_COPY['thread.empty']"));
});

test('the notes summary has a 16px chevron, hidden from readers, turned 90 degrees when open', () => {
  assert.ok(/<ChevronRight size=\{16\} aria-hidden="true"/.test(panel));
  assert.ok(/\.jv-assistant-notes\[open\] \.jv-assistant-chev\s*\{\s*transform: rotate\(90deg\)/.test(assistantCss));
  assert.ok(panel.includes('scrollIntoView?.({ block: \'nearest\' })'));
});

test('Clear keeps an hourly limit, its confirm sits under the header, Escape in it is Keep, and a close resets it', () => {
  assert.ok(panel.includes("p && p.kind === 'limit' ? p : null"));
  assert.ok(panel.indexOf('{confirmClear && (') < panel.indexOf('{!signedIn ? ('), 'the confirm is before the body');
  assert.ok(/if \(confirmClear\) keepConversation\(\);\s*else onClose\(\)/.test(panel));
  assert.ok(/if \(!open\) setConfirmClear\(false\)/.test(panel));
  assert.ok(/\.jv-assistant-head \.jv-assistant-clear\s*\{\s*border-color: transparent;\s*color: #94A3B8/.test(assistantCss));
});

test('the head wraps instead of overpainting: no nowrap on the title, flex-wrap on the head', () => {
  assert.ok(!/\.jv-assistant-title\s*\{[^}]*nowrap/.test(assistantCss));
  assert.ok(/\.jv-assistant-head\s*\{[^}]*flex-wrap: wrap/.test(assistantCss));
});

test('the history is not announced as new: it commits while aria-busy is true and settles later', () => {
  assert.ok(panel.includes('aria-busy={!settled}'));
  assert.ok(/if \(loaded\) setSettled\(true\)/.test(panel));
});

test('an answer that lands while closed is said by an always-mounted status; the bubble has no title and a transparent border', () => {
  assert.ok(/<span role="status" className="jv-assistant-sr">\{announce\}<\/span>/.test(entry));
  assert.ok(entry.includes("setAnnounce(PANEL_EXTRA['bubble.newAnswer'])"));
  assert.ok(!/\btitle=/.test(bubble));
  assert.ok(/\.jv-assistant-bubble \{[^}]*border: 2px solid transparent/.test(assistantCss));
});

test('a rating always replaces the line, and Not helpful after a shared Helpful says the copy stays shared', () => {
  assert.ok(panel.includes('setRatingLines(lines => ({ ...lines, [message.id]: line }))'));
  assert.ok(!/if \(line\) setRatingLines/.test(panel), 'the line is replaced even when empty');
  assert.ok(panel.includes('message.shared === true'));
});

test('reduced motion turns the open transition off', () => {
  assert.ok(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.jv-assistant-panel[^}]*animation:\s*none/.test(assistantCss));
});

test('App.tsx lazy-imports and mounts it exactly once each, inside the floating boundary', () => {
  assert.equal((app.match(/const AskJourvance = lazy\(/g) || []).length, 1);
  assert.equal((app.match(/<AskJourvance\b/g) || []).length, 1);
  const boundary = app.indexOf('<ChunkBoundary floating each>');
  const mount = app.indexOf('<AskJourvance');
  const close = app.lastIndexOf('</ChunkBoundary>');
  assert.ok(boundary > 0 && mount > boundary && mount < close);
  assert.ok(app.includes('onOpenAuth={() => setShowAuthModal(true)}'));
  assert.ok(app.includes('businessType={project.businessType}'));
});

test('the per-view suggestion rows carry no em dash, no spaced en dash and no exclamation mark', () => {
  const rows = copy.split('\n').filter(l => /^\| suggest\.[a-z]+\.[123] \|/.test(l));
  assert.equal(rows.length, 12);
  for (const r of rows) assert.ok(!/[\u2014!]|\s\u2013\s/.test(r), r);
  assert.ok(!/suggest\.(numbers|howto)\b|suggest\.email \|/.test(copy), 'the old three rows are retired');
  assert.ok(!panel.includes("'suggest.numbers'"));
});

test('"Ask about this": the listener and both senders use the one event constant, and no one spells the name out', () => {
  assert.ok(entry.includes('window.addEventListener(ASK_EVENT, onAsk)'));
  assert.ok(entry.includes('window.removeEventListener(ASK_EVENT, onAsk)'));
  assert.ok(lib.includes("export const ASK_EVENT = 'jv-ask'"));
  assert.ok(lib.includes('new CustomEvent<AskEventDetail>(ASK_EVENT,'));
  assert.ok(leak.includes('askAssistant(') && leak.includes("from '../../lib/assistant'"));
  assert.ok(attribution.includes('askAssistant(') && attribution.includes("from '../../lib/assistant'"));
  for (const [name, src] of [['AskJourvance', entry], ['Leak', leak], ['Attribution', attribution]]) assert.ok(!src.includes("'jv-ask'"), name);
});

test('both Ask buttons are real <button type="button"> with visible text, and show only while the assistant is mounted', () => {
  for (const [name, src, text] of [['leak finder', leak, 'Ask why this step loses people'], ['attribution', attribution, 'Ask about these numbers']]) {
    const at = src.indexOf('askAssistant(');
    assert.ok(at > 0, name);
    const open = src.lastIndexOf('<button', at);
    assert.ok(/<button\s+type="button"/.test(src.slice(open, open + 40)), `${name}: type="button"`);
    const end = src.indexOf('</button>', at);
    assert.ok(src.slice(at, end).includes('\n' ) && new RegExp('>\\s*' + text + '\\s*<').test(src.slice(at, end + 9)), `${name}: visible text "${text}"`);
    assert.ok(!/aria-label=/.test(src.slice(open, end)), `${name}: the name is the visible text`);
    assert.ok(src.includes('useAskReady()') && /askReady\s*&&/.test(src), `${name}: hidden while the assistant is not mounted`);
  }
  assert.ok(entry.includes('root.setAttribute(ASK_READY_ATTR') && entry.includes('root.removeAttribute(ASK_READY_ATTR)'), 'set on mount, removed on unmount');
});

test('App.tsx hands the mount the view, the journey and the selected step, and mounts it once', () => {
  assert.equal((app.match(/<AskJourvance\b/g) || []).length, 1);
  const mount = app.slice(app.indexOf('<AskJourvance'), app.indexOf('/>', app.indexOf('<AskJourvance')));
  for (const prop of ["view={activePage === 'canvas' ? activeView : 'public'}", 'journeyId={project.id}', 'journeyName={project.name}', 'stepKind=', 'stepName=']) assert.ok(mount.includes(prop), prop);
  assert.ok(mount.includes('selectedNode?.type') && mount.includes('.label'));
});

test('the panel sends the screen with the thread and the question, and the question box takes the hand-over without sending', () => {
  assert.ok(panel.includes('fetchThread(screen, controller.signal)'));
  assert.ok(panel.includes('ask(question, screen, controller.signal)'));
  assert.ok(panel.includes('suggestionKeys(screen.view)'));
  const effect = panel.slice(panel.indexOf('prefillSeen'), panel.indexOf('prefillSeen') + 900);
  assert.ok(effect.includes('setInput(prefill.text)') && !/\bsend\(/.test(effect), 'it fills the box and sends nothing');
  const client = fs.readFileSync(new URL('./src/lib/assistantClient.ts', import.meta.url), 'utf8');
  assert.ok(client.includes("{ message, ...(screen ? { screen } : {}) }"));
  assert.ok(client.includes('?screen=${encodeURIComponent(JSON.stringify(screen))}'));
});

// ---- W3.A: suggested actions ----

test('the action rows of panel-copy.md are pinned like every other row (a key may hold a hyphen)', () => {
  for (const key of ['action.group', 'action.done.open', 'action.done.add-step', 'action.done.rename-journey', 'action.notOpen', 'action.failed', 'action.suggested']) {
    assert.ok(new RegExp(`^\\| ${key.replace(/\./g, '\\.')} \\| .+ \\|$`, 'm').test(copy), `${key} is a row of panel-copy.md`);
    assert.ok(lib.includes(`'${key}': `), `${key} is in PANEL_COPY`);
  }
  assert.ok(copy.includes('| action.done.add-step | Added a {step} step. Undo is in the editor toolbar. |'));
  assert.ok(copy.includes('| action.done.rename-journey | Renamed to "{name}". Undo is in the editor toolbar. |'));
});

test('buttons only for the newest answer that arrived in this page load; any other answer shows lines, a ran action its result', () => {
  assert.ok(panel.includes('const latestId = latestAnswerId(messages)'));
  assert.ok(panel.includes('showsActionButtons(m.id, latestId, liveAnswers) && onAction ? ('));
  // An answer joins liveAnswers only where send() reads one; the thread load never adds to it.
  assert.equal((panel.match(/setLiveAnswers\(/g) || []).length, 1);
  const send = panel.slice(panel.indexOf('const send = async'), panel.indexOf('const retry = '));
  assert.ok(send.includes('setLiveAnswers(ids => new Set(ids).add(outcome.message.id));'));
  const load = panel.slice(panel.indexOf('void fetchThread('), panel.indexOf('}, [open, signedIn]);'));
  assert.ok(!load.includes('setLiveAnswers'));
  assert.ok(panel.includes(`<div role="group" aria-label={PANEL_COPY['action.group']} className="jv-assistant-actions">`));
  assert.ok(/<button\s+key=\{key\}\s+type="button"\s+className="jv-assistant-btn jv-assistant-action"/.test(panel), 'a real <button type="button">');
  assert.ok(panel.includes('{a.label}'), 'the button text is the server-built label');
  const lines = panel.slice(panel.indexOf('<ul className="jv-assistant-suggested">'), panel.indexOf('</ul>', panel.indexOf('<ul className="jv-assistant-suggested">')));
  assert.ok(lines.includes('const done = actionLines[actionKey(m.id, i)];') && lines.includes('{done.line}'), 'a ran action shows its result');
  assert.ok(lines.includes("{PANEL_COPY['action.suggested']} {a.label}"), 'an action that did not run shows the suggestion');
});

test('an action runs only from its button, through actionRunnable and markActionRun with the one key; a throw is action.failed', () => {
  // onAction is called in exactly one place, runAction, and runAction only from a click.
  assert.equal((panel.match(/onAction\(/g) || []).length, 1);
  assert.ok(panel.includes('const r = await onAction(action);'));
  assert.equal((panel.match(/runAction\(/g) || []).length, 1, 'one call site');
  assert.ok(panel.includes('onClick={() => void runAction(m.id, i, a)}'));
  const fn = panel.slice(panel.indexOf('const runAction = async'), panel.indexOf('const save = async'));
  assert.ok(fn.includes('const key = actionKey(messageId, index);'));
  assert.ok(fn.includes('if (!onAction || runningAction.current || !actionRunnable(actionLines, key)) return;'), 'the guard reads the key');
  assert.ok(fn.includes('setActionLines(lines => markActionRun(lines, key, result));'), 'the write uses the same key');
  assert.equal((fn.match(/\bkey\b/g) || []).length, 4, 'the key is built once and used by the guard, the write and the focus, and by nothing else');
  assert.ok(/catch \{\s*result = ACTION_FAILED;/.test(fn), 'a throw is action.failed');
  assert.ok(panel.includes("const ACTION_FAILED: ActionResult = { ok: false, line: PANEL_COPY['action.failed'], tone: 'bad' };"));
  assert.ok(panel.includes('setActionLines({});'), 'a clear forgets the lines with the messages');
  // Nothing runs on render, on open or on Enter: the question box's key handler never reaches it.
  const inputKeys = panel.slice(panel.indexOf('const onInputKeyDown'), panel.indexOf('const showConfirm'));
  assert.ok(!inputKeys.includes('Action'));
  assert.ok(entry.includes('onAction={onAction}') && entry.includes('onAction?: (action: AssistantAction) => Promise<ActionResult> | ActionResult;'));
});

test('the result line: replaces the button, is not live when focus moves to it, takes its tone; focus leaves the panel only for a new step or a closed sheet, and then the result is said outside it', () => {
  assert.ok(/<p\s+key=\{key\}\s+role="status"\s+aria-live="off"\s+tabIndex=\{-1\}\s+data-action-line=\{key\}/.test(panel));
  assert.ok(panel.includes('className={`jv-assistant-action-line jv-assistant-action-line--${done.tone ?? (done.ok ? \'ok\' : \'bad\')}`}'));
  const fn = panel.slice(panel.indexOf('const runAction = async'), panel.indexOf('const save = async'));
  assert.ok(fn.includes("const sheet = typeof window !== 'undefined' && window.innerWidth < 720;"));
  assert.ok(fn.includes("const closes = sheet && result.ok && (action.kind === 'add-step' || action.kind === 'open');"));
  assert.ok(/if \(closes\) \{\s*onClose\(\);\s*if \(action\.kind === 'open'\) focusViewHeading\(action\.view\);\s*\}/.test(fn));
  assert.ok(fn.includes("if (closes || (result.ok && action.kind === 'add-step')) onAnnounce?.(result.line);\n    else setFocusLine(key);"));
  assert.ok(panel.includes('line?.focus({ preventScroll: true })'));
  assert.ok(panel.includes('if (a && a !== document.body && !panelRef.current?.contains(a)) return;'), 'only when focus would otherwise be lost');
  // The words said outside the panel go to AskJourvance's always-mounted status.
  assert.ok(entry.includes('onAnnounce={announceResult}'));
  assert.ok(/const announceResult = useCallback\(\(text: string\) => \{\s*setAnnounce\(''\);\s*window\.setTimeout\(\(\) => setAnnounce\(text\), 50\);/.test(entry));
});

test('<html> carries data-jv-sheet-open while the panel is open, and the mobile nav trigger hides under it below 720px', () => {
  assert.ok(lib.includes("export const SHEET_OPEN_ATTR = 'data-jv-sheet-open';"));
  assert.ok(/if \(open\) root\.setAttribute\(SHEET_OPEN_ATTR, ''\);\s*else root\.removeAttribute\(SHEET_OPEN_ATTR\);\s*return \(\) => root\.removeAttribute\(SHEET_OPEN_ATTR\);\s*\}, \[open\]\);/.test(entry));
  assert.ok(/@media \(max-width: 719px\) \{[^@]*html\[data-jv-sheet-open\] \.jv-mobile-nav-trigger \{\s*display: none !important;/.test(assistantCss));
});

test('App.tsx hands the mount onAction: journey actions run only while the canvas is the page and the view, through handleAddNode and handleUpdateProjectName', () => {
  const mount = app.slice(app.indexOf('<AskJourvance'), app.indexOf('/>', app.indexOf('<AskJourvance')));
  assert.ok(mount.includes("onAction={async action => (await import('./lib/assistant')).runAssistantAction(action, {"));
  assert.ok(mount.includes("openJourneyId: activePage === 'canvas' && activeView === 'canvas' ? project.id : null,"));
  assert.ok(!mount.includes('openJourneyId: project.id,'));
  assert.ok(mount.includes("if (view !== 'email-studio' && !leaveStudioOk()) return false;"));
  assert.ok(mount.includes("if (view === 'canvas') showCanvas();") && mount.includes('else setActiveView(view);'));
  assert.ok(mount.includes('addStep: handleAddNode,') && mount.includes('renameJourney: handleUpdateProjectName'));
  // The helper loads with the assistant's own chunk, never the entry.
  assert.ok(!/^import [^\n]*from '\.\/lib\/assistant';$/m.test(app), 'no static import of lib/assistant in App.tsx');
});

test('the CSS: buttons at least 44px that wrap; result lines with a left rule in their tone and no bubble fill; the short-window sheet; print hides it all', () => {
  const rule = (sel) => (assistantCss.match(new RegExp(`\\n${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`)) || [])[1] || '';
  const action = rule('.jv-assistant-action');
  assert.ok(/min-height: 44px/.test(action) && /white-space: normal/.test(action) && /overflow-wrap: anywhere/.test(action), action);
  assert.ok(/flex-direction: column/.test(rule('.jv-assistant-actions')));
  const line = rule('.jv-assistant-action-line');
  assert.ok(/min-height: 44px/.test(line) && /border-left: 3px solid #34D399/.test(line) && !/#1E293B/.test(line), line);
  assert.ok(/border-left-color: #FBBF24/.test(rule('.jv-assistant-action-line--warn')), 'not open is a warning, not a failure');
  assert.ok(/border-left-color: #FCA5A5/.test(rule('.jv-assistant-action-line--bad')));
  assert.ok(/@media \(max-width: 719px\) and \(max-height: 500px\) \{\s*\.jv-assistant-panel \{\s*height: calc\(100dvh - 16px\);\s*max-height: calc\(100dvh - 16px\);/.test(assistantCss));
  assert.ok(/\.jv-assistant-panel :focus-visible/.test(css), 'the focus ring reaches every control in the panel');
  assert.ok(/@media print\s*\{\s*\.jv-assistant-bubble,\s*\.jv-assistant-panel\s*\{\s*display:\s*none/.test(assistantCss));
});
