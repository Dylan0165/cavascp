#!/usr/bin/env node
/**
 * Test de opvolglogica.
 *
 * De vraag "wie moet ik opvolgen" is makkelijk fout te beantwoorden: een bedrijf
 * dat net gemaild is hoort er niet in, een bedrijf dat al antwoordde ook niet,
 * en na twee opvolgingen moet het stoppen. Dat is precies wat hier getest
 * wordt — zonder te mailen en zonder AI.
 *
 *   node stagebot/test-opvolgen.mjs
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.CAVASCP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stagebot-opvolgen-'));

const { voegKandidaatToe, werkBij } = await import('./lib/bedrijven.mjs');
const { opTeVolgen, WACHTDAGEN, MAX_OPVOLGINGEN } = await import('./lib/opvolgen.mjs');
const { dagbriefing, briefingTekst } = await import('./lib/briefing.mjs');

let gelukt = 0;
const fouten = [];

function check(naam, fn) {
  try {
    fn();
    gelukt += 1;
    console.log(`  PASS  ${naam}`);
  } catch (fout) {
    fouten.push({ naam, fout });
    console.log(`  FAIL  ${naam}`);
    console.log(`        ${fout.message}`);
  }
}

const dagenGeleden = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

function maakBedrijf(id, { dagen, status = 'verstuurd', antwoorden = [], opvolgingen = [] }) {
  const bedrijf = voegKandidaatToe({
    naam: id,
    website: `https://${id}.nl`,
    domein: `${id}.nl`,
    ov: 'onbekend',
    bron: 'test',
  });

  werkBij(bedrijf.id, (b) => {
    b.status = status;
    b.emails = [`info@${id}.nl`];
    b.mail = { onderwerp: 'Stage', volledig: 'Beste,' };
    b.verzending = { op: dagenGeleden(dagen) };
    b.antwoorden = antwoorden;
    b.opvolgingen = opvolgingen;
  });

  return bedrijf;
}

console.log('\n1) Wie komt in de lijst?');

maakBedrijf('vers', { dagen: 1 });
maakBedrijf('oud', { dagen: 8 });
maakBedrijf('antwoordde', { dagen: 10, antwoorden: [{ uid: 1, op: dagenGeleden(2) }] });
maakBedrijf('tweemaal', {
  dagen: 20,
  opvolgingen: [
    { op: dagenGeleden(14), onderwerp: 'Re: stage' },
    { op: dagenGeleden(7), onderwerp: 'Re: stage' },
  ],
});
maakBedrijf('concept', { dagen: 10, status: 'concept' });
maakBedrijf('gesprek', { dagen: 10, status: 'gesprek' });
maakBedrijf('eenmaal', {
  dagen: 20,
  opvolgingen: [{ op: dagenGeleden(12), onderwerp: 'Re: stage' }],
});

const lijst = opTeVolgen();
const ids = lijst.map((i) => i.titel).sort();

check('een verse mail staat er niet in', () => assert.equal(ids.includes('vers'), false));
check('een mail van acht dagen wel', () => assert.equal(ids.includes('oud'), true));
check('wie antwoordde niet', () => assert.equal(ids.includes('antwoordde'), false));
check('na twee opvolgingen stopt het', () => assert.equal(ids.includes('tweemaal'), false));
check('een concept is nog niets verstuurd', () => assert.equal(ids.includes('concept'), false));
check('een gesprek volg je niet op', () => assert.equal(ids.includes('gesprek'), false));
check('na één opvolging twaalf dagen geleden mag het weer', () => assert.equal(ids.includes('eenmaal'), true));

check('er staan precies twee in de lijst', () => assert.deepEqual(ids, ['eenmaal', 'oud']));

console.log('\n2) De gegevens per regel');

const oud = lijst.find((i) => i.titel === 'oud');
check('de dagen sinds verzending kloppen', () => assert.equal(oud.dagenGeleden >= 8, true));
check('het e-mailadres is gekozen', () => assert.equal(oud.naar, 'info@oud.nl'));
check('het aantal eerdere opvolgingen staat erbij', () => assert.equal(oud.keer, 0));

console.log('\n3) De dagbriefing');

const briefing = dagbriefing();
check('de briefing telt de opvolgingen', () => assert.equal(briefing.opvolgen, 2));
check('de tekst noemt ze', () => assert.match(briefingTekst(briefing), /op te volgen/));
check('de tekst is nooit leeg', () => assert.ok(briefingTekst(briefing).length > 10));

console.log('\n4) De constanten');

check('er wordt zes dagen gewacht', () => assert.equal(WACHTDAGEN, 6));
check('na twee keer is het genoeg', () => assert.equal(MAX_OPVOLGINGEN, 2));

console.log(
  `\n${fouten.length === 0 ? 'ALLES OK' : `${fouten.length} CHECK(S) MISLUKT`}  (${gelukt} geslaagd)\n`,
);
process.exit(fouten.length === 0 ? 0 : 1);
