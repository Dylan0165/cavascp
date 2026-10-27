/**
 * Ingestie en veranderingdetectie.
 *
 * Bij elke start scant het dashboard Canvas en bepaalt wat er sinds de vorige
 * keer is veranderd: nieuwe announcements, nieuwe modules, nieuwe opdrachten,
 * nieuwe leeruitkomsten. Zo hoef je niet zelf te zoeken wat er speelt.
 *
 * Twee principes:
 *
 * 1. GOEDKOOP EERST. Een volledige scan kost ~11 seconden en tientallen
 *    requests. Daarom halen we eerst alleen de cursuslijst op en vergelijken we
 *    `updated_at` per cursus. Is er niets veranderd, dan slaan we de dure
 *    module- en announcement-calls over. Dat scheelt bij een normale start
 *    bijna alles.
 *
 * 2. BETEKENIS, NIET ALLEEN DATA. Een announcement wordt niet alleen bewaard
 *    maar ook gelezen: deadline erin? cijfer? link naar een opdracht? Dat is
 *    wat het dashboard bruikbaar maakt in plaats van een lange lijst.
 *
 * De momentopname staat in data/canvas-state.json. Die is lokaal en persoonlijk
 * en hoort niet in versiebeheer.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { htmlToText } from './analysis.mjs';
import { fetchCourseProfiles, rankCourses } from './courses.mjs';

const STATE_DIR = 'D:/cavascp/data';
const STATE_FILE = path.join(STATE_DIR, 'canvas-state.json');

/* ─────────────────────── announcements begrijpen ──────────────────────── */

const NL_MONTHS = {
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12,
};

/**
 * Leest een announcement en haalt eruit wat bruikbaar is.
 *
 * Docenten schrijven deadlines in lopende tekst ("inleveren voor 9 oktober",
 * "deadline 17-01-2027"). Dat is precies de informatie die je mist als je alleen
 * de opdrachten volgt. We halen eruit wat met zekerheid te zeggen is en laten de
 * rest met rust — geen gokwerk.
 */
export function readAnnouncement(announcement, { now = new Date() } = {}) {
  /*
   * Let op: dit kan zowel een ruwe Canvas-announcement zijn (met HTML in
   * `message`) als een die al door courses.mjs is omgezet (platte tekst in
   * `body`). We normaliseren hier, want anders belanden er HTML-tags in de
   * preview en vinden we links niet.
   */
  const rawBody = announcement.body ?? announcement.message ?? '';
  const text = announcement.body ? String(announcement.body) : htmlToText(rawBody);
  const haystack = `${announcement.title ?? ''}\n${text}`.toLowerCase();

  /* Datums in tekst: "9 oktober", "17 januari 2027", "09-10-2026", "2026-10-09". */
  const dates = [];

  for (const m of haystack.matchAll(/\b(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\b(\s+\d{4})?/g)) {
    const day = Number(m[1]);
    const month = NL_MONTHS[m[2]];
    const year = m[3] ? Number(m[3].trim()) : now.getFullYear();
    const d = new Date(Date.UTC(year, month - 1, day));
    // Zonder jaartal: als de datum al geweest is, bedoelt men volgend jaar.
    if (!m[3] && d.getTime() < now.getTime() - 30 * 86_400_000) d.setUTCFullYear(year + 1);
    dates.push({ iso: d.toISOString(), raw: m[0].trim(), source: 'tekst' });
  }

  for (const m of haystack.matchAll(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/g)) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    if (!Number.isNaN(d.getTime())) dates.push({ iso: d.toISOString(), raw: m[0], source: 'tekst' });
  }

  for (const m of haystack.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    dates.push({ iso: `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`, raw: m[0], source: 'tekst' });
  }

  /* Signalen: woorden die zeggen watvoor announcement dit is. */
  const signals = [];
  if (/\b(deadline|inlever|inleveren|lever in|submit|uiterlijk)\b/.test(haystack)) signals.push('deadline');
  if (/\b(cijfer|resultaat|beoordeling|grade|nakijken)\b/.test(haystack)) signals.push('beoordeling');
  if (/\b(afwezig|ziek|verhinderd|uitval|gaat niet door|verplaatst|geannuleerd)\b/.test(haystack)) signals.push('roosterwijziging');
  if (/\b(examen|toets|tentamen|presentatie|pitch|review)\b/.test(haystack)) signals.push('toetsmoment');
  if (/\b(verplicht|moet|niet vergeten|let op|belangrijk)\b/.test(haystack)) signals.push('verplicht');
  if (/\b(stage|internship|bedrijf)\b/.test(haystack)) signals.push('stage');
  if (/\b(portfolio|portflow|snapshot)\b/.test(haystack)) signals.push('portfolio');

  /* Leeruitkomsten die genoemd worden: "LO1", "leeruitkomst 3". */
  const loCodes = new Set();
  for (const m of haystack.matchAll(/\blo\s*[-_.]?\s*(\d{1,2})\b/g)) loCodes.add(`LO${m[1]}`);
  for (const m of haystack.matchAll(/\bleeruitkomst(?:en)?\s*[-_.]?\s*(\d{1,2})\b/g)) loCodes.add(`LO${m[1]}`);

  /*
   * Links: zowel echte hrefs als losse URL's in de tekst. Docenten plakken
   * regelmatig een kaal adres zonder er een link van te maken.
   * We zoeken in de RUWE body, want htmlToText haalt de hrefs weg.
   */
  const links = new Set();
  const raw = String(rawBody);
  for (const m of raw.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    if (!/instructure-uploads|\.css|\.js/.test(m[1])) links.add(m[1]);
  }
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    if (!/instructure-uploads|\.css$|\.js$/.test(m[0])) links.add(m[0].replace(/[.,;:]+$/, ''));
  }

  // Datums binnen een redelijke horizon zijn het interessantst.
  const useful = dates
    .filter((d) => {
      const t = Date.parse(d.iso);
      return t > now.getTime() - 14 * 86_400_000 && t < now.getTime() + 300 * 86_400_000;
    })
    .sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso));

  return {
    id: announcement.id,
    title: announcement.title,
    author: announcement.author,
    postedAt: announcement.postedAt,
    url: announcement.url,
    preview: text.replace(/\s+/g, ' ').slice(0, 320),
    bodyLength: text.length,
    signals,
    loCodes: [...loCodes].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))),
    dates: useful.slice(0, 4),
    links: [...links].slice(0, 5),
    isNew: false, // wordt gezet bij het vergelijken
  };
}

/* ─────────────────────────── de momentopname ──────────────────────────── */

/** Een vingerafdruk per cursus, om te zien of er iets veranderd is. */
function courseFingerprint(profile) {
  const moduleSig = profile.modules.map((m) => `${m.id}:${m.itemCount}`).join(',');
  const annSig = profile.announcements.map((a) => a.id).join(',');
  const outcomeSig = profile.outcomes.map((o) => o.id).join(',');
  return `${profile.counts.modules}|${profile.counts.moduleItems}|${profile.counts.announcements}|${moduleSig}|${annSig}|${outcomeSig}`;
}

async function loadState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function saveState(state) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/* ──────────────────────────── de scan ────────────────────────────────── */

/**
 * Doet een scan en levert de cursusprofielen plus wat er veranderd is.
 *
 * Over de kosten: Canvas heeft GEEN "wat is er veranderd"-endpoint. De
 * cursuslijst bevat ook geen bruikbare `updated_at` (die is undefined). Er is
 * dus geen goedkope manier om te zien of er iets nieuws is — je moet kijken.
 *
 * Wat we wél doen:
 *   - announcements worden altijd vers opgehaald (dat is wat je wilt zien, en
 *     het is het goedkoopste deel: één request per cursus)
 *   - modules en leeruitkomsten alleen als ze nog niet in de momentopname
 *     staan, of als de gebruiker om een volledige verversing vraagt
 *
 * De veranderingdetectie vergelijkt daarna de opgeslagen id-lijsten met de
 * nieuwe, en dat is betrouwbaar: een announcement krijgt een nieuw id.
 *
 * @param {object} canvas
 * @param {object[]} portfolioAssignments
 * @param {object} options
 * @param {boolean} [options.force]   alles opnieuw, ook modules en uitkomsten
 */
export async function scanCanvas(canvas, portfolioAssignments = [], options = {}) {
  const { force = false } = options;
  const started = Date.now();

  const previous = await loadState();
  const previousByCourse = new Map((previous?.courses ?? []).map((c) => [c.id, c]));

  const profiles = await fetchCourseProfiles(canvas, portfolioAssignments, {
    withContent: true,
    withOutcomes: force || !previous,
  });

  const ranked = rankCourses(profiles);

  /* Stap 3: veranderingen bepalen door de nieuwe momentopname te vergelijken. */
  const changes = { newAnnouncements: [], newModules: [], newOutcomes: [], newCourses: [], resolvedCourses: [] };
  const snapshot = { version: 1, scannedAt: new Date().toISOString(), courses: [] };

  for (const profile of ranked) {
    const before = previousByCourse.get(profile.id);
    const seenAnn = new Set(before?.announcementIds ?? []);
    const seenMod = new Set(before?.moduleIds ?? []);
    const seenLo = new Set(before?.outcomeIds ?? []);

    for (const a of profile.announcements) {
      if (!seenAnn.has(a.id)) {
        changes.newAnnouncements.push({
          courseId: profile.id,
          courseName: profile.name,
          ...readAnnouncement(a),
        });
      }
    }
    for (const m of profile.modules) {
      if (!seenMod.has(m.id)) {
        changes.newModules.push({
          courseId: profile.id,
          courseName: profile.name,
          moduleId: m.id,
          name: m.name,
          itemCount: m.itemCount,
        });
      }
    }
    for (const o of profile.outcomes) {
      if (!seenLo.has(o.id)) {
        changes.newOutcomes.push({
          courseId: profile.id,
          courseName: profile.name,
          code: o.code,
          name: o.name,
        });
      }
    }
    if (!before) changes.newCourses.push({ id: profile.id, name: profile.name });

    snapshot.courses.push({
      id: profile.id,
      name: profile.name,
      code: profile.code,
      term: profile.term,
      fingerprint: courseFingerprint(profile),
      announcementIds: profile.announcements.map((a) => a.id),
      moduleIds: profile.modules.map((m) => m.id),
      outcomeIds: profile.outcomes.map((o) => o.id),
      counts: profile.counts,
    });
  }

  // Cursussen die verdwenen zijn (afgerond of uit het overzicht).
  for (const [id, before] of previousByCourse) {
    if (!snapshot.courses.some((c) => c.id === id)) {
      changes.resolvedCourses.push({ id, name: before.name });
    }
  }

  changes.newAnnouncements.sort((a, b) => String(b.postedAt ?? '').localeCompare(String(a.postedAt ?? '')));

  const isFirstRun = !previous;

  await saveState(snapshot);

  return {
    profiles: ranked,
    changes,
    scan: {
      firstRun: isFirstRun,
      outcomesRefreshed: force || !previous,
      durationMs: Date.now() - started,
      scannedAt: snapshot.scannedAt,
      previousScanAt: previous?.scannedAt ?? null,
      totalChanges:
        changes.newAnnouncements.length +
        changes.newModules.length +
        changes.newOutcomes.length +
        changes.newCourses.length,
    },
  };
}

/**
 * Wat vraagt aandacht? Leest de announcements en vertaalt ze naar concrete
 * punten: een deadline die nadert, een roosterwijziging, een cijfer.
 */
export function attentionItems(profiles, { now = new Date(), withinDays = 28 } = {}) {
  const items = [];
  const until = now.getTime() + withinDays * 86_400_000;

  for (const profile of profiles) {
    for (const a of profile.announcements) {
      const read = readAnnouncement(a, { now });
      if (!read.signals.length && !read.dates.length) continue;

      const naderend = read.dates.filter((d) => {
        const t = Date.parse(d.iso);
        return t >= now.getTime() - 86_400_000 && t <= until;
      });

      const urgent = read.signals.includes('roosterwijziging') || read.signals.includes('deadline') || naderend.length;
      if (!urgent) continue;

      items.push({
        courseId: profile.id,
        courseName: profile.name,
        courseCode: profile.code,
        title: read.title,
        author: read.author,
        postedAt: read.postedAt,
        url: read.url,
        signals: read.signals,
        loCodes: read.loCodes,
        dates: naderend,
        preview: read.preview,
        weight: (read.signals.includes('roosterwijziging') ? 3 : 0) + (naderend.length ? 2 : 0),
      });
    }
  }

  return items.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return String(b.postedAt ?? '').localeCompare(String(a.postedAt ?? ''));
  });
}
