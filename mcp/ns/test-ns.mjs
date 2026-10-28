#!/usr/bin/env node
/**
 * Test de NS-client tegen een nepserver.
 *
 * Geen sleutel nodig, geen aanvraag naar de echte NS: deze test start een
 * HTTP-server die dezelfde paden beantwoordt met een antwoord dat eruitziet
 * zoals de NS het levert. Zo kontroleren we of wij het goed uitlezen — en dat
 * is precies het stuk dat je niet met het oog ziet.
 *
 *   node mcp/ns/test-ns.mjs
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';

/* ─────────────────────────── de nep-NS ────────────────────────────────── */

const TRIPS = {
  trips: [
    {
      idx: 0,
      plannedDurationInMinutes: 42,
      transfers: 1,
      legs: [
        {
          name: 'Intercity',
          direction: 'Breda',
          cancelled: false,
          origin: {
            name: 'Roosendaal',
            plannedDateTime: '2026-11-02T08:12:00+0100',
            actualDateTime: '2026-11-02T08:12:00+0100',
            plannedTrack: '3',
          },
          destination: {
            name: 'Breda',
            plannedDateTime: '2026-11-02T08:30:00+0100',
            actualDateTime: '2026-11-02T08:30:00+0100',
          },
          plannedDurationInMinutes: 18,
          product: { shortCategoryName: 'IC', number: '1150' },
        },
        {
          name: 'Sprinter',
          direction: 'Tilburg',
          cancelled: false,
          origin: {
            name: 'Breda',
            plannedDateTime: '2026-11-02T08:38:00+0100',
            actualDateTime: '2026-11-02T08:38:00+0100',
            plannedTrack: '5',
          },
          destination: {
            name: 'Tilburg',
            plannedDateTime: '2026-11-02T08:54:00+0100',
            actualDateTime: '2026-11-02T08:54:00+0100',
          },
          plannedDurationInMinutes: 16,
          product: { shortCategoryName: 'SPR', number: '6500' },
        },
      ],
    },
    {
      idx: 1,
      plannedDurationInMinutes: 58,
      transfers: 0,
      legs: [
        {
          name: 'Intercity',
          direction: 'Tilburg',
          cancelled: false,
          origin: {
            name: 'Roosendaal',
            plannedDateTime: '2026-11-02T08:20:00+0100',
            actualDateTime: '2026-11-02T08:23:00+0100',
            plannedTrack: '3',
          },
          destination: {
            name: 'Tilburg',
            plannedDateTime: '2026-11-02T09:18:00+0100',
            actualDateTime: '2026-11-02T09:18:00+0100',
          },
          plannedDurationInMinutes: 58,
          product: { shortCategoryName: 'IC', number: '3600' },
        },
      ],
    },
  ],
};

const DEPARTURES = {
  payload: {
    departures: [
      {
        direction: 'Roosendaal',
        name: 'Sprinter 6500',
        plannedDateTime: '2026-11-02T08:05:00+0100',
        actualDateTime: '2026-11-02T08:09:00+0100',
        plannedTrack: '4',
        actualTrack: '4',
        trainCategory: 'SPR',
        cancelled: false,
      },
      {
        direction: 'Tilburg',
        name: 'Intercity 3600',
        plannedDateTime: '2026-11-02T08:12:00+0100',
        actualDateTime: '2026-11-02T08:12:00+0100',
        plannedTrack: '5',
        actualTrack: '5',
        trainCategory: 'IC',
        cancelled: false,
      },
    ],
  },
};

const STATIONS = {
  payload: [
    { code: 'RSD', namen: { lang: 'Roosendaal', middel: 'Roosendaal', kort: 'Roosendaal' }, lat: 51.54, lng: 4.45, land: 'NL' },
    { code: 'BD', namen: { lang: 'Breda', middel: 'Breda', kort: 'Breda' }, lat: 51.59, lng: 4.78, land: 'NL' },
    { code: 'TL', namen: { lang: 'Tilburg', middel: 'Tilburg', kort: 'Tilburg' }, lat: 51.56, lng: 5.09, land: 'NL' },
  ],
};

const DISRUPTIONS = {
  payload: [
    {
      type: 'MAINTENANCE',
      title: 'Werkzaamheden tussen Roosendaal en Breda',
      isActive: true,
      start: '2026-11-02T01:00:00+0100',
      end: '2026-11-02T05:00:00+0100',
      phases: [{ status: 'ACTIVE', label: 'Er rijden bussen' }],
    },
    {
      type: 'DISRUPTION',
      title: 'Sein- en wisselstoring bij Zwolle',
      isActive: true,
      phases: [{ status: 'ACTIVE', label: 'Minder treinen' }],
    },
  ],
};

let laatsteSleutel = null;

const server = createServer((req, res) => {
  laatsteSleutel = req.headers['ocp-apim-subscription-key'] ?? null;

  if (laatsteSleutel !== 'goede-sleutel') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Access denied due to invalid subscription key.' }));
    return;
  }

  const pad = new URL(req.url, 'http://x').pathname;
  const lichaam =
    pad === '/reisinformatie-api/api/v3/trips'
      ? TRIPS
      : pad === '/reisinformatie-api/api/v2/departures'
        ? DEPARTURES
        : pad === '/reisinformatie-api/api/v2/stations'
          ? STATIONS
          : pad === '/reisinformatie-api/api/v3/disruptions'
            ? DISRUPTIONS
            : null;

  if (!lichaam) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'niet gevonden' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(lichaam));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const poort = server.address().port;

process.env.NS_BASE_URL = `http://127.0.0.1:${poort}`;
process.env.NS_SUBSCRIPTION_KEY = 'goede-sleutel';

const ns = await import('./lib/client.mjs');

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

/* ─────────────────────────────── tests ────────────────────────────────── */

console.log('\n1) Hulpfuncties');

check('"Station Roosendaal" wordt "Roosendaal"', () => {
  assert.equal(ns.schoneStationsnaam('Station Roosendaal'), 'Roosendaal');
});

check('de datum gaat in het formaat dat de NS wil', () => {
  const datum = new Date('2026-11-02T08:30:00');
  assert.match(ns.nsDatum(datum), /^\d{4}-\d{2}-\d{2}T08:30:00$/);
});

console.log('\n2) Reisadvies');

const reizen = await ns.reisadvies({ van: 'Roosendaal', naar: 'Tilburg' });

check('beide opties komen terug', () => assert.equal(reizen.length, 2));

check('de reistijd klopt', () => assert.equal(reizen[0].minuten, 42));

check('overstappen worden geteld', () => assert.equal(reizen[0].overstappen, 1));

check('de vertrek- en aankomsttijd zijn gevuld', () => {
  assert.ok(reizen[0].vertrek);
  assert.ok(reizen[0].aankomst);
  assert.equal(reizen[0].van, 'Roosendaal');
  assert.equal(reizen[0].naar, 'Tilburg');
});

check('de treinen per optie staan erin', () => {
  assert.equal(reizen[0].vol.length, 2);
  assert.equal(reizen[0].vol[0].soort, 'IC');
  assert.equal(reizen[0].vol[0].lijn, '1150');
  assert.equal(reizen[0].vol[0].vertrekSpoor, '3');
});

check('vertraging wordt berekend', () => assert.equal(reizen[1].vertragingMinuten, 3));

check('de snelste reis wordt gekozen', () => {
  const snel = ns.snelsteReis(reizen);
  assert.equal(snel.minuten, 42);
});

console.log('\n3) Storingen');

const alles = await ns.storingen();

check('beide storingen komen terug', () => assert.equal(alles.length, 2));

check('de eerste boodschap wordt meegenomen', () => {
  assert.equal(alles[0].bericht, 'Er rijden bussen');
});

const rondBreda = await ns.storingen({ station: 'Breda' });

check('filteren op station werkt', () => {
  assert.equal(rondBreda.length, 1);
  assert.match(rondBreda[0].titel, /Roosendaal en Breda/);
});

console.log('\n4) Vertrektijden');

const vertrekken = await ns.vertrekken({ station: 'Breda' });

check('de vertrekken komen terug', () => assert.equal(vertrekken.length, 2));

check('de vertraging van de eerste trein is 4 minuten', () => {
  assert.equal(vertrekken[0].vertragingMinuten, 4);
});

const alleenTilburg = await ns.vertrekken({ station: 'Breda', richting: 'tilburg' });

check('op richting gefilterd blijft er één over', () => assert.equal(alleenTilburg.length, 1));

console.log('\n5) Stations');

const breda = await ns.zoekStations('breda');

check('zoeken op naam werkt', () => {
  assert.equal(breda.length, 1);
  assert.equal(breda[0].code, 'BD');
  assert.equal(breda[0].naam, 'Breda');
});

const opCode = await ns.zoekStations('tl');
check('op code gevonden', () => assert.ok(opCode.some((s) => s.code === 'TL')));

console.log('\n6) Een verkeerde sleutel');

process.env.NS_SUBSCRIPTION_KEY = 'foute-sleutel';
let fout = null;
try {
  await ns.reisadvies({ van: 'Roosendaal', naar: 'Breda' });
} catch (e) {
  fout = e;
}

check('een 401 geeft een duidelijke fout', () => {
  assert.ok(fout, 'verwacht een fout');
  assert.match(fout.message, /weigerde de sleutel/i);
});

process.env.NS_SUBSCRIPTION_KEY = 'goede-sleutel';

console.log('\n7) Zonder sleutel');

delete process.env.NS_SUBSCRIPTION_KEY;
const zonderSleutel = ns.vindNsSleutel();
check('zonder sleutel in de omgeving zoekt hij in .env en vindt niets of iets', () => {
  // In deze repo kan .env een sleutel hebben; dan is dit geen fout.
  assert.ok(zonderSleutel === null || typeof zonderSleutel.sleutel === 'string');
});

server.close();

console.log(
  `\n${fouten.length === 0 ? 'ALLES OK' : `${fouten.length} CHECK(S) MISLUKT`}  (${gelukt} geslaagd)\n`,
);
process.exit(fouten.length === 0 ? 0 : 1);
