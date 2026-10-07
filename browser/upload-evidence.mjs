#!/usr/bin/env node
/**
 * Test de volledige upload-cyclus naar Portflow, zonder tussenkomst van de
 * gebruiker.
 *
 * Wat het doet:
 *   1. maakt een klein tekstbestand aan;
 *   2. opent de collectie en de "Add evidence" → "File upload"-flow;
 *   3. zet het bestand in het bestandsveld;
 *   4. vult de titel in en bevestigt;
 *   5. controleert via de API of het bewijsstuk bestaat;
 *   6. ruimt het daarna weer op, zodat je portfolio schoon blijft.
 *
 * De opruimstap is bewust onderdeel van de test: blijft er iets staan, dan zie
 * je dat in de uitvoer en kun je het zelf weghalen.
 *
 *   node upload-evidence.mjs            # volledige cyclus, maakt en ruimt op
 *   node upload-evidence.mjs --keep     # laat het bewijsstuk staan
 *   node upload-evidence.mjs --dry      # alles behalve bevestigen
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';
import { REACT_CLICK_HELPER } from './lib/react-click.mjs';

const KEEP = process.argv.includes('--keep');
const DRY = process.argv.includes('--dry');

const { chromium } = await import(CONFIG.playwrightUrl);
await mkdir(CONFIG.outDir, { recursive: true });
const shotDir = path.join(CONFIG.outDir, 'upload');
await mkdir(shotDir, { recursive: true });

/** Klein testbestand, herkenbaar zodat je het terugvindt. */
const TEST_FILE = path.join(CONFIG.outDir, 'testbewijs.txt');
await writeFile(
  TEST_FILE,
  [
    'Dit bestand is automatisch geüpload door cavascp om de koppeling te testen.',
    `Aangemaakt: ${new Date().toISOString()}`,
    'Je kunt dit bewijsstuk verwijderen; het is niet bedoeld als portfolio-inhoud.',
  ].join('\n'),
  'utf8',
);

const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
  ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
  headless: true,
  viewport: CONFIG.viewport,
  userAgent: CONFIG.userAgent,
  locale: 'nl-NL',
  timezoneId: 'Europe/Amsterdam',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());
const pf = new Portflow(page);

/* Alles wat naar de server gaat, vastleggen. */
const sent = [];
page.on('request', (req) => {
  const url = req.url();
  if (!url.includes(CONFIG.portflowHost)) return;
  if (req.method() === 'GET') return;
  sent.push({
    method: req.method(),
    url: url.replace(`https://${CONFIG.portflowHost}`, ''),
    contentType: req.headers()['content-type'] ?? null,
    postPreview: (() => {
      try {
        return req.postData()?.slice(0, 800) ?? null;
      } catch {
        return null;
      }
    })(),
  });
});

const log = (...args) => console.log(...args);
let createdId = null;

try {
  log('Verbinden…');
  const portfolioId = await pf.connect();
  log(`  portfolio ${portfolioId}, ingelogd als ${pf.me?.name ?? '?'}`);

  const collections = await pf.collections();
  const target =
    collections.find((c) => (c.evidence_count ?? 0) > 0) ??
    collections.find((c) => /cyber|test/i.test(c.name)) ??
    collections[0];
  log(`  doelcollectie: "${target.name}" (id ${target.id})`);

  const before = await pf.evidenceInCollection(target.id);
  log(`  bewijsstukken nu: ${before.length}`);

  /* 1. Open de collectie. */
  await pf.frame.evaluate((id) => {
    window.history.pushState({}, '', `/portfolio/collections/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, target.id);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(shotDir, '1-collection.png') }).catch(() => {});

  /* 2. Open het "Add evidence"-dialoogvenster.
        Een gewone .click() op de knop werkt hier; de React-helper uit
        lib/react-click.mjs is alleen nodig voor de tegels in het dialoog
        (die zijn opgemaakte divs zonder native knopgedrag). */
  const opened = await pf.frame.evaluate(() => {
    const nodes = [...document.querySelectorAll('button, [role="button"], a')];
    const match = nodes.find((n) =>
      /add evidence|bewijs toevoegen/i.test(
        `${n.textContent || ''} ${n.getAttribute('aria-label') || ''}`,
      ),
    );
    if (!match) return { ok: false, reason: 'knop niet gevonden' };
    match.click();
    return { ok: true };
  });

  // Wacht tot het dialoog er echt staat voordat we verdergaan.
  let dialogReady = false;
  for (let i = 0; i < 25; i += 1) {
    await page.waitForTimeout(400);
    dialogReady = await pf.frame
      .evaluate(() => /select what type of evidence|file upload/i.test(document.body.innerText))
      .catch(() => false);
    if (dialogReady) break;
  }
  log(`  dialoog openen: ${opened.ok ? 'geklikt' : `MISLUKT (${opened.reason})`} · dialoog zichtbaar: ${dialogReady}`);
  await page.screenshot({ path: path.join(shotDir, '2-dialog.png') }).catch(() => {});

  if (!dialogReady) throw new Error('het "Add evidence"-dialoog ging niet open');

  /* 3. Kies "File upload". De tegel is een div met een click-handler. */
  await pf.frame.evaluate(REACT_CLICK_HELPER);
  const choseUpload = await pf.frame.evaluate(() =>
    window.__cavascpClickText(/^file upload/i, { maxLength: 120 }),
  );
  log(
    `  "File upload" kiezen: ${choseUpload.ok ? `gelukt via ${choseUpload.via} ("${choseUpload.text}")` : `MISLUKT (${choseUpload.reason})`}`,
  );
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shotDir, '3-file-upload.png') }).catch(() => {});

  /* 4. Bestand in het veld zetten. */
  let input = await pf.frame.$('input[type="file"]');
  if (!input) {
    // Some builds only create the input once the drop area is activated.
    await pf.frame.evaluate(() => window.__cavascpClickText(/browse|choose file|bestand kiezen|select file/i));
    await page.waitForTimeout(1500);
    input = await pf.frame.$('input[type="file"]');
  }
  if (!input) {
    const state = await pf.frame.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]') ?? document.body;
      return {
        heading: dialog.querySelector('h1, h2, h3')?.textContent?.trim().slice(0, 80) ?? null,
        fileInputs: document.querySelectorAll('input[type="file"]').length,
        buttons: [...dialog.querySelectorAll('button, [role="button"]')]
          .map((n) => (n.textContent || '').trim().slice(0, 40))
          .filter(Boolean)
          .slice(0, 15),
      };
    });
    throw new Error(`geen bestandsveld. Dialoog zegt: ${JSON.stringify(state)}`);
  }
  await input.setInputFiles(TEST_FILE);
  log(`  bestand gezet: ${path.basename(TEST_FILE)}`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(shotDir, '4-file-set.png') }).catch(() => {});

  /* 5. Titel invullen als er een tekstveld is. */
  const filled = await pf.frame.evaluate((title) => {
    const fields = [...document.querySelectorAll('input[type="text"], input:not([type]), textarea')];
    const visible = fields.filter((f) => f.offsetParent !== null);
    if (!visible.length) return { filled: false, reason: 'geen tekstveld zichtbaar' };
    const field = visible[0];
    const setter = Object.getOwnPropertyDescriptor(
      field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(field, title);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return { filled: true, name: field.name || field.id || '(naamloos)', value: field.value };
  }, 'cavascp testbewijs');
  log(`  titel invullen: ${JSON.stringify(filled)}`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(shotDir, '5-title.png') }).catch(() => {});

  /* 6. Bevestigen — tenzij we alleen willen kijken. */
  const dialogButtons = await pf.frame.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') ?? document.body;
    return [...dialog.querySelectorAll('button, [role="button"]')]
      .filter((n) => n.offsetParent !== null)
      .map((n) => ({ text: (n.textContent || '').trim().slice(0, 40), disabled: n.disabled }))
      .filter((n) => n.text)
      .slice(-8);
  });
  log(`  knoppen in het dialoog: ${JSON.stringify(dialogButtons)}`);

  if (DRY) {
    log('  --dry: niet bevestigd.');
  } else {
    const clicked = await pf.frame.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]') ?? document.body;
      const nodes = [...dialog.querySelectorAll('button, [role="button"]')].filter(
        (n) => n.offsetParent !== null && !n.disabled,
      );
      // De bevestigknop heet "Add evidence"; "Add and link to goal(s)" is een
      // andere route (eerst doelen kiezen), die slaan we over.
      const match =
        nodes.find((n) => /^add evidence$/i.test((n.textContent || '').trim())) ??
        nodes.find((n) => /^(add|toevoegen|save|opslaan|upload)/i.test((n.textContent || '').trim()));
      if (!match) return null;
      const text = match.textContent.trim().slice(0, 40);
      match.click();
      return text;
    });
    log(`  bevestigen: ${clicked ? `geklikt op "${clicked}"` : 'GEEN knop gevonden'}`);

    /* Wachten tot de upload klaar is. */
    for (let i = 0; i < 40; i += 1) {
      await page.waitForTimeout(1500);
      const now = await pf.evidenceInCollection(target.id).catch(() => []);
      if (now.length > before.length) {
        createdId = now.find((e) => !before.some((b) => b.id === e.id))?.id ?? null;
        log(`  NIEUW BEWIJSSTUK: id ${createdId} (nu ${now.length} stuks)`);
        break;
      }
    }
    if (!createdId) log('  geen nieuw bewijsstuk gezien binnen de wachttijd');
  }

  await page.screenshot({ path: path.join(shotDir, '6-result.png') }).catch(() => {});

  /* 7. Opruimen. */
  if (createdId && !KEEP) {
    log('');
    log('  Opruimen…');
    const removed = await pf.call(
      'DELETE',
      `/api/v1/portfolios/${portfolioId}/evidence/${createdId}`,
    );
    log(`  DELETE /api/v1/portfolios/${portfolioId}/evidence/${createdId} -> ${removed.status}`);
    if (!removed.ok) {
      const evidence = await pf.allEvidence();
      log(`  endpoints om te proberen: ${JSON.stringify(evidence.data).slice(0, 200)}`);
    }
    await page.waitForTimeout(1500);
    const after = await pf.evidenceInCollection(target.id).catch(() => []);
    log(`  bewijsstukken na opruimen: ${after.length} (was ${before.length})`);
  } else if (createdId) {
    log('');
    log(`  --keep: bewijsstuk ${createdId} blijft staan in "${target.name}".`);
  }

  /* Rapport. */
  const requestsFile = path.join(CONFIG.outDir, 'upload-requests.json');
  await writeFile(
    requestsFile,
    JSON.stringify({ generatedAt: new Date().toISOString(), collection: target, createdId, sent }, null, 2),
    'utf8',
  );

  log('');
  log('─'.repeat(70));
  log('  VERZONDEN REQUESTS');
  log('─'.repeat(70));
  for (const req of sent) {
    log(`  ${req.method} ${req.url}`);
    if (req.contentType) log(`     content-type: ${req.contentType.split(';')[0]}`);
    if (req.postPreview && !req.contentType?.includes('multipart')) {
      log(`     body: ${req.postPreview.slice(0, 300)}`);
    }
  }
  log('');
  log(`  rapport: ${requestsFile}`);
  log(`  screenshots: ${shotDir}`);
} catch (error) {
  console.error(`\nFOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
