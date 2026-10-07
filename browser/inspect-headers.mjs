#!/usr/bin/env node
/**
 * Kijkt welke headers de Portflow-app zelf meestuurt.
 *
 * Onze eigen fetch kreeg 401 terwijl de app 200 kreeg. Dat betekent dat er iets
 * in de request zit dat wij niet meesturen. Dit script onderschept window.fetch
 * binnen het iframe en logt methode, url en headers van wat de app doet.
 *
 * Alleen observeren: de originele fetch wordt ongewijzigd doorgegeven.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';

const { chromium } = await import(CONFIG.playwrightUrl);
await mkdir(CONFIG.outDir, { recursive: true });

const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
  ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
  headless: true,
  viewport: CONFIG.viewport,
  userAgent: CONFIG.userAgent,
  locale: 'nl-NL',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());

// Also capture what happens at the network level, as a cross-check.
const network = [];
page.on('request', (req) => {
  const url = req.url();
  if (!url.includes('portfolio.drieam.app/api/')) return;
  network.push({
    method: req.method(),
    url: url.replace('https://portfolio.drieam.app', ''),
    headers: req.headers(),
    kind: 'page',
  });
});

await page.goto(CONFIG.portfolioLaunch, { waitUntil: 'domcontentloaded', timeout: 90_000 });

// Install the interceptor as soon as the Portflow frame appears, before the SPA
// finishes its own calls.
let frame = null;
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(800);
  frame = page.frames().find((f) => f.url().includes(CONFIG.portflowHost));
  if (frame) break;
}

if (!frame) {
  console.error('geen Portflow-frame');
  await context.close();
  process.exit(1);
}

await frame
  .evaluate(() => {
    if (window.__cavascpHooked) return;
    window.__cavascpHooked = true;
    window.__cavascpCalls = [];
    const original = window.fetch;
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : input?.url ?? String(input);
        if (url.includes('/api/')) {
          const headers = {};
          const h = init?.headers;
          if (h) {
            if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => (headers[k] = v));
            else if (Array.isArray(h)) for (const [k, v] of h) headers[k] = v;
            else Object.assign(headers, h);
          }
          window.__cavascpCalls.push({
            method: init?.method ?? 'GET',
            url,
            headers,
            credentials: init?.credentials ?? null,
            bodyType: init?.body ? typeof init.body : null,
          });
        }
      } catch {
        /* never break the app */
      }
      return original.apply(this, arguments);
    };
  })
  .catch((e) => console.log(`hook mislukt: ${e.message}`));

// Make the app talk: navigate within the SPA so it refetches.
await frame
  .evaluate(() => {
    window.history.pushState({}, '', '/portfolio/collections');
    window.dispatchEvent(new PopStateEvent('popstate'));
  })
  .catch(() => {});

await page.waitForTimeout(8000);

const calls = await frame.evaluate(() => window.__cavascpCalls ?? []).catch(() => []);

console.log('=== requests die de APP zelf doet (via window.fetch) ===');
const seen = new Set();
for (const call of calls) {
  const key = `${call.method} ${call.url.split('?')[0]}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`\n${call.method} ${call.url}`);
  console.log(`   credentials: ${call.credentials}`);
  console.log(`   headers    : ${JSON.stringify(call.headers)}`);
}

console.log('\n=== op netwerkniveau (headers zoals Chrome ze verstuurt) ===');
const seenNet = new Set();
for (const entry of network) {
  const key = `${entry.method} ${entry.url.split('?')[0]}`;
  if (seenNet.has(key)) continue;
  seenNet.add(key);
  const interesting = Object.fromEntries(
    Object.entries(entry.headers).filter(([k]) =>
      /authorization|x-|csrf|cookie|accept|content-type/i.test(k),
    ),
  );
  console.log(`\n${entry.method} ${entry.url}`);
  console.log(`   ${JSON.stringify(interesting)}`);
}

const file = path.join(CONFIG.outDir, 'app-headers.json');
await writeFile(file, JSON.stringify({ calls, network }, null, 2), 'utf8');
console.log(`\nrapport: ${file}`);

await context.close();
