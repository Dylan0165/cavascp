#!/usr/bin/env node
/**
 * Een los inlever-dashboard.
 *
 * Bewust niet in het cavascp-dashboard: dit is een eigen proces op een eigen
 * poort, met een eigen map. Als het portfolio-dashboard stuk is, kun je hier
 * nog steeds je documenten pakken. En andersom.
 *
 *   node portfolio-site/server.mjs            # poort 8788
 *   node portfolio-site/server.mjs --port 9000
 *
 * De catalogus komt uit hetzelfde bestand als de rest (dashboard/lib), zodat er
 * één bron van waarheid is voor welke tekst bij welk bewijsstuk hoort.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { portfolioCatalogus } from '../dashboard/lib/portfolio.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.resolve(HIER, '..', 'vault');
const PUBLIC = path.join(HIER, 'public');

const argumenten = process.argv.slice(2);
const poortIndex = argumenten.indexOf('--port');
const POORT = Number(poortIndex !== -1 ? argumenten[poortIndex + 1] : process.env.PORTFOLIO_POORT || 8792);
const HOST = process.env.PORTFOLIO_HOST || '100.96.31.24';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
};

function kop(res, status, type, extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...extra,
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const pad = url.pathname;

  try {
    if (pad === '/api/lijst') {
      const body = JSON.stringify(portfolioCatalogus());
      kop(res, 200, 'application/json; charset=utf-8');
      return res.end(body);
    }

    // Downloaden uit de vault, met een controle dat het pad er ook echt in zit.
    if (pad === '/download') {
      const gevraagd = url.searchParams.get('pad') ?? '';
      const doel = path.resolve(VAULT, gevraagd);

      if (!doel.startsWith(VAULT + path.sep) || !existsSync(doel) || !statSync(doel).isFile()) {
        kop(res, 404, 'text/plain; charset=utf-8');
        return res.end('bestand niet gevonden');
      }

      const data = await readFile(doel);
      const extensie = path.extname(doel).toLowerCase();

      kop(res, 200, MIME[extensie] ?? 'application/octet-stream', {
        'Content-Length': data.length,
        ...(extensie === '.md' ? {} : { 'Content-Disposition': `attachment; filename="${path.basename(doel)}"` }),
      });
      return res.end(data);
    }

    // Alles wat geen API of download is, komt uit public/.
    const bestand = pad === '/' ? 'index.html' : pad.replace(/^\/+/, '');
    const doel = path.resolve(PUBLIC, bestand);

    if (!doel.startsWith(PUBLIC + path.sep)) {
      kop(res, 403, 'text/plain; charset=utf-8');
      return res.end('verboden');
    }

    const data = await readFile(doel);
    kop(res, 200, MIME[path.extname(doel).toLowerCase()] ?? 'application/octet-stream', {
      'Content-Length': data.length,
    });
    res.end(data);
  } catch {
    kop(res, 404, 'text/plain; charset=utf-8');
    res.end('niet gevonden');
  }
});

server.listen(POORT, HOST, () => {
  console.log(`  inlever-dashboard op http://${HOST}:${POORT}`);
});
