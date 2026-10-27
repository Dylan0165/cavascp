/**
 * ZIP-writer zonder afhankelijkheden.
 *
 * Overgenomen uit Krava (D:\DOCAto\src\zip.js) zodat het dashboard zelf
 * Word-documenten kan maken zonder dat Krava hoeft te draaien. De store-methode
 * is genoeg: Word accepteert een ZIP zonder compressie zonder klagen.
 *
 * Bewust een kopie en geen verwijzing: dit project moet op zichzelf kunnen
 * draaien, ook als Krava verplaatst of verwijderd wordt.
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Bouwt een ZIP in het "store"-formaat (geen compressie). */
export function maakZip(bestanden) {
  const delen = [];
  const centraal = [];
  let offset = 0;

  for (const { naam, data } of bestanden) {
    const naamBuf = Buffer.from(naam, 'utf8');
    const inhoud = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const crc = crc32(inhoud);

    const lokaal = Buffer.alloc(30);
    lokaal.writeUInt32LE(0x04034b50, 0);
    lokaal.writeUInt16LE(20, 4); // versie nodig
    lokaal.writeUInt16LE(0x0800, 6); // UTF-8 vlag
    lokaal.writeUInt16LE(0, 8); // store
    lokaal.writeUInt16LE(0, 10); // tijd
    lokaal.writeUInt16LE(0x21, 12); // datum (1 jan 1980)
    lokaal.writeUInt32LE(crc, 14);
    lokaal.writeUInt32LE(inhoud.length, 18);
    lokaal.writeUInt32LE(inhoud.length, 22);
    lokaal.writeUInt16LE(naamBuf.length, 26);
    lokaal.writeUInt16LE(0, 28);
    delen.push(lokaal, naamBuf, inhoud);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(inhoud.length, 20);
    cd.writeUInt32LE(inhoud.length, 24);
    cd.writeUInt16LE(naamBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    centraal.push(cd, naamBuf);

    offset += lokaal.length + naamBuf.length + inhoud.length;
  }

  const cdBuf = Buffer.concat(centraal);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(bestanden.length, 8);
  eocd.writeUInt16LE(bestanden.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...delen, cdBuf, eocd]);
}

/**
 * Leest een ZIP die we zelf hebben gemaakt.
 *
 * Nodig om in tests te controleren wat er werkelijk in het Word-bestand zit,
 * zonder een ZIP-bibliotheek te hoeven gebruiken.
 */
export function leesZip(buf) {
  const bestanden = new Map();
  let i = 0;
  while (i + 30 <= buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const methode = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const grootte = buf.readUInt32LE(i + 18);
    const naamLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const naam = buf.toString('utf8', i + 30, i + 30 + naamLen);
    const start = i + 30 + naamLen + extraLen;
    const data = buf.subarray(start, start + grootte);
    if (methode !== 0) throw new Error(`bestand ${naam} is gecomprimeerd; dat maken we niet`);
    if (crc32(data) !== crc) throw new Error(`crc klopt niet voor ${naam}`);
    bestanden.set(naam, data);
    i = start + grootte;
  }
  return bestanden;
}

export { crc32 };
