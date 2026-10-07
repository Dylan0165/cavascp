#!/usr/bin/env node
/**
 * Leest je Portflow-portfolio uit via de interne API, en achterhaalt hoe het
 * toevoegen van bewijs werkt.
 *
 * Alleen-lezen, met één uitzondering die geen data achterlaat: de JavaScript-
 * bundel van de app wordt opgehaald en doorzocht op API-paden. Dat is veiliger
 * dan een lege POST proberen, want dan zou er zomaar een leeg bewijsstuk in je
 * portfolio kunnen staan.
 *
 *   node portflow-read.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';

const { chromium } = await import(CONFIG.playwrightUrl);

await mkdir(CONFIG.outDir, { recursive: true });

const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
  ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
  headless: true,
  viewport: CONFIG.viewport,
  userAgent: CONFIG.userAgent,
  locale: 'nl-NL',
  timezoneId: 'Europe/Amsterdam',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());
const pf = new Portflow(page);

try {
  console.log('Verbinden met Portflow…');
  const portfolioId = await pf.connect();
  console.log(`  portfolio-id: ${portfolioId}`);
  console.log(`  ingelogd als: ${pf.me?.name ?? pf.me?.email ?? JSON.stringify(pf.me).slice(0, 80)}`);
  console.log(`  auth-headers: ${pf.auth.authorization ? 'Bearer-token opgevangen' : 'ontbreekt'}${
    pf.auth.csrf ? ' + csrf' : ''
  }`);
  console.log('');

  const caps = await pf.capabilities();
  console.log('Capabilities:');
  console.log(`  bewijs aanmaken : ${caps?.lms?.capabilities?.evidence_creation}`);
  console.log(`  snapshots       : ${caps?.lti?.capabilities?.submit_snapshots}`);
  console.log('');

  const [collections, sections] = await Promise.all([pf.collections(), pf.sections()]);

  console.log(`Secties (${sections.length}):`);
  for (const s of sections) console.log(`  ${String(s.id).padStart(6)}  ${s.name}`);
  console.log('');

  console.log(`Collecties (${collections.length}):`);
  console.log(`  ${'id'.padStart(7)}  ${'bewijs'.padStart(6)}  ${'doelen'.padStart(6)}  naam`);
  for (const c of collections) {
    console.log(
      `  ${String(c.id).padStart(7)}  ${String(c.evidence_count ?? 0).padStart(6)}  ${String(c.goals_count ?? 0).padStart(6)}  ${c.name}`,
    );
  }
  console.log('');

  // Evidence inside each collection — shows what is already there.
  let withEvidence = 0;
  for (const c of collections) {
    if (!c.evidence_count) continue;
    const items = await pf.evidenceInCollection(c.id);
    if (items.length) {
      withEvidence += 1;
      console.log(`Bewijs in "${c.name}" (${items.length}):`);
      for (const e of items.slice(0, 8)) {
        console.log(`  ${String(e.id).padStart(8)}  ${(e.name || e.title || '?').slice(0, 62)}`);
      }
    }
  }
  if (!withEvidence) console.log('Geen bewijs gevonden in de collecties.');
  console.log('');

  /* ── API-contract achterhalen uit de app-bundel ───────────────────────── */

  console.log('API-paden zoeken in de app-bundel…');
  // Search inside the Portflow frame: the app's own scripts live there.
  const endpoints = await pf.frame
    .evaluate(async () => {
      const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src);
      const found = new Set();
      const patterns = [
        /["'`](\/api\/v1\/[a-z0-9/_:{}.-]*evidence[a-z0-9/_:{}.-]*)["'`]/gi,
        /["'`](\/api\/v1\/portfolios\/[a-z0-9/_:{}.-]*upload[a-z0-9/_:{}.-]*)["'`]/gi,
        /["'`](\/api\/v1\/[a-z0-9/_:{}.-]*attachment[a-z0-9/_:{}.-]*)["'`]/gi,
        /["'`](\/api\/v1\/[a-z0-9/_:{}.-]*file[a-z0-9/_:{}.-]*)["'`]/gi,
        /["'`](\/api\/v1\/[a-z0-9/_:{}.-]*backpack[a-z0-9/_:{}.-]*)["'`]/gi,
      ];
      for (const src of scripts.slice(0, 40)) {
        try {
          const res = await fetch(src, { credentials: 'include' });
          if (!res.ok) continue;
          const text = await res.text();
          for (const re of patterns) {
            for (const m of text.matchAll(re)) found.add(m[1]);
          }
        } catch {
          /* skip unreadable script */
        }
      }
      return { scripts: scripts.length, paths: [...found].sort() };
    })
    .catch((e) => ({ scripts: 0, paths: [], error: e.message }));

  console.log(`  bundels gelezen : ${endpoints.scripts}`);
  if (endpoints.error) console.log(`  fout: ${endpoints.error}`);
  if (endpoints.paths.length) {
    console.log('  gevonden paden:');
    for (const p of endpoints.paths.slice(0, 40)) console.log(`     ${p}`);
  } else {
    console.log('  geen expliciete paden gevonden (waarschijnlijk dynamisch opgebouwd)');
  }
  console.log('');

  const report = {
    generatedAt: new Date().toISOString(),
    portfolioId,
    capabilities: caps,
    sections,
    collections,
    endpointCandidates: endpoints.paths,
  };
  const file = path.join(CONFIG.outDir, 'portflow-read.json');
  await writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  console.log(`rapport: ${file}`);
} catch (error) {
  console.error(`\nFOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
