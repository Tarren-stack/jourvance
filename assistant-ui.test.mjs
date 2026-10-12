// Ask Jourvance, the source pins for the accessibility and wiring contract (no browser here:
// scripts/assistant-browser-check.mjs renders it). Every panel-copy.md string is held to its file.

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

test('stacking is 25 on both, never 45', () => {
  assert.equal((bubble.match(/zIndex: 25/g) || []).length, 1);
  assert.equal((panel.match(/zIndex: 25/g) || []).length, 1);
  assert.ok(!/zIndex:\s*45/.test(all));
  assert.ok(!/z-index:\s*45/.test(assistantCss));
});

test('every Text cell of panel-copy.md appears verbatim in src/lib/assistant.ts', () => {
  const cells = copy.split('\n').filter(l => /^\| [A-Za-z]+\.[A-Za-z]+ \|/.test(l)).map(l => {
    const m = l.match(/^\| (\S+) \| (.*) \|$/);
    return { key: m[1], text: m[2] };
  });
  assert.ok(cells.length >= 37, 'the table has at least its 37 rows');
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
