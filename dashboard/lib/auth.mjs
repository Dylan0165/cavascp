/**
 * Het wachtwoord van het dashboard.
 *
 * WAAROM DIT ER IS
 *
 * Het dashboard is sinds kort bereikbaar vanaf je laptop via Tailscale. Zonder
 * login betekent dat: iedereen die bij je Tailscale-account kan, krijgt een
 * sessiecookie en zit in je portfolio, je documenten en je Gmail-koppeling. De
 * oude opzet gaf die cookie gewoon weg aan de eerste de beste bezoeker.
 *
 * WAT HIER WEL EN NIET IN ZIT
 *
 * Wel: scrypt met een eigen salt (geen sha256 — dat is te snel te raden), een
 * bestand dat alleen jij kunt lezen, en een limiet op het aantal pogingen in
 * security.mjs.
 *
 * Niet: een gebruikersnaam. Er is één gebruiker: jij. Een tweede veld zou
 * alleen een tweede ding zijn om te vergeten.
 */

import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const AUTH_PAD = process.env.CAVASCP_AUTH_FILE || path.join(HIER, '..', 'auth.json');

/*
 * Parameters voor scrypt. N=2^15 kost ongeveer 40 ms per poging op deze
 * machine: snel genoeg om in te loggen, traag genoeg om raden onaantrekkelijk
 * te maken. maxmem moet mee omhoog, anders weigert Node deze N.
 */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

/** Minimaal aantal tekens. Kort genoeg om te typen, lang genoeg om te tellen. */
export const MIN_LENGTE = 12;

function leesBestand() {
  if (!existsSync(AUTH_PAD)) return null;
  try {
    return JSON.parse(readFileSync(AUTH_PAD, 'utf8'));
  } catch {
    return null;
  }
}

function bewaarBestand(data) {
  mkdirSync(path.dirname(AUTH_PAD), { recursive: true });
  writeFileSync(AUTH_PAD, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  // mode geldt alleen bij aanmaken; expliciet zetten voor een bestaand bestand.
  try {
    chmodSync(AUTH_PAD, 0o600);
  } catch {
    /* niet elk bestandssysteem doet dit */
  }
}

export function heeftWachtwoord() {
  const data = leesBestand();
  return Boolean(data?.hash && data?.salt);
}

/**
 * Zet of vervangt het wachtwoord.
 *
 * Bij vervangen moet het oude kloppen — anders kan iemand met een openstaande
 * sessie het wachtwoord veranderen en de eigenaar buitensluiten.
 */
export function zetWachtwoord(nieuw, { oud } = {}) {
  const tekst = String(nieuw ?? '');

  if (tekst.length < MIN_LENGTE) {
    throw new Error(`Kies een wachtwoord van minstens ${MIN_LENGTE} tekens.`);
  }
  if (!/\D/.test(tekst) || !/\d|[^\w\s]/.test(tekst)) {
    throw new Error('Gebruik letters én cijfers of leestekens — dat maakt raden duurder.');
  }

  if (heeftWachtwoord()) {
    if (!oud || !controleerWachtwoord(oud)) {
      throw new Error('Het huidige wachtwoord klopt niet.');
    }
  }

  const salt = randomBytes(32);
  const hash = scryptSync(tekst, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });

  bewaarBestand({
    versie: 1,
    algoritme: 'scrypt',
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    gemaakt: new Date().toISOString(),
  });

  return { ok: true };
}

/** Klopt het wachtwoord? Timing-safe, ook als de lengte verschilt. */
export function controleerWachtwoord(tekst) {
  const data = leesBestand();
  if (!data?.hash || !data?.salt) return false;

  const verwacht = Buffer.from(data.hash, 'base64');
  let poging;
  try {
    poging = scryptSync(String(tekst ?? ''), Buffer.from(data.salt, 'base64'), verwacht.length, {
      N: data.N ?? SCRYPT.N,
      r: data.r ?? SCRYPT.r,
      p: data.p ?? SCRYPT.p,
      maxmem: SCRYPT.maxmem,
    });
  } catch {
    return false;
  }

  if (poging.length !== verwacht.length) return false;
  return timingSafeEqual(poging, verwacht);
}

/** Waar staat het bestand? Voor de documentatie en foutmeldingen. */
export function authPad() {
  return AUTH_PAD;
}
