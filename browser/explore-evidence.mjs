#!/usr/bin/env node
/**
 * Loopt zelf door de "bewijs toevoegen"-flow van Portflow en legt elke stap
 * vast: welke knoppen er zijn, wat er in het dialoogvenster staat, en welke
 * requests de app onderweg doet.
 *
 * Er wordt niets bevestigd: het script stopt voordat er iets naar de server
 * gaat. Elk request dat tóch langskomt wordt gelogd (niet tegengehouden, want
 * dat zou de app kunnen laten vastlopen).
 *
 * Van elke stap wordt een screenshot bewaard, zodat te controleren is wat er
 * gebeurde zonder zelf te kijken.
 *
 *   node explore-evidence.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';

const { chromium } = await import(CONFIG.playwrightUrl);
const shotDir = path.join(CONFIG.outDir, 'steps');
await mkdir(shotDir, { recursive: true });

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

const requests = [];
page.on('request', (req) => {
  const url = req.url();
  if (!url.includes(CONFIG.portflowHost)) return;
  if (!/upload|attachment|evidence|backpack|file|media|asset/i.test(url)) return;
  if (/\.(js|css|png|svg|woff2?|ico)/i.test(url)) return;
  requests.push({
    method: req.method(),
    url: url.replace(`https://${CONFIG.portflowHost}`, ''),
    contentType: req.headers()['content-type'] ?? null,
    postPreview: (() => {
      try {
        return req.postData()?.slice(0, 600) ?? null;
      } catch {
        return null;
      }
    })(),
  });
});

const steps = [];
async function step(label, action) {
  const before = requests.length;
  let result = null;
  try {
    result = await action();
  } catch (error) {
    result = { error: error.message };
  }
  await page.waitForTimeout(2500);
  const newRequests = requests.slice(before);
  const shot = path.join(shotDir, `${String(steps.length).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-')}.png`);
  await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
  steps.push({ label, result, newRequests, shot: path.basename(shot) });
  console.log(`\n[${steps.length}] ${label}`);
  if (result !== null) console.log(`    resultaat : ${JSON.stringify(result).slice(0, 260)}`);
  for (const r of newRequests) {
    console.log(`    REQUEST   : ${r.method} ${r.url}${r.contentType ? `  (${r.contentType.split(';')[0]})` : ''}`);
    if (r.postPreview) console.log(`                body: ${r.postPreview.slice(0, 200)}`);
  }
  if (!newRequests.length) console.log('    (geen requests)');
  return result;
}

try {
  console.log('Verbinden…');
  const portfolioId = await pf.connect();
  console.log(`portfolio ${portfolioId}, ingelogd als ${pf.me?.name ?? '?'}`);

  /* Ga naar een collectie: daar hoort de knop "+ Bewijs toevoegen" te staan. */
  const collections = await pf.collections();
  const richest =
    collections.filter((c) => (c.evidence_count ?? 0) > 0).sort((a, b) => b.evidence_count - a.evidence_count)[0] ??
    collections[0];
  console.log(`collectie: "${richest.name}" (id ${richest.id}, ${richest.evidence_count ?? 0} bewijsstukken)`);

  await step('open-collectie', async () => {
    await pf.frame.evaluate((id) => {
      window.history.pushState({}, '', `/portfolio/collections/${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, richest.id);
    return { navigatedTo: richest.id };
  });
  await page.waitForTimeout(3000);

  /* Zoek de knop "+ Bewijs toevoegen" in het iframe. */
  const found = await step('inventarisatie-knoppen', async () =>
    pf.frame.evaluate(() => {
      const nodes = [...document.querySelectorAll('button, [role="button"], a')];
      return nodes
        .map((n, index) => ({
          index,
          text: (n.textContent || '').trim().slice(0, 70),
          aria: n.getAttribute('aria-label'),
          title: n.getAttribute('title'),
        }))
        .filter((n) => n.text || n.aria || n.title)
        .slice(0, 60);
    }),
  );

  /* Klik op de knop die het dichtst bij "bewijs toevoegen" komt. */
  const clicked = await step('klik-bewijs-toevoegen', async () =>
    pf.frame.evaluate(() => {
      const nodes = [...document.querySelectorAll('button, [role="button"], a')];
      const match = nodes.find((n) =>
        /bewijs toevoegen|add evidence|\+\s*bewijs/i.test(
          `${n.textContent || ''} ${n.getAttribute('aria-label') || ''} ${n.getAttribute('title') || ''}`,
        ),
      );
      if (!match) return { found: false };
      match.click();
      return { found: true, text: (match.textContent || '').trim().slice(0, 70) };
    }),
  );

  /* Wat staat er nu in het dialoogvenster? */
  await step('dialoog-inhoud', async () =>
    pf.frame.evaluate(() => {
      const dialog =
        document.querySelector('[role="dialog"], .modal, [class*="odal"], [class*="ialog"]') ?? document.body;
      const options = [...dialog.querySelectorAll('button, [role="button"], li, a')]
        .map((n) => (n.textContent || '').trim().slice(0, 60))
        .filter(Boolean);
      return {
        heading: dialog.querySelector('h1, h2, h3')?.textContent?.trim().slice(0, 90) ?? null,
        options: [...new Set(options)].slice(0, 25),
        fileInputs: dialog.querySelectorAll('input[type="file"]').length,
      };
    }),
  );

  /* Kies "Bestand uploaden" als die optie er is. */
  await step('klik-bestand-uploaden', async () =>
    pf.frame.evaluate(() => {
      const nodes = [...document.querySelectorAll('button, [role="button"], li, a, label')];
      const match = nodes.find((n) => /bestand uploaden|upload file|upload een bestand/i.test(n.textContent || ''));
      if (!match) return { found: false };
      match.click();
      return { found: true, text: (match.textContent || '').trim().slice(0, 60) };
    }),
  );

  /* Is er een bestandsveld? Dan kunnen we daar een bestand in zetten. */
  const fileInputs = await step('bestandsvelden-tellen', async () =>
    pf.frame.evaluate(() => {
      const inputs = [...document.querySelectorAll('input[type="file"]')];
      return inputs.map((i, index) => ({
        index,
        accept: i.getAttribute('accept'),
        multiple: i.multiple,
        name: i.getAttribute('name'),
        visible: i.offsetParent !== null,
      }));
    }),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    portfolioId,
    steps,
    allRequests: requests,
    note: 'Er is niets bevestigd: het script stopt voordat er iets naar de server gaat.',
  };
  const file = path.join(CONFIG.outDir, 'explore-evidence.json');
  await writeFile(file, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n' + '─'.repeat(70));
  console.log('  SAMENVATTING');
  console.log('─'.repeat(70));
  console.log(`  stappen met een nieuw request: ${steps.filter((s) => s.newRequests.length).length}`);
  console.log(`  bestandsvelden gevonden      : ${Array.isArray(fileInputs) ? fileInputs.length : '?'}`);
  console.log(`  screenshots                  : ${shotDir}`);
  console.log(`  rapport                      : ${file}`);
} catch (error) {
  console.error(`\nFOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
