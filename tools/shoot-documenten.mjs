#!/usr/bin/env node
/**
 * Schermafbeelding van de documentwerkplek.
 *
 * Gaat via de bootstrappagina (die zet de sessiecookie), klikt op de tab
 * Documenten, opent het eerste document, en maakt een beeld. Bewust een eigen
 * script en niet de algemene shoot.mjs: die wacht op tijdlijn-items en die
 * bestaan op deze tab niet.
 *
 *   node tools/shoot-documenten.mjs [breedte] [hoogte]
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = process.env.CAVASCP_PORT || 8787;
const WIDTH = Number(process.argv[2] || 1600);
const HEIGHT = Number(process.argv[3] || 1250);
const OUT = path.resolve('dashboard', 'preview');
mkdirSync(OUT, { recursive: true });

const playwrightPad =
  process.env.PLAYWRIGHT_PATH || 'D:/Dropshippingv0.1tool/.mcp-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightPad).href);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, locale: 'nl-NL' });

/* Alles wat de pagina roept en wat er misgaat, zodat een stille fout zichtbaar
   wordt in plaats van een leeg paneel. */
const consoleFouten = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleFouten.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => consoleFouten.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('requestfailed', (r) => consoleFouten.push(`requestfailed: ${r.url().slice(-60)} ${r.failure()?.errorText ?? ''}`));
/* De overname van een Krava-project vraagt om bevestiging. In headless mode
   geeft de browser automatisch "annuleren" terug, waardoor de klik niets lijkt
   te doen. We accepteren het, zodat het scherm laat zien wat we willen tonen. */
page.on('dialog', (d) => d.accept().catch(() => {}));

try {
  // Via de bootstrap, want /dashboard zonder cookie geeft 401.
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});

  // Wachten tot de app gerenderd is.
  await page.waitForSelector('.tab', { timeout: 30000 });

  /* Naar de documententab. */
  const tab = page.locator('.tab', { hasText: /documenten/i }).first();
  await tab.click();
  console.log('  tab Documenten geopend');

  /* Wachten op de documentenlijst en er een openen. */
  await page.waitForSelector('.work__item', { timeout: 25000 });
  const aantal = await page.locator('.work__item').count();
  console.log(`  ${aantal} item(s) in de lijst`);

  // Laat zien wat er in de lijst staat, zodat een verkeerde selector opvalt.
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('.work__item')].map((n, i) => `${i}: ${(n.querySelector('b')?.textContent ?? '?').slice(0, 40)}`),
  );
  for (const rij of items) console.log(`     ${rij}`);

  await page.locator('.work__item').first().click();
  await page.waitForTimeout(3000);

  /* Diagnose: laat zien wat er in het paneel staat voordat we gaan wachten. */
  const toestand = await page.evaluate(() => ({
    fout: document.querySelector('#work-main .empty p')?.textContent ?? null,
    kop: document.querySelector('#work-main .empty h3')?.textContent ?? null,
    secties: document.querySelectorAll('.sectie').length,
    loRijen: document.querySelectorAll('.lo-rij').length,
    titel: document.querySelector('.work__kop input')?.value ?? null,
    eersteItem: document.querySelector('.work__item b')?.textContent ?? null,
  }));
  console.log(`  paneel: titel=${JSON.stringify(toestand.titel)} secties=${toestand.secties}`);
  if (toestand.kop) console.log(`  leeg-melding: "${toestand.kop}" ${toestand.fout ?? ''}`);
  if (consoleFouten.length) {
    console.log('  fouten in de pagina:');
    for (const f of [...new Set(consoleFouten)].slice(0, 8)) console.log(`     ${f}`);
  }

  await page.waitForSelector('.sectie', { timeout: 25000 });
  const secties = await page.locator('.sectie').count();
  const check = await page.locator('.lo-rij').count();
  console.log(`  document geopend: ${secties} secties, ${check} leeruitkomst-treffer(s)`);

  // Even rust zodat de check en de animaties klaar zijn.
  await page.waitForTimeout(1500);

  const bestand = path.join(OUT, `documenten-${WIDTH}.png`);
  await page.screenshot({ path: bestand });
  console.log(`  ${path.basename(bestand)}`);

  /* Ook donker, want het thema moet kloppen. */
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(700);
  const donker = path.join(OUT, `documenten-donker-${WIDTH}.png`);
  await page.screenshot({ path: donker });
  console.log(`  ${path.basename(donker)}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
