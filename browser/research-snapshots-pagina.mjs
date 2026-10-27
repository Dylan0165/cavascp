#!/usr/bin/env node
/**
 * Het snapshot-overzicht openen en de test-snapshot opruimen.
 *
 * Er is tijdens het onderzoek een snapshot gemaakt ("cavascp test-snapshot").
 * Die hoort niet in het portfolio te blijven. De lijst- en verwijder-routes
 * staan niet in de JS-bundel, dus we gaan via de interface: klik op
 * "My snapshots" en leg vast welk verkeer dat oplevert.
 *
 *   node research-snapshots-pagina.mjs           # alleen kijken
 *   node research-snapshots-pagina.mjs --opruimen # en de test-snapshot verwijderen
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';
import { REACT_CLICK_HELPER } from './lib/react-click.mjs';

const OPRUIMEN = process.argv.includes('--opruimen');
const NAAM = 'cavascp test-snapshot';
const { chromium } = await import(CONFIG.playwrightUrl);
const OUT = path.resolve('out');
await mkdir(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
  ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
  headless: true,
  viewport: { width: 1600, height: 1100 },
  userAgent: CONFIG.userAgent,
  locale: 'nl-NL',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());
const pf = new Portflow(page);

/** Al het API-verkeer, zodat we de lijstroutes zien. */
const verkeer = [];
page.on('request', (req) => {
  const url = req.url();
  if (!url.includes('/api/')) return;
  if (/\.(js|css|png|svg|woff2?)$/i.test(url)) return;
  verkeer.push({
    method: req.method(),
    pad: url.replace(`https://${CONFIG.portflowHost}`, '').split('?')[0],
    query: url.includes('?') ? url.split('?')[1].slice(0, 120) : null,
  });
});

try {
  await pf.connect();
  console.log(`verbonden: portfolio ${pf.portfolioId}`);
  await pf.frame.evaluate(REACT_CLICK_HELPER);
  console.log('');

  /* Naar de snapshots-pagina via de navigatie. */
  const voor = verkeer.length;
  const geklikt = await pf.frame
    .evaluate(() => window.__cavascpClickText(/^\s*my snapshots\s*$/i, { maxLength: 30 }))
    .catch((e) => ({ ok: false, reason: e.message }));
  console.log(`  klik "My snapshots": ${geklikt.ok ? `"${geklikt.text}"` : `MISLUKT (${geklikt.reason})`}`);
  await page.waitForTimeout(6000);

  const dom = await pf.frame
    .evaluate(() => ({
      url: location.href,
      koppen: [...document.querySelectorAll('h1, h2, h3')].map((n) => (n.textContent ?? '').trim().slice(0, 60)).filter(Boolean),
      tekst: document.body.innerText.replace(/\s+/g, ' ').slice(0, 700),
      knoppen: [...document.querySelectorAll('button, [role="button"]')]
        .map((b) => (b.textContent ?? '').trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 20),
    }))
    .catch((e) => ({ fout: e.message }));

  console.log(`  url: ${dom.url ?? '?'}`);
  console.log(`  koppen: ${(dom.koppen ?? []).join(' | ') || '—'}`);
  console.log(`  tekst: ${(dom.tekst ?? dom.fout ?? '').slice(0, 320)}`);
  console.log('');

  const nieuw = verkeer.slice(voor);
  if (nieuw.length) {
    console.log('  API-aanroepen op deze pagina:');
    for (const v of [...new Set(nieuw.map((x) => `${x.method} ${x.pad}`))]) {
      const q = nieuw.find((x) => `${x.method} ${x.pad}` === v)?.query;
      console.log(`     ${v}${q ? `?${q}` : ''}`);
    }
  } else {
    console.log('  (geen API-aanroepen — de pagina laadde misschien al eerder)');
  }
  console.log('');

  /* Staat onze test-snapshot er? */
  const heeftTest = /cavascp test-snapshot/i.test(dom.tekst ?? '');
  console.log(`  test-snapshot zichtbaar: ${heeftTest ? 'JA' : 'nee'}`);

  if (OPRUIMEN && heeftTest) {
    console.log('\n  opruimen: het menu bij de snapshot openen');
    const menu = await pf.frame
      .evaluate(() => {
        // Zoek de rij met onze snapshot en klik het driepuntsmenu erin.
        const rijen = [...document.querySelectorAll('tr, li, [class*="card"], [class*="row"]')];
        const rij = rijen.find((r) => /cavascp test-snapshot/i.test(r.textContent ?? ''));
        if (!rij) return { ok: false, reden: 'rij niet gevonden' };
        const knoppen = [...rij.querySelectorAll('button, [role="button"], [class*="more"], [class*="ellipsis"]')];
        if (!knoppen.length) return { ok: false, reden: 'geen menu-knop in de rij' };
        // De laatste knop is meestal het menu.
        const doel = knoppen[knoppen.length - 1];
        doel.click();
        return { ok: true, knoppen: knoppen.length, tekst: (doel.textContent ?? '').trim().slice(0, 30) };
      })
      .catch((e) => ({ ok: false, reden: e.message }));
    console.log(`  menu: ${menu.ok ? 'geopend' : `mislukt (${menu.reden})`}`);
    await page.waitForTimeout(2000);

    const opties = await pf.frame
      .evaluate(() =>
        [...document.querySelectorAll('.ant-dropdown-menu-item, [role="menuitem"], .ant-dropdown li')]
          .map((n) => (n.textContent ?? '').trim().slice(0, 40))
          .filter(Boolean),
      )
      .catch(() => []);
    console.log(`  menu-opties: ${opties.join(' | ') || '(geen)'}`);

    if (opties.some((o) => /delete|verwijder/i.test(o))) {
      const verwijderd = await pf.frame
        .evaluate(() => window.__cavascpClickText(/delete|verwijder/i, { maxLength: 40 }))
        .catch(() => ({ ok: false }));
      console.log(`  verwijderen geklikt: ${verwijderd.ok ? 'ja' : 'nee'}`);
      await page.waitForTimeout(1500);

      // Bevestiging.
      const bevestigd = await pf.frame
        .evaluate(() => window.__cavascpClickText(/^\s*(delete|verwijderen|yes|ja|ok)\s*$/i, { maxLength: 20 }))
        .catch(() => ({ ok: false }));
      console.log(`  bevestigd: ${bevestigd.ok ? 'ja' : 'nee (misschien geen bevestiging nodig)'}`);
      await page.waitForTimeout(4000);
    } else {
      console.log('  geen verwijder-optie gevonden in het menu');
    }
  } else if (OPRUIMEN) {
    console.log('  niets op te ruimen (test-snapshot niet zichtbaar)');
  }

  /* Alle schrijvende aanroepen. */
  const schrijvend = verkeer.filter((v) => v.method !== 'GET');
  console.log('\n  schrijvende aanroepen tijdens dit bezoek:');
  for (const v of [...new Set(schrijvend.map((x) => `${x.method} ${x.pad}`))]) console.log(`     ${v}`);
  if (!schrijvend.length) console.log('     (geen)');

  await writeFile(
    path.join(OUT, 'snapshots-pagina.json'),
    JSON.stringify({ gemaakt: new Date().toISOString(), dom, verkeer }, null, 2),
    'utf8',
  );
  console.log(`\nrapport: ${path.join(OUT, 'snapshots-pagina.json')}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
