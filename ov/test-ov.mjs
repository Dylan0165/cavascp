#!/usr/bin/env node
/**
 * Test de planner op een nagemaakte dienstregeling.
 *
 * Geen GTFS-bestand nodig en geen netwerk: we bouwen een klein net met vier
 * haltes en een paar treinen, en kontroleren of de reis eruit komt die eruit
 * moet komen. Dat is de kern — de rest (inlezen, MCP, API) is invoer en
 * uitvoer om deze berekening heen.
 *
 *   node ov/test-ov.mjs
 */

import assert from 'node:assert/strict';

const {
  plan,
  snelsteReistijd,
  zoekHaltes,
  dienstActief,
  volgendeWerkdag,
  alsTijd,
  alsSeconden,
  ymd,
} = await import('./lib/planner.mjs');

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

/* ─────────────────────────── het nepnet ───────────────────────────────── */

const u = (h, m) => h * 3600 + m * 60;

const net = {
  versie: 1,
  stops: [
    { id: 'RSD', naam: 'Roosendaal', lat: 51.54, lon: 4.45, ouder: null },
    { id: 'BD', naam: 'Breda', lat: 51.59, lon: 4.78, ouder: null },
    { id: 'ETL', naam: 'Etten-Leur', lat: 51.57, lon: 4.63, ouder: null },
    { id: 'TL', naam: 'Tilburg', lat: 51.56, lon: 5.09, ouder: null },
  ],
  routes: [{ id: 'NS', kort: 'IC', lang: 'Intercity', vervoerder: 'NS' }],
  diensten: [{ id: 'S1', dagen: null, van: null, tot: null, data: ['20261102'] }],
  reizen: [
    // Direct: Roosendaal → Breda, 08:00 → 08:20
    { id: 't-direct', route: 0, dienst: 0, kop: 'Breda', stops: [[0, null, u(8, 0)], [1, u(8, 20), null]] },
    // Met overstap: Roosendaal → Etten-Leur 08:00 → 08:10, dan 08:14 → 08:40 Tilburg
    {
      id: 't-deel1',
      route: 0,
      dienst: 0,
      kop: 'Etten-Leur',
      stops: [[0, null, u(8, 0)], [2, u(8, 10), null]],
    },
    {
      id: 't-deel2',
      route: 0,
      dienst: 0,
      kop: 'Tilburg',
      stops: [[2, null, u(8, 14)], [3, u(8, 40), null]],
    },
    // Te laat: Roosendaal → Breda om 09:30, buiten het zoekvenster van 08:00
    { id: 't-laat', route: 0, dienst: 0, kop: 'Breda', stops: [[0, null, u(9, 30)], [1, u(9, 50), null]] },
  ],
};

const DINSDAG = new Date(2026, 10, 2); // 2 november 2026, dinsdag

/* ─────────────────────────────── tests ────────────────────────────────── */

console.log('\n1) Tijdnotatie');

check('08:30 wordt 30600 seconden', () => assert.equal(alsSeconden('08:30'), 30_600));
check('30600 wordt weer 08:30', () => assert.equal(alsTijd(30_600), '08:30'));
check('een tijd boven 24 uur blijft heel', () => assert.equal(alsTijd(25 * 3600), '01:00'));

console.log('\n2) Haltes zoeken');

check('"Breda" vindt Breda', () => {
  const haltes = zoekHaltes(net, 'Breda');
  assert.equal(haltes.length, 1);
  assert.equal(net.stops[haltes[0]].naam, 'Breda');
});

check('"station breda" vindt ook Breda', () => {
  assert.equal(zoekHaltes(net, 'station breda').length, 1);
});

check('een onbekende halte geeft niets', () => assert.equal(zoekHaltes(net, 'Groningen').length, 0));

console.log('\n3) Diensten en dagen');

check('een dienst met losse datums rijdt op die datum', () => {
  assert.equal(dienstActief(net.diensten[0], DINSDAG), true);
});

check('en niet op een andere datum', () => {
  assert.equal(dienstActief(net.diensten[0], new Date(2026, 10, 3)), false);
});

check('volgendeWerkdag slaat het weekend over', () => {
  const vrijdag = new Date(2026, 9, 30); // vrijdag 30 oktober
  const volgende = volgendeWerkdag(vrijdag);
  assert.equal(volgende.getDay(), 1); // maandag
});

console.log('\n4) Een directe reis');

const direct = plan(net, { van: 'Roosendaal', naar: 'Breda', datum: DINSDAG, vertrek: '08:00' });

check('er is een reis gevonden', () => assert.ok(direct.length >= 1));

check('de reis duurt twintig minuten', () => assert.equal(direct[0].minuten, 20));

check('zonder overstappen', () => assert.equal(direct[0].overstappen, 0));

check('vertrek en aankomst kloppen', () => {
  assert.equal(direct[0].vertrek, '08:00');
  assert.equal(direct[0].aankomst, '08:20');
});

check('de lijn en vervoerder staan erbij', () => {
  assert.equal(direct[0].legs[0].lijn, 'IC');
  assert.equal(direct[0].legs[0].vervoerder, 'NS');
});

console.log('\n5) Een reis met overstap');

const overstap = plan(net, { van: 'Roosendaal', naar: 'Tilburg', datum: DINSDAG, vertrek: '08:00' });

check('de reis met overstap wordt gevonden', () => assert.ok(overstap.length >= 1));

check('hij heeft één overstap', () => assert.equal(overstap[0].overstappen, 1));

check('de overstap is in Etten-Leur', () => {
  assert.equal(overstap[0].legs[0].naar, 'Etten-Leur');
  assert.equal(overstap[0].legs[1].van, 'Etten-Leur');
});

check('de aankomst is 08:40', () => assert.equal(overstap[0].aankomst, '08:40'));

check('de reistijd is veertig minuten', () => assert.equal(overstap[0].minuten, 40));

console.log('\n6) Randgevallen');

check('na de laatste trein is er niets meer', () => {
  // De laatste reis in dit net vertrekt om 09:30; om 10:30 is die weg.
  const laat = plan(net, { van: 'Roosendaal', naar: 'Breda', datum: DINSDAG, vertrek: '10:30' });
  assert.equal(laat.length, 0);
});

check('op een dag zonder dienst rijdt er niets', () => {
  const andere = plan(net, { van: 'Roosendaal', naar: 'Breda', datum: new Date(2026, 10, 3), vertrek: '08:00' });
  assert.equal(andere.length, 0);
});

check('een onbekende bestemming geeft een duidelijke fout', () => {
  assert.throws(
    () => plan(net, { van: 'Roosendaal', naar: 'Groningen', datum: DINSDAG, vertrek: '08:00' }),
    /Onbekende bestemming/,
  );
});

check('snelsteReistijd geeft de vroegste aankomst', () => {
  const snel = snelsteReistijd(net, { van: 'Roosendaal', naar: 'Breda', datum: DINSDAG, vertrek: '08:00' });
  assert.equal(snel.aankomst, '08:20');
});

console.log('\n7) De datum als sleutel');

check('ymd geeft YYYYMMDD', () => assert.equal(ymd(DINSDAG), '20261102'));

console.log(
  `\n${fouten.length === 0 ? 'ALLES OK' : `${fouten.length} CHECK(S) MISLUKT`}  (${gelukt} geslaagd)\n`,
);
process.exit(fouten.length === 0 ? 0 : 1);
