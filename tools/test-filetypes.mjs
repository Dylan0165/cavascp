#!/usr/bin/env node
/**
 * Welke bestandstypen accepteert Canvas bij het uploaden?
 *
 * Canvas weigerde .txt met "filetype not allowed". Voor de inleverknop moet
 * bekend zijn wat wél mag, anders faalt de gebruiker op het laatste moment.
 *
 * We testen dit door alleen een uploadplek aan te vragen (stap 1). Dat is een
 * goedkope check: Canvas antwoordt met 400 "filetype not allowed" of geeft een
 * upload_url terug. Er wordt niets geüpload en niets ingeleverd.
 *
 *   node tools/test-filetypes.mjs
 */

import { loadEnvFile, createCanvas } from '../mcp/lib/canvas.mjs';

const COURSE_ID = 14094;
const ASSIGNMENT_ID = 244979;

const env = await loadEnvFile('D:/cavascp/.env');
const canvas = createCanvas({ baseUrl: env.CANVAS_BASE_URL, token: env.CANVAS_TOKEN });

const TYPES = [
  ['txt', 'text/plain', 120],
  ['md', 'text/markdown', 120],
  ['pdf', 'application/pdf', 900],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1200],
  ['doc', 'application/msword', 1200],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1200],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 1200],
  ['png', 'image/png', 900],
  ['jpg', 'image/jpeg', 900],
  ['zip', 'application/zip', 900],
  ['mp4', 'video/mp4', 900],
  ['csv', 'text/csv', 120],
  ['json', 'application/json', 120],
  ['py', 'text/x-python', 120],
];

console.log(`Uploadplek aanvragen bij cursus ${COURSE_ID}, opdracht ${ASSIGNMENT_ID}`);
console.log('(alleen stap 1 — er wordt niets geüpload of ingeleverd)');
console.log('');

const results = [];
for (const [ext, mime, size] of TYPES) {
  try {
    const ticket = await canvas.post(
      `/api/v1/courses/${COURSE_ID}/assignments/${ASSIGNMENT_ID}/submissions/self/files`,
      { name: `test.${ext}`, size, content_type: mime },
    );
    const ok = Boolean(ticket?.upload_url);
    results.push({ ext, ok, detail: ok ? 'toegestaan' : 'geen upload_url' });
    console.log(`  ${ok ? 'JA ' : 'NEE'}  .${ext.padEnd(5)} ${ok ? 'toegestaan' : JSON.stringify(ticket).slice(0, 60)}`);
  } catch (error) {
    const message = error.message.replace(/^Canvas gaf \d+ op POST [^:]+:\s*/, '');
    results.push({ ext, ok: false, detail: message });
    console.log(`  NEE  .${ext.padEnd(5)} ${message.slice(0, 80)}`);
  }
}

const allowed = results.filter((r) => r.ok).map((r) => r.ext);
const blocked = results.filter((r) => !r.ok).map((r) => r.ext);

console.log('');
console.log('─'.repeat(64));
console.log(`  toegestaan : ${allowed.join(', ') || '—'}`);
console.log(`  geweigerd  : ${blocked.join(', ') || '—'}`);
console.log('─'.repeat(64));
