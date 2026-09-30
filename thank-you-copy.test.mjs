import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// C56: the voucher's Copy button on the thank-you editor's Live Customer View set "Copied!" and
// never touched the clipboard, so a user was told the code was copied while nothing was. The
// clipboard rule lives in copyText.ts and is tested directly; the editor needs a browser to
// render, so the wiring is checked by reading its source, like a11y-drawers.test.mjs.

const { copyText, copyLabel, copyAnnouncement } = await import('./src/lib/copyText.ts');
const EDITOR = fs.readFileSync('src/components/drawers/ThankYouEditor.tsx', 'utf8');

const fakeClipboard = () => {
  const written = [];
  return { written, writeText: async text => { written.push(text); } };
};

test('a copy is ok only once the clipboard took the text', async () => {
  const clip = fakeClipboard();
  assert.equal(await copyText('SAVE10', clip), 'ok');
  assert.deepEqual(clip.written, ['SAVE10']);
});

test('a refused, missing or empty copy is a failure, never a success', async () => {
  assert.equal(await copyText('SAVE10', { writeText: () => Promise.reject(new Error('NotAllowedError')) }), 'fail');
  assert.equal(await copyText('SAVE10', { writeText: () => { throw new Error('sync throw'); } }), 'fail');
  assert.equal(await copyText('SAVE10', undefined), 'fail');
  assert.equal(await copyText('SAVE10', {}), 'fail');
  const clip = fakeClipboard();
  assert.equal(await copyText('', clip), 'fail');
  assert.deepEqual(clip.written, [], 'nothing to copy writes nothing');
});

test('the button and the screen reader say what really happened', () => {
  assert.equal(copyLabel(null), 'Copy');
  assert.equal(copyLabel('ok'), 'Copied');
  assert.equal(copyLabel('fail'), 'Could not copy');
  assert.equal(copyAnnouncement(null, 'Code'), '', 'nothing is announced before a press');
  assert.equal(copyAnnouncement('ok', 'Code'), 'Code copied.');
  const failure = copyAnnouncement('fail', 'Code');
  assert.match(failure, /^Could not copy the code/);
  assert.equal(failure.split(/[.!?](\s|$)/).filter(s => s && s.trim()).length, 1, 'one sentence');
  for (const text of [copyLabel('ok'), copyLabel('fail'), copyAnnouncement('ok', 'Code'), failure]) {
    assert.doesNotMatch(text, /—| – /, 'no em dash or spaced en dash');
  }
});

/** The JSX of the voucher's Copy button: from the <button before the voucher's copy label to </button>. */
function copyButton(src) {
  const label = src.search(/copyLabel\(|'Copied!'|'Copy'/);
  assert.ok(label > 0, 'the voucher Copy button is in the editor');
  const start = src.lastIndexOf('<button', label);
  return src.slice(start, src.indexOf('</button>', label));
}

test('the thank-you preview Copy button writes the code before it claims a copy', () => {
  const button = copyButton(EDITOR);
  // The press goes through the handler that awaits the clipboard, handed the code on show.
  assert.match(button, /onClick=\{\(\) => handleCopyVoucher\(view\.voucher!?\.code\)\}/);
  const handler = EDITOR.slice(EDITOR.indexOf('const handleCopyVoucher'));
  assert.match(handler, /^const handleCopyVoucher = async \(code: string\) => \{\s*const result = await copyText\(code\);/);
  // The state is only ever set from that result or cleared, never to a success on its own.
  const sets = [...EDITOR.matchAll(/setCopied\(([^)]*)\)/g)].map(m => m[1]);
  assert.deepEqual(sets.sort(), ['null', 'result']);
  assert.doesNotMatch(EDITOR, /Copied!/);
  // The label comes from the result, and the result is announced.
  assert.match(button, /\{copyLabel\(copied\)\}/);
  assert.match(EDITOR, /<span role="status" className="jv-sr-only">\{copyAnnouncement\(copied, 'Code'\)\}<\/span>/);
});
