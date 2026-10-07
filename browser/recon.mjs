#!/usr/bin/env node
/**
 * Verkenning van Portflow — stap 1 van de automatisering.
 *
 * Doet twee dingen:
 *   1. Zorgt dat je ingelogd bent (jij typt je wachtwoord, niet dit script).
 *   2. Brengt in kaart hoe Portflow zijn data ophaalt: welke requests gaan er
 *      naar de server, en hoe ziet de pagina eruit.
 *
 * Bewust alleen kijken, niet klikken. Op basis van wat hier uit komt bepalen we
 * of het toevoegen van bewijs te automatiseren is, en hoe.
 *
 *   node recon.mjs            # zichtbaar venster, jij logt in
 *   node recon.mjs --headless # alleen als het profiel al ingelogd is
 *
 * Er wordt niets verstuurd naar Canvas of Portflow behalve het openen van
 * pagina's. Geen enkel request wordt aangepast of herhaald.
 */

import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.mjs';

const HEADLESS = process.argv.includes('--headless');

/* Playwright uit de Dropshipping-tools laden. */
let chromium;
try {
  ({ chromium } = await import(CONFIG.playwrightUrl));
} catch (error) {
  console.error(`Playwright niet gevonden op ${CONFIG.playwrightEntry}`);
  console.error(`Onderliggende fout: ${error.message}`);
  process.exit(1);
}

await mkdir(CONFIG.outDir, { recursive: true });
await mkdir(CONFIG.profileDir, { recursive: true });

const logFile = path.join(CONFIG.outDir, 'network.jsonl');
await writeFile(logFile, '', 'utf8');

/* ── netwerk opnemen ────────────────────────────────────────────────────── */

const interesting = [];
const SKIP = /\.(png|jpe?g|gif|svg|woff2?|ttf|css|ico|webp|mp4)(\?|$)/i;

function record(entry) {
  interesting.push(entry);
  appendFile(logFile, JSON.stringify(entry) + '\n', 'utf8').catch(() => {});
}

/* ── browser starten ────────────────────────────────────────────────────── */

console.log('Chrome starten met persistent profiel…');
console.log(`  browser: ${CONFIG.browserLabel}`);
console.log(`  profiel: ${CONFIG.profileDir}`);
console.log(`  modus  : ${HEADLESS ? 'headless' : 'zichtbaar'}`);
console.log('');

const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
  // Prefer the installed Chrome; without it Playwright uses its own Chromium.
  ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
  headless: HEADLESS,
  viewport: CONFIG.viewport,
  // Without this the UA says "HeadlessChrome", which ADFS may flag.
  ...(HEADLESS ? { userAgent: CONFIG.userAgent } : {}),
  locale: 'nl-NL',
  timezoneId: 'Europe/Amsterdam',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());

page.on('request', (request) => {
  const url = request.url();
  if (SKIP.test(url)) return;
  const type = request.resourceType();
  if (!['xhr', 'fetch', 'document'].includes(type)) return;
  record({
    kind: 'request',
    at: Date.now(),
    method: request.method(),
    type,
    url,
    postData: request.postData()?.slice(0, 2000) ?? null,
  });
});

page.on('response', (response) => {
  const url = response.url();
  if (SKIP.test(url)) return;
  const type = response.request().resourceType();
  if (!['xhr', 'fetch'].includes(type)) return;
  // Reading a body can fail or reject if the response is gone; that must never
  // take the whole run down.
  response
    .text()
    .then((body) => {
      const ct = response.headers()['content-type'] ?? '';
      record({
        kind: 'response',
        at: Date.now(),
        status: response.status(),
        url,
        contentType: ct || null,
        preview: ct.includes('json') ? body.slice(0, 1200) : null,
      });
    })
    .catch(() => {
      record({
        kind: 'response',
        at: Date.now(),
        status: response.status(),
        url,
        contentType: response.headers()['content-type'] ?? null,
        preview: null,
      });
    });
});

/* ── 1. inloggen ────────────────────────────────────────────────────────── */

async function isLoggedIn(target) {
  try {
    await target.goto(`${CONFIG.canvasBase}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    return false;
  }
  const url = target.url();
  if (url.includes('/login') || url.includes('saml') || url.includes('microsoftonline')) return false;
  // The dashboard only exists for an authenticated session.
  return target.evaluate(() => Boolean(document.querySelector('#dashboard, .ic-Dashboard, #application')))
    .catch(() => false);
}

console.log('Stap 1 — inloggen bij Canvas');
let loggedIn = await isLoggedIn(page);

if (!loggedIn) {
  await page.goto(`${CONFIG.canvasBase}/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────────────┐');
  console.log('  │  Log nu in het geopende browservenster.                      │');
  console.log('  │  Inclusief 2FA — dat doe jij, dit script ziet je             │');
  console.log('  │  wachtwoord niet.                                            │');
  console.log('  │                                                              │');
  console.log('  │  Daarna gaat het automatisch verder. Niet sluiten.            │');
  console.log('  └──────────────────────────────────────────────────────────────┘');
  console.log('');

  const deadline = Date.now() + CONFIG.loginTimeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    const url = page.url();
    if (!url.includes('/login') && !url.includes('saml') && !url.includes('microsoftonline')) {
      const ok = await page
        .evaluate(() => Boolean(document.querySelector('#dashboard, .ic-Dashboard, #application')))
        .catch(() => false);
      if (ok) {
        loggedIn = true;
        break;
      }
    }
  }

  if (!loggedIn) {
    console.error('Niet ingelogd binnen de tijd. Opnieuw proberen met: node recon.mjs');
    await context.close();
    process.exit(1);
  }
}

console.log('  ingelogd.');
console.log('');

/* ── 2. Portflow openen ─────────────────────────────────────────────────── */

console.log('Stap 2 — Portflow openen via Canvas');
const before = interesting.length;
await page.goto(CONFIG.portfolioLaunch, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch((e) => {
  console.log(`  let op: ${e.message}`);
});

// The LTI launch needs time to hand over to Portflow and boot its SPA.
await page.waitForTimeout(12000);

const frames = page.frames().map((f) => ({ url: f.url(), name: f.name() }));
const portflowFrame = page.frames().find((f) => f.url().includes(CONFIG.portflowHost));

console.log(`  huidige url : ${page.url()}`);
console.log(`  frames      : ${frames.length}`);
for (const f of frames) console.log(`     - ${f.url.slice(0, 110)}`);
console.log('');

/* ── 3. vastleggen ──────────────────────────────────────────────────────── */

const target = portflowFrame ?? page;

let domReport = null;
try {
  domReport = await target.evaluate(() => {
    const text = (sel) => [...document.querySelectorAll(sel)].slice(0, 60).map((n) => n.textContent.trim().slice(0, 120));
    return {
      title: document.title,
      url: location.href,
      headings: text('h1, h2, h3'),
      buttons: [...document.querySelectorAll('button, [role="button"], a')]
        .slice(0, 80)
        .map((n) => ({
          tag: n.tagName.toLowerCase(),
          text: (n.textContent || '').trim().slice(0, 70),
          aria: n.getAttribute('aria-label'),
          testid: n.getAttribute('data-testid') || n.getAttribute('data-test-id') || null,
        }))
        .filter((n) => n.text || n.aria),
      testIds: [...new Set([...document.querySelectorAll('[data-testid]')].map((n) => n.getAttribute('data-testid')))].slice(0, 60),
      navLinks: [...document.querySelectorAll('nav a, aside a')].slice(0, 40).map((n) => n.getAttribute('href')),
      bodyLength: document.body.innerText.length,
    };
  });
} catch (error) {
  domReport = { error: error.message };
}

/* ── 4. rapport ─────────────────────────────────────────────────────────── */

const apiCalls = interesting.filter(
  (e) => e.kind === 'request' && /\/api\/|\/graphql|\.json/i.test(e.url) && !e.url.includes('instructure.com/api/v1/courses'),
);

const report = {
  generatedAt: new Date().toISOString(),
  headless: HEADLESS,
  finalUrl: page.url(),
  frames,
  portflowFrameFound: Boolean(portflowFrame),
  networkEntries: interesting.length,
  entriesAfterPortflowOpen: interesting.length - before,
  dom: domReport,
  apiCallsToPortflow: apiCalls.slice(0, 80),
};

const reportFile = path.join(CONFIG.outDir, 'recon.json');
await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');

/* ── 5. samenvatting ────────────────────────────────────────────────────── */

console.log('─'.repeat(70));
console.log('  BEVINDINGEN');
console.log('─'.repeat(70));
console.log(`  Portflow-frame gevonden : ${portflowFrame ? 'ja' : 'NEE'}`);
console.log(`  netwerk opgeslagen      : ${interesting.length} requests`);
console.log(`  waarvan naar een API    : ${apiCalls.length}`);
console.log('');

if (apiCalls.length) {
  console.log('  API-aanroepen vanuit Portflow:');
  const seen = new Set();
  for (const call of apiCalls) {
    const key = `${call.method} ${call.url.split('?')[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`     ${call.method.padEnd(6)} ${call.url.replace(/^https?:\/\//, '').slice(0, 96)}`);
  }
  console.log('');
}

if (domReport?.headings?.length) {
  console.log('  Koppen op de pagina:');
  for (const h of domReport.headings.slice(0, 12)) console.log(`     ${h}`);
  console.log('');
}

if (domReport?.buttons?.length) {
  console.log(`  Knoppen gevonden: ${domReport.buttons.length}`);
  for (const b of domReport.buttons.slice(0, 18)) {
    console.log(`     ${(b.text || b.aria || '').slice(0, 66)}`);
  }
  console.log('');
}

console.log(`  volledig rapport : ${reportFile}`);
console.log(`  ruw netwerklog   : ${logFile}`);
console.log('');
console.log('  De browser blijft 90 seconden open zodat je zelf rond kunt kijken.');
console.log('  Daarna sluit hij; het profiel en de login blijven bewaard.');
console.log('');

await page.waitForTimeout(90000);
await context.close();
console.log('klaar.');
