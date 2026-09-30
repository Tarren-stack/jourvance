// C51: the publish confirm and the Check design tooltip name the count, and the pronoun has to
// follow it too. Both said "see them" for a single open check. These files are TSX that Node
// cannot load, so the test lifts each template literal out of the source and renders it with the
// same variable the component uses, for one check and for several.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(f, 'utf8');

// The backticked template that contains `marker`, rendered as a function of `name`.
function templateAround(src, marker, name) {
  const at = src.indexOf(marker);
  assert.ok(at > 0, `found "${marker}"`);
  const start = src.lastIndexOf('`', src.lastIndexOf('${' + name + '} open design', at));
  const end = src.indexOf('`', at + marker.length);
  // eslint-disable-next-line no-new-func
  return new Function(name, `return ${src.slice(start, end + 1)};`);
}

test('the publish confirm says "see it" for one open check and "see them" for several', () => {
  const render = templateAround(read('src/App.tsx'), 'or OK to publish anyway.', 'open');
  assert.equal(render(1), 'This journey has 1 open design check. Choose Cancel to see it, or OK to publish anyway.');
  assert.equal(render(3), 'This journey has 3 open design checks. Choose Cancel to see them, or OK to publish anyway.');
});

test('the Check design tooltip says "see it" for one open check and "see them" for several', () => {
  const render = templateAround(read('src/components/toolbar/CanvasHeader.tsx'), 'Open Check design to see', 'designCount');
  assert.equal(render(1), '1 open design check. Open Check design to see it.');
  assert.equal(render(2), '2 open design checks. Open Check design to see them.');
});
