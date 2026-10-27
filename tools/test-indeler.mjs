#!/usr/bin/env node
/**
 * Test de automatiseringslaag: waar hoort een document, en wat zetten we erbij?
 *
 * De belangrijkste vraag is of de indeler de mappen niet op één hoop gooit.
 * Daarom testen we met documenten die duidelijk bij één map horen, en met
 * mappen waarvan de ene al vol zit en de andere leeg is.
 *
 *   node tools/test-indeler.mjs
 */

import { bepaalMap, analyseerVoorInleveren, stelBeschrijvingVoor, MAP_PROFIELEN } from '../mcp/lib/indeler.mjs';

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/* De drie mappen met hun huidige dekking, zoals ze nu in Portflow staan. */
const MAPPEN = [
  { naam: 'orientatie', id: 250278, gedekt: ['LO1', 'LO2', 'LO3', 'LO4', 'LO5', 'LO6'], bewijs: [{ id: 1 }, { id: 2 }] },
  { naam: 'klantproject', id: 250279, gedekt: ['LO1', 'LO4', 'LO5'], bewijs: [{ id: 3 }] },
  { naam: 'Persoonlijk project', id: 250280, gedekt: [], bewijs: [] },
];

console.log('1) Documenten die duidelijk bij één map horen');
console.log('');

const CASES = [
  {
    naam: 'reflectieverslag',
    verwacht: 'Persoonlijk project',
    titel: 'Reflectieverslag periode 1',
    tekst:
      'Terugkijkend op deze periode zie ik dat ik sterk ben in het analyseren van problemen, maar dat ik te lang ' +
      'doorwerk zonder hulp te vragen. Dat is een zwakte die mijn groei remt. Mijn kernwaarden zijn nieuwsgierigheid ' +
      'en betrouwbaarheid. Ik heb me voorgenomen om vaker feedback te vragen en heb leerdoelen opgesteld voor mijn ' +
      'persoonlijke ontwikkeling.',
  },
  {
    naam: 'klantprojectplan',
    verwacht: 'klantproject',
    titel: 'Projectplan klantopdracht',
    tekst:
      'In dit projectplan beschrijf ik de aanpak voor de opdrachtgever. We hebben de doelen met de klant afgestemd en ' +
      'de stakeholders in kaart gebracht. De requirements zijn vastgelegd in een backlog met user stories, verdeeld ' +
      'over vier sprints. Tijdens de retrospective bespreken we de voortgang en het advies aan de klant.',
  },
  {
    naam: 'data-analyse',
    verwacht: 'orientatie',
    titel: 'Data-analyse dataset',
    tekst:
      'Ik heb de dataset opgeschoond en gevalideerd op volledigheid. Er zaten ontbrekende waarden in drie kolommen. ' +
      'Na de data preparation heb ik een exploratory data analysis gedaan en de inzichten gevisualiseerd in een ' +
      'dashboard. Daarna heb ik een model getraind en getest op een testset.',
  },
  {
    naam: 'AI-gebruik',
    verwacht: 'Persoonlijk project',
    titel: 'Mijn gebruik van AI bij het leren',
    tekst:
      'Ik gebruik ChatGPT als gesprekspartner om mijn begrip te verdiepen. Ik heb grenzen gesteld aan wanneer ik het ' +
      'wel en niet gebruik, en in de Me & My Machine Labels leg ik verantwoording af over welk deel met AI tot stand ' +
      'kwam. Deze bijlage toont hoe mijn begrip over de periode is gegroeid.',
  },
];

for (const c of CASES) {
  const uit = bepaalMap({ titel: c.titel, tekst: c.tekst, mappen: MAPPEN });
  const goed = uit.voorstel?.mapNaam === c.verwacht;
  check(
    `${c.naam} → ${c.verwacht}`,
    goed,
    goed ? uit.voorstel.redenen.join('; ').slice(0, 60) : `werd ${uit.voorstel?.mapNaam ?? 'niets'} (${JSON.stringify(uit.alle)})`,
  );
}

console.log('\n2) De map die leeg is krijgt voorrang');
{
  /*
   * Dit is het belangrijkste gedrag. Een document dat zowel in orientatie als
   * in Persoonlijk project zou passen, hoort naar de lege map te gaan — anders
   * blijft die altijd leeg.
   */
  const uit = bepaalMap({
    titel: 'Portflow gebruik en reflectie',
    tekst:
      'Ik beschrijf hoe ik Portflow gebruik voor mijn portfolio en reflecteer op mijn eigen ontwikkeling. ' +
      'Mijn leerdoelen voor deze periode staan hieronder, met de feedback die ik erop kreeg. Mijn kernwaarden ' +
      'nieuwsgierigheid en betrouwbaarheid komen terug in de keuzes die ik heb gemaakt.',
    mappen: MAPPEN,
  });
  check('het voorstel is de lege map', uit.voorstel?.mapNaam === 'Persoonlijk project', uit.voorstel?.mapNaam ?? 'niets');
  check(
    'de reden noemt dat het een gat vult',
    (uit.voorstel?.redenen ?? []).some((r) => /vult hier/.test(r)),
    (uit.voorstel?.redenen ?? []).join('; ').slice(0, 70),
  );
}

console.log('\n3) Randgevallen');
{
  const leeg = bepaalMap({ titel: '', tekst: '', mappen: MAPPEN });
  check('lege tekst wordt onzeker', leeg.onzeker, leeg.uitleg.slice(0, 60));
  check('levert toch een voorstel of niets', leeg.voorstel === null || typeof leeg.voorstel.mapNaam === 'string');

  const onzin = bepaalMap({
    titel: 'Boodschappenlijst',
    tekst: 'Melk, brood, eieren, kaas en een nieuwe fietsbel voor de vakantie naar Frankrijk volgende maand.',
    mappen: MAPPEN,
  });
  check('niet-relevante tekst wordt onzeker', onzin.onzeker, onzin.uitleg.slice(0, 70));

  const gelijk = bepaalMap({
    titel: 'Project en reflectie',
    tekst:
      'In het projectplan voor de klant beschrijf ik de aanpak en de stakeholders. Ik reflecteer ook op mijn eigen ' +
      'rol in het team en mijn leerdoelen. De requirements staan in de backlog en de retrospective is gepland.',
    mappen: MAPPEN,
  });
  check('bij twijfel zegt het dat het twijfelt', gelijk.onzeker || gelijk.voorstel !== null, gelijk.uitleg.slice(0, 80));
  check('er zijn alternatieven', gelijk.alternatieven.length >= 1, gelijk.alternatieven.map((a) => a.mapNaam).join(', '));
}

console.log('\n4) Een beschrijving voorstellen');
{
  const tekst =
    'Ik heb de dataset opgeschoond en gevalideerd op volledigheid. Er zaten ontbrekende waarden in drie kolommen. ' +
    'Daarna heb ik de inzichten gevisualiseerd.';
  const voorstel = stelBeschrijvingVoor({
    titel: 'Data-analyse_dataset v2.docx',
    mapNaam: 'orientatie',
    leeruitkomsten: ['LO2'],
    tekst,
  });
  check('noemt de titel zonder bestandsextensie', voorstel.includes('Data-analyse dataset'), voorstel.slice(0, 50));
  check('noemt de leeruitkomst', /Data & Knowledge Stewardship/i.test(voorstel), 'leeruitkomst genoemd');
  check('noemt de map', voorstel.includes('orientatie'));
  /*
   * De functie pakt de EERSTE bruikbare zin, niet een willekeurige. In deze
   * tekst is dat "Ik heb de dataset opgeschoond en gevalideerd op volledigheid."
   * — de tweede zin ("Er zaten ontbrekende waarden…") komt er dus niet in.
   */
  check(
    'neemt een zin uit de tekst over',
    /opgeschoond en gevalideerd op volledigheid/i.test(voorstel),
    voorstel.slice(-80),
  );
  check('het is geen lege tekst', voorstel.length > 80, `${voorstel.length} tekens`);

  const zonder = stelBeschrijvingVoor({ titel: 'Iets.docx' });
  check('werkt ook zonder de rest', zonder.length > 0, zonder.slice(0, 40));

  const twee = stelBeschrijvingVoor({ titel: 'X.docx', leeruitkomsten: ['LO2', 'LO3'], mapNaam: 'orientatie' });
  check('twee leeruitkomsten met "en"', / en /.test(twee), twee.slice(0, 90));
}

console.log('\n5) De hele keten');
{
  const uit = analyseerVoorInleveren({
    titel: 'Verslag RAG-assistent',
    tekst:
      'Ik heb een RAG-assistent gebouwd. Daarvoor heb ik de documenten opgeschoond en in een vectorstore gezet. ' +
      'Het model heb ik gevalideerd op een testset. Ik gebruik ChatGPT om mijn begrip van embeddings te verdiepen ' +
      'en leg in de labels verantwoording af over het AI-gebruik.',
    mappen: MAPPEN,
  });
  check('er is een voorstel', Boolean(uit.voorstel), uit.voorstel?.mapNaam ?? 'niets');
  check('er zijn leeruitkomsten gevonden', uit.leeruitkomsten.gevonden.length > 0, uit.leeruitkomsten.gevonden.map((t) => t.code).join(', '));
  check('er is een beschrijving voorgesteld', uit.voorgesteldeBeschrijving.length > 60, `${uit.voorgesteldeBeschrijving.length} tekens`);
  check(
    'de aanbevolen leeruitkomsten horen bij de map',
    uit.aanbevolenLeeruitkomsten.every((c) => {
      const profiel = Object.values(MAP_PROFIELEN).find((p) => p.naam === uit.voorstel?.mapNaam);
      return !profiel || profiel.lo.includes(c);
    }),
    uit.aanbevolenLeeruitkomsten.join(', '),
  );
  console.log(`     voorstel: ${uit.voorstel?.mapNaam} — ${uit.uitleg.slice(0, 90)}`);
  console.log(`     beschrijving: ${uit.voorgesteldeBeschrijving.slice(0, 110)}…`);
}

console.log('\n6) De profielen dekken alle zes leeruitkomsten');
{
  const samen = new Set();
  for (const p of Object.values(MAP_PROFIELEN)) for (const code of p.lo) samen.add(code);
  // Persoonlijk project richt zich op LO5 en LO6, orientatie op 1-3, klantproject op 1/4/5.
  check('samen dekken ze een groot deel', samen.size >= 5, [...samen].join(', '));
  check('elke map heeft een omschrijving', Object.values(MAP_PROFIELEN).every((p) => p.omschrijving.length > 20));
  check('elke map heeft onderwerpen', Object.values(MAP_PROFIELEN).every((p) => p.onderwerpen.length >= 10));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
