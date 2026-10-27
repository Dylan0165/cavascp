/**
 * De bedrijven die je hebt benaderd.
 *
 * Dit bestand is je dossier: welk bedrijf, wie je hebt gemaild, wanneer, wat ze
 * antwoordden, en wanneer je moet opvolgen. Het staat in data/stagebot/, buiten
 * versiebeheer, want dit is zakelijke correspondentie.
 *
 * WAAROM JSON EN GEEN DATABASE
 *
 * Omdat je hooguit een paar honderd bedrijven hebt. Een JSON-bestand kun je met
 * de hand openen, in git zetten (als je dat zou willen), en met elk programma
 * lezen. Een database voegt hier niets toe behalve een afhankelijkheid.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inData } from '../../mcp/lib/paden.mjs';

const MAP = inData('stagebot');
const BESTAND = path.join(MAP, 'bedrijven.json');

/** Statussen die een bedrijf kan hebben. */
export const STATUS = {
  gevonden: 'gevonden, nog niet gelezen',
  gescand: 'site gelezen, nog geen mail',
  concept: 'mail geschreven, nog niet nagekeken',
  goedgekeurd: 'nagekeken, klaar om te versturen',
  verstuurd: 'mail is de deur uit',
  geantwoord: 'ze hebben terug gemaild',
  afgewezen: 'nee, of geen stageplek',
  gesprek: 'in gesprek',
  klaar: 'stage gevonden',
};

/**
 * Hoeveel mails je per dag maximaal klaarzet.
 *
 * Twintig is wat je nog met de hand kunt nalezen voordat je op verzenden drukt.
 * Meer is geen grotere kans op een stage, het is een grotere kans dat je adres
 * als spam bekendstaat — zie docs/stagebot.md.
 */
export const DAG_LIMIET = 20;

/** De statussen die meetellen als "deze dag heb ik werk gedaan". */
const DAG_STATUSSEN = ['concept', 'goedgekeurd', 'verstuurd', 'geantwoord', 'gesprek', 'klaar'];

function leeg() {
  return { versie: 1, bedrijven: [], bijgewerkt: null };
}

export function leesBedrijven() {
  if (!existsSync(BESTAND)) return leeg();
  try {
    const data = JSON.parse(readFileSync(BESTAND, 'utf8'));
    return { ...leeg(), ...data };
  } catch {
    return leeg();
  }
}

export function bewaarBedrijven(data) {
  mkdirSync(MAP, { recursive: true });
  const metTijd = { ...data, bijgewerkt: new Date().toISOString() };
  writeFileSync(BESTAND, JSON.stringify(metTijd, null, 2), 'utf8');
  return metTijd;
}

/** Een kort, leesbaar id dat niet botst. */
function maakId(domein, bestaand) {
  const basis = String(domein || 'bedrijf')
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.[a-z]{2,}$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  let id = basis;
  let n = 2;
  while (bestaand.has(id)) {
    id = `${basis}-${n}`;
    n += 1;
  }
  return id;
}

/**
 * Welke naam houden we?
 *
 * De <title> van een website is vaak een slogan: "ICT Beheer Breda en
 * West-Brabant" in plaats van de bedrijfsnaam. Bij een bedrijf dat uit de
 * zoekopdracht komt weten we de naam al — die is beter dan de titel van de
 * pagina. Alleen als de naam niet meer is dan het domein ("daemen-ict") mag de
 * scan hem vervangen.
 */
function titelVanScan(bestaand, scan) {
  const schoon = (s) => String(s ?? '').trim();
  const bestaandeTitel = schoon(bestaand.titel);
  const scanTitel = schoon(scan.titel);
  if (!bestaandeTitel) return scanTitel || bestaand.domein;

  const uitDomein = (domein) =>
    String(domein ?? '')
      .replace(/^www\./, '')
      .split('.')[0]
      .toLowerCase();
  if (bestaandeTitel.toLowerCase() === uitDomein(bestaand.domein)) {
    return scanTitel || bestaandeTitel;
  }
  return bestaandeTitel;
}

/**
 * Voegt een bedrijf toe, of werkt het bij.
 *
 * Scannen mag je zo vaak doen als je wilt: het overschrijft de scan maar laat
 * je mails en notities staan. Dat is belangrijk, want je wilt een bedrijf
 * opnieuw kunnen lezen zonder je correspondentie kwijt te raken.
 */
export function voegToe(scan, { notitie } = {}) {
  const data = leesBedrijven();
  const ids = new Set(data.bedrijven.map((b) => b.id));

  const bestaand = data.bedrijven.find(
    (b) => b.domein === scan.domein || b.url === scan.url,
  );

  if (bestaand) {
    Object.assign(bestaand, {
      url: scan.url,
      domein: scan.domein,
      titel: titelVanScan(bestaand, scan),
      omschrijving: scan.omschrijving || bestaand.omschrijving,
      emails: scan.emails ?? bestaand.emails,
      tech: scan.tech ?? bestaand.tech,
      stageSignaal: scan.stageSignaal ?? bestaand.stageSignaal,
      paginas: scan.paginas ?? bestaand.paginas,
      tekst: scan.tekst ?? bestaand.tekst,
      gescand: scan.gescand,
      bijgewerkt: new Date().toISOString(),
    });
    // Een bedrijf dat net uit de zoekopdracht kwam, is nu gelezen. De rest van
    // de status (concept, verstuurd) blijft staan: opnieuw scannen mag nooit
    // je correspondentie wissen.
    if (bestaand.status === 'gevonden') bestaand.status = 'gescand';
    if (notitie) bestaand.notities = [...(bestaand.notities ?? []), { op: new Date().toISOString(), tekst: notitie }];
    bewaarBedrijven(data);
    return { bedrijf: bestaand, nieuw: false };
  }

  const bedrijf = {
    id: maakId(scan.domein, ids),
    url: scan.url,
    domein: scan.domein,
    titel: scan.titel || scan.domein,
    omschrijving: scan.omschrijving || '',
    emails: scan.emails ?? [],
    tech: scan.tech ?? [],
    stageSignaal: scan.stageSignaal ?? [],
    paginas: scan.paginas ?? [],
    tekst: scan.tekst ?? '',
    gescand: scan.gescand,
    status: 'gescand',
    mail: null,
    verstuurd: [],
    notities: notitie ? [{ op: new Date().toISOString(), tekst: notitie }] : [],
    aangemaakt: new Date().toISOString(),
    bijgewerkt: new Date().toISOString(),
  };

  data.bedrijven.push(bedrijf);
  bewaarBedrijven(data);
  return { bedrijf, nieuw: true };
}

export function zoekBedrijf(idOfDomein) {
  const data = leesBedrijven();
  const vraag = String(idOfDomein).toLowerCase();
  return (
    data.bedrijven.find((b) => b.id === vraag) ??
    data.bedrijven.find((b) => String(b.domein).toLowerCase().includes(vraag)) ??
    data.bedrijven.find((b) => String(b.titel).toLowerCase().includes(vraag)) ??
    null
  );
}

/* ───────────────────────── de dagelijkse aanvoer ───────────────────────── */

/** Vandaag als `YYYY-MM-DD`, in lokale tijd — niet in UTC, want het is je agenda. */
export function vandaag(datum = new Date()) {
  const d = new Date(datum);
  const maand = String(d.getMonth() + 1).padStart(2, '0');
  const dag = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${maand}-${dag}`;
}

/**
 * Voegt een gevonden bedrijf toe, nog zonder het gelezen te hebben.
 *
 * Waarom niet meteen scannen: de zoekopdracht levert er tientallen op, en dan
 * zit je een kwartier te wachten voordat je iets ziet. De lijst binnenhalen en
 * het lezen apart houden maakt elk deel snel en onderbroken te doen.
 */
export function voegKandidaatToe(kandidaat) {
  const data = leesBedrijven();
  const bestaand = data.bedrijven.find((b) => b.domein === kandidaat.domein);
  if (bestaand) return bestaand;

  const ids = new Set(data.bedrijven.map((b) => b.id));
  const bedrijf = {
    id: maakId(kandidaat.domein, ids),
    url: kandidaat.website,
    domein: kandidaat.domein,
    titel: kandidaat.naam,
    omschrijving: '',
    emails: [],
    tech: [],
    stageSignaal: [],
    paginas: [],
    tekst: '',
    status: 'gevonden',
    bron: kandidaat.bron ?? 'onbekend',
    plaats: kandidaat.plaats ?? null,
    straat: kandidaat.straat ?? null,
    lat: kandidaat.lat ?? null,
    lon: kandidaat.lon ?? null,
    vanHuisKm: kandidaat.vanHuisKm ?? null,
    station: kandidaat.station ?? null,
    ov: kandidaat.ov ?? 'onbekend',
    mail: null,
    verstuurd: [],
    notities: [],
    aangemaakt: new Date().toISOString(),
    bijgewerkt: new Date().toISOString(),
  };

  data.bedrijven.push(bedrijf);
  bewaarBedrijven(data);
  return bedrijf;
}

/**
 * De wachtrij: bedrijven die gevonden zijn maar nog niet gelezen.
 *
 * Loopafstand eerst, dan korte rit, dan de rest. Binnen een klasse: dichterbij
 * eerst. Zo staat het bedrijf waar je het makkelijkst langs kunt bovenaan.
 */
export function wachtrij({ limiet = 50 } = {}) {
  const rang = { loopafstand: 0, 'korte rit': 1, verder: 2, onbekend: 3 };
  return leesBedrijven()
    .bedrijven.filter((b) => b.status === 'gevonden')
    .sort(
      (a, b) =>
        (rang[a.ov] ?? 3) - (rang[b.ov] ?? 3) ||
        (a.vanHuisKm ?? 999) - (b.vanHuisKm ?? 999) ||
        String(a.titel).localeCompare(String(b.titel), 'nl'),
    )
    .slice(0, limiet);
}

/** Hoeveel werk is er vandaag al gedaan, en hoeveel mag er nog bij? */
export function dagTelling(dag = vandaag()) {
  const vandaagGedaan = leesBedrijven().bedrijven.filter(
    (b) => b.dag === dag && DAG_STATUSSEN.includes(b.status),
  );
  return {
    dag,
    limiet: DAG_LIMIET,
    gedaan: vandaagGedaan.length,
    over: Math.max(0, DAG_LIMIET - vandaagGedaan.length),
    bedrijven: vandaagGedaan,
  };
}

/** Werkt één bedrijf bij met een functie. */
export function werkBij(id, wijzig) {
  const data = leesBedrijven();
  const bedrijf = data.bedrijven.find((b) => b.id === id);
  if (!bedrijf) return null;
  wijzig(bedrijf);
  bedrijf.bijgewerkt = new Date().toISOString();
  bewaarBedrijven(data);
  return bedrijf;
}

/** Hoeveel bedrijven staan er in welke status? */
export function telPerStatus() {
  const data = leesBedrijven();
  const telling = {};
  for (const b of data.bedrijven) {
    telling[b.status] = (telling[b.status] ?? 0) + 1;
  }
  return { totaal: data.bedrijven.length, perStatus: telling };
}
