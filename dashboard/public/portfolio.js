/**
 * De inleverpagina.
 *
 * Haalt de catalogus op en zet hem neer: per collectie de description, de
 * bewijsstukken met hun beschrijving, en de downloads. Alles met een
 * kopieerknop, want het doel is plakken in Portflow.
 */

const $ = (kies, wortel = document) => wortel.querySelector(kies);

function el(tag, klasse, tekst) {
  const node = document.createElement(tag);
  if (klasse) node.className = klasse;
  if (tekst != null) node.textContent = tekst;
  return node;
}

function knop(label, onClick, extra = '') {
  const b = el('button', `btn btn--ghost btn--klem ${extra}`.trim(), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

let meldTimer = null;
function meld(tekst) {
  const vak = $('#meld');
  vak.textContent = tekst;
  vak.classList.add('is-zichtbaar');
  clearTimeout(meldTimer);
  meldTimer = setTimeout(() => vak.classList.remove('is-zichtbaar'), 1600);
}

async function kopieer(tekst) {
  try {
    await navigator.clipboard.writeText(tekst);
    meld('Gekopieerd, plak in Portflow');
  } catch {
    // Clipboard kan geweigerd worden (http zonder https). Dan selecteren we
    // de tekst zodat Ctrl+C alsnog werkt.
    const hulp = document.createElement('textarea');
    hulp.value = tekst;
    document.body.append(hulp);
    hulp.select();
    document.execCommand?.('copy');
    hulp.remove();
    meld('Gekopieerd');
  }
}

function downloadPad(pad) {
  return `/api/vault/bestand?pad=${encodeURIComponent(pad)}`;
}

function blokTekst(titel, tekst, { ingeklapt = true } = {}) {
  const blok = el('div', 'blok');

  const rij = el('div', 'blok__rij');
  rij.append(el('p', 'blok__titel', titel));

  const knoppen = el('div', 'stuk__acties');
  knoppen.append(knop('Kopieer', () => kopieer(tekst)));

  if (ingeklapt) {
    const meer = knop('Alles tonen', () => {
      vak.classList.toggle('is-open');
      meer.textContent = vak.classList.contains('is-open') ? 'Inklappen' : 'Alles tonen';
    });
    knoppen.append(meer);
  }

  rij.append(knoppen);
  blok.append(rij);

  const vak = el('div', 'tekst', tekst);
  if (!ingeklapt) vak.classList.add('is-open');
  blok.append(vak);

  return blok;
}

function stukRij(stuk) {
  const rij = el('div', 'stuk');

  const links = el('div');
  links.append(el('p', 'stuk__naam', stuk.titel));
  if (stuk.wat) links.append(el('p', 'stuk__meta', stuk.wat));

  const acties = el('div', 'stuk__acties');
  acties.append(knop('Kopieer beschrijving', () => kopieer(stuk.beschrijving)));
  if (stuk.bestand) {
    const link = el('a', 'btn btn--ghost btn--klem', `Download${stuk.kb ? ` (${stuk.kb} kB)` : ''}`);
    link.href = downloadPad(stuk.bestand);
    acties.append(link);
  }

  rij.append(links, acties);

  if (stuk.leeruitkomst) {
    const lo = el('p', 'stuk__meta');
    for (const naam of stuk.leeruitkomst.split(',')) {
      lo.append(el('span', 'lo', naam.trim()));
    }
    rij.append(lo);
  }

  rij.append(el('p', 'stuk__beschrijving', stuk.beschrijving));
  return rij;
}

function collectieKaart(collectie) {
  const kaart = el('section', 'collectie');

  const kop = el('div', 'collectie__kop');
  kop.append(el('h2', null, collectie.naam));
  kop.append(el('span', 'collectie__waar', collectie.portflow));
  kaart.append(kop);

  if (collectie.tekst) {
    kaart.append(blokTekst('Collection description', collectie.tekst));
  }

  const bewijs = el('div', 'blok');
  bewijs.append(el('p', 'blok__titel', `Bewijsstukken (${collectie.bewijs.length})`));
  for (const stuk of collectie.bewijs) bewijs.append(stukRij(stuk));
  kaart.append(bewijs);

  if (collectie.documenten?.length) {
    const docs = el('div', 'blok');
    docs.append(el('p', 'blok__titel', 'Documenten om te downloaden'));
    for (const document of collectie.documenten) {
      const rij = el('div', 'overig__rij');

      const links = el('div');
      links.append(el('p', 'overig__naam', document.titel));
      if (document.wat) links.append(el('p', 'overig__wat', document.wat));
      rij.append(links);

      const knoppen = el('div', 'stuk__acties');
      if (document.docx) {
        const a = el('a', 'btn btn--ghost btn--klem', `Word${document.kb ? ` (${document.kb} kB)` : ''}`);
        a.href = downloadPad(document.docx);
        knoppen.append(a);
      }
      if (document.md) {
        const a = el('a', 'btn btn--ghost btn--klem', 'Tekst');
        a.href = downloadPad(document.md);
        knoppen.append(a);
      }
      rij.append(knoppen);
      docs.append(rij);
    }
    kaart.append(docs);
  }

  // De leeswijzer als Word-bestand, voor als je hem liever los bewaart.
  if (collectie.leeswijzerKb) {
    const voet = el('div', 'blok');
    const rij = el('div', 'overig__rij');
    rij.style.padding = '0';
    rij.style.borderBottom = '0';

    const links = el('div');
    links.append(el('p', 'overig__naam', 'Leeswijzer als Word-document'));
    links.append(el('p', 'overig__wat', 'Zelfde tekst als hierboven'));
    rij.append(links);

    const a = el('a', 'btn btn--ghost btn--klem', `Download (${collectie.leeswijzerKb} kB)`);
    a.href = downloadPad(collectie.leeswijzerBestand);
    const knoppen = el('div', 'stuk__acties');
    knoppen.append(a);
    rij.append(knoppen);

    voet.append(rij);
    kaart.append(voet);
  }

  return kaart;
}

async function start() {
  const thema = document.getElementById('thema');
  const bewaard = localStorage.getItem('cavascp-theme');
  if (bewaard) document.documentElement.dataset.theme = bewaard;
  thema?.addEventListener('click', () => {
    const nu = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nu;
    localStorage.setItem('cavascp-theme', nu);
  });

  const antwoord = await fetch('/api/portfolio', { headers: { Accept: 'application/json' } });
  if (!antwoord.ok) {
    document.querySelector('main').append(
      el('p', 'blok', `Kon de lijst niet laden (${antwoord.status}).`),
    );
    return;
  }

  const { collecties, overig } = await antwoord.json();

  const houder = $('#collecties');
  for (const collectie of collecties) houder.append(collectieKaart(collectie));

  const overigHouder = $('#overig');
  for (const item of overig) {
    const rij = el('div', 'overig__rij');

    const links = el('div');
    links.append(el('p', 'overig__naam', item.titel));
    if (item.wat) links.append(el('p', 'overig__wat', item.wat));
    rij.append(links);

    const knoppen = el('div', 'stuk__acties');
    if (item.kb) {
      const a = el('a', 'btn btn--ghost btn--klem', `Download (${item.kb} kB)`);
      a.href = downloadPad(item.bestand);
      knoppen.append(a);
    } else {
      knoppen.append(el('span', 'stuk__meta', 'niet gevonden'));
    }
    rij.append(knoppen);

    overigHouder.append(rij);
  }
}

start().catch((fout) => {
  document.querySelector('main').append(el('p', 'blok', `Er ging iets mis: ${fout.message}`));
});
