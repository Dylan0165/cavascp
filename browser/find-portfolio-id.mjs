#!/usr/bin/env node
/**
 * Zoekt uit waar het portfolio-id vandaan komt.
 *
 * Het iframe staat op /portfolio/collections zonder id in de URL, terwijl de
 * app wel /api/v1/portfolios/22253/... aanroept. Dat nummer moet dus ergens in
 * de pagina staan. Dit scriptje kijkt in de globale scope, de opslag en de
 * cookies — alleen lezen.
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
await page.goto(CONFIG.portfolioLaunch, { waitUntil: 'domcontentloaded', timeout: 90_000 });

let frame = null;
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(1500);
  frame = page.frames().find((f) => f.url().includes(CONFIG.portflowHost) && f.url().includes('/portfolio'));
  if (frame) {
    const hasApp = await frame
      .evaluate(() => Boolean(document.querySelector('#app, #root, [data-reactroot], script[src]')))
      .catch(() => false);
    if (hasApp) break;
  }
}

if (!frame) {
  console.error('geen Portflow-frame gevonden');
  await context.close();
  process.exit(1);
}

const findings = await frame.evaluate(() => {
  const idHits = new Set();

  const scan = (label, value) => {
    if (typeof value !== 'string') return;
    for (const m of value.matchAll(/portfolios?\/(\d{3,7})/g)) idHits.add(`text:${m[1]}`);
    for (const m of value.matchAll(/"portfolio_?id"\s*:\s*"?(\d{2,7})"?/gi)) idHits.add(`json:${m[1]}`);
  };

  // 1. Globals that look like app state.
  const globals = {};
  for (const key of Object.keys(window)) {
    try {
      const value = window[key];
      if (value === null || value === undefined) continue;
      const type = typeof value;
      if (['string', 'number', 'boolean'].includes(type)) {
        globals[key] = String(value).slice(0, 200);
        scan(key, String(value));
      } else if (type === 'object') {
        try {
          const json = JSON.stringify(value);
          if (json && json.length < 20000) {
            globals[key] = json.slice(0, 300);
            scan(key, json);
          }
        } catch {
          /* circular */
        }
      }
    } catch {
      /* getter threw */
    }
  }

  // 2. Storage.
  const storage = {};
  for (const store of ['localStorage', 'sessionStorage']) {
    try {
      const s = window[store];
      for (let i = 0; i < s.length; i += 1) {
        const key = s.key(i);
        const value = s.getItem(key) ?? '';
        storage[`${store}:${key}`] = value.slice(0, 400);
        scan(key, value);
      }
    } catch {
      /* blocked */
    }
  }

  // 3. Cookies (names and values, this is our own session).
  const cookies = {};
  for (const c of document.cookie.split(';')) {
    const [k, ...rest] = c.split('=');
    cookies[k.trim()] = rest.join('=').slice(0, 120);
    scan(k, rest.join('='));
  }

  // 4. The URL and any script tags.
  scan('url', location.href);
  const scripts = [...document.querySelectorAll('script')].map((s) => s.src || s.textContent?.slice(0, 200) || '');

  return {
    url: location.href,
    title: document.title,
    idHits: [...idHits],
    globalKeys: Object.keys(globals).sort(),
    globals,
    storage,
    cookieNames: Object.keys(cookies).sort(),
    scriptCount: scripts.length,
    bodyText: document.body.innerText.slice(0, 600),
  };
});

console.log(`url   : ${findings.url}`);
console.log(`titel : ${findings.title}`);
console.log(`body  : ${findings.bodyText.replace(/\s+/g, ' ').slice(0, 200)}`);
console.log('');
console.log(`portfolio-id-hits: ${findings.idHits.length ? findings.idHits.join(', ') : 'GEEN'}`);
console.log('');
console.log('globale sleutels die op app-state lijken:');
for (const key of findings.globalKeys.filter((k) => /portfoli|lti|launch|config|state|user|drieam/i.test(k))) {
  console.log(`  ${key} = ${String(findings.globals[key]).slice(0, 150)}`);
}
console.log('');
console.log('opslag:');
for (const [key, value] of Object.entries(findings.storage)) {
  console.log(`  ${key} = ${value.replace(/\s+/g, ' ').slice(0, 150)}`);
}
console.log('');
console.log(`cookies: ${findings.cookieNames.join(', ')}`);

const file = path.join(CONFIG.outDir, 'id-discovery.json');
await writeFile(file, JSON.stringify(findings, null, 2), 'utf8');
console.log(`\nrapport: ${file}`);

await context.close();
