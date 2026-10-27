#!/usr/bin/env node
/**
 * Test de automatiseringslaag via het dashboard: een document in de inbox
 * wordt gelezen en de app zegt waar het hoort.
 *
 * Er wordt niets naar Portflow gestuurd. Het document wordt in de inbox gezet,
 * geanalyseerd, en daarna weer verwijderd.
 *
 *   node tools/test-inbox-indelen.mjs
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { bouwDocx } from '../mcp/lib/docx.mjs';

const ORIGIN = `http://127.0.0.1:${process.env.CAVASCP_PORT || 8787}`;
const TMP = path.resolve('data/tmp-inbox');

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

mkdirSync(TMP, { recursive: true });

let cookie = null;
const api = (pad, opties = {}) =>
  fetch(`${ORIGIN}${pad}`, {
    ...opties,
    headers: { Origin: ORIGIN, Cookie: cookie, ...(opties.headers || {}) },
  });

let docId = null;

try {
  const boot = await fetch(`${ORIGIN}/`);
  cookie = (boot.headers.get('set-cookie') || '').match(/cavascp_session=[^;]+/)?.[0];
  check('sessie gekregen', Boolean(cookie));

  /* ── Een Word-bestand maken en in de inbox zetten ───────────────────── */
  console.log('\n1) Een document in de inbox zetten');
  const doc = {
    titel: 'Reflectie op mijn ontwikkeling',
    auteur: 'Dylan Schuurman',
    secties: [
      {
        titel: 'Reflectie',
        niveau: 1,
        blokken: [
          {
            type: 'paragraph',
            tekst:
              'Terugkijkend op deze periode zie ik dat ik sterk ben in het analyseren van problemen, maar dat ik ' +
              'te lang doorwerk zonder hulp te vragen. Dat is een zwakte die mijn groei remt. Mijn kernwaarden zijn ' +
              'nieuwsgierigheid en betrouwbaarheid. Ik heb me voorgenomen om vaker feedback te vragen en heb ' +
              'leerdoelen opgesteld voor mijn persoonlijke ontwikkeling.',
          },
        ],
      },
    ],
  };
  const uit = bouwDocx(doc, { kleuren: {}, labels: {} });
  const bestand = 'Reflectie_ontwikkeling.docx';
  const pad = path.join(TMP, bestand);
  writeFileSync(pad, uit.buffer);
  console.log(`     ${bestand}: ${uit.buffer.length} bytes`);

  /* Als multipart naar de inbox, net als de echte upload. */
  const form = new FormData();
  form.append('file', new Blob([uit.buffer]), bestand);
  form.append('title', 'Reflectie op mijn ontwikkeling');

  const upload = await api('/api/documents', { method: 'POST', body: form });
  const uploadBody = await upload.json();
  check('upload geaccepteerd', upload.status === 201, `status ${upload.status}`);
  docId = uploadBody.document?.id ?? null;
  check('document heeft een id', Boolean(docId), String(docId));

  /* ── De automatiseringslaag ─────────────────────────────────────────── */
  console.log('\n2) De app laten bepalen waar het hoort');
  const res = await api(`/api/documenten/inbox/${encodeURIComponent(docId)}/indelen`);
  const body = await res.json();
  check('het endpoint antwoordt', res.ok, `status ${res.status}`);
  if (!res.ok) throw new Error(body.error ?? 'onbekende fout');

  console.log(`     tekst gelezen: ${body.tekst.gelukt ? 'ja' : 'nee'} (${body.tekst.tekens} tekens, ${body.tekst.soort})`);
  if (body.tekst.reden) console.log(`     reden: ${body.tekst.reden}`);
  check('de tekst is gelezen', body.tekst.gelukt, `${body.tekst.tekens} tekens`);
  check('er is genoeg tekst om op af te gaan', body.tekst.tekens > 150, `${body.tekst.tekens}`);

  console.log('');
  console.log(`     VOORSTEL: ${body.voorstel?.mapNaam ?? 'geen'}`);
  console.log(`     ${body.uitleg}`);
  if (body.voorstel?.redenen?.length) console.log(`     redenen: ${body.voorstel.redenen.join('; ')}`);
  if (body.alternatieven?.length) {
    for (const a of body.alternatieven) console.log(`        alternatief: ${a.mapNaam} (${a.score})`);
  }

  check('er is een voorstel', Boolean(body.voorstel), body.voorstel?.mapNaam ?? 'niets');
  check(
    'het voorstel is Persoonlijk project',
    body.voorstel?.mapNaam === 'Persoonlijk project',
    body.voorstel?.mapNaam ?? 'niets',
  );
  check(
    'het voorstel heeft een map-id uit dit semester',
    [250278, 250279, 250280].includes(body.voorstel?.mapId),
    String(body.voorstel?.mapId),
  );

  /* ── De leeruitkomsten ──────────────────────────────────────────────── */
  console.log('\n3) Leeruitkomsten');
  console.log(`     ${body.leeruitkomsten.uitleg}`);
  for (const t of body.leeruitkomsten.gevonden) {
    const aan = body.aanbevolenLeeruitkomsten.includes(t.code);
    console.log(`     ${aan ? '[x]' : '[ ]'} ${t.code} ${String(Math.round(t.relatief * 100)).padStart(3)}% ${t.naam}`);
  }
  check('er zijn leeruitkomsten gevonden', body.leeruitkomsten.gevonden.length > 0, body.leeruitkomsten.gevonden.map((t) => t.code).join(', '));
  check(
    'LO5 zit erbij (het gaat over persoonlijke ontwikkeling)',
    body.leeruitkomsten.gevonden.some((t) => t.code === 'LO5'),
    body.leeruitkomsten.gevonden.map((t) => t.code).join(', '),
  );
  check('er zijn aanbevolen leeruitkomsten', body.aanbevolenLeeruitkomsten.length > 0, body.aanbevolenLeeruitkomsten.join(', '));

  /* ── De toelichting ─────────────────────────────────────────────────── */
  console.log('\n4) Voorgestelde toelichting');
  console.log(`     ${body.voorgesteldeBeschrijving}`);
  check('er is een toelichting', body.voorgesteldeBeschrijving.length > 60, `${body.voorgesteldeBeschrijving.length} tekens`);
  check('de titel zit erin', /Reflectie op mijn ontwikkeling/i.test(body.voorgesteldeBeschrijving));
  check('de map wordt genoemd', /Persoonlijk project/i.test(body.voorgesteldeBeschrijving));

  /* ── Opruimen ───────────────────────────────────────────────────────── */
  console.log('\n5) Opruimen');
  const weg = await api(`/api/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
  check('document verwijderd uit de inbox', weg.status === 200 || weg.status === 204, `status ${weg.status}`);
  docId = null;
} catch (error) {
  check(`keten mislukt: ${error.message}`, false, error.stack?.split('\n')[1]?.trim());
} finally {
  if (docId) await api(`/api/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' }).catch(() => {});
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
