#!/usr/bin/env node
/**
 * Laat zien waar elke sectie van een document onder valt.
 *
 * Dit is de nuttigste toepassing van de check in de praktijk: je ziet per
 * hoofdstuk welke leeruitkomst erin zit, en dus ook waar je portfolio nog dun
 * is.
 *
 *   node tools/toon-leeruitkomsten.mjs                    # het grootste project
 *   node tools/toon-leeruitkomsten.mjs <project-id>
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { checkDocument, LEERUITKOMSTEN } from '../mcp/lib/leeruitkomsten.mjs';

const KRAVA = 'D:/DOCAto/data/projects';
if (!existsSync(KRAVA)) {
  console.error(`Krava-projecten niet gevonden op ${KRAVA}`);
  process.exit(1);
}

const gezocht = process.argv[2];
const projecten = [];
for (const f of readdirSync(KRAVA).filter((x) => x.endsWith('.json'))) {
  try {
    const j = JSON.parse(readFileSync(`${KRAVA}/${f}`, 'utf8'));
    const tekst = (j.plan?.secties || []).map((s) => `${s.titel}\n${s.tekst || ''}`).join('\n\n');
    if (tekst.length > 300) projecten.push({ j, tekst });
  } catch {
    /* overslaan */
  }
}
projecten.sort((a, b) => b.tekst.length - a.tekst.length);
const gekozen = gezocht ? projecten.find((p) => p.j.id === gezocht) ?? projecten[0] : projecten[0];

if (!gekozen) {
  console.error('geen project met inhoud gevonden');
  process.exit(1);
}

const { j } = gekozen;
console.log('='.repeat(78));
console.log(`DOCUMENT: ${j.titel}`);
console.log(`${(j.plan?.secties || []).length} secties · ${gekozen.tekst.length} tekens · ${j.documenttype || '?'}`);
console.log('='.repeat(78));
console.log('');

/* ── Het geheel ─────────────────────────────────────────────────────────── */
const totaal = checkDocument({ titel: j.titel, tekst: gekozen.tekst });

console.log('HET DOCUMENT ALS GEHEEL');
console.log(`  ${totaal.uitleg}`);
console.log('');
for (const code of LEERUITKOMSTEN.map((l) => l.code)) {
  const t = totaal.treffers.find((x) => x.code === code);
  const score = t ? t.relatief : 0;
  const balk = '█'.repeat(Math.round(score * 20)).padEnd(20, '·');
  const naam = LEERUITKOMSTEN.find((l) => l.code === code).naam;
  console.log(`  ${code}  ${balk}  ${String(Math.round(score * 100)).padStart(3)}%  ${naam}`);
  if (t?.begrippen?.length) console.log(`       ${' '.repeat(21)}via: ${t.begrippen.slice(0, 10).join(', ')}`);
}
console.log('');

/* ── Per sectie ─────────────────────────────────────────────────────────── */
console.log('PER SECTIE');
const perCode = new Map(LEERUITKOMSTEN.map((l) => [l.code, 0]));
for (const s of j.plan?.secties || []) {
  const tekst = String(s.tekst || '');
  if (tekst.length < 150) continue;
  const u = checkDocument({ titel: s.titel, tekst: `${s.titel}\n${tekst}` });
  const top = u.treffers.slice(0, 3);
  if (top[0]) perCode.set(top[0].code, (perCode.get(top[0].code) ?? 0) + 1);
  const weergave = top.map((t) => `${t.code} ${String(Math.round(t.relatief * 100)).padStart(3)}%`).join('  ');
  console.log(`  ${String(s.titel).slice(0, 40).padEnd(42)} ${weergave || '—'}`);
}
console.log('');

/* ── Dekking ────────────────────────────────────────────────────────────── */
console.log('WELKE LEERUITKOMSTEN KOMEN AAN BOD');
for (const lo of LEERUITKOMSTEN) {
  const n = perCode.get(lo.code) ?? 0;
  const gedekt = totaal.treffers.some((t) => t.code === lo.code);
  const teken = gedekt ? '●' : '○';
  console.log(`  ${teken} ${lo.code}  ${String(n).padStart(2)} secties als sterkste   ${lo.naam}`);
}
console.log('');
const ontbreekt = LEERUITKOMSTEN.filter((l) => !totaal.treffers.some((t) => t.code === l.code));
if (ontbreekt.length) {
  console.log(`  Nog geen bewijs voor: ${ontbreekt.map((l) => `${l.code} ${l.naam}`).join(', ')}`);
} else {
  console.log('  Alle zes leeruitkomsten komen terug in dit document.');
}
