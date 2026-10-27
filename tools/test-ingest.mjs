#!/usr/bin/env node
/**
 * Test het lezen van announcements en de scan met veranderingdetectie.
 *
 * Deel 1 is puur: nep-announcements met deadlines, datums en leeruitkomsten
 * erin, om te zien of het lezen klopt. Deel 2 draait tegen de echte Canvas.
 *
 *   node tools/test-ingest.mjs           # alleen deel 1
 *   node tools/test-ingest.mjs --live    # ook een echte scan
 */

import { readAnnouncement, scanCanvas, attentionItems } from '../mcp/lib/ingest.mjs';
import { loadEnvFile, createCanvas } from '../mcp/lib/canvas.mjs';
import { fetchPortfolioAssignments } from '../mcp/lib/analysis.mjs';

const LIVE = process.argv.includes('--live');
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const NOW = new Date('2026-10-07T12:00:00Z');

console.log('1) announcement lezen — deadline in lopende tekst');
{
  const a = {
    id: 1,
    title: 'Inleveren portfolio',
    author: 'Docent',
    postedAt: '2026-10-01T09:00:00Z',
    body: 'Beste studenten, let op: jullie moeten het portfolio uiterlijk 9 oktober inleveren. Dit is verplicht.',
  };
  const r = readAnnouncement(a, { now: NOW });
  check('deadline-signaal herkend', r.signals.includes('deadline'), r.signals.join(', '));
  check('verplicht-signaal herkend', r.signals.includes('verplicht'));
  check('datum 9 oktober gevonden', r.dates.some((d) => d.iso.startsWith('2026-10-09')), JSON.stringify(r.dates.map((d) => d.iso.slice(0, 10))));
  check('preview is leesbare tekst', !/[<>]/.test(r.preview) && r.preview.length > 20, r.preview.slice(0, 60));
}

console.log('\n2) announcement lezen — roosterwijziging zonder deadline');
{
  const a = {
    id: 2,
    title: 'Les gaat niet door',
    author: 'Docent',
    postedAt: '2026-10-06T16:00:00Z',
    body: 'Morgenochtend is de docent ziek, de les vervalt. Later meer.',
  };
  const r = readAnnouncement(a, { now: NOW });
  check('roosterwijziging herkend', r.signals.includes('roosterwijziging'), r.signals.join(', '));
  check('geen deadline-signaal', !r.signals.includes('deadline'));
  check('geen datum gevonden (klopt)', r.dates.length === 0, `${r.dates.length}`);
}

console.log('\n3) announcement lezen — leeruitkomsten en cijfers');
{
  const a = {
    id: 3,
    title: 'Beoordeling periode 1',
    author: 'Docent',
    postedAt: '2026-10-05T08:00:00Z',
    body: 'De cijfers zijn bekend. Je moet LO1 en leeruitkomst 4 aantonen in je portfolio. Zie https://fhict.instructure.com/courses/15973 voor details.',
  };
  const r = readAnnouncement(a, { now: NOW });
  check('beoordeling-signaal', r.signals.includes('beoordeling'));
  check('portfolio-signaal', r.signals.includes('portfolio'));
  check('LO1 herkend', r.loCodes.includes('LO1'), r.loCodes.join(', '));
  check('LO4 herkend via "leeruitkomst 4"', r.loCodes.includes('LO4'), r.loCodes.join(', '));
  check('link bewaard', r.links.some((l) => l.includes('15973')), r.links.join(', '));
}

console.log('\n4) announcement lezen — datums in verschillende notaties');
{
  const a = {
    id: 4,
    title: 'Planning',
    author: 'Docent',
    postedAt: '2026-10-01T00:00:00Z',
    body: 'Deadline 09-10-2026. Presentatie op 17 januari 2027. En de review op 2026-11-13.',
  };
  const r = readAnnouncement(a, { now: NOW });
  const found = r.dates.map((d) => d.iso.slice(0, 10));
  check('09-10-2026 herkend', found.includes('2026-10-09'), found.join(', '));
  check('17 januari 2027 herkend', found.includes('2027-01-17'), found.join(', '));
  check('2026-11-13 herkend', found.includes('2026-11-13'), found.join(', '));
  check('datums op volgorde', found[0] <= found[1], found.join(' < '));
}

console.log('\n5) announcement lezen — leeg blijft leeg');
{
  const r = readAnnouncement({ id: 5, title: 'Hallo', body: '', author: null, postedAt: null }, { now: NOW });
  check('geen signalen', r.signals.length === 0);
  check('geen datums', r.dates.length === 0);
  check('crasht niet op leeg', r.id === 5);
}

console.log('\n6) announcement lezen — HTML wordt platte tekst');
{
  // Een RUWE Canvas-announcement: de inhoud staat in `message`, niet in `body`.
  // Dat is de vorm die uit de API komt voordat courses.mjs hem omzet.
  const r = readAnnouncement(
    {
      id: 6,
      title: 'Met opmaak',
      message: '<link rel="stylesheet" href="x.css"><p>Deadline <b>9 oktober</b>.</p><ul><li>Punt een</li></ul>',
      author: 'Docent',
      posted_at: '2026-10-01T00:00:00Z',
    },
    { now: NOW },
  );
  check('geen HTML in preview', !/<[a-z]/i.test(r.preview), r.preview.slice(0, 70));
  check('css-link niet als link bewaard', !r.links.some((l) => l.endsWith('.css')), r.links.join(', '));
  check('deadline alsnog gevonden', r.dates.some((d) => d.iso.startsWith('2026-10-09')));

  // En dezelfde inhoud in `body` (al omgezet) moet ook schoon blijven.
  const r2 = readAnnouncement({ id: 7, title: 'Al omgezet', body: 'Deadline 9 oktober.', author: null }, { now: NOW });
  check('omgezette body blijft schoon', r2.preview === 'Deadline 9 oktober.', r2.preview);
}

/* ── live ──────────────────────────────────────────────────────────────── */

if (LIVE) {
  console.log('\n7) echte scan tegen Canvas');

  // Met --fresh gooien we de momentopname weg, zodat we een echte eerste start
  // nabootsen. Zonder dat is er niets "nieuw" en test je de detectie niet.
  if (process.argv.includes('--fresh')) {
    const { rm } = await import('node:fs/promises');
    await rm('D:/cavascp/data/canvas-state.json', { force: true });
    console.log('  momentopname gewist — dit is een eerste start');
  }

  const env = await loadEnvFile('D:/cavascp/.env');
  const canvas = createCanvas({ baseUrl: env.CANVAS_BASE_URL, token: env.CANVAS_TOKEN });
  const assignments = await fetchPortfolioAssignments(canvas, { includeDescriptions: false });

  const first = await scanCanvas(canvas, assignments, { force: true });
  console.log(`  eerste scan: ${first.scan.durationMs}ms, uitkomsten ververs=${first.scan.outcomesRefreshed}, eersteKeer=${first.scan.firstRun}`);
  check('cursussen gevonden', first.profiles.length >= 10, `${first.profiles.length}`);
  check('eerste keer geldt als volledige scan', first.scan.firstRun === true);
  check('announcements zijn nieuw bij de eerste scan', first.changes.newAnnouncements.length > 0, `${first.changes.newAnnouncements.length}`);
  check('leeruitkomsten gevonden', first.changes.newOutcomes.length > 0, `${first.changes.newOutcomes.length}`);

  console.log('\n8) tweede scan — alleen announcements, uitkomsten uit de momentopname');
  const second = await scanCanvas(canvas, assignments, {});
  console.log(`  tweede scan: ${second.scan.durationMs}ms, uitkomsten ververs=${second.scan.outcomesRefreshed}`);
  check('tweede scan slaat de uitkomsten over', second.scan.outcomesRefreshed === false);
  check('geen nieuwe announcements', second.changes.newAnnouncements.length === 0, `${second.changes.newAnnouncements.length}`);
  check('geen nieuwe modules', second.changes.newModules.length === 0, `${second.changes.newModules.length}`);
  check('geen nieuwe leeruitkomsten', second.changes.newOutcomes.length === 0, `${second.changes.newOutcomes.length}`);
  check('tweede scan is sneller', second.scan.durationMs < first.scan.durationMs, `${second.scan.durationMs}ms < ${first.scan.durationMs}ms`);

  console.log('\n9) wat vraagt aandacht?');
  const attention = attentionItems(second.profiles, { now: new Date() });
  console.log(`  ${attention.length} punten die aandacht vragen:`);
  for (const item of attention.slice(0, 8)) {
    const dateInfo = item.dates.length ? `  [${item.dates.map((d) => d.iso.slice(0, 10)).join(', ')}]` : '';
    console.log(`    ${String(item.courseCode ?? item.courseName).slice(0, 16).padEnd(16)} ${item.signals.join('+').padEnd(24)} ${item.title.slice(0, 40)}${dateInfo}`);
  }
  check('aandachtspunten gevonden', attention.length > 0, `${attention.length}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
