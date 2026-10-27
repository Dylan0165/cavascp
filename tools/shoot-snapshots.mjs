#!/usr/bin/env node
/**
 * Schermafbeelding van de Portflow-tab met de snapshots open.
 *
 *   node tools/shoot-snapshots.mjs [breedte] [hoogte]
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

  // Wachten tot de mappen er staan.
  await page.waitForSelector('.map', { timeout: 120000 });
  await page.waitForSelector('.snapshots', { timeout: 30000 });
  console.log('  mappen geladen');

  // De snapshots openen (dat haalt ze op bij Portflow).
  await page.locator('.snapshots__kop').click();
  console.log('  snapshots openen…');

  await page.waitForSelector('.snapshots__rij', { timeout: 120000 });

  /*
   * De metagegevens van een snapshot bestaan uit losse spans met een CSS-puntje
   * ertussen. textContent laat dat puntje niet zien, dus kijken we ook naar de
   * opmaak — anders lijkt het of de delen aan elkaar plakken.
   */
  const opmaak = await page.evaluate(() => {
    const meta = document.querySelector('.snapshots__rij .work__meta');
    if (!meta) return null;
    return {
      kinderen: [...meta.children].map((c) => c.textContent),
      display: getComputedStyle(meta).display,
      gap: getComputedStyle(meta).gap,
      voor: [...meta.children].map((c) => getComputedStyle(c, '::before').content),
    };
  });
  if (opmaak) {
    console.log(`  metagegevens: ${JSON.stringify(opmaak.kinderen)}`);
    console.log(`     display=${opmaak.display} gap=${opmaak.gap} puntjes=${JSON.stringify(opmaak.voor)}`);
  }

  const kopPositie = await page.evaluate(() => {
    const kop = document.querySelector('.snapshots__kop');
    const titel = document.querySelector('.snapshots__titel');
    const pijl = document.querySelector('.snapshots__pijl');
    const box = titel?.getBoundingClientRect();
    const b = titel?.querySelector('b');
    return {
      kopLinks: Math.round(kop?.getBoundingClientRect().left ?? -1),
      titelLinks: Math.round(box?.left ?? -1),
      titelBreedte: Math.round(box?.width ?? -1),
      // Wat staat er precies in de titel, en is het zichtbaar?
      titelHtml: titel?.innerHTML?.slice(0, 200) ?? null,
      titelTekst: titel?.textContent ?? null,
      bTekst: b?.textContent ?? null,
      bZichtbaar: b ? b.getBoundingClientRect().width > 0 : null,
      titelKleur: titel ? getComputedStyle(titel).color : null,
      bKleur: b ? getComputedStyle(b).color : null,
      pijlZichtbaar: pijl ? pijl.getBoundingClientRect().width > 0 : null,
      pijlInhoud: pijl?.textContent ?? null,
    };
  });
  console.log(
    `  kop: links=${kopPositie.kopLinks} titelLinks=${kopPositie.titelLinks} breedte=${kopPositie.titelBreedte}`,
  );
  console.log(`  titel: "${kopPositie.titelTekst}" — b="${kopPositie.bTekst}" zichtbaar=${kopPositie.bZichtbaar}`);
  console.log(`  kleur: titel=${kopPositie.titelKleur} b=${kopPositie.bKleur}`);
  console.log(`  pijl: "${kopPositie.pijlInhoud}" zichtbaar=${kopPositie.pijlZichtbaar}`);
  if (kopPositie.titelHtml) console.log(`  html: ${kopPositie.titelHtml}`);

  const beeld = await page.evaluate(() => {
    const rijen = [...document.querySelectorAll('.snapshots__rij')];
    return {
      aantal: rijen.length,
      eerste: rijen.slice(0, 6).map((r) => ({
        naam: r.querySelector('b')?.textContent ?? '?',
        meta: (r.querySelector('.work__meta')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      })),
      titel: document.querySelector('.snapshots__titel')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      waarschuwing: document.querySelector('.snapshots .indeling__let')?.textContent?.trim() ?? null,
    };
  });

  console.log(`  ${beeld.titel}`);
  for (const r of beeld.eerste) console.log(`     ${r.naam.padEnd(38)} ${r.meta}`);
  if (beeld.waarschuwing) console.log(`  let op: ${beeld.waarschuwing}`);

  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `snapshots-${WIDTH}.png`), fullPage: false });
  console.log(`  snapshots-${WIDTH}.png`);

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
