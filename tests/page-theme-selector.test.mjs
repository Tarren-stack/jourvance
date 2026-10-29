import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PAGE_THEME_IDS,
  isPageThemeId
} from '../src/types/journey.ts';

const pageEditorSrc = fs.readFileSync('src/components/drawers/PageEditor.tsx', 'utf8');

test('Theme Types: PAGE_THEME_IDS contains the 5 canonical themes', () => {
  assert.deepEqual(
    [...PAGE_THEME_IDS],
    ['clean-executive', 'bold-commerce', 'warm-editorial', 'creator-minimal', 'midnight-modern']
  );
  assert.equal(isPageThemeId('clean-executive'), true);
  assert.equal(isPageThemeId('bold-commerce'), true);
  assert.equal(isPageThemeId('warm-editorial'), true);
  assert.equal(isPageThemeId('creator-minimal'), true);
  assert.equal(isPageThemeId('midnight-modern'), true);
  assert.equal(isPageThemeId('default'), false);
  assert.equal(isPageThemeId('random-theme'), false);
});

test('PageEditor Theme Card: Exactly 5 editor sections maintained', () => {
  const sections = (pageEditorSrc.match(/<EditorSection\b/g) || []).length;
  assert.equal(sections, 5, 'PageEditor must keep exactly 5 sections');
});

test('PageEditor Theme Card: Role group with aria-labelledby and unique fid', () => {
  assert.match(
    pageEditorSrc,
    /id=\{fid\('page-theme-heading'\)\}/,
    'Page theme heading must use fid page-theme-heading'
  );
  assert.match(
    pageEditorSrc,
    /role="group"\s+aria-labelledby=\{fid\('page-theme-heading'\)\}/,
    'Theme buttons must be in an accessible role=group'
  );
  const fidMatches = [...pageEditorSrc.matchAll(/\sid=\{fid\('([^']+)'\)\}/g)].map(m => m[1]);
  const dupeIds = fidMatches.filter((id, i) => fidMatches.indexOf(id) !== i);
  assert.deepEqual(dupeIds, [], `PageEditor must contain zero duplicate fid() IDs. Found: ${dupeIds}`);
});

test('PageEditor Theme Card: Displays Original Default and all 5 universal themes', () => {
  const requiredThemes = [
    'Original (Default)',
    'Clean Executive',
    'Bold Commerce',
    'Warm Editorial',
    'Creator Minimal',
    'Midnight Modern'
  ];
  for (const name of requiredThemes) {
    assert.ok(pageEditorSrc.includes(name), `PageEditor must include theme option: ${name}`);
  }
});

test('PageEditor Theme Card: Selection wired to handleFieldChange', () => {
  assert.match(
    pageEditorSrc,
    /handleFieldChange\('theme',\s*opt\.id === 'default' \? undefined : opt\.id\)/,
    'Theme selection must call handleFieldChange with theme and clear to undefined for default'
  );
});

test('PageEditor Theme Card: Accessible styling and typography compliance', () => {
  assert.ok(!pageEditorSrc.includes('\u2014'), 'No em dashes in PageEditor');
  assert.doesNotMatch(pageEditorSrc, /\s\u2013\s/, 'No spaced en dashes in PageEditor');
  const lines = pageEditorSrc.split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/fontSize:\s*(\x27|\")?([0-9]+)px?(\x27|\")?/);
    if (m && parseInt(m[2], 10) < 11) {
      assert.fail(`Line ${i + 1} has small text: ${m[0]}`);
    }
  });
});
