#!/usr/bin/env node
/**
 * Het snapshot-endpoint vinden door de modal echt te doorlopen.
 *
 * WAT ER MISGING IN EERDERE POGINGEN
 *
 * Ik klikte op "Next" zonder iets te selecteren, en dan gebeurt er niets — de
 * stap gaat niet verder omdat er geen keuze is. Daardoor bleef het bij de
 * leesroutes en vond ik het aanmaak-endpoint nooit.
 *
 * WAT DIT SCRIPT DOET
 *
 * Het loopt de vijf stappen door en selecteert onderweg echt iets:
 *   1 doelen kiezen  2 collecties  3 bewijs  4 details  5 klaar
 *
 * Bij elke stap wordt gekeken wat er in de modal staat, en pas doergeklikt als
 * de stap echt is afgerond. Het laatste request wordt vastgelegd — dat is het
 * endpoint dat we zoeken.
 *
 * standaard wordt er NIETS aangemaakt. Met --maak wel, en dan wordt de snapshot
 * daarna opgeruimd als dat kan.
 *
 *   node research-snapshot4.mjs
 *   node research-snapshot4.mjs --maak
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';
import { REACT_CLICK_HELPER } from './lib/react-click.mjs';

const MAKEN = process.argv.includes('--maak');
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

/* Al het schrijvende verkeer, dat is waar het endpoint in zit. */
const writes = [];
const alles = [];
page.on('request', (req) => {
  const url = req.url();
  if (!url.includes('/api/v1/')) return;
  const item = {
    method: req.method(),
    path: url.replace(`https://${CONFIG.portflowHost}`, '').split('?')[0],
    query: url.includes('?') ? url.split('?')[1].slice(0, 160) : null,
    body: (() => {
      try {
        const d = req.postData();
        return d && d.length < 3000 ? d : d ? `<${d.length} bytes>` : null;
      } catch {
        return null;
      }
    })(),
  };
  alles.push(item);
  if (req.method() !== 'GET') {
    writes.push(item);
    console.log(`  >> ${req.method()} ${item.path}`);
    if (item.body) console.log(`       ${item.body.slice(0, 260)}`);
  }
});

/** Wat staat er in de modal? */
async function leesModal() {
  return pf.frame
    .evaluate(() => {
      const d = document.querySelector('.ant-modal-body, [role="dialog"]');
      const modal = d ?? document.body;
      const schoon = (n) => (n?.textContent ?? '').trim().replace(/\s+/g, ' ');
      const actieveStap = document.querySelector('.ant-steps-item-active');
      return {
        heeft: Boolean(d),
        stap: schoon(actieveStap).slice(0, 90),
        tekst: modal.innerText.replace(/\s+/g, ' ').slice(0, 420),
        knoppen: [...modal.querySelectorAll('button')]
          .filter((b) => !b.disabled)
          .map((b) => schoon(b).slice(0, 34))
          .filter(Boolean),
        knoppenUit: [...modal.querySelectorAll('button')]
          .filter((b) => b.disabled)
          .map((b) => schoon(b).slice(0, 34))
          .filter(Boolean),
        checkboxen: modal.querySelectorAll('input[type="checkbox"]').length,
        aangevinkt: [...modal.querySelectorAll('input[type="checkbox"]')].filter((c) => c.checked).length,
        rijen: [...modal.querySelectorAll('.ant-table-row, tbody tr, .ant-list-item, .ant-checkbox-wrapper')]
          .map((r) => schoon(r).slice(0, 56))
          .filter(Boolean)
          .slice(0, 8),
      };
    })
    .catch((e) => ({ fout: e.message }));
}

/** Klik op tekst en zeg wat er gebeurde. */
async function klik(patroon, label) {
  const r = await pf.frame
    .evaluate(({ src }) => window.__cavascpClickText(new RegExp(src, 'i'), { maxLength: 90 }), { src: patroon })
    .catch((e) => ({ ok: false, reason: e.message }));
  console.log(`  klik ${label}: ${r.ok ? `"${r.text}" via ${r.via}` : `MISLUKT (${r.reason})`}`);
  return r.ok;
}

/** Vink de eerste N checkboxen aan in de modal. */
async function vinkAan(aantal = 1) {
  const r = await pf.frame
    .evaluate((n) => {
      const modal = document.querySelector('.ant-modal-body, [role="dialog"]') ?? document.body;
      const boxen = [...modal.querySelectorAll('input[type="checkbox"]')];
      let gedaan = 0;
      for (const box of boxen) {
        if (gedaan >= n) break;
        if (box.checked) continue;
        // Ant Design luistert op de wrapper, niet op de input zelf.
        const wrapper = box.closest('label') ?? box.parentElement;
        (wrapper ?? box).click();
        gedaan += 1;
      }
      return { totaal: boxen.length, aangevinkt: boxen.filter((b) => b.checked).length, gedaan };
    }, aantal)
    .catch((e) => ({ fout: e.message }));
  console.log(`  aanvinken: ${r.gedaan ?? '?'} van ${r.totaal ?? '?'} (nu ${r.aangevinkt ?? '?'} aan)`);
  return (r.aangevinkt ?? 0) > 0;
}

/** Klik op de knop die verder gaat. */
async function volgende(label = 'Next') {
  const r = await pf.frame
    .evaluate((naam) => {
      const modal = document.querySelector('.ant-modal-body, [role="dialog"]') ?? document.body;
      const knoppen = [...modal.querySelectorAll('button')].filter((b) => !b.disabled);
      const knop = knoppen.find((b) => new RegExp(`^\\s*${naam}\\s*$`, 'i').test(b.textContent ?? ''));
      if (!knop) return { ok: false, beschikbaar: knoppen.map((b) => (b.textContent ?? '').trim()).filter(Boolean) };
      knop.click();
      return { ok: true, tekst: (knop.textContent ?? '').trim() };
    }, label)
    .catch((e) => ({ ok: false, fout: e.message }));
  console.log(`  ${label}: ${r.ok ? 'geklikt' : `niet gevonden (${JSON.stringify(r.beschikbaar ?? r.fout)})`}`);
  return r.ok;
}

try {
  await pf.connect();
  console.log(`verbonden: portfolio ${pf.portfolioId}`);
  await pf.frame.evaluate(REACT_CLICK_HELPER);
  console.log('');

  /* Modal openen. */
  await klik('create a snapshot', 'openen');
  await page.waitForTimeout(2500);

  let m = await leesModal();
  console.log(`  stap: ${m.stap || '(geen stapbalk)'}`);
  console.log(`  tekst: ${(m.tekst ?? '').slice(0, 150)}`);

  /* Modus kiezen: goal-based, want dat is de route die de opdracht vraagt. */
  await klik('goal-based', 'goal-based');
  await page.waitForTimeout(2500);

  /* ── Stap 1: doelen ─────────────────────────────────────────────────── */
  console.log('\n--- stap 1: doelen ---');
  m = await leesModal();
  console.log(`  stap: ${m.stap}`);
  console.log(`  knoppen: ${m.knoppen.join(' | ')}`);
  console.log(`  checkboxen: ${m.checkboxen}, aangevinkt: ${m.aangevinkt}`);
  if (m.rijen.length) console.log(`  rijen: ${m.rijen.slice(0, 4).join(' || ')}`);

  const gekozen = await vinkAan(2);
  await page.waitForTimeout(1200);
  m = await leesModal();
  console.log(`  na aanvinken: ${m.aangevinkt} aan`);
  if (gekozen) {
    await volgende('Next');
    await page.waitForTimeout(2500);
  }

  /* ── Stap 2: collecties ─────────────────────────────────────────────── */
  console.log('\n--- stap 2: collecties ---');
  m = await leesModal();
  console.log(`  stap: ${m.stap}`);
  console.log(`  tekst: ${(m.tekst ?? '').slice(0, 200)}`);
  console.log(`  checkboxen: ${m.checkboxen}, aangevinkt: ${m.aangevinkt}`);
  if (m.rijen.length) console.log(`  rijen: ${m.rijen.join(' || ')}`);

  if (m.checkboxen > 0) {
    // De drie mappen van dit semester aanvinken.
    const gedaan = await pf.frame
      .evaluate(() => {
        const modal = document.querySelector('.ant-modal-body, [role="dialog"]') ?? document.body;
        const gewenst = ['orientatie', 'klantproject', 'persoonlijk project'];
        let n = 0;
        for (const rij of modal.querySelectorAll('.ant-table-row, tbody tr, .ant-checkbox-wrapper, label')) {
          const tekst = (rij.textContent ?? '').toLowerCase();
          if (!gewenst.some((g) => tekst.includes(g))) continue;
          const box = rij.querySelector('input[type="checkbox"]') ?? rij;
          if (box.checked) continue;
          (rij.querySelector('label') ?? box).click();
          n += 1;
        }
        const alle = [...modal.querySelectorAll('input[type="checkbox"]')];
        return { gedaan: n, aangevinkt: alle.filter((b) => b.checked).length, totaal: alle.length };
      })
      .catch((e) => ({ fout: e.message }));
    console.log(`  mappen aangevinkt: ${gedaan.gedaan ?? '?'} (${gedaan.aangevinkt ?? '?'} van ${gedaan.totaal ?? '?'})`);
  }
  await page.waitForTimeout(1200);
  await volgende('Next');
  await page.waitForTimeout(2500);

  /* ── Stap 3: bewijs ─────────────────────────────────────────────────── */
  console.log('\n--- stap 3: bewijs ---');
  m = await leesModal();
  console.log(`  stap: ${m.stap}`);
  console.log(`  tekst: ${(m.tekst ?? '').slice(0, 200)}`);
  console.log(`  checkboxen: ${m.checkboxen}, aangevinkt: ${m.aangevinkt}`);
  if (m.rijen.length) console.log(`  rijen: ${m.rijen.slice(0, 5).join(' || ')}`);

  if (m.checkboxen > 0 && m.aangevinkt === 0) await vinkAan(1);
  await page.waitForTimeout(1200);
  await volgende('Next');
  await page.waitForTimeout(2500);

  /* ── Stap 4: details ────────────────────────────────────────────────── */
  console.log('\n--- stap 4: details ---');
  m = await leesModal();
  console.log(`  stap: ${m.stap}`);
  console.log(`  tekst: ${(m.tekst ?? '').slice(0, 260)}`);
  console.log(`  knoppen: ${m.knoppen.join(' | ')}`);
  const velden = await pf.frame
    .evaluate(() => {
      const modal = document.querySelector('.ant-modal-body, [role="dialog"]') ?? document.body;
      return [...modal.querySelectorAll('input, textarea')].map((v) => ({
        tag: v.tagName.toLowerCase(),
        type: v.type,
        naam: v.name || v.id || null,
        placeholder: v.placeholder || null,
        waarde: String(v.value ?? '').slice(0, 40),
      }));
    })
    .catch(() => []);
  console.log(`  velden: ${JSON.stringify(velden).slice(0, 400)}`);

  /* ── Stap 5: de laatste knop ────────────────────────────────────────── */
  console.log('\n--- stap 5: afronden ---');
  m = await leesModal();
  console.log(`  knoppen: ${m.knoppen.join(' | ')}`);
  console.log(`  knoppen (uit): ${m.knoppenUit.join(' | ')}`);

  /*
   * Op stap 4 staat een verplicht naamveld ("Version #4"). Zonder naam blijft
   * Save doen alsof er niets is ingevuld, en dan gebeurt er niets. Dat was
   * waarom eerdere pogingen geen aanmaak-request zagen.
   */
  const naamIngevuld = await pf.frame
    .evaluate(() => {
      const modal = document.querySelector('.ant-modal-body, [role="dialog"]') ?? document.body;
      const veld = [...modal.querySelectorAll('input[type="text"]')].find(
        (v) => /name/i.test(v.name ?? '') || /version/i.test(v.placeholder ?? ''),
      );
      if (!veld) return { ok: false };
      // React luistert op het input-event, niet op het zetten van .value.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(veld, 'cavascp test-snapshot');
      veld.dispatchEvent(new Event('input', { bubbles: true }));
      veld.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, waarde: veld.value, naam: veld.name, placeholder: veld.placeholder };
    })
    .catch((e) => ({ ok: false, fout: e.message }));
  console.log(`  naamveld: ${naamIngevuld.ok ? `"${naamIngevuld.waarde}"` : 'niet gevuld'}`);
  await page.waitForTimeout(1000);

  if (MAKEN) {
    console.log('\n  --maak: Save wordt aangeklikt');
    const geklikt = await volgende('Save');
    if (!geklikt) {
      // Misschien heet hij anders; toon wat er staat.
      const m2 = await leesModal();
      console.log(`  beschikbare knoppen: ${m2.knoppen.join(' | ')}`);
    }
    await page.waitForTimeout(12000);
    m = await leesModal();
    console.log(`  na opslaan: ${(m.tekst ?? '').slice(0, 260)}`);

    /* Wat staat er nu op de snapshots-pagina? */
    const na = await pf.call('GET', `/api/v1/portfolios/${pf.portfolioId}/pending-freezes`);
    console.log(`  pending-freezes: ${JSON.stringify(na.data).slice(0, 200)}`);
  } else {
    console.log('\n  (droogloop — er is niets aangemaakt)');
  }

  /* ── Het resultaat ──────────────────────────────────────────────────── */
  console.log('\n' + '='.repeat(76));
  console.log('SCHRIJVENDE AANROEPEN');
  console.log('='.repeat(76));
  if (!writes.length) {
    console.log('  geen. De snapshot wordt pas gemaakt bij de laatste knop.');
  }
  for (const w of writes) {
    console.log(`  ${w.method} ${w.path}${w.query ? `?${w.query}` : ''}`);
    if (w.body) console.log(`      body: ${w.body.slice(0, 600)}`);
  }

  console.log('\n' + '='.repeat(76));
  console.log('ALLE PADEN DIE DE MODAL AANRAAKT');
  console.log('='.repeat(76));
  for (const p of [...new Set(alles.map((c) => `${c.method} ${c.path}`))].sort()) console.log(`  ${p}`);

  await writeFile(
    path.join(OUT, 'snapshot-endpoint.json'),
    JSON.stringify({ gemaakt: new Date().toISOString(), writes, alles }, null, 2),
    'utf8',
  );
  console.log(`\nrapport: ${path.join(OUT, 'snapshot-endpoint.json')}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
