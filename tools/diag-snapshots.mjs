#!/usr/bin/env node
/**
 * Diagnose van de snapshot-kop.
 *
 * De DOM zegt dat de titel er staat, maar in het beeld is hij niet te zien.
 * Dat betekent meestal: iets anders tekent eroverheen, of het element heeft een
 * grootte maar geen zichtbare inhoud. Dit meet het na.
 *
 *   node tools/diag-snapshots.mjs
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = process.env.CAVASCP_PORT || 8787;
const playwrightPad =
  process.env.PLAYWRIGHT_PATH || 'D:/Dropshippingv0.1tool/.mcp-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightPad).href);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 }, locale: 'nl-NL' });
page.on('pageerror', (e) => console.log(`   pageerror: ${e.message.slice(0, 160)}`));

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
  await page.waitForSelector('.tab', { timeout: 30000 });
  await page.locator('.tab', { hasText: /^portflow$/i }).first().click();
  await page.waitForSelector('.snapshots', { timeout: 120000 });
  await page.locator('.snapshots__kop').click();
  await page.waitForSelector('.snapshots__rij', { timeout: 120000 });

  /*
   * De muis wegzetten voordat we meten. Anders blijft hij boven de knop hangen
   * en meet je de hover-kleur in plaats van de gewone.
   */
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  const zonderHover = await page.evaluate(() => {
    const b = document.querySelector('.snapshots__titel b');
    return { kleur: b ? getComputedStyle(b).color : null, tekst: b?.textContent ?? null };
  });
  console.log(`   zonder hover: "${zonderHover.tekst}" kleur=${zonderHover.kleur}`);

  /* En met de muis erop, om te controleren dat het leesbaar blijft. */
  await page.hover('.snapshots__kop');
  await page.waitForTimeout(400);
  const metHover = await page.evaluate(() => {
    const b = document.querySelector('.snapshots__titel b');
    return { kleur: b ? getComputedStyle(b).color : null };
  });
  console.log(`   met hover  : kleur=${metHover.kleur}`);
  const gelijk = zonderHover.kleur === metHover.kleur;
  console.log(`   ${gelijk ? 'GOED' : 'LET OP'}: de kleur ${gelijk ? 'blijft gelijk' : 'verandert bij hover'}`);

  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);

  const meting = await page.evaluate(() => {
    const kop = document.querySelector('.snapshots__kop');
    const titel = document.querySelector('.snapshots__titel');
    const b = titel?.querySelector('b');
    const meta = titel?.querySelector('.work__meta');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        fontSize: cs.fontSize,
        color: cs.color,
        opacity: cs.opacity,
        visibility: cs.visibility,
        display: cs.display,
        overflow: cs.overflow,
        // Ligt er iets overheen op het midden van dit element?
        bovenop: (() => {
          const mid = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return mid ? `${mid.tagName}.${mid.className}`.slice(0, 60) : null;
        })(),
      };
    };
    return {
      kop: box(kop),
      titel: box(titel),
      vet: box(b),
      meta: box(meta),
      bTekst: b?.textContent ?? null,
    };
  });

  console.log('afmetingen en opmaak:');
  for (const [naam, m] of Object.entries(meting)) {
    if (naam === 'bTekst') continue;
    if (!m) {
      console.log(`   ${naam}: niet gevonden`);
      continue;
    }
    console.log(
      `   ${naam.padEnd(6)} x=${String(m.x).padStart(5)} y=${String(m.y).padStart(5)} ` +
        `${String(m.w).padStart(5)}×${String(m.h).padStart(3)}  ${m.fontSize}  ${m.color}  ` +
        `opacity=${m.opacity} zichtbaar=${m.visibility} display=${m.display}`,
    );
    if (m.bovenop) console.log(`          bovenop: ${m.bovenop}`);
  }
  console.log(`   tekst van <b>: "${meting.bTekst}"`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
