#!/usr/bin/env node
/**
 * Waarom geeft Canvas "user not authorized" bij het uploaden?
 *
 * Op de testopdracht gaf .docx geen "filetype not allowed" maar
 * "user not authorized to perform that action". Dat betekent dat het type goed
 * is en er iets anders misgaat. Mogelijke oorzaken:
 *
 *   1. De opdracht staat geen uploads toe voor jouw enrollment
 *   2. Het opdracht-specifieke upload-endpoint is dicht, maar het algemene
 *      /users/self/files werkt wel
 *   3. De opdracht is gesloten of de inleverperiode is voorbij
 *
 * We testen daarom drie uploadroutes tegen een echte, nog open opdracht:
 *   A. het opdracht-specifieke endpoint
 *   B. het algemene /users/self/files endpoint
 *   C. het opdracht-endpoint met een expliciet toegestane extensie
 *
 * Alleen stap 1 (uploadplek aanvragen). Er wordt niets geüpload of ingeleverd.
 */

import { loadEnvFile, createCanvas } from '../mcp/lib/canvas.mjs';

const env = await loadEnvFile('D:/cavascp/.env');
const canvas = createCanvas({ baseUrl: env.CANVAS_BASE_URL, token: env.CANVAS_TOKEN });

/** De opdracht waar het echt om gaat: V-OL-MAIFS, 9 oktober. */
const TARGETS = [
  { course: 15973, assignment: 278562, label: 'V-OL-MAIFS · Portfolio voor eerste review' },
  { course: 15833, assignment: 276310, label: 'INTERN5 · Portfolio voor eerste review' },
];

const attempt = async (label, fn) => {
  try {
    const result = await fn();
    console.log(`  JA   ${label}`);
    return { label, ok: true, result };
  } catch (error) {
    const message = error.message.replace(/^Canvas gaf \d+ op POST [^:]+:\s*/, '').slice(0, 110);
    console.log(`  NEE  ${label} → ${message}`);
    return { label, ok: false, message };
  }
};

for (const target of TARGETS) {
  console.log('='.repeat(74));
  console.log(`${target.label}  (cursus ${target.course}, opdracht ${target.assignment})`);
  console.log('='.repeat(74));

  /* Eerst: wat zegt de opdracht zelf? */
  try {
    const info = await canvas.get(`/api/v1/courses/${target.course}/assignments/${target.assignment}`, {
      'include[]': ['submission'],
    });
    console.log(`  opdracht      : ${info?.name}`);
    console.log(`  inlevervormen : ${(info?.submission_types ?? []).join(', ') || '—'}`);
    console.log(`  pogingen      : ${info?.allowed_attempts} (-1 = onbeperkt)`);
    console.log(`  vergrendeld   : ${info?.locked_for_user ? 'JA' : 'nee'}`);
    console.log(`  nog in te leveren: ${info?.submission?.workflow_state ?? '?'}`);
  } catch (error) {
    console.log(`  opdrachtinfo mislukt: ${error.message.slice(0, 100)}`);
  }
  console.log('');

  /* A: opdracht-specifiek endpoint */
  await attempt('A. opdracht-endpoint (.docx)', () =>
    canvas.post(`/api/v1/courses/${target.course}/assignments/${target.assignment}/submissions/self/files`, {
      name: 'test.docx',
      size: 1200,
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );

  /* B: algemeen bestandsendpoint */
  await attempt('B. /users/self/files (.docx)', () =>
    canvas.post('/api/v1/users/self/files', {
      name: 'test.docx',
      size: 1200,
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );

  /* C: cursus-brede bestandsmap */
  await attempt('C. cursus-bestand (.docx)', () =>
    canvas.post(`/api/v1/courses/${target.course}/files`, {
      name: 'test.docx',
      size: 1200,
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );

  /* D: wat vindt Canvas van dit token? */
  await attempt('D. eigen bestandsquota', () => canvas.get('/api/v1/users/self/files/quota'));

  console.log('');
}

/* Hoeveel ruimte is er? */
try {
  const quota = await canvas.get('/api/v1/users/self/files/quota');
  console.log(`Bestandsquota: ${JSON.stringify(quota)}`);
} catch (error) {
  console.log(`quota niet op te vragen: ${error.message.slice(0, 90)}`);
}
