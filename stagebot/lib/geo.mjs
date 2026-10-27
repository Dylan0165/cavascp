/**
 * Waar staat een bedrijf?
 *
 * OpenStreetMap weet dat soms (een bedrijf dat iemand heeft ingetekend), maar
 * meestal niet. Dan rest de vraag: waar ligt "Daemen ICT" in Roosendaal? Daar
 * is Nominatim voor, de zoekdienst van OSM.
 *
 * TWEE REGELS
 *
 * 1. Eén verzoek per seconde. Dat is de afspraak van Nominatim en het is ook
 *    gewoon beleefd: dit is een dienst die door vrijwilligers wordt betaald.
 * 2. Het antwoord wordt bewaard. Een bedrijf verhuist niet elke week, en
 *    dezelfde vraag opnieuw stellen kost een seconde wachten voor niets.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inData } from '../../mcp/lib/paden.mjs';

const BASIS = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const CACHE_PAD = inData('stagebot', 'cache', 'geocode.json');
const UA = 'cavascp-stagebot/1.0 (lokaal dashboard; stagezoektocht)';

/** Nominatim wil maximaal één verzoek per seconde. */
const MIN_MS = 1100;
let laatsteVerzoek = 0;

function leesCache() {
  if (!existsSync(CACHE_PAD)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PAD, 'utf8'));
  } catch {
    return {};
  }
}

function bewaarCache(cache) {
  mkdirSync(path.dirname(CACHE_PAD), { recursive: true });
  writeFileSync(CACHE_PAD, JSON.stringify(cache, null, 2), 'utf8');
}

const sleutel = (query) => query.toLowerCase().replace(/\s+/g, ' ').trim();

async function wacht() {
  const sinds = Date.now() - laatsteVerzoek;
  if (sinds < MIN_MS) await new Promise((r) => setTimeout(r, MIN_MS - sinds));
  laatsteVerzoek = Date.now();
}

/**
 * Zoekt coördinaten bij een vrije tekst.
 *
 * @returns {Promise<{lat: number, lon: number, naam: string, soort: string}|null>}
 */
export async function geocode(query, { force = false } = {}) {
  if (!query) return null;
  const cache = leesCache();
  const k = sleutel(query);
  if (!force && cache[k]) return cache[k];

  await wacht();

  const url = `${BASIS}?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=0`;
  const antwoord = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });

  if (!antwoord.ok) {
    throw new Error(`Nominatim gaf HTTP ${antwoord.status}`);
  }

  const lijst = await antwoord.json();
  const eerste = Array.isArray(lijst) ? lijst[0] : null;
  if (!eerste) {
    cache[k] = null; // onthouden dat het niets opleverde; niet blijven vragen
    bewaarCache(cache);
    return null;
  }

  const uitkomst = {
    lat: Number(eerste.lat),
    lon: Number(eerste.lon),
    naam: eerste.name ?? eerste.display_name?.split(',')[0] ?? query,
    soort: `${eerste.class ?? ''}/${eerste.type ?? ''}`,
  };
  cache[k] = uitkomst;
  bewaarCache(cache);
  return uitkomst;
}

/** Coördinaten van een bedrijf: eerst de zaak zelf, dan de plaats. */
export async function geocodeBedrijf({ naam, plaats }) {
  const pogingen = [];
  if (naam && plaats) pogingen.push(`${naam}, ${plaats}`);
  if (naam) pogingen.push(naam);
  if (plaats) pogingen.push(plaats);

  for (const query of pogingen) {
    try {
      const uitkomst = await geocode(query);
      if (uitkomst) return { ...uitkomst, query };
    } catch {
      // Netwerkfout: de volgende poging is zinloos, maar de aanroeper mag
      // gewoon doorgaan zonder coördinaten.
      return null;
    }
  }
  return null;
}
