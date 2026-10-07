#!/usr/bin/env node
/**
 * cavascp — read-only MCP server voor Canvas @ Fontys ICT.
 *
 * Doel: één plek waar je portfolio-werk samenkomt. Welke portfolio-opdrachten
 * lopen er, wat is de deadline, welke beoordelingscriteria moet je aantonen en
 * waar heb je daar al bewijs voor ingeleverd.
 *
 * Bewust read-only: er is geen tool die iets inlevert, wijzigt of verwijdert.
 *
 * Geen externe afhankelijkheden — het MCP-protocol is hier direct op stdio
 * geïmplementeerd, zodat de server zonder npm install en zonder netwerk start.
 *
 * Config via env:
 *   CANVAS_TOKEN      verplicht (of aanwezig in CANVAS_ENV_FILE)
 *   CANVAS_BASE_URL   default https://fhict.instructure.com
 *   CANVAS_ENV_FILE   default D:/cavascp/.env
 *   CAVASCP_CACHE_MS  default 600000 (10 minuten)
 */

import { createCanvas, loadEnvFile, CanvasError } from './lib/canvas.mjs';
import {
  fetchPortfolioAssignments,
  buildCriterionCoverage,
  bucketByTime,
  compareByDue,
  isOpen,
} from './lib/analysis.mjs';

const SERVER_NAME = 'cavascp';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_ENV_FILE = 'D:/cavascp/.env';

/* ────────────────────────────── formatting ─────────────────────────────── */

const fmtDate = (iso) => (iso ? String(iso).slice(0, 10) : '—');
const fmtDateTime = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '—');
const stateLabel = (state) =>
  ({ unsubmitted: 'open', submitted: 'ingediend', graded: 'beoordeeld' })[state] || state;

function relativeDays(iso, now = new Date()) {
  if (!iso) return '';
  const days = Math.round((Date.parse(iso) - now.getTime()) / 86_400_000);
  if (days === 0) return 'vandaag';
  if (days === 1) return 'morgen';
  if (days === -1) return 'gisteren';
  return days > 0 ? `over ${days} dagen` : `${-days} dagen geleden`;
}

function escapePipes(value) {
  return String(value ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

function mdTable(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `|${headers.map(() => '---').join('|')}|`;
  const body = rows.map((r) => `| ${r.map(escapePipes).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

/* ──────────────────────────────── data ─────────────────────────────────── */

const cacheMs = Number(process.env.CAVASCP_CACHE_MS ?? 600_000);
let bundle = null; // { at: number, assignments: [] }

async function canvasClient() {
  let token = process.env.CANVAS_TOKEN;
  let baseUrl = process.env.CANVAS_BASE_URL;
  if (!token || !baseUrl) {
    const envFile = process.env.CANVAS_ENV_FILE || DEFAULT_ENV_FILE;
    const fromFile = await loadEnvFile(envFile);
    token = token || fromFile.CANVAS_TOKEN;
    baseUrl = baseUrl || fromFile.CANVAS_BASE_URL;
  }
  return createCanvas({ baseUrl, token });
}

/** All portfolio assignments, cached briefly because a single call fans out per course. */
async function getAssignments({ force = false } = {}) {
  const now = Date.now();
  if (!force && bundle && now - bundle.at < cacheMs) return bundle.assignments;
  const canvas = await canvasClient();
  const assignments = await fetchPortfolioAssignments(canvas);
  bundle = { at: now, assignments };
  return assignments;
}

function cacheNote() {
  if (!bundle) return '';
  const ageMin = Math.round((Date.now() - bundle.at) / 60_000);
  return `\n_Data van ${ageMin} min geleden. Gebruik \`force: true\` om te verversen._`;
}

/* ──────────────────────────────── tools ────────────────────────────────── */

const TOOLS = [
  {
    name: 'portfolio_status',
    description:
      'Overzicht van alle portfolio-opdrachten in je Canvas-account: wat open staat, wat verlopen is, ' +
      'wat is ingeleverd en wat beoordeeld. Gebruik dit als startpunt voor "waar sta ik".',
    inputSchema: {
      type: 'object',
      properties: {
        only_open: { type: 'boolean', description: 'Alleen opdrachten die nog open staan (default false).' },
        course: { type: 'string', description: 'Filter op cursusnaam of cursus-id (deelstring).' },
        force: { type: 'boolean', description: 'Cache negeren en opnieuw ophalen bij Canvas.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'deadline_radar',
    description:
      'Portfolio-deadlines op tijdlijn: wat is verlopen, wat komt eraan (met de rubric-eisen erbij), ' +
      'en wat heeft geen deadline. Standaard alleen wat nog open staat.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Hoeveel dagen vooruit kijken (default 60).' },
        include_overdue: { type: 'boolean', description: 'Ook verlopen deadlines tonen (default true).' },
        force: { type: 'boolean', description: 'Cache negeren.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'criteria_coverage',
    description:
      'Per beoordelingscriterium (rubric) uit je portfolio-opdrachten: is er al bewijs voor ingeleverd of ' +
      'is het nog een gat? Gerangschikt op de grootste gaten. Dit is de kern van "wat mist mijn portfolio".',
    inputSchema: {
      type: 'object',
      properties: {
        only_gaps: { type: 'boolean', description: 'Alleen criteria zonder enig bewijs (default false).' },
        course: { type: 'string', description: 'Filter op cursusnaam of cursus-id (deelstring).' },
        lo: { type: 'string', description: 'Filter op leeruitkomst-code, bijvoorbeeld "LO2".' },
        force: { type: 'boolean', description: 'Cache negeren.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'evidence_for',
    description:
      'Zoek het bewijs dat je al hebt ingeleverd: per criterium, leeruitkomst of cursus. Toont per stuk ' +
      'de status, beoordeling en de bestandsnamen van wat je hebt geüpload.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Vrije tekst om te matchen op criterium, opdrachtnaam of cursus.' },
        lo: { type: 'string', description: 'Leeruitkomst-code, bijvoorbeeld "LO3".' },
        course: { type: 'string', description: 'Filter op cursusnaam of cursus-id (deelstring).' },
        force: { type: 'boolean', description: 'Cache negeren.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'assignment_detail',
    description:
      'Volledige details van één portfolio-opdracht: omschrijving, alle rubric-criteria met niveaus, ' +
      'deadline en je huidige inleverstatus. Zoek op (deel van) de opdrachtnaam.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Deel van de opdrachtnaam (case-insensitive).' },
        course: { type: 'string', description: 'Beperk tot een cursus (naam of id, deelstring).' },
        force: { type: 'boolean', description: 'Cache negeren.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'canvas_whoami',
    description:
      'Controleer of de Canvas-koppeling werkt: toont je account, het aantal cursussen en of de token geldig is.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function filterByCourse(items, course) {
  if (!course) return items;
  const needle = String(course).toLowerCase();
  return items.filter(
    (item) =>
      String(item.courseId).includes(needle) || String(item.courseName).toLowerCase().includes(needle),
  );
}

function assignmentRow(item, now = new Date()) {
  const rel = item.dueAt ? relativeDays(item.dueAt, now) : 'geen deadline';
  return [fmtDate(item.dueAt), item.name, item.courseName, stateLabel(item.state), rel];
}

async function toolPortfolioStatus(args) {
  const all = await getAssignments({ force: args.force });
  const filtered = filterByCourse(all, args.course);
  const open = filtered.filter(isOpen);
  const shown = args.only_open ? open : filtered;
  const { overdue, upcoming, undated } = bucketByTime(open);

  const lines = [];
  lines.push(`# Portfolio-status`);
  lines.push('');
  lines.push(
    `**${filtered.length}** portfolio-opdrachten · **${open.length}** open ` +
      `(${upcoming.length} met deadline, ${overdue.length} verlopen, ${undated.length} zonder deadline) · ` +
      `**${filtered.length - open.length}** ingeleverd of beoordeeld`,
  );
  if (upcoming.length) {
    lines.push('');
    lines.push(`Eerstvolgende: **${upcoming[0].name}** op ${fmtDate(upcoming[0].dueAt)} (${relativeDays(upcoming[0].dueAt)}).`);
  }
  lines.push('');

  if (!shown.length) {
    lines.push('_Geen portfolio-opdrachten gevonden voor dit filter._');
  } else {
    lines.push(mdTable(['Deadline', 'Opdracht', 'Cursus', 'Status', 'T.o.v. nu'], shown.map((i) => assignmentRow(i))));
  }

  if (overdue.length) {
    lines.push('');
    lines.push(`## Verlopen maar nog open (${overdue.length})`);
    lines.push('');
    for (const item of overdue) {
      lines.push(`- **${item.name}** — ${item.courseName} — was ${fmtDate(item.dueAt)} (${relativeDays(item.dueAt)})`);
    }
  }
  lines.push(cacheNote());
  return lines.join('\n');
}

async function toolDeadlineRadar(args) {
  const all = await getAssignments({ force: args.force });
  const now = new Date();
  const days = Number.isFinite(args.days) ? Number(args.days) : 60;
  const horizon = new Date(now.getTime() + days * 86_400_000);
  const includeOverdue = args.include_overdue !== false;
  const open = all.filter(isOpen);

  const overdue = open.filter((i) => i.dueAt && Date.parse(i.dueAt) < now.getTime()).sort(compareByDue());
  const soon = open
    .filter((i) => i.dueAt && Date.parse(i.dueAt) >= now.getTime() && Date.parse(i.dueAt) <= horizon.getTime())
    .sort(compareByDue());
  const undated = open.filter((i) => !i.dueAt);

  const lines = [];
  lines.push(`# Deadline-radar`);
  lines.push('');
  lines.push(`Peildatum ${fmtDateTime(now.toISOString())} · horizon ${days} dagen · alleen wat nog open staat.`);

  if (includeOverdue && overdue.length) {
    lines.push('');
    lines.push(`## Verlopen (${overdue.length})`);
    lines.push('');
    for (const item of overdue) {
      lines.push(`- **${fmtDate(item.dueAt)}** (${relativeDays(item.dueAt, now)}) — ${item.name} — ${item.courseName}`);
    }
  }

  lines.push('');
  lines.push(`## Komt eraan (${soon.length})`);
  lines.push('');
  if (!soon.length) {
    lines.push(`_Geen open portfolio-deadlines binnen ${days} dagen._`);
  } else {
    for (const item of soon) {
      lines.push(`### ${item.name}`);
      lines.push('');
      lines.push(
        `- **Deadline**: ${fmtDate(item.dueAt)} (${relativeDays(item.dueAt, now)}) · ${item.courseName} (id ${item.courseId})`,
      );
      lines.push(`- **Inlevervorm**: ${item.submissionTypes.join(', ') || '—'}`);
      if (item.htmlUrl) lines.push(`- **Canvas**: ${item.htmlUrl}`);
      if (item.rubric.length) {
        lines.push(`- **Wat je moet aantonen (${item.rubric.length} criteria)**:`);
        for (const criterion of item.rubric) {
          const codes = criterion.loCodes.length ? ` _(${criterion.loCodes.join(', ')})_` : '';
          lines.push(`  - ${criterion.description}${codes}`);
        }
      }
      if (item.description) {
        const first = item.description.split('\n').filter(Boolean).slice(0, 3).join(' ');
        lines.push(`- **Kort**: ${first.slice(0, 260)}${first.length > 260 ? '…' : ''}`);
      }
      lines.push('');
    }
  }

  if (undated.length) {
    lines.push('');
    lines.push(`## Open zonder deadline (${undated.length})`);
    lines.push('');
    for (const item of undated) lines.push(`- ${item.name} — ${item.courseName}`);
  }
  lines.push(cacheNote());
  return lines.join('\n');
}

async function toolCriteriaCoverage(args) {
  const all = await getAssignments({ force: args.force });
  const scoped = filterByCourse(all, args.course);
  let coverage = buildCriterionCoverage(scoped);
  if (args.lo) {
    const needle = String(args.lo).toUpperCase().replace(/\s+/g, '');
    coverage = coverage.filter((c) => c.loCodes.some((code) => code.toUpperCase() === needle));
  }
  if (args.only_gaps) coverage = coverage.filter((c) => c.evidenceCount === 0);

  const gaps = coverage.filter((c) => c.evidenceCount === 0);
  const covered = coverage.filter((c) => c.evidenceCount > 0);

  const lines = [];
  lines.push('# Criteria-dekking');
  lines.push('');
  lines.push(
    `**${coverage.length}** criteria in beeld · **${covered.length}** met bewijs · **${gaps.length}** zonder bewijs`,
  );
  lines.push('');

  if (gaps.length) {
    lines.push(`## Nog geen bewijs (${gaps.length})`);
    lines.push('');
    lines.push(
      mdTable(
        ['Criterium', 'LO', 'Cursus', 'Open opdrachten'],
        gaps.map((c) => [c.label, c.loCodes.join(', ') || '—', c.courses.join(' / '), c.gapCount]),
      ),
    );
    lines.push('');
  }

  if (covered.length) {
    lines.push(`## Bewijs aanwezig (${covered.length})`);
    lines.push('');
    lines.push(
      mdTable(
        ['Criterium', 'LO', 'Status', 'Bewijs', 'Nog open'],
        covered.map((c) => [c.label, c.loCodes.join(', ') || '—', c.status, c.evidenceCount, c.gapCount]),
      ),
    );
    lines.push('');
    const notGraded = covered.filter((c) => c.status !== 'beoordeeld');
    if (notGraded.length) {
      lines.push(
        `> Let op: ${notGraded.length} criteria zijn wel ingeleverd maar nog niet beoordeeld. ` +
          'Ingeleverd is niet hetzelfde als aangetoond.',
      );
      lines.push('');
    }
  }

  if (!coverage.length) lines.push('_Geen criteria gevonden voor dit filter._');
  lines.push(cacheNote());
  return lines.join('\n');
}

async function toolEvidenceFor(args) {
  const all = await getAssignments({ force: args.force });
  const scoped = filterByCourse(all, args.course);
  const needle = args.query ? String(args.query).toLowerCase() : null;
  const loNeedle = args.lo ? String(args.lo).toUpperCase().replace(/\s+/g, '') : null;

  const matches = scoped.filter((item) => {
    if (loNeedle && !item.loCodes.some((code) => code.toUpperCase() === loNeedle)) return false;
    if (!needle) return true;
    const haystack = [
      item.name,
      item.courseName,
      item.description,
      ...item.rubric.map((c) => c.description),
      ...item.attachments.map((a) => a.displayName),
    ]
      .join('\n')
      .toLowerCase();
    return haystack.includes(needle);
  });

  const withEvidence = matches.filter((i) => i.state !== 'unsubmitted');
  const lines = [];
  lines.push('# Bewijs');
  lines.push('');
  lines.push(
    `Zoekopdracht: ${args.query ? `"${args.query}"` : '(alles)'}${args.lo ? ` · LO ${args.lo}` : ''}` +
      `${args.course ? ` · cursus "${args.course}"` : ''}`,
  );
  lines.push('');
  lines.push(`**${matches.length}** opdrachten gevonden · **${withEvidence.length}** met ingeleverd werk.`);
  lines.push('');

  if (!matches.length) {
    lines.push('_Niets gevonden. Probeer een ruimere zoekterm of laat het filter weg._');
    lines.push(cacheNote());
    return lines.join('\n');
  }

  for (const item of matches.sort(compareByDue())) {
    const marker = item.state === 'unsubmitted' ? '·' : item.state === 'graded' ? '✓' : '+';
    lines.push(`### ${marker} ${item.name}`);
    lines.push('');
    lines.push(
      `- **Cursus**: ${item.courseName} (id ${item.courseId})` +
        `${item.loCodes.length ? ` · **LO**: ${item.loCodes.join(', ')}` : ''}`,
    );
    lines.push(
      `- **Status**: ${stateLabel(item.state)}` +
        `${item.submittedAt ? ` op ${fmtDate(item.submittedAt)}` : ''}` +
        `${item.grade != null ? ` · beoordeling ${item.grade}` : ''}` +
        `${item.late ? ' · ⚠️ te laat' : ''}`,
    );
    lines.push(`- **Deadline**: ${fmtDate(item.dueAt)}`);
    if (item.attachments.length) {
      lines.push('- **Ingediend bewijs**:');
      for (const att of item.attachments) {
        const kb = att.size ? ` (${Math.round(att.size / 1024)} kB)` : '';
        lines.push(`  - ${att.displayName}${kb}`);
      }
    }
    if (item.rubric.length) {
      lines.push(`- **Criteria**: ${item.rubric.map((c) => c.description).join(' · ')}`);
    }
    if (item.htmlUrl) lines.push(`- **Canvas**: ${item.htmlUrl}`);
    lines.push('');
  }
  lines.push(cacheNote());
  return lines.join('\n');
}

async function toolAssignmentDetail(args) {
  const all = await getAssignments({ force: args.force });
  const strip = (a) => (a ? a.trim() : '');
  const needle = strip(args.name).toLowerCase();
  if (!needle) throw new CanvasError('Geef een deel van de opdrachtnaam mee via "name".', 0, null);

  const scoped = filterByCourse(all, args.course);
  let matches = scoped.filter((i) => String(i.name).toLowerCase().includes(needle));
  if (!matches.length) {
    // Fall back to matching the description, so "eindbeoordeling" still lands.
    matches = scoped.filter((i) => String(i.description).toLowerCase().includes(needle));
  }

  if (!matches.length) {
    const names = scoped.slice(0, 40).map((i) => `- ${i.name} (${i.courseName})`);
    return [
      `Geen portfolio-opdracht gevonden met "${args.name}"${args.course ? ` in cursus "${args.course}"` : ''}.`,
      '',
      'Beschikbare portfolio-opdrachten:',
      '',
      ...names,
    ].join('\n');
  }

  const lines = [];
  for (const item of matches) {
    lines.push(`# ${item.name}`);
    lines.push('');
    lines.push(`- **Cursus**: ${item.courseName} (id ${item.courseId})`);
    lines.push(`- **Deadline**: ${fmtDateTime(item.dueAt)}${item.dueAt ? ` (${relativeDays(item.dueAt)})` : ''}`);
    lines.push(`- **Status**: ${stateLabel(item.state)}${item.submittedAt ? ` op ${fmtDateTime(item.submittedAt)}` : ''}`);
    if (item.grade != null) lines.push(`- **Beoordeling**: ${item.grade}${item.score != null ? ` (${item.score} punten)` : ''}`);
    if (item.late) lines.push('- ⚠️ Te laat ingeleverd');
    if (item.missing) lines.push('- ⚠️ Staat als *missing* geregistreerd');
    lines.push(`- **Inlevervorm**: ${item.submissionTypes.join(', ') || '—'}`);
    if (item.loCodes.length) lines.push(`- **Leeruitkomsten**: ${item.loCodes.join(', ')}`);
    if (item.htmlUrl) lines.push(`- **Canvas**: ${item.htmlUrl}`);
    lines.push('');

    if (item.attachments.length) {
      lines.push('## Ingeleverd');
      lines.push('');
      for (const att of item.attachments) lines.push(`- ${att.displayName}${att.size ? ` (${Math.round(att.size / 1024)} kB)` : ''}`);
      lines.push('');
    }

    if (item.description) {
      lines.push('## Omschrijving');
      lines.push('');
      for (const line of item.description.split('\n')) lines.push(line ? `> ${line}` : '>');
      lines.push('');
    }

    if (item.rubric.length) {
      lines.push(`## Beoordelingscriteria (${item.rubric.length})`);
      lines.push('');
      for (const criterion of item.rubric) {
        const pts = criterion.points != null ? ` — ${criterion.points} pt` : '';
        const codes = criterion.loCodes.length ? ` _(${criterion.loCodes.join(', ')})_` : '';
        lines.push(`### ${criterion.description}${pts}${codes}`);
        lines.push('');
        if (criterion.longDescription) {
          for (const line of criterion.longDescription.split('\n')) lines.push(line ? `> ${line}` : '>');
          lines.push('');
        }
        if (criterion.ratings.length) {
          for (const rating of criterion.ratings) {
            if (rating.description) lines.push(`- ${rating.points ?? '?'} pt — ${rating.description}`);
          }
          lines.push('');
        }
      }
    }
    lines.push('---');
    lines.push('');
  }
  lines.push(cacheNote());
  return lines.join('\n');
}

async function toolWhoami() {
  const canvas = await canvasClient();
  const [user, courses] = await Promise.all([
    canvas.get('/api/v1/users/self'),
    canvas.get('/api/v1/courses', { per_page: 100 }, { paginate: true }),
  ]);
  const list = Array.isArray(courses) ? courses : [];
  return [
    '# Canvas-koppeling',
    '',
    `- **Host**: ${canvas.base}`,
    `- **Gebruiker**: ${user?.name ?? '?'} (id ${user?.id ?? '?'})`,
    `- **Cursussen**: ${list.length}`,
    `- **Token**: geldig`,
    '',
    'Cursussen:',
    '',
    ...list.map((c) => `- ${c.name} (id ${c.id})`),
  ].join('\n');
}

const HANDLERS = {
  portfolio_status: toolPortfolioStatus,
  deadline_radar: toolDeadlineRadar,
  criteria_coverage: toolCriteriaCoverage,
  evidence_for: toolEvidenceFor,
  assignment_detail: toolAssignmentDetail,
  canvas_whoami: toolWhoami,
};

/* ──────────────────────────── MCP plumbing ─────────────────────────────── */

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

async function handle(message) {
  const { id, method, params } = message;

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });

    case 'notifications/initialized':
    case 'initialized':
      return null; // notification: no response

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, { tools: TOOLS });

    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments ?? {};
      const handler = HANDLERS[name];
      if (!handler) return fail(id, -32602, `Onbekende tool: ${name}`);
      try {
        const text = await handler(args);
        return ok(id, { content: [{ type: 'text', text }] });
      } catch (error) {
        if (error instanceof CanvasError) {
          return ok(id, {
            content: [{ type: 'text', text: `**Canvas-fout (${error.status})**: ${error.message}` }],
            isError: true,
          });
        }
        return ok(id, {
          content: [{ type: 'text', text: `**Fout**: ${error?.message ?? String(error)}` }],
          isError: true,
        });
      }
    }

    default:
      if (id === undefined || id === null) return null; // unknown notification
      return fail(id, -32601, `Onbekende methode: ${method}`);
  }
}

/* ───────────────────────────── stdio loop ──────────────────────────────── */

function write(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function serveStdio() {
  let buffer = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        write(fail(null, -32700, 'Parse error'));
        continue;
      }
      handle(message)
        .then((response) => {
          if (response) write(response);
        })
        .catch((error) => {
          if (message?.id !== undefined) {
            write(fail(message.id, -32603, error?.message ?? 'Interne fout'));
          }
        });
    }
  });

  process.stdin.on('end', () => process.exit(0));
}

/** `--selftest` runs every tool once against the live API, for wiring checks. */
async function selftest() {
  const cases = [
    ['canvas_whoami', {}],
    ['portfolio_status', { only_open: true }],
    ['deadline_radar', { days: 120 }],
    ['criteria_coverage', {}],
    ['evidence_for', { query: 'portfolio' }],
    ['assignment_detail', { name: 'Portfolio voor eerste review' }],
  ];
  for (const [name, args] of cases) {
    process.stdout.write(`\n${'='.repeat(78)}\n${name} ${JSON.stringify(args)}\n${'='.repeat(78)}\n`);
    try {
      const text = await HANDLERS[name](args);
      process.stdout.write(text.slice(0, 2500) + (text.length > 2500 ? '\n…[afgekapt]' : '') + '\n');
    } catch (error) {
      process.stdout.write(`FOUT: ${error?.message ?? error}\n`);
    }
  }
}

if (process.argv.includes('--selftest')) {
  selftest().then(
    () => process.exit(0),
    (error) => {
      process.stderr.write(`selftest mislukt: ${error?.stack ?? error}\n`);
      process.exit(1);
    },
  );
} else {
  serveStdio();
}
