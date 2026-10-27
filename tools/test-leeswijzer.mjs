#!/usr/bin/env node
/**
 * Test de leeswijzer-generator.
 *
 * Deel 1 is puur: verzonnen bewijs met een bekend antwoord. Daar controleren we
 * de opbouw en vooral of ontbrekende leeruitkomsten eerlijk genoemd worden.
 *
 * Deel 2 haalt het echte bewijs uit Portflow en laat zien wat de generator van
 * je eigen mappen maakt.
 *
 *   node tools/test-leeswijzer.mjs
 *   node tools/test-leeswijzer.mjs --live     # ook je echte mappen
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { maakLeeswijzer, leeswijzerAlsDocument, leeruitkomstVoorGoalId, nlDatum } from '../mcp/lib/leeswijzer.mjs';
import { LEERUITKOMSTEN, portflowGoalIdVoor } from '../mcp/lib/leeruitkomsten.mjs';
import { projectNaarDocx } from '../mcp/lib/assemble.mjs';

const LIVE = process.argv.includes('--live');
const TMP = path.resolve('data/tmp-leeswijzer');

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const goal = (code) => portflowGoalIdVoor(code);

/* ── DEEL 1: met een bekend antwoord ────────────────────────────────────── */

console.log('1) Datums en koppelingen');
check('datum in het Nederlands', nlDatum('2026-10-08T12:00:00Z') === '8 oktober 2026', nlDatum('2026-10-08T12:00:00Z'));
check('lege datum blijft leeg', nlDatum(null) === null);
check('onzin-datum crasht niet', nlDatum('geen datum') === null);

check('LO1 herkent zijn doel', leeruitkomstVoorGoalId(goal('LO1'))?.code === 'LO1');
check('LO4 herkent zijn doel', leeruitkomstVoorGoalId(goal('LO4'))?.code === 'LO4');
check(
  'een doel van een ouder semester wordt NIET herkend',
  leeruitkomstVoorGoalId(268558) === null,
  '268558 is "Leeruitkomst 1: Professional standard" van een ander semester',
);
check('onbekend doel geeft null', leeruitkomstVoorGoalId(999999) === null);

console.log('\n2) Een leeswijzer met twee leeruitkomsten gedekt');
{
  const bewijs = [
    { id: 1, naam: 'Data-analyse dataset.docx', gemaakt: '2026-10-01T10:00:00Z', goalIds: [goal('LO2')], beschrijving: 'Opschonen en valideren van de dataset.' },
    { id: 2, naam: 'Model validatie.docx', gemaakt: '2026-10-05T10:00:00Z', goalIds: [goal('LO2'), goal('LO3')], beschrijving: 'Trainen en valideren van het model.' },
    { id: 3, naam: 'Privacy-analyse.docx', gemaakt: '2026-10-07T10:00:00Z', goalIds: [goal('LO1')], beschrijving: null },
  ];
  const r = maakLeeswijzer({ mapNaam: 'orientatie', mapId: 250278, bewijs });

  check('het is Markdown met koppen', r.markdown.includes('## Wat zit hier'), 'koppen aanwezig');
  check('de titel klopt', r.markdown.startsWith('# Leeswijzer — orientatie'), r.markdown.split('\n')[0]);
  check('alle drie de stukken staan erin', ['Data-analyse', 'Model validatie', 'Privacy-analyse'].every((n) => r.markdown.includes(n)));
  check('drie leeruitkomsten gedekt', r.gedekt.length === 3, r.gedekt.join(', '));
  check('drie leeruitkomsten ontbreken', r.ontbrekend.length === 3, r.ontbrekend.join(', '));
  check('LO4 wordt als ontbrekend genoemd', r.ontbrekend.includes('LO4'), r.ontbrekend.join(', '));
  check('er staat een sectie over wat er mist', r.markdown.includes('## Wat er nog niet is'));
  check(
    'het ontbrekende wordt expliciet benoemd',
    r.markdown.includes('LO4') && /nog geen bewijs/i.test(r.markdown),
    'eerlijk over de gaten',
  );
  check('nieuwste eerst in de lijst', r.markdown.indexOf('Privacy-analyse') < r.markdown.indexOf('Data-analyse'));
  check('statistiek klopt', r.statistiek.bewijsstukken === 3 && r.statistiek.gedekt === 3 && r.statistiek.ontbrekend === 3, JSON.stringify(r.statistiek.perLeeruitkomst));
  check('een stuk zonder beschrijving wordt geteld', r.statistiek.zonderBeschrijving === 1, `${r.statistiek.zonderBeschrijving}`);
  check(
    'de officiële tekst van de leeruitkomst staat erbij',
    r.markdown.includes('sourcing, analysing'),
    'docent ziet waar het over gaat',
  );
}

console.log('\n3) Een lege map');
{
  const r = maakLeeswijzer({ mapNaam: 'klantproject', bewijs: [] });
  check('zegt dat de map leeg is', /nog leeg/i.test(r.markdown), 'eerlijk');
  check('alle zes ontbreken', r.ontbrekend.length === 6, r.ontbrekend.join(', '));
  check('crasht niet op een lege map', r.statistiek.bewijsstukken === 0);
}

console.log('\n4) Bewijs zonder leeruitkomst');
{
  const bewijs = [{ id: 9, naam: 'Los bestand.pdf', gemaakt: '2026-10-08T10:00:00Z', goalIds: [] }];
  const r = maakLeeswijzer({ mapNaam: 'test', bewijs });
  check('het stuk staat er wel in', r.markdown.includes('Los bestand.pdf'));
  check('maar dekt niets', r.gedekt.length === 0, r.gedekt.join(', '));
  check('wordt geteld als zonder doel', r.statistiek.zonderDoel === 1, `${r.statistiek.zonderDoel}`);
}

console.log('\n5) Van leeswijzer naar Word');
{
  mkdirSync(TMP, { recursive: true });
  const bewijs = [
    { id: 1, naam: 'Data-analyse dataset.docx', gemaakt: '2026-10-01T10:00:00Z', goalIds: [goal('LO2')], beschrijving: 'Opschonen en valideren van de dataset.' },
    { id: 2, naam: 'Model validatie.docx', gemaakt: '2026-10-05T10:00:00Z', goalIds: [goal('LO3')], beschrijving: 'Trainen en valideren van het model.' },
  ];
  const r = maakLeeswijzer({ mapNaam: 'orientatie', mapId: 250278, bewijs, vak: 'V-OL-MAIFS', auteur: 'Dylan Schuurman' });
  const document = leeswijzerAlsDocument({
    markdown: r.markdown,
    titel: 'Leeswijzer — orientatie',
    auteur: 'Dylan Schuurman',
    vak: 'V-OL-MAIFS',
  });

  check('document heeft één sectie', document.plan.secties.length === 1);
  check('de Markdown zit in de sectie', document.plan.secties[0].tekst.includes('## Wat zit hier'));

  try {
    const doc = projectNaarDocx(document);
    check('Word-bestand gemaakt', doc.buffer.length > 8000, `${doc.buffer.length} bytes`);
    const pad = path.join(TMP, doc.filename);
    writeFileSync(pad, doc.buffer);
    check('bestandsnaam klopt', doc.filename.includes('Leeswijzer'), doc.filename);
  } catch (error) {
    check(`Word maken mislukt: ${error.message}`, false);
  }
}

/* ── DEEL 2: je echte mappen ────────────────────────────────────────────── */

if (LIVE) {
  console.log('\n6) Je echte mappen in Portflow');
  const { CONFIG } = await import('../browser/config.mjs');
  const { Portflow } = await import('../browser/portflow.mjs');
  const { chromium } = await import(CONFIG.playwrightUrl);

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
    const { leeswijzersVoorSemester } = await import('../mcp/lib/leeswijzer.mjs');
    const uit = await leeswijzersVoorSemester(pf, { log: (m) => console.log(`     ${m}`) });

    console.log('');
    for (const item of uit) {
      if (item.fout) {
        console.log(`   ${item.map.naam}: FOUT — ${item.fout}`);
        continue;
      }
      const s = item.leeswijzer.statistiek;
      console.log(`   ${item.map.naam} (${item.map.portflowCollectionId})`);
      console.log(`      ${s.bewijsstukken} bewijsstukken · ${s.gedekt} leeruitkomsten gedekt · ${s.ontbrekend} nog leeg`);
      if (item.leeswijzer.gedekt.length) console.log(`      gedekt: ${item.leeswijzer.gedekt.join(', ')}`);
      if (item.leeswijzer.ontbrekend.length) console.log(`      leeg:   ${item.leeswijzer.ontbrekend.join(', ')}`);
      if (!item.bewijs.length) console.log('      (deze map is nog leeg)');
      console.log('');
    }

    check('leeswijzers gemaakt voor alle drie de mappen', uit.length === 3, `${uit.length}`);
    check('geen fouten', uit.every((u) => !u.fout));
    check(
      'elke leeswijzer heeft Markdown',
      uit.every((u) => !u.leeswijzer || u.leeswijzer.markdown.length > 300),
    );
  } catch (error) {
    check(`live mislukt: ${error.message}`, false);
  } finally {
    await context.close().catch(() => {});
  }
}

rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
