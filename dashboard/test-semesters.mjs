#!/usr/bin/env node
/**
 * Test de semester-endpoints van het dashboard.
 *
 * Controleert dat het lichte overzicht de semesters bevat, dat een semester
 * alleen zijn eigen opdrachten en criteria teruggeeft, en dat de semesters
 * gescheiden blijven — het hele punt van deze stap.
 */

const PORT = process.env.CAVASCP_PORT || 8787;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

let cookie = null;
async function authenticate() {
  const res = await fetch(`${ORIGIN}/`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(/cavascp_session=[^;]+/);
  if (!m) throw new Error('geen sessiecookie');
  cookie = m[0];
}
const api = (path) => fetch(`${ORIGIN}${path}`, { headers: { Origin: ORIGIN, Cookie: cookie } });

await authenticate();

console.log('1) licht overzicht');
const overviewRes = await api('/api/data');
const overview = await overviewRes.json();
check('endpoint antwoordt', overviewRes.ok, `status ${overviewRes.status}`);
check('semesters aanwezig', Array.isArray(overview.semesters) && overview.semesters.length > 0, `${overview.semesters?.length ?? 0}`);
check('termen herkend', overview.termsReady === true);
check('huidige term bepaald', Boolean(overview.currentTerm), overview.currentTerm);

console.log('\n2) semesterindeling');
const semesters = overview.semesters ?? [];
for (const s of semesters) {
  console.log(
    `     ${String(s.code).padEnd(8)} ${String(s.short).padEnd(12)} ${s.isCurrent ? 'NU ' : '   '} ` +
      `${String(s.stats.assignments).padStart(3)} opdr  ${String(s.stats.open).padStart(2)} open  ` +
      `${String(s.stats.submitted).padStart(2)} klaar  ${String(s.courses.length).padStart(2)} vakken  ` +
      `${String(s.stats.criteriaGaps).padStart(3)} criteria open`,
  );
}
check('meer dan één semester', semesters.length > 1, `${semesters.length}`);
check('er is een huidig semester gemarkeerd', semesters.some((s) => s.isCurrent), semesters.find((s) => s.isCurrent)?.code);
const codes = semesters.map((s) => s.code);
check('geen dubbele semesters', new Set(codes).size === codes.length, codes.join(', '));
check('elk semester heeft een leesbaar label', semesters.every((s) => s.label && s.label.length > 4));
/*
 * Puur chronologisch, nieuwste eerst.
 *
 * Het huidige semester wordt NIET geforceerd bovenaan gezet: dat zou de
 * volgorde breken (najaar 2026 vóór voorjaar 2027). De UI markeert het met een
 * "nu"-label; de lijst blijft chronologisch.
 */
check(
  'semesters zijn chronologisch gesorteerd (nieuwste eerst)',
  semesters.every((s, i) => i === 0 || semesters[i - 1].sortKey > s.sortKey),
  semesters.map((s) => `${s.code}=${s.sortKey}`).join(' | '),
);
check(
  'het huidige semester staat bij de nieuwste',
  semesters.findIndex((s) => s.isCurrent) <= 1,
  `index ${semesters.findIndex((s) => s.isCurrent)}`,
);

console.log('\n3) een semester ophalen geeft alleen dat semester');
const target = semesters.find((s) => s.stats.assignments > 0) ?? semesters[0];
const termRes = await api(`/api/data?term=${encodeURIComponent(target.code)}`);
const term = await termRes.json();
check('endpoint antwoordt', termRes.ok, `status ${termRes.status}`);
check('juiste semester terug', term.termCode === target.code, term.termCode);
check('opdrachten aanwezig', term.assignments?.length > 0, `${term.assignments?.length ?? 0}`);
check('aantal klopt met het overzicht', term.assignments?.length === target.stats.assignments, `${term.assignments?.length} vs ${target.stats.assignments}`);
check('alle opdrachten horen bij dit semester', term.assignments.every((a) => a.term === target.code), 'geen vreemde termen');
check('criteria aanwezig', term.coverage?.length > 0, `${term.coverage?.length ?? 0}`);
check('statistieken aanwezig', Boolean(term.stats?.criteriaTotal));

console.log('\n4) semesters blijven gescheiden');
const other = semesters.find((s) => s.code !== target.code && s.stats.assignments > 0);
if (other) {
  const otherTerm = await (await api(`/api/data?term=${encodeURIComponent(other.code)}`)).json();
  const a = new Set(term.assignments.map((x) => x.assignmentId));
  const b = new Set(otherTerm.assignments.map((x) => x.assignmentId));
  const overlap = [...a].filter((id) => b.has(id));
  check('geen opdracht in twee semesters', overlap.length === 0, `${overlap.length} overlappend`);
  const namesA = term.coverage.map((c) => c.label);
  const namesB = otherTerm.coverage.map((c) => c.label);
  const sameCount = namesA.filter((n) => namesB.includes(n)).length;
  console.log(`     ${target.code}: ${namesA.length} criteria · ${other.code}: ${namesB.length} criteria · ${sameCount} met dezelfde naam`);
  check('verschillende criteria per semester', namesA.length !== namesB.length || sameCount < namesA.length);
}

console.log('\n5) zonder term krijg je geen opdrachten (bewust)');
check('geen assignments in het lichte overzicht', overview.assignments === undefined);

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
