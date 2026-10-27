#!/usr/bin/env node
/**
 * Het snapshot-overzicht en het verwijder-endpoint vinden.
 *
 * Er is een test-snapshot gemaakt tijdens het onderzoek naar het aanmaak-
 * endpoint. Die moet weg. Daarvoor moeten we weten waar de lijst staat en hoe
 * je verwijdert.
 *
 * We zoeken in de bundels naar alles wat met een freeze te maken heeft, en
 * proberen daarna de gevonden routes uit.
 *
 *   node research-snapshot-lijst.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';

const { chromium } = await import(CONFIG.playwrightUrl);
const OUT = path.resolve('out');
await mkdir(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
  ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
  headless: true,
  viewport: CONFIG.viewport,
  userAgent: CONFIG.userAgent,
  locale: 'nl-NL',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());
const pf = new Portflow(page);

try {
  await pf.connect();
  const P = pf.portfolioId;
  console.log(`verbonden: portfolio ${P}`);
  console.log('');

  /* ── 1. Zoek alle freeze-routes in de bundels ───────────────────────── */
  console.log('='.repeat(76));
  console.log('1. ALLE FREEZE-ROUTES IN DE BUNDELS');
  console.log('='.repeat(76));

  const routes = await pf.frame.evaluate(async () => {
    const scripts = new Set([...document.querySelectorAll('script[src]')].map((s) => s.src));
    try {
      for (const e of performance.getEntriesByType('resource')) if (e.name.endsWith('.js')) scripts.add(e.name);
    } catch {
      /* niet beschikbaar */
    }

    const paden = new Set();
    for (const src of scripts) {
      let tekst;
      try {
        const res = await fetch(src, { credentials: 'include' });
        if (!res.ok) continue;
        tekst = await res.text();
      } catch {
        continue;
      }
      // Elke route met "freeze" erin, in elke vorm.
      for (const m of tekst.matchAll(/["'`](\/api\/v1\/[a-z0-9/_:{}.\-$\s]*freeze[a-z0-9/_:{}.\-$\s]*)["'`]/gi)) {
        paden.add(m[1].replace(/\s+/g, ''));
      }
      // Ook routes met "snapshot" erin.
      for (const m of tekst.matchAll(/["'`](\/api\/v1\/[a-z0-9/_:{}.\-$\s]*snapshot[a-z0-9/_:{}.\-$\s]*)["'`]/gi)) {
        paden.add(m[1].replace(/\s+/g, ''));
      }
    }
    return [...paden].sort();
  });

  console.log(`  ${routes.length} routes gevonden:`);
  for (const r of routes) console.log(`     ${r}`);

  /* ── 2. De routes proberen ──────────────────────────────────────────── */
  console.log('');
  console.log('='.repeat(76));
  console.log('2. ROUTES PROBEREN');
  console.log('='.repeat(76));

  const kandidaten = [
    ...routes.map((r) => r.replace(/\$\{[^}]+\}/g, String(P)).replace(/\/:id/g, `/${P}`)),
    `/api/v1/portfolios/${P}/portfolio-freezes`,
    `/api/v1/portfolios/${P}/portfolio-freezes/list`,
    `/api/v1/portfolios/${P}/freeze`,
  ];

  const gevonden = [];
  for (const p of [...new Set(kandidaten)]) {
    if (p.includes('${')) continue;
    const r = await pf.call('GET', p);
    const n = Array.isArray(r.data) ? r.data.length : null;
    const flag = r.ok ? 'OK ' : '—  ';
    console.log(`  ${flag} [${r.status}] ${p.replace(`/api/v1/portfolios/${P}`, '…')}${n !== null ? `  → ${n} items` : ''}`);
    if (r.ok && r.data) {
      gevonden.push({ pad: p, status: r.status });
      console.log(`         ${JSON.stringify(r.data).slice(0, 400)}`);
    }
  }

  await writeFile(
    path.join(OUT, 'freeze-lijst-routes.json'),
    JSON.stringify({ gemaakt: new Date().toISOString(), routes, gevonden }, null, 2),
    'utf8',
  );
  console.log('');
  console.log(`rapport: ${path.join(OUT, 'freeze-lijst-routes.json')}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
