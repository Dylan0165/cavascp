/**
 * Praten met de NS.
 *
 * WAAROM DIT ER IS
 *
 * De stagebot wist tot nu toe alleen hoe ver een station is: "0,8 km van
 * station Roosendaal". Dat zegt niets over of je er in de ochtendspits komt.
 * Met de NS-API wordt dat een echte reistijd: hoeveel minuten, hoeveel
 * overstappen, en of er iets aan de hand is op de lijn.
 *
 * WAT JE NODIG HEBT
 *
 * Een sleutel van https://apiportal.ns.nl — account maken, het gratis product
 * "Ns-App" nemen, en de Primary key in .env zetten:
 *
 *   NS_SUBSCRIPTION_KEY=...
 *
 * Zonder sleutel werkt de rest van het dashboard gewoon; alleen de reistijden
 * blijven dan leeg. Dat is geen stille fout: de CLI en het scherm zeggen dat
 * de koppeling ontbreekt.
 *
 * OVER DE VORM VAN DE ANTWOORDEN
 *
 * De NS-API heeft per endpoint een iets andere verpakking: het ene levert
 * `{ trips: [...] }`, het andere `{ payload: [...] }` of `{ payload: { departures: [...] } }`.
 * Deze module pelt dat eraf en geeft één vorm terug. Onbekende velden worden
 * niet gefabriceerd: ontbreekt iets, dan is het `null`.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inData, inProject, vindEnv } from '../../lib/paden.mjs';

const BASIS = process.env.NS_BASE_URL || 'https://gateway.api.ns.nl';
const TIMEOUT_MS = 20_000;

/* ────────────────────────────── de sleutel ────────────────────────────── */

/**
 * Zoekt de NS-sleutel: eerst de omgeving, dan de .env-bestanden.
 *
 * Dezelfde volgorde als bij Canvas en Gmail, zodat er één gewoonte is: zet je
 * sleutels in .env en de rest vindt ze.
 */
export function vindNsSleutel() {
  const uitOmgeving = process.env.NS_SUBSCRIPTION_KEY || process.env.NS_API_KEY;
  if (uitOmgeving) return { sleutel: uitOmgeving.trim(), bron: 'omgeving' };

  const kandidaten = [vindEnv(), inProject('.env'), path.join(process.env.HOME ?? '', '.dsh', '.env')].filter(
    Boolean,
  );

  for (const pad of kandidaten) {
    if (!existsSync(pad)) continue;
    let tekst;
    try {
      tekst = readFileSync(pad, 'utf8');
    } catch {
      continue;
    }
    for (const regel of tekst.split('\n')) {
      const match = /^\s*(NS_SUBSCRIPTION_KEY|NS_API_KEY)\s*=\s*(.*)\s*$/.exec(regel);
      if (match && match[2].trim()) {
        return { sleutel: match[2].trim().replace(/^["']|["']$/g, ''), bron: pad };
      }
    }
  }

  return null;
}

export function nsBeschikbaar() {
  return vindNsSleutel() !== null;
}

/* ─────────────────────────────── ophalen ──────────────────────────────── */

export class NsError extends Error {
  constructor(bericht, { status } = {}) {
    super(bericht);
    this.name = 'NsError';
    this.status = status ?? null;
  }
}

async function haal(pad, query = {}, { baseUrl, sleutel, timeoutMs = TIMEOUT_MS } = {}) {
  const gevonden = sleutel ? { sleutel } : vindNsSleutel();
  if (!gevonden?.sleutel) {
    throw new NsError(
      'Geen NS-sleutel. Maak er een op https://apiportal.ns.nl (product "Ns-App") en zet NS_SUBSCRIPTION_KEY in .env.',
    );
  }

  const url = new URL(pad, baseUrl ?? BASIS);
  for (const [sleutelNaam, waarde] of Object.entries(query)) {
    if (waarde === undefined || waarde === null || waarde === '') continue;
    url.searchParams.set(sleutelNaam, String(waarde));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const antwoord = await fetch(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': gevonden.sleutel,
        Accept: 'application/json',
        'User-Agent': 'cavascp-stagebot/1.0',
      },
      signal: controller.signal,
    });

    const tekst = await antwoord.text();
    let data = null;
    try {
      data = tekst ? JSON.parse(tekst) : null;
    } catch {
      data = null;
    }

    if (!antwoord.ok) {
      if (antwoord.status === 401 || antwoord.status === 403) {
        throw new NsError('De NS-API weigerde de sleutel. Controleer NS_SUBSCRIPTION_KEY.', {
          status: antwoord.status,
        });
      }
      const detail = data?.message ?? tekst.slice(0, 160);
      throw new NsError(`De NS-API gaf HTTP ${antwoord.status}${detail ? `: ${detail}` : ''}`, {
        status: antwoord.status,
      });
    }

    if (data === null) throw new NsError('De NS-API gaf geen JSON terug.');
    return data;
  } catch (fout) {
    if (fout.name === 'AbortError') {
      throw new NsError(`De NS-API antwoordde niet binnen ${Math.round(timeoutMs / 1000)} seconden.`);
    }
    throw fout;
  } finally {
    clearTimeout(timer);
  }
}

/* ───────────────────────────── hulpjes ────────────────────────────────── */

/** "Roosendaal" of "Station Roosendaal" → "Roosendaal". */
export function schoneStationsnaam(naam) {
  return String(naam ?? '')
    .replace(/^station\s+/i, '')
    .trim();
}

/** 'yyyy-MM-ddTHH:mm:ss', lokale tijd — dat is wat de NS verwacht. */
export function nsDatum(datum) {
  const d = new Date(datum);
  const twee = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${twee(d.getMonth() + 1)}-${twee(d.getDate())}T${twee(d.getHours())}:${twee(
    d.getMinutes(),
  )}:00`;
}

function datumVan(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function minutenTussen(a, b) {
  if (!a || !b) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}

/* ───────────────────────────── reisadvies ─────────────────────────────── */

/**
 * Reistijden van A naar B.
 *
 * @param {object} opties
 * @param {string} opties.van         stationsnaam of code
 * @param {string} opties.naar
 * @param {string|Date} [opties.vertrek]  vertrektijd; default nu
 * @param {string|Date} [opties.aankomst] laatste aankomsttijd (dan zoekt NS terug)
 * @param {number} [opties.aantal]     hoeveel opties (max 5)
 */
export async function reisadvies({ van, naar, vertrek, aankomst, aantal = 3, ...rest }) {
  const query = {
    fromStation: schoneStationsnaam(van),
    toStation: schoneStationsnaam(naar),
    searchForArrival: aankomst ? 'true' : undefined,
    dateTime: nsDatum(aankomst ?? vertrek ?? new Date()),
  };

  const data = await haal('/reisinformatie-api/api/v3/trips', query, rest);
  const trips = Array.isArray(data?.trips) ? data.trips : [];

  return trips.slice(0, Math.max(1, Math.min(5, aantal))).map(normaliseerTrip).filter(Boolean);
}

function normaliseerTrip(trip, index) {
  const legs = Array.isArray(trip?.legs) ? trip.legs : [];
  if (!legs.length) return null;

  const eerste = legs[0];
  const laatste = legs[legs.length - 1];

  const vertrekDatum = datumVan(eerste?.origin?.actualDateTime ?? eerste?.origin?.plannedDateTime);
  const aankomstDatum = datumVan(
    laatste?.destination?.actualDateTime ?? laatste?.destination?.plannedDateTime,
  );

  const geplandeMinuten =
    trip.plannedDurationInMinutes ??
    legs.reduce((som, leg) => som + (leg.plannedDurationInMinutes ?? 0), 0) ??
    null;

  return {
    nummer: index + 1,
    van: eerste?.origin?.name ?? null,
    naar: laatste?.destination?.name ?? null,
    vertrek: vertrekDatum?.toISOString() ?? null,
    aankomst: aankomstDatum?.toISOString() ?? null,
    minuten: minutenTussen(vertrekDatum, aankomstDatum) ?? geplandeMinuten ?? null,
    geplandMinuten: geplandeMinuten || null,
    overstappen: Number.isFinite(trip.transfers) ? trip.transfers : Math.max(0, legs.length - 1),
    vertragingMinuten:
      vertrekDatum && eerste?.origin?.plannedDateTime
        ? minutenTussen(datumVan(eerste.origin.plannedDateTime), vertrekDatum)
        : null,
    geannuleerd: legs.some((leg) => leg.cancelled === true),
    vol: legs.map((leg) => ({
      soort: leg.product?.shortCategoryName ?? leg.product?.categoryCode ?? null,
      lijn: leg.product?.number ?? leg.name ?? null,
      richting: leg.direction ?? null,
      van: leg.origin?.name ?? null,
      naar: leg.destination?.name ?? null,
      vertrekSpoor: leg.origin?.actualTrack ?? leg.origin?.plannedTrack ?? null,
      aankomstSpoor: leg.destination?.actualTrack ?? leg.destination?.plannedTrack ?? null,
      minuten:
        leg.actualDurationInMinutes ??
        leg.plannedDurationInMinutes ??
        minutenTussen(datumVan(leg.origin?.actualDateTime), datumVan(leg.destination?.actualDateTime)),
    })),
  };
}

/** De snelste optie, of null als er niets is. */
export function snelsteReis(reizen) {
  if (!Array.isArray(reizen) || !reizen.length) return null;
  return reizen.reduce((beste, reis) => (reis.minuten < beste.minuten ? reis : beste));
}

/* ───────────────────────────── storingen ──────────────────────────────── */

/**
 * Actuele en geplande werkzaamheden.
 *
 * Filteren op station doen we zelf: de API levert alles, en de velden waarin
 * de betrokken stations staan verschillen per storingstype.
 */
export async function storingen({ station, alleenActief = true, ...rest } = {}) {
  const data = await haal('/reisinformatie-api/api/v3/disruptions', {}, rest);
  const lijst = Array.isArray(data?.payload) ? data.payload : Array.isArray(data) ? data : [];

  const gezocht = station ? schoneStationsnaam(station).toLowerCase() : null;

  return lijst
    .filter((storing) => (alleenActief ? storing.isActive !== false : true))
    .filter((storing) => {
      if (!gezocht) return true;
      const tekst = JSON.stringify(storing).toLowerCase();
      return tekst.includes(gezocht);
    })
    .map((storing) => ({
      titel: storing.title ?? storing.type ?? 'Onbekende storing',
      actief: storing.isActive !== false,
      van: storing.start ?? null,
      tot: storing.end ?? null,
      soort: storing.type ?? null,
      oorzaak: storing.impact?.cause ?? null,
      bericht: eersteBoodschap(storing),
    }));
}

function eersteBoodschap(storing) {
  const fase = (storing.phases ?? []).find((f) => f.status === 'ACTIVE') ?? (storing.phases ?? [])[0];
  return fase?.label ?? fase?.description ?? storing.title ?? null;
}

/* ──────────────────────────── vertrektijden ───────────────────────────── */

export async function vertrekken({ station, richting, aantal = 8, ...rest } = {}) {
  const data = await haal('/reisinformatie-api/api/v2/departures', {
    station: schoneStationsnaam(station),
    maxJourneys: Math.max(1, Math.min(20, aantal)),
  }, rest);

  const lijst = data?.payload?.departures ?? data?.departures ?? [];

  return lijst
    .filter((trein) => (richting ? String(trein.direction ?? '').toLowerCase().includes(richting.toLowerCase()) : true))
    .map((trein) => ({
      richting: trein.direction ?? null,
      vertrek: trein.actualDateTime ?? trein.plannedDateTime ?? null,
      gepland: trein.plannedDateTime ?? null,
      spoor: trein.actualTrack ?? trein.plannedTrack ?? null,
      soort: trein.trainCategory ?? null,
      lijn: trein.name ?? trein.product?.number ?? null,
      geannuleerd: trein.cancelled === true,
      vertragingMinuten:
        trein.plannedDateTime && trein.actualDateTime
          ? minutenTussen(datumVan(trein.plannedDateTime), datumVan(trein.actualDateTime))
          : null,
    }));
}

/* ─────────────────────────────── stations ─────────────────────────────── */

export async function zoekStations(zoekterm, { aantal = 8, ...rest } = {}) {
  const data = await haal('/reisinformatie-api/api/v2/stations', {}, rest);
  const lijst = Array.isArray(data?.payload) ? data.payload : [];
  const term = String(zoekterm ?? '').toLowerCase().trim();

  return lijst
    .filter((s) => {
      if (!term) return true;
      const namen = [s.namen?.lang, s.namen?.middel, s.namen?.kort, s.code, s.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return namen.includes(term);
    })
    .slice(0, aantal)
    .map((s) => ({
      code: s.code ?? null,
      naam: s.namen?.lang ?? s.name ?? null,
      kort: s.namen?.kort ?? null,
      lat: s.lat ?? null,
      lon: s.lng ?? null,
      land: s.land ?? null,
    }));
}

/* ────────────────────────────── cache ─────────────────────────────────── */

const CACHE_PAD = inData('stagebot', 'cache', 'ns.json');

/**
 * Reistijden veranderen zelden; dezelfde vraag binnen een dag opnieuw stellen
 * is zonde van de aanvraaglimiet. Twee uur is kort genoeg om werkzaamheden te
 * merken en lang genoeg om een ochtend te overbruggen.
 */
export function leesNsCache() {
  if (!existsSync(CACHE_PAD)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PAD, 'utf8'));
  } catch {
    return {};
  }
}

export function bewaarNsCache(cache) {
  mkdirSync(path.dirname(CACHE_PAD), { recursive: true });
  writeFileSync(CACHE_PAD, JSON.stringify(cache), 'utf8');
}

export async function metCache(sleutel, functie, { maxAgeMs = 2 * 60 * 60 * 1000 } = {}) {
  const cache = leesNsCache();
  const bestaand = cache[sleutel];
  if (bestaand && Date.now() - Date.parse(bestaand.op) < maxAgeMs) return bestaand.waarde;

  const waarde = await functie();
  cache[sleutel] = { op: new Date().toISOString(), waarde };
  bewaarNsCache(cache);
  return waarde;
}
