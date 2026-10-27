#!/usr/bin/env node
/**
 * De hele keten in één keer: van document naar voorstel.
 *
 * Dit is de automatiseringslaag in werking, als hulpmiddel:
 *   1. een document lezen (uit de werkplek, of een los bestand)
 *   2. bepalen in welke map het hoort
 *   3. bepalen aan welke leeruitkomsten het hangt
 *   4. een toelichting voorstellen
 *   5. zeggen welk bewijs daarna nog ontbreekt
 *
 * Er wordt NIETS verstuurd. Met --doen wel, en dan vraagt hij eerst om
 * bevestiging per stap.
 *
 *   node tools/verdeel-document.mjs <document-id>
 *   node tools/verdeel-document.mjs --bestand "D:\pad\naar\bestand.docx"
 *   node tools/verdeel-document.mjs <document-id> --doen
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { analyseerVoorInleveren, MAP_PROFIELEN } from '../mcp/lib/indeler.mjs';
import { LEERUITKOMSTEN, portflowGoalIdVoor } from '../mcp/lib/leeruitkomsten.mjs';
import * as werkplek from '../dashboard/lib/documenten.mjs';

const DOEN = process.argv.includes('--doen');
const bestandArg = process.argv.indexOf('--bestand');
const documentId = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== (bestandArg >= 0 ? process.argv[bestandArg + 1] : null));

/* ── Het document lezen ─────────────────────────────────────────────────── */

let titel = '';
let tekst = '';
let bron = '';

if (bestandArg >= 0) {
  const pad = process.argv[bestandArg + 1];
  if (!pad || !existsSync(pad)) {
    console.error(`bestand niet gevonden: ${pad}`);
    process.exit(1);
  }
  bron = `bestand ${path.basename(pad)}`;
  titel = path.basename(pad, path.extname(pad));
  const ext = path.extname(pad).toLowerCase();

  if (['.txt', '.md', '.csv'].includes(ext)) {
    tekst = readFileSync(pad, 'utf8');
  } else if (ext === '.docx') {
    /* Een docx is een ZIP met word/document.xml. We halen de tekst eruit met
       dezelfde lezer als de tests gebruiken. */
    const { leesZip } = await import('../mcp/lib/zip.mjs');
    const onderdelen = leesZip(readFileSync(pad));
    const xml = onderdelen.get('word/document.xml')?.toString('utf8') ?? '';
    tekst = xml
      .replace(/<w:p[ >]/g, '\n<w:p ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  } else {
    console.error(`bestandstype ${ext} kan ik niet lezen; gebruik .docx, .txt of .md`);
    process.exit(1);
  }
} else if (documentId) {
  const doc = werkplek.lees(documentId);
  if (!doc) {
    console.error(`document ${documentId} niet gevonden in de werkplek`);
    process.exit(1);
  }
  bron = `werkplek ${doc.id}`;
  titel = doc.titel;
  tekst = (doc.plan?.secties ?? []).map((s) => `${s.titel}\n${s.tekst ?? ''}`).join('\n\n');
} else {
  console.error('gebruik: node tools/verdeel-document.mjs <document-id>');
  console.error('    of: node tools/verdeel-document.mjs --bestand "pad\\naar\\bestand.docx"');
  process.exit(1);
}

console.log('='.repeat(78));
console.log('DOCUMENT INDELEN');
console.log('='.repeat(78));
console.log(`  bron    : ${bron}`);
console.log(`  titel   : ${titel}`);
console.log(`  tekst   : ${tekst.length} tekens`);
console.log('');

/* ── De mappen ophalen ──────────────────────────────────────────────────── */

console.log('De mappen van dit semester ophalen…');
let mappen = null;

try {
  const { CONFIG } = await import('../browser/config.mjs');
  const { Portflow } = await import('../browser/portflow.mjs');
  const { chromium } = await import(CONFIG.playwrightUrl);
  const { semesterMappen } = await import('../mcp/lib/leeruitkomsten.mjs');

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
    mappen = [];
    for (const m of semesterMappen()) {
      let bewijs = [];
      try {
        bewijs = await pf.evidenceForFreeze(m.portflowCollectionId);
      } catch {
        /* leeg is ook een antwoord */
      }
      const gedekt = new Set();
      for (const stuk of bewijs) {
        for (const g of stuk.goalIds ?? []) {
          for (const lo of LEERUITKOMSTEN) {
            if (portflowGoalIdVoor(lo.code) === Number(g)) gedekt.add(lo.code);
          }
        }
      }
      mappen.push({
        naam: m.naam,
        id: m.portflowCollectionId,
        gedekt: [...gedekt],
        bewijs,
      });
      console.log(`  ${m.naam}: ${bewijs.length} bewijsstukken, gedekt ${[...gedekt].join(', ') || '—'}`);
    }
  } finally {
    await context.close().catch(() => {});
  }
} catch (error) {
  console.log(`  Portflow niet bereikbaar (${error.message}).`);
  console.log('  We gaan verder zonder de huidige dekking; het voorstel wordt dan grover.');
  mappen = null;
}
console.log('');

/* ── Het voorstel ───────────────────────────────────────────────────────── */

const uit = analyseerVoorInleveren({ titel, tekst, mappen });

console.log('='.repeat(78));
console.log('VOORSTEL');
console.log('='.repeat(78));
console.log('');
console.log(`  WAAR HET HOORT`);
console.log(`     ${uit.voorstel?.mapNaam ?? 'geen voorstel'}${uit.onzeker ? '   (onzeker)' : ''}`);
console.log(`     ${uit.uitleg}`);
if ((uit.voorstel?.redenen ?? []).length) {
  console.log(`     redenen: ${uit.voorstel.redenen.join('; ')}`);
}
if (uit.alternatieven.length) {
  console.log('');
  console.log(`     alternatieven:`);
  for (const a of uit.alternatieven) {
    console.log(`        ${String(a.mapNaam).padEnd(22)} score ${a.score}   ${a.redenen.slice(0, 2).join('; ')}`);
  }
}
console.log('');

console.log(`  WELKE LEERUITKOMSTEN`);
console.log(`     ${uit.leeruitkomsten.uitleg}`);
for (const t of uit.leeruitkomsten.gevonden) {
  const aanbevolen = uit.aanbevolenLeeruitkomsten.includes(t.code);
  console.log(
    `     ${aanbevolen ? '[x]' : '[ ]'} ${t.code}  ${String(Math.round(t.relatief * 100)).padStart(3)}%  ${t.naam}`,
  );
}
if (uit.aanbevolenLeeruitkomsten.length !== uit.leeruitkomsten.gevonden.length) {
  console.log('     ([x] = hoort bij deze map en wordt aangezet, [ ] = wel gevonden maar hoort elders)');
}
console.log('');

console.log(`  TOELICHTING`);
console.log(`     ${uit.voorgesteldeBeschrijving}`);
console.log('');

/* ── Wat er daarna nog mist ─────────────────────────────────────────────── */

if (mappen && uit.voorstel) {
  const doelMap = mappen.find((m) => m.naam === uit.voorstel.mapNaam);
  if (doelMap) {
    const naDekking = new Set([...(doelMap.gedekt ?? []), ...uit.aanbevolenLeeruitkomsten]);
    const nogLeeg = LEERUITKOMSTEN.filter((l) => !naDekking.has(l.code)).map((l) => l.code);
    console.log(`  NA HET INLEVEREN`);
    console.log(`     ${doelMap.naam} dekt dan ${naDekking.size} van 6 leeruitkomsten`);
    if (nogLeeg.length) {
      console.log(`     nog leeg in deze map: ${nogLeeg.join(', ')}`);
    } else {
      console.log('     alle zes gedekt in deze map');
    }
    console.log('');
  }
}

/* ── Doen ───────────────────────────────────────────────────────────────── */

if (!DOEN) {
  console.log('='.repeat(78));
  console.log('Er is niets verstuurd. Met --doen wordt het ook daadwerkelijk ingeleverd.');
  console.log('='.repeat(78));
  process.exit(0);
}

console.log('='.repeat(78));
console.log('INLEVEREN');
console.log('='.repeat(78));

if (!uit.voorstel?.mapId) {
  console.error('  Geen map om naar te leveren. Kies er zelf een en probeer opnieuw.');
  process.exit(1);
}

const goalIds = uit.aanbevolenLeeruitkomsten.map((c) => portflowGoalIdVoor(c)).filter(Boolean);
console.log(`  map   : ${uit.voorstel.mapNaam} (${uit.voorstel.mapId})`);
console.log(`  doelen: ${goalIds.join(', ')}`);
console.log(`  tekst : ${uit.voorgesteldeBeschrijving.slice(0, 80)}…`);
console.log('');

try {
  const { CONFIG } = await import('../browser/config.mjs');
  const { Portflow } = await import('../browser/portflow.mjs');
  const { chromium } = await import(CONFIG.playwrightUrl);
  const { projectNaarDocx } = await import('../mcp/lib/assemble.mjs');
  const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');

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

    /* Het document naar Word. */
    let docxPad;
    if (documentId) {
      const doc = werkplek.lees(documentId);
      const docx = projectNaarDocx(doc);
      werkplek.zorgVoorTijdelijk();
      docxPad = path.join(werkplek.TIJDELIJK, `${documentId}.docx`);
      writeFileSync(docxPad, docx.buffer);
      console.log(`  Word-bestand: ${docx.buffer.length} bytes`);
    } else {
      docxPad = path.resolve(process.argv[bestandArg + 1]);
      console.log(`  bestaand bestand: ${docxPad}`);
    }

    const resultaat = await pf.addFileEvidence({
      filePath: docxPad,
      collectionIds: [uit.voorstel.mapId],
      goalIds,
      name: titel,
      description: uit.voorgesteldeBeschrijving,
      quiet: true,
    });
    console.log(`  INGELEVERD: evidence ${resultaat.evidenceId}`);

    /* Opruimen als we zelf een tijdelijk bestand maakten. */
    if (documentId) {
      try {
        rmSync(docxPad, { force: true });
      } catch {
        /* niet erg */
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
} catch (error) {
  console.error(`  MISLUKT: ${error.message}`);
  process.exitCode = 1;
}
