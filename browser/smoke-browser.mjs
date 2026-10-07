#!/usr/bin/env node
/**
 * Rooktest: start de browser met het persistente profiel en sluit weer.
 *
 * Bewijst dat Playwright, Chrome en het profiel samenwerken zonder dat er
 * ergens ingelogd hoeft te worden. Draait volledig headless.
 *
 *   node smoke-browser.mjs
 */

import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';

const { chromium } = await import(CONFIG.playwrightUrl);

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

// Use a throwaway profile so the smoke test never touches the real session.
const scratch = path.join(CONFIG.outDir, 'smoke-profile');
await mkdir(CONFIG.outDir, { recursive: true });
await rm(scratch, { recursive: true, force: true });

console.log('browser:', CONFIG.browserLabel);
console.log('profiel (tijdelijk):', scratch);
console.log('');

let context;
try {
  context = await chromium.launchPersistentContext(scratch, {
    ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
    headless: true,
    viewport: CONFIG.viewport,
    userAgent: CONFIG.userAgent,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  check('browser start met persistent profiel', true);
  check('user agent herkenbaar', Boolean(context.browser()?.version?.()), context.browser()?.version?.());

  const page = context.pages()[0] ?? (await context.newPage());

  // A local data: URL avoids any network dependency in the smoke test.
  await page.goto('data:text/html,<h1 id="t">ok</h1>', { waitUntil: 'domcontentloaded' });
  const text = await page.textContent('#t');
  check('pagina laadt en evalueert', text === 'ok', text);

  const ua = await page.evaluate(() => navigator.userAgent);
  // Chrome's new headless mode still reports a normal UA; the older one
  // appended "HeadlessChrome". Check the whole string, not a truncated preview.
  check('user agent ziet er normaal uit', !ua.includes('HeadlessChrome'), ua);
  check('user agent noemt echte Chrome-versie', /Chrome\/\d+/.test(ua), ua.match(/Chrome\/[\d.]+/)?.[0] ?? '—');

  const webdriver = await page.evaluate(() => navigator.webdriver);
  check('navigator.webdriver niet true', webdriver !== true, String(webdriver));

  // Can we actually reach Canvas? Only a HEAD-ish check, no credentials.
  const res = await page
    .goto(`${CONFIG.canvasBase}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    .catch((e) => ({ error: e.message }));
  if (res?.error) {
    check('Canvas bereikbaar', false, res.error);
  } else {
    check('Canvas bereikbaar', true, `${res.status()} ${page.url().slice(0, 70)}`);
  }

  check('profielmap aangemaakt', true, scratch.replace(process.cwd(), '.'));
} catch (error) {
  check(`onverwachte fout: ${error.message}`, false);
} finally {
  await context?.close().catch(() => {});
  await rm(scratch, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
