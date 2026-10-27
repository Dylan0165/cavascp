/**
 * Automatisch bepalen waar een document hoort.
 *
 * De vraag die dit beantwoordt: je sleept een document naar binnen, en de app
 * zegt in welke map het hoort, aan welke leeruitkomsten het hangt, en welke
 * beschrijving erbij past.
 *
 * HOE HET KIEST
 *
 * Twee dingen wegen mee, en de tweede is belangrijker dan je zou denken:
 *
 *   1. WAAR HET OVER GAAT. De leeruitkomst-check zegt onder welke LO's de tekst
 *      valt, en elke map heeft een eigen profiel. Een document over reflectie
 *      hoort in Persoonlijk project, een document over data in orientatie.
 *
 *   2. WAT ER MIST. Een map waar die leeruitkomst nog leeg is, krijgt voorrang.
 *      Anders stapelt alles zich op in de map die al vol zit, en blijven de
 *      andere leeg — precies het probleem dat je bij een review tegenkomt.
 *
 * Wat het NIET doet: zelf beslissen. Het doet een voorstel met een reden erbij,
 * en jij klikt. Bij twijfel zegt het dat het twijfelt.
 */

import { checkDocument, checkVoorMap, LEERUITKOMSTEN, semesterMappen } from './leeruitkomsten.mjs';

/**
 * Waar een map over gaat.
 *
 * Dit is met de hand gezet op basis van wat de mappen in dit semester zijn. Het
 * zijn geen leeruitkomsten maar onderwerpen: de klantopdracht, je eigen project,
 * en de verkenning.
 */
export const MAP_PROFIELEN = {
  orientatie: {
    naam: 'orientatie',
    omschrijving: 'Verkenning, onderzoek en oefeningen: data, modellen, techniek.',
    lo: ['LO1', 'LO2', 'LO3'],
    onderwerpen: [
      'orientatie', 'verkenning', 'onderzoek', 'oefening', 'challenge', 'experiment',
      'dataset', 'data', 'analyse', 'model', 'prototype', 'test', 'techniek',
      'documentatie', 'verslag',
    ],
  },
  klantproject: {
    naam: 'klantproject',
    omschrijving: 'Het project voor de opdrachtgever: plan, aanpak, oplevering.',
    lo: ['LO1', 'LO4', 'LO5'],
    onderwerpen: [
      'klant', 'opdrachtgever', 'client', 'project', 'projectplan', 'plan', 'planning',
      'stakeholder', 'requirement', 'advies', 'oplevering', 'sprint', 'retrospective',
      'indruk', 'gesprek', 'overleg', 'proftaak',
    ],
  },
  'persoonlijk project': {
    naam: 'Persoonlijk project',
    omschrijving: 'Je eigen ontwikkeling: reflectie, leerdoelen, eigen onderzoek.',
    lo: ['LO5', 'LO6'],
    onderwerpen: [
      'reflectie', 'reflectieverslag', 'persoonlijk', 'leerdoel', 'leerdoelen',
      'ontwikkeling', 'groei', 'kernwaarde', 'sterkte', 'zwakte', 'feedback',
      'portflow', 'ai-augmented', 'chatgpt', 'journey',
    ],
  },
};

/**
 * Bepaalt in welke map een document het beste past.
 *
 * @param {object} invoer
 * @param {string} invoer.titel
 * @param {string} [invoer.bestandsnaam]
 * @param {string} invoer.tekst
 * @param {string} [invoer.beschrijving]
 * @param {object[]} [invoer.mappen]     de mappen met hun huidige dekking
 * @returns {{voorstel: object|null, alternatieven: object[], uitleg: string, onzeker: boolean}}
 */
export function bepaalMap({ titel = '', bestandsnaam = '', tekst = '', beschrijving = '', mappen = null } = {}) {
  const mapLijst = mappen ?? semesterMappen().map((m) => ({ naam: m.naam, id: m.portflowCollectionId, gedekt: [] }));

  /* Stap 1: onder welke leeruitkomsten valt dit document? */
  const analyse = checkDocument({ titel, bestandsnaam, tekst, beschrijving });
  const gevondenLo = analyse.treffers.map((t) => t.code);

  /* Stap 2: hoeveel raakt dit document elk mapprofiel? */
  const alles = `${titel} ${bestandsnaam} ${beschrijving} ${tekst}`.toLowerCase();

  const kandidaten = mapLijst.map((map) => {
    const profiel =
      MAP_PROFIELEN[String(map.naam ?? '').toLowerCase().trim()] ??
      Object.values(MAP_PROFIELEN).find((p) => p.naam.toLowerCase() === String(map.naam ?? '').toLowerCase()) ??
      null;

    if (!profiel) {
      return { map, score: 0, redenen: ['geen profiel bekend voor deze map'], onderwerpen: [], lo: [] };
    }

    const redenen = [];

    /* a. Onderwerpwoorden in de tekst. */
    const geraakt = profiel.onderwerpen.filter((w) => alles.includes(w));
    const onderwerpScore = profiel.onderwerpen.length ? geraakt.length / profiel.onderwerpen.length : 0;
    if (geraakt.length) redenen.push(`noemt ${geraakt.slice(0, 5).join(', ')}`);

    /* b. Leeruitkomsten die dit profiel typeert. */
    const loGeraakt = profiel.lo.filter((code) => gevondenLo.includes(code));
    const loScore = profiel.lo.length ? loGeraakt.length / profiel.lo.length : 0;
    if (loGeraakt.length) redenen.push(`raakt ${loGeraakt.join(', ')}`);

    /*
     * c. DE CORRECTIE: is deze leeruitkomst hier nog leeg?
     *
     * Zonder dit stapelt alles zich op in de map die al vol zit. Een map waar
     * de gevonden leeruitkomst nog ontbreekt, krijgt voorrang — dat is precies
     * wat je portfolio nodig heeft.
     */
    const gedekt = new Set(map.gedekt ?? []);
    const vultGat = gevondenLo.filter((code) => profiel.lo.includes(code) && !gedekt.has(code));
    let gatBonus = 0;
    if (vultGat.length) {
      gatBonus = Math.min(0.25, vultGat.length * 0.09);
      redenen.push(`vult hier nog ${vultGat.join(', ')}`);
    }

    /* d. Een lege map krijgt een duwtje: anders blijft hij altijd leeg. */
    const isLeeg = (map.bewijs ?? []).length === 0;
    const leegBonus = isLeeg ? 0.08 : 0;

    const score = onderwerpScore * 1.4 + loScore * 1.0 + gatBonus + leegBonus;

    return {
      map,
      score: Number(score.toFixed(3)),
      onderwerpScore: Number(onderwerpScore.toFixed(3)),
      loScore: Number(loScore.toFixed(3)),
      gatBonus: Number(gatBonus.toFixed(3)),
      leegBonus,
      redenen,
      onderwerpen: geraakt.slice(0, 8),
      lo: loGeraakt,
      vultGat,
    };
  });

  const gesorteerd = kandidaten.sort((a, b) => b.score - a.score);
  const beste = gesorteerd[0];
  const tweede = gesorteerd[1];

  /* Ook de check-voor-map gebruiken als tweede stem. */
  const voorMap = beste?.map?.naam ? checkVoorMap(tekst, beste.map.naam) : null;

  /*
   * Twijfelgevallen. Twee dingen maken een voorstel onzeker:
   *   - de scores liggen dicht bij elkaar
   *   - er is te weinig tekst om iets te zeggen
   */
  const marge = beste && tweede ? beste.score - tweede.score : beste?.score ?? 0;
  const teWeinigTekst = String(tekst).length < 120;
  const onzeker = !beste || beste.score < 0.25 || marge < 0.12 || teWeinigTekst || analyse.onzeker;

  let uitleg;
  if (!beste || beste.score < 0.15) {
    uitleg =
      'Geen enkele map komt duidelijk naar voren. Kies er zelf een — de app gokt hier liever niet.';
  } else if (onzeker && tweede && marge < 0.12) {
    uitleg = `Twijfel tussen ${beste.map.naam} en ${tweede.map.naam}. Kijk zelf welke het beste past.`;
  } else {
    uitleg = `${beste.map.naam} past het beste${beste.redenen.length ? `: ${beste.redenen.join('; ')}` : ''}.`;
    if (teWeinigTekst) uitleg += ' Er is wel weinig tekst om op af te gaan.';
  }

  return {
    voorstel: beste
      ? {
          mapId: beste.map.id ?? beste.map.portflowCollectionId ?? null,
          mapNaam: beste.map.naam,
          score: beste.score,
          redenen: beste.redenen,
          vultGat: beste.vultGat,
        }
      : null,
    alternatieven: gesorteerd.slice(1).map((k) => ({
      mapId: k.map.id ?? k.map.portflowCollectionId ?? null,
      mapNaam: k.map.naam,
      score: k.score,
      redenen: k.redenen,
    })),
    leeruitkomsten: {
      gevonden: analyse.treffers.map((t) => ({ code: t.code, naam: t.naam, relatief: t.relatief })),
      uitleg: analyse.uitleg,
      pastBijVoorgesteldeMap: voorMap?.pastBijMap ?? null,
    },
    onzeker,
    uitleg,
    alle: gesorteerd.map((k) => ({ map: k.map.naam, score: k.score })),
  };
}

/**
 * Regels die uit een Word-export komen maar geen inhoud zijn.
 *
 * Wij maken de Word-bestanden zelf, compleet met inhoudsopgave en een kop met
 * "Auteur:". Zonder dit filter pakt de zinskeuze hieronder de regel
 * `TOC \o "1-3" \h \z \u` en komt die in je toelichting te staan.
 */
const OPMAKREGELS = [
  /^inhoudsopgave$/i,
  /^toc\b/i,
  /^\\o\b/i,
  /^vernieuw de inhoudsopgave/i,
  /^auteur\s*:/i,
  /^datum\s*:/i,
  /^versie\s*:/i,
  /^opleiding\s*:/i,
  /^vak\s*:/i,
  /^begeleiders?\s*:/i,
  /^instelling\s*:/i,
  /^pagina\s*\d+/i,
  /^\d+$/,
];

/** Is deze regel opmaak in plaats van inhoud? */
function isOpmaak(regel) {
  return OPMAKREGELS.some((re) => re.test(regel));
}

/**
 * Stelt een beschrijving voor bij een bewijsstuk.
 *
 * Geen AI: we gebruiken wat we zeker weten. De titel, de map, en de
 * leeruitkomsten die eraan hangen. Dat is genoeg voor een bruikbare regel, en
 * het is eerlijk — er staat niets in wat niet klopt.
 *
 * @param {object} invoer
 * @param {string} invoer.titel
 * @param {string} [invoer.mapNaam]
 * @param {string[]} [invoer.leeruitkomsten]  codes
 * @param {string} [invoer.tekst]             om een onderwerp uit te halen
 */
export function stelBeschrijvingVoor({ titel = '', mapNaam = '', leeruitkomsten = [], tekst = '' }) {
  const naam = String(titel).replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
  const los = leeruitkomsten
    .map((code) => LEERUITKOMSTEN.find((l) => l.code === code))
    .filter(Boolean);

  const delen = [];

  if (naam) delen.push(`${naam}.`);

  if (los.length === 1) {
    delen.push(`Dit stuk laat zien dat ik ${los[0].naam.toLowerCase()} beheers.`);
  } else if (los.length > 1) {
    const namen = los.map((l) => l.naam);
    const laatste = namen.pop();
    delen.push(`Dit stuk laat zien dat ik ${namen.join(', ')} en ${laatste} beheers.`);
  }

  if (mapNaam) {
    delen.push(`Het hoort bij ${mapNaam}.`);
  }

  /*
   * Eén zin over de inhoud, als we die kunnen vinden. We pakken de eerste
   * volzin uit de tekst die lang genoeg is om iets te zeggen. Dat is geen
   * samenvatting maar een aanknopingspunt.
   *
   * De opmaakregels gaan er eerst uit: anders wordt de eerste "zin" de regel
   * met het TOC-veld, en dat leest als een foutmelding.
   */
  const schoon = String(tekst)
    .split('\n')
    .map((r) => r.replace(/\s+/g, ' ').trim())
    .filter((r) => r && !isOpmaak(r))
    .join(' ');

  const eersteZin = schoon
    .split(/(?<=[.!?])\s+/)
    .map((z) => z.trim())
    .find((z) => z.length > 40 && z.length < 200);

  if (eersteZin) delen.push(eersteZin.endsWith('.') ? eersteZin : `${eersteZin}.`);

  return delen.join(' ').trim() || `Bewijsstuk ${naam || ''}`.trim();
}

/**
 * De hele keten: een document binnen, een voorstel eruit.
 *
 * Dit is wat de automatiseringslaag doet voordat er iets wordt verstuurd.
 */
export function analyseerVoorInleveren({ titel, bestandsnaam, tekst, beschrijving, mappen }) {
  const map = bepaalMap({ titel, bestandsnaam, tekst, beschrijving, mappen });
  const codes = map.leeruitkomsten.gevonden.map((t) => t.code);

  /* Alleen de leeruitkomsten die bij de gekozen map horen aanzetten. */
  const profiel =
    MAP_PROFIELEN[String(map.voorstel?.mapNaam ?? '').toLowerCase()] ??
    Object.values(MAP_PROFIELEN).find(
      (p) => p.naam.toLowerCase() === String(map.voorstel?.mapNaam ?? '').toLowerCase(),
    );
  const aanbevolen = profiel ? codes.filter((c) => profiel.lo.includes(c)) : codes;

  const voorstelBeschrijving = stelBeschrijvingVoor({
    titel,
    mapNaam: map.voorstel?.mapNaam ?? '',
    leeruitkomsten: aanbevolen,
    tekst,
  });

  return {
    ...map,
    aanbevolenLeeruitkomsten: aanbevolen,
    voorgesteldeBeschrijving: voorstelBeschrijving,
  };
}
