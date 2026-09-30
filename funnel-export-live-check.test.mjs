import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';

// C57: the opt-in live CORS check in funnel-export.test.mjs asserted only inside
// `if (optRes.status === 204)` and `if (postRes.ok)`, so a server answering OPTIONS 404 and
// POST 500 passed it. This runs that check as a child process against servers we control:
// broken ones must fail it, and the real route (plus a legitimate 429) must pass it.

const here = fileURLToPath(new URL('.', import.meta.url));

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => { server.closeAllConnections(); return new Promise(r => server.close(r)); }
  };
}

// Runs the live check alone, in a child, against `url`. The spawn is async because the server
// under test answers from this process's event loop, which a spawnSync would block.
function runLiveCheck(url) {
  // NODE_TEST_CONTEXT marks a child of a test runner; with it set the child refuses to run files.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', '--test-name-pattern=CORS', 'funnel-export.test.mjs'], {
      cwd: here,
      env: { ...env, JOURVANCE_LIVE_TEST_URL: url },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ code, out }));
  });
}

function stub({ optionsStatus, optionsHeaders = {}, postStatus, postHeaders = {}, postBody = { success: false } }) {
  return (req, res) => {
    const isOptions = req.method === 'OPTIONS';
    res.writeHead(isOptions ? optionsStatus : postStatus, {
      'Content-Type': 'application/json',
      ...(isOptions ? optionsHeaders : postHeaders)
    });
    res.end(isOptions ? '' : JSON.stringify(postBody));
  };
}

const CORS_OPTIONS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const CORS_POST = { 'Access-Control-Allow-Origin': '*' };

const broken = [
  ['OPTIONS 404 and POST 500 with no CORS headers', { optionsStatus: 404, postStatus: 500 }],
  ['OPTIONS 204 without CORS headers', { optionsStatus: 204, postStatus: 200, postHeaders: CORS_POST, postBody: { success: true } }],
  ['a POST that answers 500 with the header set', { optionsStatus: 204, optionsHeaders: CORS_OPTIONS, postStatus: 500, postHeaders: CORS_POST }],
  ['a POST 400 with no Access-Control-Allow-Origin', { optionsStatus: 204, optionsHeaders: CORS_OPTIONS, postStatus: 400 }],
  ['a POST 200 that does not say success', { optionsStatus: 204, optionsHeaders: CORS_OPTIONS, postStatus: 200, postHeaders: CORS_POST, postBody: { success: false } }]
];

for (const [name, shape] of broken) {
  test(`the live CORS check fails against ${name}`, async () => {
    const srv = await listen(stub(shape));
    try {
      const { code, out } = await runLiveCheck(srv.url);
      assert.notEqual(code, 0, `the live check passed against a broken server:\n${out}`);
      assert.match(out, /# fail 1|ℹ fail 1/);
    } finally {
      await srv.close();
    }
  });
}

test('the live CORS check passes on a legitimate 429 with the header set', async () => {
  const srv = await listen(stub({ optionsStatus: 204, optionsHeaders: CORS_OPTIONS, postStatus: 429, postHeaders: CORS_POST }));
  try {
    const { code, out } = await runLiveCheck(srv.url);
    assert.equal(code, 0, out);
    assert.match(out, /# pass 1|ℹ pass 1/);
  } finally {
    await srv.close();
  }
});

test('the live CORS check passes against the real /api/public/lead route', async () => {
  const { setupPublicRoutes } = await import('./server/routes/publicRoutes.mjs');
  const app = express();
  app.use(express.json());
  // Mark the POST as a honeypot hit so the real handler answers success without writing a lead.
  app.use('/api/public/lead', (req, _res, next) => {
    if (req.method === 'POST') req.body = { ...(req.body || {}), website_hp: 'bot' };
    next();
  });
  setupPublicRoutes(app, { publicBase: () => 'https://jv.test' });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const { code, out } = await runLiveCheck(`http://127.0.0.1:${server.address().port}`);
    assert.equal(code, 0, out);
    assert.match(out, /# pass 1|ℹ pass 1/);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});
