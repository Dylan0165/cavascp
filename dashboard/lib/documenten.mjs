/**
 * Documenten bewaren.
 *
 * Hetzelfde model als Krava gebruikt — titel, huisstijl, opties, plan met
 * secties — zodat een document dat je hier maakt er hetzelfde uitziet als in
 * Krava, en zodat bestaande Krava-projecten over te nemen zijn.
 *
 * Elk document is één JSON-bestand. Geen database: je kunt het openen, lezen,
 * en met de hand repareren als er iets misgaat.
 *
 * Waarom een eigen opslag en niet Krava's map: dit dashboard moet op zichzelf
 * kunnen werken. Krava is een los project dat je kunt verplaatsen of verwijderen
 * zonder dat hier iets omvalt.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const DOCUMENTEN = 'D:/cavascp/data/documenten';

function zorgVoorMap() {
  if (!existsSync(DOCUMENTEN)) mkdirSync(DOCUMENTEN, { recursive: true });
}

/** Een kort, uniek id. Leesbaar genoeg om in een bestandsnaam te herkennen. */
function nieuwId() {
  const tijd = Date.now().toString(36);
  const toeval = Math.random().toString(36).slice(2, 8);
  return `doc-${tijd}-${toeval}`;
}

/** Een leeg document met de velden die de generator verwacht. */
export function leegDocument(velden = {}) {
  const nu = new Date().toISOString();
  return {
    id: nieuwId(),
    titel: 'Naamloos document',
    subtitel: '',
    auteur: '',
    instelling: 'Fontys Hogeschool ICT',
    opleiding: '',
    vak: '',
    begeleiders: '',
    datum: nu.slice(0, 10),
    versie: '1.0',
    documenttype: 'verslag',
    taal: 'nl',
    brief: '',
    afbeeldingen: [],
    bronnen: [],
    /*
     * Het plan is een BOOM: secties met subsecties, elk met Markdown in `tekst`.
     * Dat is dezelfde vorm als Krava gebruikt, zodat de generator hem begrijpt
     * en een overgenomen project meteen werkt.
     */
    plan: { titel: '', ondertitel: '', secties: [] },
    huisstijl: {
      accent: '2E5BA8',
      kop2: '1F3F7A',
      kop3: '4A6FA5',
      tekst: '1A1A1A',
      subtekst: '5A6472',
      fontTekst: 'Calibri',
      fontKop: 'Calibri Light',
      fontMono: 'Consolas',
      kopGrootte: '17,13.5,11.5',
      titelGrootte: 26,
      tekstGrootte: 10.5,
    },
    opties: {
      omslag: true,
      inhoudsopgave: true,
      paginanummer: true,
      werkInhoudsopgaveBij: true,
      marges: { boven: 2.5, onder: 2.5, links: 2.5, rechts: 2.5 },
    },
    aangemaakt: nu,
    bijgewerkt: nu,
    /*
     * Wat er met dit document is gebeurd: naar welke map, wanneer, met welke
     * leeruitkomsten. Dit is het spoor terug — zonder dit weet je niet meer wat
     * je wanneer hebt ingeleverd, en een snapshot is onveranderlijk dus je kunt
     * het niet meer terughalen.
     */
    inleveringen: [],
    ...velden,
  };
}

/**
 * Legt vast dat een document is ingeleverd.
 *
 * Wordt door de server aangeroepen na een geslaagde upload. Mislukt de upload,
 * dan komt hier niets — een mislukte poging is geen inlevering.
 */
export function noteerInlevering(id, inlevering) {
  const document = lees(id);
  if (!document) return null;
  const lijst = Array.isArray(document.inleveringen) ? document.inleveringen : [];
  lijst.push({
    op: new Date().toISOString(),
    mapId: inlevering.mapId ?? null,
    mapNaam: inlevering.mapNaam ?? null,
    bewijsId: inlevering.bewijsId ?? null,
    bestandsnaam: inlevering.bestandsnaam ?? null,
    bytes: inlevering.bytes ?? null,
    goalIds: inlevering.goalIds ?? [],
    leeruitkomsten: inlevering.leeruitkomsten ?? [],
    toelichting: inlevering.toelichting ?? '',
  });
  return bewaar({ ...document, inleveringen: lijst });
}

/** Een nieuwe sectie. */
export function nieuweSectie(titel = 'Nieuwe sectie', tekst = '') {
  return { id: nieuwId(), titel, niveau: 1, tekst, subsecties: [], status: 'leeg' };
}

const veiligeNaam = (id) => `${String(id).replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;

export function lees(id) {
  zorgVoorMap();
  const pad = path.join(DOCUMENTEN, veiligeNaam(id));
  if (!existsSync(pad)) return null;
  try {
    return JSON.parse(readFileSync(pad, 'utf8'));
  } catch {
    return null;
  }
}

export function bewaar(document) {
  zorgVoorMap();
  if (!document?.id) throw new Error('een document zonder id kan niet bewaard worden');
  const bijgewerkt = { ...document, bijgewerkt: new Date().toISOString() };
  const pad = path.join(DOCUMENTEN, veiligeNaam(document.id));
  // Eerst naar een tijdelijk bestand, dan verplaatsen: zo raak je nooit een
  // half geschreven document kwijt als het schrijven onderbroken wordt.
  const tijdelijk = `${pad}.tmp`;
  writeFileSync(tijdelijk, JSON.stringify(bijgewerkt, null, 2), 'utf8');
  renameSync(tijdelijk, pad);
  return bijgewerkt;
}

export function verwijder(id) {
  zorgVoorMap();
  const pad = path.join(DOCUMENTEN, veiligeNaam(id));
  if (!existsSync(pad)) return false;
  unlinkSync(pad);
  return true;
}

/** Een korte samenvatting zonder de hele tekst, voor de lijst. */
function samenvatting(document) {
  const secties = document.plan?.secties || [];
  const tel = (lijst) => lijst.reduce((n, s) => n + 1 + tel(s.subsecties || []), 0);
  const tekens = (lijst) =>
    lijst.reduce((n, s) => n + String(s.tekst || '').length + tekens(s.subsecties || []), 0);
  return {
    id: document.id,
    titel: document.titel,
    subtitel: document.subtitel,
    auteur: document.auteur,
    vak: document.vak,
    documenttype: document.documenttype,
    bijgewerkt: document.bijgewerkt,
    aangemaakt: document.aangemaakt,
    secties: tel(secties),
    tekens: tekens(secties),
    bronnen: (document.bronnen || []).length,
    afbeeldingen: (document.afbeeldingen || []).length,
    inleveringen: (document.inleveringen || []).length,
    laatstIngediend: (document.inleveringen || []).slice(-1)[0]?.op ?? null,
  };
}

/**
 * Haalt de opmaakrommel uit een stuk tekst.
 *
 * Word-documenten die wij zelf maken bevatten een inhoudsopgave met een
 * TOC-veld, een kop met "Auteur:" en een voettekst. Als de indeler daar zijn
 * eerste zin uit pakt, komt er "TOC \o "1-3" \h \z \u" in de toelichting te
 * staan. Dat is geen inhoud en het staat slordig in je portfolio.
 *
 * We gooien die regels weg voordat we een zin kiezen.
 */
export function zonderOpmaakrommel(tekst) {
  const rommel = [
    /^inhoudsopgave$/i,
    /^toc\b/i,
    /^vernieuw de inhoudsopgave/i,
    /^auteur\s*:/i,
    /^datum\s*:/i,
    /^versie\s*:/i,
    /^opleiding\s*:/i,
    /^vak\s*:/i,
    /^begeleiders?\s*:/i,
    /^pagina\s*\d+/i,
    /^\\o\s/i,
    /^\d+\s*$/,
  ];
  return String(tekst ?? '')
    .split('\n')
    .map((r) => r.replace(/\s+/g, ' ').trim())
    .filter((r) => r && !rommel.some((re) => re.test(r)))
    .join('\n');
}

/** Alle documenten, nieuwste eerst. */
export function lijst() {
  zorgVoorMap();
  const uit = [];
  for (const bestand of readdirSync(DOCUMENTEN)) {
    if (!bestand.endsWith('.json')) continue;
    try {
      const document = JSON.parse(readFileSync(path.join(DOCUMENTEN, bestand), 'utf8'));
      if (document?.id) uit.push(samenvatting(document));
    } catch {
      /* onleesbaar bestand overslaan */
    }
  }
  return uit.sort((a, b) => String(b.bijgewerkt ?? '').localeCompare(String(a.bijgewerkt ?? '')));
}

/**
 * Neemt een Krava-project over als eigen document.
 *
 * Zo kun je werk dat al in Krava staat hier verder afmaken, zonder dat de twee
 * aan elkaar vast zitten.
 */
export function neemOver(kravaProject) {
  const nu = new Date().toISOString();
  const document = leegDocument({
    titel: kravaProject.titel || 'Overgenomen document',
    subtitel: kravaProject.subtitel || '',
    auteur: kravaProject.auteur || '',
    instelling: kravaProject.instelling || 'Fontys Hogeschool ICT',
    opleiding: kravaProject.opleiding || '',
    vak: kravaProject.vak || '',
    begeleiders: kravaProject.begeleiders || '',
    datum: kravaProject.datum || nu.slice(0, 10),
    versie: kravaProject.versie || '1.0',
    documenttype: kravaProject.documenttype || 'verslag',
    brief: kravaProject.brief || '',
    bronnen: kravaProject.bronnen || [],
    // Het plan blijft zoals het is: de generator snapt deze vorm.
    plan: kravaProject.plan || { titel: '', ondertitel: '', secties: [] },
    huisstijl: { ...leegDocument().huisstijl, ...(kravaProject.huisstijl || {}) },
    opties: { ...leegDocument().opties, ...(kravaProject.opties || {}) },
    herkomst: 'krava',
    herkomstId: kravaProject.id ?? null,
  });
  return bewaar(document);
}

export { DOCUMENTEN };

/**
 * Waar het Word-bestand tijdelijk staat voordat het naar Portflow gaat.
 *
 * Bewust een eigen map en niet de documentenmap: dit zijn vluchtige bestanden
 * die na het versturen weer weggaan. Ze horen niet tussen je documenten.
 */
export const TIJDELIJK = 'D:/cavascp/data/tijdelijk';

export function zorgVoorTijdelijk() {
  if (!existsSync(TIJDELIJK)) mkdirSync(TIJDELIJK, { recursive: true });
}
