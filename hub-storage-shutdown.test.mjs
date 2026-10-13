import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleUrl = pathToFileURL(path.join(here, 'hub-storage.mjs')).href;

function childSource(dir) {
  return `
    const { hubStorage } = await import(${JSON.stringify(moduleUrl)});
    hubStorage.init({ hub: null, hubReady: false, dataDir: ${JSON.stringify(dir)} });
    hubStorage.pushBehavior('u1', { type: 'shutdown-probe' });
    setInterval(() => {}, 1000);
    console.log('ready');
  `;
}

async function runWithSignal(signal, dir) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', childSource(dir)], {
    stdio: ['ignore', 'pipe', 'inherit']
  });
  let exited = null;
  const exitP = new Promise((resolve) => child.on('exit', (code, sig) => { exited = { code, sig }; resolve(exited); }));
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('child never became ready')), 10000);
      child.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(t); resolve(); } });
      child.on('exit', () => { clearTimeout(t); reject(new Error('child exited before ready')); });
    });
    child.kill(signal);
    const result = await Promise.race([
      exitP,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000))
    ]);
    return result;
  } finally {
    if (exited === null) child.kill('SIGKILL');
  }
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`exits with code 0 within 3s on ${signal}`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-shutdown-'));
    try {
      const result = await runWithSignal(signal, dir);
      assert.notEqual(result, null, `child still alive 3s after ${signal}`);
      assert.equal(result.code, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('a dirty behavior row is on disk after SIGTERM', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-shutdown-'));
  try {
    const result = await runWithSignal('SIGTERM', dir);
    assert.notEqual(result, null, 'child still alive after SIGTERM');
    const file = path.join(dir, 'behavior.json');
    assert.ok(fs.existsSync(file), 'behavior.json was not written');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.u1.events[0].type, 'shutdown-probe');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
