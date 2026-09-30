// R09: npm run check:a11y on port 5000 of a Mac. The AirPlay Receiver (ControlCenter) holds *:5000,
// a bare `vite preview --port 5000` bound only [::1], the script then visited localhost, reached
// AirPlay's 403 on 127.0.0.1 for 30 seconds and said "nothing answered", with the preview's own
// output thrown away (stdio 'ignore'). The preview binds 127.0.0.1 now, the checks visit that
// address, and a preview that cannot be reached is reported by what did answer.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREVIEW_HOST, previewCommand, waitForServer } from './scripts/a11y-browser-check.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const code = p => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const DASHES = /—| – /;

function serve(status, headers = {}) {
  return http.createServer((req, res) => { res.writeHead(status, headers); res.end(status === 200 ? '<!doctype html><div id="root"></div>' : ''); });
}
const listen = (srv, port, host) => new Promise((resolve, reject) => {
  srv.once('error', reject);
  srv.listen(port, host, () => { srv.off('error', reject); resolve(srv.address().port); });
});
const close = srv => new Promise(r => (srv.listening ? srv.close(() => r()) : r()));

test('the preview binds 127.0.0.1 and the checks visit the same address', () => {
  assert.equal(PREVIEW_HOST, '127.0.0.1');
  const { args, base } = previewCommand('/tmp/out', 5000);
  assert.deepEqual(args, ['vite', 'preview', '--outDir', '/tmp/out', '--host', '127.0.0.1', '--port', '5000', '--strictPort']);
  assert.equal(base, 'http://127.0.0.1:5000');
});

test('a port held by another program is reported by its status and Server header, not as silence', async () => {
  const airplay = serve(403, { Server: 'AirTunes/950.7.1' });
  const port = await listen(airplay, 0, '127.0.0.1');
  try {
    const started = Date.now();
    const up = await waitForServer(`http://127.0.0.1:${port}`, { ms: 1200 });
    assert.equal(up.ok, false);
    assert.match(up.reason, /answered HTTP 403 from "AirTunes\/950\.7\.1" instead of the app/);
    assert.doesNotMatch(up.reason, DASHES);
    assert.ok(Date.now() - started < 8000, 'the wait is bounded by ms');
  } finally {
    await close(airplay);
  }
});

test('a preview that exits is reported at once with its exit code', async () => {
  const started = Date.now();
  const up = await waitForServer('http://127.0.0.1:9', { ms: 30000, exited: () => 1 });
  assert.equal(up.ok, false);
  assert.match(up.reason, /the preview stopped \(exit 1\)/);
  assert.ok(Date.now() - started < 2000, 'an exited preview is not waited on for 30 seconds');
});

test('a port nobody holds is reported with the connection error', async () => {
  const probe = serve(200);
  const port = await listen(probe, 0, '127.0.0.1');
  await close(probe);
  const up = await waitForServer(`http://127.0.0.1:${port}`, { ms: 700 });
  assert.equal(up.ok, false);
  assert.match(up.reason, /did not answer \(ECONNREFUSED\)/);
});

test('a preview on 127.0.0.1 is reached even while another program holds the wildcard of that port', async t => {
  // The AirPlay shape: a dual-stack wildcard listener answering 403 on the port.
  const airplay = serve(403, { Server: 'AirTunes/950.7.1' });
  const port = await listen(airplay, 0, '::');
  const preview = serve(200);
  try {
    // Positive control: the wildcard holder really answers on this port.
    const held = await fetch(`http://[::1]:${port}/`).catch(() => null);
    assert.equal(held?.status, 403, 'the stand-in for AirPlay answers on the port');
    try {
      await listen(preview, port, PREVIEW_HOST);
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      t.skip('this OS refuses a specific bind under a wildcard listener; vite then says so and the script shows it');
      return;
    }
    const up = await waitForServer(previewCommand('/tmp/out', port).base, { ms: 3000 });
    assert.deepEqual(up, { ok: true });
  } finally {
    await close(preview);
    await close(airplay);
  }
});

test('a poll that reached the wildcard holder first still finds the preview once it binds', async t => {
  // The first fix run: the polls began while only AirPlay answered on 127.0.0.1:5000, fetch() kept
  // that socket alive, and every later poll asked AirPlay again for 30 seconds after vite was up.
  const airplay = serve(403, { Server: 'AirTunes/950.7.1' });
  const port = await listen(airplay, 0, '::');
  const preview = serve(200);
  try {
    const waiting = waitForServer(`http://${PREVIEW_HOST}:${port}`, { ms: 5000 });
    await new Promise(r => setTimeout(r, 900));
    try {
      await listen(preview, port, PREVIEW_HOST);
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      await waiting;
      t.skip('this OS refuses a specific bind under a wildcard listener');
      return;
    }
    assert.deepEqual(await waiting, { ok: true });
  } finally {
    await close(preview);
    await close(airplay);
  }
});

test("main() starts the preview through previewCommand and keeps vite's output to show on failure", () => {
  const src = code('scripts/a11y-browser-check.mjs');
  const main = src.slice(src.indexOf('async function main()'));
  assert.match(main, /previewCommand\(outDir, port\)/);
  assert.match(main, /spawn\('npx', cmd\.args, \{[^}]*stdio: \['ignore', 'pipe', 'pipe'\]/);
  assert.doesNotMatch(main, /stdio: 'ignore'/);
  assert.doesNotMatch(main, /localhost/);
  assert.doesNotMatch(main, /nothing answered/);
  assert.match(main, /waitForServer\(base, \{ exited: \(\) => previewExit \}\)/);
  assert.match(main, /vite preview said:/);
  assert.match(main, /set A11Y_PORT to a free port/);
});
