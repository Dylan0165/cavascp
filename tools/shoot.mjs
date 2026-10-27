#!/usr/bin/env node
/**
 * Maakt schermafbeeldingen van het dashboard in beide thema's.
 *
 * Gaat via de bootstrappagina, want die zet de sessiecookie. Direct naar
 * /dashboard gaan geeft een 401.
 *
 *   node tools/shoot.mjs [breedte] [hoogte]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = process.env.CAVASCP_PORT || 8787;
const WIDTH = Number(process.argv[2] || 1600);
const HEIGHT = Number(process.argv[3] || 1150);
const DEBUG = 9350;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('dashboard', 'preview');
mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    `--remote-debugging-port=${DEBUG}`,
    `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'cavascp-shoot-'))}`,
    `--window-size=${WIDTH},${HEIGHT}`,
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
    /* nog niet op */
  }
}

await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let id = 1;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = id++;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = (expression) =>
  send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(
    (r) => r?.result?.value,
  );

await send('Page.enable');

/** Laadt het dashboard via de bootstrap en wacht op echte inhoud. */
async function loadHome(theme) {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  // De bootstrap stuurt door; daarna zetten we het thema en wachten op data.
  for (let i = 0; i < 60; i += 1) {
    await sleep(400);
    const url = await evaluate(`location.pathname`);
    if (url === '/dashboard') break;
  }
  await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true`);
  for (let i = 0; i < 150; i += 1) {
    await sleep(500);
    const n = await evaluate(`document.querySelectorAll('.item').length`);
    if (n > 0) return true;
  }
  return false;
}

async function shoot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`  ${name}.png`);
}

/* Licht */
const okLight = await loadHome('light');
await sleep(900);
if (okLight) await shoot(`sage-light-${WIDTH}`);
else console.log('  inhoud kwam niet binnen voor licht');

/* De documentwerkplek: eerst een document openen, dan pas een beeld. */
async function openDocumenten(theme) {
  await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true`);

  const geklikt = await evaluate(
    `(() => { const t = [...document.querySelectorAll('.tab')].find(b => /documenten/i.test(b.textContent)); if (!t) return false; t.click(); return true; })()`,
  );
  if (!geklikt) {
    console.log('  documententab niet gevonden');
    return false;
  }
  await sleep(1200);

  // Een document openen zodat de werkplek gevuld is, niet leeg. Wachten op de
  // lijst: die komt uit een eigen endpoint en is er niet meteen.
  for (let i = 0; i < 40; i += 1) {
    await sleep(400);
    const n = await evaluate(`document.querySelectorAll('.work__item').length`);
    if (n > 0) break;
  }
  await evaluate(
    `(() => { const b = document.querySelector('.work__item'); if (b) b.click(); return Boolean(b); })()`,
  );

  // Wachten tot de secties en de leeruitkomst-check er staan.
  for (let i = 0; i < 40; i += 1) {
    await sleep(400);
    const n = await evaluate(`document.querySelectorAll('.sectie').length`);
    if (n > 0) return true;
  }
  return true;
}

await openDocumenten('light');
await sleep(1800);
await shoot(`documenten-${WIDTH}`);

/* Donker */
await evaluate(`document.documentElement.dataset.theme = 'dark'; true`);
await sleep(700);
if (okLight) await shoot(`sage-dark-${WIDTH}`);

/* Detailpaneel open, in het donker */
await evaluate(`document.querySelector('.item')?.click(); true`);
await sleep(1200);
if (okLight) await shoot(`sage-drawer-${WIDTH}`);

ws.close();
chrome.kill();
process.exit(0);
