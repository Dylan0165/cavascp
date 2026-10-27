/**
 * De stagepagina.
 *
 * Geen framework, net als de rest van het dashboard: één module, DOM bouwen met
 * textContent. Alles wat uit Canvas of van een bedrijfssite komt is tekst en
 * gaat nooit door innerHTML — dezelfde regel als in app.js.
 *
 * Wat deze pagina doet: de wachtrij tonen, een dagrun starten (lezen + mail
 * schrijven, één bedrijf per verzoek zodat je voortgang ziet), de mail laten
 * nalezen en de status bijhouden. Versturen doet hij niet.
 */

const $ = (sel) => document.querySelector(sel);

/*
 * Korte statuslabels voor in de lijst. De volledige tekst staat in de tooltip:
 * "mail geschreven, nog niet nagekeken" is een zin, geen label.
 */
const KORTE_STATUS = {
  gevonden: 'nieuw',
  gescand: 'gelezen',
  concept: 'concept',
  goedgekeurd: 'goedgekeurd',
  verstuurd: 'verstuurd',
  geantwoord: 'antwoord',
  afgewezen: 'afgewezen',
  gesprek: 'gesprek',
  klaar: 'stage',
};

const state = {
  overzicht: null,
  view: 'vandaag',
  geselecteerd: null,
  detail: null,
  bezig: false,
  stop: false,
};

/* ─────────────────────────────── hulpjes ─────────────────────────────── */

function melding(tekst, soort = 'info') {
  const el = $('#melding');
  if (!tekst) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.dataset.soort = soort;
  el.textContent = tekst;
}

function voortgang(tekst) {
  const el = $('#voortgang');
  if (!tekst) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = tekst;
}

async function api(pad, opties = {}) {
  const antwoord = await fetch(pad, {
    headers: opties.body ? { 'Content-Type': 'application/json' } : undefined,
    method: opties.method ?? (opties.body ? 'POST' : 'GET'),
    body: opties.body ? JSON.stringify(opties.body) : undefined,
  });

  let data = null;
  try {
    data = await antwoord.json();
  } catch {
    data = null;
  }

  if (!antwoord.ok) {
    const tekst = data?.error ?? `De server gaf ${antwoord.status}.`;
    throw new Error(tekst);
  }
  return data;
}

function chip(tekst, attr, waarde) {
  const el = document.createElement('span');
  el.className = 'chip';
  if (attr) el.dataset[attr] = waarde;
  el.textContent = tekst;
  return el;
}

/* ──────────────────────────────── laden ──────────────────────────────── */

async function laad() {
  const overzicht = await api('/api/stage');
  state.overzicht = overzicht;
  renderAlles();
}

function renderAlles() {
  renderKop();
  renderLijst();
  if (state.geselecteerd) renderDetail();
}

function renderKop() {
  const o = state.overzicht;
  if (!o) return;

  $('#quota').textContent = `${o.gedaan} / ${o.limiet} vandaag`;
  $('#gmail').textContent = o.gmail?.gekoppeld ? `Gmail: ${o.gmail.gebruiker}` : 'Gmail niet gekoppeld';

  const stage = o.profiel?.stage ?? {};
  const delen = [
    o.profiel?.naam,
    stage.richting?.length ? stage.richting.join(' · ') : null,
    stage.van && stage.tot ? `stage ${stage.van} – ${stage.tot}` : null,
  ].filter(Boolean);
  $('#profiel-regel').textContent = delen.join('  ·  ');

  /*
   * De eis van Fontys botst met "drie of vier dagen meewerken".
   *
   * Canvas (INTERN5 → Planning) zegt: de stage duurt een volledig semester en
   * je werkt minimaal 90 dagen, fulltime. Een mail die drie dagen belooft,
   * zaait een verwachting die je niet kunt nakomen. Dus zeggen we het hier —
   * vóór je op verzenden drukt, niet erna.
   */
  const teVersturen = (o.teVersturen ?? []).length;
  const allesKnop = $('#verstuur-alles');
  allesKnop.hidden = !(o.gmail?.gekoppeld && teVersturen > 0);
  allesKnop.textContent = teVersturen ? `Verstuur goedgekeurd (${teVersturen})` : 'Verstuur goedgekeurd';

  const dagen = stage.dagenPerWeek;
  const eisen = $('#eisen');
  if (dagen && dagen < 5) {
    eisen.hidden = false;
    eisen.textContent =
      `Let op: Fontys eist een volledig semester stage — minimaal 90 dagen, fulltime ` +
      `(Canvas → INTERN5 → Planning is stagevoorwaarde). Je profiel staat op ${dagen} dagen per week. ` +
      `De mail belooft geen aantal dagen, maar regel dit met je stagecoördinator voordat je verstuurt.`;
  } else {
    eisen.hidden = true;
  }
}

function lijstVoorWeergave() {
  const o = state.overzicht;
  if (!o) return [];
  if (state.view === 'beoordelen') return o.teBeoordelen ?? [];
  if (state.view === 'wachtrij') return o.wachtrij ?? [];
  if (state.view === 'verstuurd') return o.verstuurd ?? [];
  return o.vandaag ?? [];
}

function renderLijst() {
  const host = $('#lijst');
  host.replaceChildren();

  const rijen = lijstVoorWeergave();
  if (!rijen.length) {
    const leeg = document.createElement('li');
    leeg.className = 'leeg';
    leeg.textContent =
      state.view === 'wachtrij'
        ? 'Geen wachtrij. Gebruik “Eigen lijst” of “OpenStreetMap”, of plak een adres.'
        : 'Nog niets in deze weergave.';
    host.append(leeg);
    return;
  }

  for (const bedrijf of rijen) {
    const li = document.createElement('li');
    const knop = document.createElement('button');
    knop.type = 'button';
    knop.className = 'rij';
    knop.setAttribute('aria-current', state.geselecteerd === bedrijf.id ? 'true' : 'false');

    const naam = document.createElement('span');
    naam.className = 'rij__naam';
    naam.textContent = bedrijf.titel;
    knop.append(naam);

    // Een tilde als de locatie uit een adreszoekopdracht komt: dan is het de
    // omgeving van het bedrijf, niet de voordeur.
    const schat = bedrijf.locatieBron === 'gecodeerd' ? '~' : '';
    const stationKm = bedrijf.station?.km;
    const ovTekst =
      bedrijf.ov && bedrijf.ov !== 'onbekend'
        ? `${bedrijf.ov}${stationKm != null ? ` · ${stationKm} km` : ''}`
        : 'OV onbekend';
    knop.append(chip(ovTekst, 'ov', bedrijf.ov ?? 'onbekend'));

    const meta = document.createElement('span');
    meta.className = 'rij__meta';
    const stukken = [
      bedrijf.plaats,
      bedrijf.vanHuisKm != null ? `${schat}${bedrijf.vanHuisKm} km van huis` : null,
      bedrijf.heeftMail ? '✉ mail' : null,
    ].filter(Boolean);
    for (const stuk of stukken) {
      const span = document.createElement('span');
      span.textContent = stuk;
      meta.append(span);
    }
    const statusChip = chip(KORTE_STATUS[bedrijf.status] ?? bedrijf.status, 'status', bedrijf.status);
    statusChip.title = bedrijf.statusLabel ?? bedrijf.status;
    meta.append(statusChip);
    knop.append(meta);

    knop.addEventListener('click', () => selecteer(bedrijf.id));
    li.append(knop);
    host.append(li);
  }
}

/* ─────────────────────────────── detail ──────────────────────────────── */

async function selecteer(id) {
  state.geselecteerd = id;
  renderLijst();
  try {
    state.detail = await api(`/api/stage/bedrijf?id=${encodeURIComponent(id)}`);
  } catch (fout) {
    melding(fout.message, 'fout');
    return;
  }
  renderDetail();
}

function renderDetail() {
  const b = state.detail;
  const host = $('#detail');
  host.replaceChildren();
  if (!b) return;

  const kop = document.createElement('h2');
  kop.textContent = b.titel;
  host.append(kop);

  const meta = document.createElement('p');
  meta.className = 'detail__meta';
  for (const stuk of [b.plaats, b.straat].filter(Boolean)) {
    const span = document.createElement('span');
    span.textContent = stuk;
    meta.append(span);
  }
  const ov = document.createElement('span');
  ov.textContent =
    b.station?.naam != null
      ? `${b.ov} — ${b.station.naam} op ${b.station.km} km${b.vanHuisKm != null ? ` (${b.vanHuisKm} km van huis)` : ''}`
      : b.ov === 'onbekend'
        ? 'OV-afstand onbekend'
        : b.ov;
  meta.append(ov);
  if (b.emails?.length) {
    const mail = document.createElement('span');
    mail.textContent = b.emails.slice(0, 2).join(', ');
    meta.append(mail);
  }
  const link = document.createElement('a');
  link.href = b.url;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  link.textContent = b.domein;
  meta.append(link);
  host.append(meta);

  if (b.mail) {
    const onderwerp = document.createElement('p');
    onderwerp.className = 'mail__onderwerp';
    onderwerp.textContent = b.mail.onderwerp;
    host.append(onderwerp);

    const body = document.createElement('pre');
    body.className = 'mail__body';
    body.textContent = b.mail.volledig;
    host.append(body);

    const oordeel = document.createElement('div');
    oordeel.className = 'oordeel';
    const goed = b.keuring?.goed ?? true;
    oordeel.dataset.goed = String(goed);
    if (goed) {
      oordeel.textContent = `Controle: in orde (${b.keuring?.woorden ?? '?'} woorden)`;
    } else {
      const titel = document.createElement('div');
      titel.textContent = 'Controle: let op';
      const ul = document.createElement('ul');
      for (const punt of b.keuring?.punten ?? []) {
        const li = document.createElement('li');
        li.textContent = punt;
        ul.append(li);
      }
      oordeel.append(titel, ul);
    }
    host.append(oordeel);

    if (b.verzending) {
      const verzonden = document.createElement('p');
      verzonden.className = 'leeg';
      verzonden.style.marginTop = '.75rem';
      const wanneer = new Date(b.verzending.op).toLocaleString('nl-NL');
      verzonden.textContent = `Verstuurd op ${wanneer} naar ${b.verzending.naar}.`;
      host.append(verzonden);
    }

    if (b.mail.waarom) {
      const waarom = document.createElement('p');
      waarom.className = 'leeg';
      waarom.style.marginTop = '.75rem';
      waarom.textContent = `Aanknopingspunt: ${b.mail.waarom}`;
      host.append(waarom);
    }
  } else {
    const nog = document.createElement('p');
    nog.className = 'leeg';
    nog.textContent =
      b.status === 'gevonden'
        ? 'Nog niet gelezen. Gebruik “Lees en schrijf” om de site te lezen en een mail te maken.'
        : 'Geen mail voor dit bedrijf.';
    host.append(nog);
  }

  const acties = document.createElement('div');
  acties.className = 'acties';

  if (!b.mail) {
    acties.append(
      knop('Lees en schrijf', () => scanEen(b.id), 'btn'),
    );
  } else {
    const kanVersturen = ['concept', 'goedgekeurd'].includes(b.status) && (b.emails ?? []).length > 0;
    const verstuurKnop = knop(
      b.status === 'verstuurd' ? 'Al verstuurd' : `Verstuur naar ${b.emails?.[0] ?? '—'}`,
      () => verstuur(b),
      'btn',
    );
    verstuurKnop.disabled = !kanVersturen || !state.overzicht?.gmail?.gekoppeld;
    if (!state.overzicht?.gmail?.gekoppeld) {
      verstuurKnop.title = 'Gmail is nog niet gekoppeld — zie docs/stagebot.md';
    }

    acties.append(
      verstuurKnop,
      knop('Kopieer mail', () => kopieer(b.mail.volledig), 'btn btn--ghost'),
      knop('Goedgekeurd', () => zetStatus(b.id, 'goedgekeurd'), 'btn btn--ghost'),
      knop('Afgewezen', () => zetStatus(b.id, 'afgewezen'), 'btn btn--ghost'),
      knop('Opnieuw schrijven', () => scanEen(b.id), 'btn btn--ghost'),
    );
  }

  host.append(acties);
}

function knop(label, fn, klasse = 'btn') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = klasse;
  b.textContent = label;
  b.addEventListener('click', async () => {
    if (state.bezig) return;
    try {
      await fn();
    } catch (fout) {
      melding(fout.message, 'fout');
    }
  });
  return b;
}

async function kopieer(tekst) {
  try {
    await navigator.clipboard.writeText(tekst);
    melding('Mail gekopieerd. Plak hem in je mailprogramma.');
  } catch {
    melding('Kopiëren lukte niet — selecteer de tekst en gebruik Ctrl+C.', 'fout');
  }
}

/* ─────────────────────────────── acties ──────────────────────────────── */

async function zetStatus(id, status) {
  const { overzicht } = await api('/api/stage/status', { body: { id, status } });
  state.overzicht = overzicht;
  await selecteer(id);
  renderLijst();
  renderKop();
}

async function verstuur(b) {
  if (state.bezig) return;
  const naar = (b.emails ?? [])[0];
  if (!naar) {
    melding('Geen e-mailadres bekend voor dit bedrijf.', 'fout');
    return;
  }
  if (!window.confirm(`Mail versturen naar ${naar}?\n\nOnderwerp: ${b.mail?.onderwerp ?? '—'}`)) return;

  state.bezig = true;
  voortgang('Versturen…');
  try {
    const { overzicht, naar: verzonden } = await api('/api/stage/verstuur', { body: { id: b.id } });
    state.overzicht = overzicht;
    await selecteer(b.id);
    renderKop();
    renderLijst();
    melding(`Verstuurd naar ${verzonden}.`);
  } catch (fout) {
    melding(fout.message, 'fout');
  } finally {
    state.bezig = false;
    voortgang('');
  }
}

async function verstuurAlles() {
  if (state.bezig) return;
  const klaar = state.overzicht?.teVersturen ?? [];
  if (!klaar.length) return;
  if (!window.confirm(`${klaar.length} mails versturen?`)) return;

  state.bezig = true;
  voortgang(`Versturen: ${klaar.length} mails…`);
  try {
    const { overzicht, verstuurd = [], mislukt = [] } = await api('/api/stage/verstuur-alles', {
      body: {},
    });
    state.overzicht = overzicht;
    renderAlles();
    melding(
      `${verstuurd.length} verstuurd${mislukt.length ? `, ${mislukt.length} mislukt: ${mislukt.map((m) => m.bedrijf).join(', ')}` : ''}.`,
      mislukt.length ? 'fout' : 'info',
    );
  } catch (fout) {
    melding(fout.message, 'fout');
  } finally {
    state.bezig = false;
    voortgang('');
  }
}

async function scanEen(id) {
  state.bezig = true;
  voortgang('Bezig: site lezen en mail schrijven…');
  try {
    const { overzicht } = await api('/api/stage/scan', { body: { id } });
    state.overzicht = overzicht;
    await selecteer(id);
    renderKop();
    renderLijst();
  } finally {
    state.bezig = false;
    voortgang('');
  }
}

async function dagrun() {
  if (state.bezig) return;
  state.bezig = true;
  state.stop = false;
  melding('');

  let gedaan = 0;
  let mislukt = 0;
  /*
   * Een bedrijf waarvan de site niet te lezen is, blijft in de wachtrij staan —
   * dat is goed, want morgen lukt het misschien wel. Binnen deze run slaan we
   * hem over, anders probeer je dezelfde kapotte site twintig keer.
   */
  const geprobeerd = new Set();

  try {
    for (;;) {
      if (state.stop) break;
      const o = state.overzicht;
      if (!o || o.over <= 0) break;

      const volgende = (o.wachtrij ?? []).find((b) => !geprobeerd.has(b.id));
      if (!volgende) break;
      geprobeerd.add(volgende.id);

      voortgang(`Bezig met ${volgende.titel} — ${gedaan} klaar, ${o.over} te gaan vandaag`);
      try {
        const { overzicht } = await api('/api/stage/scan', { body: { id: volgende.id } });
        state.overzicht = overzicht;
        gedaan += 1;
        renderKop();
        renderLijst();
      } catch (fout) {
        mislukt += 1;
        // Doorslikken zou betekenen dat je denkt dat er twintig klaarstaan.
        melding(`${volgende.titel} overgeslagen: ${fout.message}`, 'fout');
      }
    }
  } finally {
    state.bezig = false;
    voortgang('');
    renderAlles();
  }

  melding(
    gedaan
      ? `${gedaan} mail${gedaan === 1 ? '' : 's'} klaargezet${mislukt ? `, ${mislukt} overgeslagen` : ''}. Lees ze na bij “Te beoordelen”.`
      : mislukt
        ? `Alle ${mislukt} kandidaten mislukten — zie de melding hierboven.`
        : 'Geen kandidaten in de wachtrij.',
    gedaan ? 'info' : 'fout',
  );
}

async function zoek(bron) {
  if (state.bezig) return;
  state.bezig = true;
  melding(bron === 'osm' ? 'OpenStreetMap bevragen — dit kan een minuut duren…' : 'Bezig…');
  try {
    const { toegevoegd, overzicht } = await api('/api/stage/zoek', { body: { bron } });
    state.overzicht = overzicht;
    state.view = 'wachtrij';
    renderWeergaveKnoppen();
    renderAlles();
    melding(`${toegevoegd} nieuwe bedrijven toegevoegd.`);
  } catch (fout) {
    melding(fout.message, 'fout');
  } finally {
    state.bezig = false;
  }
}

async function voegToe(url) {
  if (!url) return;
  if (state.bezig) return;
  state.bezig = true;
  try {
    const { overzicht } = await api('/api/stage/voeg', { body: { url } });
    state.overzicht = overzicht;
    renderAlles();
    melding('Toegevoegd aan de wachtrij.');
  } catch (fout) {
    melding(fout.message, 'fout');
  } finally {
    state.bezig = false;
  }
}

/* ─────────────────────────────── opstart ─────────────────────────────── */

function renderWeergaveKnoppen() {
  for (const knop of document.querySelectorAll('#weergave .seg__btn')) {
    knop.classList.toggle('is-on', knop.dataset.view === state.view);
  }
}

function thema() {
  const nu = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nu;
  localStorage.setItem('cavascp-theme', nu);
}

function start() {
  const bewaard = localStorage.getItem('cavascp-theme');
  if (bewaard) document.documentElement.dataset.theme = bewaard;

  $('#theme').addEventListener('click', thema);

  for (const knop of document.querySelectorAll('#weergave .seg__btn')) {
    knop.addEventListener('click', () => {
      state.view = knop.dataset.view;
      renderWeergaveKnoppen();
      renderLijst();
    });
  }

  $('#dagrun').addEventListener('click', dagrun);
  $('#verstuur-alles').addEventListener('click', verstuurAlles);
  $('#aanvoer-eigen').addEventListener('click', () => zoek('eigen'));
  $('#aanvoer-osm').addEventListener('click', () => zoek('osm'));

  $('#voeg').addEventListener('submit', (gebeurtenis) => {
    gebeurtenis.preventDefault();
    const veld = $('#voeg-url');
    const waarde = veld.value.trim();
    veld.value = '';
    voegToe(waarde);
  });

  renderWeergaveKnoppen();

  laad().catch((fout) => {
    melding(
      `${fout.message} Open het dashboard via http://127.0.0.1:8787/ en klik daarna op Stage.`,
      'fout',
    );
  });
}

start();
