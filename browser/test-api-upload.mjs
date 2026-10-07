#!/usr/bin/env node
/**
 * Test de directe API-upload: geen UI, geen kliks.
 *
 * Gebruikt de drie stappen die uit de app zijn afgekeken:
 *   POST /direct-uploads  →  PUT naar S3  →  POST /evidence
 *
 * Maakt een testbestand aan, uploadt het naar een collectie, controleert of het
 * er staat, en verwijdert het weer. Zo blijft je portfolio schoon.
 *
 *   node test-api-upload.mjs                # uploaden + controleren + opruimen
 *   node test-api-upload.mjs --keep         # laten staan
 *   node test-api-upload.mjs --lo 1,2       # ook aan leeruitkomsten koppelen
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';

const KEEP = process.argv.includes('--keep');
const loArg = process.argv.indexOf('--lo');
const LO_CODES = loArg !== -1 ? process.argv[loArg + 1].split(',').map((s) => s.trim()) : [];

const { chromium } = await import(CONFIG.playwrightUrl);
await mkdir(CONFIG.outDir, { recursive: true });

const TEST_FILE = path.join(CONFIG.outDir, 'api-upload-test.txt');
await writeFile(
  TEST_FILE,
  [
    'Automatisch geüpload via de Portflow API, zonder de interface te gebruiken.',
    `Tijdstip: ${new Date().toISOString()}`,
    'Dit is testbewijs en mag verwijderd worden.',
  ].join('\n'),
  'utf8',
);

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

let evidenceId = null;
let target = null;

try {
  console.log('Verbinden…');
  await pf.connect();
  console.log(`  portfolio ${pf.portfolioId} · ${pf.me?.name ?? '?'}`);

  const collections = await pf.collections();
  // Voorkeur voor een collectie die al bewijs heeft: dat is een realistische test.
  target = collections.find((c) => (c.evidence_count ?? 0) > 0) ?? collections[0];
  console.log(`  doelcollectie: "${target.name}" (${target.id})`);

  /* Leeruitkomsten opzoeken als daarom gevraagd is. */
  let goalIds = [];
  if (LO_CODES.length) {
    const goals = await pf.goals();
    const list = Array.isArray(goals) ? goals : (goals?.goals ?? []);
    console.log(`  doelen beschikbaar: ${list.length}`);
    goalIds = list
      .filter((g) => LO_CODES.some((code) => new RegExp(`^LO\\s*${code}\\b`, 'i').test(g.name ?? g.description ?? '')))
      .map((g) => g.id);
    console.log(`  gekoppeld aan doelen: ${goalIds.length ? goalIds.join(', ') : 'geen match'}`);
  }

  const before = (await pf.allEvidence({ perPage: 200 }).then((r) => (Array.isArray(r.data) ? r.data : []))).length;
  console.log(`  bewijsstukken nu: ${before}`);
  console.log('');

  console.log('Uploaden via de API (zonder UI)…');
  const result = await pf.addFileEvidence({
    filePath: TEST_FILE,
    collectionIds: [target.id],
    goalIds,
    name: 'cavascp API-test',
  });
  evidenceId = result.evidenceId;

  /* Controleren of het er echt staat. */
  const after = await pf.allEvidence({ perPage: 200 });
  const items = Array.isArray(after.data) ? after.data : [];
  const found = items.find((e) => e.id === evidenceId);
  console.log('');
  console.log(`  bewijsstukken nu: ${items.length} (was ${before})`);
  console.log(`  teruggevonden   : ${found ? `ja — "${found.name}"` : 'NEE'}`);
  if (found) {
    console.log(`  aangemaakt      : ${found.created_at}`);
    console.log(`  type            : ${found.latest_version_type}`);
    console.log(`  in collecties   : ${(found.collections ?? []).map((c) => c.name).join(', ') || '—'}`);
    console.log(`  gekoppeld aan   : ${(found.goals ?? []).map((g) => g.name).join(', ') || 'geen doelen'}`);
  }

  /* Opruimen. */
  if (evidenceId && !KEEP) {
    const status = await pf.deleteEvidence(evidenceId);
    console.log('');
    console.log(`  opruimen: DELETE evidence/${evidenceId} -> ${status}`);
    const final = await pf.allEvidence({ perPage: 200 });
    const finalItems = Array.isArray(final.data) ? final.data : [];
    const still = finalItems.some((e) => e.id === evidenceId);
    console.log(`  ${still ? 'LET OP: staat er nog' : 'verwijderd'} — ${finalItems.length} bewijsstukken over`);
  } else if (evidenceId) {
    console.log(`\n  --keep: evidence ${evidenceId} blijft staan.`);
  }

  console.log('');
  console.log(evidenceId && found ? 'RESULTAAT: de directe API-upload werkt.' : 'RESULTAAT: onvolledig — zie boven.');
} catch (error) {
  console.error(`\nFOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
