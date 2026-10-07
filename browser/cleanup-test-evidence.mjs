#!/usr/bin/env node
/**
 * Ruimt het testbewijsstuk op dat upload-evidence.mjs heeft aangemaakt.
 *
 * De DELETE met het id uit de collectielijst gaf 404. Dat komt omdat die lijst
 * een ander object teruggeeft dan het bewijsstuk zelf: het echte evidence-id
 * staat in de backpack. Dit script zoekt het item op naam, bepaalt het juiste
 * id, en probeert de delete-routes tot er één werkt.
 *
 *   node cleanup-test-evidence.mjs                 # zoekt "cavascp testbewijs"
 *   node cleanup-test-evidence.mjs --id 2181319    # specifiek id
 *   node cleanup-test-evidence.mjs --list          # alleen laten zien
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';

const LIST_ONLY = process.argv.includes('--list');
const idArg = process.argv.indexOf('--id');
const WANTED_ID = idArg !== -1 ? Number(process.argv[idArg + 1]) : null;

const { chromium } = await import(CONFIG.playwrightUrl);
await mkdir(CONFIG.outDir, { recursive: true });

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
  console.log(`portfolio ${pf.portfolioId}`);

  const evidence = await pf.allEvidence({ perPage: 200 });
  const items = Array.isArray(evidence.data) ? evidence.data : (evidence.data?.evidence ?? []);
  console.log(`bewijsstukken in de backpack: ${items.length}`);

  const targets = WANTED_ID
    ? items.filter((e) => Number(e.id) === WANTED_ID)
    : items.filter((e) => /cavascp testbewijs/i.test(e.name ?? ''));

  if (LIST_ONLY || !targets.length) {
    console.log('');
    if (!targets.length) console.log('geen testbewijs gevonden (misschien al opgeruimd).');
    console.log('recentste 8 bewijsstukken:');
    for (const e of items.slice(0, 8)) {
      console.log(`  id ${String(e.id).padStart(8)}  ${String(e.name).slice(0, 50)}  ${e.created_at ?? ''}`);
    }
    await context.close();
    process.exit(0);
  }

  console.log(`te verwijderen: ${targets.length}`);
  for (const t of targets) console.log(`  id ${t.id}  "${t.name}"  ${t.created_at ?? ''}`);

  /* Probeer de routes tot er één werkt. */
  const routes = targets.flatMap((t) => [
    ['DELETE', `/api/v1/portfolios/${pf.portfolioId}/evidence/${t.id}`],
    ['DELETE', `/api/v1/evidence/${t.id}`],
    ['DELETE', `/api/v1/portfolios/${pf.portfolioId}/evidence/${t.id}?permanent=true`],
    ['PUT', `/api/v1/portfolios/${pf.portfolioId}/evidence/${t.id}`, { deleted: true }],
  ]);

  const attempts = [];
  for (const [method, url, body] of routes) {
    const res = await pf.call(method, url, body);
    attempts.push({ method, url, status: res.status, ok: res.ok, body: res.data ?? res.textPreview });
    console.log(`  ${method} ${url} -> ${res.status}`);
    if (res.ok) break;
  }

  /* Controleren of het weg is. */
  await page.waitForTimeout(1500);
  const after = await pf.allEvidence({ perPage: 200 });
  const afterItems = Array.isArray(after.data) ? after.data : (after.data?.evidence ?? []);
  const stillThere = afterItems.filter((e) => /cavascp testbewijs/i.test(e.name ?? ''));
  console.log('');
  console.log(`backpack nu: ${afterItems.length} (was ${items.length})`);
  console.log(stillThere.length ? `LET OP: nog aanwezig: ${stillThere.map((e) => e.id).join(', ')}` : 'testbewijs is weg');

  const file = path.join(CONFIG.outDir, 'cleanup.json');
  await writeFile(file, JSON.stringify({ attempts, remaining: stillThere }, null, 2), 'utf8');
  console.log(`rapport: ${file}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
