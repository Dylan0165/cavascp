#!/usr/bin/env node
/**
 * De hele keten testen: Krava-project → Word → Portflow.
 *
 * Dit is de test die bewijst dat het ecosysteem werkt. Er wordt echt iets naar
 * Portflow gestuurd, en daarna weer verwijderd — een test die troep achterlaat
 * is geen test.
 *
 * Wat er gebeurt:
 *   1. een Krava-project van schijf lezen (geen login nodig)
 *   2. er een Word-bestand van maken met de overgezette generator
 *   3. het naar een map in Portflow uploaden, met leeruitkomsten en toelichting
 *   4. controleren dat het er echt staat
 *   5. het weer verwijderen en controleren dat het weg is
 *
 *   node tools/test-ecosystem.mjs              # volledige keten met opruiming
 *   node tools/test-ecosystem.mjs --droog      # alleen tot het Word-bestand
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { projectNaarDocx } from '../mcp/lib/assemble.mjs';
import { loadEnvFile } from '../mcp/lib/canvas.mjs';

const DROOG = process.argv.includes('--droog');
const KRAVA_PROJECTEN = 'D:/DOCAto/data/projects';
const TMP = path.resolve('data/tmp-ecosystem');

/** De map van dit semester waar we in testen. */
const TEST_MAP = 250280; // "Persoonlijk project" — leeg, dus we laten geen sporen na
const TEST_LO = 485383; // Professional Standard (MAIFS)

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

mkdirSync(TMP, { recursive: true });
let portflow = null;
let context = null;
let bewijsId = null;

try {
  /* ── 1. Een Krava-project lezen ─────────────────────────────────────── */
  console.log('1) Krava-project lezen (direct van schijf, zonder login)');
  const bestanden = readdirSync(KRAVA_PROJECTEN).filter((f) => f.endsWith('.json'));
  const kandidaten = [];
  for (const f of bestanden) {
    try {
      const j = JSON.parse(readFileSync(path.join(KRAVA_PROJECTEN, f), 'utf8'));
      const tekst = (j.plan?.secties || []).reduce((n, s) => n + String(s.tekst || '').length, 0);
      if (tekst > 500) kandidaten.push({ j, tekst });
    } catch {
      /* overslaan */
    }
  }
  kandidaten.sort((a, b) => b.tekst - a.tekst);
  check('project met inhoud gevonden', kandidaten.length > 0, `${kandidaten.length} bruikbaar`);
  const project = kandidaten[0].j;
  console.log(`     "${String(project.titel).slice(0, 46)}" (${kandidaten[0].tekst} tekens)`);

  /* ── 2. Er een Word-bestand van maken ───────────────────────────────── */
  console.log('\n2) Word-bestand maken');
  const doc = projectNaarDocx(project);
  const docPad = path.join(TMP, doc.filename);
  writeFileSync(docPad, doc.buffer);
  check('Word-bestand gemaakt', doc.buffer.length > 5000, `${doc.buffer.length} bytes, ${doc.statistiek.secties} secties`);
  check('bestandsnaam eindigt op .docx', doc.filename.endsWith('.docx'), doc.filename);

  /* ── 3. Naar Portflow ───────────────────────────────────────────────── */
  console.log('\n3) Naar Portflow sturen');
  const { CONFIG } = await import('../browser/config.mjs');
  const { Portflow } = await import('../browser/portflow.mjs');
  const { chromium } = await import(CONFIG.playwrightUrl);

  context = await chromium.launchPersistentContext(CONFIG.profileDir, {
    ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
    headless: true,
    viewport: CONFIG.viewport,
    userAgent: CONFIG.userAgent,
    locale: 'nl-NL',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  portflow = new Portflow(page);
  await portflow.connect();
  console.log(`     verbonden: portfolio ${portflow.portfolioId}`);

  const toelichting = 'Automatische test vanuit cavascp. Dit bestand wordt direct weer verwijderd.';
  const upload = await portflow.addFileEvidence({
    filePath: docPad,
    collectionIds: [TEST_MAP],
    goalIds: [TEST_LO],
    name: `TEST ${doc.filename.replace('.docx', '')}`.slice(0, 60),
    description: toelichting,
    quiet: true,
  });
  bewijsId = upload.evidenceId;
  check('bewijs aangemaakt in Portflow', Boolean(bewijsId), `evidence ${bewijsId}`);
  check('juiste bestandsgrootte', upload.size === doc.buffer.length, `${upload.size} bytes`);

  /* ── 4. Controleren dat het er echt staat ───────────────────────────── */
  console.log('\n4) Teruglezen uit Portflow');
  await new Promise((r) => setTimeout(r, 2000));

  const inMap = await portflow.call(
    'GET',
    `/api/v1/portfolios/${portflow.portfolioId}/collections/${TEST_MAP}/evidence?page=1&per_page=100`,
  );
  const lijst = Array.isArray(inMap.data) ? inMap.data : (inMap.data?.evidence ?? []);
  const gevonden = lijst.find((x) => (x.evidence?.id ?? x.id) === bewijsId);
  check('staat in de map', Boolean(gevonden), `${lijst.length} stukken in de map`);

  const detail = await portflow.call('GET', `/api/v1/portfolios/${portflow.portfolioId}/evidence/${bewijsId}`);
  check('bewijsstuk op te vragen', detail.ok, `status ${detail.status}`);
  if (detail.ok) {
    check('naam klopt', String(detail.data?.name || '').startsWith('TEST '), detail.data?.name);
    check(
      'toelichting bewaard',
      // Hoofdletterongevoelig: de tekst begint met "Automatische".
      /automatische test/i.test(String(detail.data?.description || '')),
      String(detail.data?.description || '(leeg)').slice(0, 50),
    );
    check('aantal leeruitkomsten klopt', detail.data?.goals_count === 1, `${detail.data?.goals_count} doelen`);
  }

  const doelen = await portflow.evidenceGoals(bewijsId);
  check('gekoppeld aan de juiste leeruitkomst', doelen.some((g) => g.id === TEST_LO), doelen.map((g) => `${g.id}:${g.name}`).join(', '));

  /* ── 5. Opruimen ────────────────────────────────────────────────────── */
  console.log('\n5) Opruimen');
  const status = await portflow.deleteEvidence(bewijsId);
  check('verwijderen gelukt', status === 204 || status === 200, `status ${status}`);
  bewijsId = null;

  await new Promise((r) => setTimeout(r, 1500));
  const na = await portflow.call(
    'GET',
    `/api/v1/portfolios/${portflow.portfolioId}/collections/${TEST_MAP}/evidence?page=1&per_page=100`,
  );
  const naLijst = Array.isArray(na.data) ? na.data : (na.data?.evidence ?? []);
  check('map is weer leeg', naLijst.length === 0, `${naLijst.length} stukken over`);
} catch (error) {
  check(`keten mislukt: ${error.message}`, false, error.stack?.split('\n')[1]?.trim());

  // Bij een fout alsnog proberen op te ruimen, zodat er niets blijft staan.
  if (bewijsId && portflow) {
    console.log(`\n  opruimen na fout (bewijs ${bewijsId})…`);
    try {
      const status = await portflow.deleteEvidence(bewijsId);
      console.log(`  opgeruimd, status ${status}`);
      bewijsId = null;
    } catch (opruimFout) {
      console.log(`  OPRUIMEN MISLUKT: ${opruimFout.message}`);
      console.log(`  verwijder bewijs ${bewijsId} handmatig in Portflow`);
    }
  }
} finally {
  if (context) await context.close().catch(() => {});
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
