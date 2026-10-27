#!/usr/bin/env node
/**
 * Test de inlever-keten.
 *
 * LET OP: de oorspronkelijke testopdracht (14094/244979, "Deze inleveropdracht
 * niet gebruiken.") blijkt vergrendeld — hij zit in een niet-gepubliceerde
 * module, dus Canvas weigert elke inlevering met "user not authorized". Dat is
 * geen fout in de keten maar een eigenschap van die opdracht.
 *
 * Daarom test deze versie:
 *   1. de upload tegen de echte, open opdracht (dat mag: een bestand in je
 *      Canvas-bestanden zetten levert niets in);
 *   2. de inleverstap door te controleren of Canvas hem zou accepteren
 *      (niet vergrendeld, juiste inlevervorm, pogingen over) — zónder
 *      daadwerkelijk in te leveren op werk dat je nodig hebt.
 *
 *   node tools/test-submit.mjs            # uploaden + geschiktheidscheck
 *   node tools/test-submit.mjs --echt     # ook daadwerkelijk inleveren
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { ENV_PAD, inData, inProject } from '../mcp/lib/paden.mjs';
import { loadEnvFile, createCanvas } from '../mcp/lib/canvas.mjs';
import { submitFile } from '../mcp/lib/submit.mjs';

/** De opdracht waar het om gaat: V-OL-MAIFS, deadline 9 oktober. */
const COURSE_ID = 15973;
const ASSIGNMENT_ID = 278562;
const ECHT = process.argv.includes('--echt');

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const env = await loadEnvFile(ENV_PAD);
const canvas = createCanvas({ baseUrl: env.CANVAS_BASE_URL, token: env.CANVAS_TOKEN });

/* Een klein, herkenbaar testbestand. */
await mkdir('data/tmp', { recursive: true });
const testFile = `data/tmp/inlever-test-${Date.now()}.txt`;
await writeFile(
  testFile,
  [
    'Dit bestand is automatisch ingeleverd door cavascp om de inlever-keten te testen.',
    `Tijdstip: ${new Date().toISOString()}`,
    'Opdracht: "Deze inleveropdracht niet gebruiken."',
    'Je kunt deze inlevering verwijderen; er is niets overschreven.',
  ].join('\n'),
  'utf8',
);

console.log('Doel');
console.log(`  cursus     : ${COURSE_ID} (V-OL-MAIFS)`);
console.log(`  opdracht   : ${ASSIGNMENT_ID} (Portfolio voor eerste review)`);
console.log(`  bestand    : ${testFile}`);
console.log(`  modus      : ${ECHT ? 'uploaden + ECHT inleveren' : 'uploaden + geschiktheidscheck'}`);
console.log('');

/* Vooraf: is deze opdracht geschikt om in te leveren? */
console.log('1) geschiktheidscheck');
{
  const info = await canvas.get(`/api/v1/courses/${COURSE_ID}/assignments/${ASSIGNMENT_ID}`, {
    'include[]': ['submission'],
  });
  console.log(`  naam           : ${info?.name}`);
  console.log(`  inlevervormen  : ${(info?.submission_types ?? []).join(', ')}`);
  console.log(`  pogingen       : ${info?.allowed_attempts}`);
  console.log(`  vergrendeld    : ${info?.locked_for_user ? 'JA' : 'nee'}`);
  console.log(`  deadline       : ${String(info?.due_at).slice(0, 16)}`);

  check('opdracht bereikbaar', Boolean(info?.id), `assignment ${info?.id}`);
  check('niet vergrendeld', info?.locked_for_user === false);
  check('bestand inleveren toegestaan', (info?.submission_types ?? []).includes('online_upload'));
  check('pogingen over', info?.allowed_attempts === -1 || (info?.allowed_attempts ?? 0) > 0, `${info?.allowed_attempts}`);
  check('nog niet ingeleverd', (info?.submission?.workflow_state ?? 'unsubmitted') === 'unsubmitted');
}

/* De upload zelf — dat mag altijd, dat levert niets in. */
console.log('\n2) uploaden naar Canvas');
let outcome = null;
try {
  outcome = await submitFile(canvas, {
    courseId: COURSE_ID,
    assignmentId: ASSIGNMENT_ID,
    filePath: testFile,
    comment: 'Automatische testinlevering via cavascp.',
    dryRun: !ECHT,
  });
  for (const step of outcome.steps) {
    console.log(`  · ${step.message}`);
  }
  check('upload gelukt', Boolean(outcome.upload?.fileId), `file-id ${outcome.upload?.fileId}`);
  check('bestandsnaam behouden', outcome.upload?.filename === testFile.split('/').pop(), outcome.upload?.filename);
  check('grootte klopt', outcome.upload?.size > 0, `${outcome.upload?.size} bytes`);
  if (!ECHT) {
    check('droogloop: niets ingeleverd', outcome.dryRun === true);
  }
} catch (error) {
  check(`keten mislukt: ${error.message}`, false);
}

if (ECHT) {
  console.log('\n3) teruglezen bij Canvas');
  await new Promise((r) => setTimeout(r, 2500));
  const after = await canvas.get(
    `/api/v1/courses/${COURSE_ID}/assignments/${ASSIGNMENT_ID}/submissions/self`,
    { 'include[]': ['submission_comments', 'assignment'] },
  );
  check('Canvas meldt ingeleverd', after?.workflow_state === 'submitted', after?.workflow_state);
  check('poging opgehoogd', (after?.attempt ?? 0) >= 1, `poging ${after?.attempt}`);
  const attachments = after?.attachments ?? [];
  check('bestand hangt eraan', attachments.length > 0, `${attachments.length} bijlage(n)`);
  for (const a of attachments) console.log(`    · ${a.display_name} (${a.size} bytes)`);
} else {
  console.log('\n3) inleveren overgeslagen');
  console.log('  Dit is je echte portfolio-opdracht. De keten is getest tot en met de');
  console.log('  upload; het laatste request (POST /submissions) is dezelfde aanroep die');
  console.log('  in diagnose-submit-permission.mjs de bevoegdheid controleert.');
  console.log('  Wil je hem toch echt testen: node tools/test-submit.mjs --echt');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
