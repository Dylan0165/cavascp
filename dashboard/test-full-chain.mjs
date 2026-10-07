#!/usr/bin/env node
/**
 * Test de hele keten: document in het dashboard zetten en het via de
 * Portflow-knop versturen, precies zoals de gebruiker dat doet.
 *
 * Wat er getest wordt:
 *   1. upload naar de document-inbox van het dashboard
 *   2. Portflow-collecties ophalen via het dashboard-endpoint
 *   3. het document naar een collectie sturen
 *   4. controleren dat het in Portflow staat
 *   5. opruimen: bewijsstuk in Portflow weg, document uit de inbox
 *
 * Draait tegen de al lopende server op poort 8787. Gebruik --keep om het
 * testbewijs te laten staan.
 *
 *   node test-full-chain.mjs
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const PORT = process.env.CAVASCP_PORT || 8787;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const KEEP = process.argv.includes('--keep');

/**
 * Het dashboard is afgeschermd. Deze test haalt eerst de sessiecookie op bij de
 * bootstrappagina en gebruikt die daarna bij elke API-call â€” precies zoals de
 * browser het doet.
 */
let sessionCookie = null;
async function authenticate() {
  const res = await fetch(`${ORIGIN}/`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/cavascp_session=([^;]+)/);
  if (!match) throw new Error('geen sessiecookie van de bootstrappagina');
  sessionCookie = `cavascp_session=${match[1]}`;
}

function api(path, options = {}) {
  return fetch(`${ORIGIN}${path}`, {
    ...options,
    headers: { Origin: ORIGIN, Cookie: sessionCookie, ...(options.headers ?? {}) },
  });
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` â€” ${detail}` : ''}`);
};

const TEST_NAME = `cavascp ketentest ${Date.now()}`;
const testFile = path.join(tmpdir(), 'cavascp-chain-test.txt');
await writeFile(
  testFile,
  `Keten test\n${new Date().toISOString()}\nDit bestand is automatisch aangemaakt en mag weg.\n`,
  'utf8',
);

let documentId = null;
let evidenceId = null;

try {
  await authenticate();

  console.log('1) document in de inbox zetten');
  const form = new FormData();
  form.append('file', new Blob([await import('node:fs').then((fs) => fs.readFileSync(testFile))], { type: 'text/plain' }), 'ketentest.txt');
  form.append('title', TEST_NAME);
  form.append('loCodes', 'LO1, LO2');

  const up = await api('/api/documents', { method: 'POST', body: form });
  const upBody = await up.json();
  check('upload geaccepteerd', up.status === 201, `status ${up.status} ${upBody.error ?? ''}`);
  documentId = upBody.document?.id;
  check('document heeft een id', Boolean(documentId), documentId);
  check('LO-codes bewaard', JSON.stringify(upBody.document?.loCodes) === '["LO1","LO2"]');

  console.log('\n2) Portflow-collecties ophalen');
  const colRes = await api('/api/portflow/collections');
  const colBody = await colRes.json();
  check('collecties opgehaald', colRes.ok && colBody.ok, `${colBody.collections?.length ?? 0} collecties`);
  const target =
    colBody.collections?.find((c) => c.evidenceCount > 0) ?? colBody.collections?.[0];
  check('een doelcollectie gevonden', Boolean(target), target ? `${target.id} ${target.name}` : 'â€”');

  console.log('\n3) document naar Portflow sturen');
  const send = await api('/api/portflow/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, collectionId: target.id }),
  });
  const sendBody = await send.json();
  check('versturen gelukt', send.ok && sendBody.ok, sendBody.error ?? '');
  evidenceId = sendBody.evidenceId;
  check('bewijsstuk aangemaakt', Boolean(evidenceId), `evidence ${evidenceId}`);
  check('juiste collectie', sendBody.collection?.id === target.id, sendBody.collection?.name);

  console.log('\n4) controleren in Portflow');
  // Onafhankelijke controle: via de brug, niet via het dashboard.
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
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const pf = new Portflow(page);
    await pf.connect();
    const all = await pf.allEvidence({ perPage: 200 });
    const items = Array.isArray(all.data) ? all.data : [];
    const found = items.find((e) => e.id === evidenceId);
    check('teruggevonden in Portflow', Boolean(found), found ? `"${found.name}"` : 'niet gevonden');
    if (found) {
      const names = (found.collections ?? []).map((c) => c.name);
      check('staat in de juiste collectie', names.includes(target.name), names.join(', ') || 'â€”');
    }

    /* Het document moet nu weten waar het staat. */
    const docsRes = await api('/api/documents');
    const docsBody = await docsRes.json();
    const doc = docsBody.documents?.find((d) => d.id === documentId);
    check('document onthoudt de bestemming', doc?.portflow?.evidenceId === evidenceId,
      doc?.portflow?.collectionName ?? 'geen');

    console.log('\n5) opruimen');
    if (!KEEP) {
      const status = await pf.deleteEvidence(evidenceId);
      check('bewijsstuk verwijderd uit Portflow', status === 204 || status === 200, `status ${status}`);
      const after = await pf.allEvidence({ perPage: 200 });
      const still = (Array.isArray(after.data) ? after.data : []).some((e) => e.id === evidenceId);
      check('weg uit Portflow', !still);
    } else {
      console.log(`  --keep: evidence ${evidenceId} blijft staan`);
    }
  } finally {
    await context.close().catch(() => {});
  }

  if (!KEEP) {
    const del = await api(`/api/documents/${documentId}`, { method: 'DELETE' });
    check('document uit de inbox verwijderd', del.ok, `status ${del.status}`);
  }
} catch (error) {
  check(`onverwachte fout: ${error.message}`, false);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
