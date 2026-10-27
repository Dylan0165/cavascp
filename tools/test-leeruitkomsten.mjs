#!/usr/bin/env node
/**
 * Test de leeruitkomst-check én de koppeling naar Portflow-doelen.
 *
 * Twee dingen die los kunnen breken:
 *
 *   1. DE CHECK — valt een document onder de juiste leeruitkomst?
 *   2. DE KOPPELING — en welk Portflow-doel hoort daarbij?
 *
 * Punt 2 is het gevaarlijkste. Portflow heeft 22 doelen in vier families, en
 * "Professional Standard" bestaat vier keer. Een verkeerde koppeling zet je
 * bewijs aan het doel van een vorig semester, en dat zie je pas bij de review.
 * Daarom testen we expliciet dat LO4 en LO5 aan de juiste id's hangen.
 *
 *   node tools/test-leeruitkomsten.mjs
 */

import { existsSync } from 'node:fs';
import { ENV_PAD, inData, inProject } from '../mcp/lib/paden.mjs';
import {
  checkLeeruitkomsten,
  checkDocument,
  checkVoorMap,
  leesKoppeling,
  portflowGoalIdVoor,
  semesterMappen,
  naarPortflowGoalIds,
  LEERUITKOMSTEN,
} from '../mcp/lib/leeruitkomsten.mjs';

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/* ── DEEL 1: de check, met cases die een bekend antwoord hebben ─────────── */

console.log('1) Cases met een bekend antwoord');
console.log('');

const CASES = [
  {
    naam: 'privacy-analyse van een AI-systeem',
    verwacht: 'LO1',
    tekst: `
      In dit hoofdstuk analyseer ik de maatschappelijke impact van het
      voorgestelde AI-systeem. De AVG en de AI Act stellen eisen aan het
      verwerken van persoonsgegevens. Ik weeg de ethische gevolgen af tegen het
      belang van de organisatie en betrek daarbij de duurzaamheid van de
      gekozen oplossing. Vooral de gevolgen voor burgers die niet digitaal
      vaardig zijn, vragen aandacht. Ik reflecteer op mijn eigen rol hierin.
    `,
  },
  {
    naam: 'dataopschoning en visualisatie',
    verwacht: 'LO2',
    tekst: `
      De dataset bevatte 12.000 rijen met ontbrekende waarden in drie kolommen.
      Ik heb de data opgeschoond: duplicaten verwijderd, datums genormaliseerd
      en uitschieters gecontroleerd. Daarna heb ik de datakwaliteit gevalideerd
      op volledigheid en consistentie. De exploratory data analysis laat zien
      dat de verdeling scheef is. In het dashboard zijn de inzichten per regio
      te bekijken.
    `,
  },
  {
    naam: 'model trainen en uitrollen',
    verwacht: 'LO3',
    tekst: `
      Ik heb een machine learning model getraind op de voorbewerkte data. Het
      neural network bestaat uit drie verborgen lagen. Tijdens de validatie
      bleek de accuracy op de testset 0,87. Daarna heb ik het model
      geïntegreerd in de bestaande pipeline en uitgerold naar productie. De
      security-eisen en privacy-vereisten zijn hierbij meegenomen.
    `,
  },
  {
    naam: 'projectplan en stakeholders',
    verwacht: 'LO4',
    tekst: `
      In het projectplan beschrijf ik de aanpak volgens CRISP-DM. We hebben de
      doelen met de opdrachtgever afgestemd en de stakeholders in kaart
      gebracht. De requirements zijn vastgelegd in een backlog met user stories,
      verdeeld over vier sprints. Tijdens de retrospective bespreken we de
      voortgang. Het advies aan de klant volgt na de analyse.
    `,
  },
  {
    naam: 'persoonlijke reflectie',
    verwacht: 'LO5',
    tekst: `
      Terugkijkend op deze periode zie ik dat ik sterk ben in het analyseren van
      problemen, maar dat ik te lang doorwerk zonder hulp te vragen. Dat is een
      zwakte die mijn groei remt. Mijn kernwaarden zijn nieuwsgierigheid en
      betrouwbaarheid. Ik heb me voorgenomen om vaker feedback te vragen. Dit
      reflectieverslag beschrijft mijn persoonlijke ontwikkeling.
    `,
  },
  {
    naam: 'AI gebruiken om te leren',
    verwacht: 'LO6',
    tekst: `
      Ik gebruik ChatGPT als gesprekspartner om mijn begrip van neurale
      netwerken te verdiepen. Ik heb met de chatbot mijn eigen redenering
      bekritiseerd. In de Me & My Machine Labels leg ik verantwoording af over
      welk deel van de tekst met AI tot stand kwam. Ik heb grenzen gesteld.
    `,
  },
];

for (const c of CASES) {
  const uit = checkLeeruitkomsten(c.tekst);
  const beste = uit.treffers[0];
  const goed = beste?.code === c.verwacht;
  check(
    `${c.naam} → ${c.verwacht}`,
    goed,
    goed ? 'goed' : `werd ${beste?.code ?? 'niets'}`,
  );
}

console.log('\n2) Randgevallen');
{
  const leeg = checkLeeruitkomsten('kort');
  check('te weinig tekst wordt geweigerd', leeg.onzeker && leeg.treffers.length === 0);

  const niets = checkLeeruitkomsten(
    'Deze week hebben we de kantine verbouwd en nieuwe stoelen besteld voor de vergaderruimte op de begane grond.',
  );
  check('niet-relevante tekst geeft geen valse treffer', niets.onzeker, `${niets.treffers.length} treffers`);

  const gemengd = checkLeeruitkomsten(
    'Ik heb de dataset opgeschoond en gevisualiseerd in een dashboard. Daarna heb ik het model getraind en gevalideerd. ' +
      'In de rapportage leg ik de gekozen methode uit aan de stakeholder en onderbouw ik het advies.',
  );
  check('meerdere uitkomsten mogelijk', gemengd.treffers.length >= 2, gemengd.treffers.map((t) => t.code).join(', '));

  const metTitel = checkDocument({ titel: 'Reflectieverslag periode 1', tekst: 'Ik heb veel geleerd deze periode over samenwerken en plannen.' });
  check('titel weegt mee', metTitel.treffers.some((t) => t.code === 'LO5'), metTitel.treffers.map((t) => t.code).join(', '));

  const a = checkLeeruitkomsten(CASES[0].tekst);
  const b = checkLeeruitkomsten(CASES[0].tekst);
  check('deterministisch', JSON.stringify(a.treffers.map((t) => t.score)) === JSON.stringify(b.treffers.map((t) => t.score)));
}

/* ── DEEL 2: de koppeling naar Portflow ─────────────────────────────────── */

console.log('\n3) De koppeling naar Portflow-doelen');
const KOPPEL_PAD = inData('lo-koppeling.json');

if (!existsSync(KOPPEL_PAD)) {
  check('koppelingsbestand bestaat', false, 'draai eerst: node tools/koppel-leeruitkomsten.mjs --schrijf');
} else {
  const k = leesKoppeling();
  check('koppelingsbestand gelezen', k.gevonden, `${k.perCode.size} koppelingen`);
  check('alle zes leeruitkomsten gekoppeld', k.perCode.size === 6, `${k.perCode.size}/6`);

  /*
   * DE BELANGRIJKSTE TEST.
   *
   * De zes doelen van dit semester zijn 485380 t/m 485385. Ze zijn in één keer
   * aangemaakt en hebben daarom opeenvolgende id's. Er bestaan echter ook
   * doelen met dezelfde namen in oudere families (268553-268558 en 371436-371439).
   *
   * Een koppeling die op NAAM is gemaakt pakt vaak het verkeerde: de eerste de
   * beste "Professional Standard" is 268558, niet 485383. Deze test controleert
   * dat we het juiste blok hebben.
   */
  const VERWACHT = { LO1: 485380, LO2: 485381, LO3: 485382, LO4: 485383, LO5: 485384, LO6: 485385 };
  let goed = 0;
  for (const [code, id] of Object.entries(VERWACHT)) {
    const gekregen = portflowGoalIdVoor(code);
    if (gekregen === id) goed += 1;
    else console.log(`     ${code}: verwacht ${id}, kreeg ${gekregen}`);
  }
  check('alle zes wijzen naar het juiste doel', goed === 6, `${goed}/6`);

  // Expliciet: niet het doel van een ouder semester.
  const OUDE_FAMILIES = [268553, 268554, 268555, 268556, 268557, 268558, 371436, 371437, 371438, 371439, 169808, 169809];
  const gebruikt = Object.keys(VERWACHT).map((c) => portflowGoalIdVoor(c));
  const fout = gebruikt.filter((id) => OUDE_FAMILIES.includes(id));
  check('geen enkel doel uit een ouder semester', fout.length === 0, fout.length ? `fout: ${fout.join(', ')}` : '');

  // De id's moeten een doorlopend blok vormen: dat is het bewijs dat ze samen
  // zijn aangemaakt.
  const ids = [...gebruikt].sort((a, b) => a - b);
  const doorlopend = ids.every((id, i) => i === 0 || id === ids[i - 1] + 1);
  check('de zes doelen vormen een doorlopend blok', doorlopend, ids.join(', '));

  // Onbekende code geeft null, geen gok.
  check('onbekende code geeft null', portflowGoalIdVoor('LO99') === null);

  const mappen = semesterMappen();
  check('drie mappen van dit semester', mappen.length === 3, mappen.map((m) => m.naam).join(', '));
  check(
    'de mappen hebben de juiste id\'s',
    mappen.map((m) => m.portflowCollectionId).join(',') === '250278,250279,250280',
    mappen.map((m) => m.portflowCollectionId).join(','),
  );
}

console.log('\n4) Van treffer naar Portflow-doel');
{
  const uit = checkLeeruitkomsten(CASES[1].tekst);
  const ids = naarPortflowGoalIds(uit.treffers);
  check('treffers worden omgezet naar doel-id\'s', ids.length > 0, JSON.stringify(ids));
  check('het juiste doel voor data-analyse', ids.includes(485381), JSON.stringify(ids));
  check('omzetten is deterministisch', JSON.stringify(naarPortflowGoalIds(uit.treffers)) === JSON.stringify(ids));

  // Dubbele treffers mogen geen dubbele id's geven.
  const dubbel = naarPortflowGoalIds([{ code: 'LO2' }, { code: 'LO2' }]);
  check('geen dubbele id\'s', dubbel.length === 1, JSON.stringify(dubbel));
}

console.log('\n5) Hoort dit document bij deze map?');
{
  const reflectie = 'Mijn kernwaarden zijn nieuwsgierigheid. Ik reflecteer op mijn zwakke punten en stel leerdoelen voor mijn persoonlijke groei.';
  const inMap = checkVoorMap(reflectie, 'Persoonlijk project');
  check('reflectie past bij Persoonlijk project', inMap.pastBijMap, inMap.treffers.map((t) => t.code).join(', '));

  const projectplan = 'In het projectplan staan de doelen, de stakeholders en de requirements in een backlog met user stories voor de klant.';
  const verkeerd = checkVoorMap(projectplan, 'Persoonlijk project');
  check('projectplan hoort niet in Persoonlijk project', !verkeerd.pastBijMap, `beter: ${verkeerd.beterElders?.naam ?? '—'}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\nzes leeruitkomsten: ${LEERUITKOMSTEN.map((l) => l.code).join(' · ')}`);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
