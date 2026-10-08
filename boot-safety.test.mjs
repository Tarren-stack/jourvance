// The boot hazards from the 2026-10-07 audit: a cron password in source, due fixture mail,
// and sample pages that were still published.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('./server/routes/publicRoutes.mjs', import.meta.url), 'utf8');

test('the cron route has no password in source', () => {
  assert.doesNotMatch(server, /jourvance_internal_cron_secret/);
  assert.match(server, /const INTERNAL_CRON_SECRET = String\(process\.env\.INTERNAL_CRON_SECRET \|\| ''\)\.trim\(\)/);
  const gate = server.indexOf('if (INTERNAL_CRON_SECRET)');
  const route = server.indexOf("app.post('/api/internal/cron/drips'");
  assert.ok(gate > 0 && route > gate, 'the cron route is mounted only when the secret is set');
});

test('shopify note attributes are readable at boot', () => {
  assert.match(server, /function noteAttrMap\(payload\)/);
  assert.match(server, /note_attributes/);
  const ctx = server.indexOf('const shopifyCtx = {');
  const fn = server.indexOf('function noteAttrMap(payload)');
  assert.ok(fn > 0 && ctx > fn, 'noteAttrMap exists before the shopify routes are mounted');
});

test('fixture enrolments are stopped before a drip can send', () => {
  assert.match(server, /function holdFixtureEnrollments/);
  assert.match(server, /example\.com/);
  assert.match(server, /stoppedReason = 'fixture'/);
  assert.match(server, /if \(holdFixtureEnrollments\(enrollments\)\) modified = true/);
});

test('sample storefront hosts are not served', () => {
  for (const host of ['glowbotanics.com', 'wave5luxury.com', 'wave9brand.com']) {
    assert.ok(routes.includes(host), host);
  }
  for (const slug of ['vip-glow-kit', 'duo-glow-bundle', 'wave4-elixir']) {
    assert.ok(routes.includes(slug), slug);
  }
  assert.match(routes, /SAMPLE_STORE_DOMAINS\.has\(storeDomainOf\(page\)\)/);
  assert.match(routes, /domain !== 'demo\.myshopify\.com'/);
  assert.match(routes, /Sample pages are not served/);
  assert.match(routes, /This address is not a published page/);
});

test('the local public page file does not keep the sample storefronts', () => {
  const file = new URL('./public_pages.json', import.meta.url);
  if (!fs.existsSync(file)) return;
  const pages = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const slug of ['glow-elixir', 'wave5-elixir', 'wave9-radiance', 'vip-glow-kit', 'duo-glow-bundle', 'wave4-elixir']) {
    assert.equal(pages[slug], undefined, slug);
  }
  const blob = JSON.stringify(pages);
  assert.doesNotMatch(blob, /glowbotanics|wave5luxury|wave9brand|luxeglow|rosebotanics/);
  assert.ok(pages['saas-growth-funnel'], 'the dev funnel page stays');
});

test('the local drip store has no active fixture enrolment', () => {
  const file = new URL('./drips.json', import.meta.url);
  if (!fs.existsSync(file)) return;
  const drips = JSON.parse(fs.readFileSync(file, 'utf8'));
  const active = (drips.enrollments || []).filter((row) => row.status === 'active');
  assert.equal(active.length, 0);
  assert.ok((drips.sequences || []).some((seq) => seq.id === 'drip_seq_default'));
});
