/**
 * Waar je zoekt: de omgeving van Roosendaal.
 *
 * Twee vragen worden hier beantwoord:
 *
 *   1. Ligt dit bedrijf in de regio die je wilt?
 *   2. Hoe kom je er met het openbaar vervoer?
 *
 * OVER DE OV-KANT, EERLIJK
 *
 * Een echte reistijd vraagt een routeplanner (9292, NS) met een key. Die is er
 * niet, dus rekenen we met de hemelsbrede afstand tot het dichtstbijzijnde
 * station. Dat is een proxy: 800 meter van een station is vrijwel altijd te
 * lopen, 8 kilometer is een busrit waar je op moet wachten. De klassen zijn
 * daarom grof en met opzet voorzichtig — je ziet de kilometers erbij, dus je
 * kunt zelf beoordelen of het te doen is.
 */

import { overpass, bruikbareElementen, leesCache, bewaarCache } from './osm.mjs';
import { geocode } from './geo.mjs';

/** Je woonplaats. Alles wordt hiervandaan gerekend. */
export const THUIS = { plaats: 'Roosendaal', lat: 51.5305, lon: 4.4653 };

/** Hoe ver we kijken. Breda, Bergen op Zoom en Etten-Leur vallen hierbinnen. */
export const STRAAL_KM = 25;

const STATIONS_CACHE = 'stations';

/** Hemelsbrede afstand in kilometers. */
export function afstandKm(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Hoe noemen we de bereikbaarheid?
 *
 * De grenzen zijn gekozen op wat je nog loopt of snel haalt, niet op reistijd.
 * Bij twijfel de voorzichtige kant: een stage waar je twee keer per dag een
 * kwartier op een bus staat te wachten is geen goede stage.
 */
export function ovKlasse(km) {
  if (km == null) return 'onbekend';
  if (km <= 1.5) return 'loopafstand';
  if (km <= 4.0) return 'korte rit';
  return 'verder';
}

/** Voor sorteren: loopafstand eerst. */
export const OV_RANG = { loopafstand: 0, 'korte rit': 1, verder: 2, onbekend: 3 };

/**
 * De stations waar het vanaf Roosendaal om gaat.
 *
 * Deze lijst is met de hand samengesteld en klein: het zijn de haltes op de
 * lijnen die vanaf Roosendaal rechtstreeks te bereiken zijn, plus de dorpen
 * ertussen. Voor een stagezoektocht in West-Brabant is dat genoeg, en het
 * scheelt een afhankelijkheid van een dienst die er regelmatig uit ligt.
 */
const STATION_NAMEN = [
  'Station Roosendaal',
  'Station Oudenbosch',
  'Station Zevenbergen',
  'Station Etten-Leur',
  'Station Breda-Prinsenbeek',
  'Station Breda',
  'Station Bergen op Zoom',
  'Station Rilland-Bath',
];

/**
 * Stations in de omgeving.
 *
 * Eerst OpenStreetMap in één query. Lukt dat niet — de publieke Overpass is
 * geregeld overbelast — dan zoeken we dezelfde haltes één voor één op via
 * Nominatim. Dat is trager, maar het werkt en het antwoord is hetzelfde.
 */
export async function laadStations({ force = false } = {}) {
  if (!force) {
    const gecached = leesCache(STATIONS_CACHE);
    if (gecached?.stations?.length) return gecached.stations;
  }

  try {
    const query = `[out:json][timeout:180];
nwr["railway"="station"]["station"!="subway"](around:30000,${THUIS.lat},${THUIS.lon});
out center tags;`;

    // Korter dan de standaard: dit is een opstapje, geen hoofdtaak. Duurt het
    // langer, dan is Nominatim hieronder sneller klaar.
    const data = await overpass(query, { timeoutMs: 60_000 });
    const stations = bruikbareElementen(data)
      .map((e) => ({
        naam: e.tags.name,
        lat: e.lat ?? e.center?.lat,
        lon: e.lon ?? e.center?.lon,
        spoor: e.tags['railway:traffic_mode'] ?? null,
      }))
      .filter((s) => s.lat != null && s.lon != null);

    if (stations.length) {
      bewaarCache(STATIONS_CACHE, { stations, bron: 'overpass' });
      return stations;
    }
  } catch {
    // Val terug op Nominatim; hieronder.
  }

  const stations = [];
  for (const naam of STATION_NAMEN) {
    try {
      const g = await geocode(naam);
      if (g && /station/.test(g.soort)) {
        stations.push({ naam: g.naam, lat: g.lat, lon: g.lon, spoor: null });
      }
    } catch {
      // Eén station dat niet gevonden wordt mag de rest niet tegenhouden.
    }
  }

  if (stations.length) bewaarCache(STATIONS_CACHE, { stations, bron: 'nominatim' });
  return stations;
}

/** Het dichtstbijzijnde station bij een bedrijf. */
export function dichtstbijzijndeStation(lat, lon, stations) {
  let beste = null;
  for (const s of stations) {
    const km = afstandKm({ lat, lon }, s);
    if (!beste || km < beste.km) beste = { naam: s.naam, km: Math.round(km * 10) / 10 };
  }
  return beste;
}

/**
 * Beoordeelt een bedrijf: afstand tot jou, afstand tot een station, en hoe we
 * dat noemen.
 */
export function beoordeelLocatie({ lat, lon }, stations = []) {
  if (lat == null || lon == null) {
    return { vanHuisKm: null, station: null, ov: 'onbekend' };
  }
  const station = stations.length ? dichtstbijzijndeStation(lat, lon, stations) : null;
  return {
    vanHuisKm: Math.round(afstandKm(THUIS, { lat, lon }) * 10) / 10,
    station,
    ov: ovKlasse(station?.km),
  };
}

/** Ligt het binnen de straal rond Roosendaal? */
export function inRegio({ lat, lon }, straalKm = STRAAL_KM) {
  if (lat == null || lon == null) return false;
  return afstandKm(THUIS, { lat, lon }) <= straalKm;
}

/**
 * Plaatsnamen in de regio.
 *
 * Waarom dit bestaat: van een bedrijf dat je zelf toevoegde weten we de plaats
 * niet, en dan blijft de OV-kolom leeg. De eigen site noemt bijna altijd waar
 * ze zitten ("Ons kantoor in Breda"), dus daar zoeken we naar.
 *
 * Bewust een vaste lijst en geen algemene plaatsnaamdetectie: een bedrijf dat
 * een klant in Groningen noemt, moet niet ineens in Groningen liggen.
 */
export const REGIO_PLAATSEN = [
  'Roosendaal',
  'Breda',
  'Bergen op Zoom',
  'Etten-Leur',
  'Oudenbosch',
  'Zevenbergen',
  'Rucphen',
  'Steenbergen',
  'Wouw',
  'Kruisland',
  'Zundert',
  'Rijsbergen',
  'Hoogerheide',
  'Halsteren',
  'Moerdijk',
  'Lage Zwaluwe',
  'Made',
  'Prinsenbeek',
  'Oosterhout',
  'Oud Gastel',
  'Sint Willebrord',
  'Bosschenhoofd',
  'Hoeven',
  'Dinteloord',
  'Klundert',
  'Fijnaart',
  'Zegge',
  'Sprundel',
];

/**
 * De eerstgenoemde regiogemeente in een tekst.
 *
 * "Eerstgenoemde" en niet "de vaakst genoemde": een bedrijf noemt zijn eigen
 * vestiging meestal bovenaan, en de footer met vestigingen in andere plaatsen
 * telt dan niet mee.
 */
export function vindPlaats(tekst) {
  const schoon = String(tekst ?? '');
  if (!schoon) return null;

  let beste = null;
  for (const plaats of REGIO_PLAATSEN) {
    const patroon = new RegExp(`\\b${plaats.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const match = patroon.exec(schoon);
    if (match && (!beste || match.index < beste.index)) {
      beste = { plaats, index: match.index };
    }
  }
  return beste?.plaats ?? null;
}
