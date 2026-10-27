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
  nieuw: 'nog niets gedaan',
  gescand: 'site gelezen, nog geen mail',
  concept: 'mail geschreven, nog niet verstuurd',
  verstuurd: 'mail is de deur uit',
  geantwoord: 'ze hebben terug gemaild',
  afgewezen: 'nee, of geen stageplek',
  gesprek: 'in gesprek',
  klaar: 'stage gevonden',
};

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
      titel: scan.titel || bestaand.titel,
      omschrijving: scan.omschrijving || bestaand.omschrijving,
      emails: scan.emails ?? bestaand.emails,
      tech: scan.tech ?? bestaand.tech,
      stageSignaal: scan.stageSignaal ?? bestaand.stageSignaal,
      paginas: scan.paginas ?? bestaand.paginas,
      tekst: scan.tekst ?? bestaand.tekst,
      gescand: scan.gescand,
      bijgewerkt: new Date().toISOString(),
    });
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
