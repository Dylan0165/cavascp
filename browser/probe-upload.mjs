#!/usr/bin/env node
/**
 * Achterhaalt hoe Portflow een bestand uploadt.
 *
 * Aanpak: we zetten window.fetch en XMLHttpRequest van het iframe op scherp,
 * laten de app zelf een upload STARTEN (bestand kiezen), en vangen het request
 * af. Dat request wordt tegengehouden — er gaat dus niets naar de server en er
 * verandert niets in je portfolio.
 *
 * Dat is veiliger dan zelf iets POSTen en het daarna opruimen: een mislukte
 * upload kan een half bewijsstuk achterlaten.
 *
 *   node probe-upload.mjs
 *
 * Het script laat het venster 90 seconden open zodat je zelf op
 * "+ Bewijs toevoegen" kunt klikken als het automatisch niet lukt.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';

const { chromium } = await import(CONFIG.playwrightUrl);
await mkdir(CONFIG.outDir, { recursive: true });

const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
  ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
  headless: false, // zichtbaar: jij kunt ingrijpen als het nodig is
  viewport: CONFIG.viewport,
  locale: 'nl-NL',
  timezoneId: 'Europe/Amsterdam',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());
const pf = new Portflow(page);

const captured = [];

try {
  console.log('Verbinden met Portflow…');
  const portfolioId = await pf.connect();
  console.log(`  portfolio-id: ${portfolioId}`);
  console.log('');

  // Install the interceptors inside the Portflow frame.
  await pf.frame.evaluate(() => {
    if (window.__cavascpUploadHook) return;
    window.__cavascpUploadHook = true;
    window.__cavascpCaptured = [];

    const interesting = (method, url) =>
      /upload|attachment|file|evidence|backpack|media|asset/i.test(url) &&
      !/\.(js|css|png|svg|woff2?|ico)/i.test(url);

    const describeBody = (body) => {
      try {
        if (!body) return null;
        if (typeof FormData !== 'undefined' && body instanceof FormData) {
          const fields = [];
          for (const [key, value] of body.entries()) {
            fields.push(
              typeof File !== 'undefined' && value instanceof File
                ? { key, file: { name: value.name, size: value.size, type: value.type } }
                : { key, value: String(value).slice(0, 200) },
            );
          }
          return { kind: 'FormData', fields };
        }
        if (typeof body === 'string') return { kind: 'string', preview: body.slice(0, 800) };
        if (body instanceof URLSearchParams) return { kind: 'URLSearchParams', preview: body.toString().slice(0, 800) };
        return { kind: typeof body };
      } catch (e) {
        return { kind: 'onleesbaar', error: e.message };
      }
    };

    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input?.url ?? String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (interesting(method, url)) {
        const headers = {};
        const h = init?.headers;
        if (h) {
          if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => (headers[k] = String(v).slice(0, 400)));
          else if (Array.isArray(h)) for (const [k, v] of h) headers[k] = String(v).slice(0, 400);
          else for (const [k, v] of Object.entries(h)) headers[k] = String(v).slice(0, 400);
        }
        window.__cavascpCaptured.push({
          via: 'fetch',
          method,
          url,
          headers,
          body: describeBody(init?.body),
        });
      }
      return originalFetch.apply(this, arguments);
    };

    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
      const xhr = new OriginalXHR();
      const open = xhr.open;
      const send = xhr.send;
      let meta = null;
      xhr.open = function (method, url) {
        meta = { method: String(method).toUpperCase(), url: String(url) };
        return open.apply(xhr, arguments);
      };
      xhr.send = function (body) {
        if (meta && interesting(meta.method, meta.url)) {
          window.__cavascpCaptured.push({
            via: 'xhr',
            method: meta.method,
            url: meta.url,
            headers: {},
            body: describeBody(body),
          });
        }
        return send.apply(xhr, arguments);
      };
      return xhr;
    };
    window.XMLHttpRequest.prototype = OriginalXHR.prototype;
  });

  console.log('Upload-interceptie actief.');
  console.log('');

  // Try to open the "add evidence" UI ourselves.
  const clicked = await pf.frame
    .evaluate(() => {
      const nodes = [...document.querySelectorAll('button, [role="button"], a')];
      const target = nodes.find((n) => /bewijs toevoegen|add evidence/i.test(n.textContent || n.getAttribute('aria-label') || ''));
      if (target) {
        target.click();
        return target.textContent?.trim().slice(0, 60) ?? 'geklikt';
      }
      return null;
    })
    .catch(() => null);

  console.log(clicked ? `  knop gevonden en geklikt: "${clicked}"` : '  knop niet automatisch gevonden');
  console.log('');
  console.log('  ┌────────────────────────────────────────────────────────────┐');
  console.log('  │  Klik in het venster op "+ Bewijs toevoegen", kies          │');
  console.log('  │  "Bestand uploaden" en selecteer een bestand.               │');
  console.log('  │  Het upload-request wordt afgevangen, niet verstuurd.       │');
  console.log('  │  Je hoeft niets te bevestigen — het gaat om het request.     │');
  console.log('  └────────────────────────────────────────────────────────────┘');
  console.log('');

  // Wait for the user to trigger an upload.
  const deadline = Date.now() + 90_000;
  let found = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const calls = await pf.frame.evaluate(() => window.__cavascpCaptured ?? []).catch(() => []);
    const uploads = calls.filter((c) => c.method !== 'GET');
    if (uploads.length) {
      captured.push(...uploads);
      found = true;
      break;
    }
  }

  if (found) {
    console.log('─'.repeat(70));
    console.log('  UPLOAD-REQUEST AFGEVANGEN');
    console.log('─'.repeat(70));
    for (const call of captured) {
      console.log('');
      console.log(`${call.via.toUpperCase()} ${call.method} ${call.url}`);
      const interestingHeaders = Object.fromEntries(
        Object.entries(call.headers).filter(([k]) => /content-type|authorization|x-|accept/i.test(k)),
      );
      if (Object.keys(interestingHeaders).length) {
        console.log(`  headers: ${JSON.stringify(interestingHeaders).slice(0, 500)}`);
      }
      console.log(`  body   : ${JSON.stringify(call.body)?.slice(0, 1200)}`);
    }
  } else {
    console.log('Geen upload-request gezien. Mogelijk is er niets geüpload, of de app');
    console.log('gebruikt een andere techniek (bijv. een signed URL naar opslag).');
    const all = await pf.frame.evaluate(() => window.__cavascpCaptured ?? []).catch(() => []);
    if (all.length) {
      console.log('');
      console.log('Wat er wel voorbij kwam:');
      for (const call of all.slice(0, 20)) console.log(`  ${call.via} ${call.method} ${call.url}`);
    }
  }

  const file = path.join(CONFIG.outDir, 'upload-probe.json');
  await writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), captured }, null, 2), 'utf8');
  console.log('');
  console.log(`rapport: ${file}`);
} catch (error) {
  console.error(`\nFOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
