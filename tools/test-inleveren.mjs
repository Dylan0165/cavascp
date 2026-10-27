#!/usr/bin/env node
/**
 * Test inleveren vanuit de documentwerkplek.
 *
 * De hele keten in één test:
 *   1. een document maken met inhoud over één leeruitkomst
 *   2. de leeruitkomst-check laten lopen
 *   3. inleveren bij Portflow, naar een lege map
 *   4. controleren dat het er staat, met de JUISTE doelen eraan
 *   5. weer opruimen
 *
 * Stap 4 is de belangrijkste. Portflow heeft "Professional Standard" vier keer,
 * dus een koppeling die op naam is gemaakt zet je bewijs aan het doel van een
 * vorig semester. We controleren expliciet op de doel-id's 485380-485385.
 *
 *   node tools/test-inleveren.mjs
 */

const ORIGIN = `http://127.0.0.1:${process.env.CAVASCP_PORT || 8787}`;

/** De map waarin we testen. "Persoonlijk project" is nu leeg. */
const TEST_MAP = 250280;

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

let cookie = null;
const api = (pad, opties = {}) =>
  fetch(`${ORIGIN}${pad}`, {
    ...opties,
    headers: { Origin: ORIGIN, Cookie: cookie, ...(opties.headers || {}) },
  });

let documentId = null;
let bewijsId = null;
let portflow = null;
let context = null;

try {
  /* ── Verbinden ──────────────────────────────────────────────────────── */
  const boot = await fetch(`${ORIGIN}/`);
  cookie = (boot.headers.get('set-cookie') || '').match(/cavascp_session=[^;]+/)?.[0];
  check('sessie gekregen', Boolean(cookie));

  /* ── 1. Een document maken ──────────────────────────────────────────── */
  console.log('\n1) Document maken');
  const nieuw = await api('/api/documenten', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titel: 'TEST inleveren via werkplek' }),
  });
  const nieuwBody = await nieuw.json();
  documentId = nieuwBody.document?.id;
  check('document aangemaakt', Boolean(documentId), documentId);

  /*
   * Inhoud die duidelijk onder Data & Knowledge Stewardship valt. De check moet
   * dat vinden, en dan hoort doel 485381 eraan gekoppeld te worden.
   */
  const tekst =
    'Ik heb de dataset opgeschoond en gevalideerd op volledigheid en consistentie. ' +
    'Er zaten ontbrekende waarden in drie kolommen en de datums waren inconsistent. ' +
    'Na de data preparation heb ik een exploratory data analysis gedaan en de inzichten ' +
    'gevisualiseerd in een dashboard per regio. De datakwaliteit is daarmee aantoonbaar.';
  const opslaan = await api(`/api/documenten/${documentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      titel: 'TEST inleveren via werkplek',
      brief: 'Automatische test van de inleverketen.',
      plan: { secties: [{ id: 's1', titel: 'Data-analyse', niveau: 1, tekst, subsecties: [] }] },
    }),
  });
  check('document opgeslagen', opslaan.status === 200, `status ${opslaan.status}`);

  /* ── 2. De leeruitkomst-check ───────────────────────────────────────── */
  console.log('\n2) Leeruitkomst-check');
  const check1 = await (await api(`/api/documenten/${documentId}/leeruitkomsten`)).json();
  console.log(`     ${check1.uitleg}`);
  check('treffers gevonden', (check1.treffers ?? []).length > 0, (check1.treffers ?? []).map((t) => t.code).join(', '));
  check('LO2 gevonden', (check1.treffers ?? []).some((t) => t.code === 'LO2'), (check1.treffers ?? []).map((t) => t.code).join(', '));
  check(
    'het juiste Portflow-doel erbij',
    (check1.portflowGoalIds ?? []).includes(485381),
    JSON.stringify(check1.portflowGoalIds),
  );

  /* ── 3. De mappen van dit semester ──────────────────────────────────── */
  console.log('\n3) Mappen van dit semester');
  const mappen = await (await api(`/api/documenten/${documentId}/mappen`)).json();
  check('drie mappen', (mappen.mappen ?? []).length === 3, (mappen.mappen ?? []).map((m) => m.naam).join(', '));
  check(
    'de juiste map-id\'s (niet die van een ouder semester)',
    (mappen.mappen ?? []).map((m) => m.portflowCollectionId).join(',') === '250278,250279,250280',
    (mappen.mappen ?? []).map((m) => m.portflowCollectionId).join(','),
  );

  /* ── 4. Inleveren ───────────────────────────────────────────────────── */
  console.log('\n4) Inleveren bij Portflow');
  const inlever = await api(`/api/documenten/${documentId}/inleveren`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collectionId: TEST_MAP,
      toelichting: 'Automatische test vanuit de werkplek. Wordt direct weer verwijderd.',
    }),
  });
  const inleverBody = await inlever.json();
  console.log(`     status ${inlever.status}`);
  if (inleverBody.error) console.log(`     fout: ${inleverBody.error}`);
  if (inleverBody.geleverd) {
    console.log(`     ${inleverBody.geleverd.bestandsnaam} — ${inleverBody.geleverd.bytes} bytes, ${inleverBody.geleverd.secties} secties`);
  }
  check('inleveren gelukt', inlever.status === 200 && inleverBody.ok !== false, `status ${inlever.status}`);
  bewijsId = inleverBody.evidenceId ?? null;
  check('bewijs-id teruggekregen', Boolean(bewijsId), String(bewijsId));
  check(
    'de check is meegestuurd',
    (inleverBody.leeruitkomsten?.gevonden ?? []).length > 0,
    (inleverBody.leeruitkomsten?.gevonden ?? []).map((t) => t.code).join(', '),
  );
  check(
    'het juiste doel is gebruikt',
    (inleverBody.leeruitkomsten?.gebruikt ?? []).includes(485381),
    JSON.stringify(inleverBody.leeruitkomsten?.gebruikt),
  );

  /* ── 5. Controleren in Portflow ─────────────────────────────────────── */
  console.log('\n5) Controleren in Portflow');
  if (bewijsId) {
    const { CONFIG } = await import('../browser/config.mjs');
    const { Portflow } = await import('../browser/portflow.mjs');
    const { chromium } = await import(CONFIG.playwrightUrl);
    context = await chromium.launchPersistentContext(CONFIG.profileDir, {
      ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
      headless: true,
      viewport: CONFIG.viewport,
      userAgent: CONFIG.userAgent,
      locale: 'nl-NL',
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const page = context.pages()[0] ?? (await context.newPage());
    portflow = new Portflow(page);
    await portflow.connect();

    const inMap = await portflow.call(
      'GET',
      `/api/v1/portfolios/${portflow.portfolioId}/collections/${TEST_MAP}/evidence?page=1&per_page=100`,
    );
    const lijst = Array.isArray(inMap.data) ? inMap.data : (inMap.data?.evidence ?? []);
    const gevonden = lijst.find((x) => (x.evidence?.id ?? x.id) === bewijsId);
    check('staat in de map', Boolean(gevonden), `${lijst.length} stukken in de map`);

    const detail = await portflow.call('GET', `/api/v1/portfolios/${portflow.portfolioId}/evidence/${bewijsId}`);
    check('bewijsstuk op te vragen', detail.ok, `status ${detail.status}`);
    if (detail.ok) {
      check('naam begint met TEST', String(detail.data?.name ?? '').startsWith('TEST'), detail.data?.name);
      check(
        'toelichting bewaard',
        /automatische test/i.test(String(detail.data?.description ?? '')),
        String(detail.data?.description ?? '(leeg)').slice(0, 50),
      );
    }

    const doelen = await portflow.evidenceGoals(bewijsId);
    const doelIds = doelen.map((g) => g.id);
    console.log(`     doelen: ${doelen.map((g) => `${g.id} "${g.name}"`).join(', ') || '(geen)'}`);
    check('aan het juiste doel gekoppeld', doelIds.includes(485381), JSON.stringify(doelIds));
    check(
      'NIET aan een doel van een ouder semester',
      !doelIds.some((id) => [268553, 268554, 268555, 268556, 268557, 268558].includes(id)),
      JSON.stringify(doelIds),
    );
  }

  /* ── 6. Opruimen ────────────────────────────────────────────────────── */
  console.log('\n6) Opruimen');
  if (bewijsId && portflow) {
    const status = await portflow.deleteEvidence(bewijsId);
    check('bewijs verwijderd uit Portflow', status === 204 || status === 200, `status ${status}`);
    bewijsId = null;
    await new Promise((r) => setTimeout(r, 1500));
    const na = await portflow.call(
      'GET',
      `/api/portfolios/${portflow.portfolioId}/collections/${TEST_MAP}/evidence?page=1&per_page=100`,
    );
    const naLijst = Array.isArray(na.data) ? na.data : (na.data?.evidence ?? []);
    check('map is weer leeg', naLijst.length === 0, `${naLijst.length} over`);
  }
  if (documentId) {
    const weg = await api(`/api/documenten/${documentId}`, { method: 'DELETE' });
    check('testdocument verwijderd', weg.status === 200, `status ${weg.status}`);
    documentId = null;
  }
} catch (error) {
  check(`keten mislukt: ${error.message}`, false, error.stack?.split('\n')[1]?.trim());
} finally {
  /* Opruimen wat er nog staat, ook na een fout. */
  if (bewijsId && portflow) {
    try {
      await portflow.deleteEvidence(bewijsId);
      console.log(`  opgeruimd na fout (bewijs ${bewijsId})`);
    } catch {
      console.log(`  OPRUIMEN MISLUKT — verwijder bewijs ${bewijsId} handmatig in Portflow`);
    }
  }
  if (documentId) {
    await api(`/api/documenten/${documentId}`, { method: 'DELETE' }).catch(() => {});
  }
  if (context) await context.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
