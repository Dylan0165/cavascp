#!/usr/bin/env node
/**
 * Test de document-inbox: de multipart-parser los, Ã©n de hele HTTP-cyclus.
 *
 * Start zijn eigen server op een aparte poort, zodat een al draaiend dashboard
 * niet in de weg zit en de test niets in de echte inbox achterlaat.
 *
 *   node test-documents.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseMultipart } from './lib/documents.mjs';

const PORT = 8899;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Het dashboard is afgeschermd: de API eist een sessiecookie. Deze test haalt
 * die eerst op bij de bootstrappagina, precies zoals een browser doet.
 */
let sessionCookie = null;
async function authenticate() {
  const res = await fetch(`${ORIGIN}/`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/cavascp_session=([^;]+)/);
  if (!match) throw new Error('geen sessiecookie van de bootstrappagina');
  sessionCookie = `cavascp_session=${match[1]}`;
  return sessionCookie;
}

/** fetch met de sessiecookie en de juiste Origin. */
function api(path, options = {}) {
  return fetch(`${ORIGIN}${path}`, {
    ...options,
    headers: { Origin: ORIGIN, Cookie: sessionCookie, ...(options.headers ?? {}) },
  });
}

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` â€” ${detail}` : ''}`);
}

/* â”€â”€ 1. multipart-parser, zonder server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

console.log('1) multipart-parser');
{
  const payload = Buffer.from([0x25, 0x50, 0x44, 0x46]); // "%PDF"
  const body = Buffer.concat([
    Buffer.from('--BND\r\nContent-Disposition: form-data; name="title"\r\n\r\nMijn verslag\r\n'),
    Buffer.from('--BND\r\nContent-Disposition: form-data; name="loCodes"\r\n\r\nLO1, LO2\r\n'),
    Buffer.from(
      '--BND\r\nContent-Disposition: form-data; name="file"; filename="verslag.pdf"\r\nContent-Type: application/pdf\r\n\r\n',
    ),
    payload,
    Buffer.from('\r\n--BND--\r\n'),
  ]);

  const parsed = parseMultipart(body, 'multipart/form-data; boundary=BND');
  check('tekstvelden gelezen', parsed.fields.title === 'Mijn verslag', JSON.stringify(parsed.fields));
  check('bestandsnaam gelezen', parsed.file?.filename === 'verslag.pdf');
  check('content-type gelezen', parsed.file?.contentType === 'application/pdf');
  check('bytes exact', parsed.file?.data.length === 4, `${parsed.file?.data.length} bytes`);
  check('inhoud intact', parsed.file?.data.toString() === '%PDF');
  check('meerdere velden', parsed.fields.loCodes === 'LO1, LO2');
}

/* â”€â”€ 2. server met een tijdelijke documentmap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

// The server takes its inbox location from the environment, so this test gets
// its own scratch directory and never touches the real dashboard/documents/.
const scratch = mkdtempSync(path.join(tmpdir(), 'cavascp-docs-'));

const server = spawn(process.execPath, [path.resolve('server.mjs')], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    CAVASCP_PORT: String(PORT),
    CAVASCP_DOC_DIR: scratch,
    CAVASCP_DOC_INDEX: path.join(scratch, 'documents.json'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.setEncoding('utf8');
server.stderr.setEncoding('utf8');

let serverOut = '';
server.stdout.on('data', (d) => (serverOut += d));
server.stderr.on('data', (d) => (serverOut += d));

let createdId = null;

try {
  // Wait for the port to answer, then authenticate like a browser would.
  let up = false;
  for (let i = 0; i < 60; i += 1) {
    await sleep(300);
    try {
      await authenticate();
      const res = await api('/api/health');
      if (res.ok) {
        up = true;
        break;
      }
    } catch {
      /* not up yet */
    }
  }
  if (!up) throw new Error(`server startte niet. Uitvoer:\n${serverOut}`);

  console.log('\n2) uploaden via HTTP');
  const form = new FormData();
  form.append('title', 'Testbewijs');
  form.append('note', 'Aangemaakt door test-documents.mjs');
  form.append('loCodes', 'LO1, LO3');
  form.append('file', new Blob([Buffer.from('testinhoud')], { type: 'text/plain' }), 'bewijs test.txt');

  const up1 = await api('/api/documents', { method: 'POST', body: form });
  const created = await up1.json();
  check('upload geaccepteerd', up1.status === 201, `status ${up1.status} ${created.error ?? ''}`);
  check('document heeft een id', Boolean(created.document?.id), created.document?.id);
  check('titel overgenomen', created.document?.title === 'Testbewijs');
  check('LO-codes gesplitst', JSON.stringify(created.document?.loCodes) === '["LO1","LO3"]', JSON.stringify(created.document?.loCodes));
  check('grootte klopt', created.document?.size === 10, `${created.document?.size} bytes`);
  createdId = created.document?.id;

  console.log('\n3) terugvinden en downloaden');
  const list = await (await api('/api/documents')).json();
  check('staat in de lijst', list.documents?.some((d) => d.id === createdId), `${list.documents?.length} document(en)`);
  check('statistieken kloppen', list.stats?.count === 1, JSON.stringify(list.stats));

  const dl = await api(`/api/documents/${createdId}/file`);
  const text = await dl.text();
  check('download geeft inhoud', text === 'testinhoud', JSON.stringify(text));
  check('download is een attachment', (dl.headers.get('content-disposition') || '').startsWith('attachment'));

  console.log('\n4) metadata bewerken');
  const patch = await api(`/api/documents/${createdId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'aangepast', loCodes: ['LO2'] }),
  });
  const patched = await patch.json();
  check('notitie aangepast', patched.document?.note === 'aangepast');
  check('LO-codes aangepast', JSON.stringify(patched.document?.loCodes) === '["LO2"]');

  console.log('\n5) weigeren van gevaarlijke uploads');
  const exeForm = new FormData();
  exeForm.append('file', new Blob([Buffer.from('MZ')]), 'kwaad.exe');
  const exeRes = await api('/api/documents', { method: 'POST', body: exeForm });
  const exeBody = await exeRes.json();
  check('uitvoerbaar bestand geweigerd', exeRes.status === 400, `${exeRes.status}: ${exeBody.error}`);

  console.log('\n6) padvrijheid van de bestandsroute');
  const traversal = await api('/api/documents/..%2F..%2Fserver.mjs/file');
  check('geen path traversal', traversal.status === 404, `status ${traversal.status}`);

  console.log('\n7) verwijderen');
  const del = await api(`/api/documents/${createdId}`, { method: 'DELETE' });
  const delBody = await del.json();
  check('verwijderd', delBody.removed === true);
  check('lijst weer leeg', delBody.stats?.count === 0, JSON.stringify(delBody.stats));
  const gone = await api(`/api/documents/${createdId}/file`);
  check('bestand echt weg', gone.status === 404, `status ${gone.status}`);
} catch (error) {
  check(`onverwachte fout: ${error.message}`, false);
} finally {
  server.kill();
  await sleep(300);
  rmSync(scratch, { recursive: true, force: true });
  console.log('\n(de echte inbox in dashboard/documents/ is niet aangeraakt)');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
