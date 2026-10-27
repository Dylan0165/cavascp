#!/usr/bin/env node
/**
 * Schermafbeelding van de Portflow-tab.
 *
 * Gaat naar het dashboard, klikt op de tab Portflow, en wacht tot de mappen
 * geladen zijn. Dat duurt lang (Portflow opent een browser), dus het script
 * wacht ruim.
 *
 *   node tools/shoot-portflow.mjs [breedte] [hoogte]
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = process.env.CAVASCP_PORT || 8787;
const WIDTH = Number(process.argv[2] || 1600);
const HEIGHT = Number(process.argv[3] || 1200);
const OUT = path.resolve('dashboard', 'preview');
mkdirSync(OUT, { recursive: true });

const playwrightPad =
  process.env.PLAYWRIGHT_PATH || 'D:/Dropshippingv0.1tool/.mcp-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightPad).href);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, locale: 'nl-NL' });
const fouten = [];
page.on('pageerror', (e) => fouten.push(e.message.slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') fouten.push(m.text().slice(0, 200));
});

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
  await page.waitForSelector('.tab', { timeout: 30000 });

  await page.locator('.tab', { hasText: /^portflow$/i }).first().click();
  console.log('  tab Portflow geopend');

  // Wachten tot de mappen er staan. Portflow start een browser, dus ruim.
  await page.waitForSelector('.map', { timeout: 120000 });
  const aantal = await page.locator('.map').count();
  console.log(`  ${aantal} mappen geladen`);

  // De eerste map met inhoud openklappen.
  const rijen = await page.evaluate(() =>
    [...document.querySelectorAll('.map__kop')].map((k) => (k.textContent ?? '').trim().slice(0, 50)),
  );
  for (const r of rijen) console.log(`     ${r}`);

  /*
   * Controleren wat er standaard open staat. De eerste map met inhoud hoort al
   * opengeklapt te zijn, dus klikken we alleen als dat niet zo is — anders
   * klappen we hem juist dicht en lijkt het script stuk te zijn.
   */
  const voor = await page.evaluate(() => ({
    openKaarten: document.querySelectorAll('.map.is-open').length,
    bodies: document.querySelectorAll('.map__body').length,
    werkbalkZichtbaar: (() => {
      const t = document.querySelector('.toolbar');
      return t ? !t.hidden && getComputedStyle(t).display !== 'none' : null;
    })(),
  }));
  console.log(`  standaard: ${voor.openKaarten} map open, ${voor.bodies} body's`);
  console.log(`  filterbalk zichtbaar op deze tab: ${voor.werkbalkZichtbaar === null ? '?' : voor.werkbalkZichtbaar ? 'JA (hoort niet)' : 'nee (goed)'}`);

  if (voor.bodies === 0) {
    await page.evaluate(() => document.querySelector('.map__kop')?.click());
    await page.waitForTimeout(1500);
    console.log('  (map was dicht, zelf opengeklapt)');
  }

  const na = await page.evaluate(() => ({
    openKaarten: document.querySelectorAll('.map.is-open').length,
    bodies: document.querySelectorAll('.map__body').length,
    stukken: document.querySelectorAll('.map__stuk').length,
    knoppen: [...document.querySelectorAll('.map__knoppen button')].map((b) => b.textContent.trim()),
    mist: [...document.querySelectorAll('.map__mist, .map__klaar')].map((p) => p.textContent.trim().slice(0, 60)),
  }));
  console.log(`  inhoud: ${na.stukken} bewijsstukken, knoppen: ${na.knoppen.join(' | ') || '—'}`);
  for (const p of na.mist) console.log(`     ${p}`);

  const dekking = await page.evaluate(() =>
    [...document.querySelectorAll('.dekking__chip')].map(
      (c) => `${c.textContent.trim().slice(0, 34)} ${c.classList.contains('is-gedekt') ? 'GEDEKT' : 'leeg'}`,
    ),
  );
  console.log('  dekking over alle mappen:');
  for (const d of dekking) console.log(`     ${d}`);

  if (fouten.length) {
    console.log('  fouten in de pagina:');
    for (const f of [...new Set(fouten)].slice(0, 5)) console.log(`     ${f}`);
  }

  await page.screenshot({ path: path.join(OUT, `portflow-${WIDTH}.png`) });
  console.log(`  portflow-${WIDTH}.png`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  if (fouten.length) for (const f of [...new Set(fouten)].slice(0, 6)) console.error(`   ${f}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
