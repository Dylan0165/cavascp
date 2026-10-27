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
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createCanvas, loadEnvFile } from '../mcp/lib/canvas.mjs';
import { ENV_PAD, inProject } from '../mcp/lib/paden.mjs';
import { fetchPortfolioAssignments, buildCriterionCoverage } from '../mcp/lib/analysis.mjs';
import { parseTermCode, currentTermCode, groupBySemester } from '../mcp/lib/semesters.mjs';
import { kravaStatus, kravaProjectenVanSchijf, kravaProjectVanSchijf, startKrava } from '../mcp/lib/krava.mjs';
import { projectNaarDocx } from '../mcp/lib/assemble.mjs';
import { checkDocument, naarPortflowGoalIds, semesterMappen } from '../mcp/lib/leeruitkomsten.mjs';
import { createDocumentStore, parseMultipart } from './lib/documents.mjs';
import * as werkplek from './lib/documenten.mjs';
import { createSecurity } from './lib/security.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const STATE_FILE = path.join(HERE, 'state.json');
// Overridable so tests (and a second instance) can use a scratch inbox instead
// of the real one.
const DOC_DIR = process.env.CAVASCP_DOC_DIR || HERE;
const DOC_INDEX = process.env.CAVASCP_DOC_INDEX || path.join(DOC_DIR, 'documents.json');
/*
 * Het .env-pad komt uit paden.mjs en niet uit een vaste letter. Op een andere
 * machine of schijf — bijvoorbeeld een Linux-mini-pc — bestaat D:/cavascp niet,
 * en dan werkt de server wel maar heeft hij geen token.
 */
const ENV_FILE = ENV_PAD;

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = Number(portArg !== -1 ? args[portArg + 1] : process.env.CAVASCP_PORT || 8787);
const HOST = '127.0.0.1';
const CACHE_MS = Number(process.env.CAVASCP_CACHE_MS ?? 600_000);

/** Alleen met --allow-remote komen er verbindingen van buiten deze machine door. */
const ALLOW_REMOTE = args.includes('--allow-remote');

const docs = createDocumentStore({ dir: DOC_DIR, indexFile: DOC_INDEX });
const security = createSecurity({ port: PORT, allowRemote: ALLOW_REMOTE });

/** Portflow-collecties veranderen zelden; een browserstart is duur. */
let portflowCache = { at: 0, collections: null };
const PORTFLOW_CACHE_MS = Number(process.env.CAVASCP_PORTFLOW_CACHE ?? 10 * 60 * 1000);

/** De mappen met hun inhoud. Duurder dan de collectielijst, dus eigen cache. */
let mappenCache = { at: 0, data: null };

/** De snapshots. Veranderen alleen als je er een maakt of weggooit. */
let snapshotsCache = { at: 0, data: null };

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

/* ─────────────────── semesters: de laag waar alles op rust ─────────────────
   Alle cursussen door elkaar gooien maakt het onleesbaar: een criterium uit
   2024 naast een deadline van volgende week zegt niets. Daarom krijgt elke
   opdracht een semester, en kan de UI per semester filteren.
   ────────────────────────────────────────────────────────────────────────── */

/** Cursus-id → termcode, uit de cursusprofielen. */
let termByCourse = new Map();
let termProfilesAt = 0;
const TERM_CACHE_MS = 15 * 60 * 1000;

/**
 * Haalt de termen op. Gebeurt apart van de hoofdlading, want het kost een extra
 * ronde langs Canvas. Mislukt het, dan werkt de rest gewoon door zonder
 * semester-indeling.
 */
async function refreshTerms(force = false) {
  if (!force && termByCourse.size && Date.now() - termProfilesAt < TERM_CACHE_MS) return;
  try {
    const { canvas } = await canvasClient();
    if (!canvas) return;
    const courses = await canvas.get(
      '/api/v1/courses',
      { per_page: 100, 'include[]': ['term'] },
      { paginate: true },
    );
    const map = new Map();
    for (const c of Array.isArray(courses) ? courses : []) {
      if (!c?.id) continue;
      map.set(c.id, {
        term: c.term?.name ?? null,
        name: c.name,
        code: c.course_code ?? null,
      });
    }
    if (map.size) {
      termByCourse = map;
      termProfilesAt = Date.now();
    }
  } catch {
    /* zonder termen werkt de rest ook; de UI toont dan één groep */
  }
}

function buildPayload(assignments) {
  const now = new Date();
  const nowMs = now.getTime();

  const courses = [...new Map(assignments.map((a) => [a.courseId, a.courseName])).entries()]
    .map(([id, name]) => {
      const meta = termByCourse.get(id);
      const parsed = parseTermCode(meta?.term);
      return {
        id,
        name,
        code: meta?.code ?? null,
        term: meta?.term ?? null,
        termLabel: parsed.label,
        termShort: parsed.short,
        termSortKey: parsed.sortKey,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  /* Elke opdracht krijgt zijn semester, zodat de UI kan filteren zonder de
     cursuslijst te hoeven kennen. */
  const withTerm = assignments.map((a) => {
    const course = courses.find((c) => c.id === a.courseId);
    return {
      ...a,
      term: course?.term ?? null,
      termLabel: course?.termLabel ?? null,
      termShort: course?.termShort ?? null,
      termSortKey: course?.termSortKey ?? -1,
    };
  });

  const currentTerm = currentTermCode(now);
  const currentSortKey = parseTermCode(currentTerm).sortKey;
  const semesters = groupBySemester(
    courses.map((c) => ({
      id: c.id,
      name: c.name,
      term: c.term,
      counts: { portfolioOpen: withTerm.filter((a) => a.courseId === c.id && a.state === 'unsubmitted').length },
    })),
    currentTerm,
  ).map((group) => {
    const items = withTerm.filter((a) => a.term === group.code);
    const coverage = buildCriterionCoverage(items);
    const open = items.filter((a) => a.state === 'unsubmitted');
    return {
      code: group.code,
      label: group.label,
      short: group.short,
      isCurrent: group.isCurrent,
      // Een semester dat nog moet beginnen. Handig voor de UI: je wilt niet
      // standaard in de toekomst kijken.
      isFuture: group.sortKey > currentSortKey,
      sortKey: group.sortKey,
      courseIds: group.courses.map((c) => c.id),
      courses: group.courses.map((c) => ({ id: c.id, name: c.name })),
      stats: {
        assignments: items.length,
        open: open.length,
        submitted: items.length - open.length,
        overdue: open.filter((a) => a.dueAt && Date.parse(a.dueAt) < nowMs).length,
        criteriaTotal: coverage.length,
        criteriaGaps: coverage.filter((c) => c.evidenceCount === 0).length,
        evidence: coverage.reduce((sum, c) => sum + c.evidenceCount, 0),
      },
    };
  });

  return {
    generatedAt: now.toISOString(),
    cached: false,
    currentTerm,
    termsReady: termByCourse.size > 0,
    semesters,
    courses,
    assignments: withTerm,
  };
}

/**
 * De volledige analyse, maar per semester gefilterd.
 *
 * De UI vraagt dit op wanneer je van semester wisselt. Zo blijft het eerste
 * antwoord klein en wordt de zware dekkingsberekening pas gedaan als er echt
 * naar een semester gekeken wordt.
 */
export function payloadForSemester(payload, termCode) {
  const items = payload.assignments.filter((a) => (termCode ? a.term === termCode : true));
  const nowMs = Date.now();

  const open = items.filter((a) => a.state === 'unsubmitted');
  const coverage = buildCriterionCoverage(items);
  const gaps = coverage.filter((c) => c.evidenceCount === 0);
  const upcoming = open
    .filter((a) => a.dueAt && Date.parse(a.dueAt) >= nowMs)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));

  const within = (days) => upcoming.filter((a) => Date.parse(a.dueAt) - nowMs <= days * 86_400_000).length;

  return {
    termCode: termCode ?? null,
    stats: {
      total: items.length,
      open: open.length,
      overdue: open.filter((a) => a.dueAt && Date.parse(a.dueAt) < nowMs).length,
      submitted: items.length - open.length,
      next7: within(7),
      next14: within(14),
      next30: within(30),
      criteriaTotal: coverage.length,
      criteriaCovered: coverage.length - gaps.length,
      criteriaGaps: gaps.length,
    },
    loCodes: [...new Set(items.flatMap((a) => a.loCodes))].sort(
      (a, b) => Number(a.slice(2)) - Number(b.slice(2)),
    ),
    assignments: items,
    coverage: coverage.map((c) => ({
      ...c,
      evidence: c.evidence.slice(0, 12),
      gaps: c.gaps.slice(0, 12),
    })),
  };
}

async function getPayload({ force = false } = {}) {
  await refreshTerms(force);
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

/**
 * Maakt van een willekeurige waarde een geldige HTTP-status.
 *
 * Nodig omdat Node status 0 doorgeeft als een request wordt afgebroken. Zonder
 * deze controle gooit writeHead een RangeError en valt de hele server om — één
 * afgebroken request hoort nooit het dashboard te laten crashen.
 */
function safeStatus(value, fallback = 500) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 100 && n <= 599 ? n : fallback;
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  const text = JSON.stringify(body);
  res.writeHead(safeStatus(status), {
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
  /*
   * Een afgebroken verbinding is geen fout van ons.
   *
   * Zonder deze twee regels belandt een afgebroken request in de catch hieronder
   * en crasht de server op `Invalid status code: 0` — één gesloten tabblad zou
   * dan het hele dashboard omver halen.
   */
  req.on('error', () => {});
  res.on('error', () => {});

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
      const payload = await getPayload({ force });
      const term = url.searchParams.get('term');

      // Zonder term: alleen het lichte overzicht met de semesters. De zware
      // dekkinsberekening volgt pas als er een semester gekozen is.
      if (!term) {
        return sendJson(res, 200, {
          generatedAt: payload.generatedAt,
          cached: payload.cached,
          cacheAgeMs: payload.cacheAgeMs,
          currentTerm: payload.currentTerm,
          termsReady: payload.termsReady,
          semesters: payload.semesters,
          courses: payload.courses,
          documentStats: payload.documentStats,
        });
      }

      return sendJson(res, 200, {
        generatedAt: payload.generatedAt,
        cached: payload.cached,
        currentTerm: payload.currentTerm,
        termsReady: payload.termsReady,
        semesters: payload.semesters,
        courses: payload.courses,
        documentStats: payload.documentStats,
        ...payloadForSemester(payload, term),
      });
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

    /* ── Documenten ───────────────────────────────────────────────────────
       Een eigen documentwerkplek in het dashboard. De generator komt uit Krava
       (zie mcp/lib/docx.mjs en assemble.mjs), maar dit is geen verwijzing naar
       Krava: het is een eigen werkplek met eigen opslag. Krava blijft een los
       project en hoeft niet te draaien. */

    /*
     * Waar hoort een document uit de inbox?
     *
     * Dit is de automatiseringslaag: leest het bestand, bepaalt de map, de
     * leeruitkomsten en een toelichting, en zegt wat er daarna nog mist. Er
     * wordt niets verstuurd — het is een voorstel.
     */
    if (pathname.startsWith('/api/documenten/inbox/') && pathname.endsWith('/indelen') && req.method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/api/documenten/inbox/'.length, -'/indelen'.length));
      const found = await docs.filePathFor(id);
      if (!found) return sendJson(res, 404, { error: 'document niet gevonden' });

      const { tekstUitBestand } = await import('../mcp/lib/tekst.mjs');
      const { analyseerVoorInleveren } = await import('../mcp/lib/indeler.mjs');
      const { zonderOpmaakrommel } = await import('./lib/documenten.mjs');

      const gelezen = tekstUitBestand(found.full);
      /*
       * De opmaakregels eruit voordat we iets met de tekst doen. Anders komt de
       * regel met het TOC-veld in de voorgestelde toelichting terecht.
       */
      const tekst = zonderOpmaakrommel(gelezen.tekst);
      const titel = found.doc.title ?? path.basename(found.full);

      /* De huidige dekking van de mappen ophalen, zodat "wat mist er" klopt. */
      let mappen = null;
      try {
        const vers = url.searchParams.get('force') === '1';
        let data = mappenCache.data;
        if (vers || !data) {
          const result = await runPortflow(['--mappen']);
          if (result.body?.ok) {
            mappenCache = { at: Date.now(), data: result.body };
            data = result.body;
          }
        }
        mappen = data?.mappen?.map((m) => ({
          naam: m.naam,
          id: m.id,
          gedekt: m.gedekt ?? [],
          bewijs: m.bewijs ?? [],
        })) ?? null;
      } catch {
        /* zonder dekking wordt het voorstel grover, maar het werkt */
      }

      const uit = analyseerVoorInleveren({
        titel,
        bestandsnaam: path.basename(found.full),
        tekst,
        beschrijving: found.doc.note ?? '',
        mappen,
      });

      return sendJson(res, 200, {
        document: { id: found.doc.id, titel, bestandsnaam: path.basename(found.full), bytes: found.doc.size },
        tekst: {
          gelukt: gelezen.gelukt,
          soort: gelezen.soort,
          tekens: gelezen.tekens,
          // Het aantal tekens dat overblijft na het weghalen van de opmaak.
          bruikbaar: tekst.length,
          reden: gelezen.reden ?? null,
          begin: tekst.slice(0, 300),
        },
        voorstel: uit.voorstel,
        alternatieven: uit.alternatieven,
        leeruitkomsten: uit.leeruitkomsten,
        aanbevolenLeeruitkomsten: uit.aanbevolenLeeruitkomsten,
        voorgesteldeBeschrijving: uit.voorgesteldeBeschrijving,
        onzeker: uit.onzeker,
        uitleg: uit.uitleg,
        alle: uit.alle,
      });
    }

    if (pathname === '/api/documenten' && req.method === 'GET') {
      return sendJson(res, 200, { documenten: werkplek.lijst() });
    }

    if (pathname === '/api/documenten' && req.method === 'POST') {
      let body = {};
      try {
        body = await readBody(req);
      } catch {
        body = {};
      }
      const document = werkplek.bewaar(werkplek.leegDocument(body));
      return sendJson(res, 201, { document });
    }

    /* Een Krava-project overnemen. Zo krijg je werk dat al in Krava staat hier
       verder af, zonder dat de twee projecten aan elkaar vast zitten. */
    if (pathname === '/api/documenten/van-krava' && req.method === 'POST') {
      let body = {};
      try {
        body = await readBody(req);
      } catch {
        body = {};
      }
      const projectId = body.projectId;
      if (!projectId) return sendJson(res, 400, { error: 'geen projectId opgegeven' });
      try {
        const gevonden = await kravaProjectVanSchijf(projectId);
        const document = werkplek.neemOver(gevonden.project);
        return sendJson(res, 201, { document, van: gevonden.titel });
      } catch (error) {
        return sendJson(res, 404, { error: error.message });
      }
    }

    if (pathname.startsWith('/api/documenten/')) {
      const rest = pathname.slice('/api/documenten/'.length);
      const [id, actie] = rest.split('/');
      const documentId = decodeURIComponent(id ?? '');

      if (actie === 'docx' && req.method === 'GET') {
        const document = werkplek.lees(documentId);
        if (!document) return sendJson(res, 404, { error: 'document niet gevonden' });
        try {
          const uit = projectNaarDocx(document);
          const naam = uit.filename.replace(/[^\p{L}\p{N}._-]/gu, '_');
          res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `attachment; filename="${naam}"`,
            'Content-Length': uit.buffer.length,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          return res.end(uit.buffer);
        } catch (error) {
          return sendJson(res, 400, { error: `Word maken mislukt: ${error.message}` });
        }
      }

      if (actie === 'leeruitkomsten' && req.method === 'GET') {
        const document = werkplek.lees(documentId);
        if (!document) return sendJson(res, 404, { error: 'document niet gevonden' });
        const tekst = (document.plan?.secties || [])
          .map((s) => `${s.titel}\n${s.tekst || ''}`)
          .join('\n\n');
        const uit = checkDocument({ titel: document.titel, tekst, beschrijving: document.brief });
        return sendJson(res, 200, {
          uitleg: uit.uitleg,
          onzeker: uit.onzeker,
          signaalSterkte: uit.signaalSterkte,
          treffers: uit.treffers.map((t) => ({
            code: t.code,
            naam: t.naam,
            relatief: t.relatief,
            begrippen: t.begrippen,
            portflowGoalId: t.portflowGoalId,
          })),
          // Welke Portflow-doelen hieruit volgen, klaar om te koppelen.
          portflowGoalIds: naarPortflowGoalIds(uit.treffers),
        });
      }

      /* De mappen van dit semester, met hun Portflow-id. */
      if (actie === 'mappen' && req.method === 'GET') {
        return sendJson(res, 200, { mappen: semesterMappen() });
      }

      /*
       * Inleveren bij Portflow.
       *
       * De hele keten in één aanroep: het document wordt een Word-bestand, dat
       * gaat naar de gekozen map, en de leeruitkomsten die de check vindt worden
       * als doelen gekoppeld.
       *
       * De doel-id's komen uit data/lo-koppeling.json, niet uit een naam-match.
       * Portflow heeft "Professional Standard" vier keer; op naam koppelen zet
       * je bewijs aan het doel van een vorig semester.
       */
      if (actie === 'inleveren' && req.method === 'POST') {
        const document = werkplek.lees(documentId);
        if (!document) return sendJson(res, 404, { error: 'document niet gevonden' });

        let body = {};
        try {
          body = await readBody(req);
        } catch {
          return sendJson(res, 400, { error: 'ongeldige JSON' });
        }

        const collectionId = Number(body.collectionId);
        if (!collectionId) return sendJson(res, 400, { error: 'geen map gekozen' });

        if (!security.rateLimitOk()) {
          security.noteRateLimit();
          return sendJson(res, 429, {
            error: 'Te veel verzoeken in korte tijd. Probeer het over een minuut opnieuw.',
            code: 'RATE_LIMITED',
          });
        }

        /* Welke leeruitkomsten? Zelf opgegeven, of door de check bepaald. */
        const tekst = (document.plan?.secties || []).map((s) => `${s.titel}\n${s.tekst || ''}`).join('\n\n');
        const analyse = checkDocument({ titel: document.titel, tekst, beschrijving: document.brief });
        const gevondenIds = naarPortflowGoalIds(analyse.treffers);
        const zelfGekozen = Array.isArray(body.goalIds) && body.goalIds.length > 0;
        const goalIds = zelfGekozen
          ? body.goalIds.map(Number).filter((n) => Number.isFinite(n))
          : gevondenIds;

        /* Het document naar Word, op een tijdelijke plek. */
        let doc;
        try {
          doc = projectNaarDocx(document);
        } catch (error) {
          return sendJson(res, 400, { error: `Word maken mislukt: ${error.message}` });
        }

        werkplek.zorgVoorTijdelijk();
        const tijdelijk = path.join(werkplek.TIJDELIJK, `${document.id}.docx`);
        try {
          writeFileSync(tijdelijk, doc.buffer);
        } catch (error) {
          return sendJson(res, 500, { error: `tijdelijk bestand schrijven mislukt: ${error.message}` });
        }

        const args = [
          '--file',
          tijdelijk,
          '--collection',
          String(collectionId),
          '--name',
          String(body.naam || document.titel || 'Document').slice(0, 120),
        ];
        if (goalIds.length) args.push('--goal-ids', goalIds.join(','));
        const toelichting = String(body.toelichting || document.brief || '').slice(0, 2000);
        if (toelichting) args.push('--description', toelichting);

        const result = await runPortflow(args);

        // Het tijdelijke bestand mag weg; Portflow heeft het nu.
        try {
          rmSync(tijdelijk, { force: true });
        } catch {
          /* niet erg */
        }

        /*
         * Alleen een geslaagde upload vastleggen. Een mislukte poging is geen
         * inlevering en hoort niet in de geschiedenis te staan.
         */
        if (result.body?.ok && result.body?.evidenceId) {
          werkplek.noteerInlevering(document.id, {
            mapId: collectionId,
            mapNaam: result.body.collection?.name ?? null,
            bewijsId: result.body.evidenceId,
            bestandsnaam: doc.filename,
            bytes: doc.buffer.length,
            goalIds,
            leeruitkomsten: analyse.treffers.map((t) => ({ code: t.code, naam: t.naam })),
            toelichting,
          });
        }

        return sendJson(res, result.status, {
          ...result.body,
          geleverd: {
            document: document.titel,
            bestandsnaam: doc.filename,
            bytes: doc.buffer.length,
            secties: doc.statistiek?.secties ?? null,
          },
          leeruitkomsten: {
            gevonden: analyse.treffers.map((t) => ({ code: t.code, naam: t.naam, relatief: t.relatief })),
            gebruikt: goalIds,
            zelfGekozen,
            uitleg: analyse.uitleg,
          },
        });
      }

      if (actie === undefined) {
        if (req.method === 'GET') {
          const document = werkplek.lees(documentId);
          if (!document) return sendJson(res, 404, { error: 'document niet gevonden' });
          return sendJson(res, 200, { document });
        }
        if (req.method === 'PUT') {
          const bestaand = werkplek.lees(documentId);
          if (!bestaand) return sendJson(res, 404, { error: 'document niet gevonden' });
          let body = {};
          try {
            body = await readBody(req);
          } catch {
            return sendJson(res, 400, { error: 'ongeldige JSON' });
          }
          // Het id ligt vast; de rest mag overschreven worden.
          const bijgewerkt = werkplek.bewaar({ ...bestaand, ...body, id: bestaand.id });
          return sendJson(res, 200, { document: bijgewerkt });
        }
        if (req.method === 'DELETE') {
          const weg = werkplek.verwijder(documentId);
          return sendJson(res, weg ? 200 : 404, { removed: weg });
        }
      }
    }

    if (pathname === '/api/krava' && req.method === 'GET') {
      /*
       * Krava is een LOS project. We laten alleen zien of het er is, zodat je
       * het kunt openen als je het nodig hebt — niet om er iets van af te
       * hangen. De projectenlijst is er zodat je ze kunt overnemen.
       */
      const status = await kravaStatus();
      const projecten = await kravaProjectenVanSchijf();
      return sendJson(res, 200, {
        installed: status.installed,
        running: status.running,
        loginRequired: Boolean(status.loginRequired),
        appUrl: status.appUrl ?? null,
        dir: status.dir ?? null,
        error: status.error ?? null,
        projects: projecten.map((p) => ({
          id: p.id,
          titel: p.titel,
          vak: p.vak,
          documenttype: p.documenttype,
          bijgewerkt: p.bijgewerkt,
          tekens: p.tekens,
          secties: p.secties,
        })),
      });
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

    /*
     * De mappen van dit semester met hun inhoud, en per map welke
     * leeruitkomsten gedekt zijn.
     *
     * Dit is wat de Portflow-tab toont. De gegevens komen uit het
     * portfolio-freezes-endpoint van Portflow: dat is het enige dat bewijs MET
     * zijn doelen teruggeeft. Het gewone collectie-endpoint geeft alleen de
     * stukken, zonder koppelingen, en dan kun je niets over dekking zeggen.
     */
    if (pathname === '/api/portflow/mappen' && req.method === 'GET') {
      const nu = Date.now();
      const vers = url.searchParams.get('force') === '1';
      if (!vers && mappenCache.data && nu - mappenCache.at < PORTFLOW_CACHE_MS) {
        return sendJson(res, 200, { ...mappenCache.data, cached: true, cacheAgeMs: nu - mappenCache.at });
      }

      const result = await runPortflow(['--mappen']);
      if (result.body?.ok) {
        mappenCache = { at: Date.now(), data: result.body };
        return sendJson(res, 200, { ...result.body, cached: false });
      }
      // Liever iets ouds dan niets.
      if (mappenCache.data) {
        return sendJson(res, 200, {
          ...mappenCache.data,
          cached: true,
          stale: true,
          warning: result.body?.error ?? 'Portflow was niet bereikbaar; dit is de vorige lijst.',
        });
      }
      return sendJson(res, result.status, result.body);
    }

    /*
     * De leeswijzer als beschrijving van een map zetten.
     *
     * Dit is wat de docent in Portflow leest, dus het is de moeite van een eigen
     * endpoint waard. De bestaande beschrijving wordt overschreven — de UI
     * vraagt daar bevestiging voor.
     */
    if (pathname === '/api/portflow/beschrijving' && req.method === 'POST') {
      let body = {};
      try {
        body = await readBody(req);
      } catch {
        return sendJson(res, 400, { error: 'ongeldige JSON' });
      }
      const collectionId = Number(body.collectionId);
      const tekst = String(body.tekst ?? '');
      if (!collectionId) return sendJson(res, 400, { error: 'geen map opgegeven' });
      if (!tekst) return sendJson(res, 400, { error: 'geen tekst opgegeven' });

      if (!security.rateLimitOk()) {
        security.noteRateLimit();
        return sendJson(res, 429, {
          error: 'Te veel verzoeken in korte tijd. Probeer het over een minuut opnieuw.',
          code: 'RATE_LIMITED',
        });
      }

      /* De tekst gaat via een tijdelijk bestand mee: op de opdrachtregel zou
         hij te lang worden en er zitten regeleinden in. */
      werkplek.zorgVoorTijdelijk();
      const tijdelijk = path.join(werkplek.TIJDELIJK, `beschrijving-${collectionId}.txt`);
      try {
        writeFileSync(tijdelijk, tekst, 'utf8');
      } catch (error) {
        return sendJson(res, 500, { error: `tijdelijk bestand schrijven mislukt: ${error.message}` });
      }

      const result = await runPortflow([
        '--beschrijving',
        '--collection',
        String(collectionId),
        '--tekst-bestand',
        tijdelijk,
      ]);

      try {
        rmSync(tijdelijk, { force: true });
      } catch {
        /* niet erg */
      }

      // De gecachte mappen zijn nu verouderd.
      mappenCache = { at: 0, data: null };
      return sendJson(res, result.status, result.body);
    }

    /*
     * De snapshots van dit portfolio.
     *
     * Een snapshot is een bevriezing: je kunt hem niet meer aanpassen, alleen
     * bekijken of verwijderen. Handig om te zien wat je wanneer hebt ingeleverd,
     * en om te controleren of er geen test-snapshot is blijven staan.
     */
    if (pathname === '/api/portflow/snapshots' && req.method === 'GET') {
      const nu = Date.now();
      const vers = url.searchParams.get('force') === '1';
      if (!vers && snapshotsCache.data && nu - snapshotsCache.at < PORTFLOW_CACHE_MS) {
        return sendJson(res, 200, { ...snapshotsCache.data, cached: true, cacheAgeMs: nu - snapshotsCache.at });
      }
      const result = await runPortflow(['--snapshots']);
      if (result.body?.ok) {
        snapshotsCache = { at: Date.now(), data: result.body };
        return sendJson(res, 200, { ...result.body, cached: false });
      }
      if (snapshotsCache.data) {
        return sendJson(res, 200, {
          ...snapshotsCache.data,
          cached: true,
          stale: true,
          warning: result.body?.error ?? 'Portflow was niet bereikbaar; dit is de vorige lijst.',
        });
      }
      return sendJson(res, result.status, result.body);
    }

    if (pathname === '/api/portflow/collections' && req.method === 'GET') {
      /*
       * Collecties veranderen zelden, en een browser starten is duur. We
       * bewaren ze daarom een tijdje: scheelt tijd én het houdt de rem op
       * dure routes vrij voor het echte werk (versturen).
       */
      const now = Date.now();
      const fresh = url.searchParams.get('force') === '1';
      if (!fresh && portflowCache.collections && now - portflowCache.at < PORTFLOW_CACHE_MS) {
        return sendJson(res, 200, {
          ...portflowCache.collections,
          cached: true,
          cacheAgeMs: now - portflowCache.at,
        });
      }

      if (!security.rateLimitOk()) {
        security.noteRateLimit();
        return sendJson(res, 429, {
          error: 'Te veel verzoeken in korte tijd. Probeer het over een minuut opnieuw.',
          code: 'RATE_LIMITED',
        });
      }
      const result = await runPortflow(['--list']);
      if (result.body?.ok) {
        portflowCache = { at: Date.now(), collections: result.body };
      } else if (portflowCache.collections) {
        // Liever iets oud dan niets: geef de vorige lijst terug met een noot.
        return sendJson(res, 200, {
          ...portflowCache.collections,
          cached: true,
          stale: true,
          cacheAgeMs: Date.now() - portflowCache.at,
          warning: result.body?.error ?? 'Portflow was niet bereikbaar; dit is de vorige lijst.',
        });
      }
      return sendJson(res, result.status, { ...result.body, cached: false });
    }

    if (pathname === '/api/portflow/send' && req.method === 'POST') {
      // Versturen is het echte werk: daar is de rem voor bedoeld.
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
    // Verbinding verbroken: er is niemand meer om het antwoord aan te geven.
    if (error?.code === 'ECONNRESET' || error?.code === 'EPIPE' || res.writableEnded) {
      return;
    }
    const isToken = error?.code === 'NO_TOKEN';
    // safeStatus vangt onder meer de status 0 van een afgebroken request op.
    const status = safeStatus(error?.status, isToken ? 503 : 502);
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
