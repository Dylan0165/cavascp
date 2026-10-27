/**
 * Waar staat dit project?
 *
 * WAAROM DIT BESTAAT
 *
 * De paden stonden hardgecodeerd als `D:/cavascp/...`. Dat werkt op één machine.
 * Zodra je het project ergens anders neerzet — een Linux-mini-pc, een andere
 * schijf — breekt het, en dan zie je alleen "geen Canvas-token gevonden"
 * zonder dat duidelijk is waarom.
 *
 * Daarom rekenen we het pad uit vanuit dit bestand zelf. Dit bestand staat in
 * `mcp/lib/`, dus twee mappen omhoog is de projectmap. Dat werkt op elke machine
 * en in elke map, zonder instelling.
 *
 * Je kunt het overschrijven met de omgevingsvariabele CAVASCP_ROOT, bijvoorbeeld
 * als je de data ergens anders wilt bewaren.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

/** De hoofdmap van het project. */
export const PROJECT_ROOT = (() => {
  const uitEnv = process.env.CAVASCP_ROOT;
  if (uitEnv) return path.resolve(uitEnv);
  // Dit bestand: <root>/mcp/lib/paden.mjs → drie omhoog voor de root.
  const hier = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(hier, '..', '..');
})();

/** Een pad binnen het project. */
export function inProject(...delen) {
  return path.join(PROJECT_ROOT, ...delen);
}

/** Het .env-bestand. */
export const ENV_PAD = process.env.CANVAS_ENV_FILE || inProject('.env');

/** De datamap. */
export const DATA_MAP = inProject('data');

/** Een pad binnen data/. */
export function inData(...delen) {
  return path.join(DATA_MAP, ...delen);
}

/**
 * Zoekt het .env-bestand.
 *
 * We kijken eerst naar de omgevingsvariabele, dan naar de projectmap, en
 * daarna naar de werkmap. Dat laatste is voor als je een script vanuit een
 * andere map start.
 */
export function vindEnv() {
  const kandidaten = [
    process.env.CANVAS_ENV_FILE,
    inProject('.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ].filter(Boolean);
  for (const k of kandidaten) {
    if (existsSync(k)) return k;
  }
  return null;
}

/** Een korte beschrijving van waar we denken te staan, voor foutmeldingen. */
export function waar() {
  return `project ${PROJECT_ROOT}${vindEnv() ? `, .env gevonden` : ', GEEN .env'}`;
}
