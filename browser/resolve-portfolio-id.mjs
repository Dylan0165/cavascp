#!/usr/bin/env node
/**
 * Bepaal het portfolio-id en test of de sessie werkt.
 *
 * Waarom niet uit de pagina gelezen: het id staat niet in de URL, de opslag of
 * de cookies — de app krijgt het via de LTI-launch en houdt het in zijn eigen
 * JavaScript-state. In plaats van daar doorheen te graven testen we de
 * kandidaten direct: een reeks rond het laatst waargenomen id. Alleen-lezen.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';

const { chromium } = await import(CONFIG.playwrightUrl);
await mkdir(CONFIG.outDir, { recursive: true });

/** Laatst gezien in het netwerklog; kandidaten eromheen. */
const CENTER = Number(process.env.CAVASCP_PF_ID || 22253);
const SPREAD = 40;

const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
  ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
  headless: true,
  viewport: CONFIG.viewport,
  userAgent: CONFIG.userAgent,
  locale: 'nl-NL',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(CONFIG.portfolioLaunch, { waitUntil: 'domcontentloaded', timeout: 90_000 });

let frame = null;
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(1500);
  frame = page.frames().find((f) => f.url().includes(CONFIG.portflowHost));
  if (frame) {
    // Wait for the SPA to be functional, not merely present.
    const ready = await frame
      .evaluate(async () => {
        try {
          const res = await fetch('/api/v1/capabilities', { credentials: 'include' });
          return res.ok;
        } catch {
          return false;
        }
      })
      .catch(() => false);
    if (ready) break;
  }
}

if (!frame) {
  console.error('geen Portflow-frame gevonden');
  await context.close();
  process.exit(1);
}

console.log(`frame: ${frame.url()}`);
console.log(`sessie: /api/v1/capabilities antwoordt`);
console.log('');

// Step 1: who are we?
const me = await frame.evaluate(async () => {
  const res = await fetch('/api/v1/users/current', { credentials: 'include' });
  return res.ok ? res.json() : { status: res.status };
});
console.log('users/current:', JSON.stringify(me).slice(0, 240));
console.log('');

// Step 2: which portfolio id answers? Probe a window around the known id.
const candidates = [];
for (let offset = 0; offset <= SPREAD; offset += 1) {
  candidates.push(CENTER + offset);
  if (offset) candidates.push(CENTER - offset);
}

const hits = await frame.evaluate(async (ids) => {
  const out = [];
  for (const id of ids) {
    try {
      const res = await fetch(`/api/v1/portfolios/${id}/collections?page=1`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        out.push({ id, count: Array.isArray(data) ? data.length : null, sample: Array.isArray(data) ? data[0]?.name : null });
      }
    } catch {
      /* keep probing */
    }
  }
  return out;
}, candidates);

console.log(`werkende portfolio-ids (${hits.length}):`);
for (const hit of hits) {
  console.log(`  ${hit.id}  ${hit.count} collecties  ${hit.sample ? `eerste: ${hit.sample}` : ''}`);
}

if (hits.length) {
  const file = path.join(CONFIG.outDir, 'portfolio-ids.json');
  await writeFile(file, JSON.stringify({ center: CENTER, hits, me }, null, 2), 'utf8');
  console.log(`\nrapport: ${file}`);
}

await context.close();
