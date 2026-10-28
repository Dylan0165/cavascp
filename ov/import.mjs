#!/usr/bin/env node
/**
 * De dienstregeling van heel Nederland inlezen, en eruit houden wat wij nodig
 * hebben.
 *
 * WAAROM GEEN NS-API
 *
 * De NS-API vraagt een sleutel via een portaal dat er bij de gebruiker niet
 * uitkwam. Open data is er ook: OVapi publiceert elke dag een GTFS-bestand met
 * de volledige dienstregeling van alle vervoerders in Nederland — trein, bus,
 * tram, metro. Geen sleutel, geen account, geen limiet.
 *
 * De prijs is formaat: ruim tweehonderd megabyte zip, met daarin
 * stop_times.txt van ettelijke miljoenen regels. Dat lees je niet elke keer
 * opnieuw in. Daarom doet dit script het één keer, en schrijft het een klein
 * bestand met alleen de treinreizen in de buurt van Roosendaal.
 *
 *   node ov/import.mjs                  # downloaden en inlezen
 *   node ov/import.mjs --bestand x.zip  # een eerder gedownload bestand
 *   node ov/import.mjs -- alles         # geen straalfilter (heél Nederland)
 */

import { createWriteStream } from 'node:fs';
import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inData } from '../mcp/lib/paden.mjs';
import { leesInhoudsopgave, openBestand, regels, splitCsv } from './lib/zip.mjs';

const BRON = process.env.OV_GTFS_URL || 'https://gtfs.ovapi.nl/nl/gtfs-nl.zip';
const MAP = inData('ov');
const NET_PAD = path.join(MAP, 'net.json');

/** Alles binnen deze straal van Roosendaal houdt een reis interessant. */
const REGIO = { lat: 51.5305, lon: 4.4653, straalKm: 45 };

const argumenten = process.argv.slice(2);
const bestandArg = argumenten.indexOf('--bestand');
const alles = argumenten.includes('--alles');

const log = (...delen) => console.log(...delen);

function afstandKm(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function download(pad) {
  log(`  downloaden: ${BRON}`);
  const antwoord = await fetch(BRON, { headers: { 'User-Agent': 'cavascp-ov/1.0' } });
  if (!antwoord.ok) throw new Error(`Download mislukte: HTTP ${antwoord.status}`);

  const totaal = Number(antwoord.headers.get('content-length') ?? 0);
  let gedownload = 0;
  let laatsteMelding = 0;

  const teller = new TransformStream({
    transform(brok, controller) {
      gedownload += brok.length;
      const nu = Date.now();
      if (totaal && nu - laatsteMelding > 2000) {
        laatsteMelding = nu;
        const procent = Math.round((gedownload / totaal) * 100);
        process.stdout.write(`\r  ${procent}% — ${Math.round(gedownload / 1e6)} MB van ${Math.round(totaal / 1e6)} MB`);
      }
      controller.enqueue(brok);
    },
  });

  await mkdir(path.dirname(pad), { recursive: true });
  await pipeline(Readable.fromWeb(antwoord.body.pipeThrough(teller)), createWriteStream(pad));
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  log(`  opgeslagen: ${path.relative(process.cwd(), pad)}`);
  return pad;
}

async function zorgVoorBestand() {
  if (bestandArg !== -1) {
    const pad = argumenten[bestandArg + 1];
    if (!pad) throw new Error('--bestand heeft een pad nodig');
    return pad;
  }

  const lokaal = path.join(MAP, 'gtfs-nl.zip');
  try {
    const info = await stat(lokaal);
    const dagen = (Date.now() - info.mtimeMs) / 86_400_000;
    if (dagen < 7) {
      log(`  bestaand bestand gebruiken (${Math.round(dagen)} dagen oud)`);
      return lokaal;
    }
  } catch {
    /* nog niet gedownload */
  }

  return download(lokaal);
}

/* ────────────────────────────── inlezen ───────────────────────────────── */

function kopIndex(regel) {
  const koppen = splitCsv(regel).map((k) => k.trim());
  return (naam) => koppen.indexOf(naam);
}

function seconden(tekenreeks) {
  if (!tekenreeks) return null;
  const delen = tekenreeks.split(':').map(Number);
  if (delen.length !== 3 || delen.some((n) => !Number.isFinite(n))) return null;
  return delen[0] * 3600 + delen[1] * 60 + delen[2];
}

async function leesCsv(pad, vermelding, verwerk) {
  const stream = await openBestand(pad, vermelding);
  let eerste = true;
  let index = null;

  for await (const regel of regels(stream)) {
    if (!regel.length) continue;
    if (eerste) {
      index = kopIndex(regel);
      eerste = false;
      continue;
    }
    verwerk(index, regel);
  }
}

async function main() {
  const start = Date.now();
  const pad = await zorgVoorBestand();
  const inhoud = await leesInhoudsopgave(pad);
  log(`  ${inhoud.size} bestanden in het archief`);

  const nodig = (naam) => {
    const vermelding = inhoud.get(naam);
    if (!vermelding) throw new Error(`${naam} ontbreekt in het archief`);
    return vermelding;
  };

  /* 1. Vervoerders en routes: welke zijn trein? */
  const agency = new Map();
  await leesCsv(pad, nodig('agency.txt'), (i, regel) => {
    const velden = splitCsv(regel);
    agency.set(velden[i('agency_id')], velden[i('agency_name')]);
  });

  const routes = new Map();
  await leesCsv(pad, nodig('routes.txt'), (i, regel) => {
    const velden = splitCsv(regel);
    const type = Number(velden[i('route_type')]);
    if (type !== 2) return; // 2 = trein
    routes.set(velden[i('route_id')], {
      kort: velden[i('route_short_name')] || null,
      lang: velden[i('route_long_name')] || null,
      vervoerder: agency.get(velden[i('agency_id')]) ?? null,
    });
  });
  log(`  routes: ${routes.size} treinroutes`);

  /* 2. Reizen (trips) op die routes. */
  const trips = new Map();
  await leesCsv(pad, nodig('trips.txt'), (i, regel) => {
    const velden = splitCsv(regel);
    const routeId = velden[i('route_id')];
    if (!routes.has(routeId)) return;
    trips.set(velden[i('trip_id')], {
      route: routeId,
      service: velden[i('service_id')],
      kop: velden[i('trip_headsign')] || null,
    });
  });
  log(`  reizen: ${trips.size}`);

  /* 3. Stations en haltes. */
  const stops = new Map();
  await leesCsv(pad, nodig('stops.txt'), (i, regel) => {
    const velden = splitCsv(regel);
    const id = velden[i('stop_id')];
    const lat = Number(velden[i('stop_lat')]);
    const lon = Number(velden[i('stop_lon')]);
    stops.set(id, {
      naam: velden[i('stop_name')],
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      ouder: velden[i('parent_station')] || null,
    });
  });
  log(`  haltes: ${stops.size}`);

  /* 4. De grote klus: alle stop_times, maar alleen voor onze treinreizen. */
  const reisStops = new Map();
  let regelsGelezen = 0;

  await leesCsv(pad, nodig('stop_times.txt'), (i, regel) => {
    regelsGelezen += 1;
    if (regelsGelezen % 2_000_000 === 0) log(`    ${regelsGelezen / 1e6} miljoen regels…`);

    // Snelle voorfilter: het trip_id staat vooraan in vrijwel elke feed.
    const eersteKomma = regel.indexOf(0x2c);
    if (eersteKomma === -1) return;
    const tripId = regel.subarray(0, eersteKomma).toString('utf8');
    if (!trips.has(tripId)) return;

    const velden = splitCsv(regel);
    const stopId = velden[i('stop_id')];
    const aankomst = seconden(velden[i('arrival_time')]);
    const vertrek = seconden(velden[i('departure_time')]);
    const volgorde = Number(velden[i('stop_sequence')]) || 0;

    if (aankomst == null && vertrek == null) return;
    if (!reisStops.has(tripId)) reisStops.set(tripId, []);
    reisStops.get(tripId).push([stopId, aankomst, vertrek, volgorde]);
  });
  log(`  stop_times: ${regelsGelezen} regels, ${reisStops.size} treinreizen`);

  /* 5. Alleen reizen die in de buurt komen. */
  const inRegio = (reis) => {
    if (alles) return true;
    return reis.some(([stopId]) => {
      const stop = stops.get(stopId);
      if (!stop?.lat) return false;
      return afstandKm(REGIO, { lat: stop.lat, lon: stop.lon }) <= REGIO.straalKm;
    });
  };

  /*
   * 6. Wanneer rijdt een dienst?
   *
   * De Nederlandse feed heeft geen calendar.txt met weekregels; hij zet elke
   * datum waarop een dienst rijdt los in calendar_dates.txt. Dat is precies
   * genoeg — en nauwkeuriger dan weekregels, want feestdagen zitten er al in.
   * Heeft een feed wél weekregels, dan gebruiken we die als aanvulling.
   */
  const services = new Map();

  if (inhoud.has('calendar.txt')) {
    await leesCsv(pad, nodig('calendar.txt'), (i, regel) => {
      const velden = splitCsv(regel);
      services.set(velden[i('service_id')], {
        dagen: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
          (d) => velden[i(d)] === '1',
        ),
        van: velden[i('start_date')],
        tot: velden[i('end_date')],
        data: [],
      });
    });
  }

  if (inhoud.has('calendar_dates.txt')) {
    await leesCsv(pad, nodig('calendar_dates.txt'), (i, regel) => {
      const velden = splitCsv(regel);
      const id = velden[i('service_id')];
      const datum = velden[i('date')];
      const type = Number(velden[i('exception_type')]);

      if (!services.has(id)) services.set(id, { dagen: null, van: null, tot: null, data: [] });
      const dienst = services.get(id);

      if (type === 1) dienst.data.push(datum);
      else dienst.data = dienst.data.filter((d) => d !== datum);
    });
  }

  for (const dienst of services.values()) dienst.data.sort();

  /* 7. Alles compact wegschrijven. */
  const stopLijst = [];
  const stopIndex = new Map();
  const indexVoor = (id) => {
    if (!stopIndex.has(id)) {
      const stop = stops.get(id) ?? { naam: id, lat: null, lon: null, ouder: null };
      stopIndex.set(id, stopLijst.length);
      stopLijst.push({ id, naam: stop.naam, lat: stop.lat, lon: stop.lon, ouder: stop.ouder });
    }
    return stopIndex.get(id);
  };

  const routeLijst = [...routes.entries()].map(([id, route]) => ({ id, ...route }));
  const routeIndex = new Map(routeLijst.map((r, n) => [r.id, n]));

  const dienstLijst = [...services.entries()].map(([id, dienst]) => ({
    id,
    dagen: dienst.dagen ?? null,
    van: dienst.van ?? null,
    tot: dienst.tot ?? null,
    data: dienst.data ?? [],
  }));
  const dienstIndex = new Map(dienstLijst.map((d, n) => [d.id, n]));

  const reizen = [];
  let overgeslagen = 0;

  for (const [tripId, stopsVanReis] of reisStops) {
    if (!inRegio(stopsVanReis)) {
      overgeslagen += 1;
      continue;
    }

    const trip = trips.get(tripId);
    stopsVanReis.sort((a, b) => a[3] - b[3]);

    reizen.push({
      id: tripId,
      route: routeIndex.get(trip.route),
      dienst: dienstIndex.get(trip.service),
      kop: trip.kop,
      stops: stopsVanReis.map(([stopId, aankomst, vertrek]) => [indexVoor(stopId), aankomst, vertrek]),
    });
  }

  const net = {
    versie: 1,
    gegenereerd: new Date().toISOString(),
    bron: BRON,
    regio: alles ? null : { ...REGIO, straalKm: REGIO.straalKm },
    stops: stopLijst,
    routes: routeLijst,
    diensten: dienstLijst,
    reizen,
  };

  await mkdir(MAP, { recursive: true });
  await writeFile(NET_PAD, JSON.stringify(net), 'utf8');
  const info = await stat(NET_PAD);

  log('');
  log(`  geschreven: ${path.relative(process.cwd(), NET_PAD)} (${(info.size / 1e6).toFixed(1)} MB)`);
  log(`  ${reizen.length} reizen in de regio, ${overgeslagen} erbuiten gelaten`);
  log(`  ${stopLijst.length} haltes, ${routeLijst.length} routes`);
  log(`  klaar in ${Math.round((Date.now() - start) / 1000)}s`);
  log('');
}

main().catch((fout) => {
  console.error(`\n  FOUT: ${fout.message}\n`);
  process.exitCode = 1;
});
