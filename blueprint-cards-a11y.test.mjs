import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The blueprint cards (BlueprintModal.tsx). They used to be a clickable <div> holding a button every
// one of 74 cards named "Use Blueprint", so a keyboard or screen reader user met 74 identical
// buttons and a browser check could not find a card by its name. A card is a named group now, and
// each of its buttons says which blueprint it acts on, starting with its visible words (WCAG 2.5.3).
// A card is NOT itself a button: it holds real buttons, and a button inside a button is invalid.

const src = fs.readFileSync('src/components/modals/BlueprintModal.tsx', 'utf8');

const tagAt = (text, index) => {
  let depth = 0;
  for (let i = index; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    else if (text[i] === '>' && depth === 0 && text[i - 1] !== '=') return text.slice(index, i + 1);
  }
  return text.slice(index);
};

const tags = (name) => [...src.matchAll(new RegExp(`<${name}(?=[\\s>])`, 'g'))].map(m => ({ at: m.index, text: tagAt(src, m.index) }));

test('the turnkey card is a group named by its own heading', () => {
  const card = tags('div').find(t => t.text.includes('data-blueprint-card={bp.id}'));
  assert.ok(card, 'the turnkey card');
  assert.match(card.text, /role="group"/);
  assert.match(card.text, /aria-labelledby=\{`bp-title-\$\{bp\.id\}`\}/);
  const heading = tags('h3').find(t => t.text.includes('id={`bp-title-${bp.id}`}'));
  assert.ok(heading, 'the heading the group names');
  assert.match(src.slice(heading.at, heading.at + 400), /\{bp\.title\}/);
});

test('the custom card is a group named by its own heading', () => {
  const card = tags('div').find(t => t.text.includes('data-blueprint-card={cb.id}'));
  assert.ok(card, 'the custom card');
  assert.match(card.text, /role="group"/);
  assert.match(card.text, /aria-labelledby=\{`bp-custom-title-\$\{cb\.id\}`\}/);
  assert.ok(tags('h3').some(t => t.text.includes('id={`bp-custom-title-${cb.id}`}')));
});

test('every button on a card names its blueprint and starts with the words it shows', () => {
  const use = tags('button').filter(t => /aria-label=\{`Use Blueprint: \$\{(bp\.title|cb\.name)\}`\}/.test(t.text));
  assert.equal(use.length, 2, 'one Use Blueprint button on each kind of card');
  for (const word of ['Share ${cb.name}', 'Link Copied! ${cb.name}', 'Delete ${cb.name}']) assert.ok(src.includes(word), word);
  // No button that acts on a blueprint is left with only the bare words 74 cards would share.
  const acting = tags('button').filter(t => /handleSelectTurnkey|handleSelectCustom|handleCopyShareLink|handleDeleteCustom/.test(src.slice(t.at, t.at + 300)));
  assert.equal(acting.length, 4, 'turnkey Use, custom Share, Use and Delete');
  for (const t of acting) assert.match(t.text, /aria-label=/, t.text.slice(0, 120));
});

test('the card itself is not a button, so no button sits inside another', () => {
  for (const key of ['data-blueprint-card={bp.id}', 'data-blueprint-card={cb.id}']) {
    const card = tags('div').find(t => t.text.includes(key));
    assert.doesNotMatch(card.text, /role="button"/);
    assert.doesNotMatch(card.text, /tabIndex/);
  }
});

test('no em dash in the file', () => {
  assert.ok(!src.includes('\u2014'));
});
