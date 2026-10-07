/**
 * cavascp dashboard — front-end.
 *
 * Geen framework en geen build-stap: dit is één module die de server-API leest
 * en de DOM incrementeel opbouwt. Alles wat uit Canvas komt gaat via
 * textContent naar binnen, nooit via innerHTML — opdrachtnamen bevatten
 * tekens als ❗ en & die anders de layout slopen of HTML injecteren.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const DAY = 86_400_000;

/**
 * Sessiesleutel voor downloads.
 *
 * De sessiecookie is HttpOnly — JavaScript kan er dus niet bij, en dat hoort zo.
 * Een <a download> kan geen header meesturen, dus voor die ene route is de
 * sleutel als queryparameter nodig. De server zet Referrer-Policy op
 * no-referrer zodat hij niet via een Referer weglekt.
 */
const SESSION_KEY = window.__CAVASCP_KEY__ || '';

/** fetch met de sessiecookie er expliciet bij. */
function api(path, options = {}) {
  return fetch(path, { credentials: 'same-origin', ...options });
}

/** The window the dashboard opens on. Also the reference point for "no filters". */
const DEFAULT_WHEN = '90';

const state = {
  data: null,
  ui: { notes: {}, done: {} },
  docs: [],
  docStats: null,
  // Portflow-collecties worden lui geladen: dat kost een browserstart.
  portflow: { collections: [], loading: false, error: null, user: null },
  // A 90-day window by default. Portfolio deadlines cluster at review moments,
  // so a narrow window hides the next few months of work.
  filter: { when: DEFAULT_WHEN, state: 'all', course: '', q: '' },
  cov: 'all',
  loading: true,
  error: null,
  openId: null,
  /** Vingerafdruk van de laatst gerenderde criterialijst. */
  coverageSignature: null,
};

/* ───────────────────────────── helpers ─────────────────────────────────── */

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' }) : '—';

const fmtFull = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
    : 'geen deadline';

const fmtBytes = (n) =>
  n == null ? '' : n < 1024 ? `${n} B` : n < 1_048_576 ? `${Math.round(n / 1024)} kB` : `${(n / 1_048_576).toFixed(1)} MB`;

function relDays(iso) {
  if (!iso) return 'geen deadline';
  const d = Math.round((Date.parse(iso) - Date.now()) / DAY);
  if (d === 0) return 'vandaag';
  if (d === 1) return 'morgen';
  if (d === -1) return 'gisteren';
  return d > 0 ? `over ${d} d` : `${-d} d te laat`;
}

const STATE_LABEL = { unsubmitted: 'open', submitted: 'ingediend', graded: 'beoordeeld' };

/**
 * Urgency class for an assignment.
 *
 * Note the deliberate distinction between submitted and graded: only a graded
 * assignment counts as demonstrated, so "ingediend" must not be painted as
 * success. That is the same rule the coverage panel applies.
 */
function urgency(item) {
  if (item.state === 'graded') return 'is-graded';
  if (item.state === 'submitted') return 'is-submitted';
  if (!item.dueAt) return '';
  const diff = Date.parse(item.dueAt) - Date.now();
  if (diff < 0) return 'is-overdue';
  if (diff <= DAY) return 'is-due-now';
  if (diff <= 7 * DAY) return 'is-due-soon';
  return '';
}

function pillClass(item) {
  if (item.state === 'graded') return 'pill--graded';
  if (item.state === 'submitted') return 'pill--submitted';
  if (!item.dueAt) return 'pill--open';
  const diff = Date.parse(item.dueAt) - Date.now();
  if (diff < 0) return 'pill--overdue';
  if (diff <= 7 * DAY) return 'pill--soon';
  return 'pill--open';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

let toastTimer;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 2400);
}

/* ─────────────────────────────── data ──────────────────────────────────── */

async function loadData(force = false) {
  state.loading = true;
  state.error = null;
  renderTimeline();
  renderCoverage();
  try {
    const res = await api(`/api/data${force ? '?force=1' : ''}`);
    const body = await res.json();
    if (!res.ok) {
      state.error = body;
      state.data = null;
    } else {
      state.data = body;
    }
  } catch (err) {
    state.error = { error: `Server niet bereikbaar: ${err.message}`, code: 'NETWORK' };
    state.data = null;
  } finally {
    state.loading = false;
    renderAll();
  }
}

async function loadState() {
  try {
    const res = await api('/api/state');
    if (res.ok) state.ui = await res.json();
  } catch {
    /* state is optional; the dashboard works without it */
  }
}

const saveState = debounce(async () => {
  try {
    await api('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: state.ui.notes, done: state.ui.done }),
    });
  } catch {
    toast('Notitie kon niet worden opgeslagen');
  }
}, 500);

/* ───────────────────────────── documenten ──────────────────────────────── */

async function loadDocuments() {
  try {
    const res = await api('/api/documents');
    if (!res.ok) return;
    const body = await res.json();
    state.docs = body.documents ?? [];
    state.docStats = body.stats ?? null;
  } catch {
    /* the inbox is optional; the rest of the dashboard still works */
  }
}

const ICON_DOWNLOAD =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.6v7.2M4.9 6.9 8 10l3.1-3.1M3 12.4h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 4.6h9.2M6.3 4.6V3.4h3.4v1.2M4.7 4.6l.6 8h5.4l.6-8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderDocuments() {
  const host = $('#doclist');
  host.replaceChildren();

  const docs = state.docs;
  $('#inbox-count').textContent = docs.length
    ? `${docs.length}${state.docStats?.unlinked ? ` · ${state.docStats.unlinked} zonder koppeling` : ''}`
    : '';

  if (!docs.length) {
    const box = el('div', 'empty');
    box.append(
      el('h3', null, 'Nog geen documenten'),
      el('p', null, 'Sleep hierboven een bestand naartoe om het klaar te zetten voor je portfolio. Je kunt het daarna in Portflow uploaden via "+ Bewijs toevoegen".'),
    );
    host.append(box);
    return;
  }

  docs.forEach((doc, i) => host.append(documentRow(doc, i)));
}

function documentRow(doc, index) {
  const row = el('div', 'doc');
  row.style.setProperty('--i', Math.min(index, 30));

  const left = el('div');
  left.append(el('div', 'doc__name', doc.title));

  const meta = el('div', 'doc__meta');
  if (doc.loCodes?.length) {
    for (const code of doc.loCodes) meta.append(el('span', 'tag tag--lo', code));
  }
  meta.append(el('span', 'doc__size', fmtBytes(doc.size)));
  const when = new Date(doc.addedAt);
  meta.append(el('span', null, when.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })));
  // An unlinked document is the thing most likely to be forgotten.
  if (!doc.loCodes?.length) meta.append(el('span', 'item__flag', 'nog geen leeruitkomst'));
  // Once sent, show where it landed — that is the whole point of the inbox.
  if (doc.portflow?.collectionName) {
    meta.append(el('span', 'tag', `in Portflow: ${doc.portflow.collectionName}`));
  }
  left.append(meta);

  if (doc.note) {
    const note = el('div', 'doc__note', doc.note);
    left.append(note);
  }

  /* Naar Portflow sturen: collectie kiezen en op de knop drukken. */
  const sendRow = el('div', 'doc__send');
  const select = el('select', 'doc__collection');
  select.setAttribute('aria-label', `Portflow-collectie voor ${doc.title}`);
  const placeholder = el('option', null, state.portflow.loading ? 'collecties laden…' : 'kies collectie');
  placeholder.value = '';
  select.append(placeholder);
  for (const collection of state.portflow.collections) {
    const option = el('option', null, `${collection.name} (${collection.evidenceCount})`);
    option.value = String(collection.id);
    if (doc.portflow?.collectionId === collection.id) option.selected = true;
    select.append(option);
  }
  select.disabled = state.portflow.loading || !state.portflow.collections.length;

  const sendBtn = el('button', 'btn btn--accent btn--sm', 'Naar Portflow');
  sendBtn.type = 'button';
  sendBtn.disabled = select.disabled;
  sendBtn.addEventListener('click', async () => {
    const collectionId = select.value;
    if (!collectionId) {
      toast('Kies eerst een collectie');
      select.focus();
      return;
    }
    sendBtn.classList.add('is-busy');
    sendBtn.textContent = 'Bezig…';
    try {
      const res = await api('/api/portflow/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: doc.id, collectionId: Number(collectionId) }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast(body.error ?? 'Versturen mislukt');
      } else {
        doc.portflow = {
          evidenceId: body.evidenceId,
          collectionId: body.collection?.id ?? null,
          collectionName: body.collection?.name ?? null,
          sentAt: new Date().toISOString(),
        };
        toast(`"${doc.title}" staat nu in ${body.collection?.name ?? 'Portflow'}`);
        renderDocuments();
      }
    } catch (error) {
      toast(`Versturen mislukt: ${error.message}`);
    } finally {
      sendBtn.classList.remove('is-busy');
      sendBtn.textContent = 'Naar Portflow';
    }
  });

  sendRow.append(select, sendBtn);
  left.append(sendRow);

  const actions = el('div', 'doc__actions');

  const dl = el('a', 'iconbtn');
  // Een download kan geen header meesturen, dus hier gaat de sessiesleutel mee
  // als queryparameter. De server zet Referrer-Policy op no-referrer.
  dl.href = `/api/documents/${doc.id}/file${SESSION_KEY ? `?k=${encodeURIComponent(SESSION_KEY)}` : ''}`;
  dl.setAttribute('download', doc.originalName || doc.title);
  dl.title = 'Downloaden';
  dl.innerHTML = ICON_DOWNLOAD;
  actions.append(dl);

  const remove = el('button', 'iconbtn iconbtn--danger');
  remove.type = 'button';
  remove.title = 'Verwijderen';
  remove.innerHTML = ICON_TRASH;
  remove.addEventListener('click', async () => {
    remove.classList.add('is-busy');
    const res = await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
    if (res.ok) {
      const body = await res.json();
      state.docStats = body.stats ?? null;
      state.docs = state.docs.filter((d) => d.id !== doc.id);
      renderDocuments();
      toast('Document verwijderd');
    } else {
      remove.classList.remove('is-busy');
      toast('Verwijderen mislukt');
    }
  });
  actions.append(remove);

  row.append(left, actions);
  return row;
}

/**
 * Collecties uit Portflow ophalen.
 *
 * Dit gaat via een echte browser, want de API eist een LTI-sessietoken dat
 * alleen daar bestaat. Duurt daarom een paar seconden; we doen het één keer en
 * bewaren het resultaat.
 */
async function loadPortflowCollections() {
  state.portflow.loading = true;
  try {
    const res = await api('/api/portflow/collections');
    const body = await res.json();
    if (res.ok && body.ok) {
      state.portflow.collections = body.collections ?? [];
      state.portflow.user = body.user ?? null;
      state.portflow.error = null;
    } else {
      state.portflow.error = body.error ?? 'onbekende fout';
    }
  } catch (error) {
    state.portflow.error = error.message;
  } finally {
    state.portflow.loading = false;
    renderDocuments();
  }
}

/** Upload one or more files. Each is linked to the LO tags given, if any. */
async function uploadFiles(fileList, { loCodes = [], assignmentId = null, courseId = null } = {}) {
  const files = [...fileList];
  if (!files.length) return;

  let uploaded = 0;
  for (const file of files) {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('title', file.name.replace(/\.[^.]+$/, ''));
    if (loCodes.length) form.append('loCodes', loCodes.join(', '));
    if (assignmentId != null) form.append('assignmentId', String(assignmentId));
    if (courseId != null) form.append('courseId', String(courseId));

    try {
      const res = await api('/api/documents', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) {
        toast(`${file.name}: ${body.error ?? 'mislukt'}`);
        continue;
      }
      state.docs.unshift(body.document);
      state.docStats = body.stats ?? null;
      uploaded += 1;
    } catch (err) {
      toast(`${file.name}: ${err.message}`);
    }
  }

  if (uploaded) {
    renderDocuments();
    toast(uploaded === 1 ? 'Document toegevoegd' : `${uploaded} documenten toegevoegd`);
  }
}

/* ────────────────────────────── filtering ──────────────────────────────── */

function visibleAssignments() {
  if (!state.data) return [];
  const { when, state: wanted, course, q } = state.filter;
  const needle = q.trim().toLowerCase();
  const now = Date.now();

  return state.data.assignments.filter((item) => {
    if (course && String(item.courseId) !== course) return false;
    if (wanted !== 'all' && item.state !== wanted) return false;

    if (when === 'overdue') {
      if (item.state !== 'unsubmitted' || !item.dueAt || Date.parse(item.dueAt) >= now) return false;
    } else if (when !== 'all') {
      const days = Number(when);
      if (item.state !== 'unsubmitted' || !item.dueAt) return false;
      const diff = Date.parse(item.dueAt) - now;
      if (diff < 0 || diff > days * DAY) return false;
    }

    if (needle) {
      const hay = [
        item.name,
        item.courseName,
        item.description,
        ...item.rubric.map((c) => c.description),
      ]
        .join('\n')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/* ─────────────────────────────── render ────────────────────────────────── */

function renderAll() {
  // Counts feed the filter chips, so they must be computed before the render
  // that paints those chips.
  updateCounts();
  renderVitals();
  renderTimeline();
  renderCoverage();
  renderCourseOptions();
  renderStamps();
}

function renderStamps() {
  const d = state.data;
  if (!d) {
    $('#stamp').textContent = '—';
    $('#whoami').textContent = 'niet verbonden';
    $('#lede').textContent = state.error
      ? 'Geen verbinding met Canvas.'
      : 'Bezig met ophalen…';
    return;
  }
  const when = new Date(d.generatedAt);
  $('#stamp').textContent =
    `${d.cached ? 'cache' : 'vers'} · ${when.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`;
  $('#foot-stat').textContent =
    `${d.stats.total} portfolio-opdrachten · ${d.stats.criteriaTotal} criteria · opgehaald ${when.toLocaleString('nl-NL')}`;
}

function checkSoon() {
  const d = state.data;
  if (!d) return;
  const next = d.assignments
    .filter((a) => a.state === 'unsubmitted' && a.dueAt && Date.parse(a.dueAt) >= Date.now())
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];
  $('#lede').textContent = next
    ? `Eerstvolgende: ${next.name} — ${fmtFull(next.dueAt)}, ${next.courseName}.`
    : 'Geen openstaande portfolio-deadlines met een datum.';
}

function renderVitals() {
  const host = $('#vitals');
  host.replaceChildren();
  const d = state.data;
  if (!d) return;

  const s = d.stats;
  const vitals = [
    { label: 'te laat', value: s.overdue, mod: s.overdue ? 'vital--alert' : '' },
    { label: 'binnen 7 dagen', value: s.next7, mod: s.next7 ? 'vital--warn' : '' },
    { label: 'nog open', value: s.open, mod: '' },
    { label: 'criteria zonder bewijs', value: s.criteriaGaps, mod: s.criteriaGaps ? 'vital--warn' : 'vital--ok' },
  ];

  vitals.forEach((v, i) => {
    const wrap = el('div', `vital ${v.mod}`.trim());
    wrap.style.setProperty('--i', i);
    wrap.append(el('dd', null, String(v.value)), el('dt', null, v.label));
    host.append(wrap);
  });

  $('#whoami').textContent = `${s.total} opdrachten · ${d.courses.length} cursussen`;
  checkSoon();
}

function renderCourseOptions() {
  const select = $('#course');
  const d = state.data;
  if (!d) return;
  const current = select.value;
  select.replaceChildren(el('option', null, 'alle'));
  select.firstChild.value = '';
  for (const course of d.courses) {
    const option = el('option', null, course.name);
    option.value = String(course.id);
    select.append(option);
  }
  if (current) select.value = current;
}

function renderTimeline() {
  const host = $('#timeline');
  host.replaceChildren();

  if (state.loading) {
    for (let i = 0; i < 6; i += 1) {
      const sk = el('div', 'skeleton');
      sk.append(el('div', 'sk sk--w40'), el('div', 'sk sk--w85'), el('div', 'sk sk--w62'));
      host.append(sk);
    }
    $('#tl-count').textContent = '';
    return;
  }

  if (state.error) {
    host.append(errorBlock(state.error));
    $('#tl-count').textContent = '';
    return;
  }

  const items = visibleAssignments();
  $('#tl-count').textContent = `${items.length} van ${state.data.assignments.length}`;

  if (!items.length) {
    const box = el('div', 'empty');
    box.append(
      el('h3', null, 'Niets in deze selectie'),
      el('p', null, 'Er zijn geen portfolio-opdrachten die bij deze filters passen. Zet een filter terug of wis de zoekterm.'),
    );
    host.append(box);
    return;
  }

  items.forEach((item, i) => host.append(timelineItem(item, i)));
}

function timelineItem(item, index) {
  const node = el('button', `item ${urgency(item)}`.trim());
  node.type = 'button';
  node.style.setProperty('--i', Math.min(index, 30));
  node.dataset.id = String(item.assignmentId);
  node.setAttribute('aria-haspopup', 'dialog');

  const when = el('div', 'item__when');
  when.append(el('b', null, fmtDate(item.dueAt)), el('span', null, relDays(item.dueAt)));

  const body = el('div', 'item__body');
  body.append(el('span', 'item__name', item.name));

  const meta = el('div', 'item__meta');
  meta.append(el('span', 'item__course', item.courseName));
  if (item.attachments.length) meta.append(el('span', null, `${item.attachments.length} bestand(en)`));
  if (item.late) meta.append(el('span', 'item__flag', 'te laat ingeleverd'));
  if (item.missing && item.state === 'unsubmitted') meta.append(el('span', 'item__flag', 'staat als missing'));
  body.append(meta);

  if (item.rubric.length) {
    const tags = el('div', 'item__tags');
    for (const code of item.loCodes) tags.append(el('span', 'tag tag--lo', code));
    const rest = item.rubric.length - item.loCodes.length;
    const shown = item.rubric.slice(0, 3);
    for (const crit of shown) {
      if (crit.loCodes.length) continue;
      tags.append(el('span', 'tag', crit.description.length > 42 ? `${crit.description.slice(0, 42)}…` : crit.description));
    }
    if (item.rubric.length > shown.length) tags.append(el('span', 'tag tag--more', `+${item.rubric.length - shown.length}`));
    body.append(tags);
  }

  const end = el('div', 'item__end');
  end.append(el('span', `pill ${pillClass(item)}`, STATE_LABEL[item.state] ?? item.state));
  if (item.grade != null) end.append(el('span', 'grade', String(item.grade)));

  node.append(when, body, end);
  return node;
}

function errorBlock(err) {
  const box = el('div', 'error');
  box.append(el('h3', null, err.code === 'NO_TOKEN' ? 'Canvas-token ontbreekt' : 'Ophalen mislukt'));
  box.append(el('p', null, err.error || 'Onbekende fout.'));
  if (err.hint) box.append(el('code', null, err.hint));
  return box;
}

/* ────────────────────────────── coverage ───────────────────────────────── */

function renderCoverage() {
  const host = $('#coverage');

  /*
   * De lijst niet blind herbouwen als de inhoud gelijk is.
   *
   * renderCoverage() wordt ook aangeroepen door het debounce van het opslaan.
   * Zonder deze controle maakt dat nieuwe elementen aan, en dan raakt een
   * vinkje kwijt dat de gebruiker net heeft gezet. Alleen verversen als er
   * werkelijk iets veranderd is.
   */
  const signature = JSON.stringify([
    state.loading,
    Boolean(state.error),
    state.cov,
    state.filter.course,
    state.data ? state.data.coverage.length : 0,
    Object.keys(state.ui.done).length,
  ]);
  if (signature === state.coverageSignature && host.childElementCount) return;
  state.coverageSignature = signature;

  host.replaceChildren();

  if (state.loading) {
    for (let i = 0; i < 8; i += 1) {
      const sk = el('div', 'skeleton');
      sk.append(el('div', 'sk sk--w62'), el('div', 'sk sk--w40'));
      host.append(sk);
    }
    $('#cov-count').textContent = '';
    $('#meterfill').style.width = '0%';
    return;
  }

  if (state.error || !state.data) {
    host.append(el('div', 'empty', 'Geen gegevens.'));
    $('#cov-count').textContent = '';
    return;
  }

  const courseId = state.filter.course;
  let list = state.data.coverage;
  if (courseId) {
    list = list.filter((c) => c.courses.some((name) => name.includes(courseId)));
  }
  if (state.cov === 'gap') list = list.filter((c) => c.evidenceCount === 0);
  if (state.cov === 'done') list = list.filter((c) => state.ui.done[keyOf(c)]);

  const d = state.data.stats;
  const pct = d.criteriaTotal ? Math.round(((d.criteriaTotal - d.criteriaGaps) / d.criteriaTotal) * 100) : 0;
  $('#meterfill').style.width = `${pct}%`;
  $('#cov-count').textContent = `${d.criteriaTotal - d.criteriaGaps}/${d.criteriaTotal} · ${pct}%`;

  if (!list.length) {
    const box = el('div', 'empty');
    box.append(
      el('h3', null, 'Geen criteria'),
      el('p', null, 'Geen criteria voor deze selectie.'),
    );
    host.append(box);
    return;
  }

  list.forEach((crit, i) => host.append(coverageRow(crit, i)));
}

const keyOf = (crit) => `cov:${crit.label.toLowerCase().replace(/\s+/g, ' ').trim()}`;

function coverageRow(crit, index) {
  const key = keyOf(crit);
  const checked = Boolean(state.ui.done[key]);
  const mod = crit.evidenceCount === 0 ? 'crit--gap' : crit.status === 'beoordeeld' ? 'crit--ok' : 'crit--partial';

  const row = el('div', `crit ${mod}${checked ? ' is-checked' : ''}`);
  row.style.setProperty('--i', Math.min(index, 40));

  const box = el('input', 'crit__check');
  box.type = 'checkbox';
  box.checked = checked;
  box.dataset.key = key;
  box.setAttribute('aria-label', `Afvinken: ${crit.label}`);
  const body = el('div');
  const label = el('label', 'crit__label', crit.label);
  label.htmlFor = '';
  body.append(label);

  const meta = el('div', 'crit__row');
  meta.append(el('span', 'crit__status', crit.status));
  if (crit.loCodes.length) {
    for (const code of crit.loCodes) meta.append(el('span', 'tag tag--lo', code));
  }
  const n = crit.evidenceCount;
  const g = crit.gapCount;
  meta.append(el('span', null, `${n} met bewijs${g ? ` · ${g} open` : ''}`));
  const courses = crit.courses.map((c) => c.replace(/\s*\(\d+\)$/, '')).join(' · ');
  meta.append(el('span', 'crit__courses', courses.length > 54 ? `${courses.slice(0, 54)}…` : courses));
  body.append(meta);

  box.addEventListener('change', () => {
    /*
     * `box.checked` is hier de betrouwbaarste bron: de browser heeft de waarde
     * al omgezet voordat deze handler loopt. Eerder las ik het model, maar dat
     * loopt uit de pas zodra de server-state nog onderweg is — dan vinkt een
     * klik het vinkje juist uit in plaats van aan.
     */
    const next = box.checked;
    if (next) state.ui.done[key] = true;
    else delete state.ui.done[key];
    row.classList.toggle('is-checked', next);
    saveState();
    if (state.cov === 'done') renderCoverage();
  });

  row.append(box, body);
  return row;
}

/* ─────────────────────────────── drawer ────────────────────────────────── */

function openDrawer(assignmentId) {
  const item = state.data?.assignments.find((a) => a.assignmentId === assignmentId);
  if (!item) return;
  state.openId = assignmentId;

  $('#drawer-eyebrow').textContent = item.courseName;
  $('#drawer-title').textContent = item.name;

  const body = $('#drawer-body');
  body.replaceChildren();

  const dl = el('dl', 'kv');
  const push = (term, value) => {
    dl.append(el('dt', null, term), el('dd', null, value));
  };
  push('Deadline', `${fmtFull(item.dueAt)}${item.dueAt ? ` (${relDays(item.dueAt)})` : ''}`);
  push('Status', `${STATE_LABEL[item.state] ?? item.state}${item.submittedAt ? ` op ${fmtFull(item.submittedAt)}` : ''}`);
  if (item.grade != null) push('Beoordeling', `${item.grade}${item.score != null ? ` · ${item.score} punten` : ''}`);
  if (item.late) push('Let op', 'te laat ingeleverd');
  if (item.missing) push('Let op', 'staat als missing geregistreerd');
  push('Inlevervorm', (item.submissionTypes || []).join(', ') || '—');
  if (item.loCodes.length) push('Leeruitkomsten', item.loCodes.join(', '));
  if (item.htmlUrl) {
    const dd = el('dd');
    const link = el('a', null, 'openen in Canvas');
    link.href = item.htmlUrl;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    dd.append(link);
    dl.append(el('dt', null, 'Canvas'), dd);
  }
  body.append(dl);

  if (item.attachments.length) {
    body.append(el('h3', null, 'Ingediend in Canvas'));
    const ul = el('ul', 'files');
    for (const file of item.attachments) {
      const li = el('li');
      li.append(el('span', null, file.displayName ?? 'bestand'));
      li.append(el('span', null, fmtBytes(file.size)));
      ul.append(li);
    }
    body.append(ul);
  }

  // Documents you staged locally and linked to this assignment, with a drop
  // zone so you can add one without leaving the assignment.
  const linked = state.docs.filter((doc) => doc.assignmentId === item.assignmentId);
  body.append(el('h3', null, `Mijn documenten${linked.length ? ` (${linked.length})` : ''}`));

  const docDrop = el('div', 'drop');
  docDrop.style.margin = '0 0 12px';
  docDrop.append(
    el('div', 'drop__title', 'Sleep een bestand hier om het aan deze opdracht te koppelen'),
    el('div', 'drop__hint', 'Wordt lokaal bewaard. Upload het daarna in Portflow via "+ Bewijs toevoegen".'),
  );
  const docInput = el('input');
  docInput.type = 'file';
  docInput.multiple = true;
  docInput.hidden = true;
  const pickRow = el('div', 'drop__row');
  const pickBtn = el('button', 'btn btn--sm', 'Bestand kiezen');
  pickBtn.type = 'button';
  pickRow.append(pickBtn);
  docDrop.append(pickRow, docInput);
  body.append(docDrop);

  pickBtn.addEventListener('click', () => docInput.click());
  docInput.addEventListener('change', async () => {
    await uploadFiles(docInput.files, {
      loCodes: item.loCodes,
      assignmentId: item.assignmentId,
      courseId: item.courseId,
    });
    docInput.value = '';
    if (state.openId === item.assignmentId) openDrawer(item.assignmentId);
  });
  for (const type of ['dragenter', 'dragover']) {
    docDrop.addEventListener(type, (event) => {
      event.preventDefault();
      docDrop.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    docDrop.addEventListener(type, (event) => {
      event.preventDefault();
      docDrop.classList.remove('is-over');
    });
  }
  docDrop.addEventListener('drop', async (event) => {
    if (!event.dataTransfer?.files?.length) return;
    await uploadFiles(event.dataTransfer.files, {
      loCodes: item.loCodes,
      assignmentId: item.assignmentId,
      courseId: item.courseId,
    });
    if (state.openId === item.assignmentId) openDrawer(item.assignmentId);
  });

  if (linked.length) {
    const ul = el('ul', 'files');
    for (const doc of linked) {
      const li = el('li');
      li.append(el('span', null, doc.title));
      li.append(el('span', null, fmtBytes(doc.size)));
      ul.append(li);
    }
    body.append(ul);
  } else {
    body.append(el('p', 'notes__hint', 'Nog niets gekoppeld aan deze opdracht.'));
  }

  if (item.description) {
    body.append(el('h3', null, 'Omschrijving'));
    body.append(prose(item.description));
  }

  if (item.rubric.length) {
    body.append(el('h3', null, `Criteria (${item.rubric.length})`));
    for (const crit of item.rubric) body.append(critBlock(crit));
  }

  body.append(el('h3', null, 'Mijn notitie'));
  const notes = el('div', 'notes');
  const area = el('textarea');
  area.placeholder = 'Wat moet hier nog gebeuren? Bewaart vanzelf.';
  area.value = state.ui.notes[`asg:${item.assignmentId}`] ?? '';
  const row = el('div', 'notes__row');
  const hint = el('span', 'notes__hint', 'lokaal opgeslagen');
  row.append(hint, el('span', 'notes__hint', 'dashboard/state.json'));
  notes.append(area, row);
  body.append(notes);

  area.addEventListener(
    'input',
    debounce(() => {
      if (area.value.trim()) state.ui.notes[`asg:${item.assignmentId}`] = area.value;
      else delete state.ui.notes[`asg:${item.assignmentId}`];
      saveState();
      hint.textContent = 'opgeslagen';
      hint.classList.add('is-saved');
      setTimeout(() => {
        hint.textContent = 'lokaal opgeslagen';
        hint.classList.remove('is-saved');
      }, 1200);
    }, 450),
  );

  $('#drawer').hidden = false;
  document.body.style.overflow = 'hidden';
  $('.drawer__top .btn', $('#drawer')).focus();
}

function prose(text) {
  const wrap = el('div', 'prose');
  let list = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) {
      list = null;
      continue;
    }
    if (line.startsWith('- ')) {
      if (!list) {
        list = el('ul');
        wrap.append(list);
      }
      list.append(el('li', null, line.slice(2)));
    } else {
      list = null;
      wrap.append(el('p', null, line));
    }
  }
  return wrap;
}

function critBlock(crit) {
  const box = el('div', 'critblock');
  const top = el('div', 'critblock__top');
  top.append(el('span', 'critblock__name', crit.description));
  if (crit.points != null) top.append(el('span', 'critblock__pts', `${crit.points} pt`));
  box.append(top);

  if (crit.loCodes?.length) {
    const codes = el('div', 'critblock__codes');
    for (const code of crit.loCodes) codes.append(el('span', 'tag tag--lo', code));
    box.append(codes);
  }

  if (crit.longDescription) box.append(prose(crit.longDescription));

  if (crit.ratings?.length) {
    const ul = el('ul', 'ratings');
    for (const rating of crit.ratings) {
      if (!rating.description) continue;
      const li = el('li');
      const b = el('b', null, rating.points != null ? String(rating.points) : '—');
      li.append(b, el('span', null, rating.description));
      ul.append(li);
    }
    if (ul.children.length) box.append(ul);
  }
  return box;
}

function closeDrawer() {
  $('#drawer').hidden = true;
  document.body.style.overflow = '';
  state.openId = null;
}

/* ─────────────────────────────── events ────────────────────────────────── */

function syncFilterButtons() {
  $$('.seg__btn[data-when]').forEach((b) => b.classList.toggle('is-on', b.dataset.when === state.filter.when));
  $$('.seg__btn[data-state]').forEach((b) => b.classList.toggle('is-on', b.dataset.state === state.filter.state));
  $$('.seg__btn[data-cov]').forEach((b) => b.classList.toggle('is-on', b.dataset.cov === state.cov));
  syncClearButton();
}

function updateCounts() {
  const d = state.data;
  if (!d) return;
  const now = Date.now();
  const open = d.assignments.filter((a) => a.state === 'unsubmitted');
  const set = (key, value) => {
    const node = $(`[data-n="${key}"]`);
    if (node) node.textContent = String(value);
  };
  set('overdue', open.filter((a) => a.dueAt && Date.parse(a.dueAt) < now).length);
  set('7', open.filter((a) => a.dueAt && Date.parse(a.dueAt) >= now && Date.parse(a.dueAt) - now <= 7 * DAY).length);
  set('30', open.filter((a) => a.dueAt && Date.parse(a.dueAt) >= now && Date.parse(a.dueAt) - now <= 30 * DAY).length);
}

/**
 * Show the "clear filters" affordance only when the user has narrowed things
 * down. The default 90-day window is the starting view, not a filter the user
 * applied, so it must not light this button up.
 */
function syncClearButton() {
  const { when, state: wanted, course, q } = state.filter;
  const active = when !== DEFAULT_WHEN || wanted !== 'all' || course !== '' || q !== '' || state.cov !== 'all';
  $('#clear').hidden = !active;
}

function wire() {
  $('#timeline').addEventListener('click', (event) => {
    const item = event.target.closest('.item');
    if (item) openDrawer(Number(item.dataset.id));
  });

  $('#drawer').addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) closeDrawer();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#drawer').hidden) closeDrawer();
    if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      event.preventDefault();
      $('#q').focus();
    }
  });

  $$('.seg__btn[data-when]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.filter.when = btn.dataset.when;
      syncFilterButtons();
      renderTimeline();
    }),
  );

  $$('.seg__btn[data-state]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.filter.state = btn.dataset.state;
      syncFilterButtons();
      renderTimeline();
    }),
  );

  $$('.seg__btn[data-cov]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.cov = btn.dataset.cov;
      syncFilterButtons();
      renderCoverage();
    }),
  );

  $('#course').addEventListener('change', (event) => {
    state.filter.course = event.target.value;
    syncClearButton();
    renderTimeline();
    renderCoverage();
  });

  $('#q').addEventListener(
    'input',
    debounce((event) => {
      state.filter.q = event.target.value;
      syncClearButton();
      renderTimeline();
    }, 180),
  );

  $('#clear').addEventListener('click', () => {
    state.filter = { when: DEFAULT_WHEN, state: 'all', course: '', q: '' };
    state.cov = 'all';
    $('#q').value = '';
    $('#course').value = '';
    syncFilterButtons();
    renderTimeline();
    renderCoverage();
  });

  $('#refresh').addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.classList.add('is-busy');
    await loadData(true);
    btn.classList.remove('is-busy');
    toast('Verversd bij Canvas');
  });

  wireDropZone();

  $('#theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('cavascp-theme', next);
  });
}

function wireDropZone() {
  const drop = $('#drop');
  const input = $('#file');

  $('#pick').addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    uploadFiles(input.files);
    input.value = '';
  });

  $('#reveal').addEventListener('click', async () => {
    try {
      const res = await api('/api/reveal', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json();
        toast(body.error ?? 'Map openen mislukt');
      }
    } catch {
      toast('Map openen mislukt');
    }
  });

  // dragenter/dragover must be cancelled, otherwise the browser navigates to
  // the dropped file instead of letting us handle it.
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === 'dragleave' && drop.contains(event.relatedTarget)) return;
      drop.classList.remove('is-over');
    });
  }
  drop.addEventListener('drop', (event) => {
    if (event.dataTransfer?.files?.length) uploadFiles(event.dataTransfer.files);
  });

  // Dropping anywhere else on the page should not replace the dashboard.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
}

/**
 * Pick the starting theme.
 *
 * `?theme=light|dark` wins, so a theme can be forced from the URL. That is what
 * makes both variants verifiable in a headless browser, where
 * `--force-prefers-color-scheme` does not reliably reach the page.
 */
function initTheme() {
  const forced = new URLSearchParams(location.search).get('theme');
  if (forced === 'light' || forced === 'dark') {
    document.documentElement.dataset.theme = forced;
    return;
  }
  const saved = localStorage.getItem('cavascp-theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.dataset.theme = saved;
    return;
  }
  document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

/* ─────────────────────────────── start ─────────────────────────────────── */

async function start() {
  initTheme();
  wire();
  syncFilterButtons();
  await Promise.all([loadState(), loadDocuments()]);
  renderDocuments();
  // Collecties pas ophalen als er iets te versturen valt: het kost een
  // browserstart, dus niet bij elk bezoek.
  if (state.docs.length) loadPortflowCollections();
  await loadData();
  // Counts depend on fetched data, so refresh them whenever the vitals rerender.
  const observer = new MutationObserver(updateCounts);
  observer.observe($('#vitals'), { childList: true });
}

start();
