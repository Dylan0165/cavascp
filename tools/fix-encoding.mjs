#!/usr/bin/env node
/**
 * Herstelt verminkte tekens, gericht in plaats van blind.
 *
 * Wat er misging: een eerdere bewerking las UTF-8 als Windows-1252 en schreef
 * het resultaat terug. Daardoor staat er "â€"" waar "—" hoorde.
 *
 * Waarom niet alles in één keer terugdraaien: het bestand bevat inmiddels ook
 * tekens die wél goed zijn. Een blinde latin1→utf8-conversie verminkt die. Dus
 * vervangen we alleen de patronen die zeker fout zijn.
 *
 *   node tools/fix-encoding.mjs <bestand> [--dry]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const dry = process.argv.includes('--dry');
if (!file) {
  console.error('gebruik: node tools/fix-encoding.mjs <bestand> [--dry]');
  process.exit(1);
}

/**
 * Patroon → correct teken.
 *
 * Dit zijn lettergrepen die alleen kunnen ontstaan door UTF-8 als 1252 te
 * lezen. Ze komen in gewone Nederlandse of Engelse tekst niet voor, dus
 * vervangen is veilig.
 */
const REPAIRS = [
  // Let op de exacte tekens: UTF-8-bytes die als Windows-1252 gelezen worden
  // geven specifieke cp1252-tekens. De em-dash is â + € + ” (krul, geen recht
  // aanhalingsteken) — dat kostte me een extra ronde om te vinden.
  ['\u00E2\u20AC\u201D', '—'], // em-dash
  ['\u00E2\u20AC\u201C', '–'], // en-dash
  ['\u00E2\u20AC\u00A6', '…'], // ellipsis
  ['\u00E2\u20AC\u017E', '„'],
  ['\u00E2\u20AC\u0153', '“'],
  ['\u00E2\u20AC\u009D', '”'],
  ['\u00E2\u20AC\u2122', '’'],
  ['\u00E2\u20AC\u02DC', '‘'],
  ['\u00E2\u201A\u00AC', '€'],
  ['\u00C3\u00A9', 'é'],
  ['\u00C3\u00A8', 'è'],
  ['\u00C3\u00AB', 'ë'],
  ['\u00C3\u00AF', 'ï'],
  ['\u00C3\u00B6', 'ö'],
  ['\u00C3\u00BC', 'ü'],
  ['\u00C3\u00A0', 'à'],
  ['\u00C3\u00A7', 'ç'],
  ['\u00C2\u00B7', '·'],
  ['\u00E2\u201D\u20AC', '─'],
  ['\u00E2\u201D\u201A', '│'],
  ['\u00E2\u201D\u0153', '├'],
  ['\u00E2\u201D\u00A4', '┤'],
  ['\u00E2\u201D\u201D', '└'],
  ['\u00E2\u201D\u0152', '┌'],
  ['\u00E2\u201D\u00AC', '┬'],
  ['\u00E2\u2022\u00AD', '╭'],
  ['\u00E2\u2022\u00B0', '╰'],
  ['\u00E2\u2013\u2018', '●'],
  ['\u00E2\u0153\u201C', '✓'],
  ['\u00E2\u0161\u00A0', '⚠'],
  ['\u00E2\u009D\u2014', '❗'],
];

const original = readFileSync(file, 'utf8');
let fixed = original;
const counts = [];

for (const [bad, good] of REPAIRS) {
  const parts = fixed.split(bad);
  const n = parts.length - 1;
  if (n > 0) {
    counts.push({ bad, good, n });
    fixed = parts.join(good);
  }
}

if (fixed === original) {
  console.log('niets te herstellen');
  process.exit(0);
}

console.log(`patronen hersteld in ${file}:`);
for (const c of counts) {
  console.log(`  ${String(c.n).padStart(3)}x  ${JSON.stringify(c.bad)} → ${JSON.stringify(c.good)}`);
}

const before = original.split('\n').length;
const after = fixed.split('\n').length;
console.log(`regels: ${before} → ${after}${before === after ? ' (gelijk, goed)' : ' (VERSCHIL — controleer!)'}`);

// Vangnet: geen vervangtekens toevoegen.
if (fixed.includes('\uFFFD') && !original.includes('\uFFFD')) {
  console.error('het resultaat bevat vervangtekens; niets weggeschreven');
  process.exit(1);
}

if (dry) {
  console.log('\n--dry: niets weggeschreven');
} else {
  writeFileSync(file, fixed, 'utf8');
  console.log('\nweggeschreven');
}
