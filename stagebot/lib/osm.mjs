/**
 * Praten met OpenStreetMap.
 *
 * WAAROM OVERPASS EN GEEN ZOEKMACHINE
 *
 * Om bedrijven te vinden heb je een bron nodig. Een zoekmachine scrapen is
 * tegen de voorwaarden, levert HTML op die je moet interpreteren, en blokkeert
 * zodra je het vaker doet. OpenStreetMap is open data met een echte querytaal:
 * je vraagt "alle knoppen met office=it binnen 25 km" en krijgt coördinaten,
 * namen en vaak een website terug. Geen key, geen quota, geen scraping.
 *
 * De prijs: OSM is niet compleet. Een bedrijf dat niemand heeft ingetekend
 * bestaat voor deze zoekopdracht niet. Daarom is dit een aanvoer, geen
 * waarheid — je kunt in het dashboard altijd zelf een URL toevoegen.
 *
 * De API is traag (tientallen seconden is normaal) en soms overbelast. Daarom
 * een ruime time-out en een cache: dezelfde vraag twee keer stellen kost
 * anders elke keer een minuut.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inData } from '../../mcp/lib/paden.mjs';

const BASIS = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const CACHE_MAP = inData('stagebot', 'cache');
const UA = 'cavascp-stagebot/1.0 (stagezoektocht; lokaal dashboard)';

/** Dezelfde query binnen een week geeft vrijwel hetzelfde antwoord. */
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

function cachePad(naam) {
  return path.join(CACHE_MAP, `${naam}.json`);
}

export function leesCache(naam, maxAgeMs = CACHE_MS) {
  const pad = cachePad(naam);
  if (!existsSync(pad)) return null;
  try {
    const data = JSON.parse(readFileSync(pad, 'utf8'));
    if (!data.opgehaald) return null;
    if (Date.now() - Date.parse(data.opgehaald) > maxAgeMs) return null;
    return data;
  } catch {
    return null;
  }
}

export function bewaarCache(naam, waarde) {
  mkdirSync(CACHE_MAP, { recursive: true });
  const data = { opgehaald: new Date().toISOString(), ...waarde };
  writeFileSync(cachePad(naam), JSON.stringify(data), 'utf8');
  return data;
}

/**
 * Eén Overpass-query.
 *
 * De time-out is ruim omdat de server zelf ook tijd nodig heeft; een query van
 * 180 seconden aan de serverkant is geen fout. Bij een netwerkfout geven we de
 * echte melding door — geen lege lijst die eruitziet als "niets gevonden".
 */
export async function overpass(query, { timeoutMs = 240_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(BASIS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
      },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal,
    });

    const tekst = await res.text();
    if (!res.ok) {
      // Overpass zet zijn foutmelding in HTML; de eerste regels zijn genoeg.
      const reden = tekst.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(`Overpass gaf HTTP ${res.status}${reden ? `: ${reden}` : ''}`);
    }

    try {
      return JSON.parse(tekst);
    } catch {
      throw new Error('Overpass gaf geen JSON terug — probeer het later opnieuw');
    }
  } catch (fout) {
    if (fout.name === 'AbortError') {
      throw new Error(`Overpass reageerde niet binnen ${Math.round(timeoutMs / 1000)} seconden`);
    }
    throw fout;
  } finally {
    clearTimeout(timer);
  }
}

/** Alle elementen met een bruikbare naam. */
export function bruikbareElementen(data) {
  return (data?.elements ?? []).filter((e) => e.tags && (e.tags.name || e.tags.operator));
}
