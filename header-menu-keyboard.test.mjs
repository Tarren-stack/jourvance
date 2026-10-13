// C30: Escape from inside the header's Add Step menu closed it and dropped focus on the
// page body, because the Escape handler only closed the menu and the item that held focus was
// unmounted under it. These pins read CanvasHeader.tsx; checkHeaderMenus in
// scripts/a11y-browser-check.mjs drives the same contract with a keyboard in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const header = code(fs.readFileSync('src/components/toolbar/CanvasHeader.tsx', 'utf8'));

// The window keydown effect that closes the menus on Escape.
function escapeHandler() {
  const at = header.indexOf("if (e.key !== 'Escape') return;");
  assert.ok(at > 0, 'the Escape handler exists');
  const end = header.indexOf("window.addEventListener('keydown', onKey)", at);
  assert.ok(end > at);
  return header.slice(at, end);
}

// The JSX of the role="menu" element carrying the given aria-label.
function menuTag(label) {
  const at = header.indexOf(`aria-label="${label}"`);
  assert.ok(at > 0, `${label} menu exists`);
  const open = header.lastIndexOf('<div', at);
  const close = header.indexOf('>', at);
  return header.slice(open, close + 1);
}

test('Escape from a menu item hands focus back to that menu\'s button before the menu closes', () => {
  const h = escapeHandler();
  const pairs = [['addMenuRef', 'addButtonRef'], ['userMenuRef', 'userButtonRef']];
  for (const [menu, button] of pairs) {
    assert.match(h, new RegExp(`${menu}\\.current\\?\\.contains\\(active\\)\\) ${button}\\.current\\?\\.focus\\(\\)`), `${menu} returns focus to ${button}`);
  }
  // Focus moves while the item still exists, so it has to happen before any menu is closed.
  const firstFocus = h.indexOf('.focus()');
  for (const close of ['setShowAddMenu(false)', 'setShowUserMenu(false)']) {
    assert.ok(h.indexOf(close) > firstFocus, `${close} runs after focus has moved`);
  }
});

test('each menu the Escape handler reads is the element its ref points at', () => {
  assert.match(menuTag('Add a step'), /ref=\{addMenuRef\}/);
  assert.match(header, /\{showUserMenu && \(\s*<div\s+ref=\{userMenuRef\}/);
});

test('Add Step moves with the arrow keys, and opens with focus on its first item', () => {
  const tag = menuTag('Add a step');
  assert.match(tag, /role="menu"/);
  assert.match(tag, /onKeyDown=\{moveInMenu\}/);
  assert.match(header, /if \(!showAddMenu\) return;\s*addMenuRef\.current\?\.querySelector<HTMLElement>\('\[role="menuitem"\]'\)\?\.focus\(\);\s*\}, \[showAddMenu\]\)/);
});

test('the browser harness runs the header menu check with the other keyboard checks', async () => {
  const { CHECKS } = await import('./scripts/a11y-browser-check.mjs');
  assert.equal(typeof CHECKS.headerMenus, 'function');
});
