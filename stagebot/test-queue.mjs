#!/usr/bin/env node
/**
 * Tests voor de aanvoer en de wachtrij.
 *
 * Wat hier getest wordt is het deel dat je niet met het oog controleert: de
 * afstandsberekening, de volgorde van de wachtrij, de daglimiet, en dat een
 * bedrijf dat je zelf toevoegt zijn naam houdt als de site een slogan als titel
 * heeft.
 *
 * De tests draaien in een tijdelijke datamap (CAVASCP_DATA_DIR), zodat ze nooit
 * je echte bedrijvenlijst aanraken. Dat is geen detail: een test die je dossier
 * overschrijft is een test die je één keer draait.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Vóór elke import: de datamap moet naar de tijdelijke map wijzen.
process.env.CAVASCP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stagebot-test-'));

const { afstandKm, ovKlasse, beoordeelLocatie, inRegio, THUIS } = await import('./lib/regio.mjs');
const { voegKandidaatToe, voegToe, wachtrij, dagTelling, werkBij, vandaag, DAG_LIMIET } = await import(
  './lib/bedrijven.mjs'
);
const { seedKandidaten, voegUrlToe } = await import('./lib/zoeken.mjs');
const { keurMail } = await import('./lib/mail.mjs');

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

console.log('\n1) Afstanden');

check('Roosendaal naar Breda is ongeveer 22 km', () => {
  const km = afstandKm(THUIS, { lat: 51.5951, lon: 4.78 });
  assert.ok(km > 20 && km < 25, `uitkomst: ${km.toFixed(1)}`);
});

check('een bedrijf in Roosendaal ligt in de regio', () => {
  assert.equal(inRegio({ lat: 51.5305, lon: 4.4653 }), true);
});

check('een bedrijf in Utrecht ligt niet in de regio', () => {
  assert.equal(inRegio({ lat: 52.0907, lon: 5.1214 }), false);
});

console.log('\n2) OV-klassen');

check('800 meter is loopafstand', () => assert.equal(ovKlasse(0.8), 'loopafstand'));
check('1,5 kilometer is nog loopafstand', () => assert.equal(ovKlasse(1.5), 'loopafstand'));
check('2,5 kilometer is een korte rit', () => assert.equal(ovKlasse(2.5), 'korte rit'));
check('9 kilometer is verder', () => assert.equal(ovKlasse(9), 'verder'));
check('zonder afstand is het onbekend', () => assert.equal(ovKlasse(null), 'onbekend'));

check('beoordeelLocatie kiest het dichtstbijzijnde station', () => {
  const stations = [
    { naam: 'Breda', lat: 51.5951, lon: 4.78 },
    { naam: 'Roosendaal', lat: 51.5403, lon: 4.4585 },
  ];
  const uit = beoordeelLocatie({ lat: 51.53, lon: 4.465 }, stations);
  assert.equal(uit.station.naam, 'Roosendaal');
  assert.equal(uit.ov, 'loopafstand');
});

check('zonder coördinaten is de locatie onbekend', () => {
  const uit = beoordeelLocatie({ lat: null, lon: null }, []);
  assert.equal(uit.ov, 'onbekend');
  assert.equal(uit.vanHuisKm, null);
});

console.log('\n3) Wachtrij');

check('een kandidaat komt in de wachtrij', () => {
  voegKandidaatToe({
    naam: 'Testbedrijf A',
    website: 'https://a.test',
    domein: 'a.test',
    plaats: 'Roosendaal',
    lat: 51.53,
    lon: 4.465,
    station: { naam: 'Roosendaal', km: 0.8 },
    vanHuisKm: 0.2,
    ov: 'loopafstand',
    bron: 'test',
  });
  const rij = wachtrij();
  assert.equal(rij.length, 1);
  assert.equal(rij[0].titel, 'Testbedrijf A');
});

check('loopafstand staat boven verder weg', () => {
  voegKandidaatToe({
    naam: 'Verre B',
    website: 'https://b.test',
    domein: 'b.test',
    plaats: 'Breda',
    lat: 51.59,
    lon: 4.78,
    station: { naam: 'Breda', km: 1.2 },
    vanHuisKm: 20,
    ov: 'korte rit',
    bron: 'test',
  });
  voegKandidaatToe({
    naam: 'Dichtbij C',
    website: 'https://c.test',
    domein: 'c.test',
    plaats: 'Roosendaal',
    lat: 51.531,
    lon: 4.466,
    station: { naam: 'Roosendaal', km: 0.5 },
    vanHuisKm: 0.1,
    ov: 'loopafstand',
    bron: 'test',
  });

  const volgorde = wachtrij().map((b) => b.titel);
  assert.deepEqual(volgorde.slice(0, 2), ['Dichtbij C', 'Testbedrijf A']);
});

check('hetzelfde domein komt er niet twee keer in', () => {
  const voor = wachtrij().length;
  voegKandidaatToe({
    naam: 'Testbedrijf A opnieuw',
    website: 'https://a.test',
    domein: 'a.test',
    ov: 'loopafstand',
    bron: 'test',
  });
  assert.equal(wachtrij().length, voor);
});

check('vandaag() geeft YYYY-MM-DD', () => {
  assert.match(vandaag(), /^\d{4}-\d{2}-\d{2}$/);
});

console.log('\n4) De daglimiet');

check('de limiet staat op twintig', () => assert.equal(DAG_LIMIET, 20));

check('een concept van vandaag telt mee', () => {
  const eerste = wachtrij()[0];
  werkBij(eerste.id, (b) => {
    b.status = 'concept';
    b.dag = vandaag();
    b.mail = { volledig: 'x', body: 'x' };
  });
  const telling = dagTelling();
  assert.equal(telling.gedaan, 1);
  assert.equal(telling.over, DAG_LIMIET - 1);
});

check('een concept van gisteren telt niet mee', () => {
  const tweede = wachtrij()[0];
  werkBij(tweede.id, (b) => {
    b.status = 'concept';
    b.dag = '2020-01-01';
  });
  assert.equal(dagTelling().gedaan, 1);
});

check('een afgewezen bedrijf telt niet mee', () => {
  // Alles wat vandaag nog als concept stond, afwijzen: dan blijft er niets over.
  for (const bedrijf of dagTelling().bedrijven) {
    werkBij(bedrijf.id, (b) => {
      b.status = 'afgewezen';
    });
  }
  assert.equal(dagTelling().gedaan, 0);
});

console.log('\n5) Naam boven slogan');

check('de bedrijfsnaam blijft als de site een slogan als titel heeft', () => {
  voegKandidaatToe({
    naam: 'Daemen ICT',
    website: 'https://daemen.test',
    domein: 'daemen.test',
    ov: 'onbekend',
    bron: 'test',
  });
  const { bedrijf } = voegToe({
    url: 'https://daemen.test',
    domein: 'daemen.test',
    titel: 'ICT Beheer Breda en West-Brabant',
    emails: ['info@daemen.test'],
    tekst: 'x',
    paginas: [],
    gescand: new Date().toISOString(),
  });
  assert.equal(bedrijf.titel, 'Daemen ICT');
});

// Deze twee zijn async (ze toetsen het domein), dus geen check() eromheen:
// een async testbody zou stilletjes slagen zonder de assertie te halen.
{
  const bedrijf = await voegUrlToe('https://zomaar.test', { controleerDomein: false });
  check('een titel die alleen het domein is, wordt vervangen', () => {
    assert.equal(bedrijf.titel, 'zomaar');
    const { bedrijf: na } = voegToe({
      url: 'https://zomaar.test',
      domein: 'zomaar.test',
      titel: 'Zomaar Software',
      emails: [],
      tekst: 'x',
      paginas: [],
      gescand: new Date().toISOString(),
    });
    assert.equal(na.titel, 'Zomaar Software');
  });
}

console.log('\n6) Eigen lijst');

check('de seedlijst is leesbaar', () => {
  const seed = seedKandidaten();
  assert.ok(Array.isArray(seed));
});

{
  const bedrijf = await voegUrlToe('www.nogiets.test', { controleerDomein: false });
  check('een url zonder protocol wordt aangevuld', () => {
    assert.equal(bedrijf.url, 'https://www.nogiets.test');
    assert.equal(bedrijf.domein, 'nogiets.test');
  });
}

console.log('\n7) De mailcontrole');

check('"een nee is ook helemaal goed" telt als opt-out', () => {
  const profiel = { naam: 'Test', opleiding: 'HBO-ICT', instelling: 'Fontys' };
  const uit = keurMail(
    {
      body: 'Ik zoek een stage bij jullie. Een nee is ook helemaal goed; dan weet ik dat en kan ik verder kijken.',
      volledig: 'x',
      waarom: 'x',
    },
    profiel,
  );
  assert.ok(!uit.punten.some((p) => p.includes('afwijzen')), uit.punten.join('; '));
});

console.log(
  `\n${fouten.length === 0 ? 'ALLES OK' : `${fouten.length} CHECK(S) MISLUKT`}  (${gelukt} geslaagd)\n`,
);

process.exit(fouten.length === 0 ? 0 : 1);
