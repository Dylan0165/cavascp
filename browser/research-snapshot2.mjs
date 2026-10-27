#!/usr/bin/env node
/**
 * De snapshot-flow volledig in kaart.
 *
 * We weten nu dat "Create a snapshot" twee modi heeft:
 *   Goal-based       → doelen kiezen → collecties → bewijs
 *   Collection-based → collecties kiezen → bewijs
 *
 * Deze stap loopt de flow door ZONDER definitief te maken, en legt elk request
 * vast zodat we weten welk endpoint de snapshot aanmaakt en wat er in de body
 * moet staan. Ook zoeken we de snapshots-pagina en het deel/deellink-mechanisme.
 *
 *   node research-snapshot2.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';
import { REACT_CLICK_HELPER } from './lib/react-click.mjs';

const { chromium } = await import(CONFIG.playwrightUrl);
const OUT = path.resolve('out');
await mkdir(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
  ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
  headless: true,
  viewport: { width: 1600, height: 1200 },
  userAgent: CONFIG.userAgent,
  locale: 'nl-NL',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());
const pf = new Portflow(page);

/** Volledig verkeer, inclusief antwoorden: we willen de vorm zien. */
const calls = [];
page.on('request', (req) => {
  const url = req.url();
  if (!url.includes('/api/v1/')) return;
  calls.push({
    dir: 'req',
    method: req.method(),
    path: url.replace(`https://${CONFIG.portflowHost}`, '').split('?')[0],
    query: url.includes('?') ? url.split('?')[1].slice(0, 120) : null,
    body: (() => {
      try {
        const d = req.postData();
        return d && d.length < 700 ? d : d ? `<${d.length}b>` : null;
      } catch {
        return null;
      }
    })(),
  });
});
page.on('response', async (res) => {
  const url = res.url();
  if (!url.includes('/api/v1/')) return;
  const ct = (res.headers()['content-type'] ?? '').split(';')[0];
  if (!ct.includes('json')) return;
  let keys = null;
  let sample = null;
  try {
    const body = await res.json();
    const first = Array.isArray(body?.data) ? body.data[0] : (body?.data ?? body);
    keys = first && typeof first === 'object' ? Object.keys(first).slice(0, 24) : null;
    sample = JSON.stringify(body).slice(0, 400);
  } catch {
    /* geen json */
  }
  calls.push({
    dir: 'res',
    method: res.request().method(),
    path: url.replace(`https://${CONFIG.portflowHost}`, '').split('?')[0],
    status: res.status(),
    keys,
    sample,
  });
});

const show = (label, list) => {
  const seen = new Set();
  console.log(`  ${label}:`);
  for (const c of list) {
    const key = `${c.dir} ${c.method} ${c.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const st = c.status ? ` [${c.status}]` : '';
    console.log(`    ${c.dir} ${String(c.method).padEnd(6)} ${c.path}${st}`);
    if (c.keys) console.log(`         velden: ${c.keys.join(', ')}`);
    if (c.body) console.log(`         body: ${String(c.body).slice(0, 200)}`);
  }
  if (!list.length) console.log('    (niets)');
};

try {
  await pf.connect();
  console.log(`verbonden: portfolio ${pf.portfolioId}`);
  console.log('');

  /* ── A. Snapshots-pagina vinden ─────────────────────────────────────── */
  console.log('='.repeat(76));
  console.log('A. SNAPSHOTS-PAGINA');
  console.log('='.repeat(76));
  for (const guess of ['/portfolio/snapshots', '/portfolio/my-snapshots', '/snapshots']) {
    const before = calls.length;
    await page.goto(`https://${CONFIG.portflowHost}${guess}`, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(4500);
    const info = await pf.frame
      .evaluate(() => ({
        url: location.pathname,
        notFound: /could not find|we searched everywhere/i.test(document.body.innerText),
        headings: [...document.querySelectorAll('h1, h2, h3')].slice(0, 5).map((n) => n.textContent.trim().slice(0, 60)),
        body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 220),
      }))
      .catch(() => ({}));
    console.log(`  ${guess.padEnd(26)} → ${info.notFound ? 'NIET GEVONDEN' : 'werkt'}  ${(info.headings ?? []).join(' | ')}`);
    if (!info.notFound) {
      console.log(`      ${(info.body ?? '').slice(0, 200)}`);
      const fresh = calls.slice(before).filter((c) => c.dir === 'res');
      if (fresh.length) show('aanroepen', fresh);
      break;
    }
  }
  console.log('');

  /* ── B. Terug naar de collecties en de modal openen ─────────────────── */
  console.log('='.repeat(76));
  console.log('B. SNAPSHOT-MODAL: STRUCTUUR');
  console.log('='.repeat(76));
  await page.goto(`https://${CONFIG.portflowHost}/portfolio/collections`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(5000);
  await pf.frame.evaluate(REACT_CLICK_HELPER);
  await pf.frame.evaluate(() => window.__cavascpClickText(/create a snapshot/i, { maxLength: 40 }));
  await page.waitForTimeout(3500);

  const modal = await pf.frame.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') ?? document.body;
    const txt = (n) => (n?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90);
    return {
      text: d.innerText.replace(/\s+/g, ' ').slice(0, 700),
      buttons: [...d.querySelectorAll('button')].map((b) => ({ text: txt(b), disabled: b.disabled })).filter((b) => b.text).slice(0, 20),
      radios: [...d.querySelectorAll('input[type="radio"], [role="radio"]')].map((r) => txt(r.parentElement)),
      checkboxes: [...d.querySelectorAll('input[type="checkbox"]')].length,
    };
  });
  console.log(`  tekst    : ${modal.text?.slice(0, 400)}`);
  console.log('  knoppen  :');
  for (const b of modal.buttons ?? []) console.log(`    ${b.disabled ? '[uit] ' : '[aan] '}${b.text}`);
  console.log(`  keuzes   : ${(modal.radios ?? []).filter(Boolean).join(' | ') || '—'}`);
  console.log('');

  /* ── C. Collection-based doorlopen ──────────────────────────────────── */
  console.log('='.repeat(76));
  console.log('C. FLOW DOORLOPEN (collection-based)');
  console.log('='.repeat(76));
  const beforeC = calls.length;

  const pickCollection = await pf.frame
    .evaluate(() => window.__cavascpClickText(/collection-based/i, { maxLength: 60 }))
    .catch((e) => ({ ok: false, reason: e.message }));
  console.log(`  modus kiezen: ${pickCollection.ok ? `"${pickCollection.text}"` : `mislukt (${pickCollection.reason})`}`);
  await page.waitForTimeout(2500);

  // Kijk wat er nu in de modal staat: welke collecties aangeboden worden.
  const step2 = await pf.frame.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') ?? document.body;
    return {
      text: d.innerText.replace(/\s+/g, ' ').slice(0, 600),
      // Klikbare rijen/kaarten met een collectienaam
      items: [...d.querySelectorAll('li, label, [role="option"], [class*="card"], [class*="row"]')]
        .map((n) => (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60))
        .filter((t) => t && t.length < 60)
        .slice(0, 25),
    };
  });
  console.log(`  tekst : ${step2.text?.slice(0, 350)}`);
  console.log(`  items : ${(step2.items ?? []).slice(0, 15).join(' | ')}`);
  console.log('');

  // Probeer de bovenste drie mappen aan te vinken.
  await pf.frame.evaluate(REACT_CLICK_HELPER);
  const picked = await pf.frame.evaluate(() => {
    const out = [];
    for (const name of ['orientatie', 'klantproject', 'Persoonlijk project']) {
      const r = window.__cavascpClickText(new RegExp(`^\\s*${name}\\s*$`, 'i'), { maxLength: 40 });
      out.push({ name, ok: r.ok });
    }
    return out;
  });
  console.log(`  mappen aanklikken: ${picked.map((p) => `${p.name}=${p.ok ? 'ja' : 'nee'}`).join(' ')}`);
  await page.waitForTimeout(2000);

  const afterPick = await pf.frame.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') ?? document.body;
    return {
      text: d.innerText.replace(/\s+/g, ' ').slice(0, 400),
      buttons: [...d.querySelectorAll('button')].map((b) => `${(b.textContent || '').trim().slice(0, 30)}${b.disabled ? ' [uit]' : ''}`).filter(Boolean).slice(0, 15),
    };
  });
  console.log(`  na kiezen: ${afterPick.text?.slice(0, 300)}`);
  console.log(`  knoppen  : ${(afterPick.buttons ?? []).join(' | ')}`);
  console.log('');

  show('aanroepen', calls.slice(beforeC));

  /* ── Rapport ────────────────────────────────────────────────────────── */
  const file = path.join(OUT, 'snapshot-flow.json');
  await writeFile(
    file,
    JSON.stringify({ generatedAt: new Date().toISOString(), modal, step2, afterPick, picked, calls }, null, 2),
    'utf8',
  );
  console.log(`\nrapport: ${file}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
