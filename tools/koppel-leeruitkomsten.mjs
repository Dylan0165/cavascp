#!/usr/bin/env node
/**
 * De koppeling tussen Canvas-leeruitkomsten en Portflow-doelen vastleggen.
 *
 * WAAROM DIT NODIG IS
 *
 * Canvas heeft de zes leeruitkomsten van V-OL-MAIFS met een eigen id (485380…).
 * Portflow heeft dezelfde zes met een eigen id (ook 485380…, maar dat is toeval
 * en niet iets om op te vertrouwen). Zonder een vastgelegde koppeling weet het
 * dashboard niet dat het criterium "Responsible AI for Society" in Canvas
 * hetzelfde is als doel 485380 in Portflow.
 *
 * En naam-matching is gevaarlijk: "Professional Standard" bestaat vier keer in
 * Portflow, in vier verschillende semesters. Wie op naam koppelt, zet bewijs aan
 * het verkeerde doel.
 *
 * HOE WE KOPPELEN
 *
 * Twee bronnen, en ze moeten het eens zijn:
 *   1. de OFFICIËLE Canvas-beschrijving van de leeruitkomst (uit de rubric)
 *   2. de NAAM van het Portflow-doel
 *
 * We koppelen alleen als de naam overeenkomt binnen de marge van een
 * tekstvergelijking. Bij twijfel: niet koppelen en melden, want een verkeerde
 * koppeling is erger dan geen.
 *
 *   node tools/koppel-leeruitkomsten.mjs            # alleen laten zien
 *   node tools/koppel-leeruitkomsten.mjs --schrijf  # ook wegschrijven
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { LEERUITKOMSTEN } from '../mcp/lib/leeruitkomsten.mjs';

const SCHRIJF = process.argv.includes('--schrijf');
const JSON_PAD = path.resolve('data/leeruitkomsten.json');
const DOEL = path.resolve('data/lo-koppeling.json');

/** Vergelijkt twee namen en geeft een score tussen 0 en 1. */
function naamGelijkenis(a, b) {
  const schoon = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/^lo\s*\d+\s*[:.\-–]?\s*/i, '') // "LO3: " ervoor weghalen
      .replace(/[^a-z0-9&\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const x = schoon(a);
  const y = schoon(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const wx = new Set(x.split(' ').filter((w) => w.length > 2));
  const wy = new Set(y.split(' ').filter((w) => w.length > 2));
  if (!wx.size || !wy.size) return 0;

  let gemeen = 0;
  for (const w of wx) if (wy.has(w)) gemeen += 1;
  // Jaccard, maar met het kleinste als noemer: "Data & Knowledge stewardship"
  // tegen "Data & Knowledge Stewardship" moet 1 zijn, niet 0,8.
  return gemeen / Math.min(wx.size, wy.size);
}

/* ── De Portflow-doelen ophalen ─────────────────────────────────────────── */

console.log('='.repeat(78));
console.log('LO-KOPPELING: CANVAS ↔ PORTFLOW');
console.log('='.repeat(78));
console.log('');

/**
 * De doelen komen live uit Portflow.
 *
 * Waarom niet uit een bewaard bestand: de doelenlijst verandert als er een
 * semester bij komt, en een verouderde lijst zou een koppeling kunnen maken die
 * niet meer klopt. Liever één keer verbinden dan werken met iets van gisteren.
 */
async function haalPortflowDoelen() {
  const { CONFIG } = await import('../browser/config.mjs');
  const { Portflow } = await import('../browser/portflow.mjs');
  const { chromium } = await import(CONFIG.playwrightUrl);

  const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
    ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
    headless: true,
    viewport: CONFIG.viewport,
    userAgent: CONFIG.userAgent,
    locale: 'nl-NL',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const pf = new Portflow(page);
  try {
    await pf.connect();
    const doelen = await pf.goals();
    const mappen = await pf.collections();
    return { doelen, mappen, portfolioId: pf.portfolioId, gebruiker: pf.me?.name ?? null };
  } finally {
    await context.close().catch(() => {});
  }
}

console.log('Verbinden met Portflow om de doelen op te halen…');
let portflowDoelen = [];
let portflowMappen = [];
let portfolioId = null;

try {
  const uit = await haalPortflowDoelen();
  portflowDoelen = (uit.doelen ?? []).map((g) => ({
    id: g.id,
    naam: g.name ?? g.nickname ?? String(g.id),
  }));
  portflowMappen = uit.mappen ?? [];
  portfolioId = uit.portfolioId;
  console.log(`  portfolio ${portfolioId} · ${portflowDoelen.length} doelen · ${portflowMappen.length} mappen`);
} catch (error) {
  console.log(`  mislukt: ${error.message}`);
  console.log('');
  console.log('  Zonder verbinding met Portflow kan er niets gekoppeld worden.');
  console.log('  Draai eerst: node browser/recon.mjs (eenmalig inloggen)');
  process.exit(1);
}
console.log('');

/* ── De Canvas-uitkomsten ───────────────────────────────────────────────── */

let canvasUitkomsten = [];
if (existsSync(JSON_PAD)) {
  const data = JSON.parse(readFileSync(JSON_PAD, 'utf8'));
  canvasUitkomsten = (data.canvas_uitkomsten ?? []).map((o) => ({ id: o.id, titel: o.titel }));
}
console.log(`Canvas-uitkomsten: ${canvasUitkomsten.length}`);
console.log('');

/*
 * De officiële beschrijvingen uit de rubric zijn de grondslag. Die staan in
 * leeruitkomsten.mjs; die hebben we met de hand uit Canvas gehaald en ze zijn
 * dezelfde als wat een docent beoordeelt.
 */
console.log('De zes leeruitkomsten van dit semester, met hun officiële tekst:');
for (const lo of LEERUITKOMSTEN) {
  console.log(`  ${lo.code}  ${lo.naam}`);
}
console.log('');

/*
 * Zoek de combinatie van zes doelen die samen een AANEENGESLOTEN BLOK vormen.
 *
 * Dit is de beslissende controle, en ik kwam er pas achter doordat de eerste
 * poging LO4 aan doel 268558 koppelde in plaats van aan 485383. Beide heten
 * "Professional Standard", dus op naam is er geen verschil — maar de doelen van
 * dit semester zijn in één keer aangemaakt en kregen daardoor opeenvolgende
 * id's (485380…485385). Een familie van een ouder semester heeft een eigen,
 * ver uiteenliggend blok.
 *
 * Een doorlopend blok van zes is dus het bewijs dat deze zes bij elkaar horen.
 */
function zoekBlok() {
  /*
   * Per leeruitkomst: alle doelen met een exact passende naam. Meestal één,
   * soms vier (bij "Professional Standard" en "Personal Leadership").
   */
  const perLo = LEERUITKOMSTEN.map((lo) => ({
    lo,
    kandidaten: portflowDoelen
      .map((d) => ({ ...d, score: naamGelijkenis(lo.naam, d.naam) }))
      .filter((d) => d.score >= 0.99)
      .sort((a, b) => a.id - b.id),
  }));

  if (perLo.some((x) => !x.kandidaten.length)) return { gevonden: null, perLo };

  /*
   * Zoek de combinatie met de kleinste spreiding. Bij een doorlopend blok is
   * max - min precies 5 (zes opeenvolgende id's). We nemen de kleinste die we
   * vinden; is die groter dan 20, dan is het geen familie.
   */
  let beste = null;
  const kies = (index, gekozen) => {
    if (index === perLo.length) {
      const ids = gekozen.map((g) => g.id);
      const spreiding = Math.max(...ids) - Math.min(...ids);
      if (!beste || spreiding < beste.spreiding) beste = { gekozen: [...gekozen], spreiding };
      return;
    }
    for (const k of perLo[index].kandidaten) {
      // Sla een id over dat al gebruikt is: elk doel hoort bij één leeruitkomst.
      if (gekozen.some((g) => g.id === k.id)) continue;
      gekozen.push(k);
      kies(index + 1, gekozen);
      gekozen.pop();
    }
  };
  kies(0, []);

  if (!beste) return { gevonden: null, perLo };

  const ids = beste.gekozen.map((g) => g.id).sort((a, b) => a - b);
  const doorlopend = ids.every((id, i) => i === 0 || id === ids[i - 1] + 1);

  return {
    gevonden: perLo.map((x, i) => ({ lo: x.lo, doel: beste.gekozen[i], aantalKandidaten: x.kandidaten.length })),
    spreiding: beste.spreiding,
    doorlopend,
    ids,
    perLo,
  };
}

const blok = zoekBlok();

console.log('Stap 1: de groep van dit semester vinden');
console.log('');

if (!blok.gevonden) {
  console.log('  Niet voor elke leeruitkomst is een doel met een passende naam gevonden.');
  console.log('');
} else {
  console.log(`  gevonden blok: ${blok.ids.join(', ')}  (spreiding ${blok.spreiding}${blok.doorlopend ? ', doorlopend' : ''})`);
  console.log('');
  for (const g of blok.gevonden) {
    const aantal = blok.perLo.find((x) => x.lo.code === g.lo.code)?.kandidaten.length ?? 0;
    console.log(
      `     ${g.lo.code}  ${g.lo.naam.padEnd(32)} → ${String(g.doel.id).padStart(7)}  "${g.doel.naam}"` +
        (aantal > 1 ? `   (${aantal} kandidaten op naam)` : ''),
    );
  }
  console.log('');
  if (blok.doorlopend) {
    console.log('  De zes id\'s zijn doorlopend. Dat is het bewijs dat deze zes doelen samen');
    console.log('  in één keer zijn aangemaakt: de familie van dit semester.');
  } else {
    console.log('  LET OP: de id\'s zijn niet doorlopend. Dat wijst op verschillende families.');
    console.log('  Er wordt niets gekoppeld wat niet zeker is.');
  }
  console.log('');
}

const groepCompleet = Boolean(blok.gevonden) && blok.doorlopend;

console.log('Stap 2: koppelen binnen die groep');
console.log('');

const koppelingen = [];
const problemen = [];

for (const lo of LEERUITKOMSTEN) {
  const g = blok.gevonden?.find((x) => x.lo.code === lo.code);
  // We koppelen alleen als het blok doorlopend is. Dan weten we zeker dat dit de
  // familie van dit semester is en niet een oudere met dezelfde namen.
  const zeker = groepCompleet && Boolean(g?.doel);

  koppelingen.push({
    code: lo.code,
    canvasNaam: lo.naam,
    canvasOutcomeId: lo.canvasOutcomeId,
    portflowGoalId: zeker ? g.doel.id : null,
    portflowNaam: g?.doel?.naam ?? null,
    score: Number((g?.doel?.score ?? 0).toFixed(3)),
    zeker,
    kandidatenOpNaam: blok.perLo?.find((x) => x.lo.code === lo.code)?.kandidaten.length ?? 0,
    toelichting: zeker
      ? `Naam komt exact overeen; de zes doelen vormen een doorlopend blok (${blok.ids.join(', ')}).`
      : 'Niet gekoppeld: de groep van zes is niet met zekerheid de familie van dit semester.',
  });

  if (zeker) {
    console.log(`  KOPPEL  ${lo.code}  ${lo.naam}`);
    console.log(`          → Portflow ${g.doel.id}  "${g.doel.naam}"`);
  } else {
    problemen.push(`${lo.code}: niet gekoppeld (${g?.doel ? 'blok niet doorlopend' : 'geen passend doel'})`);
    console.log(`  OPEN    ${lo.code}  ${lo.naam}`);
  }
}

/* ── Controleren dat het uniek is ───────────────────────────────────────── */

console.log('');
console.log('='.repeat(78));
console.log('CONTROLE');
console.log('='.repeat(78));

const gebruikt = koppelingen.filter((k) => k.portflowGoalId).map((k) => k.portflowGoalId);
const dubbel = gebruikt.filter((id, i) => gebruikt.indexOf(id) !== i);
if (dubbel.length) {
  problemen.push(`doel-id ${[...new Set(dubbel)].join(', ')} wordt voor meerdere leeruitkomsten gebruikt`);
  console.log(`  LET OP: dubbel gebruikt doel-id: ${[...new Set(dubbel)].join(', ')}`);
} else {
  console.log(`  elk leeruitkomst heeft een eigen doel-id (${gebruikt.length} stuks)`);
}

const gekoppeld = koppelingen.filter((k) => k.zeker).length;
console.log(`  gekoppeld: ${gekoppeld} van ${LEERUITKOMSTEN.length}`);

/*
 * Extra controle: hangt het Portflow-doel aan een map van dit semester?
 *
 * Doelen van oude semesters hangen aan oude mappen, en dat is precies de
 * verwarring die we willen voorkomen.
 *
 * LET OP: er zijn TWEE mappen die "Persoonlijk project" heten — 250280 van dit
 * semester en 107320 van een ouder semester. Alleen op naam zoeken pakt de
 * verkeerde. De drie mappen van dit semester zijn in één keer aangemaakt en
 * hebben daarom opeenvolgende id's (250278, 250279, 250280). Dat is het bewijs.
 */
const GEWENSTE_MAPPEN = ['orientatie', 'klantproject', 'persoonlijk project'];

function zoekMapBlok() {
  const perNaam = GEWENSTE_MAPPEN.map((gewenst) => ({
    gewenst,
    kandidaten: portflowMappen
      .filter((m) => String(m.name ?? '').toLowerCase().trim() === gewenst)
      .map((m) => ({ id: m.id, naam: m.name, evidence: m.evidence_count ?? 0 }))
      .sort((a, b) => a.id - b.id),
  }));

  if (perNaam.some((x) => !x.kandidaten.length)) return { gevonden: null, perNaam };

  let beste = null;
  const kies = (index, gekozen) => {
    if (index === perNaam.length) {
      const ids = gekozen.map((g) => g.id);
      const spreiding = Math.max(...ids) - Math.min(...ids);
      if (!beste || spreiding < beste.spreiding) beste = { gekozen: [...gekozen], spreiding };
      return;
    }
    for (const k of perNaam[index].kandidaten) {
      if (gekozen.some((g) => g.id === k.id)) continue;
      gekozen.push(k);
      kies(index + 1, gekozen);
      gekozen.pop();
    }
  };
  kies(0, []);

  if (!beste) return { gevonden: null, perNaam };
  const ids = beste.gekozen.map((g) => g.id).sort((a, b) => a - b);
  return {
    gevonden: perNaam.map((x, i) => ({ naam: x.gewenst, map: beste.gekozen[i], aantalKandidaten: x.kandidaten.length })),
    ids,
    spreiding: beste.spreiding,
    doorlopend: ids.every((id, i) => i === 0 || id === ids[i - 1] + 1),
    perNaam,
  };
}

const mapBlok = zoekMapBlok();

if (mapBlok.gevonden) {
  console.log(`  mappen van dit semester: ${mapBlok.ids.join(', ')}  (spreiding ${mapBlok.spreiding}${mapBlok.doorlopend ? ', doorlopend' : ''})`);
  for (const m of mapBlok.gevonden) {
    console.log(
      `     ${String(m.map.id).padStart(7)}  ${m.naam.padEnd(22)}` +
        (m.aantalKandidaten > 1 ? `   (${m.aantalKandidaten} mappen met deze naam)` : ''),
    );
  }
  if (!mapBlok.doorlopend) {
    console.log('  LET OP: de map-id\'s zijn niet doorlopend; mogelijk een oudere map gekozen.');
    problemen.push('de map-id\'s van dit semester zijn niet doorlopend');
  }
} else {
  console.log('  LET OP: niet alle drie de mappen van dit semester gevonden');
  problemen.push('de mappen orientatie, klantproject en Persoonlijk project zijn niet alle drie gevonden');
}

/* ── Wegschrijven ───────────────────────────────────────────────────────── */

const uit = {
  gemaakt: new Date().toISOString(),
  toelichting:
    'Koppeling tussen de leeruitkomsten van V-OL-MAIFS (Canvas) en de doelen in Portflow. ' +
    'De zes doelen zijn herkend als één doorlopend id-blok (485380-485385), wat bewijst dat ze ' +
    'bij hetzelfde semester horen. Alleen zekere koppelingen staan erin; bij twijfel is portflowGoalId null.',
  portfolioId,
  cursus: { canvasCourseId: 15973, naam: 'V-OL-MAIFS' },
  semesterMappen: (mapBlok.gevonden ?? []).map((m) => ({
    naam: m.map.naam,
    portflowCollectionId: m.map.id,
  })),
  koppelingen,
  problemen,
};

if (SCHRIJF) {
  if (problemen.length) {
    console.log('');
    console.log('  Er zijn nog onzekerheden. Die staan als portflowGoalId: null in het bestand,');
    console.log('  zodat er niets verkeerd gekoppeld wordt.');
  }
  writeFileSync(DOEL, JSON.stringify(uit, null, 2), 'utf8');
  console.log('');
  console.log(`weggeschreven: ${DOEL}`);
} else {
  console.log('');
  console.log('(droogloop — gebruik --schrijf om het bestand te maken)');
}

if (problemen.length) {
  console.log('');
  console.log('aandachtspunten:');
  for (const p of problemen) console.log(`  - ${p}`);
}
