#!/usr/bin/env node
/**
 * Zoekt uit hoe de snapshot-flow werkt.
 *
 * De voor de hand liggende paden geven 404, dus we moeten het echt zien:
 *   1. de JavaScript-bundel doorzoeken op snapshot-endpoints
 *   2. de snapshot-pagina openen en het netwerkverkeer vastleggen
 *   3. kijken wat "Create a snapshot" doet
 *
 * Alleen-lezen: er wordt niets aangemaakt.
 *
 *   node research-snapshot.mjs
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
  viewport: CONFIG.viewport,
  userAgent: CONFIG.userAgent,
  locale: 'nl-NL',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());
const pf = new Portflow(page);

const calls = [];
page.on('request', (req) => {
  const url = req.url();
  if (!url.includes('/api/') && !url.includes('/snapshot')) return;
  if (/\.(js|css|png|svg|woff2?)$/i.test(url)) return;
  calls.push({
    method: req.method(),
    path: url.replace(`https://${CONFIG.portflowHost}`, '').split('?')[0],
    query: url.includes('?') ? url.split('?')[1].slice(0, 100) : null,
    body: (() => {
      try {
        const d = req.postData();
        return d && d.length < 600 ? d : d ? `<${d.length}b>` : null;
      } catch {
        return null;
      }
    })(),
  });
});

try {
  await pf.connect();
  console.log(`verbonden: portfolio ${pf.portfolioId}`);
  console.log('');

  /* ── 1. Bundel doorzoeken ───────────────────────────────────────────── */
  console.log('='.repeat(76));
  console.log('1. SNAPSHOT-PADEN IN DE APP-BUNDEL');
  console.log('='.repeat(76));
  const found = await pf.frame.evaluate(async () => {
    const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src);
    const hits = new Set();
    const patterns = [
      /["'`](\/api\/[a-z0-9/_:{}.-]*snapshot[a-z0-9/_:{}.-]*)["'`]/gi,
      /["'`]([a-z0-9/_:{}.-]*snapshots?[a-z0-9/_:{}.-]*)["'`]/gi,
      /url:\s*["'`]([^"'`]*snapshot[^"'`]*)["'`]/gi,
    ];
    for (const src of scripts.slice(0, 60)) {
      try {
        const res = await fetch(src, { credentials: 'include' });
        if (!res.ok) continue;
        const text = await res.text();
        for (const re of patterns) {
          for (const m of text.matchAll(re)) {
            const v = m[1];
            if (v.length > 4 && v.length < 120 && /snapshot/i.test(v)) hits.add(v);
          }
        }
        // Ook zoeken naar de woorden rond "snapshot" om de route te vinden.
        for (const m of text.matchAll(/["'`]([a-z0-9\-_/]*(?:create|make)[a-z0-9\-_/]*snapshot[a-z0-9\-_/]*)["'`]/gi)) {
          hits.add(m[1]);
        }
      } catch {
        /* script niet leesbaar */
      }
    }
    return { scripts: scripts.length, hits: [...hits].sort() };
  });
  console.log(`  bundels gelezen: ${found.scripts}`);
  for (const h of found.hits.slice(0, 40)) console.log(`    ${h}`);
  if (!found.hits.length) console.log('    niets gevonden (routes worden dynamisch opgebouwd)');
  console.log('');

  /* ── 2. Snapshots-pagina openen ─────────────────────────────────────── */
  console.log('='.repeat(76));
  console.log('2. SNAPSHOT-PAGINA OPENEN');
  console.log('='.repeat(76));

  // Eerst de echte navigatielink zoeken; de app bouwt routes dynamisch op, dus
  // raden levert een 404-pagina op. Het menu weet het wel.
  const navLinks = await pf.frame
    .evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => ({ text: (a.textContent || '').trim().slice(0, 40), href: a.getAttribute('href') }))
        .filter((l) => l.href && !l.href.startsWith('#') && !l.href.startsWith('http'))
        .slice(0, 30),
    )
    .catch(() => []);
  console.log('  navigatielinks:');
  for (const l of navLinks) console.log(`    ${String(l.text).padEnd(28)} ${l.href}`);

  const snapHref = navLinks.find((l) => /snapshot/i.test(l.href) || /snapshot/i.test(l.text))?.href;
  console.log(`  snapshot-link: ${snapHref ?? 'niet gevonden'}`);
  console.log('');

  const before = calls.length;
  if (snapHref) {
    // Echte navigatie, niet pushState: de router reageert daar niet op.
    await page.goto(`https://${CONFIG.portflowHost}${snapHref}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => {
      console.log(`  navigatie mislukt: ${e.message}`);
    });
    await page.waitForTimeout(7000);
  }

  const dom = await pf.frame
    .evaluate(() => {
      const text = (sel) => [...document.querySelectorAll(sel)].slice(0, 40).map((n) => (n.textContent || '').trim().slice(0, 70)).filter(Boolean);
      return {
        url: location.href,
        headings: text('h1, h2, h3'),
        buttons: text('button, [role="button"]'),
        bodyStart: document.body.innerText.replace(/\s+/g, ' ').slice(0, 500),
      };
    })
    .catch((e) => ({ error: e.message }));
  console.log(`  url      : ${dom.url ?? '?'}`);
  console.log(`  koppen   : ${(dom.headings ?? []).join(' | ') || '—'}`);
  console.log(`  knoppen  : ${(dom.buttons ?? []).slice(0, 12).join(' | ') || '—'}`);
  console.log(`  tekst    : ${(dom.bodyStart ?? dom.error ?? '').slice(0, 280)}`);
  console.log('');

  const newCalls = calls.slice(before);
  if (newCalls.length) {
    console.log('  API-aanroepen op deze pagina:');
    const seen = new Set();
    for (const c of newCalls) {
      const key = `${c.method} ${c.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`    ${c.method} ${c.path}${c.query ? `?${c.query}` : ''}`);
      if (c.body) console.log(`        body: ${c.body.slice(0, 120)}`);
    }
  } else {
    console.log('  (geen API-aanroepen)');
  }
  console.log('');

  /* ── 3. "Create a snapshot" aanklikken ──────────────────────────────── */
  console.log('='.repeat(76));
  console.log('3. WAT DOET "CREATE A SNAPSHOT"?');
  console.log('='.repeat(76));
  const before2 = calls.length;
  await pf.frame.evaluate(REACT_CLICK_HELPER);
  const clicked = await pf.frame
    .evaluate(() => window.__cavascpClickText(/create a snapshot|snapshot maken|nieuwe snapshot/i, { maxLength: 80 }))
    .catch((e) => ({ ok: false, reason: e.message }));
  console.log(`  klik: ${clicked.ok ? `gelukt ("${clicked.text}")` : `mislukt (${clicked.reason})`}`);
  await page.waitForTimeout(5000);

  const dialog = await pf.frame
    .evaluate(() => {
      const d = document.querySelector('[role="dialog"], .modal, [class*="odal"]') ?? document.body;
      return {
        heading: d.querySelector('h1, h2, h3')?.textContent?.trim().slice(0, 80) ?? null,
        fields: [...d.querySelectorAll('input, select, textarea')].slice(0, 12).map((f) => ({
          tag: f.tagName.toLowerCase(),
          type: f.type,
          name: f.name || null,
          placeholder: f.placeholder || null,
        })),
        buttons: [...d.querySelectorAll('button')].slice(0, 15).map((b) => (b.textContent || '').trim().slice(0, 40)).filter(Boolean),
      };
    })
    .catch((e) => ({ error: e.message }));
  console.log(`  dialoog  : ${dialog.heading ?? dialog.error ?? '—'}`);
  console.log(`  velden   : ${JSON.stringify(dialog.fields ?? [])}`);
  console.log(`  knoppen  : ${(dialog.buttons ?? []).join(' | ')}`);

  const newCalls2 = calls.slice(before2);
  if (newCalls2.length) {
    console.log('  API-aanroepen:');
    const seen = new Set();
    for (const c of newCalls2) {
      const key = `${c.method} ${c.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`    ${c.method} ${c.path}`);
      if (c.body) console.log(`        body: ${c.body.slice(0, 160)}`);
    }
  }
  console.log('');

  /* ── Rapport ────────────────────────────────────────────────────────── */
  const report = {
    generatedAt: new Date().toISOString(),
    bundleHits: found.hits,
    snapshotPage: dom,
    snapshotDialog: dialog,
    apiCalls: calls,
  };
  const file = path.join(OUT, 'snapshot-research.json');
  await writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  console.log(`rapport: ${file}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
