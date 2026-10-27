/**
 * Een mail schrijven die niet als massa-mail leest.
 *
 * Het verschil zit niet in de opmaak maar in de inhoud: een mail die verwijst
 * naar iets wat echt op hun site staat, en die een concrete vraag stelt waar
 * iemand in twee regels op kan antwoorden.
 *
 * TWEE REGELS DIE HARD ZIJN
 *
 * 1. Het model verzint niets over jou. Geen "ik heb vijf jaar ervaring", geen
 *    projecten die niet in je profiel staan. Wat er niet in staat, komt er niet
 *    in — ook niet als het mooier zou klinken.
 * 2. Er zit altijd een regel in waarin je zegt dat ze kunnen terugmailen als ze
 *    geen interesse hebben. Dat is niet alleen netjes: voor zakelijke e-mail is
 *    een opt-out verplicht, en het scheelt je een hoop nutteloze gesprekken.
 */

import { vraagJson } from './deepseek.mjs';
import { profielAlsTekst, leesProfiel } from './profiel.mjs';

const SYSTEEM = `Je schrijft een korte, zakelijke e-mail in het Nederlands namens een student die een stageplaats zoekt.

Harde regels:
- Maximaal 180 woorden in de body. Korter is beter.
- Verwijs naar iets specifieks uit de informatie over het bedrijf. Geen algemeenheden.
- Geen holle frases: "gemotiveerde student", "passie voor IT", "ik ben een teamplayer", "graag wil ik mezelf voorstellen". Die schrap je.
- Verzin NIETS over de student. Gebruik alleen wat in het profiel staat. Staat er geen project, noem er dan geen.
- Stel één concrete vraag waarop iemand in twee regels kan antwoorden.
- Geen bijlagen beloven die je niet hebt.
- Sluit af met één korte regel waarin staat dat een "nee" ook goed is, zodat ze zonder moeite kunnen afwijzen.

Toon: direct, vriendelijk, niet kruiperig. Alsof je een professional aanschrijft die druk is.`;

/**
 * Schrijft een mail voor één bedrijf.
 *
 * @param {object} bedrijf   het resultaat van scanBedrijf
 * @param {object} [opties]
 * @param {object} [opties.profiel]
 * @param {string} [opties.extra]   iets wat jij wilt meegeven
 */
export async function schrijfMail(bedrijf, opties = {}) {
  const profiel = opties.profiel ?? leesProfiel();

  // Niet de hele site naar het model sturen: dat kost tokens en het model raakt
  // de kern kwijt. De eerste ~4000 tekens bevatten bijna altijd wie ze zijn.
  const siteTekst = String(bedrijf.tekst || '').slice(0, 4000);

  const vraag = `OVER HET BEDRIJF
Naam: ${bedrijf.titel || bedrijf.domein}
Website: ${bedrijf.url}
Omschrijving: ${bedrijf.omschrijving || '—'}
Technologie die ze noemen: ${bedrijf.tech?.length ? bedrijf.tech.join(', ') : '—'}
Signalen over stage/vacatures: ${bedrijf.stageSignaal?.length ? bedrijf.stageSignaal.join(', ') : 'geen'}
E-mailadressen gevonden: ${bedrijf.emails?.length ? bedrijf.emails.join(', ') : 'geen'}

TEKST VAN HUN SITE
${siteTekst}

OVER DE STUDENT
${profielAlsTekst(profiel)}

${opties.extra ? `EXTRA VAN DE STUDENT\n${opties.extra}\n` : ''}
Schrijf de mail. Geef als JSON:
{
  "onderwerp": "korte onderwerpregel, maximaal 60 tekens, geen uitroeptekens",
  "body": "de mail zelf, met alinea's gescheiden door \\n\\n, zonder aanhef-afkorting en zonder handtekening",
  "aanhef": "de eerste regel, bijvoorbeeld 'Beste mevrouw De Vries,' of 'Beste team van ...' — gebruik een naam alleen als die in de bron staat",
  "waarom": "in één zin: welk concreet aanknopingspunt uit hun site heb je gebruikt",
  "vraag": "de concrete vraag die je stelt",
  "onderbouwing": "welke zin in de mail zou een lezer het meest overtuigen, en waarom"
}`;

  const uit = await vraagJson({ systeem: SYSTEEM, vraag, temperatuur: 0.6, maxTekens: 1200 });

  return normaliseer(uit, bedrijf, profiel);
}

/** Zorgt dat het resultaat compleet is, ook als het model iets vergeet. */
function normaliseer(uit, bedrijf, profiel) {
  const onderwerp = String(uit.onderwerp ?? '').trim() || `Stageplek bij ${bedrijf.titel || bedrijf.domein}`;
  const aanhef = String(uit.aanhef ?? '').trim() || 'Beste,';

  let body = String(uit.body ?? '').trim();

  /*
   * Het model zet de aanhef vaak zelf ook nog boven de body. Dan staat hij
   * dubbel in de mail: één keer van het veld `aanhef`, één keer in de tekst.
   * We halen de eerste regel weg als die op de aanhef lijkt.
   */
  body = stripDubbeleAanhef(body, aanhef);

  /*
   * En hetzelfde aan de onderkant: het model sluit af met "Met vriendelijke
   * groet," en zijn naam, waarna wij nog een handtekening toevoegen. Dan staat
   * je naam er twee keer.
   */
  body = stripAfsluiting(body);

  const handtekening = [
    '',
    '',
    'Met vriendelijke groet,',
    '',
    profiel.naam,
    [profiel.opleiding, profiel.instelling].filter(Boolean).join(', '),
    profiel.email || null,
    profiel.telefoon || null,
  ]
    .filter((r) => r !== null)
    .join('\n');

  const volledig = `${aanhef}\n\n${body}${handtekening}`;

  return {
    onderwerp,
    aanhef,
    body,
    volledig,
    waarom: uit.waarom ?? null,
    vraag: uit.vraag ?? null,
    onderbouwing: uit.onderbouwing ?? null,
    // Zodat je achteraf kunt zien waar de mail op gebaseerd was.
    bron: {
      url: bedrijf.url,
      tech: bedrijf.tech ?? [],
      stageSignaal: bedrijf.stageSignaal ?? [],
      geschreven: new Date().toISOString(),
    },
  };
}

/** Haalt een aanhef weg die het model zelf al boven de body zette. */
function stripDubbeleAanhef(body, aanhef) {
  const regels = body.split('\n');
  if (!regels.length) return body;

  // De eerste niet-lege regel.
  const eersteIndex = regels.findIndex((r) => r.trim());
  if (eersteIndex === -1) return body;

  const normal = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  if (normal(regels[eersteIndex]) === normal(aanhef)) {
    regels.splice(0, eersteIndex + 1);
    // En de lege regel erachter.
    while (regels.length && !regels[0].trim()) regels.shift();
    return regels.join('\n').trim();
  }
  return body;
}

/** Haalt een afsluiting met naam weg, zodat wij die kunnen toevoegen. */
function stripAfsluiting(body) {
  const afsluiters = [
    'met vriendelijke groet',
    'vriendelijke groet',
    'hartelijke groet',
    'met vriendelijke groeten',
    'groet',
    'groeten',
    'kind regards',
    'best regards',
    'regards',
  ];
  const regels = body.split('\n');

  // Van onderen zoeken naar de laatste afsluiter.
  for (let i = regels.length - 1; i >= 0; i -= 1) {
    const schoon = regels[i].trim().toLowerCase().replace(/[,!.]/g, '');
    if (!schoon) continue;
    if (afsluiters.includes(schoon)) {
      return regels.slice(0, i).join('\n').trim();
    }
    /*
     * Maximaal vier regels terugkijken. Anders kan een "groet" midden in de
     * mail per ongeluk als afsluiting gelden en verlies je inhoud.
     */
    if (regels.length - i > 4) break;
  }
  return body;
}

/**
 * Controleert een mail op de dingen die misgaan.
 *
 * Dit is geen stijltest maar een lijst met fouten die je een kans kosten:
 * te lang, holle frases, geen opt-out, of een belofte over iets wat niet in je
 * profiel staat.
 */
export function keurMail(mail, profiel = leesProfiel()) {
  const punten = [];
  const body = String(mail.body || '');
  const woorden = body.split(/\s+/).filter(Boolean).length;

  if (woorden > 220) punten.push(`te lang: ${woorden} woorden (onder de 180 is beter)`);
  else if (woorden < 60) punten.push(`erg kort: ${woorden} woorden — staat er wel een reden in?`);

  const hol = [
    'gemotiveerde student',
    'passie voor',
    'teamplayer',
    'harde werker',
    'mezelf voorstellen',
    'enthousiast',
    'leergierig',
    'steile leercurve',
  ];
  const gevonden = hol.filter((h) => body.toLowerCase().includes(h));
  if (gevonden.length) punten.push(`holle frases: ${gevonden.join(', ')}`);

  /*
   * Een opt-out is verplicht voor zakelijke e-mail. We kijken naar de strekking
   * en niet naar één vaste zin, want het model formuleert het elke keer anders:
   * "een nee is ook goed", "laat het vooral weten als", "dan hoor ik het graag".
   */
  const optOut =
    /(nee is ook goed|geen interesse|niet ge[ïi]nteresseerd|laat het (vooral |gerust |even )?weten|dan hoor ik het graag|als (dit|deze|jullie) (niets|geen)|hoeft u (niet|geen)|dank is ook goed)/i;
  if (!optOut.test(`${body}\n${mail.volledig}`)) {
    punten.push('geen regel waarin ze kunnen afwijzen — dat is verplicht bij zakelijke e-mail');
  }

  // Verzint de mail ervaring die je niet hebt?
  if (/jaren ervaring|jarenlange|senior|expert in/i.test(body)) {
    const inProfiel = /jaren ervaring|jarenlange|senior|expert in/i.test(JSON.stringify(profiel));
    if (!inProfiel) punten.push('de mail claimt ervaring die niet in je profiel staat');
  }

  if (!mail.waarom) punten.push('geen aanknopingspunt vastgelegd — waarom juist dit bedrijf?');

  return {
    goed: punten.length === 0,
    punten,
    woorden,
  };
}
