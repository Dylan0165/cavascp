#!/usr/bin/env node
/**
 * De portfolio-freeze-API (snapshots) in kaart.
 *
 * Een snapshot heet bij Drieam een "portfolio freeze". Nu we dat weten kunnen we
 * de endpoints gericht uitvragen in plaats van raden.
 *
 * Vragen die we willen beantwoorden:
 *   - welke freezes bestaan er al, en hoe zag de vorige inlevering eruit?
 *   - welk endpoint maakt een freeze, en wat moet er in de body?
 *   - hoe kom je aan een deellink die je bij Canvas kunt inleveren?
 *
 * Alleen-lezen: er wordt geen freeze gemaakt.
 *
 *   node research-freeze.mjs
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
      return { status: res.status, ok: res.ok, json, text: text.slice(0, 2000) };
    },
    { method, apiPath, body, auth: pf.auth.authorization, csrf: pf.auth.csrf },
  );
}

try {
  await pf.connect();
  const P = pf.portfolioId;
  console.log(`verbonden: portfolio ${P}`);
  console.log('');

  /* ── 1. Bestaande freezes ───────────────────────────────────────────── */
  console.log('='.repeat(78));
  console.log('1. BESTAANDE SNAPSHOTS (portfolio-freezes)');
  console.log('='.repeat(78));
  for (const p of [
    `/api/v1/portfolios/${P}/portfolio-freezes`,
    `/api/v1/portfolios/${P}/portfolio-freezes/goals`,
    `/api/v1/portfolios/${P}/portfolio-freezes?page=1`,
  ]) {
    const r = await probe('GET', p);
    const label = p.replace(`/api/v1/portfolios/${P}`, '…');
    const n = Array.isArray(r.json?.data) ? r.json.data.length : Array.isArray(r.json) ? r.json.length : null;
    console.log(`  [${r.status}] ${label}${n !== null ? `  → ${n} items` : ''}`);
    if (r.ok && r.json) {
      const first = Array.isArray(r.json?.data) ? r.json.data[0] : Array.isArray(r.json) ? r.json[0] : r.json;
      if (first && typeof first === 'object') {
        console.log(`        velden: ${Object.keys(first).join(', ')}`);
        console.log(`        voorbeeld: ${JSON.stringify(first).slice(0, 500)}`);
      }
    }
  }
  console.log('');

  /* ── 2. Hulpdata die de modal ophaalt ───────────────────────────────── */
  console.log('='.repeat(78));
  console.log('2. HULPDATA VOOR DE MODAL');
  console.log('='.repeat(78));
  for (const p of [
    `/api/v1/portfolios/${P}/collection-options`,
    `/api/v1/portfolios/${P}/goal-set-options`,
    `/api/v1/portfolios/${P}/backpack`,
    `/api/v1/portfolios/${P}/shares`,
  ]) {
    const r = await probe('GET', p);
    const label = p.replace(`/api/v1/portfolios/${P}`, '…');
    const n = Array.isArray(r.json?.data) ? r.json.data.length : null;
    console.log(`  [${r.status}] ${label}${n !== null ? ` → ${n}` : ''}`);
    if (r.ok && r.json) console.log(`        ${JSON.stringify(r.json).slice(0, 400)}`);
  }
  console.log('');

  /* ── 3. Welke methodes op het freeze-endpoint? ──────────────────────── */
  console.log('='.repeat(78));
  console.log('3. FREEZE AANMAKEN — WELKE ROUTE?');
  console.log('='.repeat(78));
  for (const [method, p, body] of [
    ['POST', `/api/v1/portfolios/${P}/portfolio-freezes`, {}],
    ['POST', `/api/v1/portfolios/${P}/portfolio-freezes/goals`, {}],
    ['GET', `/api/v1/portfolios/${P}/portfolio-freezes/new`, null],
  ]) {
    const r = await probe(method, p, body);
    const label = p.replace(`/api/v1/portfolios/${P}`, '…');
    console.log(`  [${r.status}] ${method} ${label}`);
    // 422/400 betekent: route bestaat, maar het lichaam klopt niet. Dat is
    // precies wat we willen weten.
    if (r.status === 400 || r.status === 422) {
      console.log(`        route BESTAAT — verwacht lichaam: ${r.text.slice(0, 500)}`);
    } else if (r.status === 201 || r.status === 200) {
      console.log(`        LET OP: gelukt? ${r.text.slice(0, 300)}`);
    } else {
      console.log(`        ${r.text.slice(0, 200)}`);
    }
  }
  console.log('');

  /* ── 4. Een bewijsstuk: alle velden voor de koppeling ──────────────── */
  console.log('='.repeat(78));
  console.log('4. BEWIJS: KOPPELINGEN EN BESCHRIJVING');
  console.log('='.repeat(78));
  const ev = await probe('GET', `/api/v1/portfolios/${P}/evidence/2182508`);
  if (ev.ok) console.log(`  bewijs: ${JSON.stringify(ev.json).slice(0, 700)}`);
  const goals = await probe('GET', `/api/v1/portfolios/${P}/evidence/2182508/goals`);
  if (goals.ok) console.log(`  doelen: ${JSON.stringify(goals.json).slice(0, 700)}`);

  // De collectie-koppeling van bewijs én de vorm waarin je doelen zet.
  for (const p of [
    `/api/v1/portfolios/${P}/evidence/2182508/collections`,
    `/api/v1/portfolios/${P}/collections/250278/evidence`,
  ]) {
    const r = await probe('GET', p);
    console.log(`  [${r.status}] ${p.replace(`/api/v1/portfolios/${P}`, '…')}`);
    if (r.ok) console.log(`        ${JSON.stringify(r.json).slice(0, 400)}`);
  }

  const file = path.join(OUT, 'freeze-research.json');
  await writeFile(
    file,
    JSON.stringify({ generatedAt: new Date().toISOString(), portfolioId: P, ev: ev.json, goals: goals.json }, null, 2),
    'utf8',
  );
  console.log(`\nrapport: ${file}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
