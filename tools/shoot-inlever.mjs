#!/usr/bin/env node
/**
 * Schermafbeelding van het inleverpaneel in de documentwerkplek.
 *
 * Klikt op de tab Documenten, opent een document, en klikt op inleveren zodat
 * het paneel met de mappen en leeruitkomsten in beeld komt. Er wordt NIETS
 * verstuurd: alleen het paneel wordt getoond.
 *
 *   node tools/shoot-inlever.mjs [breedte] [hoogte]
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = process.env.CAVASCP_PORT || 8787;
const WIDTH = Number(process.argv[2] || 1600);
const HEIGHT = Number(process.argv[3] || 1300);
const OUT = path.resolve('dashboard', 'preview');
mkdirSync(OUT, { recursive: true });

const playwrightPad =
  process.env.PLAYWRIGHT_PATH || 'D:/Dropshippingv0.1tool/.mcp-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightPad).href);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, locale: 'nl-NL' });
const fouten = [];
page.on('pageerror', (e) => fouten.push(e.message.slice(0, 160)));
page.on('console', (m) => {
  if (m.type() === 'error') fouten.push(m.text().slice(0, 160));
});

/*
 * Eerst een eigen document klaarzetten.
 *
 * Zonder dit opent het script het eerste item in de lijst, en dat is meestal
 * een Krava-project — dan zie je het overname-dialoog in plaats van de
 * werkplek. Een eigen document maakt het script deterministisch.
 */
let doelId = null;
{
  const boot = await fetch(`http://127.0.0.1:${PORT}/`);
  const cookie = (boot.headers.get('set-cookie') || '').match(/cavascp_session=[^;]+/)?.[0];
  const api = (p, o = {}) =>
    fetch(`http://127.0.0.1:${PORT}${p}`, { ...o, headers: { Origin: `http://127.0.0.1:${PORT}`, Cookie: cookie, ...(o.headers || {}) } });

  const l = await (await api('/api/documenten')).json();
  const bestaand = (l.documenten ?? []).find((d) => d.titel === 'Portfolio bewijsstuk — voorbeeld');
  if (bestaand) {
    doelId = bestaand.id;
  } else {
    const n = await api('/api/documenten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titel: 'Portfolio bewijsstuk — voorbeeld' }),
    });
    doelId = (await n.json()).document?.id;
  }
  console.log(`  voorbeelddocument: ${doelId}`);
}

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
  await page.waitForSelector('.tab', { timeout: 30000 });

  await page.locator('.tab', { hasText: /documenten/i }).first().click();
  await page.waitForSelector('.work__item', { timeout: 25000 });

  /*
   * Het voorbeelddocument openen. We zoeken het op titel in plaats van het
   * eerste item te pakken: de lijst begint met je eigen documenten en daar
   * kunnen andere tussen staan.
   */
  const item = page.locator('.work__item', { hasText: /Portfolio bewijsstuk/i }).first();
  await item.click();
  await page.waitForSelector('.sectie', { timeout: 25000 });
  console.log('  document geopend');

  /* Het inleverpaneel openen. */
  const knop = page.locator('button', { hasText: /inleveren bij portflow/i }).first();
  await knop.click();
  await page.waitForSelector('#inleverpaneel', { timeout: 20000 });

  // Wachten tot de mappen en de leeruitkomsten er staan.
  await page.waitForFunction(() => {
    const p = document.querySelector('#inleverpaneel');
    return p && p.querySelectorAll('.inlever__lo-rij').length >= 6;
  }, { timeout: 20000 });

  const beeld = await page.evaluate(() => {
    const p = document.querySelector('#inleverpaneel');
    const mappen = [...(p?.querySelectorAll('select option') ?? [])].map((o) => o.textContent);
    const los = [...(p?.querySelectorAll('.inlever__lo-rij') ?? [])].map((r) => ({
      tekst: (r.querySelector('.inlever__lo-tekst')?.textContent ?? '').trim().slice(0, 44),
      aan: r.querySelector('input')?.checked ?? false,
      pct: (r.querySelector('.inlever__lo-pct')?.textContent ?? '').trim(),
    }));
    return { mappen, los };
  });

  console.log(`  mappen: ${beeld.mappen.join(', ')}`);
  console.log('  leeruitkomsten:');
  for (const l of beeld.los) {
    console.log(`     ${l.aan ? '[x]' : '[ ]'} ${l.tekst.padEnd(46)} ${l.pct}`);
  }

  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `inlever-${WIDTH}.png`) });
  console.log(`  inlever-${WIDTH}.png`);

  if (fouten.length) {
    console.log('  fouten in de pagina:');
    for (const f of [...new Set(fouten)].slice(0, 5)) console.log(`     ${f}`);
  }
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  if (fouten.length) for (const f of [...new Set(fouten)].slice(0, 5)) console.error(`   ${f}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
