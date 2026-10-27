#!/usr/bin/env node
/**
 * Haalt de UTF-8 BOM uit bestanden.
 *
 * PowerShell 5.1 schrijft bij `Set-Content -Encoding UTF8` een BOM (EF BB BF)
 * aan het begin van het bestand. Node ziet die als een ongeldig teken en weigert
 * het bestand te parsen: "SyntaxError: Invalid or unexpected token" op regel 1.
 *
 * Dat is precies wat er gebeurde nadat ik paden had vervangen met PowerShell.
 * Dit script haalt de BOM weg bij alle tekstbestanden in het project, en zegt
 * welke het waren.
 *
 *   node tools/strip-bom.mjs            # laten zien
 *   node tools/strip-bom.mjs --doen     # ook weghalen
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DOEN = process.argv.includes('--doen');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const EXTENSIES = new Set(['.mjs', '.js', '.py', '.md', '.css', '.html', '.json', '.yml', '.yaml', '.cmd', '.ps1', '.txt']);
const OVERSLAAN = new Set(['node_modules', '.git', '.chrome-profile', '__pycache__', 'out', 'preview']);

const gevonden = [];

function loop(map) {
  for (const item of readdirSync(map, { withFileTypes: true })) {
    if (OVERSLAAN.has(item.name)) continue;
    const pad = path.join(map, item.name);
    if (item.isDirectory()) {
      loop(pad);
      continue;
    }
    if (!EXTENSIES.has(path.extname(item.name).toLowerCase())) continue;
    const buf = readFileSync(pad);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      gevonden.push(pad);
      if (DOEN) writeFileSync(pad, buf.subarray(3));
    }
  }
}

loop(ROOT);

if (!gevonden.length) {
  console.log('Geen BOM gevonden.');
} else {
  console.log(`${gevonden.length} bestand(en) met een BOM:`);
  for (const pad of gevonden) console.log(`  ${path.relative(ROOT, pad)}`);
  if (!DOEN) {
    console.log('\nDroogloop. Gebruik --doen om ze weg te halen.');
  } else {
    console.log('\nWeggehaald.');
  }
}
