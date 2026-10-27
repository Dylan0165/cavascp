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

/**
 * Het tijdvenster waarop het dashboard opent.
 *
 * Vier weken: wat binnenkort speelt. Alles daarbuiten is ruis, en de vorige
 * versie zette opdrachten uit december naast die van volgende week.
 */
const DEFAULT_WHEN = '28';

const state = {
  /**
   * Het lichte overzicht: semesters, cursussen, documenten. Dit komt als eerste
   * binnen, zodat de pagina snel iets toont.
   */
  overview: null,
  /** De analyse van het gekozen semester: opdrachten, criteria, statistieken. */
  term: null,
  /** Welk semester je bekijkt. Leeg = het huidige. */
  activeTerm: null,
  /** Welke tab: tijdlijn, ingeleverd of portflow. */
  tab: 'timeline',

  ui: { notes: {}, done: {} },
  docs: [],
  docStats: null,
  // Portflow-collecties worden lui geladen: dat kost een browserstart.
  portflow: { collections: [], loading: false, error: null, user: null },

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

/* ────────────────────────── documentwerkplek ──────────────────────────── */

/**
 * De documentwerkplek.
 *
 * Een eigen plek om documenten te maken en in te leveren. De generator komt uit
 * Krava (overgezet in mcp/lib/), maar dit staat op zichzelf: Krava hoeft niet te
 * draaien en er wordt niets naar buiten gestuurd tot je op versturen drukt.
 */
const werk = {
  /** De lijst met documenten, zonder de volledige tekst. */
  lijst: [],
  /** Het document dat openstaat. */
  document: null,
  /** De laatste leeruitkomst-check. */
  check: null,
  /** Loopt er een check of een opslag? */
  bezig: false,
  /** Is de tekst gewijzigd sinds de laatste keer opslaan? */
  vies: false,
  fout: null,
  /** Krava-projecten die over te nemen zijn. */
  krava: { projecten: [], geladen: false, running: false, appUrl: null },
  /** Is de eigen documentenlijst al binnen? Zonder dit lijkt de lijst leeg. */
  lijstGeladen: false,
  /** De mappen van dit semester met hun inhoud, voor de Portflow-tab. */
  mappen: { data: null, geladen: false, bezig: false, fout: null, open: null },
  /** De snapshots van dit portfolio, voor de Portflow-tab. */
  snapshots: { data: null, geladen: false, bezig: false, fout: null, open: false },
};

/** Hoe lang is een document, ruwweg uitgedrukt in woorden. */
function werkOmvang(document) {
  const loop = (lijst) =>
    lijst.reduce((n, s) => n + String(s.tekst || '').split(/\s+/).filter(Boolean).length + loop(s.subsecties || []), 0);
  return { woorden: loop(document.plan?.secties || []), secties: (document.plan?.secties || []).length };
}

async function laadDocumenten() {
  try {
    const res = await api('/api/documenten');
    if (res.ok) {
      werk.lijst = (await res.json()).documenten ?? [];
    } else {
      werk.fout = `Documenten laden gaf status ${res.status}.`;
    }
  } catch {
    werk.fout = 'Documenten konden niet geladen worden.';
  }
  werk.lijstGeladen = true;
  renderWerk();
}

async function laadKravaProjecten() {
  try {
    const res = await api('/api/krava');
    if (!res.ok) return;
    const body = await res.json();
    werk.krava = {
      projecten: body.projects ?? [],
      geladen: true,
      running: Boolean(body.running),
      appUrl: body.appUrl ?? null,
    };
  } catch {
    werk.krava = { projecten: [], geladen: true, running: false, appUrl: null };
  }
  renderWerk();
}

async function openDocument(id) {
  werk.bezig = true;
  werk.fout = null;
  renderWerk();
  try {
    const res = await api(`/api/documenten/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    werk.document = (await res.json()).document;
    werk.check = null;
    werk.vies = false;
    // De check meteen doen: dan zie je bij het openen al waar het onder valt.
    checkDocumentLO(id);
  } catch (error) {
    werk.fout = `Document openen mislukt: ${error.message}`;
  } finally {
    werk.bezig = false;
    renderWerk();
  }
}

async function nieuwDocument() {
  werk.bezig = true;
  renderWerk();
  try {
    const res = await api('/api/documenten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titel: 'Naamloos document' }),
    });
    const body = await res.json();
    await laadDocumenten();
    await openDocument(body.document.id);
  } catch (error) {
    werk.fout = `Aanmaken mislukt: ${error.message}`;
    werk.bezig = false;
    renderWerk();
  }
}

async function neemKravaProjectOver(projectId, titel) {
  if (!confirm(`"${titel}" overnemen als eigen document?\n\nHet origineel in Krava blijft staan.`)) return;
  werk.bezig = true;
  renderWerk();
  try {
    const res = await api('/api/documenten/van-krava', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `status ${res.status}`);
    }
    const body = await res.json();
    await laadDocumenten();
    await openDocument(body.document.id);
    toast(`"${body.van}" overgenomen`);
  } catch (error) {
    werk.fout = `Overnemen mislukt: ${error.message}`;
    werk.bezig = false;
    renderWerk();
  }
}

const bewaarDocument = debounce(async () => {
  if (!werk.document || !werk.vies) return;
  const id = werk.document.id;
  try {
    const res = await api(`/api/documenten/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titel: werk.document.titel,
        subtitel: werk.document.subtitel,
        auteur: werk.document.auteur,
        vak: werk.document.vak,
        begeleiders: werk.document.begeleiders,
        brief: werk.document.brief,
        plan: werk.document.plan,
      }),
    });
    if (res.ok) {
      werk.vies = false;
      renderWerkLijst();
    }
  } catch {
    toast('Opslaan mislukt — je wijzigingen staan nog in het venster');
  }
}, 900);

async function verwijderDocument(id, titel) {
  if (!confirm(`"${titel}" verwijderen? Dit kan niet terug.`)) return;
  try {
    await api(`/api/documenten/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (werk.document?.id === id) {
      werk.document = null;
      werk.check = null;
    }
    await laadDocumenten();
    toast('Verwijderd');
  } catch {
    toast('Verwijderen mislukt');
  }
}

async function checkDocumentLO(id) {
  try {
    const res = await api(`/api/documenten/${encodeURIComponent(id)}/leeruitkomsten`);
    if (!res.ok) return;
    // Alleen tonen als het nog om hetzelfde document gaat.
    if (werk.document?.id !== id) return;
    werk.check = await res.json();
    renderWerkCheck();
  } catch {
    /* de check is een extraatje; zonder werkt het document ook */
  }
}

/** Voegt een lege sectie toe onderaan het document. */
function voegSectieToe() {
  if (!werk.document) return;
  const secties = werk.document.plan?.secties ?? [];
  secties.push({
    id: `s-${Date.now().toString(36)}`,
    titel: 'Nieuwe sectie',
    niveau: 1,
    tekst: '',
    subsecties: [],
    status: 'leeg',
  });
  werk.document.plan = { ...(werk.document.plan ?? {}), secties };
  werk.vies = true;
  renderWerkDocument();
  bewaarDocument();
}

function verwijderSectie(index) {
  if (!werk.document) return;
  const secties = werk.document.plan?.secties ?? [];
  if (!secties[index]) return;
  if (!confirm(`Sectie "${secties[index].titel}" verwijderen?`)) return;
  secties.splice(index, 1);
  werk.vies = true;
  renderWerkDocument();
  bewaarDocument();
}

/* ─────────────────────────────── data ──────────────────────────────────── */

/**
 * Het lichte overzicht ophalen: semesters en cursussen.
 *
 * Daarna laden we meteen het semester dat je moet zien — het huidige, of anders
 * het nieuwste. Zo staat er iets bruikbaars zodra de pagina opent.
 */
async function loadOverview(force = false) {
  state.loading = true;
  state.error = null;
  renderAll();
  try {
    const res = await api(`/api/data${force ? '?force=1' : ''}`);
    const body = await res.json();
    if (!res.ok) {
      state.error = body;
      state.overview = null;
      state.term = null;
      return;
    }
    state.overview = body;

    /*
     * Kies het semester om mee te openen.
     *
     * De lijst staat chronologisch (nieuwste eerst), maar dat betekent dat een
     * semester dat nog moet beginnen bovenaan kan staan. Dit bepaalt wat je
     * ziet als de pagina opent: het huidige semester, en anders het recentste
     * dat nog werk heeft.
     */
    const semesters = body.semesters ?? [];
    const preferred =
      semesters.find((s) => s.code === state.activeTerm) ??
      semesters.find((s) => s.isCurrent) ??
      semesters.find((s) => !s.isFuture && s.stats.assignments > 0) ??
      semesters.find((s) => s.stats.assignments > 0) ??
      semesters[0];

    state.activeTerm = preferred?.code ?? null;
    await loadTerm(state.activeTerm);
  } catch (err) {
    state.error = { error: `Server niet bereikbaar: ${err.message}`, code: 'NETWORK' };
    state.overview = null;
    state.term = null;
  } finally {
    state.loading = false;
    renderAll();
  }
}

/** De analyse van één semester ophalen. */
async function loadTerm(termCode) {
  if (!termCode) {
    state.term = null;
    return;
  }
  try {
    const res = await api(`/api/data?term=${encodeURIComponent(termCode)}`);
    const body = await res.json();
    if (res.ok) {
      state.term = body;
      // De cursusfilter hoort bij het semester: een vak uit een ander semester
      // kiezen zou een lege lijst geven.
      const allowed = new Set((body.courses ?? []).map((c) => String(c.id)));
      if (state.filter.course && !allowed.has(state.filter.course)) state.filter.course = '';
    }
  } catch {
    /* het overzicht blijft staan; alleen dit semester ontbreekt */
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

/**
 * Toont wat de app denkt waar een document hoort.
 *
 * Waarom dit geen automatische knop is: het kiest de map voor, maar jij drukt
 * op versturen. En de reden staat erbij, zodat je kunt zien waarom — een
 * voorstel zonder uitleg is een gok.
 */
function toonIndeling(host, uit, select, doc) {
  const bestaand = host.querySelector('.indeling');
  if (bestaand) bestaand.remove();

  const box = el('div', 'indeling');

  if (!uit.tekst?.gelukt) {
    box.append(el('p', 'indeling__let', uit.tekst?.reden ?? 'De tekst kon niet gelezen worden.'));
    host.append(box);
    return;
  }

  box.append(el('p', 'indeling__uitleg', uit.uitleg));

  if (uit.voorstel) {
    const kop = el('p', 'indeling__voorstel');
    kop.append(el('span', null, 'Hoort bij '));
    kop.append(el('b', null, uit.voorstel.mapNaam));
    box.append(kop);

    if (uit.voorstel.redenen?.length) {
      box.append(el('p', 'indeling__reden', uit.voorstel.redenen.join(' · ')));
    }

    /*
     * De collectie voorzetten. We zoeken de optie op id, want namen kunnen
     * dubbel voorkomen (twee mappen heten "Persoonlijk project").
     */
    const optie = [...select.options].find((o) => Number(o.value) === Number(uit.voorstel.mapId));
    if (optie) {
      select.value = optie.value;
      select.classList.add('is-voorgesteld');
    }
  }

  const lo = uit.leeruitkomsten?.gevonden ?? [];
  if (lo.length) {
    const lijst = el('div', 'indeling__lo');
    for (const t of lo) {
      const aan = (uit.aanbevolenLeeruitkomsten ?? []).includes(t.code);
      const chip = el('span', `indeling__chip${aan ? ' is-aan' : ''}`);
      chip.append(el('b', null, t.code));
      chip.append(document.createTextNode(' '));
      chip.append(el('span', null, t.naam));
      chip.append(el('i', null, `${Math.round((t.relatief ?? 0) * 100)}%`));
      chip.title = aan ? 'Wordt aangezet bij het versturen' : 'Hoort volgens de check bij een andere map';
      lijst.append(chip);
    }
    box.append(lijst);
    box.append(
      el(
        'p',
        'indeling__reden',
        'De aangevinkte leeruitkomsten horen bij deze map. De andere zijn gevonden maar horen elders.',
      ),
    );
  }

  if (uit.voorgesteldeBeschrijving) {
    const rij = el('div', 'indeling__beschrijving');
    rij.append(el('label', 'work__label', 'Voorgestelde toelichting'));
    rij.append(el('p', null, uit.voorgesteldeBeschrijving));
    box.append(rij);

    const overnemen = el('button', 'btn btn--ghost btn--sm', 'Deze toelichting gebruiken');
    overnemen.type = 'button';
    overnemen.addEventListener('click', () => {
      doc.note = uit.voorgesteldeBeschrijving;
      toast('Toelichting overgenomen — hij gaat mee bij het versturen');
    });
    box.append(overnemen);
  }

  const marge = el('p', 'indeling__reden');
  marge.textContent = `Tekst gelezen: ${uit.tekst.bruikbaar ?? uit.tekst.tekens} tekens bruikbaar van ${uit.tekst.tekens}.`;
  box.append(marge);

  host.append(box);
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

  /*
   * De automatiseringslaag: de app leest het bestand en zegt waar het hoort.
   * Dit zet de collectie voor en toont de leeruitkomsten met een reden erbij.
   */
  const indeelBtn = el('button', 'btn btn--ghost btn--sm', 'Waar hoort dit?');
  indeelBtn.type = 'button';
  indeelBtn.addEventListener('click', async () => {
    indeelBtn.disabled = true;
    indeelBtn.textContent = 'Kijken…';
    try {
      const res = await api(`/api/documenten/inbox/${encodeURIComponent(doc.id)}/indelen`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `status ${res.status}`);
      toonIndeling(left, body, select, doc);
    } catch (error) {
      toast(`Indelen mislukt: ${error.message}`);
    } finally {
      indeelBtn.disabled = false;
      indeelBtn.textContent = 'Waar hoort dit?';
    }
  });

  sendRow.append(select, sendBtn, indeelBtn);
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
  if (!state.term) return [];
  const { when, state: wanted, course, q } = state.filter;
  const needle = q.trim().toLowerCase();
  const now = Date.now();

  // Op de tab "Ingeleverd" tonen we alleen werk dat klaar is; op de tijdlijn
  // juist wat nog loopt. Dat is hetzelfde filter, met een andere bril.
  const showSubmitted = state.tab === 'submitted';

  return state.term.assignments.filter((item) => {
    if (course && String(item.courseId) !== course) return false;

    if (showSubmitted) {
      if (item.state === 'unsubmitted') return false;
    } else {
      if (item.state !== 'unsubmitted') return false;
    }

    if (wanted !== 'all' && item.state !== wanted) return false;

    /*
     * Het tijdvenster. Standaard vier weken: alleen wat binnenkort speelt.
     * Opdrachten uit december naast die van volgende week maakt onduidelijk
     * wat nu aandacht vraagt.
     */
    if (!showSubmitted) {
      if (when === 'overdue') {
        if (!item.dueAt || Date.parse(item.dueAt) >= now) return false;
      } else if (when !== 'all') {
        if (!item.dueAt) return false;
        const diff = Date.parse(item.dueAt) - now;
        if (diff < 0 || diff > Number(when) * DAY) return false;
      }
    }

    if (needle) {
      const hay = [
        item.name,
        item.courseName,
        item.description,
        ...item.rubric.map((c) => c.description),
        ...item.attachments.map((a) => a.displayName),
      ]
        .join('\n')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/**
 * Wat valt er buiten het venster? Dat tonen we als één regel, zodat je weet dat
 * het bestaat zonder dat het de lijst vervuilt.
 */
function outsideWindow() {
  if (!state.term) return { later: 0, undated: 0 };
  const { when, course } = state.filter;
  if (state.tab === 'submitted' || when === 'all' || when === 'overdue') return { later: 0, undated: 0 };
  const now = Date.now();
  const days = Number(when);
  const pool = state.term.assignments.filter(
    (a) => a.state === 'unsubmitted' && (!course || String(a.courseId) === course),
  );
  return {
    later: pool.filter((a) => a.dueAt && Date.parse(a.dueAt) - now > days * DAY).length,
    undated: pool.filter((a) => !a.dueAt).length,
  };
}

/* ─────────────────────────────── render ────────────────────────────────── */

function renderAll() {
  // Counts feed the filter chips, so they must be computed before the render
  // that paints those chips.
  updateCounts();
  renderSemesters();
  renderTabs();
  renderVitals();
  renderTimeline();
  renderCoverage();
  renderCourseOptions();
  renderStamps();
  renderWerk();
}

/* ─────────────────────── de documentwerkplek ──────────────────────────── */

/**
 * De hele werkplek tekenen.
 *
 * De panelen wisselen op de gekozen tab. Op de documententab verbergen we de
 * tijdlijn en de criteria: je werkt aan één document en die twee leiden dan
 * alleen maar af.
 */
function renderWerk() {
  const paneel = $('#panel-docs');
  paneel.hidden = state.tab !== 'documenten';

  const portflowPaneel = $('#panel-portflow');
  if (portflowPaneel) portflowPaneel.hidden = state.tab !== 'portflow';

  /*
   * De filterbalk hoort bij de tijdlijn: periode, status, cursus en zoeken gaan
   * allemaal over opdrachten. Op de documenten- en Portflow-tab zeggen ze niets,
   * dus verbergen we ze in plaats van loze knoppen te tonen.
   */
  const werkbalk = document.querySelector('.toolbar');
  if (werkbalk) werkbalk.hidden = !(state.tab === 'timeline' || state.tab === 'submitted');

  // De kolommen met de tijdlijn en de criteria horen bij de eerste twee tabs.
  const hoofdkolom = document.querySelector('.col--main');
  const zijkolom = document.querySelector('.col--side');
  const tonen = state.tab === 'timeline' || state.tab === 'submitted';
  if (hoofdkolom) hoofdkolom.hidden = !tonen;
  if (zijkolom) zijkolom.hidden = !tonen;

  if (state.tab === 'documenten') {
    // De lijsten zijn nodig zodra je deze tab opent. Op de andere tabbladen
    // halen we ze niet op: dat kost alleen tijd.
    if (!werk.lijstGeladen) laadDocumenten();
    if (!werk.krava.geladen) laadKravaProjecten();
    renderWerkLijst();
    renderWerkDocument();
  }

  if (state.tab === 'portflow') {
    /*
     * Alleen laden als we het nog niet hebben. Niet bij elke render: dan wordt
     * de lijst opnieuw opgebouwd terwijl je erop klikt, en dan landt je klik op
     * een element dat al weg is.
     */
    if (!werk.mappen.geladen && !werk.mappen.bezig && !werk.mappen.fout) laadMappen();
    renderPortflow();
  }
}

/** De snapshots ophalen. Duurt lang: Portflow opent een browser. */
async function laadSnapshots(vers = false) {
  werk.snapshots.bezig = true;
  werk.snapshots.fout = null;
  renderPortflow();
  try {
    const res = await api(`/api/portflow/snapshots${vers ? '?force=1' : ''}`);
    const body = await res.json();
    if (!res.ok || !body.ok) {
      werk.snapshots.fout = body.error ?? `Portflow gaf status ${res.status}`;
    } else {
      werk.snapshots.data = body;
      werk.snapshots.geladen = true;
      werk.snapshots.open = true;
    }
  } catch (error) {
    werk.snapshots.fout = `Portflow niet bereikbaar: ${error.message}`;
  } finally {
    werk.snapshots.bezig = false;
    renderPortflow();
  }
}

/* ─────────────────────────── portflow-tab ─────────────────────────────── */

/**
 * De mappen van dit semester met hun inhoud.
 *
 * Dit duurt lang (Portflow opent een browser) dus we tonen meteen een
 * laadmelding in plaats van een leeg scherm.
 */
async function laadMappen(vers = false) {
  werk.mappen.bezig = true;
  werk.mappen.fout = null;
  renderPortflow();
  try {
    const res = await api(`/api/portflow/mappen${vers ? '?force=1' : ''}`);
    const body = await res.json();
    if (!res.ok || !body.ok) {
      werk.mappen.fout = body.error ?? `Portflow gaf status ${res.status}`;
    } else {
      werk.mappen.data = body;
      werk.mappen.geladen = true;
      /*
       * De eerste map met inhoud meteen openklappen. Anders zie je alleen drie
       * dichte balken en moet je zelf raden dat je erop kunt klikken.
       */
      const eerste = (body.mappen ?? []).find((m) => (m.bewijs ?? []).length > 0);
      werk.mappen.open = eerste?.id ?? body.mappen?.[0]?.id ?? null;
    }
  } catch (error) {
    werk.mappen.fout = `Portflow niet bereikbaar: ${error.message}`;
  } finally {
    werk.mappen.bezig = false;
    renderPortflow();
  }
}

function renderPortflow() {
  const host = $('#portflow-inhoud');
  if (!host) return;
  host.replaceChildren();

  const m = werk.mappen;

  if (m.bezig && !m.geladen) {
    const wacht = el('div', 'empty');
    wacht.append(
      el('h3', null, 'Portflow wordt gelezen…'),
      el('p', null, 'Er wordt een browser gestart en verbonden met je portfolio. Dit duurt 20 tot 40 seconden.'),
    );
    host.append(wacht);
    return;
  }

  if (m.fout) {
    const fout = el('div', 'empty');
    fout.append(el('h3', null, 'Portflow niet bereikbaar'), el('p', null, m.fout));
    const opnieuw = el('button', 'btn btn--primary btn--sm', 'Opnieuw proberen');
    opnieuw.type = 'button';
    opnieuw.addEventListener('click', () => laadMappen(true));
    fout.append(opnieuw);
    host.append(fout);
    return;
  }

  if (!m.data) {
    host.append(el('div', 'empty', 'De mappen worden geladen…'));
    return;
  }

  const mappen = m.data.mappen ?? [];
  const alleLo = m.data.leeruitkomsten ?? [];

  if (!mappen.length) {
    host.append(el('div', 'empty', 'Geen mappen gevonden voor dit semester.'));
    return;
  }

  /* Bovenaan: welke leeruitkomsten zijn er over alle mappen samen gedekt? */
  const samenGedekt = new Set();
  for (const map of mappen) for (const code of map.gedekt ?? []) samenGedekt.add(code);

  const overzicht = el('div', 'dekking');
  overzicht.append(el('label', 'work__label', 'Leeruitkomsten over alle mappen samen'));
  const balk = el('div', 'dekking__rij');
  for (const lo of alleLo) {
    const chip = el('span', `dekking__chip${samenGedekt.has(lo.code) ? ' is-gedekt' : ''}`);
    chip.append(el('b', null, lo.code));
    /*
     * Een spatie als los tekstknooppunt. Zonder die spatie plakken de code en
     * de naam aan elkaar in de tekstweergave ("LO1Responsible AI").
     */
    chip.append(document.createTextNode(' '));
    chip.append(el('span', null, lo.naam));
    chip.title = samenGedekt.has(lo.code)
      ? 'Hier is bewijs voor'
      : 'Nog geen bewijs in de mappen van dit semester';
    balk.append(chip);
  }
  overzicht.append(balk);
  host.append(overzicht);

  /* Per map een kaart. */
  for (const map of mappen) {
    const kaart = el('div', `map${werk.mappen.open === map.id ? ' is-open' : ''}`);

    const kop = el('button', 'map__kop');
    kop.type = 'button';
    const links = el('span', 'map__links');
    links.append(el('b', null, map.naam));
    links.append(
      el(
        'span',
        'work__meta',
        `${(map.bewijs ?? []).length} bewijsstuk${(map.bewijs ?? []).length === 1 ? '' : 'ken'}` +
          ` · ${(map.gedekt ?? []).length}/6 leeruitkomsten`,
      ),
    );    kop.append(links);

    const loTjes = el('span', 'map__lo');
    for (const lo of alleLo) {
      const gedekt = (map.gedekt ?? []).includes(lo.code);
      loTjes.append(el('span', `map__lo-tje${gedekt ? ' is-gedekt' : ''}`, lo.code));
    }
    kop.append(loTjes);
    kop.addEventListener('click', () => {
      werk.mappen.open = werk.mappen.open === map.id ? null : map.id;
      renderPortflow();
    });
    kaart.append(kop);

    if (werk.mappen.open === map.id) {
      const body = el('div', 'map__body');

      /* Wat zit erin. */
      if (!(map.bewijs ?? []).length) {
        body.append(el('p', 'work__meta', 'Deze map is nog leeg.'));
      } else {
        const lijst = el('div', 'map__bewijs');
        for (const stuk of map.bewijs) {
          const rij = el('div', 'map__stuk');
          rij.append(el('span', 'map__stuk-naam', stuk.naam ?? `bewijs ${stuk.id}`));
          rij.append(el('span', 'map__stuk-datum', stuk.gemaakt ? fmtDate(stuk.gemaakt) : ''));
          const codes = el('span', 'map__stuk-lo');
          for (const code of stuk.leeruitkomsten ?? []) codes.append(el('span', 'tag tag--lo', code));
          if (!(stuk.leeruitkomsten ?? []).length) {
            codes.append(el('span', 'work__meta', 'geen leeruitkomst'));
          }
          rij.append(codes);
          lijst.append(rij);
        }
        body.append(lijst);
      }

      /* Wat er nog niet is. */
      if ((map.ontbrekend ?? []).length) {
        const mist = el('p', 'map__mist');
        mist.textContent = `Nog geen bewijs voor: ${map.ontbrekend.join(', ')}`;
        body.append(mist);
      } else {
        body.append(el('p', 'map__klaar', 'Alle zes leeruitkomsten hebben bewijs in deze map.'));
      }

      /* De leeswijzer bekijken en bewaren. */
      const knoppen = el('div', 'map__knoppen');

      const toon = el('button', 'btn btn--ghost btn--sm', 'Leeswijzer bekijken');
      toon.type = 'button';
      toon.addEventListener('click', () => {
        const bestaand = kaart.querySelector('.leeswijzer-tekst');
        if (bestaand) {
          bestaand.remove();
          toon.textContent = 'Leeswijzer bekijken';
          return;
        }
        const pre = el('pre', 'leeswijzer-tekst');
        pre.textContent = map.leeswijzer ?? '';
        kaart.append(pre);
        toon.textContent = 'Leeswijzer verbergen';
      });
      knoppen.append(toon);

      const bewaar = el('button', 'btn btn--ghost btn--sm', 'Als document bewaren');
      bewaar.type = 'button';
      bewaar.addEventListener('click', () => bewaarLeeswijzer(map));
      knoppen.append(bewaar);

      const naarPortflow = el('button', 'btn btn--ghost btn--sm', 'Beschrijving in de map zetten');
      naarPortflow.type = 'button';
      naarPortflow.title =
        'De leeswijzer wordt de beschrijving van de map in Portflow. Dat is wat de docent ziet.';
      naarPortflow.addEventListener('click', () => schrijfLeeswijzerNaarPortflow(map));
      knoppen.append(naarPortflow);

      body.append(knoppen);
      kaart.append(body);
    }

    host.append(kaart);
  }

  const ververs = $('#portflow-ververs');
  if (ververs) {
    ververs.textContent = m.bezig ? 'Bezig…' : 'Verversen';
    ververs.disabled = m.bezig;
  }

  renderSnapshots(host);
}

/**
 * De snapshots onderaan de Portflow-tab.
 *
 * Een snapshot is een bevriezing: je kunt hem niet meer aanpassen, alleen
 * bekijken of verwijderen. Dit laat zien wat je wanneer hebt ingeleverd — en of
 * er per ongeluk een test-snapshot is blijven staan.
 */
function renderSnapshots(host) {
  const s = werk.snapshots;

  const box = el('div', 'snapshots');
  const kop = el('button', 'snapshots__kop');
  kop.type = 'button';

  const titel = el('span', 'snapshots__titel');
  titel.append(el('b', null, 'Snapshots'));
  const aantal = s.data?.aantal ?? null;
  /*
   * Let op de spatie tussen de twee delen. Zonder die spatie plakken ze aan
   * elkaar in de tekstweergave: "Snapshots20 in je portfolio".
   */
  titel.append(document.createTextNode(' '));
  titel.append(
    el(
      'span',
      'work__meta',
      s.bezig
        ? 'laden…'
        : aantal !== null
          ? `${aantal} in je portfolio`
          : s.fout
            ? 'niet geladen'
            : 'nog niet opgehaald',
    ),
  );
  kop.append(titel);
  kop.append(el('span', 'snapshots__pijl', s.open ? '▾' : '▸'));
  kop.addEventListener('click', () => {
    // Nog niets opgehaald? Dan nu ophalen in plaats van een leeg vak tonen.
    if (!s.geladen && !s.bezig) {
      laadSnapshots();
      return;
    }
    s.open = !s.open;
    renderPortflow();
  });
  box.append(kop);

  if (s.fout) {
    const fout = el('p', 'inlever__fout', s.fout);
    box.append(fout);
    const opnieuw = el('button', 'btn btn--ghost btn--sm', 'Opnieuw proberen');
    opnieuw.type = 'button';
    opnieuw.addEventListener('click', () => laadSnapshots(true));
    box.append(opnieuw);
    host.append(box);
    return;
  }

  if (!s.open) {
    host.append(box);
    return;
  }

  if (s.bezig && !s.geladen) {
    box.append(el('p', 'work__meta', 'Portflow wordt gelezen; dit duurt 20 tot 40 seconden.'));
    host.append(box);
    return;
  }

  const lijst = s.data?.snapshots ?? [];
  if (!lijst.length) {
    box.append(el('p', 'work__meta', 'Nog geen snapshots gemaakt.'));
    host.append(box);
    return;
  }

  const rijen = el('div', 'snapshots__lijst');
  for (const snap of lijst) {
    const rij = el('div', 'snapshots__rij');

    const links = el('span', 'snapshots__naam');
    links.append(el('b', null, snap.naam ?? `snapshot ${snap.id}`));
    const meta = el('span', 'work__meta');
    if (snap.gemaakt) meta.append(el('span', null, fmtDate(snap.gemaakt)));
    if (snap.versie) meta.append(el('span', null, `v${snap.versie}`));
    if (snap.inleveringen) {
      meta.append(el('span', 'snapshots__ingeleverd', `ingeleverd (${snap.inleveringen})`));
    } else {
      meta.append(el('span', null, 'niet ingeleverd'));
    }
    links.append(meta);
    rij.append(links);

    /* Een showcase-link, als Portflow die heeft gemaakt. */
    if (snap.showcaseUrl) {
      const link = el('a', 'snapshots__link', 'openen');
      link.href = snap.showcaseUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      rij.append(link);
    } else if (snap.code) {
      rij.append(el('span', 'snapshots__code', snap.code));
    }

    rijen.append(rij);
  }
  box.append(rijen);

  /* Waarschuwen als er iets tussen staat dat op een test lijkt. */
  const test = lijst.filter((x) => /test/i.test(x.naam ?? ''));
  if (test.length) {
    box.append(
      el(
        'p',
        'indeling__let',
        `Let op: ${test.length} snapshot${test.length === 1 ? '' : 's'} met "test" in de naam. ` +
          'Controleer of die weg kunnen.',
      ),
    );
  }

  const voet = el('div', 'snapshots__voet');
  const ververs = el('button', 'btn btn--ghost btn--sm', 'Opnieuw ophalen');
  ververs.type = 'button';
  ververs.addEventListener('click', () => laadSnapshots(true));
  voet.append(ververs);
  box.append(voet);

  host.append(box);
}

/** De leeswijzer als document in de werkplek zetten. */
async function bewaarLeeswijzer(map) {
  try {
    const res = await api('/api/documenten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titel: `Leeswijzer — ${map.naam}`,
        subtitel: 'Wat er in deze map staat en welke leeruitkomsten het aantoont',
        documenttype: 'leeswijzer',
        brief: 'Automatisch gemaakt uit de inhoud van de map.',
        plan: {
          titel: '',
          ondertitel: '',
          secties: [
            { id: 'leeswijzer', titel: map.naam, niveau: 1, tekst: map.leeswijzer ?? '', subsecties: [] },
          ],
        },
      }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    await laadDocumenten();
    toast(`Leeswijzer voor "${map.naam}" staat bij je documenten`);
  } catch (error) {
    toast(`Bewaren mislukt: ${error.message}`);
  }
}

/** De leeswijzer als beschrijving van de map in Portflow zetten. */
async function schrijfLeeswijzerNaarPortflow(map) {
  if (
    !confirm(
      `De leeswijzer wordt de beschrijving van "${map.naam}" in Portflow.\n\n` +
        'Een bestaande beschrijving wordt overschreven. Doorgaan?',
    )
  ) {
    return;
  }
  try {
    const res = await api('/api/portflow/beschrijving', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collectionId: map.id, tekst: map.leeswijzer }),
    });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error ?? `status ${res.status}`);
    toast(`Beschrijving van "${map.naam}" gezet`);
  } catch (error) {
    toast(`Zetten mislukt: ${error.message}`);
  }
}

/** De lijst links: je documenten, plus wat er over te nemen is. */
function renderWerkLijst() {
  const host = $('#work-list');
  if (!host) return;
  host.replaceChildren();

  const nieuw = el('div', 'work__new');
  const maak = el('button', 'btn btn--primary btn--sm', 'Nieuw document');
  maak.type = 'button';
  maak.addEventListener('click', nieuwDocument);
  nieuw.append(maak);
  host.append(nieuw);

  if (!werk.lijst.length) {
    const leeg = el('p', 'work__meta');
    leeg.style.padding = '0 var(--space-md)';
    leeg.textContent = werk.lijstGeladen ? 'Nog geen documenten.' : 'Laden…';
    host.append(leeg);
  }

  for (const doc of werk.lijst) {
    const knop = el('button', `work__item${werk.document?.id === doc.id ? ' is-on' : ''}`);
    knop.type = 'button';
    knop.append(el('b', null, doc.titel || 'Naamloos'));

    const meta = el('span', 'work__meta');
    meta.append(el('span', null, `${doc.secties} secties`));
    if (doc.bijgewerkt) {
      meta.append(el('span', null, fmtDate(doc.bijgewerkt)));
    }
    knop.append(meta);
    knop.addEventListener('click', () => openDocument(doc.id));
    host.append(knop);
  }

  /* De Krava-projecten. Krava is een los project; hier kun je er een overnemen
     om er in het dashboard verder aan te werken. Ze staan NA je eigen
     documenten, want dat is waar je meestal verder wilt. */
  const projecten = werk.krava.projecten ?? [];
  if (projecten.length) {
    const kop = el('p', 'work__meta');
    kop.style.padding = 'var(--space-sm) var(--space-md) var(--space-2xs)';
    kop.textContent = 'overnemen uit Krava';
    host.append(kop);

    for (const p of projecten) {
      const knop = el('button', 'work__item');
      knop.type = 'button';
      knop.append(el('b', null, p.titel));
      const meta = el('span', 'work__meta');
      meta.append(el('span', null, `${p.secties} secties`));
      meta.append(el('span', null, `${Math.round(p.tekens / 1000)}k tekens`));
      knop.append(meta);
      knop.addEventListener('click', () => neemKravaProjectOver(p.id, p.titel));
      host.append(knop);
    }
  }

  const aantal = $('#docs-count');
  if (aantal) aantal.textContent = werk.lijst.length ? `${werk.lijst.length} documenten` : '';
}

/** Het document rechts: titel, velden, secties, en de knoppen. */
function renderWerkDocument() {
  const host = $('#work-main');
  if (!host) return;

  const doc = werk.document;
  host.replaceChildren();

  if (werk.fout) {
    const fout = el('div', 'empty');
    fout.append(el('h3', null, 'Er ging iets mis'), el('p', null, werk.fout));
    host.append(fout);
    return;
  }

  if (!doc) {
    const leeg = el('div', 'empty');
    leeg.append(
      el('h3', null, 'Geen document open'),
      el('p', null, 'Kies links een document, maak een nieuw document, of neem een Krava-project over.'),
    );
    host.append(leeg);
    return;
  }

  /* Titel en de velden die op het omslag komen. */
  const kop = el('div', 'work__kop');

  const titel = el('input');
  titel.type = 'text';
  titel.value = doc.titel ?? '';
  titel.placeholder = 'Titel van het document';
  titel.addEventListener('input', () => {
    doc.titel = titel.value;
    werk.vies = true;
    bewaarDocument();
  });
  kop.append(titel);

  const rij1 = el('div', 'work__rij');
  /*
   * De velden die op het omslag komen. Elk veld heeft een labeltje boven zich
   * in plaats van alleen een placeholder: zonder dat lopen de waarden aan
   * elkaar vast en zie je niet meer welk veld wat is.
   */
  const velden = [
    ['subtitel', 'Ondertitel', 30],
    ['auteur', 'Auteur', 20],
    ['vak', 'Vak', 16],
    ['begeleiders', 'Begeleiders', 20],
  ];
  for (const [sleutel, plaats, breedte] of velden) {
    const vak = el('div', 'work__veld');
    vak.style.flex = `1 1 ${breedte * 8}px`;
    vak.append(el('label', 'work__label', plaats));
    const invoer = el('input');
    invoer.type = 'text';
    invoer.value = doc[sleutel] ?? '';
    invoer.placeholder = plaats;
    invoer.addEventListener('input', () => {
      doc[sleutel] = invoer.value;
      werk.vies = true;
      bewaarDocument();
    });
    vak.append(invoer);
    rij1.append(vak);
  }
  kop.append(rij1);

  const briefVak = el('div', 'work__veld');
  briefVak.append(el('label', 'work__label', 'Samenvatting'));
  const brief = el('input');
  brief.type = 'text';
  brief.value = doc.brief ?? '';
  brief.placeholder = 'Eén of twee regels die op het omslag komen';
  brief.addEventListener('input', () => {
    doc.brief = brief.value;
    werk.vies = true;
    bewaarDocument();
  });
  briefVak.append(brief);
  kop.append(briefVak);
  host.append(kop);

  /* De leeruitkomst-check. */
  const checkHost = el('div', null);
  checkHost.id = 'work-check';
  host.append(checkHost);
  renderWerkCheck();

  /* De secties. */
  const secties = doc.plan?.secties ?? [];
  const lijst = el('div', 'work__secties');

  if (!secties.length) {
    const leeg = el('div', 'empty');
    leeg.append(
      el('h3', null, 'Nog geen secties'),
      el('p', null, 'Een sectie wordt een hoofdstuk in het Word-bestand. Voeg er een toe om te beginnen.'),
    );
    lijst.append(leeg);
  }

  secties.forEach((sectie, index) => {
    const blok = el('div', 'sectie');

    const kopRij = el('div', 'sectie__kop');
    kopRij.append(el('span', 'sectie__nr', String(index + 1)));

    const titelInvoer = el('input');
    titelInvoer.type = 'text';
    titelInvoer.value = sectie.titel ?? '';
    titelInvoer.placeholder = 'Titel van de sectie';
    titelInvoer.addEventListener('input', () => {
      sectie.titel = titelInvoer.value;
      werk.vies = true;
      bewaarDocument();
    });
    kopRij.append(titelInvoer);

    const weg = el('button', 'btn btn--ghost btn--sm', 'Verwijderen');
    weg.type = 'button';
    weg.addEventListener('click', () => verwijderSectie(index));
    kopRij.append(weg);
    blok.append(kopRij);

    const tekst = el('textarea');
    tekst.value = sectie.tekst ?? '';
    tekst.placeholder = 'Schrijf hier de tekst. Markdown mag: ## kop, - lijst, **vet**.';
    tekst.addEventListener('input', () => {
      sectie.tekst = tekst.value;
      werk.vies = true;
      bewaarDocument();
    });
    // De check opnieuw doen als je stopt met typen, zodat je ziet of het
    // document van leeruitkomst verschuift.
    tekst.addEventListener('blur', () => {
      if (werk.document) checkDocumentLO(werk.document.id);
    });
    blok.append(tekst);

    lijst.append(blok);
  });

  host.append(lijst);

  /* De voet: toevoegen, exporteren, inleveren. */
  const voet = el('div', 'work__voet');

  const toevoegen = el('button', 'btn btn--ghost btn--sm', 'Sectie toevoegen');
  toevoegen.type = 'button';
  toevoegen.addEventListener('click', voegSectieToe);
  voet.append(toevoegen);

  const { woorden, secties: aantalSecties } = werkOmvang(doc);
  voet.append(el('span', 'work__meta', `${aantalSecties} secties · ${woorden} woorden${werk.vies ? ' · opslaan…' : ''}`));

  const spacer = el('span');
  spacer.style.flex = '1';
  voet.append(spacer);

  const word = el('a', 'btn btn--ghost btn--sm', 'Word-bestand');
  word.href = `/api/documenten/${encodeURIComponent(doc.id)}/docx${SESSION_KEY ? `?k=${encodeURIComponent(SESSION_KEY)}` : ''}`;
  word.setAttribute('download', '');
  voet.append(word);

  const inleveren = el('button', 'btn btn--primary btn--sm', 'Inleveren bij Portflow');
  inleveren.type = 'button';
  inleveren.addEventListener('click', () => toonInleverpaneel(doc.id));
  voet.append(inleveren);

  const verwijder = el('button', 'btn btn--ghost btn--sm', 'Verwijderen');
  verwijder.type = 'button';
  verwijder.addEventListener('click', () => verwijderDocument(doc.id, doc.titel));
  voet.append(verwijder);

  host.append(voet);

  /* Wat er al met dit document is gebeurd. */
  renderInlevergeschiedenis(doc);
}

/**
 * Het inleverpaneel.
 *
 * Toont de mappen van dit semester en de leeruitkomsten die de check vond, met
 * een vinkje ervoor. Je kunt ze uitzetten voordat je verstuurt — de check is
 * een voorstel, geen besluit.
 */
async function toonInleverpaneel(documentId) {
  const host = $('#work-main');
  if (!host || host.querySelector('#inleverpaneel')) return;

  const doc = werk.document;
  if (!doc) return;

  const paneel = el('div', 'inlever');
  paneel.id = 'inleverpaneel';

  const kop = el('div', 'inlever__kop');
  kop.append(el('h3', null, 'Inleveren bij Portflow'));
  const sluit = el('button', 'btn btn--ghost btn--sm', 'Sluiten');
  sluit.type = 'button';
  sluit.addEventListener('click', () => paneel.remove());
  kop.append(sluit);
  paneel.append(kop);

  /* De mappen ophalen. */
  let mappen = [];
  try {
    const res = await api(`/api/documenten/${encodeURIComponent(documentId)}/mappen`);
    if (res.ok) mappen = (await res.json()).mappen ?? [];
  } catch {
    /* valt terug op niets */
  }

  if (!mappen.length) {
    paneel.append(el('p', 'inlever__fout', 'Geen mappen gevonden. Draai eerst tools/koppel-leeruitkomsten.mjs.'));
    host.append(paneel);
    return;
  }

  /* Welke map? */
  const mapRij = el('div', 'work__veld');
  mapRij.append(el('label', 'work__label', 'Naar welke map'));
  const mapKies = el('select');
  for (const m of mappen) {
    const optie = el('option', null, m.naam);
    optie.value = String(m.portflowCollectionId);
    mapKies.append(optie);
  }
  mapRij.append(mapKies);
  paneel.append(mapRij);

  /* De leeruitkomsten. De check heeft ze gevonden; jij bepaalt. */
  const gevonden = werk.check?.treffers ?? [];
  const aangevinkt = new Set(gevonden.map((t) => t.code));

  const loKop = el('div', 'work__veld');
  loKop.append(el('label', 'work__label', 'Leeruitkomsten die eraan hangen'));
  paneel.append(loKop);

  const loLijst = el('div', 'inlever__lo');
  if (!gevonden.length) {
    loLijst.append(el('p', 'work__meta', 'De check vond geen leeruitkomst met genoeg aanknopingspunten. Je kunt er een aanzetten.'));
  }

  /*
   * Alle zes tonen, niet alleen de gevonden. Anders kun je er niets bijzetten
   * als de check iets mist, en dat gebeurt bij korte documenten.
   */
  const alleZes = [
    { code: 'LO1', naam: 'Responsible AI for Society' },
    { code: 'LO2', naam: 'Data & Knowledge Stewardship' },
    { code: 'LO3', naam: 'Model Interaction & Adaptation' },
    { code: 'LO4', naam: 'Professional Standard' },
    { code: 'LO5', naam: 'Personal Leadership' },
    { code: 'LO6', naam: 'AI-Augmented Learning' },
  ];
  const perCode = new Map(gevonden.map((t) => [t.code, t]));

  for (const lo of alleZes) {
    const treffer = perCode.get(lo.code);
    const rij = el('label', `inlever__lo-rij${treffer ? ' is-gevonden' : ''}`);

    const box = el('input');
    box.type = 'checkbox';
    box.checked = aangevinkt.has(lo.code);
    box.addEventListener('change', () => {
      if (box.checked) aangevinkt.add(lo.code);
      else aangevinkt.delete(lo.code);
    });
    rij.append(box);

    const tekst = el('span', 'inlever__lo-tekst');
    const naam = el('span', 'inlever__lo-naam');
    naam.append(el('b', null, lo.code));
    naam.append(el('span', null, lo.naam));
    tekst.append(naam);
    // Het percentage hoort in dezelfde regel als de naam, rechts uitgelijnd.
    tekst.append(
      el(
        'span',
        treffer ? 'inlever__lo-pct' : 'inlever__lo-pct inlever__lo-pct--leeg',
        treffer ? `${Math.round((treffer.relatief ?? 0) * 100)}%` : '—',
      ),
    );
    rij.append(tekst);

    if (treffer && treffer.begrippen?.length) {
      rij.append(el('span', 'inlever__lo-via', `via ${treffer.begrippen.slice(0, 8).join(', ')}`));
    }
    loLijst.append(rij);
  }
  paneel.append(loLijst);

  /* Toelichting voor de docent. */
  const toeVak = el('div', 'work__veld');
  toeVak.append(el('label', 'work__label', 'Toelichting bij het bewijsstuk'));
  const toelichting = el('input');
  toelichting.type = 'text';
  toelichting.value = doc.brief ?? '';
  toelichting.placeholder = 'Eén regel over wat dit document aantoont';
  toeVak.append(toelichting);
  paneel.append(toeVak);

  /* Versturen. */
  const voet = el('div', 'inlever__voet');
  const knop = el('button', 'btn btn--primary', 'Nu inleveren');
  knop.type = 'button';

  const status = el('span', 'work__meta');
  const melding = el('p', 'inlever__fout');

  knop.addEventListener('click', async () => {
    knop.disabled = true;
    knop.textContent = 'Bezig…';
    melding.textContent = '';
    status.textContent = 'Portflow opent een browser; dit duurt 20 tot 40 seconden.';
    try {
      const res = await api(`/api/documenten/${encodeURIComponent(documentId)}/inleveren`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: Number(mapKies.value),
          goalIds: [...aangevinkt].map((code) => perCode.get(code)?.portflowGoalId).filter(Boolean),
          toelichting: toelichting.value,
        }),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        melding.textContent = body.error ?? `Inleveren mislukt (status ${res.status})`;
        knop.disabled = false;
        knop.textContent = 'Opnieuw proberen';
        status.textContent = '';
        return;
      }
      toast(`Ingeleverd: ${body.geleverd?.bestandsnaam ?? 'document'}`);
      paneel.remove();
      // Het document opnieuw laden zodat de geschiedenis klopt.
      await openDocument(documentId);
    } catch (error) {
      melding.textContent = `Inleveren mislukt: ${error.message}`;
      knop.disabled = false;
      knop.textContent = 'Opnieuw proberen';
      status.textContent = '';
    }
  });

  voet.append(knop, status);
  paneel.append(voet, melding);

  // Vooraan in het paneel, zodat je niet hoeft te zoeken.
  host.insertBefore(paneel, host.firstChild);
  paneel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Wat er al met dit document is gebeurd. */
function renderInlevergeschiedenis(doc) {
  const host = $('#work-main');
  if (!host) return;
  const lijst = doc.inleveringen ?? [];
  if (!lijst.length) return;

  const box = el('div', 'inlever__historie');
  box.append(el('label', 'work__label', `Ingeleverd (${lijst.length}×)`));
  for (const item of [...lijst].reverse().slice(0, 5)) {
    const rij = el('div', 'inlever__historie-rij');
    const wanneer = new Date(item.op).toLocaleString('nl-NL', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    rij.append(el('span', 'inlever__historie-tijd', wanneer));
    rij.append(el('span', null, item.mapNaam ?? `map ${item.mapId}`));
    if (item.leeruitkomsten?.length) {
      rij.append(el('span', 'work__meta', item.leeruitkomsten.map((l) => l.code).join(' ')));
    }
    box.append(rij);
  }
  host.append(box);
}

/** De leeruitkomst-check tonen: welke, hoe sterk, en waaróm. */
function renderWerkCheck() {
  const host = $('#work-check');
  if (!host) return;
  host.replaceChildren();
  if (!werk.check) return;

  const box = el('div', 'lo-lijst');
  box.append(el('p', 'lo-uitleg', werk.check.uitleg ?? ''));

  for (const t of werk.check.treffers ?? []) {
    const rij = el('div', 'lo-rij');
    rij.append(el('span', 'lo-rij__code', t.code));

    const balk = el('div', 'lo-rij__balk');
    const vulling = el('div', 'lo-rij__vulling');
    vulling.style.width = `${Math.max(3, Math.round((t.relatief ?? 0) * 100))}%`;
    balk.append(vulling);
    rij.append(balk);

    rij.append(el('span', 'lo-rij__pct', `${Math.round((t.relatief ?? 0) * 100)}%`));

    if (t.begrippen?.length) {
      rij.append(el('span', 'lo-rij__via', `via: ${t.begrippen.slice(0, 10).join(', ')}`));
    }
    box.append(rij);
  }

  if (!(werk.check.treffers ?? []).length) {
    box.append(el('p', 'lo-rij__via', 'Geen leeruitkomst met genoeg aanknopingspunten.'));
  }

  host.append(box);
}

/* ─────────────────────────── semesters ─────────────────────────────────── */

/**
 * De semesterkiezer.
 *
 * Dit is de eerste beslissing op de pagina: welk semester kijk ik naar? Alles
 * daaronder — tijdlijn, criteria, ingeleverd werk — hangt ervan af. Zonder deze
 * keuze stonden criteria uit 2024 naast een deadline van volgende week.
 */
function renderSemesters() {
  const host = $('#semesters');
  host.replaceChildren();
  const overview = state.overview;

  if (!overview || !(overview.semesters ?? []).length) {
    host.append(el('span', 'semesters__empty', state.loading ? 'Semesters laden…' : 'Geen semesters gevonden'));
    return;
  }

  const semesters = overview.semesters;

  semesters.forEach((semester, i) => {
    const active = semester.code === state.activeTerm;
    const button = el('button', `semester${active ? ' is-on' : ''}${semester.isCurrent ? ' is-current' : ''}`);
    button.type = 'button';
    button.style.setProperty('--i', i);
    button.dataset.term = semester.code ?? '';
    button.setAttribute('aria-pressed', active ? 'true' : 'false');

    const top = el('span', 'semester__label');
    top.append(el('strong', null, semester.short ?? semester.label));
    if (semester.isCurrent) top.append(el('span', 'semester__now', 'nu'));
    button.append(top);

    // Waar het om gaat: wat staat er open, wat is er al klaar.
    const bottom = el('span', 'semester__meta');
    if (semester.stats.open > 0) {
      bottom.append(el('span', 'semester__open', `${semester.stats.open} open`));
    }
    if (semester.stats.overdue > 0) {
      bottom.append(el('span', 'semester__late', `${semester.stats.overdue} te laat`));
    }
    if (semester.stats.submitted > 0) {
      bottom.append(el('span', null, `${semester.stats.submitted} ingeleverd`));
    }
    bottom.append(el('span', 'semester__courses', `${semester.courses.length} vakken`));
    button.append(bottom);

    if (semester.stats.criteriaGaps > 0) {
      button.append(el('span', 'semester__gaps', `${semester.stats.criteriaGaps} criteria open`));
    }

    button.addEventListener('click', () => switchTerm(semester.code));
    host.append(button);
  });
}

async function switchTerm(termCode) {
  if (!termCode || termCode === state.activeTerm) return;
  state.activeTerm = termCode;
  state.term = null;
  state.coverageSignature = null;
  // Filters horen bij het vorige semester: wis ze, anders lijkt het leeg.
  state.filter = { when: DEFAULT_WHEN, state: 'all', course: '', q: '' };
  state.cov = 'all';
  $('#q').value = '';
  renderAll();
  await loadTerm(termCode);
  renderAll();
}

/* ───────────────────────────── tabs ────────────────────────────────────── */

const TABS = [
  { id: 'timeline', label: 'Tijdlijn' },
  { id: 'submitted', label: 'Ingeleverd' },
  { id: 'documenten', label: 'Documenten' },
  { id: 'portflow', label: 'Portflow' },
];

function renderTabs() {
  const host = $('#tabs');
  host.replaceChildren();
  for (const tab of TABS) {
    const button = el('button', `tab${state.tab === tab.id ? ' is-on' : ''}`, tab.label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', state.tab === tab.id ? 'true' : 'false');
    button.addEventListener('click', () => {
      if (state.tab === tab.id) return;
      state.tab = tab.id;
      state.coverageSignature = null;
      renderAll();
    });
    host.append(button);
  }
}

function renderStamps() {
  const overview = state.overview;
  const term = state.term;

  if (!overview && !term) {
    $('#stamp').textContent = '—';
    $('#whoami').textContent = state.error ? 'niet verbonden' : 'laden…';
    $('#lede').textContent = state.error ? 'Geen verbinding met Canvas.' : 'Bezig met ophalen…';
    $('#foot-stat').textContent = '';
    return;
  }

  const when = new Date((term ?? overview).generatedAt);
  $('#stamp').textContent =
    `${(term ?? overview).cached ? 'cache' : 'vers'} · ${when.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`;

  const active = (overview?.semesters ?? []).find((s) => s.code === state.activeTerm);
  $('#whoami').textContent = active
    ? `${active.short} · ${active.courses.length} vakken`
    : `${overview?.courses?.length ?? 0} cursussen`;

  if (term) {
    $('#foot-stat').textContent =
      `${term.stats.total} portfolio-opdrachten · ${term.stats.criteriaTotal} criteria in dit semester · opgehaald ${when.toLocaleString('nl-NL')}`;
  }
}

function checkSoon() {
  const d = state.term;
  if (!d) {
    const active = (state.overview?.semesters ?? []).find((s) => s.code === state.activeTerm);
    $('#lede').textContent = active
      ? `${active.label} — ${active.stats.open} open, ${active.stats.submitted} ingeleverd.`
      : 'Bezig met ophalen…';
    return;
  }
  const next = d.assignments
    .filter((a) => a.state === 'unsubmitted' && a.dueAt && Date.parse(a.dueAt) >= Date.now())
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];
  $('#lede').textContent = next
    ? `Eerstvolgende: ${next.name} — ${fmtFull(next.dueAt)}, ${next.courseName}.`
    : 'Geen openstaande portfolio-deadlines met een datum in dit semester.';
}

function renderVitals() {
  const host = $('#vitals');
  host.replaceChildren();
  const d = state.term;

  if (!d) {
    const active = (state.overview?.semesters ?? []).find((s) => s.code === state.activeTerm);
    if (!active) return;
    const s = active.stats;
    const vitals = [
      { label: 'te laat', value: s.overdue, mod: s.overdue ? 'vital--alert' : '' },
      { label: 'nog open', value: s.open, mod: '' },
      { label: 'ingeleverd', value: s.submitted, mod: '' },
      { label: 'criteria open', value: s.criteriaGaps, mod: s.criteriaGaps ? 'vital--warn' : 'vital--ok' },
    ];
    vitals.forEach((v, i) => {
      const wrap = el('div', `vital ${v.mod}`.trim());
      wrap.style.setProperty('--i', i);
      wrap.append(el('dd', null, String(v.value)), el('dt', null, v.label));
      host.append(wrap);
    });
    checkSoon();
    return;
  }

  const s = d.stats;
  const vitals = [
    { label: 'te laat', value: s.overdue, mod: s.overdue ? 'vital--alert' : '' },
    { label: 'binnen 4 weken', value: s.next30, mod: s.next30 ? 'vital--warn' : '' },
    { label: 'nog open', value: s.open, mod: '' },
    { label: 'ingeleverd', value: s.submitted, mod: s.submitted ? 'vital--ok' : '' },
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

/**
 * De cursuskeuze. Bron is het semester, niet het volledige overzicht: een vak
 * uit een ander semester kiezen zou een lege lijst geven.
 */
function renderCourseOptions() {
  const select = $('#course');
  const courses = state.term?.courses ?? [];
  const current = select.value;

  select.replaceChildren(el('option', null, courses.length ? 'alle' : 'geen vakken'));
  select.firstChild.value = '';
  select.disabled = !courses.length;

  for (const course of courses) {
    const option = el('option', null, course.name);
    option.value = String(course.id);
    select.append(option);
  }
  if (current && courses.some((c) => String(c.id) === current)) select.value = current;
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
  const total = state.term?.assignments.length ?? 0;
  const labels = {
    timeline: `${items.length} in beeld` + (total ? ` van ${total} in dit semester` : ''),
    submitted: `${items.length} ingeleverd`,
    portflow: '',
  };
  $('#tl-count').textContent = labels[state.tab] ?? `${items.length}`;

  if (!items.length) {
    const box = el('div', 'empty');
    if (state.tab === 'submitted') {
      box.append(
        el('h3', null, 'Nog niets ingeleverd in dit semester'),
        el('p', null, 'Zodra je iets inlevert verschijnt het hier, met het cijfer en de beoordeling erbij.'),
      );
    } else {
      box.append(
        el('h3', null, 'Niets in deze selectie'),
        el('p', null, 'Er zijn geen portfolio-opdrachten die bij deze filters passen. Zet een filter terug, verruim het venster of wis de zoekterm.'),
      );
    }
    host.append(box);
    return;
  }

  items.forEach((item, i) => host.append(timelineItem(item, i)));

  /*
   * Wat buiten het venster valt, één regel. Zo weet je dat het bestaat zonder
   * dat het de lijst vervuilt — en met één klik zet je het venster ruimer.
   */
  const outside = outsideWindow();
  if (outside.later || outside.undated) {
    const note = el('div', 'window-note');
    const parts = [];
    if (outside.later) parts.push(`${outside.later} met een latere deadline`);
    if (outside.undated) parts.push(`${outside.undated} zonder deadline`);
    note.append(el('span', null, `Buiten dit venster: ${parts.join(' en ')}.`));
    const widen = el('button', 'btn btn--ghost btn--sm', 'Toon alles');
    widen.type = 'button';
    widen.addEventListener('click', () => {
      state.filter.when = 'all';
      syncFilterButtons();
      renderTimeline();
    });
    note.append(widen);
    host.append(note);
  }
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
    state.term ? state.term.coverage.length : 0,
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

  if (state.error || !state.term) {
    host.append(el('div', 'empty', 'Geen gegevens.'));
    $('#cov-count').textContent = '';
    return;
  }

  const courseId = state.filter.course;
  let list = state.term?.coverage;
  if (courseId) {
    list = list.filter((c) => c.courses.some((name) => name.includes(courseId)));
  }
  if (state.cov === 'gap') list = list.filter((c) => c.evidenceCount === 0);
  if (state.cov === 'done') list = list.filter((c) => state.ui.done[keyOf(c)]);

  const d = state.term?.stats;
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
  const item = state.term?.assignments.find((a) => a.assignmentId === assignmentId);
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
  const d = state.term;
  if (!d) return;
  const now = Date.now();
  const open = d.assignments.filter((a) => a.state === 'unsubmitted');
  const set = (key, value) => {
    const node = $(`[data-n="${key}"]`);
    if (node) node.textContent = String(value);
  };
  set('overdue', open.filter((a) => a.dueAt && Date.parse(a.dueAt) < now).length);
  set('7', open.filter((a) => a.dueAt && Date.parse(a.dueAt) >= now && Date.parse(a.dueAt) - now <= 7 * DAY).length);
}

/**
 * Toon de knop "Filters wissen" alleen als je echt iets hebt ingeperkt.
 *
 * Het venster van vier weken is de beginstand, geen filter dat jij hebt gezet,
 * dus dat mag deze knop niet laten oplichten.
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
    await loadOverview(true);
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
  /*
   * Drie ladingen naast elkaar:
   *   loadState              de notities en afvinklijstjes
   *   loadDocuments          de document-inbox (uploaden naar Portflow)
   *   laadDocumenten         de documentwerkplek (zelf documenten maken)
   *
   * Zonder die laatste bleef de werkplek leeg tot je iets overnam uit Krava,
   * want de lijst werd wel getekend maar nooit gevuld.
   */
  await Promise.all([loadState(), loadDocuments(), laadDocumenten(), laadKravaProjecten()]);
  renderDocuments();
  // Collecties pas ophalen als er iets te versturen valt: het kost een
  // browserstart, dus niet bij elk bezoek.
  if (state.docs.length) loadPortflowCollections();
  await loadOverview();
  // Counts depend on fetched data, so refresh them whenever the vitals rerender.
  const observer = new MutationObserver(updateCounts);
  observer.observe($('#vitals'), { childList: true });

  const ververs = $('#portflow-ververs');
  if (ververs) ververs.addEventListener('click', () => laadMappen(true));
}

start();
