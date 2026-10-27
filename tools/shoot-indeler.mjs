#!/usr/bin/env node
/**
 * Schermafbeelding van de indeler in de inbox.
 *
 * Zet een document in de inbox, klikt op "Waar hoort dit?", en maakt een beeld.
 * Daarna wordt het document weer verwijderd.
 *
 *   node tools/shoot-indeler.mjs [breedte] [hoogte]
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bouwDocx } from '../mcp/lib/docx.mjs';

const PORT = process.env.CAVASCP_PORT || 8787;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const WIDTH = Number(process.argv[2] || 1600);
const HEIGHT = Number(process.argv[3] || 1200);
const OUT = path.resolve('dashboard', 'preview');
const TMP = path.resolve('data', 'tmp-shoot');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

/* ── Een document klaarzetten ───────────────────────────────────────────── */

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
            'Terugkijkend op deze periode zie ik dat ik sterk ben in het analyseren van problemen, maar dat ik te ' +
            'lang doorwerk zonder hulp te vragen. Dat is een zwakte die mijn groei remt. Mijn kernwaarden zijn ' +
            'nieuwsgierigheid en betrouwbaarheid.',
        },
        {
          type: 'paragraph',
          tekst:
            'Ik heb me voorgenomen om vaker feedback te vragen en heb leerdoelen opgesteld voor mijn persoonlijke ' +
            'ontwikkeling. In dit reflectieverslag beschrijf ik wat ik heb geleerd en waar ik naartoe wil.',
        },
      ],
    },
  ],
};

const uit = bouwDocx(doc, { kleuren: {}, labels: {} });
const bestand = 'Reflectie_ontwikkeling.docx';
const pad = path.join(TMP, bestand);
writeFileSync(pad, uit.buffer);

const boot = await fetch(`${ORIGIN}/`);
const cookie = (boot.headers.get('set-cookie') || '').match(/cavascp_session=[^;]+/)?.[0];

const form = new FormData();
form.append('file', new Blob([uit.buffer]), bestand);
form.append('title', 'Reflectie op mijn ontwikkeling');
const upload = await fetch(`${ORIGIN}/api/documents`, {
  method: 'POST',
  headers: { Origin: ORIGIN, Cookie: cookie },
  body: form,
});
const uploadBody = await upload.json();
const docId = uploadBody.document?.id;
console.log(`  document in de inbox: ${docId}`);

const playwrightPad =
  process.env.PLAYWRIGHT_PATH || 'D:/Dropshippingv0.1tool/.mcp-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightPad).href);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, locale: 'nl-NL' });
const fouten = [];
page.on('pageerror', (e) => fouten.push(e.message.slice(0, 180)));
page.on('console', (m) => {
  if (m.type() === 'error') fouten.push(m.text().slice(0, 180));
});

try {
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
  await page.waitForSelector('.doc', { timeout: 40000 });

  /* Naar de inbox scrollen en indelen. */
  const knop = page.locator('button', { hasText: /waar hoort dit/i }).first();
  await knop.scrollIntoViewIfNeeded();
  await knop.click();
  console.log('  op "Waar hoort dit?" geklikt');

  await page.waitForSelector('.indeling', { timeout: 60000 });

  /*
   * Diagnose: staat de voorgestelde map wel in de keuzelijst? Zonder dit zie je
   * alleen dat de select leeg blijft en weet je niet waarom.
   */
  const diagnose = await page.evaluate(() => {
    const sel = document.querySelector('.doc__collection');
    return {
      bestaat: Boolean(sel),
      uitgeschakeld: sel?.disabled ?? null,
      opties: [...(sel?.options ?? [])].map((o) => `${o.value}="${o.textContent}"`),
      waarde: sel?.value ?? null,
      heeftVoorgesteldKlasse: sel?.classList.contains('is-voorgesteld') ?? false,
    };
  });
  console.log(`  keuzelijst: ${diagnose.opties.length} opties, uitgeschakeld=${diagnose.uitgeschakeld}, waarde=${JSON.stringify(diagnose.waarde)}`);
  for (const o of diagnose.opties.slice(0, 6)) console.log(`     ${o}`);

  const beeld = await page.evaluate(() => {
    const b = document.querySelector('.indeling');
    const sel = document.querySelector('.doc__collection');
    return {
      voorstel: b?.querySelector('.indeling__voorstel')?.textContent?.trim() ?? null,
      uitleg: b?.querySelector('.indeling__uitleg')?.textContent?.trim() ?? null,
      reden: b?.querySelector('.indeling__reden')?.textContent?.trim() ?? null,
      chips: [...(b?.querySelectorAll('.indeling__chip') ?? [])].map(
        (c) => `${c.classList.contains('is-aan') ? '[x]' : '[ ]'} ${c.textContent.trim()}`,
      ),
      beschrijving: b?.querySelector('.indeling__beschrijving p')?.textContent?.trim() ?? null,
      gekozenCollectie: sel?.selectedOptions?.[0]?.textContent ?? null,
      voorgesteld: sel?.classList.contains('is-voorgesteld') ?? false,
    };
  });

  console.log(`  voorstel: ${beeld.voorstel}`);
  console.log(`  uitleg  : ${beeld.uitleg}`);
  if (beeld.reden) console.log(`  reden   : ${beeld.reden}`);
  console.log(`  collectie voorgeselecteerd: ${beeld.gekozenCollectie} ${beeld.voorgesteld ? '(gemarkeerd)' : ''}`);
  for (const c of beeld.chips) console.log(`     ${c}`);
  if (beeld.beschrijving) console.log(`  toelichting: ${beeld.beschrijving.slice(0, 110)}…`);

  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `indeler-${WIDTH}.png`) });
  console.log(`  indeler-${WIDTH}.png`);

  if (fouten.length) {
    console.log('  fouten in de pagina:');
    for (const f of [...new Set(fouten)].slice(0, 5)) console.log(`     ${f}`);
  }
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  if (fouten.length) for (const f of [...new Set(fouten)].slice(0, 5)) console.error(`   ${f}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  /* Opruimen: het document uit de inbox. */
  if (docId) {
    const weg = await fetch(`${ORIGIN}/api/documents/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
      headers: { Origin: ORIGIN, Cookie: cookie },
    });
    console.log(`  document opgeruimd (${weg.status})`);
  }
  rmSync(TMP, { recursive: true, force: true });
}
