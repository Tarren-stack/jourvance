// C31: the header's workspace switcher opened a list that a keyboard could not close. The button
// said nothing about the list (no aria-expanded, no aria-controls), Escape did nothing because the
// selector keeps its own `open` state out of reach of the header's Escape handler, and the list sat
// after the Shopify pill in the DOM, so Tab left the button for the pill and then wandered on into
// the header with the list still open over it.
//
// The real WorkspaceSelector is bundled with esbuild and rendered with react-dom/server, once
// closed and once open (the bundle's first useState reads a flag the test sets), so the markup
// pins read what a screen reader is given. The key and focus handlers are pinned on the source;
// the fix run drove the same contract with a keyboard in Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = new URL('.', import.meta.url).pathname;
const SOURCE = 'src/components/toolbar/WorkspaceSelector.tsx';
const out = await build({
  stdin: {
    contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { WorkspaceSelector } from './${SOURCE}';
      export const render = props => renderToStaticMarkup(React.createElement(WorkspaceSelector, props));`,
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
    name: 'open-flag',
    setup(b) {
      b.onLoad({ filter: /WorkspaceSelector\.tsx$/ }, args => {
        const src = readFileSync(args.path, 'utf8');
        const opened = src.replace('useState(false)', 'useState(!!globalThis.__jvWorkspaceOpen)');
        assert.notEqual(opened, src, 'the open state starts from useState(false)');
        return { contents: opened, loader: 'tsx' };
      });
    }
  }]
});
const dir = mkdtempSync(join(tmpdir(), 'jv-workspace-selector-'));
const file = join(dir, 'workspace-selector.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { render } = await import(pathToFileURL(file).href);
rmSync(dir, { recursive: true, force: true });

const ws = { id: 'w1', name: 'Main E-Commerce Workspace' };
const props = {
  workspaces: [ws, { id: 'w2', name: 'Second store' }],
  currentWorkspace: ws,
  onSelectWorkspace() {},
  onOpenShopifyConnect() {},
  onCreateWorkspace() {}
};
const markup = open => {
  globalThis.__jvWorkspaceOpen = open;
  try { return render(props); } finally { delete globalThis.__jvWorkspaceOpen; }
};
// The opening tag of the first button whose text starts with the workspace name.
const triggerTag = html => {
  const at = html.indexOf('Main E-Commerce Workspace');
  assert.ok(at > 0, 'the trigger renders');
  const open = html.lastIndexOf('<button', at);
  return html.slice(open, html.indexOf('>', open) + 1);
};

test('closed, the workspace button says its list is collapsed and names no missing element', () => {
  const html = markup(false);
  const tag = triggerTag(html);
  assert.match(tag, /aria-expanded="false"/);
  assert.doesNotMatch(tag, /aria-controls=/, 'no aria-controls pointing at a list that is not in the DOM');
  assert.doesNotMatch(html, /Add New Workspace/);
});

test('open, the button is expanded and controls the list, which is labelled and comes before the Shopify pill', () => {
  const html = markup(true);
  const tag = triggerTag(html);
  assert.match(tag, /aria-expanded="true"/);
  const id = tag.match(/aria-controls="([^"]+)"/)?.[1];
  assert.ok(id, 'aria-controls names the list');
  const list = html.indexOf(`id="${id}"`);
  assert.ok(list > 0, 'the element aria-controls names is rendered');
  const listTag = html.slice(html.lastIndexOf('<div', list), html.indexOf('>', list) + 1);
  assert.match(listTag, /aria-label="Workspaces"/);
  assert.ok(html.indexOf('Add New Workspace') > list, 'the list holds the workspace actions');
  // Tab order follows the DOM: button, then the list, then the pill.
  assert.ok(list > html.indexOf('Main E-Commerce Workspace'));
  assert.ok(html.indexOf('Connect Shopify') > html.indexOf('Manage Shopify Store'), 'the Shopify pill comes after the list');
});

const code = readFileSync(SOURCE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('Escape closes the list and hands focus back to the button when focus was inside', () => {
  const at = code.indexOf("if (e.key !== 'Escape') return;");
  assert.ok(at > 0, 'an Escape handler exists');
  const body = code.slice(at, code.indexOf("window.addEventListener('keydown', onKey)", at));
  assert.match(body, /containerRef\.current\?\.contains\(document\.activeElement\)\) triggerRef\.current\?\.focus\(\)/);
  assert.ok(body.indexOf('setOpen(false)') > body.indexOf('.focus()'), 'focus moves before the focused item unmounts');
  assert.match(code, /if \(!open\) return;\s*const onKey/, 'the listener is only live while the list is open');
  assert.match(code, /<button\s+ref=\{triggerRef\}/, 'triggerRef is the workspace button');
});

test('focus leaving both the button and the list closes it, and moving between them does not', () => {
  const at = code.indexOf('const closeWhenFocusLeaves');
  assert.ok(at > 0);
  const fn = code.slice(at, code.indexOf('};', at));
  assert.match(fn, /if \(next && \(triggerRef\.current\?\.contains\(next\) \|\| menuRef\.current\?\.contains\(next\)\)\) return;/);
  assert.match(fn, /setOpen\(false\)/);
  assert.match(code, /<button\s+ref=\{triggerRef\}[\s\S]{0,120}onBlur=\{open \? closeWhenFocusLeaves : undefined\}/);
  assert.match(code, /ref=\{menuRef\}[\s\S]{0,160}onBlur=\{closeWhenFocusLeaves\}/);
  // Focus leaving to nothing (Shift+Tab off the first control) closes it too, so a click on the
  // list's own heading has to land focus on the list, or it would read as leaving.
  assert.match(code, /ref=\{menuRef\}[\s\S]{0,120}tabIndex=\{-1\}/);
});
