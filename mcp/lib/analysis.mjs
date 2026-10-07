/**
 * Analysis layer: turns raw Canvas assignments into portfolio insight.
 *
 * Design choice: coverage is keyed on the *rubric criterion text*, not on
 * learning-outcome codes. Fontys ICT turns out to use at least four different
 * rubric conventions across semesters:
 *
 *   "LO 1: Situation Orientation"          (MA-NCA-T)
 *   "Leeruitkomst 1: Professional standard" (INTERN5-T-CMK)
 *   "5a.(Ba) Professionele standaard."      (I2-DB-T, older rubrics)
 *   "Responsible AI for Society"            (MA-ISP, no LO code at all)
 *
 * A parser that only understands "LO <n>" would silently drop the last two and
 * report an empty portfolio. Keying on the criterion text keeps every rubric
 * visible and needs no curriculum hardcoding. LO codes are still extracted and
 * shown when present, because that is the language coaches use.
 */

const KEYWORDS = ['portfolio', 'portflow', 'review', 'eindbeoordeling', 'reflectie'];

/** Canvas descriptions are HTML. Reduce to readable text, preserving line breaks. */
export function htmlToText(html) {
  if (!html) return '';
  let text = String(html);
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '\n- ');
  text = text.replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const lines = text.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim());
  const out = [];
  for (const line of lines) {
    if (line) out.push(line);
    else if (out.length && out[out.length - 1] !== '') out.push('');
  }
  return out.join('\n').trim();
}

export function isPortfolioAssignment(assignment) {
  const haystack = `${assignment.name || ''}\n${htmlToText(assignment.description)}`.toLowerCase();
  return KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/**
 * Extract learning-outcome codes from free text.
 * Understands "LO 3", "LO-3", "LO3", "Leeruitkomst 4" and the "(Ba)/(Ad)" form
 * "5a.(Ba) ..." where the leading number is the outcome.
 */
export function extractLoCodes(...texts) {
  const codes = new Set();
  for (const raw of texts) {
    if (!raw) continue;
    const text = String(raw);
    for (const match of text.matchAll(/\bLO\s*[-_.]?\s*(\d{1,2})\b/gi)) codes.add(`LO${match[1]}`);
    for (const match of text.matchAll(/\bLeeruitkomst(?:en)?\s*[-_.]?\s*(\d{1,2})\b/gi)) {
      codes.add(`LO${match[1]}`);
    }
    for (const match of text.matchAll(/\b(\d{1,2})[a-e]?\.\s*\((?:Ba|Ad)\)/gi)) {
      codes.add(`LO${match[1]}`);
    }
  }
  return [...codes].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
}

function rubricCriteria(assignment) {
  const rubric = assignment?.rubric;
  if (!Array.isArray(rubric)) return [];
  return rubric.filter((c) => c && typeof c === 'object');
}

function criterionKey(description) {
  return String(description || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.:;,]+$/, '')
    .trim();
}

/** Run tasks with bounded concurrency so Canvas is not hammered. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

function normalizeAssignment(assignment, course, submission) {
  const criteria = rubricCriteria(assignment).map((c) => {
    const description = String(c.description || '').trim();
    const longDescription = htmlToText(c.long_description);
    return {
      description,
      longDescription,
      points: c.points ?? null,
      loCodes: extractLoCodes(description, longDescription),
      ratings: (Array.isArray(c.ratings) ? c.ratings : []).map((r) => ({
        description: r?.description ?? null,
        longDescription: htmlToText(r?.long_description),
        points: r?.points ?? null,
      })),
    };
  });

  const loCodes = new Set();
  for (const criterion of criteria) for (const code of criterion.loCodes) loCodes.add(code);

  return {
    assignmentId: assignment.id,
    courseId: course.id,
    courseName: course.name,
    name: assignment.name,
    description: htmlToText(assignment.description),
    dueAt: assignment.due_at ?? null,
    unlockAt: assignment.unlock_at ?? null,
    lockAt: assignment.lock_at ?? null,
    pointsPossible: assignment.points_possible ?? null,
    submissionTypes: assignment.submission_types ?? [],
    htmlUrl: assignment.html_url ?? null,
    rubric: criteria,
    loCodes: [...loCodes].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))),
    state: submission?.workflow_state ?? 'unsubmitted',
    submittedAt: submission?.submitted_at ?? null,
    gradedAt: submission?.graded_at ?? null,
    grade: submission?.grade ?? null,
    score: submission?.score ?? null,
    late: Boolean(submission?.late),
    missing: Boolean(submission?.missing),
    attempts: submission?.attempt ?? null,
    attachments: (submission?.attachments ?? []).map((a) => ({
      displayName: a.display_name ?? null,
      size: a.size ?? null,
      url: a.url ?? null,
    })),
    commentCount: (submission?.submission_comments ?? []).length,
  };
}

/** Every portfolio-related assignment in the account, joined with your own submissions. */
export async function fetchPortfolioAssignments(canvas, { includeDescriptions = true } = {}) {
  const courses = await canvas.get('/api/v1/courses', { per_page: 100 }, { paginate: true });
  const realCourses = (Array.isArray(courses) ? courses : []).filter(
    (c) => c && c.id && c.workflow_state !== 'deleted',
  );

  const perCourse = await mapLimit(realCourses, 5, async (course) => {
    // Canvas requires the bracketed `student_ids[]` form. The bare `student_ids`
    // name makes this endpoint return HTTP 500, which is easy to miss if the
    // error is swallowed — and then every assignment looks unsubmitted.
    const [assignments, submissions] = await Promise.all([
      canvas.get(
        `/api/v1/courses/${course.id}/assignments`,
        { per_page: 200, 'include[]': ['rubric'] },
        { paginate: true },
      ),
      canvas.get(
        `/api/v1/courses/${course.id}/students/submissions`,
        { 'student_ids[]': ['self'], per_page: 100 },
        { paginate: true },
      ),
    ]);

    const byAssignment = new Map();
    for (const submission of Array.isArray(submissions) ? submissions : []) {
      if (submission?.assignment_id != null) byAssignment.set(submission.assignment_id, submission);
    }

    return (Array.isArray(assignments) ? assignments : [])
      .filter(isPortfolioAssignment)
      .map((assignment) => {
        const normalized = normalizeAssignment(assignment, course, byAssignment.get(assignment.id));
        if (!includeDescriptions) normalized.description = '';
        return normalized;
      });
  });

  const all = perCourse.flat();
  all.sort(compareByDue());
  return all;
}

/** Due date ascending; assignments without a due date sort last, not first. */
export function compareByDue() {
  return (a, b) => {
    const left = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
    const right = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
    if (left !== right) return left - right;
    return String(a.name).localeCompare(String(b.name));
  };
}

export function isOpen(item) {
  return item.state === 'unsubmitted';
}

export function bucketByTime(items, now = new Date()) {
  const overdue = [];
  const upcoming = [];
  const undated = [];
  for (const item of items) {
    if (!item.dueAt) undated.push(item);
    else if (Date.parse(item.dueAt) < now.getTime()) overdue.push(item);
    else upcoming.push(item);
  }
  return { overdue, upcoming, undated };
}

function evidenceOf(item) {
  return {
    assignmentId: item.assignmentId,
    courseId: item.courseId,
    courseName: item.courseName,
    name: item.name,
    dueAt: item.dueAt,
    state: item.state,
    grade: item.grade,
    score: item.score,
    gradedAt: item.gradedAt,
    submittedAt: item.submittedAt,
    attachments: item.attachments,
  };
}

/**
 * Coverage per rubric criterion.
 *
 * A criterion is "covered" as soon as any assignment carrying it has been
 * submitted or graded; otherwise it is a gap. Nothing is hardcoded, so this
 * works for every semester convention in the account.
 */
export function buildCriterionCoverage(assignments) {
  const map = new Map();

  for (const item of assignments) {
    for (const criterion of item.rubric) {
      const description = criterion.description;
      if (!description) continue;
      const key = criterionKey(description);
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: description,
          loCodes: new Set(),
          courses: new Set(),
          pointsSeen: new Set(),
          covered: [],
          gaps: [],
        });
      }
      const entry = map.get(key);
      for (const code of criterion.loCodes) entry.loCodes.add(code);
      entry.courses.add(`${item.courseName} (${item.courseId})`);
      if (criterion.points != null) entry.pointsSeen.add(criterion.points);

      const evidence = evidenceOf(item);
      if (item.state === 'unsubmitted') entry.gaps.push(evidence);
      else entry.covered.push(evidence);
    }
  }

  return [...map.values()]
    .map((entry) => {
      const graded = entry.covered.filter((e) => e.state === 'graded' || e.gradedAt);
      return {
        label: entry.label,
        loCodes: [...entry.loCodes].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))),
        courses: [...entry.courses],
        points: [...entry.pointsSeen],
        evidence: entry.covered,
        gaps: entry.gaps,
        evidenceCount: entry.covered.length,
        gapCount: entry.gaps.length,
        gradedCount: graded.length,
        status:
          graded.length > 0
            ? 'beoordeeld'
            : entry.covered.length > 0
              ? 'ingeleverd, nog niet beoordeeld'
              : 'geen bewijs',
      };
    })
    .sort((a, b) => {
      if (a.gapCount !== b.gapCount) return b.gapCount - a.gapCount;
      return a.label.localeCompare(b.label);
    });
}

/** Roll criterion coverage up under its LO code, for the codes that have one. */
export function summariseByLo(assignments) {
  const map = new Map();
  for (const item of assignments) {
    for (const code of item.loCodes) {
      if (!map.has(code)) map.set(code, { code, total: 0, withEvidence: 0, assignments: [] });
      const entry = map.get(code);
      entry.total += 1;
      if (item.state !== 'unsubmitted') entry.withEvidence += 1;
      entry.assignments.push({
        name: item.name,
        courseName: item.courseName,
        state: item.state,
        dueAt: item.dueAt,
      });
    }
  }
  return [...map.values()].sort((a, b) => Number(a.code.slice(2)) - Number(b.code.slice(2)));
}
