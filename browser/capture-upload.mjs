#!/usr/bin/env node
/**
 * Legt de complete upload-flow vast: verzoek én antwoord, in volgorde.
 *
 * We weten dat het werkt via de UI, maar niet waar de bytes tussen
 * /direct-uploads en /evidence naartoe gaan. Dit script laat de app één keer
 * uploaden en logt alles wat er tussen de twee API-calls gebeurt, inclusief
 * antwoorden en eventuele storage-URL's.
 *
 * Er wordt niets blijvend achtergelaten: het bewijsstuk wordt direct daarna
 * verwijderd.
 *
 *   node capture-upload.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';
import { REACT_CLICK_HELPER } from './lib/react-click.mjs';

const { chromium } = await import(CONFIG.playwrightUrl);
await mkdir(CONFIG.outDir, { recursive: true });

const TEST_FILE = path.join(CONFIG.outDir, 'capture-test.txt');
await writeFile(TEST_FILE, `capture test ${new Date().toISOString()}\n`, 'utf8');

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

/** Alles vastleggen: verzoek, antwoord, en niet-API-verkeer. */
const timeline = [];
page.on('request', (req) => {
  const url = req.url();
  if (/\.(js|css|png|svg|woff2?|ico|gif)/i.test(url)) return;
  if (/google|gstatic|sentry/i.test(url)) return;
  timeline.push({
    phase: 'request',
    at: new Date().toISOString(),
    method: req.method(),
    url: url.replace(`https://${CONFIG.portflowHost}`, '').slice(0, 300),
    contentType: (req.headers()['content-type'] ?? '').split(';')[0] || null,
    body: (() => {
      try {
        const data = req.postData();
        if (!data) return null;
        // Binaire uploads niet loggen, alleen hun grootte.
        return data.length > 1500 ? `<${data.length} bytes>` : data.slice(0, 900);
      } catch {
        return null;
      }
    })(),
  });
});

page.on('response', (res) => {
  const url = res.url();
  if (!url.includes(CONFIG.portflowHost)) return;
  if (!/api\/|upload|storage|amazonaws|blob/i.test(url)) return;
  const status = res.status();
  const ct = (res.headers()['content-type'] ?? '').split(';')[0];
  timeline.push({
    phase: 'response',
    at: new Date().toISOString(),
    status,
    url: url.replace(`https://${CONFIG.portflowHost}`, '').slice(0, 300),
    contentType: ct || null,
  });
  if (ct.includes('json')) {
    res
      .text()
      .then((body) => {
        timeline.push({
          phase: 'response-body',
          at: new Date().toISOString(),
          status,
          url: url.replace(`https://${CONFIG.portflowHost}`, '').slice(0, 300),
          body: body.slice(0, 1500),
        });
      })
      .catch(() => {});
  }
});

let createdId = null;

try {
  console.log('Verbinden…');
  await pf.connect();
  const collections = await pf.collections();
  const target = collections.find((c) => (c.evidence_count ?? 0) > 0) ?? collections[0];
  console.log(`collectie: "${target.name}" (${target.id})`);

  const beforeIds = new Set(
    (await pf.allEvidence({ perPage: 200 }).then((r) => (Array.isArray(r.data) ? r.data : []))).map((e) => e.id),
  );

  /* UI openen */
  await pf.frame.evaluate((id) => {
    window.history.pushState({}, '', `/portfolio/collections/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, target.id);
  await page.waitForTimeout(3500);

  await pf.frame.evaluate(() => {
    const btn = [...document.querySelectorAll('button, [role="button"], a')].find((n) =>
      /add evidence|bewijs toevoegen/i.test(`${n.textContent || ''} ${n.getAttribute('aria-label') || ''}`),
    );
    btn?.click();
  });
  for (let i = 0; i < 25; i += 1) {
    await page.waitForTimeout(400);
    const ready = await pf.frame
      .evaluate(() => /select what type of evidence/i.test(document.body.innerText))
      .catch(() => false);
    if (ready) break;
  }

  await pf.frame.evaluate(REACT_CLICK_HELPER);
  await pf.frame.evaluate(() => window.__cavascpClickText(/^file upload/i, { maxLength: 120 }));
  await page.waitForTimeout(2000);

  const input = await pf.frame.$('input[type="file"]');
  if (!input) throw new Error('geen bestandsveld');
  await input.setInputFiles(TEST_FILE);
  await page.waitForTimeout(2000);

  await pf.frame.evaluate((title) => {
    const field = [...document.querySelectorAll('input[type="text"], input:not([type])')].find(
      (f) => f.offsetParent !== null,
    );
    if (!field) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(field, title);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, 'cavascp capture-test');
  await page.waitForTimeout(1200);

  timeline.push({ phase: 'marker', at: new Date().toISOString(), label: 'BEVESTIGEN' });

  await pf.frame.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') ?? document.body;
    const btn = [...dialog.querySelectorAll('button')].find((n) =>
      /^add evidence$/i.test((n.textContent || '').trim()),
    );
    btn?.click();
  });

  /* Wachten tot het nieuwe bewijsstuk er is. */
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(1200);
    const list = await pf.allEvidence({ perPage: 200 });
    const items = Array.isArray(list.data) ? list.data : [];
    const fresh = items.find((e) => !beforeIds.has(e.id));
    if (fresh) {
      createdId = fresh.id;
      console.log(`nieuw bewijsstuk: id ${createdId}`);
      break;
    }
  }
  if (!createdId) console.log('geen nieuw bewijsstuk gezien');

  /* Opruimen */
  if (createdId) {
    const del = await pf.call('DELETE', `/api/v1/portfolios/${pf.portfolioId}/evidence/${createdId}`);
    console.log(`opruimen: DELETE evidence/${createdId} -> ${del.status}`);
  }

  const file = path.join(CONFIG.outDir, 'upload-timeline.json');
  await writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), createdId, timeline }, null, 2), 'utf8');

  console.log('');
  console.log('─'.repeat(74));
  console.log('  TIJDLIJN');
  console.log('─'.repeat(74));
  for (const entry of timeline) {
    if (entry.phase === 'marker') {
      console.log(`\n>>> ${entry.label}\n`);
      continue;
    }
    const arrow = entry.phase === 'request' ? '-->' : '<--';
    const extra = entry.phase === 'request' ? entry.contentType ?? '' : `${entry.status} ${entry.contentType ?? ''}`;
    console.log(`${arrow} ${entry.method ?? ''} ${entry.url} ${extra}`.trim());
    if (entry.body) console.log(`      ${entry.body.slice(0, 300)}`);
  }
  console.log('');
  console.log(`rapport: ${file}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
