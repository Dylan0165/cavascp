#!/usr/bin/env node
/**
 * Legt de ECHT GERENDERDE HTML van het dashboard vast.
 *
 * Superdesign heeft de DOM nodig zoals hij in de browser bestaat, niet de
 * template plus de JavaScript die hem opbouwt. De tijdlijn, de criteriumrijen
 * en de drawer bestaan alleen na het draaien van app.js, dus lezen we ze uit
 * een echte pagina.
 *
 * Levert:
 *   .superdesign/tmp/rendered.html       — de hoofdweergave
 *   .superdesign/tmp/rendered-drawer.html — met het detailpaneel open
 *
 *   node tools/capture-rendered.mjs
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = process.env.CAVASCP_PORT || 8787;
const DEBUG = 9342;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT_DIR = path.resolve('.superdesign', 'tmp');
mkdirSync(OUT_DIR, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${DEBUG}`,
    `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'cavascp-render-'))}`,
    '--window-size=1600,1150',
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
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });

/*
 * Wachten op de ECHTE inhoud, niet op de eerste paint.
 *
 * De app toont eerst skeletten en vult die pas als /api/data terugkomt; bij een
 * koude cache duurt dat tientallen seconden. Zonder deze check leg je de
 * skeletten vast in plaats van het dashboard.
 */
let ready = false;
let waited = 0;
for (let i = 0; i < 200; i += 1) {
  await sleep(500);
  waited += 500;
  const state = await evaluate(`JSON.stringify({
    items: document.querySelectorAll('.item').length,
    crits: document.querySelectorAll('.crit').length,
    vitals: document.querySelectorAll('.vital').length,
    err: Boolean(document.querySelector('.error'))
  })`).catch(() => null);
  if (state) {
    const s = JSON.parse(state);
    if (s.err) {
      console.error('de pagina toont een foutmelding; capture afgebroken');
      process.exit(1);
    }
    if (s.items > 0 && s.crits > 0 && s.vitals > 0) {
      ready = true;
      console.log(`inhoud geladen na ${(waited / 1000).toFixed(1)}s: ${s.items} items, ${s.crits} criteria, ${s.vitals} cijfers`);
      break;
    }
  }
}
if (!ready) {
  console.error('inhoud kwam niet binnen binnen 100 seconden');
  process.exit(1);
}
await sleep(1200); // stagger-animaties laten uitlopen

/* De volledige body, maar met de sessiesleutel eruit en de achtergrond
   gereduceerd: dat is decoratie die Superdesign uit de CSS haalt. */
const main = await evaluate(`(() => {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script').forEach(n => n.remove());
  // Vaste waarden die de app vult: laat ze staan zoals ze gerenderd zijn.
  return clone.innerHTML;
})()`);

writeFileSync(path.join(OUT_DIR, 'rendered.html'), main, 'utf8');
console.log(`rendered.html: ${main.length} tekens`);

/* Nu met het detailpaneel open: dat is een aparte vorm die Superdesign moet
   kunnen reproduceren. */
await evaluate(`document.querySelector('.item')?.click(); true`);
await sleep(1200);

const drawer = await evaluate(`(() => {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script').forEach(n => n.remove());
  return clone.innerHTML;
})()`);
writeFileSync(path.join(OUT_DIR, 'rendered-drawer.html'), drawer, 'utf8');
console.log(`rendered-drawer.html: ${drawer.length} tekens`);

/* Een compacte inventaris van de klassen, zodat het ontwerp dezelfde namen en
   structuur kan gebruiken. */
const inventory = await evaluate(`(() => {
  const classes = new Map();
  for (const el of document.querySelectorAll('*')) {
    for (const c of el.classList) classes.set(c, (classes.get(c) ?? 0) + 1);
  }
  const vitals = [...document.querySelectorAll('.vital')].map(v => ({
    label: v.querySelector('dt')?.textContent,
    value: v.querySelector('dd')?.textContent,
    cls: v.className,
  }));
  const firstItem = document.querySelector('.item');
  const firstCrit = document.querySelector('.crit');
  return {
    classCount: classes.size,
    classes: [...classes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60),
    vitals,
    itemHtml: firstItem ? firstItem.outerHTML : null,
    critHtml: firstCrit ? firstCrit.outerHTML : null,
    drawerHtml: document.querySelector('.drawer')?.outerHTML?.slice(0, 3000) ?? null,
  };
})()`);

writeFileSync(path.join(OUT_DIR, 'inventory.json'), JSON.stringify(inventory, null, 2), 'utf8');
console.log(`inventory.json: ${inventory.classCount} unieke klassen`);
console.log('');
console.log('vitals:');
for (const v of inventory.vitals) console.log(`  ${v.value}  ${v.label}`);
console.log('');
console.log('meest gebruikte klassen:');
for (const [cls, n] of inventory.classes.slice(0, 20)) console.log(`  ${String(n).padStart(4)}  ${cls}`);

ws.close();
chrome.kill();
process.exit(0);
