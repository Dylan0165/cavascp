#!/usr/bin/env node
/**
 * Diagnose van de documentenlijst.
 *
 * De lijst toont minder items dan de API teruggeeft. Dit script kijkt in de
 * pagina zelf: wat staat er in de DOM, wat zegt de state, en wat geeft de API.
 * Zo zie je welke van de drie de afwijking veroorzaakt.
 *
 *   node tools/diag-documenten.mjs
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = process.env.CAVASCP_PORT || 8787;
const playwrightPad =
  process.env.PLAYWRIGHT_PATH || 'D:/Dropshippingv0.1tool/.mcp-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightPad).href);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'nl-NL' });
page.on('pageerror', (e) => console.log(`   pageerror: ${e.message.slice(0, 160)}`));
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`   console: ${m.text().slice(0, 160)}`);
});

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
  await page.waitForSelector('.tab', { timeout: 30000 });

  await page.locator('.tab', { hasText: /documenten/i }).first().click();
  await page.waitForTimeout(3500);

  const beeld = await page.evaluate(async () => {
    const uit = {};
    uit.aantalItems = document.querySelectorAll('.work__item').length;
    uit.items = [...document.querySelectorAll('.work__item')].map((n) => ({
      titel: (n.querySelector('b')?.textContent ?? '?').slice(0, 44),
      meta: (n.querySelector('.work__meta')?.textContent ?? '').trim().slice(0, 40),
      isOn: n.classList.contains('is-on'),
    }));
    uit.koppen = [...document.querySelectorAll('.work__list p')].map((p) => p.textContent.trim().slice(0, 40));
    uit.paneelTitel = document.querySelector('.work__kop input')?.value ?? null;
    uit.secties = document.querySelectorAll('.sectie').length;
    uit.leegMelding = document.querySelector('#work-main .empty h3')?.textContent ?? null;

    // Wat zegt de API rechtstreeks vanuit de pagina?
    try {
      const r = await fetch('/api/documenten', { credentials: 'same-origin' });
      const b = await r.json();
      uit.apiDocumenten = (b.documenten ?? []).map((d) => `${d.titel} (${d.secties})`);
    } catch (e) {
      uit.apiFout = e.message;
    }
    return uit;
  });

  console.log('wat de pagina toont:');
  console.log(`   items in de lijst : ${beeld.aantalItems}`);
  for (const it of beeld.items) {
    console.log(`      ${it.isOn ? '*' : ' '} ${it.titel.padEnd(46)} ${it.meta}`);
  }
  console.log(`   tussenkoppen      : ${JSON.stringify(beeld.koppen)}`);
  console.log(`   paneeltitel       : ${JSON.stringify(beeld.paneelTitel)}`);
  console.log(`   secties in paneel : ${beeld.secties}`);
  if (beeld.leegMelding) console.log(`   leeg-melding      : ${beeld.leegMelding}`);
  console.log('');
  console.log('wat de API geeft:');
  if (beeld.apiFout) console.log(`   fout: ${beeld.apiFout}`);
  for (const d of beeld.apiDocumenten ?? []) console.log(`      ${d}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
