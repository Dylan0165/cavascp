#!/usr/bin/env node
/**
 * De schrijf-API's van Portflow in kaart brengen.
 *
 * Voor de automatisering moeten we weten hoe je:
 *   1. de beschrijving (leeswijzer) van een map zet
 *   2. bewijs aan meerdere leeruitkomsten koppelt
 *   3. een snapshot maakt
 *   4. een deellink van die snapshot krijgt
 *
 * We gebruiken het bearer-token (pf.call) en blijven binnen één pagina: een
 * page.goto breekt de LTI-sessie.
 *
 * Deze stap is VOORZICHTIG: alleen GET's om de vorm te leren, en één
 * onschuldige PUT-test op een map die we toch gaan vullen. Er wordt niets
 * weggegooid.
 *
 *   node research-write-api.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';

const { chromium } = await import(CONFIG.playwrightUrl);
const OUT = path.resolve('out');
await mkdir(OUT, { recursive: true });

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

/** Ons eigen fetch, zodat we ook niet-JSON en foutcodes zien. */
async function probe(method, apiPath, body) {
  return pf.frame.evaluate(
    async ({ method, apiPath, body, auth, csrf }) => {
      const res = await fetch(apiPath, {
        method,
        headers: {
          authorization: auth,
          'x-csrf-token': csrf ?? '',
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        credentials: 'include',
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* geen json */
      }
      const first = Array.isArray(json?.data) ? json.data[0] : (json?.data ?? json);
      return {
        status: res.status,
        ok: res.ok,
        keys: first && typeof first === 'object' ? Object.keys(first).slice(0, 30) : null,
        sample: text.slice(0, 500),
      };
    },
    { method, apiPath, body, auth: pf.auth.authorization, csrf: pf.auth.csrf },
  );
}

const line = (label, r) => {
  const flag = r.ok ? 'OK ' : '—  ';
  console.log(`  ${flag} [${r.status}] ${label}`);
  if (r.keys) console.log(`         velden: ${r.keys.join(', ')}`);
  if (!r.ok) console.log(`         ${String(r.sample).slice(0, 160)}`);
};

try {
  await pf.connect();
  const P = pf.portfolioId;
  console.log(`verbonden: portfolio ${P}`);
  console.log('');

  /* ── 1. Collecties: hoe zet je een beschrijving? ────────────────────── */
  console.log('='.repeat(78));
  console.log('1. COLLECTIE-BESCHRIJVING (de leeswijzer)');
  console.log('='.repeat(78));

  const col = await probe('GET', `/api/v1/portfolios/${P}/collections/250278`);
  line('GET collectie orientatie', col);
  if (col.ok) {
    const c = JSON.parse(col.sample.length < 500 ? col.sample : '{}');
    console.log(`         naam: ${c.name ?? c.data?.name}  beschrijving: ${JSON.stringify(c.description ?? c.data?.description)}`);
  }

  // Welke methodes accepteert dit endpoint? We testen met een lege PATCH: als
  // dat 405 geeft weet je dat het endpoint alleen-lezen is, bij 400/422 bestaat
  // de route wel.
  for (const method of ['PATCH', 'PUT', 'POST']) {
    const r = await probe(method, `/api/v1/portfolios/${P}/collections/250278`, {});
    line(`${method} collectie (leeg lichaam → alleen route testen)`, r);
  }
  console.log('');

  /* ── 2. Bewijs: koppeling aan doelen ────────────────────────────────── */
  console.log('='.repeat(78));
  console.log('2. BEWIJS EN DOELKOPPELINGEN');
  console.log('='.repeat(78));

  // Het bewijsstuk in klantproject, met zijn koppelingen.
  const ev = await probe('GET', `/api/v1/portfolios/${P}/evidence/2182508`);
  line('GET bewijs 2182508 (klantproject)', ev);
  if (ev.ok) console.log(`         ${ev.sample.slice(0, 400)}`);

  // De koppeling zelf: welk endpoint beheert evidence↔goal?
  for (const p of [
    `/api/v1/portfolios/${P}/evidence/2182508/goals`,
    `/api/v1/evidence/2182508/goals`,
    `/api/v1/portfolios/${P}/goals/evidence`,
  ]) {
    const r = await probe('GET', p);
    line(`GET ${p.replace(`/api/v1/portfolios/${P}`, '…')}`, r);
  }
  console.log('');

  /* ── 3. Snapshot-endpoints zoeken ───────────────────────────────────── */
  console.log('='.repeat(78));
  console.log('3. SNAPSHOT-ENDPOINTS');
  console.log('='.repeat(78));
  for (const p of [
    `/api/v1/portfolios/${P}/snapshot`,
    `/api/v1/portfolios/${P}/snapshots/list`,
    `/api/v1/portfolios/${P}/snapshot_settings`,
    `/api/v1/snapshot`,
    `/api/v1/snapshots/current`,
    `/api/v1/portfolios/${P}/exports`,
    `/api/v1/portfolios/${P}/sections`,
  ]) {
    const r = await probe('GET', p);
    line(`GET ${p.replace(`/api/v1/portfolios/${P}`, '…')}`, r);
  }
  console.log('');

  /* ── 4. Waar staat de snapshot-knop aan vast? ───────────────────────── */
  console.log('='.repeat(78));
  console.log('4. DE KNOP "CREATE A SNAPSHOT" ONDERZOEKEN');
  console.log('='.repeat(78));

  // We kijken in de React-state naar de handler en de url die erbij hoort.
  const btnInfo = await pf.frame.evaluate(() => {
    const btn = [...document.querySelectorAll('button, a')].find((b) =>
      /create a snapshot/i.test(b.textContent || ''),
    );
    if (!btn) return { found: false };
    const out = { found: true, tag: btn.tagName, text: btn.textContent.trim(), attrs: {} };
    for (const a of btn.attributes) out.attrs[a.name] = a.value;
    // React props uit de fiber halen: daar zit de onClick en soms de route.
    const key = Object.keys(btn).find((k) => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$'));
    if (key) {
      out.fiberKey = key.slice(0, 24);
      const val = btn[key];
      out.hasOnClick = typeof val?.onClick === 'function';
      out.props = Object.keys(val ?? {}).slice(0, 25);
    }
    return out;
  });
  console.log(`  ${JSON.stringify(btnInfo, null, 2).split('\n').join('\n  ')}`);
  console.log('');

  /* ── 5. Wat is mijn profiel/bio? ────────────────────────────────────── */
  console.log('='.repeat(78));
  console.log('5. PROFIEL (voor de bio in het dashboard)');
  console.log('='.repeat(78));
  const profile = await probe('GET', `/api/v1/portfolios/${P}`);
  line('GET portfolio', profile);
  if (profile.ok) console.log(`         ${profile.sample.slice(0, 450)}`);
  const me = await probe('GET', '/api/v1/users/current');
  line('GET users/current', me);
  if (me.ok) console.log(`         ${me.sample.slice(0, 350)}`);

  const report = { generatedAt: new Date().toISOString(), portfolioId: P, col, ev, btnInfo, profile, me };
  const file = path.join(OUT, 'write-api-research.json');
  await writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nrapport: ${file}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
