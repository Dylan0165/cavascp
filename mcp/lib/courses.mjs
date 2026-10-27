/**
 * Cursus-intelligentie.
 *
 * Bouwt per cursus een profiel op uit meerdere Canvas-bronnen, zodat het
 * dashboard snapt *wat* een cursus is en niet alleen welke opdrachten erin
 * zitten:
 *
 *   - het cursusdetail (naam, code, periode)
 *   - de leeruitkomsten (officiële titels met hun Canvas-id)
 *   - de modules met hun items (de leerroute: Pages, Assignments, Quizzes)
 *   - de announcements (mededelingen, met auteur en datum)
 *
 * Waarom dit apart staat van analysis.mjs: dat gaat over portfolio-opdrachten en
 * dekking. Dit gaat over de cursus als geheel. Ze delen alleen de Canvas-client.
 *
 * Alles read-only. Deze module schrijft niets.
 */

import { htmlToText } from './analysis.mjs';

/* ─────────────────────────────── helpers ──────────────────────────────── */

/** Items met een kop als "[Explanation] Titel" hebben dat label niet nodig. */
function stripLabel(title) {
  return String(title || '').replace(/^\s*\[[^\]]{1,24}\]\s*/, '').trim();
}

const MODULE_ITEM_KIND = {
  Page: 'pagina',
  Assignment: 'opdracht',
  Quiz: 'toets',
  File: 'bestand',
  Discussion: 'discussie',
  ExternalTool: 'tool',
  ExternalUrl: 'link',
  SubHeader: 'kop',
};

/**
 * Deadlines in een module zijn het interessantst. Canvas geeft ze niet mee in
 * de items, dus leiden we ze af uit de opdrachten die we al hebben.
 */
function moduleTiming(items, assignmentById) {
  const dates = items
    .map((item) => assignmentById.get(item.content_id)?.dueAt)
    .filter(Boolean)
    .sort();
  if (!dates.length) return { first: null, last: null };
  return { first: dates[0], last: dates[dates.length - 1] };
}

/* ─────────────────────────── ophalen per cursus ────────────────────────── */

async function fetchOutcomes(canvas, courseId) {
  const groups = await canvas
    .get(`/api/v1/courses/${courseId}/outcome_groups`, { per_page: 50 })
    .catch(() => []);
  if (!Array.isArray(groups)) return [];

  const outcomes = [];
  for (const group of groups) {
    const list = await canvas
      .get(`/api/v1/courses/${courseId}/outcome_groups/${group.id}/outcomes`, { per_page: 100 })
      .catch(() => []);
    if (!Array.isArray(list)) continue;
    for (const link of list) {
      const outcome = link?.outcome;
      if (!outcome?.title) continue;
      // "LO3: Model Interaction & Adaptation" → code LO3, naam zonder code.
      const match = /^(LO\s*\d+)\s*[:–-]\s*(.+)$/i.exec(outcome.title.trim());
      outcomes.push({
        id: outcome.id,
        groupId: group.id,
        groupTitle: group.title,
        raw: outcome.title.trim(),
        code: match ? match[1].replace(/\s+/g, '').toUpperCase() : null,
        name: match ? match[2].trim() : outcome.title.trim(),
        url: outcome.url ? `${canvas.base}${outcome.url}` : null,
      });
    }
  }
  return outcomes;
}

async function fetchModules(canvas, courseId, assignmentById) {
  const modules = await canvas
    .get(
      `/api/v1/courses/${courseId}/modules`,
      { per_page: 100, 'include[]': ['items'] },
      { paginate: true },
    )
    .catch(() => []);
  if (!Array.isArray(modules)) return [];

  return modules.map((module) => {
    const items = (module.items ?? []).map((item) => ({
      id: item.id,
      title: stripLabel(item.title),
      rawTitle: item.title,
      kind: MODULE_ITEM_KIND[item.type] ?? String(item.type || '').toLowerCase(),
      type: item.type,
      contentId: item.content_id ?? null,
      htmlUrl: item.html_url ?? null,
      pageUrl: item.page_url ?? null,
      indent: item.indent ?? 0,
      published: item.published ?? null,
      dueAt: item.content_id ? (assignmentById.get(item.content_id)?.dueAt ?? null) : null,
      points: item.content_id ? (assignmentById.get(item.content_id)?.points ?? null) : null,
    }));

    const timing = moduleTiming(items, assignmentById);
    return {
      id: module.id,
      name: module.name,
      position: module.position ?? null,
      state: module.state ?? module.workflow_state ?? null,
      unlockAt: module.unlock_at ?? null,
      itemCount: items.length,
      items,
      firstDue: timing.first,
      lastDue: timing.last,
    };
  });
}

async function fetchAnnouncements(canvas, courseId) {
  const list = await canvas
    .get(
      `/api/v1/courses/${courseId}/discussion_topics`,
      { per_page: 30, only_announcements: 'true' },
      { paginate: true },
    )
    .catch(() => []);
  if (!Array.isArray(list)) return [];

  return list
    .map((topic) => ({
      id: topic.id,
      title: topic.title,
      postedAt: topic.posted_at ?? topic.created_at ?? null,
      author: topic.user_name ?? topic.author?.display_name ?? null,
      body: htmlToText(topic.message),
      url: topic.html_url ?? null,
      pinned: Boolean(topic.pinned),
      unread: (topic.unread_count ?? 0) > 0,
    }))
    .sort((a, b) => String(b.postedAt ?? '').localeCompare(String(a.postedAt ?? '')));
}

/* ──────────────────────────── het geheel ─────────────────────────────── */

/**
 * Bouwt het cursusprofiel op.
 *
 * @param {object} canvas  de Canvas-client
 * @param {object[]} portfolioAssignments  wat fetchPortfolioAssignments al ophaalde,
 *   zodat we niet opnieuw alle opdrachten per cursus hoeven te halen
 * @param {object} options
 * @param {boolean} [options.withContent]  modules en announcements ophalen (traag)
 * @param {boolean} [options.withOutcomes] leeruitkomsten ophalen
 */
export async function fetchCourseProfiles(canvas, portfolioAssignments = [], options = {}) {
  const { withContent = true, withOutcomes = true } = options;

  const courses = await canvas.get('/api/v1/courses', { per_page: 100 }, { paginate: true });
  const list = (Array.isArray(courses) ? courses : []).filter((c) => c?.id);
  if (!list.length) return [];

  // Opdrachten per cursus, zodat we module-items aan deadlines kunnen koppelen.
  const assignmentById = new Map();
  const portfolioByCourse = new Map();
  for (const item of portfolioAssignments) {
    if (!portfolioByCourse.has(item.courseId)) portfolioByCourse.set(item.courseId, []);
    portfolioByCourse.get(item.courseId).push(item);
    assignmentById.set(item.assignmentId, item);
  }

  const profiles = [];
  for (const course of list) {
    const courseId = course.id;

    const [detail, outcomes, modules, announcements] = await Promise.all([
      canvas
        .get(`/api/v1/courses/${courseId}`, {
          'include[]': ['syllabus_body', 'term', 'teachers'],
        })
        .catch(() => null),
      withOutcomes ? fetchOutcomes(canvas, courseId) : Promise.resolve([]),
      withContent ? fetchModules(canvas, courseId, assignmentById) : Promise.resolve([]),
      withContent ? fetchAnnouncements(canvas, courseId) : Promise.resolve([]),
    ]);

    const source = detail ?? course;
    const portfolio = portfolioByCourse.get(courseId) ?? [];
    const open = portfolio.filter((a) => a.state === 'unsubmitted');

    profiles.push({
      id: courseId,
      name: source.name ?? course.name,
      code: source.course_code ?? course.course_code ?? null,
      term: source.term?.name ?? course.term?.name ?? null,
      state: source.workflow_state ?? course.workflow_state ?? null,
      htmlUrl: `${canvas.base}/courses/${courseId}`,
      syllabus: htmlToText(source.syllabus_body),
      teachers: (source.teachers ?? []).map((t) => t.display_name ?? t.name).filter(Boolean),
      outcomes,
      modules,
      announcements,
      counts: {
        modules: modules.length,
        moduleItems: modules.reduce((sum, m) => sum + m.itemCount, 0),
        announcements: announcements.length,
        outcomes: outcomes.length,
        portfolioTotal: portfolio.length,
        portfolioOpen: open.length,
      },
      latestAnnouncement: announcements[0] ?? null,
    });
  }

  return profiles;
}

/**
 * Sorteert cursussen op bruikbaarheid: cursussen met openstaand werk eerst,
 * daarna op periode (nieuwste eerst). Zo staat wat loopt bovenaan en niet het
 * archief.
 */
export function rankCourses(profiles) {
  return [...profiles].sort((a, b) => {
    if (a.counts.portfolioOpen !== b.counts.portfolioOpen) {
      return b.counts.portfolioOpen - a.counts.portfolioOpen;
    }
    const termA = String(a.term ?? '');
    const termB = String(b.term ?? '');
    if (termA !== termB) return termB.localeCompare(termA);
    return String(a.name).localeCompare(String(b.name));
  });
}

/**
 * Zoekt een leeruitkomst op code ("LO1", "1") of op een stukje naam.
 *
 * Let op de valkuil: meerdere cursussen hebben een LO1 met een verschillende
 * betekenis. INTERN5 heeft "LO1 Professional duties", V-OL-MAIFS heeft
 * "LO1 Responsible AI for Society". Een blinde zoektocht pakt de eerste die
 * hij tegenkomt, en dan belandt een document in de verkeerde map.
 *
 * Daarom:
 *   - kun je met `preferCourseIds` een cursus voorrang geven (de cursus waar je
 *     op dat moment in werkt);
 *   - krijg je álle treffers terug via `matchAllOutcomes`, zodat de UI kan
 *     vragen welke je bedoelt in plaats van te gokken.
 *
 * @param {object[]} profiles
 * @param {string} query
 * @param {object} [options]
 * @param {number[]} [options.preferCourseIds]  cursussen die voorgaan
 */
export function matchOutcome(profiles, query, { preferCourseIds = [] } = {}) {
  const hits = matchAllOutcomes(profiles, query);
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0];

  const preferred = hits.filter((h) => preferCourseIds.includes(h.courseId));
  return preferred[0] ?? hits[0];
}

/** Alle leeruitkomsten die op de zoekterm passen, in cursusvolgorde. */
export function matchAllOutcomes(profiles, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const codeMatch = /^(?:lo)?\s*(\d{1,2})$/.exec(needle);

  const hits = [];
  for (const profile of profiles) {
    for (const outcome of profile.outcomes) {
      const codeHit = codeMatch
        ? outcome.code === `LO${codeMatch[1]}` ||
          String(outcome.code ?? '').replace(/^LO/, '') === codeMatch[1]
        : false;

      const textHit = codeMatch
        ? false
        : `${outcome.code ?? ''} ${outcome.name} ${outcome.raw}`.toLowerCase().includes(needle);

      if (codeHit || textHit) {
        hits.push({ ...outcome, courseId: profile.id, courseName: profile.name, term: profile.term });
      }
    }
  }
  return hits;
}
