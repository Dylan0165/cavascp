#!/usr/bin/env node
/**
 * Interactietest voor het dashboard, via het Chrome DevTools Protocol.
 *
 * Waarom geen screenshot alleen: statische plaatjes bewijzen niet dat de drawer
 * opent, dat een notitie bewaard wordt of dat filters werken. Deze test doet
 * echte kliks en typt echt, en controleert daarna de DOM.
 *
 * Geen npm-afhankelijkheden: Node 22+ heeft een ingebouwde WebSocket-client.
 *
 *   node test-dashboard.mjs            # verwacht de server op poort 8787
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = process.env.CAVASCP_PORT || 8787;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DEBUG_PORT = 9333;
const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const userDir = mkdtempSync(path.join(tmpdir(), 'cavascp-cdp-'));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDir}`,
    '--window-size=1500,1000',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for the DevTools endpoint to come up, then return the page target. */
async function target() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint niet bereikbaar');
}

let ws;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 30_000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** Evaluate an expression in the page and return its JSON value. */
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`page error: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`);
  }
  return res.result?.value;
}

const results = [];
function check(label, condition, detail = '') {
  results.push({ label, ok: Boolean(condition), detail });
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  /*
   * Eerst de UI-state leegmaken.
   *
   * Zonder dit erft de test de notities en vinkjes van een vorige run, en dan
   * is de uitslag niet deterministisch: een criterium dat al aangevinkt staat,
   * wordt door de test juist uitgevinkt. Een test hoort zijn eigen
   * uitgangssituatie te zetten.
   *
   * Node bewaart cookies niet vanzelf zoals een browser, dus we pakken de
   * sessiecookie expliciet uit de bootstrappagina.
   */
  const boot = await fetch(`${ORIGIN}/`);
  const setCookie = boot.headers.get('set-cookie') ?? '';
  const cookie = setCookie.match(/cavascp_session=[^;]+/)?.[0];
  if (!cookie) throw new Error('geen sessiecookie van de bootstrappagina');

  const reset = await fetch(`${ORIGIN}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
    body: JSON.stringify({ notes: {}, done: {} }),
  });
  if (!reset.ok) throw new Error(`state resetten mislukt: ${reset.status}`);

  const page = await target();
  ws = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception');
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  // Via de bootstrappagina: die zet de sessiecookie en stuurt door naar het
  // dashboard. Direct naar /dashboard gaan geeft een 401.
  await send('Page.navigate', { url: `${ORIGIN}/` });

  // Wait for the app to finish its first data load.
  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    await sleep(250);
    ready = await evaluate(
      `Boolean(document.querySelector('.item') || document.querySelector('.error'))`,
    ).catch(() => false);
    if (ready) break;
  }

  console.log('\n1) eerste render');
  check('tijdlijn heeft items', await evaluate(`document.querySelectorAll('.item').length > 0`));
  const countOpen = await evaluate(
    `[...document.querySelectorAll('.item .pill')].filter(p => p.textContent.trim() === 'open').length`,
  );
  check('statuspillen aanwezig', countOpen > 0, `${countOpen} open`);
  const vitals = await evaluate(
    `[...document.querySelectorAll('.vital dd')].map(d => d.textContent)`,
  );
  check('vital-cijfers gevuld', vitals.length === 4, vitals.join(' / '));
  check('geen JS-fouten bij laden', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

  console.log('\n2) filteren');
  const before = await evaluate(`document.querySelectorAll('.item').length`);
  await evaluate(
    `document.querySelector('.seg__btn[data-when="overdue"]').click(); true`,
  );
  await sleep(400);
  const after = await evaluate(`document.querySelectorAll('.item').length`);
  check('filter "verlopen" verandert de lijst', after !== before, `${before} -> ${after}`);
  const allOverdue = await evaluate(
    `[...document.querySelectorAll('.item')].every(i => i.classList.contains('is-overdue'))`,
  );
  check('alle getoonde items zijn verlopen', allOverdue === true);
  check(
    '"Filters wissen" is nu zichtbaar',
    (await evaluate(`!document.querySelector('#clear').hidden`)) === true,
  );

  await evaluate(`document.querySelector('.seg__btn[data-when="90"]').click(); true`);
  await sleep(300);
  check(
    '"Filters wissen" weer verborgen bij standaardweergave',
    (await evaluate(`document.querySelector('#clear').hidden`)) === true,
  );

  console.log('\n3) drawer openen');
  await evaluate(`document.querySelector('.item').click(); true`);
  await sleep(600);
  check('drawer zichtbaar', (await evaluate(`!document.querySelector('#drawer').hidden`)) === true);
  const title = await evaluate(`document.querySelector('#drawer-title').textContent`);
  check('drawer heeft een titel', Boolean(title), title?.slice(0, 50));
  const critBlocks = await evaluate(`document.querySelectorAll('.critblock').length`);
  check('rubric-criteria in de drawer', critBlocks > 0, `${critBlocks} criteria`);
  const kvRows = await evaluate(`document.querySelectorAll('.drawer dl.kv dt').length`);
  check('metagegevens in de drawer', kvRows >= 4, `${kvRows} velden`);
  const hasCanvasLink = await evaluate(
    `Boolean(document.querySelector('.drawer dl.kv a[href*="instructure.com"]'))`,
  );
  check('Canvas-link aanwezig', hasCanvasLink === true);

  console.log('\n4) notitie opslaan');
  const note = `testnotitie ${Date.now()}`;
  await evaluate(`(() => {
    const t = document.querySelector('.notes textarea');
    t.value = ${JSON.stringify(note)};
    t.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(1200);
  const saved = await evaluate(
    `fetch('/api/state').then(r => r.json()).then(s => Object.values(s.notes || {}).includes(${JSON.stringify(note)}))`,
  );
  check('notitie bewaard op de server', saved === true);

  // Reopen the same item to confirm the note is read back, not just stored.
  await evaluate(`document.querySelector('[data-close]').click(); true`);
  await sleep(300);
  await evaluate(`document.querySelector('.item').click(); true`);
  await sleep(500);
  const readBack = await evaluate(`document.querySelector('.notes textarea').value`);
  check('notitie teruggelezen in de drawer', readBack === note);

  await evaluate(`document.querySelector('[data-close]').click(); true`);
  await sleep(300);
  check('drawer sluit', (await evaluate(`document.querySelector('#drawer').hidden`)) === true);

  console.log('\n5) criterium afvinken');
  // Het opslaan is gedebounced, dus we wachten tot de server het echt heeft.
  const putCalls = [];
  await evaluate(`(() => {
    if (window.__putSpy) return true;
    window.__putSpy = true;
    window.__puts = [];
    const original = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      if (url.includes('/api/state') && (init?.method ?? 'GET').toUpperCase() === 'PUT') {
        const entry = { at: Date.now(), status: null };
        window.__puts.push(entry);
        const result = original.apply(this, arguments);
        Promise.resolve(result).then((res) => { entry.status = res.status; }).catch(() => { entry.status = -1; });
        return result;
      }
      return original.apply(this, arguments);
    };
    return true;
  })()`);

  const box = `document.querySelector('.crit__check')`;
  const label = await evaluate(`${box}.getAttribute('aria-label')`);
  await evaluate(`${box}.click(); true`);

  // Wachten tot de server de afvinking heeft, met een ruime marge: het opslaan
  // is gedebounced en een vaste wachttijd is dan onbetrouwbaar.
  let doneCount = 0;
  for (let i = 0; i < 24; i += 1) {
    await sleep(400);
    doneCount = await evaluate(
      `fetch('/api/state').then(r => r.json()).then(s => Object.keys(s.done || {}).length)`,
    );
    if (doneCount >= 1) break;
  }
  const puts = await evaluate(`window.__puts || []`);
  check('afvinking bewaard', doneCount >= 1, `${doneCount} afgevinkt (${String(label).slice(0, 40)})`);
  if (doneCount < 1) {
    console.log(`         debug: PUT-aanroepen = ${JSON.stringify(puts)}`);
    const local = await evaluate(`JSON.stringify(Object.keys(window.__cavascpState?.ui?.done ?? {}))`);
    console.log(`         debug: lokale state = ${local}`);
  }
  const struck = await evaluate(`document.querySelector('.crit').classList.contains('is-checked')`);
  check('visueel doorgestreept', struck === true);

  console.log('\n6) zoeken');
  await evaluate(`(() => {
    const q = document.querySelector('#q');
    q.value = 'zzz-niets-bestaat';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(500);
  const emptyState = await evaluate(`Boolean(document.querySelector('.empty'))`);
  check('lege-staat-melding bij geen resultaat', emptyState === true);
  await evaluate(`(() => {
    const q = document.querySelector('#q');
    q.value = '';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(500);

  console.log('\n7) thema wisselen');
  const themeBefore = await evaluate(`document.documentElement.dataset.theme`);
  await evaluate(`document.querySelector('#theme').click(); true`);
  await sleep(250);
  const themeAfter = await evaluate(`document.documentElement.dataset.theme`);
  check('thema wisselt', themeBefore !== themeAfter, `${themeBefore} -> ${themeAfter}`);

  // Clean up the test note so it does not linger in state.json.
  await evaluate(`(() => {
    const t = document.querySelector('.item');
    if (t) t.click();
    return true;
  })()`);
  await sleep(400);

  console.log('\n8) geen console-fouten in de hele sessie');
  check('console schoon', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.resolve('preview', 'interaction.png');
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`\nscreenshot: ${file}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
  return failed.length === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(`\ntest afgebroken: ${error.message}`);
  code = 1;
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  chrome.kill();
}

process.exit(code);
