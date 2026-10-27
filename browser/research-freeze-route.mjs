#!/usr/bin/env node
/**
 * Het exacte freeze-endpoint vinden.
 *
 * GET /portfolio-freezes/goals werkt, maar POST /portfolio-freezes geeft 404.
 * Het aanmaak-endpoint heeft dus een andere vorm. We zoeken hem op in de
 * JavaScript-bundels van de app — daar staan de API-routes letterlijk in.
 *
 * Alleen-lezen.
 *
 *   node research-freeze-route.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';

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

try {
  await pf.connect();
  console.log(`verbonden: portfolio ${pf.portfolioId}`);
  console.log('');

  /* ── 1. Alle scriptbronnen verzamelen, ook dynamisch geladen ────────── */
  console.log('='.repeat(78));
  console.log('1. BUNDELS DOORZOEKEN OP "FREEZE"');
  console.log('='.repeat(78));

  const result = await pf.frame.evaluate(async () => {
    const seen = new Set();
    const routes = new Set();
    const contextLines = [];

    // Verzamel alle script-URL's die de pagina kent, plus wat de performance-
    // timeline zag (daar staan dynamisch geladen brokken in).
    const scripts = new Set([...document.querySelectorAll('script[src]')].map((s) => s.src));
    try {
      for (const e of performance.getEntriesByType('resource')) {
        if (e.name.endsWith('.js')) scripts.add(e.name);
      }
    } catch {
      /* niet beschikbaar */
    }

    for (const src of scripts) {
      if (seen.has(src)) continue;
      seen.add(src);
      let text;
      try {
        const res = await fetch(src, { credentials: 'include' });
        if (!res.ok) continue;
        text = await res.text();
      } catch {
        continue;
      }
      if (!/freeze/i.test(text)) continue;

      // Routes: alles wat op een freeze-pad lijkt.
      for (const m of text.matchAll(/["'`](\/api\/v1\/[a-z0-9/_:{}.\-$]*freeze[a-z0-9/_:{}.\-$]*)["'`]/gi)) {
        routes.add(m[1]);
      }
      // Sjabloonletters: `${...}` in de bron.
      for (const m of text.matchAll(/["'`](\/api\/v1\/portfolios\/[^"'`]*freeze[^"'`]*)["'`]/gi)) {
        routes.add(m[1]);
      }
      // En de kale stukken rond het woord, om de route te kunnen reconstrueren.
      for (const m of text.matchAll(/.{70}freeze.{70}/gi)) {
        if (contextLines.length < 30) contextLines.push(m[0].replace(/\s+/g, ' '));
      }
    }
    return { scripts: seen.size, routes: [...routes].sort(), contextLines };
  });

  console.log(`  bundels gelezen: ${result.scripts}`);
  console.log(`  routes gevonden: ${result.routes.length}`);
  for (const r of result.routes) console.log(`    ${r}`);
  console.log('');

  if (result.contextLines.length) {
    console.log('  tekst rond "freeze" in de bundel:');
    for (const l of result.contextLines.slice(0, 14)) console.log(`    …${l}…`);
  }

  /* ── 2.路由-probe op basis van wat we vonden ────────────────────────── */
  console.log('');
  console.log('='.repeat(78));
  console.log('2. ROUTES PROBEREN (alleen status, geen data versturen)');
  console.log('='.repeat(78));

  const P = pf.portfolioId;
  const kandidaten = [
    ...result.routes.map((r) => r.replace(/\$\{[^}]+\}/g, String(P))),
    `/api/v1/portfolios/${P}/portfolio-freeze`,
    `/api/v1/portfolios/${P}/freezes`,
    `/api/v1/portfolios/${P}/portfolio_freezes`,
    `/api/v1/portfolio-freezes`,
  ];

  for (const p of [...new Set(kandidaten)]) {
    const r = await pf.frame.evaluate(
      async ({ p, auth, csrf }) => {
        const res = await fetch(p, {
          method: 'GET',
          headers: { authorization: auth, 'x-csrf-token': csrf ?? '', accept: 'application/json' },
          credentials: 'include',
        });
        const t = await res.text();
        return { status: res.status, text: t.slice(0, 200) };
      },
      { p, auth: pf.auth.authorization, csrf: pf.auth.csrf },
    );
    const flag = r.status === 200 ? 'OK ' : '—  ';
    console.log(`  ${flag} [${r.status}] ${p.replace(`/api/v1/portfolios/${P}`, '…')}`);
    if (r.status === 200) console.log(`         ${r.text.slice(0, 180)}`);
  }

  const file = path.join(OUT, 'freeze-routes.json');
  await writeFile(file, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\nrapport: ${file}`);
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
