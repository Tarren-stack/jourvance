// Page builder templates (LANDING_BUILDER_PLAN.md, Wave 3): src/lib/pageBuilder/templates.mjs.
// Every template validates and renders clean, is deterministic once ids are held fixed, carries no
// copy of its own, and mints fresh ids on every build.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, buildTemplate } from './src/lib/pageBuilder/templates.mjs';
import { validateBuilderDoc, walk } from './src/lib/pageBuilder/model.mjs';
import { render } from './src/lib/pageBuilder/render.mjs';

const ids = doc => { const out = []; walk(doc, n => { out.push(n.id); }); return out; };
const sameIds = html => html.replace(/jvb-n-[A-Za-z]+-[a-z0-9]+/g, 'jvb-n').replace(/(id|for|aria-[a-z]+)="[^"]*"/g, '$1=""');

describe('page builder templates', () => {
  it('ships at least eight, with unique ids and a name, group and description each', () => {
    assert.ok(TEMPLATES.length >= 8);
    assert.equal(new Set(TEMPLATES.map(t => t.id)).size, TEMPLATES.length);
    for (const t of TEMPLATES) {
      for (const k of ['id', 'name', 'group', 'description']) assert.ok(typeof t[k] === 'string' && t[k].length > 0, `${t.id}.${k}`);
      assert.equal(typeof t.build, 'function');
    }
  });

  it('covers the named commerce widgets', () => {
    const used = new Set();
    for (const t of TEMPLATES) walk(t.build(), n => { if (n.kind === 'widget') used.add(n.type); });
    for (const w of ['productHero', 'checkoutButton', 'orderBump', 'leadForm', 'reviewsWall', 'countdown', 'stockCount', 'trustBadge']) {
      assert.ok(used.has(w), w);
    }
  });

  it('an unknown id builds nothing', () => {
    assert.equal(buildTemplate('nope'), null);
  });

  for (const t of TEMPLATES) {
    describe(t.id, () => {
      it('validates with 0 problems', () => {
        const check = validateBuilderDoc(t.build());
        assert.deepEqual(check.problems, []);
        assert.equal(check.ok, true);
      });

      it('renders with 0 problems and the same output twice for one document', () => {
        const doc = t.build();
        const a = render(doc);
        assert.deepEqual(a.problems, []);
        assert.ok(a.html.length > 0);
        const b = render(doc);
        assert.deepEqual(a, b);
      });

      it('two builds differ only in ids', () => {
        const a = render(t.build());
        const b = render(t.build());
        assert.equal(sameIds(a.html), sameIds(b.html));
      });

      it('carries no copy: only section names, and empty text props', () => {
        const doc = buildTemplate(t.id);
        walk(doc, n => {
          if (n.kind === 'section') assert.ok(typeof n.props.label === 'string' && n.props.label.length > 0);
          if (n.kind !== 'widget') return;
          for (const key of ['text', 'label', 'headline', 'heading', 'buttonText', 'description', 'title', 'successText', 'expiredText']) {
            if (key in n.props) assert.equal(n.props[key], '', `${n.type}.${key}`);
          }
          for (const key of ['items']) if (key in n.props) assert.deepEqual(n.props[key], [], `${n.type}.${key}`);
        });
      });

      it('has unique ids that differ between two builds', () => {
        const a = ids(buildTemplate(t.id));
        const b = ids(buildTemplate(t.id));
        assert.equal(new Set(a).size, a.length);
        assert.equal(a.filter(x => b.includes(x)).length, 0);
      });
    });
  }
});
