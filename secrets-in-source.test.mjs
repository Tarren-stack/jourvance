// No secret falls back to a literal in the source (a hub rule; INTERNAL_CRON_SECRET's fallback
// was the first one removed). This is the gate: a new `X_SECRET || 'literal'` fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['server.mjs', 'hub-storage.mjs', ...fs.readdirSync(path.join(ROOT, 'server')).filter((f) => f.endsWith('.mjs')).map((f) => `server/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'server/routes')).filter((f) => f.endsWith('.mjs')).map((f) => `server/routes/${f}`)];
const LITERAL_FALLBACK = /(SECRET|_KEY|TOKEN|SALT)[A-Z_]*\s*\|\|\s*['"`][^'"`]{6,}['"`]/;

test('no server file lets a secret fall back to a literal', () => {
  assert.ok(FILES.length >= 10, `expected the server files, saw ${FILES.length}`);
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const hit = src.match(LITERAL_FALLBACK);
    assert.equal(hit, null, `${f}: ${hit && hit[0]}`);
  }
});

test('the two old literals are gone and the per-process key is what replaces them', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
  assert.doesNotMatch(src, /jourvance_internal_salt_key_84920|jourvance_domain_salt_2026/);
  assert.match(src, /process\.env\.MAIL_LINK_SECRET \|\| process\.env\.HUB_API_KEY \|\| processSecret\('MAIL_LINK_SECRET'/);
  assert.match(src, /process\.env\.SESSION_SECRET \|\| process\.env\.HUB_API_KEY \|\| processSecret\('SESSION_SECRET'/);
  assert.match(src, /crypto\.randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(src, /will not verify after a restart/);
});
