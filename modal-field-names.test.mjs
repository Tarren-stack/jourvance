import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Every field in the header overlays has a programmatic name. The overlays drew a <label> above
// each field with no htmlFor and the field beside it, not inside it, so the label named nothing:
// a screen reader heard an unnamed "edit text" on the sign-in email and password, on Save as
// Blueprint's title, category and notes, on the Shopify store domain, on the Export Assets
// endpoints, and on five read-only Shopify webhook URLs that had no placeholder either.
//
// The scan reads each file's JSX: every <input>, <select> and <textarea> must carry aria-label or
// aria-labelledby, sit inside a <label>, or have an id that a <label htmlFor> names with the same
// expression. And every <label> must name something, so a label left unattached fails even when
// its field found a name another way.

const FILES = [
  './src/components/auth/AuthModal.tsx',
  './src/components/shopify/ShopifyConnectModal.tsx',
  './src/components/modals/BlueprintModal.tsx',
  './src/components/modals/SaveBlueprintModal.tsx',
  './src/components/export/ExportAssetsModal.tsx',
  './src/components/modals/ShopifySyncModal.tsx',
  './src/components/preview/PublishModal.tsx',
  './src/components/billing/BillingModal.tsx',
  './src/components/modals/ShopifyProductPickerModal.tsx'
];

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

/** Each opening tag of the given names, read to its closing > with braces and strings balanced. */
function openingTags(source, names) {
  const tags = [];
  const start = new RegExp(`<(${names.join('|')})(?=[\\s>/])`, 'g');
  let m;
  while ((m = start.exec(source))) {
    let depth = 0;
    let quote = null;
    let i = m.index + m[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    tags.push({ name: m[1], index: m.index, end: i + 1, text: source.slice(m.index, i + 1) });
  }
  return tags;
}

/** The value of an attribute as written: the quoted string or the {expression}. */
function attr(tag, name) {
  const m = new RegExp(`\\s${name}=(\\{[^]*?\\}(?=\\s|/?>)|"[^"]*")`).exec(tag);
  return m ? m[1] : null;
}

/** True when the element at `index` sits inside an open <label> element. */
function insideLabel(source, index) {
  const before = source.slice(0, index);
  return before.lastIndexOf('<label') > before.lastIndexOf('</label>');
}

function unnamed(source) {
  const labels = openingTags(source, ['label']);
  const targets = new Set(labels.map(l => attr(l.text, 'htmlFor')).filter(Boolean));
  const problems = [];
  for (const control of openingTags(source, ['input', 'select', 'textarea'])) {
    if (attr(control.text, 'type') === '"hidden"') continue;
    if (attr(control.text, 'aria-label') || attr(control.text, 'aria-labelledby')) continue;
    if (insideLabel(source, control.index)) continue;
    const id = attr(control.text, 'id');
    if (id && targets.has(id)) continue;
    const line = source.slice(0, control.index).split('\n').length;
    problems.push(`line ${line}: <${control.name}> has no label, aria-label or aria-labelledby`);
  }
  const ids = new Set(openingTags(source, ['input', 'select', 'textarea']).map(c => attr(c.text, 'id')).filter(Boolean));
  for (const label of labels) {
    const line = source.slice(0, label.index).split('\n').length;
    const target = attr(label.text, 'htmlFor');
    if (target) {
      if (!ids.has(target)) problems.push(`line ${line}: <label htmlFor=${target}> names no field`);
      continue;
    }
    const close = source.indexOf('</label>', label.end);
    const body = source.slice(label.end, close);
    if (!/<(input|select|textarea)[\s>/]/.test(body)) problems.push(`line ${line}: <label> wraps no field and has no htmlFor`);
  }
  return problems;
}

for (const file of FILES) {
  test(`${file}: every field has a name and every label names a field`, () => {
    assert.deepEqual(unnamed(read(file)), []);
  });
}

test('the read-only Shopify webhook URLs are named after their event', () => {
  const source = read('./src/components/modals/ShopifySyncModal.tsx');
  assert.ok(source.includes('aria-label={`${label} webhook URL`}'), 'the shared WebhookUrl row');
  assert.ok(source.includes('aria-label="Order creation (orders/create) webhook URL"'));
  assert.ok(source.includes('aria-label="Checkout creation / update (checkouts/create) webhook URL"'));
});

test('the ids come from useFieldIds, so two mounted copies never share one', () => {
  for (const file of ['./src/components/auth/AuthModal.tsx', './src/components/modals/SaveBlueprintModal.tsx', './src/components/export/ExportAssetsModal.tsx', './src/components/modals/ShopifySyncModal.tsx']) {
    const source = read(file);
    assert.ok(/^import \{ useFieldIds \} from '\.\.\/\.\.\/lib\/a11yHooks';$/m.test(source), `${file} imports useFieldIds`);
    // The hook runs before the component's early return, so the hook order never changes.
    const hook = source.indexOf('const fid = useFieldIds();');
    const early = source.indexOf('if (!isOpen) return null;');
    assert.ok(hook > 0, `${file} calls useFieldIds`);
    if (early > 0) assert.ok(hook < early, `${file} calls it before the early return`);
  }
});

test('the sign-in fields tell the browser what they hold', () => {
  const source = read('./src/components/auth/AuthModal.tsx');
  assert.ok(source.includes('autoComplete="email"'));
  assert.ok(source.includes("autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}"));
});

test('the scan itself catches a label beside its field and accepts the three ways to name one', () => {
  const bad = `<div><label style={{ a: 1 }}>Email</label><input type="email" value={x} /></div>`;
  assert.equal(unnamed(bad).length, 2, 'the field and the label both fail');
  const tied = `<label htmlFor={fid('e')}>Email</label><input id={fid('e')} onChange={e => set(e.target.value)} />`;
  assert.deepEqual(unnamed(tied), []);
  const wrong = `<label htmlFor={fid('e')}>Email</label><input id={fid('f')} />`;
  assert.equal(unnamed(wrong).length, 2, 'a mismatched id names nothing');
  assert.deepEqual(unnamed(`<label><input type="checkbox" /> One time</label>`), []);
  assert.deepEqual(unnamed(`<input readOnly aria-label={\`\${label} webhook URL\`} value={v} />`), []);
});
