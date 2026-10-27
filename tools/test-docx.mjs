#!/usr/bin/env node
/**
 * Test de overgezette documentgeneratoren.
 *
 * Er wordt niets naar buiten gestuurd: we maken een Word- en een
 * PowerPoint-bestand in een tijdelijke map, controleren of het geldige
 * ZIP-bestanden zijn met de juiste onderdelen erin, en ruimen daarna op.
 *
 * Het punt van deze test: als de omzetting van CommonJS naar ES-module iets
 * stuk heeft gemaakt, zie je dat hier en niet pas bij het inleveren.
 *
 *   node tools/test-docx.mjs
 */

import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { bouwDocx, esc, kleur, donkerder } from '../mcp/lib/docx.mjs';
import { bouwPptx } from '../mcp/lib/pptx.mjs';
import { leesZip } from '../mcp/lib/zip.mjs';

const TMP = path.resolve('data/tmp-docx');
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

await mkdir(TMP, { recursive: true });

/*
 * Let op de vorm: bouwDocx verwacht `project.secties` op het HOOGSTE niveau,
 * elk met `{titel, blokken}`. In Krava's opgeslagen projecten zit dat onder
 * `plan.secties`, dus de aanroeper moet dat veld doorgeven — niet het hele
 * plan-object. Dat kostte me een testronde.
 *
 * De blokken gebruiken Engelse veldnamen: `type` (niet `soort`) en `tekst`.
 * Ondersteund: heading, subheading, paragraph, code, callout, table, list,
 * figure, hr.
 *
 * Lijst-items zijn OBJECTEN ({tekst, niveau, genummerd}), geen strings. Gaf je
 * een string, dan crashte het renderen en verdween de hele sectie stil.
 *
 * Een `tekst`-veld met Markdown op een sectie wordt NIET gerenderd: Krava zet
 * Markdown eerder om naar blokken. Hier maken we dus alleen blokken.
 */
const project = {
  id: 'test-1',
  titel: 'Portfolio bewijsstuk — test',
  subtitel: 'Automatisch gemaakt door cavascp',
  auteur: 'Dylan Schuurman',
  instelling: 'Fontys Hogeschool ICT',
  opleiding: 'AI & Data',
  vak: 'V-OL-MAIFS',
  begeleiders: 'K. Suilen',
  datum: new Date().toISOString().slice(0, 10),
  versie: '1.0',
  documenttype: 'verslag',
  taal: 'nl',
  brief: 'Dit document is automatisch gegenereerd om de generator te testen.',
  afbeeldingen: [],
  bronnen: [{ tekst: 'Schuurman, D. (2026). Portfolio bewijsstuk. Fontys Hogeschool ICT.' }],
  secties: [
    {
      titel: 'Inleiding',
      niveau: 1,
      blokken: [
        { type: 'paragraph', tekst: 'Dit is een testalinea met een em-dash — en een pijltje → om te zien of UTF-8 goed gaat.' },
        { type: 'subheading', tekst: 'Een tussenkop', niveau: 2 },
        {
          type: 'list',
          items: [
            { tekst: 'Eerste punt' },
            { tekst: 'Tweede punt met accenten: één, twee, drie' },
            { tekst: 'Een genummerd punt', genummerd: true },
          ],
        },
        { type: 'callout', soort: 'belangrijk', titel: 'Let op', tekst: 'Dit is een callout.' },
        { type: 'code', tekst: 'const x = 1;' },
        { type: 'hr' },
      ],
    },
    {
      titel: 'Bewijs',
      niveau: 1,
      blokken: [{ type: 'paragraph', tekst: 'Tweede sectie met inhoud.' }],
    },
  ],
  huisstijl: { accent: '2E5BA8', logo: null },
  opties: {},
};

const kleuren = { accent: '2E5BA8', kop2: '1F3F7A' };

/* ── 1. Word ────────────────────────────────────────────────────────────── */
console.log('1) Word-document maken');
let docxPad = null;
try {
  /*
   * Let op: bouwDocx geeft geen Buffer maar een object { buffer, statistiek }.
   * De statistiek vertelt hoeveel secties, figuren en bronnen erin zitten —
   * handig om te controleren of alles is meegekomen.
   */
  const uit = bouwDocx(project, { kleuren, labels: { inhoudsopgave: 'Inhoud' } });
  check('bouwDocx geeft een resultaat', Boolean(uit), typeof uit);
  check('resultaat heeft een buffer', Buffer.isBuffer(uit?.buffer), `${uit?.buffer?.length ?? 0} bytes`);
  check('resultaat heeft een statistiek', Boolean(uit?.statistiek), JSON.stringify(uit?.statistiek ?? {}).slice(0, 90));

  const buf = uit.buffer;
  check('begint met ZIP-handtekening', buf.subarray(0, 4).toString('hex') === '504b0304', buf.subarray(0, 4).toString('hex'));
  check('eindigt met ZIP-einde', buf.subarray(-22, -18).toString('hex') === '504b0506');

  docxPad = path.join(TMP, 'test.docx');
  await writeFile(docxPad, buf);

  const onderdelen = leesZip(buf);
  const namen = [...onderdelen.keys()].sort();
  console.log(`     onderdelen (${namen.length}):`);
  for (const n of namen.slice(0, 14)) console.log(`       ${n}  (${onderdelen.get(n).length} b)`);

  check('bevat [Content_Types].xml', onderdelen.has('[Content_Types].xml'));
  check('bevat word/document.xml', onderdelen.has('word/document.xml'));
  check('bevat _rels/.rels', onderdelen.has('_rels/.rels'));

  const doc = onderdelen.get('word/document.xml')?.toString('utf8') ?? '';
  check('titel staat erin', doc.includes('Portfolio bewijsstuk'), doc.includes('Portfolio bewijsstuk') ? '' : 'niet gevonden');
  check('auteursnaam staat erin', doc.includes('Dylan Schuurman'));
  check('sectiekop staat erin', doc.includes('Inleiding'));
  check('tweede sectiekop staat erin', doc.includes('Bewijs'));
  check('tussenkop staat erin', doc.includes('Een tussenkop'));
  check('callout staat erin', doc.includes('Dit is een callout'));
  check('lijstitem staat erin', doc.includes('Eerste punt'));
  check('codeblok staat erin', doc.includes('const x = 1'), 'code');
  check('bronnenlijst staat erin', doc.includes('Fontys Hogeschool ICT'), 'bron');
  // UTF-8: accenten en leestekens moeten als echte tekens in de XML staan.
  check('UTF-8 tekens intact (é)', doc.includes('één') || doc.includes('&eacute;'), 'accenten');
  check('em-dash intact', doc.includes('—') || doc.includes('&#8212;'));
  check('pijltje intact', doc.includes('→') || doc.includes('&#8594;'));
  check('XML is niet leeg', doc.length > 3000, `${doc.length} tekens`);
} catch (error) {
  check(`Word maken mislukt: ${error.message}`, false, error.stack?.split('\n')[1]?.trim());
}

/* ── 2. PowerPoint ──────────────────────────────────────────────────────── */
console.log('\n2) PowerPoint maken');
try {
  const uit = bouwPptx(project, { kleuren, labels: {} });
  const buf = uit?.buffer ?? uit;
  check('bouwPptx geeft een resultaat', Boolean(uit), uit?.constructor?.name);
  check('resultaat heeft een buffer', Buffer.isBuffer(buf), `${buf?.length ?? 0} bytes`);
  check('begint met ZIP-handtekening', buf.subarray(0, 4).toString('hex') === '504b0304');

  await writeFile(path.join(TMP, 'test.pptx'), buf);
  const onderdelen = leesZip(buf);
  const namen = [...onderdelen.keys()].sort();
  check('bevat ppt/presentation.xml', namen.some((n) => n.startsWith('ppt/presentation.xml')), `${namen.length} onderdelen`);
  check('bevat minstens één dia', namen.some((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)), namen.filter((n) => n.includes('slides/slide')).join(', '));
} catch (error) {
  check(`PowerPoint maken mislukt: ${error.message}`, false, error.stack?.split('\n')[1]?.trim());
}

/* ── 3. Hulpjes ─────────────────────────────────────────────────────────── */
console.log('\n3) Hulpjes');
check('kleur() maakt een hexkleur', /^[0-9A-F]{6}$/i.test(kleur('2E5BA8', '000000')), kleur('2E5BA8', '000000'));
check('kleur() valt terug op standaard', kleur(null, 'AABBCC') === 'AABBCC', kleur(null, 'AABBCC'));
check('kleur() accepteert #-prefix', kleur('#2E5BA8', '000000') === '2E5BA8', kleur('#2E5BA8', '000000'));
check('donkerder() maakt donkerder', donkerder('808080') !== '808080', `${donkerder('808080')}`);
check('esc() ontsnapt XML', esc('<b>&"x"</b>') === '&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;', esc('<b>&"x"</b>'));

/* ── Opruimen ───────────────────────────────────────────────────────────── */
await rm(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
