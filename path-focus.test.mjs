import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Selecting a step fades every line that is not on its path (Aura's connectedPath rule). Only the
// line and its arrowhead fade: cards and rate pills keep full contrast, and the fade is never saved.

const { pathFocus, withPathFocus, PATH_MUTED_CLASS, PATH_MUTED_OPACITY } = await import('./src/lib/pathFocus.ts');

const edge = (id, source, target, extra = {}) => ({ id, source, target, ...extra });
const ids = set => [...set].sort();
const blueprintEdges = async prefix => {
  const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
  const bp = ECOM_BLUEPRINTS.find(b => b.nodes.some(n => n.id.startsWith(`${prefix}-`)));
  return bp.edges;
};

test('nothing selected, or a hidden step, focuses nothing', async () => {
  const E = await blueprintEdges('bp5');
  assert.equal(pathFocus(null, E), null);
  assert.equal(pathFocus(undefined, E), null);
  assert.equal(pathFocus('bp5-downsell', E, false), null);
  assert.strictEqual(withPathFocus(E, null), E);
});

test('a step lights its ancestors and descendants and no sibling branch', async () => {
  const f = pathFocus('bp5-downsell', await blueprintEdges('bp5'));
  assert.deepEqual(ids(f.edges), ['e-bp5-1', 'e-bp5-2', 'e-bp5-3', 'e-bp5-5']);
  assert.deepEqual(ids(f.nodes), ['bp5-ad', 'bp5-downsell', 'bp5-page', 'bp5-ty', 'bp5-upsell']);
  assert.ok(!f.edges.has('e-bp5-4'));
});

test('bp6 upsell and cart recovery', async () => {
  const E = await blueprintEdges('bp6');
  assert.deepEqual(ids(pathFocus('bp6-upsell', E).edges), ['e-bp6-1', 'e-bp6-2', 'e-bp6-4', 'e-bp6-5', 'e-bp6-6']);
  assert.deepEqual(ids(pathFocus('bp6-cart-recovery', E).edges), ['e-bp6-1', 'e-bp6-3']);
});

test('a join does not pull in the other arm', () => {
  const E = [edge('AB', 'A', 'B'), edge('AC', 'A', 'C'), edge('BD', 'B', 'D'), edge('CD', 'C', 'D')];
  assert.deepEqual(ids(pathFocus('B', E).edges), ['AB', 'BD']);
});

test('loops end', () => {
  const E = [edge('AB', 'A', 'B'), edge('BC', 'B', 'C'), edge('CA', 'C', 'A'), edge('DD', 'D', 'D')];
  assert.deepEqual(ids(pathFocus('A', E).edges), ['AB', 'BC', 'CA']);
  assert.deepEqual(ids(pathFocus('D', E).edges), ['DD']);
});

test('an unconnected step fades every line', () => {
  const E = [edge('AB', 'A', 'B'), edge('BC', 'B', 'C')];
  const f = pathFocus('lonely', E);
  assert.equal(f.edges.size, 0);
  assert.deepEqual(ids(f.nodes), ['lonely']);
  assert.ok(withPathFocus(E, f).every(e => e.className === PATH_MUTED_CLASS));
});

test('parallel lines are both lit', () => {
  const E = [
    edge('AB1', 'A', 'B', { sourceHandle: 'accepted' }),
    edge('AB2', 'A', 'B', { sourceHandle: 'declined' })
  ];
  assert.deepEqual(ids(pathFocus('B', E).edges), ['AB1', 'AB2']);
});

test('withPathFocus marks only faded lines', () => {
  const E = [edge('AB', 'A', 'B'), edge('CD', 'C', 'D', { className: 'x' }), edge('EF', 'E', 'F')];
  const before = JSON.stringify(E);
  const f = pathFocus('A', E);
  const out = withPathFocus(E, f);
  assert.strictEqual(out[0], E[0]);
  assert.equal(out[1].className, `x ${PATH_MUTED_CLASS}`);
  assert.equal(out[2].className, PATH_MUTED_CLASS);
  assert.equal(JSON.stringify(E), before);
  const twice = withPathFocus(out, f);
  assert.equal(twice[1].className, `x ${PATH_MUTED_CLASS}`);
  assert.equal(twice[2].className, PATH_MUTED_CLASS);
});

// Local copies of edge-kinds.test.mjs's helpers: importing that file would register its tests twice.
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const blend = (fg, bg, alpha) => {
  const ch = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
  return '#' + [1, 3, 5]
    .map(i => Math.round(ch(fg, i) * alpha + ch(bg, i) * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('');
};

test('a faded line is still traceable and clearly weaker than a lit one', async () => {
  const { EDGE_KINDS } = await import('./src/lib/edgeKinds.ts');
  for (const [kind, { color }] of Object.entries(EDGE_KINDS)) {
    const ratio = contrast(blend(color, '#0B0F19', PATH_MUTED_OPACITY), '#0B0F19');
    assert.ok(ratio >= 1.25 && ratio <= 2.0, `${kind} faded is ${ratio.toFixed(2)}:1`);
  }
});

// Every rule in the stylesheet as { selector, body, media }, with comments removed.
const cssRules = () => {
  const css = fs.readFileSync('./src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let i = 0;
  // Walk top level blocks, descending one level into an at-rule (@media, @keyframes).
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    if (head.startsWith('@')) {
      let depth = 1;
      let j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      const inner = css.slice(open + 1, j - 1);
      for (const m of inner.matchAll(re)) rules.push({ selector: m[1].trim(), body: m[2], media: head });
      i = j;
    } else {
      const close = css.indexOf('}', open);
      rules.push({ selector: head, body: css.slice(open + 1, close), media: null });
      i = close + 1;
    }
  }
  return rules;
};
const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : undefined;
};

test('the stylesheet fades only the edge group', () => {
  const rules = cssRules();
  const muted = rules.find(r => r.media === null && r.selector === '.react-flow__edge.jv-path-muted');
  assert.ok(muted, 'a .react-flow__edge.jv-path-muted rule exists');
  assert.equal(decl(muted.body, 'opacity'), String(PATH_MUTED_OPACITY));

  for (const r of rules) {
    for (const sel of r.selector.split(',').map(s => s.trim())) {
      if (!sel.includes(PATH_MUTED_CLASS)) continue;
      assert.match(sel, /^\.react-flow__edge\.jv-path-muted(:[a-z-]+)?$/, `${sel} reaches only the edge group`);
    }
  }

  const focused = rules.find(r => r.selector === '.react-flow__edge.jv-path-muted:focus-visible');
  assert.ok(focused, 'a focused faded line has a rule');
  assert.equal(decl(focused.body, 'opacity'), '1');

  const reduced = rules.find(
    r => r.media && /prefers-reduced-motion:\s*reduce/.test(r.media) && r.selector === '.react-flow__edge'
  );
  assert.ok(reduced, 'reduced motion has an edge rule');
  assert.equal(decl(reduced.body, 'transition'), 'none');

  for (const r of rules) {
    if (/\.react-flow__node\b|\.react-flow__edgelabel-renderer|\.react-flow__viewport-portal|data-jv-edge-label/.test(r.selector)) {
      assert.equal(decl(r.body, 'opacity'), undefined, `${r.selector} sets no opacity`);
    }
  }
});

test('the canvas renders the focus but never stores it', () => {
  const canvas = fs.readFileSync('./src/components/canvas/JourneyCanvas.tsx', 'utf8');
  const has = (src, re, msg) => assert.ok(re.test(src), msg);
  has(canvas, /import\s*\{\s*pathFocus\s*,\s*withPathFocus\s*\}\s*from\s*'\.\.\/\.\.\/lib\/pathFocus'/, 'imports pathFocus');
  has(canvas, /edges=\{focusedEdges\}/, 'React Flow draws focusedEdges');
  assert.ok(!/edges=\{displayedEdges\}/.test(canvas), 'React Flow no longer draws displayedEdges');
  assert.ok(!/setRfEdges\(\s*focusedEdges/.test(canvas), 'focusedEdges never reaches rfEdges');
  assert.ok(!/onEdgesChange\(\s*focusedEdges/.test(canvas), 'focusedEdges never reaches the saved journey');

  const edgeSrc = fs.readFileSync('./src/components/canvas/edges/ConversionEdge.tsx', 'utf8');
  has(edgeSrc, /data-edge-id=\{id\}/, 'the caption wrapper carries data-edge-id');
  assert.ok(!/opacity\s*:\s*(0?\.\d|0\b)/.test(edgeSrc), 'the pill is never faded');
});
