#!/usr/bin/env node
/**
 * Test de zip-schrijver.
 *
 * De vault gaat als zip naar je laptop; als die zip stuk is, merkt Obsidian dat
 * pas als je hem opent. Dus schrijven we hem hier en lezen we hem meteen weer
 * terug met de lezer die al in het project zit (voor de OV-dienstregeling).
 *
 *   node dashboard/test-zip.mjs
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { zipMap, crc32 } = await import('./lib/zip-schrijf.mjs');
const { leesInhoudsopgave, leesTekst } = await import('../ov/lib/zip.mjs');

let gelukt = 0;
const fouten = [];

function check(naam, fn) {
  try {
    fn();
    gelukt += 1;
    console.log(`  PASS  ${naam}`);
  } catch (fout) {
    fouten.push({ naam, fout });
    console.log(`  FAIL  ${naam}`);
    console.log(`        ${fout.message}`);
  }
}

console.log('\n1) CRC-32');

check('van een lege buffer is nul', () => assert.equal(crc32(Buffer.alloc(0)), 0));
check('van "123456789" is de bekende waarde', () => assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926));

console.log('\n2) Een map inpakken en teruglezen');

const map = mkdtempSync(path.join(tmpdir(), 'zip-test-'));
mkdirSync(path.join(map, 'diep', 'dieper'), { recursive: true });
writeFileSync(path.join(map, 'een.md'), '# Een\n');
writeFileSync(path.join(map, 'diep', 'twee.md'), '# Twee\nmet een accent: é\n');
writeFileSync(path.join(map, 'diep', 'dieper', 'drie.txt'), 'x'.repeat(5000));

const zipPad = path.join(map, '..', `${path.basename(map)}.zip`);
const zip = zipMap(map);
writeFileSync(zipPad, zip);
rmSync(map, { recursive: true, force: true });

check('de zip begint met de juiste handtekening', () => assert.equal(zip.readUInt32LE(0), 0x04034b50));
check('hij is niet leeg', () => assert.ok(zip.length > 100));

// De lezer geeft een Map terug: naam -> gegevens.
const inhoud = await leesInhoudsopgave(zipPad);
const items = [...inhoud.values()];

check('alle drie de bestanden zitten erin', () => assert.equal(items.length, 3));
check(
  'paden zijn met schuine strepen',
  () => assert.ok(items.every((item) => !item.naam.includes('\\'))),
);
check(
  'de mapstructuur blijft bewaard',
  () => assert.ok(items.some((item) => item.naam === 'diep/dieper/drie.txt')),
);

const een = inhoud.get('een.md');
const twee = inhoud.get('diep/twee.md');
const drie = inhoud.get('diep/dieper/drie.txt');

check('de inhoud klopt', async () => {
  assert.equal(await leesTekst(zipPad, een), '# Een\n');
});
check('utf-8 blijft intact', async () => {
  assert.equal(await leesTekst(zipPad, twee), '# Twee\nmet een accent: é\n');
});
check('een groter bestand komt er heel uit', async () => {
  const tekst = await leesTekst(zipPad, drie);
  assert.equal(tekst.length, 5000);
});

rmSync(zipPad, { force: true });

console.log(
  `\n${fouten.length === 0 ? 'ALLES OK' : `${fouten.length} CHECK(S) MISLUKT`}  (${gelukt} geslaagd)\n`,
);
process.exit(fouten.length === 0 ? 0 : 1);
