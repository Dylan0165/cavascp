/**
 * Een zip maken, zonder pakketten.
 *
 * Nodig om de vault van de mini-pc naar je eigen laptop te krijgen: één
 * bestand, dubbelklikken, klaar. Alleen de methode die browsers en
 * Obsidian zelf ook lezen (deflate), geen versleuteling.
 *
 * De opbouw is die van het oorspronkelijke ZIP-formaat: per bestand een
 * lokale header met de gegevens, daarna één centraal overzicht, en tot slot
 * de "einde van de map"-registratie. De centrale map is verplicht — zonder
 * die opent niets het bestand.
 */

import { deflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/* ────────────────────────────── CRC-32 ────────────────────────────────── */

const TABEL = (() => {
  const tabel = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let waarde = i;
    for (let bit = 0; bit < 8; bit += 1) {
      waarde = waarde & 1 ? 0xedb88320 ^ (waarde >>> 1) : waarde >>> 1;
    }
    tabel[i] = waarde >>> 0;
  }
  return tabel;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = TABEL[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ────────────────────────────── hulpjes ───────────────────────────────── */

/** Alle bestanden onder een map, als paden relatief aan die map. */
export function loopBestanden(map, basis = map) {
  const uit = [];

  for (const naam of readdirSync(map)) {
    const pad = path.join(map, naam);
    const info = statSync(pad);
    if (info.isDirectory()) uit.push(...loopBestanden(pad, basis));
    else uit.push({ pad, relatief: path.relative(basis, pad).split(path.sep).join('/') });
  }

  return uit;
}

/* ─────────────────────────────── zip ──────────────────────────────────── */

/**
 * Maakt een zip van een map.
 *
 * @param {string} map
 * @param {{compressie?: boolean}} opties
 * @returns {Buffer}
 */
export function zipMap(map, { compressie = true } = {}) {
  const bestanden = loopBestanden(map).map((bestand) => ({
    naam: bestand.relatief,
    data: readFileSync(bestand.pad),
    datum: statSync(bestand.pad).mtime,
  }));

  return zipBestanden(bestanden, { compressie });
}

/**
 * Een zip uit losse buffers, zonder tussenmap.
 *
 * Nodig voor een .docx: dat is een zip met een vaste indeling, en de inhoud
 * bestaat uit strings die je net hebt gebouwd.
 *
 * @param {{naam: string, data: Buffer|string, datum?: Date}[]} bestanden
 */
export function zipBestanden(bestanden, { compressie = true } = {}) {

  const lokaal = [];
  const centraal = [];
  let offset = 0;

  for (const bestand of bestanden) {
    const ruw = Buffer.isBuffer(bestand.data) ? bestand.data : Buffer.from(bestand.data, 'utf8');
    const inhoud = compressie ? deflateRawSync(ruw, { level: 6 }) : ruw;
    const methode = compressie ? 8 : 0;
    const naam = Buffer.from(bestand.naam, 'utf8');
    const crc = crc32(ruw);

    // Dos-tijd: alleen netjes binnen de grenzen houden, niet belangrijk.
    const datum = new Date(Math.min((bestand.datum ?? new Date()).getTime(), Date.UTC(2107, 11, 31)));
    const tijd = ((datum.getHours() << 11) | (datum.getMinutes() << 5) | (datum.getSeconds() / 2)) & 0xffff;
    const dag = (((datum.getFullYear() - 1980) << 9) | ((datum.getMonth() + 1) << 5) | datum.getDate()) & 0xffff;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // versie
    header.writeUInt16LE(0x0800, 6); // utf-8 namen
    header.writeUInt16LE(methode, 8);
    header.writeUInt16LE(tijd, 10);
    header.writeUInt16LE(dag, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(inhoud.length, 18);
    header.writeUInt32LE(ruw.length, 22);
    header.writeUInt16LE(naam.length, 26);
    header.writeUInt16LE(0, 28);

    lokaal.push(header, naam, inhoud);

    const centraalHeader = Buffer.alloc(46);
    centraalHeader.writeUInt32LE(0x02014b50, 0);
    centraalHeader.writeUInt16LE(20, 4); // gemaakt door
    centraalHeader.writeUInt16LE(20, 6); // nodig
    centraalHeader.writeUInt16LE(0x0800, 8);
    centraalHeader.writeUInt16LE(methode, 10);
    centraalHeader.writeUInt16LE(tijd, 12);
    centraalHeader.writeUInt16LE(dag, 14);
    centraalHeader.writeUInt32LE(crc, 16);
    centraalHeader.writeUInt32LE(inhoud.length, 20);
    centraalHeader.writeUInt32LE(ruw.length, 24);
    centraalHeader.writeUInt16LE(naam.length, 28);
    centraalHeader.writeUInt32LE(offset, 42);

    centraal.push(centraalHeader, naam);

    offset += header.length + naam.length + inhoud.length;
  }

  const centraalBlok = Buffer.concat(centraal);
  const einde = Buffer.alloc(22);
  einde.writeUInt32LE(0x06054b50, 0);
  einde.writeUInt16LE(bestanden.length, 8);
  einde.writeUInt16LE(bestanden.length, 10);
  einde.writeUInt32LE(centraalBlok.length, 12);
  einde.writeUInt32LE(offset, 16);

  return Buffer.concat([...lokaal, centraalBlok, einde]);
}
