/**
 * Bedrijven vinden in de regio.
 *
 * De stageborden gaven niets, en zelf zoeken kost per bedrijf een half uur. Dus
 * halen we eerst een lijst kandidaten op uit OpenStreetMap: bedrijven met een
 * ICT-tag binnen de straal rond Roosendaal, met een website. Die website is
 * het enige wat we nodig hebben om de rest te doen — lezen, beoordelen, mailen.
 *
 * WAT HIER NIET GEBEURT
 *
 * We mailen niemand. Deze module vult een lijst; wat er daarna mee gebeurt
 * bepaal jij. Zie ook docs/stagebot.md over volume.
 */

import { existsSync, readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { inData } from '../../mcp/lib/paden.mjs';
import { overpass, bruikbareElementen, leesCache, bewaarCache } from './osm.mjs';
import { THUIS, STRAAL_KM, laadStations, beoordeelLocatie, inRegio, OV_RANG } from './regio.mjs';
import { voegKandidaatToe, leesBedrijven, zoekBedrijf, werkBij } from './bedrijven.mjs';
import { normaliseerUrl, domeinVan } from './scan.mjs';

const CACHE_NAAM = 'bedrijven';

/** Wat voor bedrijven we zoeken. ICT en alles wat daar direct aan raakt. */
/*
 * Twee soorten tags.
 *
 * De eerste groep is per definitie ICT: die nemen we altijd mee. De tweede
 * groep is "een bedrijf" in het algemeen — daar zit van alles tussen, van een
 * installateur tot een bakkerij. Die nemen we alleen mee als de naam of het
 * domein naar ICT wijst, anders staat je wachtrij binnen een minuut vol met
 * bedrijven waar je geen stage in de ICT kunt doen.
 */
const ZOEKTERMEN = {
  ict: [
    ['office', 'it'],
    ['office', 'software'],
    ['office', 'telecommunication'],
    ['shop', 'computer'],
    ['craft', 'electronics'],
  ],
  algemeen: [
    ['office', 'company'],
    ['office', 'consulting'],
    ['office', 'engineer'],
  ],
};

/** Woorden die op een ICT-bedrijf wijzen. */
const ICT_WOORDEN =
  /(^|[^a-z])(ict|it|software|data|digital|web|cloud|security|cyber|netwerk|netwerken|automatisering|hosting|internet|applicatie|applicaties|developer|programmeur|systeembeheer|systeem|ai)([^a-z]|$)/i;

/**
 * Sites die geen bedrijfssite zijn.
 *
 * Een Facebookpagina levert geen "over ons" op waar je naar kunt verwijzen, en
 * een link naar LinkedIn is geen website van het bedrijf zelf.
 */
const GEEN_BEDRIJFSSITE = /(facebook|linkedin|instagram|twitter|x\.com|youtube|tiktok)\./i;

function websiteVan(tags) {
  const ruw = tags.website ?? tags['contact:website'] ?? tags.url;
  if (!ruw) return null;
  if (GEEN_BEDRIJFSSITE.test(ruw)) return null;
  try {
    const url = normaliseerUrl(ruw);
    return domeinVan(url) ? url : null;
  } catch {
    return null;
  }
}

function tekstVanElement(el) {
  if (el.tags.name) return el.tags.name;
  return el.tags.operator ?? el.tags.brand ?? null;
}

function straatVan(tags) {
  const straat = tags['addr:street'];
  if (!straat) return null;
  return [straat, tags['addr:housenumber']].filter(Boolean).join(' ');
}

/**
 * Haalt kandidaten op uit OSM.
 *
 * @returns {Promise<Array>} kandidaten met naam, website, plaats, locatie en OV
 */
export async function zoekBedrijven({ straalKm = STRAAL_KM, force = false } = {}) {
  if (!force) {
    const gecached = leesCache(CACHE_NAAM);
    if (gecached?.kandidaten?.length) return gecached.kandidaten;
  }

  const rond = `(around:${Math.round(straalKm * 1000)},${THUIS.lat},${THUIS.lon})`;

  /*
   * Eén query per tag, niet één grote. De publieke Overpass-server geeft bij
   * een brede query regelmatig een 504; losse queries van één regel komen er
   * wel door. Het duurt langer, maar het werkt.
   */
  const elementen = [];
  for (const [soort, termen] of Object.entries(ZOEKTERMEN)) {
    for (const [sleutel, waarde] of termen) {
      const query = `[out:json][timeout:60];nwr["${sleutel}"="${waarde}"]["website"]${rond};out center tags;`;
      try {
        const data = await overpass(query, { timeoutMs: 90_000 });
        for (const element of bruikbareElementen(data)) {
          if (soort === 'algemeen') {
            const naam = `${element.tags.name ?? ''} ${element.tags.website ?? ''}`;
            if (!ICT_WOORDEN.test(naam)) continue;
          }
          elementen.push(element);
        }
      } catch (fout) {
        // Eén tag die niet langskomt mag de rest niet tegenhouden.
        console.warn(`  (${sleutel}=${waarde} overgeslagen: ${fout.message})`);
      }
    }
  }

  const stations = await laadStations().catch(() => []);
  const perDomein = new Map();

  for (const el of elementen) {
    const naam = tekstVanElement(el);
    const website = websiteVan(el.tags);
    if (!naam || !website) continue;

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    if (!inRegio({ lat, lon }, straalKm)) continue;

    const domein = domeinVan(website);
    if (perDomein.has(domein)) continue;

    const locatie = beoordeelLocatie({ lat, lon }, stations);
    perDomein.set(domein, {
      naam: String(naam).trim(),
      website,
      domein,
      plaats: el.tags['addr:city'] ?? el.tags['addr:place'] ?? null,
      straat: straatVan(el.tags),
      lat,
      lon,
      vanHuisKm: locatie.vanHuisKm,
      station: locatie.station,
      ov: locatie.ov,
      bron: 'openstreetmap',
      osmType: el.type,
      osmId: el.id,
    });
  }

  const gevonden = [...perDomein.values()];

  /*
   * OpenStreetMap bevat adressen die allang weg zijn. Die kosten elke dagrun
   * twintig seconden en leveren nooit iets op, dus filteren we ze er nu al uit
   * — op DNS, niet op de pagina (een 403 betekent "bot geweigerd", niet "weg").
   */
  const bestaand = [];
  for (const kandidaat of gevonden) {
    if (await bestaatDomein(kandidaat.domein)) bestaand.push(kandidaat);
  }

  const kandidaten = bestaand.sort(
    (a, b) => (OV_RANG[a.ov] ?? 3) - (OV_RANG[b.ov] ?? 3) || (a.vanHuisKm ?? 99) - (b.vanHuisKm ?? 99),
  );

  bewaarCache(CACHE_NAAM, { kandidaten });
  return kandidaten;
}

/**
 * Zet de kandidaten in je bedrijvenlijst, voor zover ze er nog niet in staan.
 *
 * Bestaande bedrijven worden niet overschreven: als je al een mail hebt
 * geschreven, wil je die niet kwijt omdat er een nieuwe zoekopdracht langskomt.
 */
export function voegKandidatenToe(kandidaten) {
  const bestaand = new Set(leesBedrijven().bedrijven.map((b) => b.domein));
  const nieuw = [];
  const overgeslagen = [];

  for (const k of kandidaten) {
    if (bestaand.has(k.domein)) {
      /*
       * Bestaat al — maar mist hij nog waar hij ligt? Dan vullen we dat aan.
       * Zonder deze stap blijft een bedrijf dat je eerder met de hand toevoegde
       * voor altijd "OV onbekend", ook al staat het in je eigen lijst met plaats.
       */
      const oud = zoekBedrijf(k.domein);
      if (oud && (oud.lat == null || oud.lon == null)) {
        werkBij(oud.id, (b) => {
          b.plaats = b.plaats ?? k.plaats ?? null;
          b.lat = b.lat ?? k.lat ?? null;
          b.lon = b.lon ?? k.lon ?? null;
          if (k.station) b.station = b.station ?? k.station;
          if (k.ov && k.ov !== 'onbekend') b.ov = k.ov;
          if (k.vanHuisKm != null) b.vanHuisKm = b.vanHuisKm ?? k.vanHuisKm;
        });
      }
      overgeslagen.push(k);
      continue;
    }
    const bedrijf = voegKandidaatToe(k);
    bestaand.add(k.domein);
    nieuw.push(bedrijf);
  }

  return { nieuw, overgeslagen };
}

/* ────────────────────────── bestaat die site? ──────────────────────────── */

/**
 * Kijkt of een domein bestaat, vóór het in de wachtrij komt.
 *
 * OpenStreetMap bevat adressen die allang weg zijn, en een handmatig geplakt
 * adres kan een typfout zijn. Zo'n bedrijf kost elke dagrun twintig seconden en
 * levert nooit iets op. Een DNS-lookup kost milliseconden en vangt het meeste.
 */
export async function bestaatDomein(domein) {
  try {
    await lookup(domein);
    return true;
  } catch {
    return false;
  }
}

/** Filtert kandidaten op een bestaand domein. */
export async function filterBereikbaar(kandidaten) {
  const uit = [];
  for (const kandidaat of kandidaten) {
    if (await bestaatDomein(kandidaat.domein)) uit.push(kandidaat);
  }
  return uit;
}

/* ───────────────────────── handmatige aanvoer ──────────────────────────── */


const SEED_PAD = inData('stagebot', 'seed-bedrijven.json');

/**
 * De handmatige lijst.
 *
 * OpenStreetMap is de automatische bron, maar die is soms uren onbereikbaar en
 * lang niet elk bedrijf staat erin. Deze lijst vult dat gat zonder dat je op
 * een API hoeft te wachten.
 */
export function seedKandidaten() {
  if (!existsSync(SEED_PAD)) return [];
  try {
    const data = JSON.parse(readFileSync(SEED_PAD, 'utf8'));
    return (data.bedrijven ?? [])
      .filter((b) => b.website)
      .map((b) => {
        const website = normaliseerUrl(b.website);
        return {
          naam: b.naam,
          website,
          domein: domeinVan(website),
          plaats: b.plaats ?? null,
          straat: null,
          lat: null,
          lon: null,
          vanHuisKm: null,
          station: null,
          ov: 'onbekend',
          bron: 'handmatig',
          notitie: b.notitie ?? null,
        };
      })
      .filter((b) => b.domein);
  } catch {
    return [];
  }
}

/**
 * Eén URL toevoegen die je zelf hebt gevonden.
 *
 * Dit is de route voor alles wat niet in OSM staat: een vacature op LinkedIn,
 * een bedrijf dat je kent, een tip van iemand.
 */
export async function voegUrlToe(url, { controleerDomein = true } = {}) {
  const website = normaliseerUrl(url);
  const domein = domeinVan(website);
  if (!domein) throw new Error(`Geen bruikbaar adres: ${url}`);
  if (controleerDomein && !(await bestaatDomein(domein))) {
    throw new Error(`Dat domein bestaat niet (${domein}). Controleer het adres.`);
  }

  const titel = domein.replace(/^www\./, '').split('.')[0];
  return voegKandidaatToe({
    naam: titel,
    website,
    domein,
    plaats: null,
    straat: null,
    lat: null,
    lon: null,
    vanHuisKm: null,
    station: null,
    ov: 'onbekend',
    bron: 'handmatig',
  });
}
