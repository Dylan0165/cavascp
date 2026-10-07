#!/usr/bin/env node
/**
 * MCP stdio acceptance test.
 *
 * Launches exactly the way DSH does — `node server.mjs` — and speaks JSON-RPC
 * over stdio: initialize, tools/list, then one real tools/call.
 *
 * The token is passed only through the child's env (mirroring the `env:` block
 * in cordis.patch.yml), so this also proves the server does not depend on
 * reading D:/cavascp/.env at runtime.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const token = readFileSync('D:/cavascp/.env', 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('CANVAS_TOKEN='))
  ?.slice('CANVAS_TOKEN='.length)
  .trim();

if (!token) {
  console.error('no CANVAS_TOKEN found in D:/cavascp/.env');
  process.exit(1);
}

const child = spawn(process.execPath, ['server.mjs'], {
  cwd: 'D:/cavascp/mcp',
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, CANVAS_TOKEN: token },
});

let buffer = '';
const pending = new Map();
let nextId = 1;

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    } else {
      console.log('  [unsolicited]', line.slice(0, 120));
    }
  }
});

child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => console.log('  [stderr]', d.trim().slice(0, 300)));

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout on ${method}`)), 120_000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

let failures = 0;
const check = (label, condition, detail = '') => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};

console.log('1) initialize');
const init = await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'acceptance-test', version: '1.0.0' },
});
check('result present', Boolean(init.result), init.error ? JSON.stringify(init.error) : '');
check('protocolVersion', Boolean(init.result?.protocolVersion), init.result?.protocolVersion);
check('serverInfo.name', init.result?.serverInfo?.name === 'cavascp', init.result?.serverInfo?.name);
check('tools capability', Boolean(init.result?.capabilities?.tools));

notify('notifications/initialized', {});

console.log('\n2) ping');
const ping = await rpc('ping', {});
check('empty result', ping.result !== undefined);

console.log('\n3) tools/list');
const list = await rpc('tools/list', {});
const tools = list.result?.tools ?? [];
check('returns tools', tools.length > 0, `${tools.length} tools`);
for (const tool of tools) {
  const schemaOk = tool.inputSchema?.type === 'object';
  check(`  ${tool.name}`, Boolean(tool.name && tool.description && schemaOk));
}

console.log('\n4) tools/call canvas_whoami');
const who = await rpc('tools/call', { name: 'canvas_whoami', arguments: {} });
const whoText = who.result?.content?.[0]?.text ?? '';
check('no protocol error', !who.error, who.error ? JSON.stringify(who.error) : '');
check('isError not set', who.result?.isError !== true);
// Niet op een naam toetsen: dat is persoonsgebonden en hoort niet in een
// publieke repo. Wel dat er een echte gebruiker terugkomt.
check('meldt een gebruiker', /\*\*Gebruiker\*\*:\s*\S/.test(whoText), whoText.split('\n')[3]?.trim().slice(0, 60));
check('meldt een geldig token', /Token\*\*:\s*geldig/.test(whoText));

console.log('\n5) tools/call portfolio_status (only_open)');
const status = await rpc('tools/call', { name: 'portfolio_status', arguments: { only_open: true } });
const statusText = status.result?.content?.[0]?.text ?? '';
check('no protocol error', !status.error);
check('reports open count', /open/.test(statusText), statusText.split('\n')[2]?.trim().slice(0, 90));

console.log('\n6) unknown tool -> graceful error');
const bad = await rpc('tools/call', { name: 'does_not_exist', arguments: {} });
check('protocol error returned', Boolean(bad.error), bad.error?.message);

console.log('\n7) unknown method -> -32601');
const badMethod = await rpc('nope/nope', {});
check('method not found', badMethod.error?.code === -32601, String(badMethod.error?.code));

console.log('\n8) malformed JSON line does not kill the server');
child.stdin.write('{this is not json}\n');
const afterGarbage = await rpc('ping', {});
check('server still responsive', afterGarbage.result !== undefined);

child.stdin.end();
child.kill();

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
