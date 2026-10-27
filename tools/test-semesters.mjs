#!/usr/bin/env node
/**
 * Test de semester-indeling en het tijdvenster.
 * Puur rekenwerk, geen Canvas nodig.
 *
 *   node tools/test-semesters.mjs
 */

import { parseTermCode, currentTermCode, groupBySemester, withinWindow, shortDate } from '../mcp/lib/semesters.mjs';

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('1) termcodes lezen');
{
  const nj = parseTermCode('2627nj');
  check('2627nj → studiejaar 2026', nj.startYear === 2026, `${nj.startYear}`);
  check('2627nj → najaar', nj.kind === 'najaar');
  check('2627nj → loopt t/m 2027', nj.endYear === 2027);
  check('2627nj → leesbaar label', nj.label === '2026/27 · najaar (sep–jan)', nj.label);
  // Najaar 2026/27 loopt sep 2026 – jan 2027 en eindigt dus in 2027.
  check('2627nj → sorteersleutel', nj.sortKey === 202600, `${nj.sortKey}`);
  check('2627nj → kort label', nj.short === '2026/27 najaar', nj.short);

  const vj = parseTermCode('2627vj');
  check('2627vj → voorjaar', vj.kind === 'voorjaar');
  // Voorjaar 2026/27 loopt feb – jun 2027: hetzelfde eindjaar als het najaar.
  check('2627vj → eindigt ook in 2027', vj.endYear === 2027, `${vj.endYear}`);
  check('2627vj sorteert ná 2627nj', vj.sortKey > nj.sortKey, `${vj.sortKey} > ${nj.sortKey}`);
  check('2627vj → kort label toont één jaar', vj.short === '2027 voorjaar', vj.short);

  // Twee semesters uit hetzelfde studiejaar moeten ook goed gaan.
  const nj2526 = parseTermCode('2526nj');
  const vj2526 = parseTermCode('2526vj');
  check('2526nj vóór 2526vj', nj2526.sortKey < vj2526.sortKey, `${nj2526.sortKey} < ${vj2526.sortKey}`);
  check('2526vj vóór 2627nj', vj2526.sortKey < nj.sortKey, `${vj2526.sortKey} < ${nj.sortKey}`);

  const old = parseTermCode('2425nj');
  check('2425nj sorteert vóór alles recenter', old.sortKey < nj2526.sortKey, `${old.sortKey} < ${nj2526.sortKey}`);

  const bad = parseTermCode('onzin');
  check('onbekende code valt terug', bad.kind === 'onbekend' && bad.sortKey === -1);
  check('lege code crasht niet', parseTermCode(null).kind === 'onbekend');
}

console.log('\n2) welke term is nu?');
{
  check('7 oktober 2026 → 2627nj', currentTermCode(new Date('2026-10-07')) === '2627nj', currentTermCode(new Date('2026-10-07')));
  check('15 maart 2027 → 2627vj', currentTermCode(new Date('2027-03-15')) === '2627vj', currentTermCode(new Date('2027-03-15')));
  check('20 januari 2027 → 2627nj', currentTermCode(new Date('2027-01-20')) === '2627nj', currentTermCode(new Date('2027-01-20')));
  check('5 september 2026 → 2627nj', currentTermCode(new Date('2026-09-05')) === '2627nj', currentTermCode(new Date('2026-09-05')));
}

console.log('\n3) groeperen per semester');
{
  const courses = [
    { id: 1, name: 'MAIFS', term: '2627nj', counts: { portfolioOpen: 5, modules: 5, announcements: 3, outcomes: 6 } },
    { id: 2, name: 'INTERN5', term: '2627nj', counts: { portfolioOpen: 5, modules: 9, announcements: 14, outcomes: 4 } },
    { id: 3, name: 'MA-ISP', term: '2627vj', counts: { portfolioOpen: 7, modules: 3, announcements: 1, outcomes: 0 } },
    { id: 4, name: 'I2-DB', term: '2425vj', counts: { portfolioOpen: 5, modules: 11, announcements: 46, outcomes: 15 } },
    { id: 5, name: 'PDB-TECH', term: '2425nj', counts: { portfolioOpen: 0, modules: 6, announcements: 7, outcomes: 0 } },
  ];
  const groups = groupBySemester(courses, '2627nj');

  check('vier semesters', groups.length === 4, `${groups.length}`);

  /*
   * Chronologisch, nieuwste eerst — en NIET het huidige semester geforceerd
   * bovenaan. Voorjaar 2026/27 loopt tot juni 2027 en is dus later dan najaar
   * 2026/27, ook al is dat het semester waarin je nu zit. De UI markeert het
   * huidige apart.
   */
  check(
    'chronologisch gesorteerd',
    groups.map((g) => g.code).join(',') === '2627vj,2627nj,2425vj,2425nj',
    groups.map((g) => g.code).join(','),
  );
  check('huidige semester is gemarkeerd', groups.find((g) => g.isCurrent)?.code === '2627nj');
  check('huidige staat op de tweede plek (voorjaar ligt later)', groups[1].code === '2627nj', groups[1].code);
  check('dan 2526 ontbreekt (geen cursus)', !groups.some((g) => g.code === '2526nj'));
  check('geschiedenis onderaan', groups[groups.length - 1].code === '2425nj', groups[groups.length - 1].code);

  const current = groups.find((g) => g.code === '2627nj');
  check('twee cursussen in het huidige semester', current.courses.length === 2, `${current.courses.length}`);
  check('open tellen op', current.openTotal === 10, `${current.openTotal}`);
  check('modules tellen op', current.moduleTotal === 14, `${current.moduleTotal}`);
  check('leeruitkomsten tellen op', current.outcomeTotal === 10, `${current.outcomeTotal}`);
  check(
    'cursussen met het meest open eerst',
    current.courses[0].counts.portfolioOpen >= current.courses[1].counts.portfolioOpen,
    current.courses.map((c) => `${c.name}=${c.counts.portfolioOpen}`).join(' '),
  );

  // Het voorjaar heeft één cursus; dat mag geen crash geven bij het sorteren.
  const spring = groups.find((g) => g.code === '2627vj');
  check('semester met één cursus werkt', spring?.courses.length === 1, `${spring?.courses.length}`);
}

console.log('\n4) tijdvenster van 4 weken');
{
  const now = new Date('2026-10-07T12:00:00Z');
  const items = [
    { name: 'gisteren', dueAt: '2026-10-06T21:00:00Z' },
    { name: 'vandaag', dueAt: '2026-10-07T21:00:00Z' },
    { name: 'over 2 dagen', dueAt: '2026-10-09T21:00:00Z' },
    { name: 'over 27 dagen', dueAt: '2026-11-03T21:00:00Z' },
    { name: 'over 28 dagen', dueAt: '2026-11-04T21:00:00Z' },
    { name: 'over 29 dagen', dueAt: '2026-11-05T21:00:00Z' },
    { name: 'december', dueAt: '2026-12-11T21:00:00Z' },
    { name: 'geen datum', dueAt: null },
  ];

  const w = withinWindow(items, { days: 28, now });
  check('over 27 dagen valt binnen', w.inWindow.some((i) => i.name === 'over 27 dagen'));
  check('over 29 dagen valt buiten', !w.inWindow.some((i) => i.name === 'over 29 dagen'));
  check('december valt buiten', w.later.some((i) => i.name === 'december'));
  check('verlopen apart', w.overdue.length === 1 && w.overdue[0].name === 'gisteren', `${w.overdue.length}`);
  check('zonder datum apart', w.undated.length === 1);
  check('getoond = verlopen + venster', w.shown.length === w.overdue.length + w.inWindow.length, `${w.shown.length}`);
  check('chronologisch gesorteerd', w.shown[0].name === 'gisteren', w.shown[0].name);
  // "later" bevat alles voorbij het venster: 28 d, 29 d en december.
  check('tellingen kloppen', w.counts.overdue === 1 && w.counts.later === 3 && w.counts.undated === 1, JSON.stringify(w.counts));

  const zonderVerlopen = withinWindow(items, { days: 28, now, includeOverdue: false });
  check('verlopen uit te zetten', zonderVerlopen.shown.length === w.inWindow.length);
}

console.log('\n5) korte datumlabels');
{
  check('7 okt 2026 is woensdag', shortDate('2026-10-07T12:00:00Z') === 'wo 7 okt', shortDate('2026-10-07T12:00:00Z'));
  check('leeg blijft leeg', shortDate(null) === null);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
