/**
 * Semester-indeling.
 *
 * Fontys codeert de periode in het vak-ID van de term: vier cijfers voor het
 * studiejaar, dan de helft van het jaar.
 *
 *   2627nj → studiejaar 2026/2027, najaar  (sep–jan)
 *   2627vj → studiejaar 2026/2027, voorjaar (feb–jun)
 *   2425nj → studiejaar 2024/2025, najaar  (geschiedenis)
 *
 * Alles door elkaar gooien maakt het onleesbaar: een deadline uit 2024 naast
 * een deadline van volgende week zegt niets. Daarom groeperen we en krijgt de
 * periode waarin je nu zit voorrang.
 *
 * Pure functies, geen I/O — zodat dit los te testen is.
 */

const NL_MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/**
 * Leest een termcode als "2627nj".
 * Geeft null terug bij alles wat niet op het patroon lijkt.
 */
export function parseTermCode(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  const match = /^(\d{2})(\d{2})(nj|vj)$/.exec(raw);
  if (!match) return { raw, label: raw || null, startYear: null, half: null, sortKey: -1, kind: 'onbekend' };

  const startYear = 2000 + Number(match[1]);
  const half = match[3];
  /*
   * Beide helften van studiejaar 2026/27 eindigen in hetzelfde kalenderjaar:
   *   najaar  = september 2026 t/m januari 2027  → eindigt 2027
   *   voorjaar = februari  2027 t/m juni   2027  → eindigt 2027
   *
   * Dat is even tegenintuïtief, maar het is de kern van een studiejaar dat
   * over de jaarwisseling loopt.
   */
  const endYear = startYear + 1;
  const months = half === 'nj' ? 'sep–jan' : 'feb–jun';

  return {
    raw,
    startYear,
    endYear,
    half,
    kind: half === 'nj' ? 'najaar' : 'voorjaar',
    label: `${startYear}/${String(endYear).slice(2)} · ${half === 'nj' ? 'najaar' : 'voorjaar'} (${months})`,
    /*
     * Kort label. Bij een najaar hoort het studiejaar erbij (2026/27), bij een
     * voorjaar is één jaartal genoeg (2027) — dat leest rustiger en het is toch
     * ondubbelzinnig.
     */
    short: half === 'nj' ? `${startYear}/${String(endYear).slice(2)} najaar` : `${endYear} voorjaar`,
    /*
     * Sorteersleutel: het studiejaar bepaalt de volgorde, en binnen dat jaar
     * komt het najaar vóór het voorjaar. Beide eindigen in hetzelfde
     * kalenderjaar, dus de eindjaar-as werkt hier niet — het studiejaar wel.
     *
     *   2024/25 najaar → 202400    2025/26 najaar → 202500
     *   2024/25 voorjaar → 202450   2025/26 voorjaar → 202550
     *   2026/27 najaar → 202600    2026/27 voorjaar → 202650
     */
    sortKey: startYear * 100 + (half === 'vj' ? 50 : 0),
  };
}

/**
 * Welke term is "nu"? Bepaalt welke groep bovenaan staat en openklapt.
 * Buiten een semesterperiode kiezen we de eerstvolgende.
 */
export function currentTermCode(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  // Vanaf augustus zit je in het najaar van dit studiejaar; daarvoor in het
  // voorjaar van het studiejaar dat in het vorige jaar begon.
  if (month >= 8) return `${String(year).slice(2)}${String(year + 1).slice(2)}nj`;
  if (month >= 2) return `${String(year - 1).slice(2)}${String(year).slice(2)}vj`;
  return `${String(year - 1).slice(2)}${String(year).slice(2)}nj`;
}

/**
 * Groepeert cursusprofielen per semester.
 *
 * @param {object[]} profiles   uit fetchCourseProfiles()
 * @param {string} [currentCode]  de term die als "nu" geldt
 * @returns {object[]} groepen, nieuwste eerst, met `isCurrent`
 */
export function groupBySemester(profiles, currentCode = currentTermCode()) {
  const groups = new Map();

  for (const profile of profiles) {
    const term = parseTermCode(profile.term);
    const key = term.raw || 'onbekend';
    if (!groups.has(key)) {
      groups.set(key, {
        code: key,
        term,
        label: term.label ?? 'Periode onbekend',
        short: term.short ?? '—',
        isCurrent: key === currentCode,
        sortKey: term.sortKey,
        courses: [],
      });
    }
    groups.get(key).courses.push(profile);
  }

  for (const group of groups.values()) {
    // Binnen een semester: cursussen met openstaand werk eerst.
    group.courses.sort((a, b) => {
      const openDiff = (b.counts?.portfolioOpen ?? 0) - (a.counts?.portfolioOpen ?? 0);
      if (openDiff !== 0) return openDiff;
      return String(a.name).localeCompare(String(b.name));
    });
    group.openTotal = group.courses.reduce((sum, c) => sum + (c.counts?.portfolioOpen ?? 0), 0);
    group.moduleTotal = group.courses.reduce((sum, c) => sum + (c.counts?.modules ?? 0), 0);
    group.announcementTotal = group.courses.reduce((sum, c) => sum + (c.counts?.announcements ?? 0), 0);
    group.outcomeTotal = group.courses.reduce((sum, c) => sum + (c.counts?.outcomes ?? 0), 0);
  }

  /*
   * Puur chronologisch, nieuwste eerst.
   *
   * We zetten het huidige semester NIET geforceerd bovenaan. Dat lijkt handig,
   * maar het breekt de volgorde: najaar 2026 zou dan vóór voorjaar 2027 staan,
   * terwijl dat later is. De UI markeert het huidige semester met een "nu"-
   * label, en dat is genoeg.
   *
   * Expliciet op sorteersleutel, niet op de volgorde waarin de cursussen
   * binnenkwamen: Canvas levert zijn eigen volgorde en die is niet chronologisch.
   */
  return [...groups.values()].sort((a, b) => {
    if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
    return String(a.code).localeCompare(String(b.code));
  });
}

/**
 * Knipt een lijst op een tijdvenster.
 *
 * De opdracht: alleen wat binnenkort speelt, niet wat al maanden geleden was of
 * pas over een half jaar komt. Alles daarbuiten is ruis.
 *
 * @param {object[]} items   items met `dueAt`
 * @param {object} options
 * @param {number} [options.days]   venster in dagen (default 28 = 4 weken)
 * @param {boolean} [options.includeOverdue]  verlopen items meetellen
 */
export function withinWindow(items, { days = 28, includeOverdue = true, now = new Date() } = {}) {
  const nowMs = now.getTime();
  const until = nowMs + days * 86_400_000;

  const inWindow = [];
  const overdue = [];
  const later = [];
  const undated = [];

  for (const item of items) {
    if (!item.dueAt) {
      undated.push(item);
      continue;
    }
    const due = Date.parse(item.dueAt);
    if (due < nowMs) overdue.push(item);
    else if (due <= until) inWindow.push(item);
    else later.push(item);
  }

  const byDue = (a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt);
  inWindow.sort(byDue);
  overdue.sort(byDue);
  later.sort(byDue);

  return {
    shown: includeOverdue ? [...overdue, ...inWindow] : inWindow,
    overdue,
    inWindow,
    later,
    undated,
    windowDays: days,
    counts: {
      overdue: overdue.length,
      inWindow: inWindow.length,
      later: later.length,
      undated: undated.length,
    },
  };
}

/** Kort label voor een datum, bv. "di 4 nov". */
export function shortDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const day = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'][d.getDay()];
  return `${day} ${d.getDate()} ${NL_MONTHS[d.getMonth()]}`;
}
