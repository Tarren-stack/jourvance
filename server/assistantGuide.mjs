// Ask Jourvance: the app guide slice (ASK_JOURVANCE_PLAN.md section 3.6).
// The guide (docs/assistant/jourvance-guide.md) reaches the model from the spoke: it is split on
// its `## ` headings, and the sections that share the most words with the question (stop words
// removed, heading words counted twice) go into the system text as GUIDE (data), capped at
// GUIDE_SLICE_MAX_CHARS. A missing or empty guide answers [] and the assistant still answers.
//
// The same two documents (the guide and docs/assistant/panel-copy.md) are the ALLOWLIST for the
// flywheel: a question shared with the hub's brain keeps only words those documents use, so a
// tenant's names, people, suppliers and figures never reach the corpus every spoke reads. The hub
// copies the first 220 characters of what it is sent verbatim, so a denylist is not enough: it
// misses every name nobody thought to list (Ask Jourvance review, 2026-10-11).
//
// This file carries no em dash and no en dash.
import fs from 'fs';
import path from 'path';
import { LIMITS } from './assistantContext.mjs';

export const STOP_WORDS = new Set(`a about above after again all also am an and any are as at be because been before being
below between both but by can could did do does doing done down during each few for from further get gets got had has
have having he her here hers him his how i if in into is it its itself just let me more most my no nor not now of off
on once only or other our ours out over own please same she should so some such than that the their theirs them then
there these they this those through to too under until up us very was we were what when where which while who whom
whose why will with would you your yours yourself jourvance want need tell show know`.split(/\s+/));

/** The step kinds (NodeType in src/types/journey.ts). Their words are always shareable. */
export const STEP_KINDS = Object.freeze(['ad-source', 'landing-page', 'lead-form', 'follow-up-sequence', 'thank-you', 'upsell', 'ab-split']);

/** Number words never enter the allowlist: written out, a figure is still a figure. */
export const NUMBER_WORDS = new Set(`zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen
fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred hundreds thousand
thousands million millions billion billions trillion dozen dozens grand`.split(/\s+/));

export const PANEL_COPY_FILE = 'panel-copy.md';
/** The longest shared question, and the fewest guide words it must keep to be worth sharing. */
export const SHARE_MAX_CHARS = 200;
export const SHARE_MIN_WORDS = 3;

/** Lowercase word stems: plurals and -ing / -ed endings folded, so "publishing" meets "Publish". */
export function stem(word) {
  const w = String(word || '').toLowerCase();
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && /(?:sh|ch|x|ss|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** The distinct stems of a text, stop words and one-letter words removed. */
export function termsOf(text) {
  const out = new Set();
  for (const raw of String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOP_WORDS.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/** The guide's `## ` sections as { heading, body, text }. Text before the first heading is the title and is left out. */
export function splitGuideSections(markdown) {
  const src = typeof markdown === 'string' ? markdown.replace(/\r\n/g, '\n') : '';
  const sections = [];
  const parts = src.split(/^## /m);
  for (let i = 1; i < parts.length; i++) {
    const nl = parts[i].indexOf('\n');
    const heading = (nl < 0 ? parts[i] : parts[i].slice(0, nl)).trim();
    // The source-file comments are for the people who maintain the guide, not for the model.
    const body = (nl < 0 ? '' : parts[i].slice(nl + 1)).replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!heading) continue;
    sections.push({ heading, body, text: `## ${heading}\n${body}`.trim() });
  }
  return sections;
}

const loaded = new Map();

/**
 * The guide's sections, read from disk once per path. A missing, unreadable or empty file answers []
 * and is not remembered, so a guide that appears later is read then.
 */
export function loadGuideSections(filePath) {
  if (typeof filePath !== 'string' || !filePath) return [];
  const key = path.resolve(filePath);
  if (loaded.has(key)) return loaded.get(key);
  let text = '';
  try {
    text = fs.readFileSync(key, 'utf8');
  } catch {
    return [];
  }
  const sections = splitGuideSections(text);
  if (sections.length) loaded.set(key, sections);
  return sections;
}

/** Cut `text` to at most `room` characters at a line or a space. */
function cutTo(text, room) {
  if (text.length <= room) return text;
  const head = text.slice(0, room);
  const at = Math.max(head.lastIndexOf('\n'), head.lastIndexOf(' '));
  return (at > room / 2 ? head.slice(0, at) : head).trim();
}

/**
 * The `max` sections that best match the question, best first, ties in file order. A section scores
 * one per question word in its body and two per question word in its heading; a section that
 * scores 0 is never sent. The texts together stay within GUIDE_SLICE_MAX_CHARS.
 */
export function guideSectionsFor(question, sections, max = 3) {
  const q = termsOf(question);
  if (!q.size || !Array.isArray(sections) || !(max > 0)) return [];
  const scored = sections
    .map((s, index) => {
      if (!s || typeof s.text !== 'string') return null;
      const heading = termsOf(s.heading);
      const body = termsOf(s.body);
      let score = 0;
      for (const t of q) score += (heading.has(t) ? 2 : 0) + (body.has(t) ? 1 : 0);
      return { s, index, score };
    })
    .filter((x) => x && x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max);
  const out = [];
  let room = LIMITS.GUIDE_SLICE_MAX_CHARS;
  for (const { s } of scored) {
    if (room < 200 && out.length) break;
    const text = cutTo(s.text, room);
    if (!text) break;
    out.push({ heading: s.heading, text });
    room -= text.length;
    if (room <= 0) break;
  }
  return out;
}

// ---- The flywheel allowlist ----

// The characters a shared question keeps. Everything else (quotes, apostrophes, dashes, underscores,
// markdown, brackets) is removed before a word is looked up.
const SHARE_STRIP = /[^\p{L}\p{Nd}\s.,?]/gu;

/** The words of a document, lowercased, letters only: both split at every other character and joined the way a question is. */
export function shareWordsOf(text) {
  const src = String(text || '').replace(/<!--[\s\S]*?-->/g, ' ').toLowerCase();
  const out = new Set();
  for (const w of src.replace(SHARE_STRIP, '').split(/[^\p{L}]+/u)) if (w) out.add(w);
  for (const w of src.split(/[^\p{L}]+/u)) if (w) out.add(w);
  return out;
}

/**
 * Every word of the given documents, the stop words and the step kinds' words, without number
 * words. Empty when no document has text: with nothing to compare against, nothing is shared.
 */
export function buildShareAllowlist(texts) {
  const docs = (Array.isArray(texts) ? texts : [texts]).filter((t) => typeof t === 'string' && t.trim());
  if (!docs.length) return new Set();
  const allow = new Set(STOP_WORDS);
  for (const kind of STEP_KINDS) for (const w of shareWordsOf(kind)) allow.add(w);
  for (const doc of docs) for (const w of shareWordsOf(doc)) allow.add(w);
  for (const n of NUMBER_WORDS) allow.delete(n);
  return allow;
}

const allowLoaded = new Map();

/**
 * The allowlist from the guide and panel-copy.md beside it, read once per guide path. Missing or
 * empty files answer an empty set and are not remembered, so documents that appear later are read.
 */
export function loadShareAllowlist(guidePath) {
  if (typeof guidePath !== 'string' || !guidePath) return new Set();
  const key = path.resolve(guidePath);
  if (allowLoaded.has(key)) return allowLoaded.get(key);
  const read = (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  };
  const allow = buildShareAllowlist([read(key), read(path.join(path.dirname(key), PANEL_COPY_FILE))]);
  if (allow.size) allowLoaded.set(key, allow);
  return allow;
}

/**
 * The question as it may be shared with the hub's brain, or why it may not. Lowercased, every digit
 * run N, every character but letters, digits, spaces and .,? removed, every word the allowlist does
 * not hold replaced by [word] (repeats collapsed), cut to SHARE_MAX_CHARS at a word. Refused when the
 * allowlist is empty or fewer than SHARE_MIN_WORDS guide words that are not stop words remain.
 * Answers { ok: true, text } or { ok: false, reason }.
 */
export function shareableQuestion(question, allowlist) {
  const allow = allowlist instanceof Set ? allowlist : new Set();
  // Each reason is one bare cause: the client wraps it in its own sentence.
  if (!allow.size) return { ok: false, reason: 'The Jourvance guide is not on this server.' };
  let s = String(question ?? '').toLowerCase();
  s = s.replace(/\p{Nd}+/gu, 'N');
  s = s.replace(SHARE_STRIP, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\p{L}+/gu, (w) => (w === 'N' || allow.has(w) ? w : '[word]'));
  s = s.replace(/\[word\](?: \[word\])+/g, '[word]');
  if (s.length > SHARE_MAX_CHARS) {
    const head = s.slice(0, SHARE_MAX_CHARS + 1);
    const at = head.lastIndexOf(' ');
    s = (at > 0 ? head.slice(0, at) : head.slice(0, SHARE_MAX_CHARS)).trim();
  }
  const kept = new Set((s.replace(/\[word\]/g, ' ').match(/\p{L}+/gu) || []).filter((w) => w !== 'N' && !STOP_WORDS.has(w)));
  if (kept.size < SHARE_MIN_WORDS) {
    return { ok: false, reason: 'The question is mostly about your own business.' };
  }
  return { ok: true, text: s };
}
