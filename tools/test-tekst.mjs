#!/usr/bin/env node
/**
 * Test het lezen van tekst uit documenten.
 *
 * De document-inbox bewaart bestanden; de indeler heeft tekst nodig. Als dit
 * stil misgaat, krijgt de indeler een lege tekst en kiest hij de verkeerde map —
 * zonder dat er iets klaagt. Daarom testen we het expliciet, inclusief de
 * gevallen die we NIET kunnen lezen.
 *
 *   node tools/test-tekst.mjs
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tekstUitBestand } from '../mcp/lib/tekst.mjs';
import { bouwDocx } from '../mcp/lib/docx.mjs';
import { maakZip } from '../mcp/lib/zip.mjs';

const TMP = path.resolve('data/tmp-tekst');
mkdirSync(TMP, { recursive: true });

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/* ── Een echt Word-bestand ──────────────────────────────────────────────── */

console.log('1) Word-bestand lezen');
{
  const doc = {
    titel: 'Data-analyse verslag',
    auteur: 'Dylan Schuurman',
    secties: [
      {
        titel: 'Inleiding',
        niveau: 1,
        blokken: [
          { type: 'paragraph', tekst: 'Ik heb de dataset opgeschoond en gevalideerd op volledigheid.' },
          { type: 'paragraph', tekst: 'Daarna heb ik het model getraind en getest op een testset.' },
        ],
      },
      {
        titel: 'Resultaten',
        niveau: 1,
        blokken: [{ type: 'paragraph', tekst: 'De accuracy op de testset was 0,87.' }],
      },
    ],
  };
  const uit = bouwDocx(doc, { kleuren: {}, labels: {} });
  const pad = path.join(TMP, 'test.docx');
  writeFileSync(pad, uit.buffer);

  const gelezen = tekstUitBestand(pad);
  check('het lezen lukt', gelezen.gelukt, gelezen.reden ?? '');
  check('het soort is docx', gelezen.soort === 'docx', gelezen.soort);
  check('er is tekst', gelezen.tekens > 100, `${gelezen.tekens} tekens`);
  check('de titel staat erin', gelezen.tekst.includes('Data-analyse verslag'));
  check('de eerste alinea staat erin', gelezen.tekst.includes('dataset opgeschoond en gevalideerd'));
  check('de tweede alinea staat erin', gelezen.tekst.includes('model getraind en getest'));
  check('de sectiekop staat erin', gelezen.tekst.includes('Resultaten'));
  check('accenten blijven heel', gelezen.tekst.includes('0,87'), 'komma in het getal');
  check(
    'alinea\'s staan op eigen regels',
    gelezen.tekst.split('\n').length > 4,
    `${gelezen.tekst.split('\n').length} regels`,
  );
  check('geen XML meer over', !/<[a-z]/i.test(gelezen.tekst), gelezen.tekst.slice(0, 60));
}

/* ── PowerPoint ─────────────────────────────────────────────────────────── */

console.log('\n2) PowerPoint lezen');
{
  const { bouwPptx } = await import('../mcp/lib/pptx.mjs');
  const doc = {
    titel: 'Presentatie',
    secties: [{ titel: 'Kop', niveau: 1, blokken: [{ type: 'paragraph', tekst: 'Een dia met tekst erin.' }] }],
  };
  try {
    const uit = bouwPptx(doc, { kleuren: {}, labels: {} });
    const pad = path.join(TMP, 'test.pptx');
    writeFileSync(pad, uit.buffer);
    const gelezen = tekstUitBestand(pad);
    check('het soort is pptx', gelezen.soort === 'pptx', gelezen.soort);
    // PowerPoint zonder notities heeft geen tekst om te lezen; dat is geen fout.
    check(
      'levert een uitkomst zonder te crashen',
      typeof gelezen.gelukt === 'boolean',
      gelezen.gelukt ? `${gelezen.tekens} tekens` : gelezen.reden ?? '',
    );
  } catch (error) {
    check(`PowerPoint lezen crasht niet: ${error.message}`, false);
  }
}

/* ── Platte tekst ───────────────────────────────────────────────────────── */

console.log('\n3) Platte tekst');
{
  const pad = path.join(TMP, 'notitie.md');
  writeFileSync(pad, '# Kop\n\nEen stuk tekst over datakwaliteit en validatie.\n', 'utf8');
  const gelezen = tekstUitBestand(pad);
  check('markdown wordt gelezen', gelezen.gelukt && gelezen.tekens > 20, `${gelezen.tekens} tekens`);
  check('de inhoud klopt', gelezen.tekst.includes('datakwaliteit'));

  const csv = path.join(TMP, 'data.csv');
  writeFileSync(csv, 'naam,waarde\na,1\nb,2\n', 'utf8');
  const gelezenCsv = tekstUitBestand(csv);
  check('csv wordt gelezen', gelezenCsv.gelukt && gelezenCsv.tekst.includes('naam,waarde'));
}

/* ── Wat we niet kunnen lezen ───────────────────────────────────────────── */

console.log('\n4) Wat we niet kunnen lezen zeggen we eerlijk');
{
  /*
   * Dit is het belangrijkste deel. Een lege tekst teruggeven zonder uitleg
   * betekent dat de indeler de verkeerde map kiest en niemand weet waarom.
   */
  const pdf = path.join(TMP, 'iets.pdf');
  writeFileSync(pdf, '%PDF-1.4 geen echte pdf', 'utf8');
  const gelezenPdf = tekstUitBestand(pdf);
  check('PDF wordt niet gelezen', !gelezenPdf.gelukt);
  check('met een leesbare reden', /PDF kan niet gelezen/i.test(gelezenPdf.reden ?? ''), gelezenPdf.reden ?? '(geen reden)');

  const png = path.join(TMP, 'scherm.png');
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const gelezenPng = tekstUitBestand(png);
  check('een afbeelding wordt niet gelezen', !gelezenPng.gelukt);
  check('en verwijst naar Krava', /Krava/i.test(gelezenPng.reden ?? ''), gelezenPng.reden ?? '(geen reden)');

  const weg = tekstUitBestand(path.join(TMP, 'bestaat-niet.docx'));
  check('een ontbrekend bestand geeft een reden', !weg.gelukt && Boolean(weg.reden), weg.reden ?? '');

  /* Een ZIP die geen Word is: geen crash, wel een nette melding. */
  const nep = path.join(TMP, 'nep.docx');
  writeFileSync(nep, maakZip([{ naam: 'iets.txt', data: 'geen word' }]));
  const gelezenNep = tekstUitBestand(nep);
  check('een docx zonder document.xml geeft een reden', !gelezenNep.gelukt && Boolean(gelezenNep.reden), gelezenNep.reden ?? '');

  /* Een kapot bestand mag nooit een uitzondering geven. */
  const kapot = path.join(TMP, 'kapot.docx');
  writeFileSync(kapot, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0xff]));
  let crash = null;
  try {
    tekstUitBestand(kapot);
  } catch (error) {
    crash = error.message;
  }
  check('een kapot bestand crasht niet', crash === null, crash ?? 'geen uitzondering');
}

/* ── De tekst is bruikbaar voor de indeler ──────────────────────────────── */

console.log('\n5) De tekst is bruikbaar voor de indeler');
{
  const doc = {
    titel: 'Reflectieverslag',
    secties: [
      {
        titel: 'Reflectie',
        niveau: 1,
        blokken: [
          {
            type: 'paragraph',
            tekst:
              'Terugkijkend zie ik dat ik sterk ben in analyseren, maar te lang doorwerk zonder hulp te vragen. ' +
              'Mijn kernwaarden zijn nieuwsgierigheid en betrouwbaarheid. Ik heb leerdoelen opgesteld voor mijn groei.',
          },
        ],
      },
    ],
  };
  const uit = bouwDocx(doc, { kleuren: {}, labels: {} });
  const pad = path.join(TMP, 'reflectie.docx');
  writeFileSync(pad, uit.buffer);

  const gelezen = tekstUitBestand(pad);
  const { bepaalMap } = await import('../mcp/lib/indeler.mjs');
  const voorstel = bepaalMap({
    titel: 'Reflectieverslag',
    tekst: gelezen.tekst,
    mappen: [
      { naam: 'orientatie', id: 1, gedekt: ['LO1', 'LO2', 'LO3'], bewijs: [{ id: 1 }] },
      { naam: 'klantproject', id: 2, gedekt: ['LO1', 'LO4'], bewijs: [{ id: 2 }] },
      { naam: 'Persoonlijk project', id: 3, gedekt: [], bewijs: [] },
    ],
  });
  check('de indeler kan met de gelezen tekst werken', voorstel.voorstel !== null, voorstel.voorstel?.mapNaam ?? 'niets');
  check(
    'en kiest de map die erbij hoort',
    voorstel.voorstel?.mapNaam === 'Persoonlijk project',
    voorstel.voorstel?.mapNaam ?? 'niets',
  );
}

/* ── Opmaakrommel uit een Word-export ───────────────────────────────────── */

console.log('\n6) Opmaakrommel komt niet in de toelichting');
{
  /*
   * Dit ging echt mis: de voorgestelde toelichting eindigde op
   * `TOC \o "1-3" \h \z \u` — het veld van de inhoudsopgave dat wij zelf in het
   * Word-bestand zetten. Dat leest als een foutmelding in je portfolio.
   */
  const { stelBeschrijvingVoor } = await import('../mcp/lib/indeler.mjs');
  const { zonderOpmaakrommel } = await import('../dashboard/lib/documenten.mjs');

  const metRommel = [
    'Inhoudsopgave',
    'TOC \\o "1-3" \\h \\z \\u',
    'Vernieuw de inhoudsopgave in Word met F9 of rechtsklik > Velden bijwerken.',
    'Auteur: Dylan Schuurman',
    'Datum: 9 oktober 2026',
    '',
    'Ik heb de dataset opgeschoond en gevalideerd op volledigheid. Er zaten ontbrekende waarden in drie kolommen.',
  ].join('\n');

  const schoon = zonderOpmaakrommel(metRommel);
  check('de inhoudsopgave is weg', !/inhoudsopgave/i.test(schoon), schoon.slice(0, 50));
  check('het TOC-veld is weg', !/TOC/.test(schoon), schoon.slice(0, 50));
  check('de auteurregel is weg', !/Auteur:/i.test(schoon));
  check('de echte inhoud blijft', /dataset opgeschoond/.test(schoon), schoon.slice(0, 60));

  const voorstel = stelBeschrijvingVoor({
    titel: 'Data-analyse_dataset.docx',
    mapNaam: 'orientatie',
    leeruitkomsten: ['LO2'],
    tekst: metRommel,
  });
  check('de toelichting bevat geen TOC-veld', !/TOC/.test(voorstel), voorstel.slice(-80));
  check('de toelichting bevat geen inhoudsopgave', !/inhoudsopgave/i.test(voorstel));
  check('de toelichting heeft echte inhoud', /dataset opgeschoond/.test(voorstel), voorstel.slice(-90));
  check('de titel is netjes', voorstel.startsWith('Data-analyse dataset.'), voorstel.slice(0, 40));
}

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
