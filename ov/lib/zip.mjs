/**
 * Een ZIP-bestand lezen zonder pakketten.
 *
 * WAAROM DIT ER IS
 *
 * De OV-data van Nederland komt als één ZIP van ruim tweehonderd megabyte.
 * Het project heeft geen npm-afhankelijkheden, en een zip-bibliotheek
 * toevoegen voor twee bestanden lezen is niet in verhouding. Het formaat is
 * goed gedocumenteerd en het stuk dat we nodig hebben is klein: de inhouds-
 * opgave achteraan het bestand, en daarna elk bestand uitpakken met zlib.
 *
 * WAT ER WEL EN NIET IN ZIT
 *
 * Wel: deflate en "stored", en de zip64-velden voor bestanden groter dan 4 GB
 * (stop_times.txt in de Nederlandse feed komt daar in de buurt).
 *
 * Niet: versleuteling, meerdere schijven, en herstel van beschadigde archieven.
 * Dat heeft deze feed niet nodig.
 */

import { open, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInflateRaw } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * De inhoudsopgave: per bestand de naam, de methode en waar de data begint.
 *
 * @returns {Promise<Map<string, {naam, methode, compSize, uncompSize, offset}>>}
 */
export async function leesInhoudsopgave(pad) {
  const bestand = await open(pad, 'r');
  try {
    const { size } = await bestand.stat();

    // De EOCD staat achteraan, gevolgd door maximaal 64 kB commentaar.
    const staartLengte = Math.min(size, 66_000);
    const staart = Buffer.alloc(staartLengte);
    await bestand.read(staart, 0, staartLengte, size - staartLengte);

    let eocd = -1;
    for (let i = staart.length - 22; i >= 0; i -= 1) {
      if (staart.readUInt32LE(i) === EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) throw new Error('Geen ZIP-inhoudsopgave gevonden — is dit wel een zip?');

    let aantal = staart.readUInt16LE(eocd + 10);
    let centraleOffset = staart.readUInt32LE(eocd + 16);

    // zip64: de gewone velden staan op 0xFFFF/0xFFFFFFFF en de echte waarden
    // staan in een extra record.
    if (centraleOffset === 0xffffffff || aantal === 0xffff) {
      const locator = eocd - 20;
      if (locator >= 0 && staart.readUInt32LE(locator) === EOCD64_LOCATOR) {
        const eocd64Offset = Number(staart.readBigUInt64LE(locator + 8));
        const kop = Buffer.alloc(56);
        await bestand.read(kop, 0, 56, eocd64Offset);
        if (kop.readUInt32LE(0) !== EOCD64) throw new Error('zip64-record niet gevonden');
        aantal = Number(kop.readBigUInt64LE(32));
        centraleOffset = Number(kop.readBigUInt64LE(48));
      }
    }

    const centraal = Buffer.alloc(size - centraleOffset);
    await bestand.read(centraal, 0, centraal.length, centraleOffset);

    const inhoud = new Map();
    let p = 0;

    for (let i = 0; i < aantal; i += 1) {
      if (p + 46 > centraal.length || centraal.readUInt32LE(p) !== CENTRAL) break;

      const methode = centraal.readUInt16LE(p + 10);
      let compSize = centraal.readUInt32LE(p + 20);
      let uncompSize = centraal.readUInt32LE(p + 24);
      const naamLengte = centraal.readUInt16LE(p + 28);
      const extraLengte = centraal.readUInt16LE(p + 30);
      const commentaarLengte = centraal.readUInt16LE(p + 32);
      let offset = centraal.readUInt32LE(p + 42);

      const naam = centraal.toString('utf8', p + 46, p + 46 + naamLengte);

      // zip64-extra: de velden die niet in 32 bits passen staan hier achter.
      if (compSize === 0xffffffff || uncompSize === 0xffffffff || offset === 0xffffffff) {
        let e = p + 46 + naamLengte;
        const einde = e + extraLengte;
        while (e + 4 <= einde) {
          const id = centraal.readUInt16LE(e);
          const lengte = centraal.readUInt16LE(e + 2);
          if (id === 0x0001) {
            let q = e + 4;
            if (uncompSize === 0xffffffff) {
              uncompSize = Number(centraal.readBigUInt64LE(q));
              q += 8;
            }
            if (compSize === 0xffffffff) {
              compSize = Number(centraal.readBigUInt64LE(q));
              q += 8;
            }
            if (offset === 0xffffffff) {
              offset = Number(centraal.readBigUInt64LE(q));
              q += 8;
            }
            break;
          }
          e += 4 + lengte;
        }
      }

      inhoud.set(naam, { naam, methode, compSize, uncompSize, offset });
      p += 46 + naamLengte + extraLengte + commentaarLengte;
    }

    return inhoud;
  } finally {
    await bestand.close();
  }
}

/**
 * Pakt één bestand uit en geeft de tekst als stream.
 *
 * We lezen alleen het stuk van het archief waar dit bestand staat, en blazen
 * dat onderweg uit. Zo hoeft een bestand van een paar honderd megabyte nooit
 * in het geheugen te staan.
 */
export async function openBestand(pad, vermelding) {
  const bestand = await open(pad, 'r');
  let kop;
  try {
    kop = Buffer.alloc(30);
    await bestand.read(kop, 0, 30, vermelding.offset);
  } finally {
    await bestand.close();
  }

  if (kop.readUInt32LE(0) !== LOCAL) {
    throw new Error(`Lokale kop van ${vermelding.naam} klopt niet`);
  }

  const naamLengte = kop.readUInt16LE(26);
  const extraLengte = kop.readUInt16LE(28);
  const dataStart = vermelding.offset + 30 + naamLengte + extraLengte;
  const dataEinde = dataStart + vermelding.compSize;

  const ruw = createReadStream(pad, { start: dataStart, end: dataEinde - 1 });

  if (vermelding.methode === 0) return ruw; // opgeslagen, niet ingepakt
  if (vermelding.methode !== 8) {
    throw new Error(`Onbekende compressiemethode ${vermelding.methode} voor ${vermelding.naam}`);
  }

  const uitpakker = createInflateRaw();
  ruw.pipe(uitpakker);
  // Fouten uit de lezer moeten doorstromen naar de uitpakker, anders blijft
  // die hangen.
  ruw.on('error', (fout) => uitpakker.destroy(fout));
  return uitpakker;
}

/** Leest een klein bestand in één keer. */
export async function leesTekst(pad, vermelding) {
  const stream = await openBestand(pad, vermelding);
  const brokken = [];
  for await (const brok of stream) brokken.push(brok);
  return Buffer.concat(brokken).toString('utf8');
}

/**
 * Leest een stream regel voor regel.
 *
 * Zelf splitsen en niet `readline`: we willen de regels als Buffer kunnen
 * verwerken zonder per regel strings van honderden megabytes te maken.
 */
export async function* regels(stream) {
  let rest = Buffer.alloc(0);
  for await (const brok of stream) {
    rest = rest.length ? Buffer.concat([rest, brok]) : brok;
    let index;
    while ((index = rest.indexOf(0x0a)) !== -1) {
      let regel = rest.subarray(0, index);
      if (regel.length && regel[regel.length - 1] === 0x0d) regel = regel.subarray(0, regel.length - 1);
      yield regel;
      rest = rest.subarray(index + 1);
    }
  }
  if (rest.length) yield rest;
}

/** Eén CSV-regel splitsen. Houdt rekening met velden tussen aanhalingstekens. */
export function splitCsv(regel) {
  const tekst = Buffer.isBuffer(regel) ? regel.toString('utf8') : String(regel);
  if (!tekst.includes('"')) return tekst.split(',');

  const velden = [];
  let huidig = '';
  let tussenAanhalingstekens = false;

  for (let i = 0; i < tekst.length; i += 1) {
    const teken = tekst[i];
    if (tussenAanhalingstekens) {
      if (teken === '"') {
        if (tekst[i + 1] === '"') {
          huidig += '"';
          i += 1;
        } else {
          tussenAanhalingstekens = false;
        }
      } else {
        huidig += teken;
      }
    } else if (teken === '"') {
      tussenAanhalingstekens = true;
    } else if (teken === ',') {
      velden.push(huidig);
      huidig = '';
    } else {
      huidig += teken;
    }
  }
  velden.push(huidig);
  return velden;
}
