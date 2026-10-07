#!/usr/bin/env node
/**
 * cavascp dashboard — lokale server.
 *
 * Serveert één pagina op 127.0.0.1 en hergebruikt dezelfde analyse-laag als de
 * MCP-server, zodat het dashboard en de MCP nooit uit elkaar kunnen lopen.
 *
 * Waarom een server en geen los HTML-bestand: het Canvas-token mag nooit in de
 * browser terechtkomen. De server doet de API-calls, de browser krijgt alleen
 * het resultaat. Bovendien kan zo je eigen notities en afvinklijst bewaard
 * blijven in plaats van te verdwijnen bij elke refresh.
 *
 *   node dashboard/server.mjs            # start op http://127.0.0.1:8787
 *   node dashboard/server.mjs --port 9000
 *
 * Alleen-lezen richting Canvas. De enige writes zijn naar dashboard/state.json.
 */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createCanvas, loadEnvFile } from '../mcp/lib/canvas.mjs';
import { fetchPortfolioAssignments, buildCriterionCoverage } from '../mcp/lib/analysis.mjs';
import { createDocumentStore, parseMultipart } from './lib/documents.mjs';
import { createSecurity } from './lib/security.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const STATE_FILE = path.join(HERE, 'state.json');
// Overridable so tests (and a second instance) can use a scratch inbox instead
// of the real one.
const DOC_DIR = process.env.CAVASCP_DOC_DIR || HERE;
const DOC_INDEX = process.env.CAVASCP_DOC_INDEX || path.join(DOC_DIR, 'documents.json');
const ENV_FILE = process.env.CANVAS_ENV_FILE || 'D:/cavascp/.env';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = Number(portArg !== -1 ? args[portArg + 1] : process.env.CAVASCP_PORT || 8787);
const HOST = '127.0.0.1';
const CACHE_MS = Number(process.env.CAVASCP_CACHE_MS ?? 600_000);

/** Alleen met --allow-remote komen er verbindingen van buiten deze machine door. */
const ALLOW_REMOTE = args.includes('--allow-remote');

const docs = createDocumentStore({ dir: DOC_DIR, indexFile: DOC_INDEX });
const security = createSecurity({ port: PORT, allowRemote: ALLOW_REMOTE });

/* ─────────────────────────────── state ─────────────────────────────────── */

/** UI state lives next to the server so notes survive restarts. */
const emptyState = () => ({ version: 1, notes: {}, done: {}, updatedAt: null });

async function readState() {
  if (!existsSync(STATE_FILE)) return emptyState();
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    return {
      version: 1,
      notes: parsed?.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
      done: parsed?.done && typeof parsed.done === 'object' ? parsed.done : {},
      updatedAt: parsed?.updatedAt ?? null,
    };
  } catch {
    // A corrupt state file must not take the dashboard down.
    return emptyState();
  }
}

async function writeState(state) {
  const next = { ...state, version: 1, updatedAt: new Date().toISOString() };
  await mkdir(HERE, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/* ──────────────────────────────── data ─────────────────────────────────── */

let cache = null; // { at, payload }

async function canvasClient() {
  let token = process.env.CANVAS_TOKEN;
  let baseUrl = process.env.CANVAS_BASE_URL;
  if (!token || !baseUrl) {
    const fromFile = await loadEnvFile(ENV_FILE);
    token = token || fromFile.CANVAS_TOKEN;
    baseUrl = baseUrl || fromFile.CANVAS_BASE_URL;
  }
  if (!token) {
    const error = new Error(
      `Geen Canvas-token gevonden. Zet CANVAS_TOKEN in ${ENV_FILE} of in de omgeving.`,
    );
    error.code = 'NO_TOKEN';
    return { error };
  }
  return { canvas: createCanvas({ baseUrl: baseUrl || 'https://fhict.instructure.com', token }) };
}

function buildPayload(assignments) {
  const now = new Date();
  const nowMs = now.getTime();

  const open = assignments.filter((a) => a.state === 'unsubmitted');
  const overdue = open.filter((a) => a.dueAt && Date.parse(a.dueAt) < nowMs);
  const upcoming = open
    .filter((a) => a.dueAt && Date.parse(a.dueAt) >= nowMs)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));

  const coverage = buildCriterionCoverage(assignments);
  const gaps = coverage.filter((c) => c.evidenceCount === 0);

  const courses = [...new Map(assignments.map((a) => [a.courseId, a.courseName])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const loCodes = [...new Set(assignments.flatMap((a) => a.loCodes))].sort(
    (a, b) => Number(a.slice(2)) - Number(b.slice(2)),
  );

  const within = (days) =>
    upcoming.filter((a) => Date.parse(a.dueAt) - nowMs <= days * 86_400_000).length;

  return {
    generatedAt: now.toISOString(),
    cached: false,
    stats: {
      total: assignments.length,
      open: open.length,
      overdue: overdue.length,
      submitted: assignments.length - open.length,
      next7: within(7),
      next14: within(14),
      next30: within(30),
      criteriaTotal: coverage.length,
      criteriaCovered: coverage.length - gaps.length,
      criteriaGaps: gaps.length,
    },
    courses,
    loCodes,
    assignments,
    coverage: coverage.map((c) => ({
      ...c,
      evidence: c.evidence.slice(0, 12),
      gaps: c.gaps.slice(0, 12),
    })),
  };
}

async function getPayload({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.payload, cached: true, cacheAgeMs: Date.now() - cache.at };
  }
  const { canvas, error } = await canvasClient();
  if (error) {
    const wrapped = new Error(error.message);
    wrapped.code = 'NO_TOKEN';
    throw wrapped;
  }
  const assignments = await fetchPortfolioAssignments(canvas);
  const payload = buildPayload(assignments);
  payload.documentStats = await docs.stats();
  cache = { at: Date.now(), payload };
  return payload;
}

/* ────────────────────────────── http layer ─────────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...security.headers(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

/**
 * De bootstrappagina: zet de sessiecookie en stuurt door naar het dashboard.
 *
 * Dit is de enige route zonder sessie-eis — anders kwam je er nooit in. De
 * cookie is HttpOnly en SameSite=Strict, dus alleen deze browser kan hem
 * gebruiken en alleen vanaf deze site.
 */
function serveBootstrap(res) {
  security.setCookie(res);
  const html = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>cavascp</title>
<style>
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center;
         background: #0a0a0c; color: #ededf0;
         font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
  main { text-align: center; padding: 24px; }
  .n { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: #6c6c76; margin-top: 10px; }
  a { color: #e2a63f; }
</style>
</head>
<body>
<main>
  <h1 style="font-size:20px;margin:0 0 6px">cavascp</h1>
  <p style="color:#96969f;margin:0">Sessie wordt gezet…</p>
  <p class="n">sleutel ${security.fingerprint}…</p>
  <p><a href="/dashboard?k=${security.sessionToken}">Doorgaan</a></p>
</main>
<script>location.replace('/dashboard?k=${security.sessionToken}');</script>
</body>
</html>`;
  res.writeHead(200, {
    ...security.headers(),
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

async function readBody(req, limit = 512 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body te groot');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Same as readBody but returns the raw Buffer, for multipart uploads. */
async function readRawBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error(`upload groter dan ${Math.round(limit / 1_048_576)} MB`);
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Open a folder in Explorer. The path is never taken from the request. */
function revealInExplorer(target) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ error: 'deze functie werkt alleen op Windows' });
      return;
    }
    const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' });
    child.on('error', (err) => resolve({ error: err.message }));
    child.on('spawn', () => {
      child.unref();
      resolve({ error: null });
    });
  });
}

/**
 * Run the Portflow bridge and read its JSON result.
 *
 * The bridge prints human-readable progress to stderr and exactly one JSON line
 * to stdout, so the last stdout line is the result. A browser round-trip takes
 * a while, hence the generous timeout.
 */
const PORTFLOW_SCRIPT = path.join(HERE, '..', 'browser', 'send-to-portflow.mjs');
const PORTFLOW_TIMEOUT_MS = Number(process.env.CAVASCP_PORTFLOW_TIMEOUT ?? 180_000);

function runPortflow(args) {
  return new Promise((resolve) => {
    if (!existsSync(PORTFLOW_SCRIPT)) {
      resolve({
        status: 500,
        body: { ok: false, error: `brugscript niet gevonden: ${PORTFLOW_SCRIPT}` },
      });
      return;
    }

    const child = spawn(process.execPath, [PORTFLOW_SCRIPT, ...args], {
      cwd: path.dirname(PORTFLOW_SCRIPT),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));

    const timer = setTimeout(() => {
      child.kill();
      resolve({
        status: 504,
        body: {
          ok: false,
          error: `Portflow reageerde niet binnen ${Math.round(PORTFLOW_TIMEOUT_MS / 1000)} seconden`,
        },
      });
    }, PORTFLOW_TIMEOUT_MS);

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ status: 500, body: { ok: false, error: error.message } });
    });

    child.on('close', () => {
      clearTimeout(timer);
      const lines = stdout.trim().split('\n').filter(Boolean);
      let parsed = null;
      try {
        parsed = JSON.parse(lines[lines.length - 1] ?? '{}');
      } catch {
        parsed = null;
      }
      if (!parsed) {
        resolve({
          status: 502,
          body: {
            ok: false,
            error: 'kon het antwoord van de Portflow-brug niet lezen',
            stderr: stderr.trim().slice(-600),
          },
        });
        return;
      }
      resolve({ status: parsed.ok ? 200 : 502, body: { ...parsed, log: stderr.trim().slice(-400) } });
    });
  });
}

async function serveStatic(req, res, urlPath) {
  const rel = urlPath.replace(/^\/+/, '') || 'index.html';
  // Resolve then verify containment so a crafted path cannot escape public/.
  const target = path.resolve(PUBLIC_DIR, rel);
  if (!target.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { ...security.headers(), 'Content-Type': 'text/plain; charset=utf-8' }).end('verboden');
    return;
  }
  try {
    const data = await readFile(target);
    res.writeHead(200, {
      ...security.headers(),
      'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { ...security.headers(), 'Content-Type': 'text/plain; charset=utf-8' }).end('niet gevonden');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const { pathname } = url;

  try {
    /* ── toegangscontrole ─────────────────────────────────────────────────
       Alles onder /api/ is afgeschermd. De pagina zelf is dat niet: die zet
       juist de sessiecookie. */

    if (pathname === '/' || pathname === '') return serveBootstrap(res);

    if (pathname === '/dashboard') {
      security.setCookie(res); // verlengt de sessie bij een herlaadbeurt
      return serveStatic(req, res, 'index.html');
    }

    if (pathname.startsWith('/api/') || pathname.startsWith('/_api/')) {
      const verdict = security.check(req);
      if (!verdict.ok) {
        return sendJson(res, verdict.status, {
          error: verdict.error,
          hint: verdict.hint,
          code: 'DENIED',
        });
      }
    }

    if (pathname === '/api/data') {
      const force = url.searchParams.get('force') === '1';
      return sendJson(res, 200, await getPayload({ force }));
    }

    if (pathname === '/api/state') {
      if (req.method === 'GET') return sendJson(res, 200, await readState());
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const current = await readState();
        const next = {
          ...current,
          notes: body?.notes && typeof body.notes === 'object' ? body.notes : current.notes,
          done: body?.done && typeof body.done === 'object' ? body.done : current.done,
        };
        return sendJson(res, 200, await writeState(next));
      }
      res.writeHead(405).end();
      return;
    }

    if (pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        port: PORT,
        hasCache: Boolean(cache),
        cacheAgeMs: cache ? Date.now() - cache.at : null,
        documents: await docs.stats(),
      });
    }

    /* ── document-inbox ───────────────────────────────────────────────────
       Puur lokaal. Er gaat niets naar Canvas of Portflow vandaan; dit is de
       plek waar je bewijsstukken klaarzet voordat je ze in Portflow sleept. */

    if (pathname === '/api/documents') {
      if (req.method === 'GET') {
        return sendJson(res, 200, { documents: await docs.list(), stats: await docs.stats() });
      }

      if (req.method === 'POST') {
        const body = await readRawBody(req, docs.maxBytes + 1024 * 1024);
        const { fields, file } = parseMultipart(body, req.headers['content-type']);
        if (!file) return sendJson(res, 400, { error: 'geen bestand in de upload gevonden' });
        const doc = await docs.add({
          bytes: file.data,
          filename: file.filename,
          title: fields.title,
          note: fields.note,
          loCodes: fields.loCodes ? fields.loCodes.split(',').map((s) => s.trim()).filter(Boolean) : [],
          assignmentId: fields.assignmentId || null,
          courseId: fields.courseId || null,
        });
        return sendJson(res, 201, { document: doc, stats: await docs.stats() });
      }
      res.writeHead(405, security.headers()).end();
      return;
    }

    // /api/documents/<id>        → PATCH metadata, DELETE
    // /api/documents/<id>/file   → GET the bytes
    const docMatch = pathname.match(/^\/api\/documents\/([\w-]+)(\/file)?$/);
    if (docMatch) {
      const [, id, isFile] = docMatch;

      if (isFile && req.method === 'GET') {
        const found = await docs.filePathFor(id);
        if (!found) return sendJson(res, 404, { error: 'document niet gevonden' });
        const data = await readFile(found.full);
        const type = MIME[path.extname(found.full).toLowerCase()] ?? 'application/octet-stream';
        // Always download rather than render: an uploaded .html must never be
        // served as a page on this origin.
        res.writeHead(200, {
          ...security.headers(),
          'Content-Type': type,
          'Content-Length': data.length,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(found.doc.originalName || found.doc.diskName)}"`,
          'Cache-Control': 'no-store',
        });
        res.end(data);
        return;
      }

      if (req.method === 'PATCH') {
        const patch = await readBody(req);
        const updated = await docs.update(id, patch);
        if (!updated) return sendJson(res, 404, { error: 'document niet gevonden' });
        return sendJson(res, 200, { document: updated, stats: await docs.stats() });
      }

      if (req.method === 'DELETE') {
        const gone = await docs.remove(id);
        return sendJson(res, gone ? 200 : 404, { removed: gone, stats: await docs.stats() });
      }

      res.writeHead(405).end();
      return;
    }

    if (pathname === '/api/reveal' && req.method === 'POST') {
      // Open the inbox in Explorer. No path from the request is used — the
      // folder is a server-side constant, so this cannot reveal arbitrary paths.
      const { error } = await revealInExplorer(docs.dir);
      if (error) return sendJson(res, 500, { error });
      return sendJson(res, 200, { opened: docs.dir });
    }

    /* ── Portflow ─────────────────────────────────────────────────────────
       Praten met Portflow gaat via een echte browser (zie browser/), omdat de
       API een LTI-sessietoken eist dat alleen in de browsercontext bestaat.
       De server start dat script en leest het JSON-resultaat van de laatste
       regel. Er wordt niets geüpload zonder expliciete opdracht. */

    if (pathname === '/api/portflow/collections' && req.method === 'GET') {
      // Een browser starten is duur; rem erop zodat één script dat niet
      // honderd keer achter elkaar kan doen.
      if (!security.rateLimitOk()) {
        security.noteRateLimit();
        return sendJson(res, 429, {
          error: 'Te veel verzoeken in korte tijd. Probeer het over een minuut opnieuw.',
          code: 'RATE_LIMITED',
        });
      }
      const result = await runPortflow(['--list']);
      return sendJson(res, result.status, result.body);
    }

    if (pathname === '/api/portflow/send' && req.method === 'POST') {
      if (!security.rateLimitOk()) {
        security.noteRateLimit();
        return sendJson(res, 429, {
          error: 'Te veel verzoeken in korte tijd. Probeer het over een minuut opnieuw.',
          code: 'RATE_LIMITED',
        });
      }
      const body = await readBody(req);
      const found = await docs.filePathFor(body.documentId);
      if (!found) return sendJson(res, 404, { error: 'document niet gevonden' });
      if (!body.collectionId) return sendJson(res, 400, { error: 'geen collectie gekozen' });

      const args = [
        '--file',
        found.full,
        '--collection',
        String(body.collectionId),
        '--name',
        found.doc.title,
      ];
      // Link the learning outcomes already attached to the document.
      const codes = (found.doc.loCodes ?? [])
        .map((code) => String(code).replace(/^LO\s*/i, ''))
        .filter(Boolean);
      if (codes.length) args.push('--lo', codes.join(','));

      const result = await runPortflow(args);
      if (result.body?.ok) {
        await docs.update(found.doc.id, {
          portflow: {
            evidenceId: result.body.evidenceId,
            collectionId: result.body.collection?.id ?? null,
            collectionName: result.body.collection?.name ?? null,
            sentAt: new Date().toISOString(),
          },
        });
      }
      return sendJson(res, result.status, result.body);
    }

    return serveStatic(req, res, pathname);
  } catch (error) {
    const isToken = error?.code === 'NO_TOKEN';
    const status = error?.status ?? (isToken ? 503 : 502);
    sendJson(res, status, {
      error: error?.message ?? String(error),
      code: error?.code ?? 'UPSTREAM',
      hint: isToken
        ? `Zet CANVAS_TOKEN in ${ENV_FILE}.`
        : status === 502
          ? 'Canvas gaf een fout terug. Probeer opnieuw of controleer je token.'
          : undefined,
    });
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.log('');
    console.log(`  Poort ${PORT} is al in gebruik — er draait waarschijnlijk al een dashboard.`);
    console.log(`  Open gewoon http://${HOST}:${PORT}`);
    console.log('');
    console.log('  Wil je toch een tweede instantie, start dan met een andere poort:');
    console.log(`    node server.mjs --port 8788`);
    console.log('');
    process.exit(0);
  }
  console.error(`serverfout: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const line = '─'.repeat(64);
  console.log(line);
  console.log('  cavascp dashboard');
  console.log(line);
  console.log(`  open dit  http://${HOST}:${PORT}`);
  console.log(`  bron      Canvas @ Fontys ICT (alleen-lezen)`);
  console.log(`  notities  ${path.relative(process.cwd(), STATE_FILE)}`);
  console.log(`  documenten ${path.relative(process.cwd(), path.join(HERE, 'documents'))}`);
  console.log(`  cache     ${Math.round(CACHE_MS / 60_000)} min`);
  console.log(line);
  console.log('  Beveiliging');
  console.log(`    sessiesleutel   ${security.fingerprint}… (alleen deze browser)`);
  console.log('    alleen vanaf    deze machine (127.0.0.1)');
  console.log('    api eist        sessiecookie + eigen oorsprong');
  if (ALLOW_REMOTE) {
    console.log('    LET OP: --allow-remote staat aan; de server is van buiten bereikbaar.');
  }
  console.log(line);
  console.log('  Stop met Ctrl+C');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\ndashboard gestopt');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
