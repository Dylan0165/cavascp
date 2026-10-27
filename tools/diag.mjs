#!/usr/bin/env node
/** Snelle diagnose: wat staat er op de pagina en welke fouten geeft de console? */

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = process.env.CAVASCP_PORT || 8787;
const DEBUG = 9352;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${DEBUG}`,
    `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'cavascp-diag2-'))}`,
    '--window-size=1400,900',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60; i += 1) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      break;
    }
  } catch {
    /* niet op */
  }
}
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let id = 1;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push(`EXCEPTION: ${(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? '').slice(0, 400)}`);
  }
  if (m.method === 'Network.responseReceived') {
    const u = m.params.response.url;
    if (u.includes('127.0.0.1')) logs.push(`<- ${m.params.response.status} ${u.replace(`http://127.0.0.1:${PORT}`, '')}`);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = id++;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = (expr) =>
  send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then((r) => r?.result?.value);

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });

// Wacht op inhoud OF een foutmelding: een time-out is ook een uitkomst.
for (let i = 0; i < 120; i += 1) {
  await sleep(1000);
  const s = await evaluate(`JSON.stringify({
    n: document.querySelectorAll('.item').length,
    e: Boolean(document.querySelector('.error'))
  })`).catch(() => null);
  if (s) {
    const { n, e } = JSON.parse(s);
    if (n > 0 || e) {
      console.log(`uitkomst na ${i + 1}s: ${n} items${e ? ', met foutmelding' : ''}`);
      break;
    }
  }
}
await sleep(1500);

const state = await evaluate(`JSON.stringify({
  path: location.pathname,
  theme: document.documentElement.dataset.theme,
  items: document.querySelectorAll('.item').length,
  crits: document.querySelectorAll('.crit').length,
  vitals: document.querySelectorAll('.vital').length,
  lede: document.querySelector('#lede')?.textContent?.slice(0,80),
  err: document.querySelector('.error')?.innerText?.slice(0,200) ?? null,
  skeletons: document.querySelectorAll('.skeleton').length
})`);
console.log(JSON.stringify(JSON.parse(state), null, 2));
console.log('');
console.log('--- log ---');
for (const l of logs.slice(-25)) console.log('  ' + l);

ws.close();
chrome.kill();
process.exit(0);
