#!/usr/bin/env node
/**
 * Test de cursus-intelligentie tegen de echte Canvas.
 *
 * Laat per cursus zien wat er is opgehaald: periode, leeruitkomsten, modules,
 * announcements. Geen UI, alleen de data — zodat te zien is of de laag klopt
 * voordat er iets aan het dashboard wordt gehangen.
 *
 *   node tools/test-courses.mjs            # alles
 *   node tools/test-courses.mjs 15973      # één cursus, volledig
 */

import { loadEnvFile, createCanvas } from '../mcp/lib/canvas.mjs';
import { fetchPortfolioAssignments } from '../mcp/lib/analysis.mjs';
import { fetchCourseProfiles, rankCourses, matchOutcome } from '../mcp/lib/courses.mjs';

const onlyCourse = process.argv[2] ? Number(process.argv[2]) : null;

const env = await loadEnvFile('D:/cavascp/.env');
const canvas = createCanvas({ baseUrl: env.CANVAS_BASE_URL, token: env.CANVAS_TOKEN });

console.log('Portfolio-opdrachten ophalen (voor de deadline-koppeling)…');
const assignments = await fetchPortfolioAssignments(canvas, { includeDescriptions: false });
console.log(`  ${assignments.length} opdrachten`);
console.log('');

const started = Date.now();
console.log('Cursusprofielen opbouwen…');
const profiles = rankCourses(
  await fetchCourseProfiles(canvas, assignments, {
    withContent: true,
    withOutcomes: true,
  }),
);
console.log(`  ${profiles.length} cursussen in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('');

/* ── overzicht ──────────────────────────────────────────────────────────── */

console.log('='.repeat(104));
console.log('OVERZICHT');
console.log('='.repeat(104));
console.log(
  `${'id'.padStart(7)}  ${'periode'.padEnd(9)} ${'mod'.padStart(4)} ${'items'.padStart(6)} ${'ann'.padStart(4)} ${'LO'.padStart(4)} ${'open'.padStart(5)}  naam`,
);
for (const p of profiles) {
  console.log(
    `${String(p.id).padStart(7)}  ${String(p.term ?? '—').padEnd(9)} ${String(p.counts.modules).padStart(4)} ${String(p.counts.moduleItems).padStart(6)} ${String(p.counts.announcements).padStart(4)} ${String(p.counts.outcomes).padStart(4)} ${String(p.counts.portfolioOpen).padStart(5)}  ${String(p.name).slice(0, 40)}`,
  );
}
console.log('');

/* ── detail ─────────────────────────────────────────────────────────────── */

const targets = onlyCourse ? profiles.filter((p) => p.id === onlyCourse) : profiles.slice(0, 3);

for (const p of targets) {
  console.log('='.repeat(104));
  console.log(`${p.name}  (${p.id})`);
  console.log('='.repeat(104));
  console.log(`  code     : ${p.code}`);
  console.log(`  periode  : ${p.term ?? '—'}`);
  console.log(`  docenten : ${p.teachers.join(', ') || '—'}`);
  console.log(`  url      : ${p.htmlUrl}`);
  if (p.syllabus) console.log(`  syllabus : ${p.syllabus.slice(0, 140)}…`);
  console.log('');

  if (p.outcomes.length) {
    console.log(`  LEERUITKOMSTEN (${p.outcomes.length})`);
    for (const o of p.outcomes) {
      console.log(`    ${String(o.code ?? '—').padEnd(5)} ${o.name}`);
    }
    console.log('');
  }

  if (p.modules.length) {
    console.log(`  MODULES (${p.modules.length})`);
    for (const m of p.modules) {
      const span = m.firstDue ? `  ${String(m.firstDue).slice(0, 10)} → ${String(m.lastDue).slice(0, 10)}` : '';
      console.log(`    ${String(m.position ?? '?').padStart(2)}. ${String(m.name).slice(0, 52).padEnd(52)} ${String(m.itemCount).padStart(3)} items${span}`);
      for (const it of m.items.slice(0, 3)) {
        const due = it.dueAt ? `  due ${String(it.dueAt).slice(0, 10)}` : '';
        console.log(`          ${it.kind.padEnd(10)} ${String(it.title).slice(0, 56)}${due}`);
      }
      if (m.items.length > 3) console.log(`          … en ${m.items.length - 3} meer`);
    }
    console.log('');
  }

  if (p.announcements.length) {
    console.log(`  ANNOUNCEMENTS (${p.announcements.length}, nieuwste eerst)`);
    for (const a of p.announcements.slice(0, 4)) {
      console.log(`    ${String(a.postedAt ?? '').slice(0, 10)}  ${String(a.author ?? '?').slice(0, 22).padEnd(22)} ${String(a.title).slice(0, 46)}`);
      if (a.body) console.log(`                "${a.body.replace(/\s+/g, ' ').slice(0, 90)}"`);
    }
    if (p.announcements.length > 4) console.log(`    … en ${p.announcements.length - 4} meer`);
    console.log('');
  }
}

/* ── leeruitkomst zoeken ────────────────────────────────────────────────── */

console.log('='.repeat(104));
console.log('LEERUITKOMST ZOEKEN (voor de routering van documenten)');
console.log('='.repeat(104));
for (const query of ['LO1', 'LO6', 'data', 'leadership', 'zzz']) {
  const hit = matchOutcome(profiles, query);
  console.log(`  "${query}" → ${hit ? `${hit.code} ${hit.name} (${hit.courseName})` : 'geen match'}`);
}
