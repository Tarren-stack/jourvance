// Gate for the Ask Jourvance app guide (ASK_JOURVANCE_PLAN.md section 3.6) and its panel copy.
// The guide is data the assistant answers from, so a label that drifted out of the UI is a wrong answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const GUIDE_PATH = path.join(ROOT, 'docs/assistant/jourvance-guide.md');
const PANEL_PATH = path.join(ROOT, 'docs/assistant/panel-copy.md');
const HEADINGS = [
  'Journey canvas and steps',
  'Email Studio',
  'Drafting an email with AI in Email Studio',
  'Attribution reports',
  'Publish and custom domains',
  'Shopify connect and sync',
  'Blueprints and the library',
  'Draft with AI and the hourly limit',
  'Billing (Starter and Pro)',
  'Account and workspaces',
  'What Jourvance does not do',
];
const MAX_SECTION_LINES = 40;
const SOURCES_RE = /^<!-- sources: (.+) -->$/;

const guide = () => {
  assert.ok(fs.existsSync(GUIDE_PATH), 'docs/assistant/jourvance-guide.md must exist');
  return fs.readFileSync(GUIDE_PATH, 'utf8');
};

// Split into sections by "## " headings, ignoring anything inside fenced code.
function sections(text) {
  const out = [];
  let cur = null;
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && line.startsWith('## ')) {
      cur = { heading: line.slice(3).trim(), lines: [] };
      out.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  return out;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

test('the guide exists, is non-empty, and has the eleven headings in order', () => {
  const text = guide();
  assert.ok(text.trim().length > 0, 'guide is empty');
  const found = sections(text).map((s) => s.heading);
  assert.deepEqual(found, HEADINGS);
});

test('no section is longer than 40 lines, sources comment excluded', () => {
  const secs = sections(guide());
  assert.equal(secs.length, HEADINGS.length);
  for (const s of secs) {
    const body = s.lines.filter((l) => !SOURCES_RE.test(l.trim()));
    // Heading line counts; trailing blank lines before the next heading do not.
    while (body.length && body[body.length - 1].trim() === '') body.pop();
    const n = body.length + 1;
    assert.ok(n <= MAX_SECTION_LINES, `section "${s.heading}" is ${n} lines, the limit is ${MAX_SECTION_LINES}`);
  }
});

test('every section ends with a sources comment and every path it names exists', () => {
  const secs = sections(guide());
  assert.equal(secs.length, HEADINGS.length);
  const problems = [];
  for (const s of secs) {
    const nonBlank = s.lines.filter((l) => l.trim() !== '');
    const last = (nonBlank[nonBlank.length - 1] || '').trim();
    const m = SOURCES_RE.exec(last);
    if (!m) { problems.push(`"${s.heading}": last line is not a "<!-- sources: ... -->" comment`); continue; }
    const paths = m[1].split(',').map((p) => p.trim());
    for (const p of paths) {
      if (!p) problems.push(`"${s.heading}": empty path in sources`);
      else if (!fs.existsSync(path.join(ROOT, p))) problems.push(`"${s.heading}": missing file ${p}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('label drift gate: every backticked label in the guide appears in src/components', () => {
  const text = guide();
  let fenced = false;
  const kept = [];
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (!fenced) kept.push(line);
  }
  const labels = new Set();
  for (const m of kept.join('\n').matchAll(/`([^`\n]+)`/g)) labels.add(m[1]);
  assert.ok(labels.size > 0, 'the guide names no backticked labels');
  const srcDir = path.join(ROOT, 'src/components');
  assert.ok(fs.existsSync(srcDir), 'src/components must exist');
  const files = walk(srcDir);
  assert.ok(files.length > 0, 'no .ts or .tsx files under src/components');
  const corpus = files.map((f) => fs.readFileSync(f, 'utf8'));
  const missing = [...labels].filter((l) => !corpus.some((c) => c.includes(l)));
  assert.deepEqual(missing, [], `${missing.length} of ${labels.size} labels checked are missing from src/components: ${missing.map((l) => JSON.stringify(l)).join(', ')}`);
});

test('the guide has no em dash, no en dash and no exclamation mark', () => {
  const text = guide();
  assert.ok(!text.includes('—'), 'em dash (U+2014) found in the guide');
  assert.ok(!text.includes('–'), 'en dash (U+2013) found in the guide');
  const noOpeners = text.replaceAll('<!--', '');
  const at = noOpeners.indexOf('!');
  assert.equal(at, -1, `exclamation mark found near: ${noOpeners.slice(Math.max(0, at - 30), at + 10)}`);
});

test('panel-copy.md has the limit and local-only rows and no banned dashes', () => {
  assert.ok(fs.existsSync(PANEL_PATH), 'docs/assistant/panel-copy.md must exist');
  const rows = new Map();
  for (const line of fs.readFileSync(PANEL_PATH, 'utf8').split('\n')) {
    const m = /^\|\s*([A-Za-z][\w.]*)\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
    if (m && m[1] !== 'Key') rows.set(m[1], m[2]);
  }
  assert.ok(rows.size > 0, 'no table rows parsed from panel-copy.md');
  assert.ok(rows.has('limit.template'), 'limit.template row missing');
  assert.ok(rows.get('limit.template').includes('{wait}'), 'limit.template lacks {wait}');
  assert.ok(rows.has('notes.savedLocalOnly'), 'notes.savedLocalOnly row missing');
  assert.ok(rows.get('notes.savedLocalOnly').includes('{reason}'), 'notes.savedLocalOnly lacks {reason}');
  const bad = [...rows].filter(([, v]) => v.includes('—') || /\s–\s/.test(v)).map(([k]) => k);
  assert.deepEqual(bad, [], `rows with an em dash or spaced en dash: ${bad.join(', ')}`);
});
