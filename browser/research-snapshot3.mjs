#!/usr/bin/env node
/**
 * De snapshot-flow doorlopen en het echte endpoint vinden.
 *
 * Alle geraden snapshot-paden geven 404, dus het endpoint moet uit het gedrag
 * van de app blijken. We blijven binnen één pagina (page.goto breekt de
 * LTI-sessie) en lopen de modal stap voor stap door, met het netwerk erbij.
 *
 * We maken géén snapshot: we stoppen voordat er iets wordt weggeschreven, tenzij
 * --maak meegegeven is. Zo blijft dit onderzoek zonder gevolgen.
 *
 *   node research-snapshot3.mjs            # alleen kijken
 *   node research-snapshot3.mjs --maak     # daadwerkelijk een snapshot maken
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';
import { REACT_CLICK_HELPER } from './lib/react-click.mjs';

const MAKE = process.argv.includes('--maak');
const { chromium } = await import(CONFIG.playwrightUrl);
const OUT = path.resolve('out');
await mkdir(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
  ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
  headless: true,
  viewport: { width: 1600, height: 1100 },
  userAgent: CONFIG.userAgent,
  locale: 'nl-NL',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());
const pf = new Portflow(page);

/* Al het schrijvende verkeer apart, dat is wat we zoeken. */
const writes = [];
const all = [];
page.on('request', (req) => {
  const url = req.url();
  if (!url.includes('/api/v1/')) return;
  const entry = {
    method: req.method(),
    path: url.replace(`https://${CONFIG.portflowHost}`, '').split('?')[0],
    query: url.includes('?') ? url.split('?')[1].slice(0, 140) : null,
    body: (() => {
      try {
        const d = req.postData();
        return d && d.length < 1500 ? d : d ? `<${d.length}b>` : null;
      } catch {
        return null;
      }
    })(),
  };
  all.push(entry);
  if (req.method() !== 'GET') writes.push(entry);
});
page.on('response', (res) => {
  const url = res.url();
  if (!url.includes('/api/v1/')) return;
  if (res.request().method() === 'GET') return;
  console.log(`  >> ${res.request().method()} ${url.replace(`https://${CONFIG.portflowHost}`, '').split('?')[0]} → ${res.status()}`);
});

/** Klik op tekst binnen de modal (Ant Design). */
async function clickText(pattern, label) {
  const r = await pf.frame
    .evaluate(
      ({ src, flags }) => window.__cavascpClickText(new RegExp(src, flags), { maxLength: 90 }),
      { src: pattern, flags: 'i' },
    )
    .catch((e) => ({ ok: false, reason: e.message }));
  console.log(`  klik ${label}: ${r.ok ? `"${r.text}"` : `mislukt (${r.reason ?? 'niets gevonden'})`}`);
  return r.ok;
}

/** Beschrijf de modal: tekst, knoppen, aanvinkbare dingen. */
async function describeModal(step) {
  const info = await pf.frame
    .evaluate(() => {
      const d = document.querySelector('.ant-modal, [role="dialog"]') ?? document.body;
      const clean = (n) => (n?.textContent || '').trim().replace(/\s+/g, ' ');
      return {
        text: d.innerText.replace(/\s+/g, ' ').slice(0, 800),
        buttons: [...d.querySelectorAll('button')]
          .map((b) => ({ text: clean(b).slice(0, 46), disabled: b.disabled }))
          .filter((b) => b.text),
        checkboxes: [...d.querySelectorAll('input[type="checkbox"]')].length,
        radios: [...d.querySelectorAll('.ant-radio-wrapper, input[type="radio"]')].map((r) => clean(r).slice(0, 46)),
        listItems: [...d.querySelectorAll('.ant-list-item, li, .ant-checkbox-wrapper')]
          .map((n) => clean(n).slice(0, 54))
          .filter(Boolean)
          .slice(0, 20),
      };
    })
    .catch((e) => ({ error: e.message }));

  console.log(`\n  ── stap ${step} ──`);
  console.log(`  tekst   : ${(info.text ?? info.error ?? '').slice(0, 340)}`);
  console.log(`  knoppen : ${(info.buttons ?? []).map((b) => `${b.text}${b.disabled ? '[uit]' : ''}`).join(' | ')}`);
  if (info.radios?.length) console.log(`  keuzes  : ${info.radios.join(' | ')}`);
  if (info.listItems?.length) console.log(`  items   : ${info.listItems.slice(0, 12).join(' | ')}`);
  return info;
}

try {
  await pf.connect();
  console.log(`verbonden: portfolio ${pf.portfolioId}`);
  await pf.frame.evaluate(REACT_CLICK_HELPER);

  /* Modal openen. */
  console.log('\n' + '='.repeat(78));
  console.log('SNAPSHOT-FLOW');
  console.log('='.repeat(78));
  await clickText('create a snapshot', 'openen');
  await page.waitForTimeout(3000);
  await describeModal(0);

  /* Modus kiezen. */
  await clickText('goal-based', 'goal-based');
  await page.waitForTimeout(2500);
  await describeModal(1);

  /* Collecties kiezen als die er staan. */
  const picked = await pf.frame
    .evaluate(() => {
      const out = [];
      for (const name of ['orientatie', 'klantproject', 'Persoonlijk project']) {
        const r = window.__cavascpClickText(new RegExp(`^\\s*${name}\\s*$`, 'i'), { maxLength: 46 });
        out.push({ name, ok: r.ok });
      }
      return out;
    })
    .catch(() => []);
  console.log(`\n  mappen: ${picked.map((p) => `${p.name}=${p.ok ? 'ja' : 'nee'}`).join('  ')}`);
  await page.waitForTimeout(2000);
  const s2 = await describeModal(2);

  /* Door naar de volgende stap: de knop die niet "cancel" of "close" is. */
  const nextLabel = await pf.frame
    .evaluate(() => {
      const d = document.querySelector('.ant-modal, [role="dialog"]') ?? document.body;
      const btns = [...d.querySelectorAll('button')].filter((b) => !b.disabled);
      const next = btns.find((b) => /next|volgende|continue|create|make|generate|save|snapshot/i.test(b.textContent || '') && !/cancel|close|annuleren/i.test(b.textContent || ''));
      if (!next) return null;
      next.click();
      return next.textContent.trim();
    })
    .catch(() => null);
  console.log(`\n  doorklikken via: ${nextLabel ?? 'geen knop gevonden'}`);
  await page.waitForTimeout(4000);
  const s3 = await describeModal(3);

  /* Nog een stap zo nodig. */
  const nextLabel2 = await pf.frame
    .evaluate(() => {
      const d = document.querySelector('.ant-modal, [role="dialog"]') ?? document.body;
      const btns = [...d.querySelectorAll('button')].filter((b) => !b.disabled);
      const next = btns.find((b) => /next|volgende|continue|create|make|generate|save/i.test(b.textContent || '') && !/cancel|close|annuleren/i.test(b.textContent || ''));
      if (!next) return null;
      return next.textContent.trim();
    })
    .catch(() => null);
  console.log(`  volgende knop zou zijn: ${nextLabel2 ?? 'geen'}`);

  /* ── Het resultaat ──────────────────────────────────────────────────── */
  console.log('\n' + '='.repeat(78));
  console.log('SCHRIJVENDE AANROEPEN');
  console.log('='.repeat(78));
  if (!writes.length) {
    console.log('  geen. De snapshot wordt pas gemaakt bij de laatste knop.');
  }
  for (const w of writes) {
    console.log(`  ${w.method} ${w.path}${w.query ? `?${w.query}` : ''}`);
    if (w.body) console.log(`      body: ${w.body.slice(0, 500)}`);
  }

  console.log('\n' + '='.repeat(78));
  console.log('ALLE UNIEKE PADEN DIE DE MODAL AANRAAKT');
  console.log('='.repeat(78));
  const uniq = [...new Set(all.map((c) => `${c.method} ${c.path}`))].sort();
  for (const u of uniq) console.log(`  ${u}`);

  if (MAKE) {
    console.log('\n--maak meegegeven: laatste knop wordt aangeklikt');
    await pf.frame
      .evaluate(() => window.__cavascpClickText(/create snapshot|make snapshot|generate/i, { maxLength: 40 }))
      .catch(() => {});
    await page.waitForTimeout(8000);
    console.log('  schrijvende aanroepen na maken:');
    for (const w of writes) console.log(`    ${w.method} ${w.path}  ${w.body?.slice(0, 200) ?? ''}`);
  }

  const file = path.join(OUT, 'snapshot-flow.json');
  await writeFile(file, JSON.stringify({ modal: s2, step3: s3, picked, writes, all }, null, 2), 'utf8');
  console.log(`\nrapport: ${file}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
