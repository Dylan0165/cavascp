#!/usr/bin/env node
/**
 * Zet Krava's documentgeneratoren om naar dit project.
 *
 * Krava (D:\DOCAto) schrijft Word- en PowerPoint-bestanden zonder
 * afhankelijkheden. Die twee bestanden zijn samen 91 kB en hebben alleen
 * `./zip` nodig. In plaats van ze over te typen — met het risico op fouten in
 * duizend regels opmaakcode — zetten we ze programmatisch om van CommonJS naar
 * ES-modules.
 *
 * Het script is herhaalbaar: verandert Krava, dan draai je dit opnieuw.
 *
 *   node tools/port-krava.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const BRON = 'D:/DOCAto/src';
const DOEL = path.resolve('mcp/lib');

/** Welke bestanden komen over, en waar hun ene afhankelijkheid heen wijst. */
const BESTANDEN = [
  { van: 'docx.js', naar: 'docx.mjs', beschrijving: 'Word-generator', afhankelijkheden: { './zip': './zip.mjs' } },
  { van: 'pptx.js', naar: 'pptx.mjs', beschrijving: 'PowerPoint-generator', afhankelijkheden: { './zip': './zip.mjs' } },
  {
    van: 'markdown.js',
    naar: 'markdown.mjs',
    beschrijving: 'Markdown naar blokken',
    afhankelijkheden: {},
  },
];

if (!existsSync(BRON)) {
  console.error(`Krava niet gevonden op ${BRON}`);
  process.exit(1);
}
mkdirSync(DOEL, { recursive: true });

const kop = (beschrijving, bron) => `/**
 * ${beschrijving} — overgenomen uit Krava.
 *
 * Bron: D:\\DOCAto\\src\\${bron}
 * Dit bestand is automatisch omgezet van CommonJS naar een ES-module door
 * tools/port-krava.mjs. Pas het niet met de hand aan: draai dat script opnieuw
 * in plaats daarvan, dan blijft het gelijk aan Krava.
 *
 * De generator heeft geen afhankelijkheden behalve ./zip.mjs.
 */

`;

let gedaan = 0;
for (const b of BESTANDEN) {
  const bronPad = path.join(BRON, b.van);
  const doelPad = path.join(DOEL, b.naar);
  let tekst = readFileSync(bronPad, 'utf8');

  const voor = tekst.length;

  // 1. De require van ./zip omzetten naar een import.
  for (const [van, naar] of Object.entries(b.afhankelijkheden)) {
    const re = new RegExp(`const\\s*\\{([^}]+)\\}\\s*=\\s*require\\(['"]${van.replace('.', '\\.')}['"]\\);`, 'g');
    tekst = tekst.replace(re, (_, namen) => `import {${namen}} from '${naar}';`);
  }

  // 2. Eventuele overgebleven requires melden: dan is het bestand niet meer
  //    zelfstandig en moeten we kijken voordat we iets stukmaken.
  const over = [...tekst.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  if (over.length) {
    console.error(`  ${b.van}: niet-omgezette require(s): ${over.join(', ')} — overgeslagen`);
    process.exitCode = 1;
    continue;
  }

  // 3. 'use strict' mag weg: ES-modules zijn al streng.
  tekst = tekst.replace(/^['"]use strict['"];\s*\n/, '');

  // 4. De exports omzetten.
  const exportMatch = tekst.match(/module\.exports\s*=\s*\{([^}]+)\};?\s*$/m);
  if (!exportMatch) {
    console.error(`  ${b.van}: geen module.exports gevonden — overgeslagen`);
    process.exitCode = 1;
    continue;
  }
  const namen = exportMatch[1]
    .split(',')
    .map((n) => n.trim().split(':')[0].trim())
    .filter(Boolean);
  tekst = tekst.replace(/module\.exports\s*=\s*\{[^}]+\};?\s*$/m, `export { ${namen.join(', ')} };\n`);

  writeFileSync(doelPad, kop(b.beschrijving, b.van) + tekst, 'utf8');

  const na = tekst.length;
  console.log(`  ${b.van.padEnd(10)} → ${b.naar.padEnd(10)} ${String(voorspronkelijk(bronPad)).padStart(6)} bytes, exports: ${namen.join(', ')}`);
  gedaan += 1;
}

function voorspronkelijk(p) {
  try {
    return readFileSync(p).length;
  } catch {
    return 0;
  }
}

console.log(`\n${gedaan} van ${BESTANDEN.length} bestanden omgezet naar ${DOEL}`);
