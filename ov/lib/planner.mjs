/**
 * Een reis plannen op onze eigen dienstregeling.
 *
 * WAAROM ZELF REKENEN
 *
 * De NS-API vraagt een sleutel via een portaal dat niet werkte, en de
 * OVapi-API's geven alleen losse vertrektijden per halte — geen reis van A
 * naar B. De dienstregeling hebben we wel, als GTFS-bestand. Dus rekenen we de
 * reis zelf uit.
 *
 * WAT VOOR ALGORITME
 *
 * Geen volledige RAPTOR: dat is nodig voor het hele land met bussen erbij. Wat
 * hier volstaat is een treinreis met hooguit één overstap — en dat is precies
 * wat een stagezoektocht vraagt ("kom ik er in de ochtend, en hoe lang duurt
 * het"). Directe reizen en reizen met één overstap dekken vrijwel alles in
 * Brabant.
 *
 * De aanpak:
 *   1. alle vertrekken per halte op de gevraagde dag, gesorteerd op tijd
 *   2. directe reizen van jouw halte naar de bestemming
 *   3. één overstap: elke tussenhalte van die reizen opnieuw als vertrekpunt
 *   4. de drie vroegst aankomende opties terug
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inData } from '../../mcp/lib/paden.mjs';

const NET_PAD = inData('ov', 'net.json');

/** Hoe lang je minimaal nodig hebt om over te stappen. */
const OVERSTAP_SECONDEN = 120;

/** Verder dan dit vooruit kijken heeft geen zin voor een ochtendreis. */
const ZOEKVENSTER_SECONDEN = 3 * 60 * 60;

/* ─────────────────────────────── inladen ───────────────────────────────── */

let netCache = null;

export function netPad() {
  return NET_PAD;
}

export function isGeimporteerd() {
  try {
    readFileSync(NET_PAD);
    return true;
  } catch {
    return false;
  }
}

export function laadNet() {
  if (netCache) return netCache;
  try {
    netCache = JSON.parse(readFileSync(NET_PAD, 'utf8'));
    return netCache;
  } catch {
    throw new Error(
      `Geen dienstregeling gevonden (${path.relative(process.cwd(), NET_PAD)}). Draai eerst: node ov/import.mjs`,
    );
  }
}

export function wisCache() {
  netCache = null;
  indexCache.clear();
}

/* ────────────────────────────── datum en dienst ────────────────────────── */

const DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

/** 'YYYYMMDD' voor een Date. */
export function ymd(datum) {
  const twee = (n) => String(n).padStart(2, '0');
  return `${datum.getFullYear()}${twee(datum.getMonth() + 1)}${twee(datum.getDate())}`;
}

/** Seconden sinds middernacht van een datum. */
export function secondenVanDag(datum) {
  return datum.getHours() * 3600 + datum.getMinutes() * 60 + datum.getSeconds();
}

/** "08:30" of een Date → seconden. */
export function alsSeconden(waarde) {
  if (waarde == null) return null;
  if (waarde instanceof Date) return secondenVanDag(waarde);
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(waarde).trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

export function alsTijd(seconden) {
  if (seconden == null) return null;
  const s = ((seconden % 86400) + 86400) % 86400;
  const twee = (n) => String(n).padStart(2, '0');
  return `${twee(Math.floor(s / 3600))}:${twee(Math.floor((s % 3600) / 60))}`;
}

/**
 * Rijdt deze dienst op deze dag?
 *
 * Twee soorten feeds: met losse datums per dienst (de Nederlandse), en met
 * weekregels plus uitzonderingen. Beide moeten werken, en de losse datums
 * gaan voor — die zijn nauwkeuriger.
 */
export function dienstActief(dienst, datum) {
  if (!dienst) return false;
  const dag = ymd(datum);

  if (dienst.data?.length) return bevatDatum(dienst.data, dag);

  if (dienst.van && dag < dienst.van) return false;
  if (dienst.tot && dag > dienst.tot) return false;
  if (!dienst.dagen) return false;

  return Boolean(dienst.dagen[datum.getDay() === 0 ? 6 : datum.getDay() - 1]);
}

/** Binair zoeken in een gesorteerde lijst datums ('YYYYMMDD'). */
function bevatDatum(lijst, dag) {
  let laag = 0;
  let hoog = lijst.length - 1;

  while (laag <= hoog) {
    const midden = (laag + hoog) >> 1;
    if (lijst[midden] === dag) return true;
    if (lijst[midden] < dag) laag = midden + 1;
    else hoog = midden - 1;
  }
  return false;
}

/**
 * De volgende werkdag.
 *
 * Een stageplanning is een werkdagplanning; zaterdag en zondag hebben een
 * andere dienstregeling en zeggen niets over of je er kunt komen werken.
 */
export function volgendeWerkdag(nu = new Date()) {
  const datum = new Date(nu);
  datum.setDate(datum.getDate() + 1);
  while (datum.getDay() === 0 || datum.getDay() === 6) datum.setDate(datum.getDate() + 1);
  datum.setHours(0, 0, 0, 0);
  return datum;
}

/* ─────────────────────────── index per dag ─────────────────────────────── */

const indexCache = new Map();

/**
 * Alle vertrekken per halte, voor één dag.
 *
 * Dit is het dure stuk (tienduizenden reizen), dus het resultaat blijft staan
 * per datum. Een server die de hele dag dezelfde vragen krijgt, rekent dit één
 * keer uit.
 */
export function bouwIndex(net, datum) {
  const sleutel = ymd(datum);
  if (indexCache.has(sleutel)) return indexCache.get(sleutel);

  const diensten = net.diensten.map((dienst) => dienstActief(dienst, datum));

  /** halte-index → [{ reis, volgorde, vertrek, aankomst }] */
  const perHalte = new Map();

  net.reizen.forEach((reis, reisIndex) => {
    if (!diensten[reis.dienst]) return;

    const stops = reis.stops;
    for (let i = 0; i < stops.length; i += 1) {
      const [halte, aankomst, vertrek] = stops[i];
      const tijd = vertrek ?? aankomst;
      if (tijd == null) continue;

      if (!perHalte.has(halte)) perHalte.set(halte, []);
      perHalte.get(halte).push({ reis: reisIndex, volgorde: i, vertrek: tijd, aankomst: aankomst ?? tijd });
    }
  });

  for (const lijst of perHalte.values()) lijst.sort((a, b) => a.vertrek - b.vertrek);

  const index = { datum: sleutel, perHalte, diensten };
  indexCache.set(sleutel, index);
  return index;
}

/* ─────────────────────────────── zoeken ────────────────────────────────── */

/** Normaliseert een stationsnaam: "Station Breda" en "breda" zijn hetzelfde. */
function norm(tekst) {
  return String(tekst ?? '')
    .toLowerCase()
    .replace(/^station\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Zoekt haltes bij een naam.
 *
 * Een station heeft in GTFS vaak meerdere haltes (per spoor) onder één
 * bovenliggende halte. We zoeken op de bovenliggende naam en geven alle
 * onderliggende haltes terug, anders mis je de helft van de treinen.
 */
export function zoekHaltes(net, naam) {
  const gezocht = norm(naam);
  if (!gezocht) return [];

  const exact = [];
  const bevat = [];

  net.stops.forEach((stop, index) => {
    if (!stop.naam) return;
    const naamVanStop = norm(stop.naam);
    if (naamVanStop === gezocht) exact.push(index);
    else if (naamVanStop.includes(gezocht)) bevat.push(index);
  });

  const gevonden = exact.length ? exact : bevat;

  // Onderliggende haltes van dezelfde bovenliggende halte meenemen.
  const ouders = new Set(gevonden.map((i) => net.stops[i].id));
  net.stops.forEach((stop, index) => {
    if (stop.ouder && ouders.has(stop.ouder)) gevonden.push(index);
  });

  return [...new Set(gevonden)];
}

export function naamVanHalte(net, index) {
  return net.stops[index]?.naam ?? '?';
}

/**
 * Alle reizen die op het gevraagde moment vanaf de vertrekhalte beginnen.
 *
 * Dit is de buitenste lus van het zoeken: elke trein die je zou kunnen pakken.
 */
function vertrekkenVanaf(net, index, vanHaltes, vanafSeconden) {
  const uit = [];
  for (const halte of vanHaltes) {
    for (const vertrek of index.perHalte.get(halte) ?? []) {
      if (vertrek.vertrek < vanafSeconden) continue;
      if (vertrek.vertrek > vanafSeconden + ZOEKVENSTER_SECONDEN) break;
      uit.push({ ...vertrek, vanHalte: halte });
    }
  }
  return uit;
}

/**
 *zoekt vanaf één vertrek: directe reizen én reizen met één overstap.
 *
 * Waarom niet eerst "direct" bepalen en daarna overstappen zoeken: dan zou je
 * alleen overstappen vanaf de bestemming bekijken. De overstap zit juist op
 * een tussenhalte van een trein die niet bij de bestemming eindigt.
 */
function zoekVanaf(net, index, vertrek, naarHaltes, vanafSeconden) {
  const direct = [];
  const metOverstap = [];

  const reis = net.reizen[vertrek.reis];
  const stops = reis.stops;

  const vertrekHaltes = new Set([vertrek.vanHalte]);

  for (let j = vertrek.volgorde + 1; j < stops.length; j += 1) {
    const [tussenHalte, aankomst] = stops[j];
    if (aankomst == null) continue;
    if (vertrekHaltes.has(tussenHalte)) continue;

    if (naarHaltes.has(tussenHalte)) {
      direct.push({
        vanHalte: vertrek.vanHalte,
        naarHalte: tussenHalte,
        vertrek: vertrek.vertrek,
        aankomst,
        legs: [
          {
            van: vertrek.vanHalte,
            naar: tussenHalte,
            vertrek: vertrek.vertrek,
            aankomst,
            reisIndex: vertrek.reis,
          },
        ],
      });
    }

    // Overstappen op deze tussenhalte.
    const vroegste = aankomst + OVERSTAP_SECONDEN;
    for (const tweede of index.perHalte.get(tussenHalte) ?? []) {
      if (tweede.vertrek < vroegste) continue;
      if (tweede.vertrek > vanafSeconden + ZOEKVENSTER_SECONDEN) break;
      if (tweede.reis === vertrek.reis) continue;

      const reis2 = net.reizen[tweede.reis];
      let gevonden = false;
      for (let k = tweede.volgorde + 1; k < reis2.stops.length; k += 1) {
        const [eindHalte, eindAankomst] = reis2.stops[k];
        if (!naarHaltes.has(eindHalte) || eindAankomst == null) continue;

        metOverstap.push({
          vanHalte: vertrek.vanHalte,
          naarHalte: eindHalte,
          vertrek: vertrek.vertrek,
          aankomst: eindAankomst,
          legs: [
            {
              van: vertrek.vanHalte,
              naar: tussenHalte,
              vertrek: vertrek.vertrek,
              aankomst,
              reisIndex: vertrek.reis,
            },
            {
              van: tussenHalte,
              naar: eindHalte,
              vertrek: tweede.vertrek,
              aankomst: eindAankomst,
              reisIndex: tweede.reis,
            },
          ],
        });
        gevonden = true;
      }
      // De vroegste aansluiting is genoeg: later vertrekken komt zelden
      // eerder aan, en dit houdt de zoektocht klein.
      if (gevonden) break;
    }
  }

  return { direct, metOverstap };
}

/** De snelste paar opties, zonder dubbelen. */
function kiesBeste(kandidaten, aantal) {
  const gezien = new Set();
  const uniek = [];

  for (const kandidaat of kandidaten.sort((a, b) => a.aankomst - b.aankomst)) {
    const sleutel = `${kandidaat.vertrek}-${kandidaat.aankomst}-${kandidaat.legs.length}`;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);
    uniek.push(kandidaat);
    if (uniek.length >= aantal) break;
  }
  return uniek;
}

/**
 * Plant een reis.
 *
 * @param {object} net
 * @param {{van:string, naar:string, datum?:Date, vertrek?:string|number|Date, aantal?:number}} vraag
 */
export function plan(net, { van, naar, datum, vertrek, aantal = 3 }) {
  const dag = datum ?? volgendeWerkdag();
  const index = bouwIndex(net, dag);

  const vanHaltes = zoekHaltes(net, van);
  const naarHaltes = zoekHaltes(net, naar);

  if (!vanHaltes.length) throw new Error(`Onbekende vertrekhalte: ${van}`);
  if (!naarHaltes.length) throw new Error(`Onbekende bestemming: ${naar}`);

  const vanaf = alsSeconden(vertrek) ?? 8 * 3600;
  const naarSet = new Set(naarHaltes);

  /*
   * Woon je naast je werk? Dan zijn vertrek- en bestemmingshalte dezelfde
   * (andere perrons). Zonder deze regel zou de zoeker een trein nemen die
   * ergens heen gaat en terugkomt, en dat als "75 minuten, 1 overstap"
   * presenteren.
   */
  if (vanHaltes.some((halte) => naarSet.has(halte))) {
    const naam = naamVanHalte(net, vanHaltes[0]);
    return [
      {
        van: naam,
        naar: naam,
        vertrek: alsTijd(vanaf),
        aankomst: alsTijd(vanaf),
        minuten: 0,
        overstappen: 0,
        legs: [],
      },
    ];
  }

  const vertrekken = vertrekkenVanaf(net, index, vanHaltes, vanaf);

  const direct = [];
  const overstap = [];
  for (const vertrek of vertrekken) {
    const uitkomst = zoekVanaf(net, index, vertrek, naarSet, vanaf);
    direct.push(...uitkomst.direct);
    overstap.push(...uitkomst.metOverstap);
  }

  return kiesBeste([...direct, ...overstap], aantal).map((kandidaat) => normaliseer(net, kandidaat));
}

function normaliseer(net, kandidaat) {
  const legs = kandidaat.legs.map((leg) => {
    const reis = net.reizen[leg.reisIndex];
    const route = net.routes[reis.route] ?? {};
    return {
      van: naamVanHalte(net, leg.van),
      naar: naamVanHalte(net, leg.naar),
      vertrek: alsTijd(leg.vertrek),
      aankomst: alsTijd(leg.aankomst),
      vertrekSeconden: leg.vertrek,
      aankomstSeconden: leg.aankomst,
      lijn: route.kort ?? route.lang ?? null,
      vervoerder: route.vervoerder ?? null,
      richting: reis.kop ?? null,
    };
  });

  return {
    van: legs[0]?.van ?? null,
    naar: legs[legs.length - 1]?.naar ?? null,
    vertrek: legs[0]?.vertrek ?? null,
    aankomst: legs[legs.length - 1]?.aankomst ?? null,
    minuten: Math.round((kandidaat.aankomst - kandidaat.vertrek) / 60),
    overstappen: legs.length - 1,
    legs,
  };
}

/** Alleen de reistijd van de snelste optie. */
export function snelsteReistijd(net, { van, naar, datum, vertrek } = {}) {
  const reizen = plan(net, { van, naar, datum, vertrek, aantal: 3 });
  if (!reizen.length) return null;
  return reizen.reduce((beste, reis) => (reis.aankomst < beste.aankomst ? reis : beste));
}

export { DAGEN };
