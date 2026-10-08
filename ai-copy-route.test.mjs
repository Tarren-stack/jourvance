// /api/ai/copy returned model copy with no em dash strip and no rule in the prompt, while
// /api/ai/journey-plan already had both. The strip is in code at the route boundary (hub rule).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanModelStrings } from './server/routes/aiJourneyRoutes.mjs';

test('the copy route strips the model answer and names the rule in its prompt', () => {
  const src = fs.readFileSync(new URL('./server/routes/authWorkspaceRoutes.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{ cleanModelStrings \} from '\.\/aiJourneyRoutes\.mjs'/);
  const route = src.slice(src.indexOf("app.post('/api/ai/copy'"), src.indexOf("source: 'template' });", src.indexOf("app.post('/api/ai/copy'")));
  assert.match(route, /copy\[f\] = cleanModelStrings\(parsed\[f\]\)/);
  assert.match(route, /no em dashes or spaced en dashes/);
  assert.doesNotMatch(route, /copy\[f\] = parsed\[f\]/);
});

test('cleanModelStrings takes the em dash and the spaced en dash out of a string', () => {
  const out = cleanModelStrings('Fast setup — no code – ready today');
  assert.doesNotMatch(out, /—/);
  assert.doesNotMatch(out, /\s–\s/);
  assert.match(out, /Fast setup/);
  assert.match(out, /ready today/);
});
