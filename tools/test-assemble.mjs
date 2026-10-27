#!/usr/bin/env node
/**
 * Test de hele keten: een echt Krava-project → Word-bestand.
 *
 * We lezen een project dat echt in Krava staat (van schijf, dus zonder login)
 * en maken er een Word-bestand van met dezelfde generator die Krava gebruikt.
 * Daarna controleren we of de inhoud er echt in zit: de secties uit het plan,
 * de titel, de bronnen.
 *
 * Dit is de belangrijkste test van de brug: als dit klopt, kan het dashboard
 * elk Krava-project omzetten naar een inleverbaar document.
 *
 *   node tools/test-assemble.mjs
 *   node tools/test-assemble.mjs <project-id>
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { projectNaarDocx, projectNaarPptx, assembleer, vlakeSecties } from '../mcp/lib/assemble.mjs';
import { leesZip } from '../mcp/lib/zip.mjs';

const KRAVA_PROJECTEN = 'D:/DOCAto/data/projects';
const TMP = path.resolve('data/tmp-assemble');
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/* ── Een project kiezen met genoeg inhoud ───────────────────────────────── */
console.log('1) Een Krava-project vinden');
if (!readdirSync) console.error('geen fs');
const bestanden = readdirSync(KRAVA_PROJECTEN).filter((f) => f.endsWith('.json'));
check('projectbestanden gevonden', bestanden.length > 0, `${bestanden.length}`);

const gezochtId = process.argv[2];
let project = null;
let gekozen = null;

// Het liefst een project met veel tekst: daar valt het meest te controleren.
const kandidaten = [];
for (const f of bestanden) {
  try {
    const j = JSON.parse(readFileSync(path.join(KRAVA_PROJECTEN, f), 'utf8'));
    const tekst = (j.plan?.secties || []).reduce((n, s) => n + String(s.tekst || '').length, 0);
    kandidaten.push({ bestand: f, project: j, tekst });
  } catch {
    /* onleesbaar bestand overslaan */
  }
}
kandidaten.sort((a, b) => b.tekst - a.tekst);
const gekozenKandidaat = gezochtId
  ? kandidaten.find((k) => k.project.id === gezochtId)
  : kandidaten.find((k) => k.tekst > 500) ?? kandidaten[0];

if (!gekozenKandidaat) {
  check('een project met inhoud gevonden', false, 'geen enkel project heeft tekst');
} else {
  project = gekozenKandidaat.project;
  gekozen = gekozenKandidaat;
  check(
    'een project met inhoud gevonden',
    gekozen.tekst > 0,
    `"${String(project.titel).slice(0, 40)}" met ${gekozen.tekst} tekens`,
  );
}

/* ── Het plan ontleden ──────────────────────────────────────────────────── */
if (project) {
  console.log('\n2) Het plan ontleden');
  const secties = project.plan?.secties || [];
  check('plan heeft secties', secties.length > 0, `${secties.length}`);

  const plat = vlakeSecties(secties);
  check('platslaan werkt', plat.length >= secties.length, `${secties.length} → ${plat.length}`);
  check('elke sectie heeft een niveau', plat.every((s) => Number(s.niveau) >= 1));
  check(
    'subsecties krijgen een dieper niveau',
    !secties.some((s) => (s.subsecties || []).length) || plat.some((s) => s.niveau > 1),
    `max niveau ${Math.max(...plat.map((s) => s.niveau))}`,
  );

  const { secties: metBlokken, ontbrekend } = assembleer(project);
  const totaalBlokken = metBlokken.reduce((n, s) => n + (s.blokken?.length || 0), 0);
  check('markdown omgezet naar blokken', totaalBlokken > 0, `${totaalBlokken} blokken in ${metBlokken.length} secties`);

  const soorten = new Map();
  for (const s of metBlokken) for (const b of s.blokken || []) soorten.set(b.type, (soorten.get(b.type) || 0) + 1);
  console.log(`     bloktypen: ${[...soorten.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`);
  check('meer dan alleen alinea\'s', soorten.size > 1, `${soorten.size} verschillende typen`);
  check('geen dubbele sectiekop', metBlokken.every((s) => !(s.blokken || []).some((b) => (b.type === 'heading' || b.type === 'subheading') && String(b.tekst || '').trim().toLowerCase() === String(s.titel || '').trim().toLowerCase())));
  if (ontbrekend.length) console.log(`     let op: ${ontbrekend.length} afbeelding(en) niet in de tekst geplaatst`);

  /* ── Het Word-bestand ─────────────────────────────────────────────────── */
  console.log('\n3) Word-bestand maken');
  mkdirSync(TMP, { recursive: true });
  try {
    const uit = projectNaarDocx(project);
    check('bestand gemaakt', uit.buffer.length > 5000, `${uit.buffer.length} bytes`);
    check('bestandsnaam is netjes', /^[\p{L}\p{N} _-]+\.docx$/u.test(uit.filename), uit.filename);
    check('statistiek klopt met het plan', uit.statistiek.secties === metBlokken.length, `${uit.statistiek.secties} vs ${metBlokken.length}`);

    const pad = path.join(TMP, uit.filename);
    writeFileSync(pad, uit.buffer);

    const onderdelen = leesZip(uit.buffer);
    const doc = onderdelen.get('word/document.xml')?.toString('utf8') ?? '';
    check('geldig ZIP met document.xml', doc.length > 1000, `${doc.length} tekens XML`);

    // De titel van het project moet op het omslag staan.
    const titelKort = String(project.titel || '').slice(0, 22).replace(/&/g, '&amp;');
    check('titel staat in het document', doc.includes(titelKort.slice(0, 14)), titelKort.slice(0, 30));

    // En de eerste paar sectiekoppen moeten erin staan.
    const koppen = metBlokken.slice(0, 5).map((s) => s.titel);
    let gevonden = 0;
    for (const kop of koppen) {
      const deel = String(kop).slice(0, 16).replace(/&/g, '&amp;');
      if (doc.includes(deel)) gevonden += 1;
    }
    check('sectiekoppen staan erin', gevonden >= Math.min(3, koppen.length), `${gevonden} van ${Math.min(5, koppen.length)}`);

    if ((project.bronnen || []).length) {
      check('bronnenlijst aanwezig', doc.includes('Bronnen') || doc.includes('bronnen'), `${project.bronnen.length} bronnen`);
    }

    console.log(`     bestand: ${pad}`);
  } catch (error) {
    check(`Word maken mislukt: ${error.message}`, false, error.stack?.split('\n')[1]?.trim());
  }

  /* ── PowerPoint ───────────────────────────────────────────────────────── */
  console.log('\n4) PowerPoint-bestand maken');
  try {
    const uit = projectNaarPptx(project);
    check('presentatie gemaakt', uit.buffer.length > 5000, `${uit.buffer.length} bytes`);
    const onderdelen = leesZip(uit.buffer);
    const dias = [...onderdelen.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    check('bevat dia\'s', dias.length > 0, `${dias.length} dia's`);
  } catch (error) {
    check(`PowerPoint maken mislukt: ${error.message}`, false);
  }
}

/* ── Opruimen ───────────────────────────────────────────────────────────── */
rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
