import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { KEPT_PHRASES, RETIRED_WORDS, retiredIn } from './src/lib/studioVocabulary.ts';

// EMAIL_STUDIO_PLAN.md D2, Wave 6: one word per concept across every visible string of the studio.
// A flow is a flow (never an automation, sequence, drip, series or program), a broadcast is a
// broadcast (never a campaign), one email is an email (never a letter or a note), what starts a flow
// is "Starts when" (never a trigger), and the places are Send due emails now, Results and Sending.
//
// "Visible" is read from the source with the TypeScript parser, so comments and code never count: JSX
// text; the aria-label, title, placeholder, alt and label attributes; and any other string that reads
// as words (it holds a space or starts with a capital and a small letter), such as a setNotice(...)
// argument. Not judged: imports, type literals, console calls, the other JSX attributes (id, key,
// className, style, data-*), and a one-word code value such as 'sequence' or '/api/drips/enroll'.
// The kept phrases are studioVocabulary.ts's KEPT_PHRASES. SequenceEditor.tsx is not a studio file
// here: D8 leaves it unchanged until Wave 7.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const STUDIO_FILES = [
  'src/components/campaign/HubEmailSuite.tsx',
  'src/components/campaign/EmailFlowsList.tsx',
  'src/components/campaign/EmailFlowMap.tsx',
  'src/components/campaign/BroadcastComposer.tsx',
  'src/components/campaign/EmailBlocks.tsx',
  'src/components/campaign/EmailStepPreview.tsx',
  'src/components/campaign/EmailInbox.tsx',
  'src/components/campaign/SmsPanel.tsx',
  'src/components/campaign/SendingSetup.tsx',
  'src/components/campaign/KlaviyoSync.tsx',
  'src/components/campaign/SignupForms.tsx',
  'src/components/campaign/AudienceDesk.tsx',
  'src/components/campaign/CustomerProfileDrawer.tsx',
  'src/components/campaign/FunnelReturnBanner.tsx',
  'src/components/campaign/StudioListLine.tsx',
  'src/lib/emailFlowsList.ts',
  'src/lib/emailStudioNav.ts',
  'src/lib/broadcastComposer.ts',
  'src/lib/flowMapLoad.ts',
  'src/lib/emailStats.ts',
  'src/lib/studioLoad.ts'
];

const VISIBLE_ATTRS = new Set(['aria-label', 'aria-valuetext', 'aria-roledescription', 'title', 'placeholder', 'alt', 'label']);

/** A string reads as words: a space beside a word (" campaign" in a template counts), or a capitalised word. */
const wordy = (text) => /\S\s|\s\S/.test(text) || /^[A-Z][a-z]/.test(text.trim());

/** True when this literal is not copy anyone sees. */
function notCopy(node, sf) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p)) return true;
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && ts.isIdentifier(p.expression.expression) && p.expression.expression.text === 'console') return true;
    // Inside a handler, a string is code that may set visible state (setNotice(...)): judged by wordy().
    if (ts.isFunctionLike(p)) return false;
    if (ts.isJsxAttribute(p)) return !VISIBLE_ATTRS.has(p.name.getText(sf));
  }
  return false;
}

/** Every visible string in one source text, with its line. */
function visibleStrings(name, src) {
  const kind = name.endsWith('.tsx') ? ts.ScriptKind.TSX : name.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const visit = (node) => {
    let text = null;
    if (ts.isJsxText(node)) text = node.text;
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      text = notCopy(node, sf) ? null : node.text;
      if (text !== null && !ts.isJsxAttribute(node.parent) && !wordy(text)) text = null;
    }
    const clean = text === null ? '' : text.replace(/\s+/g, ' ').trim();
    if (clean) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: clean });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** "<file>:<line> says <word>: <text>" for every visible string that says a retired word. */
function retiredSaid(name, src) {
  return visibleStrings(name, src).flatMap(({ line, text }) => retiredIn(text).map((word) => `${name}:${line} says "${word}": ${text.slice(0, 100)}`));
}

test('the scanner judges what is seen and leaves code alone', () => {
  const fixture = `
    const Card = () => {
      const [said, setSaid] = useState('');
      console.warn('drip failed');
      const pick = (kind) => kind === 'sequence';
      return (
        <div className="drip" id="program-1" title="Pause automation" onClick={() => setSaid('Run Queue Tick now')}>
          {pick('sequence') ? 'Welcome series' : \`Copy the \${said} campaign\`}
          <p>Analytics</p>
          <input placeholder="A note for later" aria-label="Edit the trigger" />
          {/* a comment that says letter is never read */}
        </div>
      );
    };`;
  const said = retiredSaid('fixture.tsx', fixture).map((row) => row.split('says "')[1].split('"')[0]).sort();
  assert.deepEqual(said, ['Analytics', 'Run Queue Tick', 'automation', 'campaign', 'note', 'series', 'trigger'].sort());
});

test('every retired word is caught where it is said, and the kept phrases are not', () => {
  for (const row of RETIRED_WORDS) {
    const sample = row.word === 'on the X tab' ? 'Find it on the Klaviyo tab.' : row.word === 'Run Queue Tick' ? 'Press Run Queue Tick.' : `One ${row.word} here.`;
    assert.deepEqual(retiredIn(sample), [row.word], sample);
  }
  for (const phrase of KEPT_PHRASES) assert.deepEqual(retiredIn(`Before ${phrase} after.`), [], phrase);
  // A kept phrase does not hide a retired word beside it.
  assert.deepEqual(retiredIn('UTM campaign and one campaign'), ['campaign']);
  assert.deepEqual(retiredIn('Starts when: Order paid. Send due emails now. Results. Sending.'), []);
  // Fix round: the verb names a flow too ("Automate Inactivity Winback" was a flow's switch); the
  // adjective and adverb describe behaviour and stay.
  assert.deepEqual(retiredIn('Automate Inactivity Winback'), ['automation']);
  assert.deepEqual(retiredIn('It automates the follow-up.'), ['automation']);
  assert.deepEqual(retiredIn('Automatic STOP opt-out suffix. Exits automatically on purchase.'), []);
  // "the queue" is the mechanism Send due emails now replaced; a list of checkouts called a queue is not.
  assert.deepEqual(retiredIn('A step runs only when the queue is run.'), ['the queue']);
  assert.deepEqual(retiredIn('Shopify Abandoned Checkouts Queue'), []);
});

test('no visible string in the studio says a retired word (D2)', () => {
  const said = [];
  let strings = 0;
  for (const file of STUDIO_FILES) {
    const src = read(`./${file}`);
    const seen = visibleStrings(file, src);
    strings += seen.length;
    assert.ok(seen.length >= 1, `${file}: no visible string was read, so a clean scan of it proves nothing`);
    said.push(...retiredSaid(file, src));
  }
  assert.deepEqual(said, [], `retired words in the studio:\n${said.join('\n')}`);
  // The scan read the studio, not an empty file: a few strings it must have seen.
  const everything = STUDIO_FILES.flatMap((file) => visibleStrings(file, read(`./${file}`)).map((row) => row.text)).join('\n');
  for (const known of ['All flows', 'Send due emails now', 'New broadcast', 'Results', 'Sending', 'Starts when:']) {
    assert.ok(everything.includes(known), `the scan never saw "${known}"`);
  }
  assert.ok(strings > 400, `only ${strings} visible strings across the studio`);
});

test('the server sentences the studio shows use the same words', () => {
  const server = read('./server.mjs');
  const routes = read('./server/routes/emailRoutes.mjs');
  const slice = (src, start, end) => {
    const from = src.indexOf(start);
    assert.ok(from > -1, `"${start}" was not found`);
    const to = src.indexOf(end, from + start.length);
    assert.ok(to > from, `"${end}" was not found after "${start}"`);
    return src.slice(from, to);
  };
  const regions = {
    // STARTER_FLOW_NOTE, BUILT_IN_FLOW_NOTE and the order-email note.
    'server.mjs flow notes': slice(server, 'const STARTER_FLOW_NOTE', 'function rememberUntranslated('),
    'server.mjs manual enroll': slice(server, "app.post('/api/email/flows/:id/enroll'", 'const email = String(req.body?.email'),
    'server.mjs sandbox send': slice(server, 'if (sent.sandbox === true', 'recordEvent({'),
    'emailRoutes.mjs revenueNote': slice(routes, "app.get('/api/drips/sequences'", "app.post('/api/drips/sequences'"),
    'emailRoutes.mjs drips enroll': slice(routes, "app.post('/api/drips/enroll'", "app.post('/api/drips/enrollment-toggle'"),
    'emailRoutes.mjs programs': slice(routes, "app.post('/api/email/programs/:id'", '// A built-in flow'),
    'emailRoutes.mjs broadcasts': slice(routes, "app.delete('/api/email/campaigns/:id'", 'row.ab.winner = winner;'),
    'emailRoutes.mjs timeline': slice(routes, 'for (const enr of customerEnrollments)', 'for (const ev of events)'),
    // The customer drawer's suggested next step.
    'emailRoutes.mjs customer advice': slice(routes, 'let strategicAdvice = {', 'const formattedOrders =')
  };
  const said = [];
  let strings = 0;
  for (const [name, src] of Object.entries(regions)) {
    const seen = visibleStrings(`${name}.mjs`, src);
    strings += seen.length;
    assert.ok(seen.length >= 1, `${name}: no sentence was read`);
    said.push(...seen.flatMap(({ text }) => retiredIn(text).map((word) => `${name} says "${word}": ${text.slice(0, 100)}`)));
  }
  assert.deepEqual(said, [], said.join('\n'));
  assert.ok(strings >= 12, `only ${strings} server sentences were read`);
  // The two named in the plan, read whole.
  assert.match(server, /const STARTER_FLOW_NOTE = 'This starter flow is shared by every account\. Your edits to its emails apply to this account only\.';/);
  assert.match(routes, /res\.status\(409\)\.json\(\{ success: false, error: 'That flow is turned off for this account, so nobody was added\. Turn it on in Email Studio, Flows, first\.' \}\)/);
});

test("the browser check's stubs say what the server says", () => {
  const check = read('./scripts/email-studio-browser-check.mjs');
  const server = read('./server.mjs');
  const routes = read('./server/routes/emailRoutes.mjs');
  const starter = server.match(/const STARTER_FLOW_NOTE = '([^']+)';/);
  assert.ok(starter, 'STARTER_FLOW_NOTE was not found in server.mjs');
  assert.ok(check.includes(`const STARTER_FLOW_NOTE = '${starter[1]}';`), 'the browser check stubs another starter flow note than server.mjs sends');
  const builtIn = routes.match(/if \(!row\) return res\.status\(404\)\.json\(\{ success: false, error: '([^']+)' \}\);\n    if \(req\.body\?\.enabled !== undefined\) row\.enabled = Boolean\(req\.body\.enabled\);\n    if \(req\.body\?\.steps\)/);
  assert.ok(builtIn, "POST /api/email/programs/:id's built-in 404 was not found");
  assert.ok(check.includes(`error: '${builtIn[1]}'`), `the browser check's programs stub does not answer "${builtIn[1]}"`);
});

test("the seeded flows' names and descriptions use the same words, and a stored Welcome sequence becomes the Welcome flow", () => {
  // A starter, built-in or order flow's name is the studio's own copy: it is the Flows row, the picker
  // and every Turn off label, and no owner can rename it. The browser check's no-dash step judged the
  // stubs with these names taken out, so "Welcome sequence" was the first row of Flows and nothing saw it.
  const server = read('./server.mjs');
  const literal = (name) => {
    const start = server.indexOf(`const ${name} = [`);
    const end = server.indexOf('\n];\n', start);
    assert.ok(start > -1 && end > start, `server.mjs does not define ${name}`);
    return server.slice(server.indexOf('[', start), end + 2);
  };
  const block = (id, kind, text, extra) => ({ id, kind, text: text || '', ...(extra || {}) });
  const sequences = new Function(`return ${literal('INITIAL_DRIP_SEQUENCES')}`)();
  const automations = new Function('block', `return ${literal('AUTOMATION_DEFAULTS')}`)(block);
  const transactional = new Function('block', `return ${literal('TRANSACTIONAL_DEFAULTS')}`)(block);
  const rows = [...sequences, ...automations, ...transactional];
  assert.ok(rows.length >= 11, `only ${rows.length} seeded flows were read`);
  const said = rows.flatMap((row) => [row.name, row.description].filter(Boolean).flatMap((text) => retiredIn(text).map((word) => `${row.id} says "${word}": ${text}`)));
  assert.deepEqual(said, [], said.join('\n'));
  const welcome = sequences.find((row) => row.id === 'drip_seq_default');
  assert.equal(welcome.name, 'Welcome flow');
  // A store seeded before the rename: loadDrips keeps a stored row as it is, so recomputeDripCounters,
  // which every load runs, renames those exact words and nothing else.
  const fnAt = server.indexOf('function recomputeDripCounters(');
  assert.ok(fnAt > -1, 'server.mjs does not define recomputeDripCounters');
  const recompute = new Function(`${server.slice(fnAt, server.indexOf('\n}\n', fnAt) + 3)}\nreturn recomputeDripCounters;`)();
  const stored = {
    sequences: [
      { id: 'drip_seq_default', name: 'Welcome sequence', description: 'Starts when someone joins the list. Replace each note before anyone receives it.', steps: [] },
      { id: 'drip_seq_cart_recovery', name: 'Welcome sequence', description: 'Replace each note.', steps: [] }
    ],
    enrollments: []
  };
  recompute(stored);
  assert.equal(stored.sequences[0].name, 'Welcome flow');
  assert.equal(stored.sequences[0].description, welcome.description);
  assert.deepEqual(retiredIn(`${stored.sequences[0].name} ${stored.sequences[0].description}`), []);
  // Another row is not the seeded Welcome row, whatever it is called.
  assert.equal(stored.sequences[1].name, 'Welcome sequence');
  assert.equal(stored.sequences[1].description, 'Replace each note.');
});
