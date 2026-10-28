/**
 * Hoe lang doe je er met de trein over?
 *
 * De OV-kolom in het stage-scherm zei tot nu toe alleen hoe ver het station is.
 * Dat is een halve waarheid: een station op 800 meter dat één keer per uur
 * wordt aangedaan is slechter dan een station op twee kilometer met een
 * intercity elke tien minuten. Deze module haalt de echte reistijd op.
 *
 * WELKE TIJD
 *
 * Niet "nu": je zoekt een stage, geen trein van vanavond. We rekenen met de
 * volgende werkdag om 08:30 — de reis die je gaat maken als je er werkt.
 *
 * WAT ALS DE NS NIET GEKOPPELD IS
 *
 * Dan blijft de reistijd leeg en blijft de kilometer-aanduiding staan. Geen
 * verzonnen getallen: een reistijd die je niet hebt opgehaald is geen reistijd.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inData } from '../../mcp/lib/paden.mjs';
import { reisadvies, snelsteReis, nsBeschikbaar } from '../../mcp/ns/lib/client.mjs';
import { leesProfiel } from './profiel.mjs';
import { werkBij } from './bedrijven.mjs';

const CACHE_PAD = inData('stagebot', 'cache', 'reistijden.json');

/** Een week: dienstregelingen veranderen zelden, werkzaamheden wel. */
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

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

/**
 * De volgende werkdag om 08:30.
 *
 * Vrijdagavond → maandag. Zo krijg je nooit een zondagsdienstregeling als
 * representatieve reistijd.
 */
export function representatiefMoment(nu = new Date()) {
  const datum = new Date(nu);
  datum.setHours(8, 30, 0, 0);
  if (datum.getTime() <= nu.getTime()) datum.setDate(datum.getDate() + 1);

  while (datum.getDay() === 0 || datum.getDay() === 6) {
    datum.setDate(datum.getDate() + 1);
  }
  return datum;
}

/**
 * Reistijd vanaf jouw station naar het station bij dit bedrijf.
 *
 * @returns {Promise<{minuten:number, overstappen:number, van:string, naar:string}|null>}
 */
export async function berekenReistijd(bedrijf, { force = false } = {}) {
  if (!bedrijf?.station?.naam) return null;
  if (!nsBeschikbaar()) return null;

  const thuis = leesProfiel().stage?.ovVan || 'Roosendaal';
  const doel = bedrijf.station.naam;
  const sleutel = `${thuis}|${doel}`;

  const cache = leesCache();
  const bewaard = cache[sleutel];
  const vers = bewaard && Date.now() - Date.parse(bewaard.op) < CACHE_MS;

  let reistijd = vers ? bewaard.waarde : null;

  if (!reistijd || force) {
    const reizen = await reisadvies({
      van: thuis,
      naar: doel,
      vertrek: representatiefMoment(),
      aantal: 3,
    });
    const snel = snelsteReis(reizen);
    if (!snel) return null;

    reistijd = {
      minuten: snel.minuten,
      overstappen: snel.overstappen,
      van: thuis,
      naar: doel,
      op: new Date().toISOString(),
    };

    cache[sleutel] = { op: new Date().toISOString(), waarde: reistijd };
    bewaarCache(cache);
  }

  werkBij(bedrijf.id, (b) => {
    b.reistijd = reistijd;
  });

  return reistijd;
}

/** Voor de CLI: één bedrijf opnieuw laten uitrekenen. */
export async function herberekenVoorBedrijf(bedrijf) {
  return berekenReistijd(bedrijf, { force: true });
}
