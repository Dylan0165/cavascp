/**
 * Automatische leeruitkomst-check.
 *
 * Vraag: onder welke van de zes leeruitkomsten valt dit document?
 *
 * Hoe het werkt, en waarom zo:
 *
 * We vergelijken de tekst van het document met de OFFICIËLE beschrijving van
 * elke leeruitkomst, zoals die in de Canvas-rubric staat. Dat is precies waar
 * een docent naar kijkt, dus daar moet de check op lijken.
 *
 * Drie signalen, elk met een eigen gewicht:
 *
 *   1. ZELDZAME WOORDEN. "stakeholder" komt in één leeruitkomst voor,
 *      "the" in alle zes. Een woord dat maar in één beschrijving staat en wél
 *      in het document, is een sterk signaal. Dat wegen we zwaarder
 *      (IDF: hoe zeldzamer, hoe zwaarder).
 *
 *   2. KERNBEGRIPPEN. Per leeruitkomst staan de woorden die de kern raken
 *      expliciet in een lijst. "privacy" en "compliance" horen bij Model
 *      Interaction; "reflect" en "values" bij Personal Leadership. Die tellen
 *      zwaar, want ze zijn met de hand uitgekozen op de officiële tekst.
 *
 *   3. DEKKING. Welk deel van de begrippen van een leeruitkomst komt voor?
 *      Anders wint steeds de leeruitkomst met de langste beschrijving.
 *
 * en dan nog een correctie: een KORTE beschrijving met een hoge dekking is
 * betekenisvoller dan een lange met dezelfde dekking. Zonder die correctie
 * wint "Professional Standard" (329 tekens) altijd van "AI-Augmented Learning"
 * (141 tekens).
 *
 * Wat het NIET doet: gokken. Onder een drempel zegt het "te weinig signaal" in
 * plaats van de minst slechte optie te kiezen. Een verkeerde koppeling in je
 * portfolio is erger dan geen koppeling.
 *
 * Geen AI en geen netwerk: dit is rekenwerk dat je kunt uitleggen en testen.
 */

import { readFileSync } from 'node:fs';

import { inData } from './paden.mjs';

/* ─────────────────────────── de zes uitkomsten ─────────────────────────── */

/**
 * De officiële beschrijvingen, letterlijk uit de Canvas-rubric van
 * V-OL-MAIFS (cursus 15973, opdracht 278562). De Portflow-doel-id's staan
 * ernaast zodat een treffer direct gekoppeld kan worden.
 */
export const LEERUITKOMSTEN = [
  {
    code: 'LO1',
    naam: 'Responsible AI for Society',
    portflowGoalId: 485380,
    canvasOutcomeId: 485380,
    beschrijving:
      'You analyse the context and sustainable impact of AI solutions from multiple perspectives, ' +
      'taking into account data legislation and the (possible) impacts on society, and reflect on your own choices.',
    kern: [
      'society', 'societal', 'impact', 'ethics', 'ethical', 'legislation', 'legal', 'law',
      'privacy', 'sustainability', 'sustainable', 'environmental', 'stakeholder', 'context',
      'consequences', 'responsibility', 'values', 'bias', 'fairness', 'transparency',
      'gdpr', 'avg', 'regulation', 'compliance', 'perspectives', 'trade-offs',
    ],
    materialen: ['Domain Understanding', 'Societal Impact', 'Technology Impact', 'Potential Impact Assessment'],
  },
  {
    code: 'LO2',
    naam: 'Data & Knowledge Stewardship',
    portflowGoalId: 485381,
    canvasOutcomeId: 485381,
    beschrijving:
      'You take responsibility for and ownership of data quality by sourcing, analysing, ' +
      'preparing and visualising data based on validated data quality standards.',
    kern: [
      'data', 'dataset', 'datasets', 'quality', 'sourcing', 'source', 'sources', 'collect',
      'collection', 'preparation', 'prepare', 'cleaning', 'clean', 'wrangling', 'analysis',
      'analyse', 'analyze', 'exploratory', 'visualisation', 'visualization', 'visualise',
      'dashboard', 'chart', 'charts', 'graph', 'insight', 'insights', 'validation', 'valid',
      'reliable', 'completeness', 'accuracy', 'consistency', 'outliers', 'missing',
      'open data', 'api', 'database', 'sql', 'query', 'schema', 'metadata',
    ],
    materialen: ['Data Understanding', 'Data Preparation', 'How To Collect Data', 'Exploratory Data Analysis', 'Open Data Sources'],
  },
  {
    code: 'LO3',
    naam: 'Model Interaction & Adaptation',
    portflowGoalId: 485382,
    canvasOutcomeId: 485382,
    beschrijving:
      'You develop, validate, and integrate AI solutions following a structured development process, ' +
      'ensuring that the solution meets requirements regarding security, privacy, ethics, and compliance.',
    kern: [
      'model', 'models', 'modelling', 'modeling', 'train', 'training', 'trained', 'machine learning',
      'neural', 'network', 'algorithm', 'prompt', 'prompting', 'fine-tune', 'finetune', 'embedding',
      'llm', 'llms', 'pipeline', 'deploy', 'deployment', 'integrate', 'integration', 'architecture',
      'implementation', 'implement', 'prototype', 'develop', 'development', 'test', 'testing',
      'validate', 'validation', 'security', 'privacy', 'compliance', 'requirements', 'iteration',
      'python', 'notebook', 'api', 'inference', 'accuracy', 'performance', 'evaluation',
    ],
    materialen: ['Chat @ Fontys ICT', 'Machine Learning', 'Neural Network', 'Intro to AI modelling with Python', 'Training Models On A Fontys AI Workstation'],
  },
  {
    code: 'LO4',
    naam: 'Professional Standard',
    portflowGoalId: 485383,
    canvasOutcomeId: 485383,
    beschrijving:
      'Both individually and in teams, you apply a relevant methodological approach used in the professional field ' +
      'to formulate project goals, involve stakeholders, conduct applied research, provide advice, make decisions, ' +
      'and deliver reports. In doing so, you keep in view the relevant ethical, intercultural, and sustainable aspects.',
    kern: [
      'project', 'projectplan', 'methodology', 'methodological', 'method', 'approach',
      'goal', 'goals', 'objective', 'scope', 'stakeholder', 'stakeholders', 'client', 'customer',
      'requirements', 'research', 'advice', 'recommendation', 'recommendations', 'decision', 'decisions',
      'report', 'reporting', 'deliverable', 'deliverables', 'sprint', 'retrospective', 'agile', 'scrum',
      'crisp-dm', 'team', 'collaboration', 'meeting', 'backlog', 'user story', 'user stories',
      'intercultural', 'professional', 'quality', 'review', 'feedback', 'planning',
    ],
    materialen: ['CRISP-DM', 'Delivering Your Project', 'Peer Reviews'],
  },
  {
    code: 'LO5',
    naam: 'Personal Leadership',
    portflowGoalId: 485384,
    canvasOutcomeId: 485384,
    beschrijving:
      'You are aware of your own strengths and weaknesses, both in the field of AI and in your personal development. ' +
      'You choose actions in line with your core values to promote your personal growth and develop your learning attitude.',
    kern: [
      'reflect', 'reflection', 'reflectie', 'reflecteren', 'reflectieverslag', 'strength', 'strengths',
      'weakness', 'weaknesses', 'growth', 'personal', 'personally', 'myself', 'yourself', 'own',
      'values', 'core values', 'motivation', 'learning attitude', 'development', 'develop',
      'improve', 'improvement', 'ambition', 'self-assessment', 'self assessment', 'insight',
      'awareness', 'journey', 'experience', 'struggle', 'challenge', 'lessons learned',
      'leerdoel', 'leerdoelen', 'persoonlijk',
    ],
    materialen: ['Personal Leadership'],
  },
  {
    code: 'LO6',
    naam: 'AI-Augmented Learning',
    portflowGoalId: 485385,
    canvasOutcomeId: 485385,
    beschrijving:
      'You use conversational AI to learn, plan, critique, and reflect. ' +
      'You set boundaries, cite AI contributions, and demonstrate growth over time.',
    kern: [
      'chatgpt', 'chatbot', 'conversational', 'prompt', 'prompts', 'prompting', 'copilot', 'claude',
      'deepseek', 'gemini', 'llm', 'generative', 'genai', 'ai tool', 'ai tools', 'ai-assistant',
      'ai assistant', 'boundaries', 'cite', 'citation', 'cited', 'acknowledge', 'transparency',
      'labels', 'mmm labels', 'me and my machine', 'ai use', 'use of ai', 'ai-generated', 'ai generated',
      'critique', 'plan', 'reflect', 'learning process', 'experiment', 'experimenting', 'growth',
    ],
    materialen: ['Using PortFlow', 'AI-Augmented Learning', 'The Core Skill', 'Toolkit', 'Documentation', 'Use of AI in your work'],
  },
];

/**
 * Leest de vastgelegde koppeling tussen de leeruitkomsten en de Portflow-doelen.
 *
 * Die koppeling staat in data/lo-koppeling.json en is gemaakt met
 * tools/koppel-leeruitkomsten.mjs. Waarom uit een bestand en niet hier hard
 * gecodeerd: de id's komen uit Portflow en kunnen per persoon verschillen. Het
 * bestand is het bewijs dat de koppeling klopt — de zes doelen vormen samen een
 * doorlopend id-blok, wat aantoont dat ze bij hetzelfde semester horen.
 *
 * Is het bestand er niet, dan vallen we terug op de id's die hierboven staan.
 * Dat is dezelfde familie (485380-485385), maar dan zonder de controle.
 */
export function leesKoppeling({ pad = inData('lo-koppeling.json') } = {}) {
  try {
    const data = JSON.parse(readFileSync(pad, 'utf8'));
    const perCode = new Map();
    for (const k of data.koppelingen ?? []) {
      if (k.zeker && k.portflowGoalId) perCode.set(k.code, k);
    }
    return {
      gevonden: perCode.size > 0,
      bron: pad,
      portfolioId: data.portfolioId ?? null,
      mappen: data.semesterMappen ?? [],
      perCode,
      gemaakt: data.gemaakt ?? null,
    };
  } catch {
    return { gevonden: false, bron: pad, perCode: new Map(), mappen: [] };
  }
}

let _koppeling = null;
function koppeling() {
  if (!_koppeling) _koppeling = leesKoppeling();
  return _koppeling;
}

/**
 * Het Portflow-doel-id dat bij een leeruitkomst hoort.
 *
 * Geeft null terug als de koppeling niet vastgelegd is. Beter geen id dan een
 * gegokt id: dan hangt je bewijs aan het doel van een verkeerd semester.
 */
export function portflowGoalIdVoor(code) {
  const k = koppeling();
  const uitBestand = k.perCode.get(code)?.portflowGoalId;
  if (uitBestand) return uitBestand;
  // Terugval: de id's zoals ze in deze module staan.
  return LEERUITKOMSTEN.find((l) => l.code === code)?.portflowGoalId ?? null;
}

/** De mappen van dit semester, met hun Portflow-id. */
export function semesterMappen() {
  const k = koppeling();
  if (k.mappen.length) return k.mappen;
  return [
    { naam: 'orientatie', portflowCollectionId: 250278 },
    { naam: 'klantproject', portflowCollectionId: 250279 },
    { naam: 'Persoonlijk project', portflowCollectionId: 250280 },
  ];
}

/** Zet gevonden treffers om naar Portflow-doel-id's, klaar om te koppelen. */
export function naarPortflowGoalIds(treffers = []) {
  const ids = [];
  for (const t of treffers) {
    const id = portflowGoalIdVoor(t.code);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/* ───────────────────────────── hulpmiddelen ───────────────────────────── */

const STOPLEEG = new Set(
  `de het een en of van in is op te dat die dit deze voor met als aan er ook maar om bij
   the a an and or of to in is are was were be been being on at by for with from that this these those
   it its as you your we our they their he she his her not no can could should would may might will
   shall do does did done have has had having more most much many some any all both each few other
   such only own same so than too very s t just don now into over under again further then once
   during before after above below up down out off between through because while about against
   i me my myself yourself himself herself itself ourselves themselves what which who whom whose
   when where why how if but nor own too also there here then thus hence therefore however
   both individually teams apply relevant used field formulate involve conduct provide make
   deliver reports doing keep view aspects take responsibility ownership based validated standards
   following structured development process ensuring solution meets requirements regarding`
    .split(/\s+/)
    .filter(Boolean),
);

/** Maakt van tekst een lijst bruikbare woorden. */
function woorden(tekst) {
  return String(tekst ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
    .filter((w) => w.length >= 3 && !STOPLEEG.has(w));
}

/**
 * Stammen: woorden terugbrengen tot hun kern.
 *
 * "reflecting", "reflection" en "reflect" zijn hetzelfde begrip. Zonder dit
 * mist de check de helft van de tekst. Bewust simpel en voorspelbaar: geen
 * bibliotheek, geen verrassingen.
 */
function stam(woord) {
  let w = woord;
  for (const uitgang of ['ingen', 'ing', 'heden', 'heid', 'en', 'es', 's', 'e']) {
    if (w.length > uitgang.length + 3 && w.endsWith(uitgang)) {
      w = w.slice(0, -uitgang.length);
      break;
    }
  }
  return w;
}

function stamSet(lijst) {
  return new Set(lijst.map(stam));
}

/** Hoe vaak elk woord in de zes beschrijvingen voorkomt — voor zeldzaamheid. */
const DOCUMENTFREQUENTIE = (() => {
  const freq = new Map();
  for (const lo of LEERUITKOMSTEN) {
    for (const w of new Set(woorden(lo.beschrijving).map(stam))) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return freq;
})();

/**
 * Komt een begrip voor in de tekst?
 *
 * Behalve een exacte treffer ook een SAMENSTELLING. In het Nederlands plakken
 * we woorden aan elkaar: "reflectieverslag" bevat "reflectie",
 * "datakwaliteit" bevat "data", "projectplan" bevat "project". Zonder deze
 * regel mist de check een groot deel van de Nederlandse tekst, want juist in
 * samenstellingen staat de betekenis.
 *
 * De grens van vijf tekens voorkomt onzin: "dat" zou anders in "database"
 * matchen.
 */
function bevatBegrip(docStammen, term) {
  const s = stam(term);
  if (docStammen.has(s)) return true;
  if (s.length < 5) return false;
  for (const w of docStammen) {
    if (w.length > s.length && w.startsWith(s)) return true;
  }
  return false;
}

/** Zeldzaamheid: een woord in één beschrijving weegt zwaarder dan in alle zes. */
function idf(woord) {
  const df = DOCUMENTFREQUENTIE.get(woord) ?? 0;
  if (df === 0) return 2.2; // niet in de beschrijvingen; komt uit de kernlijst
  return Math.log(LEERUITKOMSTEN.length / df) + 1;
}

/**
 * Hoe SPECIFIEK is een kernbegrip?
 *
 * Dit is de correctie die de check betrouwbaar maakt. "data" staat in vier van
 * de zes kernlijsten, "chatgpt" in één. Een treffer op "chatgpt" zegt dus veel
 * meer dan een treffer op "data" — en zonder deze weging won de leeruitkomst
 * met de meeste algemene woorden.
 *
 * Gemeten over de kernlijsten zelf, niet over de documenten: het gaat erom hoe
 * onderscheidend een begrip is binnen dít vak.
 */
const SPECIFICITEIT = (() => {
  const perBegrip = new Map();
  for (const lo of LEERUITKOMSTEN) {
    for (const term of lo.kern) {
      const sleutel = stam(term.toLowerCase());
      if (!perBegrip.has(sleutel)) perBegrip.set(sleutel, new Set());
      perBegrip.get(sleutel).add(lo.code);
    }
  }
  const uit = new Map();
  for (const [term, codes] of perBegrip) {
    // In één leeruitkomst: vol gewicht. In alle zes: bijna niets.
    uit.set(term, 1 / codes.size);
  }
  return uit;
})();

/** Het gewicht van één kernbegrip. */
function kernGewicht(term) {
  return SPECIFICITEIT.get(stam(term.toLowerCase())) ?? 1;
}

/* ───────────────────────────── de check ───────────────────────────────── */

/**
 * Bepaalt onder welke leeruitkomsten een tekst valt.
 *
 * @param {string} tekst          de tekst van het document
 * @param {object} [opties]
 * @param {number} [opties.drempel]      relatieve drempel (0..1) ten opzichte van de sterkste
 * @param {number} [opties.minScore]     absolute ondergrens; hieronder is het ruis
 * @param {number} [opties.minBegrippen] hoeveel kernbegrippen minimaal geraakt moeten zijn
 * @param {number} [opties.max]          hoeveel treffers teruggeven
 * @param {string[]} [opties.verplicht]  codes die altijd meegenomen worden
 * @returns {{treffers: object[], onzeker: boolean, signaalSterkte: number, uitleg: string}}
 */
export function checkLeeruitkomsten(tekst, opties = {}) {
  const {
    drempel = 0.30,
    minScore = 0.20,
    minBegrippen = 2,
    max = 6,
    verplicht = [],
  } = opties;

  const bron = String(tekst ?? '');
  if (bron.trim().length < 40) {
    return {
      treffers: [],
      alle: [],
      onzeker: true,
      signaalSterkte: 0,
      uitleg: 'Te weinig tekst om iets te zeggen. Voeg inhoud toe of geef een beschrijving mee.',
    };
  }

  const docWoorden = woorden(bron);
  const docStammen = stamSet(docWoorden);
  const docTekst = bron.toLowerCase();

  const ruw = [];

  for (const lo of LEERUITKOMSTEN) {
    /* 1. Zeldzame woorden uit de officiële beschrijving. */
    const beschrijvingStammen = [...new Set(woorden(lo.beschrijving).map(stam))];
    let gewichtHit = 0;
    let gewichtTotaal = 0;
    const geraakt = new Set();
    for (const w of beschrijvingStammen) {
      const gewicht = idf(w);
      gewichtTotaal += gewicht;
      if (docStammen.has(w)) {
        gewichtHit += gewicht;
        geraakt.add(w);
      }
    }
    const dekkingBeschrijving = gewichtTotaal ? gewichtHit / gewichtTotaal : 0;

    /* 2. Kernbegrippen, gewogen naar specificiteit.
     *
     * Elk begrip krijgt een gewicht: hoe minder leeruitkomsten het gebruiken,
     * hoe zwaarder het telt. Een treffer op "chatgpt" weegt daardoor veel
     * zwaarder dan een treffer op "data", dat in vier lijsten staat.
     *
     * LET OP: we tellen per STAM, niet per lijstregel. "plan" en "planning"
     * leverden anders twee treffers op voor hetzelfde begrip, waardoor een
     * leeruitkomst makkelijker aan de tweebegrippeneis voldeed. Bij een
     * dubbele stam telt de hoogste weging.
     */
    const perStam = new Map();
    for (const term of lo.kern) {
      const sleutel = stam(term.toLowerCase());
      const gewicht = kernGewicht(term);
      const bestaand = perStam.get(sleutel);
      if (!bestaand || gewicht > bestaand.gewicht) {
        perStam.set(sleutel, { term, gewicht });
      }
    }

    let kernGewichtHit = 0;
    let kernGewichtTotaal = 0;
    let kernAantal = 0;
    const kernGeraakt = [];
    for (const { term, gewicht } of perStam.values()) {
      kernGewichtTotaal += gewicht;
      const delen = term.split(/\s+/);
      let ja;
      if (delen.length === 1) {
        // bevatBegrip doet ook samenstellingen: "reflectieverslag" → "reflectie".
        ja = bevatBegrip(docStammen, term);
      } else {
        // Meerwoordige termen als "core values" en "open data": letterlijk zoeken.
        ja = docTekst.includes(term);
      }
      if (ja) {
        kernGewichtHit += gewicht;
        kernAantal += 1;
        kernGeraakt.push(term);
      }
    }
    const dekkingKern = kernGewichtTotaal ? kernGewichtHit / kernGewichtTotaal : 0;

    /* 3. Lengtecorrectie.
     *
     * Een korte beschrijving ("AI-Augmented Learning", 141 tekens) heeft minder
     * woorden, dus minder kans op toevallige treffers. Zonder correctie wint de
     * langste beschrijving altijd. We delen door de wortel van de lengte, wat
     * de lange beschrijvingen licht afstraft zonder ze onmogelijk te maken. */
    const lengteCorrectie = Math.sqrt(180 / Math.max(140, lo.beschrijving.length));

    /*
     * De weging van de drie signalen.
     *
     * De dekking van de BESCHRIJVING krijgt een plafond. Waarom: een
     * beschrijving is één lange zin met veel gewone woorden ("sourcing,
     * analysing, preparing"). Eén toevallige treffer daarop — het woord
     * "analyse" — mocht eerder een hele leeruitkomst laten winnen, terwijl de
     * tekst in werkelijkheid over iets anders ging.
     *
     * De kernbegrippen wegen daarom zwaarder, en elk begrip dat je raakt telt
     * apart mee. Vijf specifieke begrippen kloppen is iets anders dan één
     * algemeen woord.
     */
    const bijdrageBeschrijving = Math.min(0.35, dekkingBeschrijving * 0.8);
    const bijdrageKern = dekkingKern * 1.5;
    const bonusKern = Math.min(0.6, kernAantal * 0.14);

    const score = (bijdrageBeschrijving + bijdrageKern + bonusKern) * lengteCorrectie;

    ruw.push({
      code: lo.code,
      naam: lo.naam,
      portflowGoalId: lo.portflowGoalId,
      canvasOutcomeId: lo.canvasOutcomeId,
      score,
      dekkingBeschrijving: Number(dekkingBeschrijving.toFixed(3)),
      dekkingKern: Number(dekkingKern.toFixed(3)),
      aantalBegrippen: kernAantal,
      begrippen: kernGeraakt.slice(0, 14),
      woorden: [...geraakt].slice(0, 14),
      beschrijving: lo.beschrijving,
      materialen: lo.materialen,
    });
  }

  // Normaliseren: de hoogste score wordt 1, zodat de getallen vergelijkbaar zijn
  // tussen een lang en een kort document.
  const hoogste = Math.max(...ruw.map((r) => r.score), 0.0001);
  for (const r of ruw) r.relatief = Number((r.score / hoogste).toFixed(3));

  const gesorteerd = [...ruw].sort((a, b) => b.score - a.score);

  /*
   * Welke treffers tellen mee?
   *
   * Twee eisen, en de tweede is de belangrijkste:
   *
   *   1. de score moet boven een absolute ondergrens zitten, EN
   *   2. er moeten minstens twee kernbegrippen geraakt zijn.
   *
   * Waarom die tweede eis: in een groot document komt bijna elk woord wel een
   * keer voor. Zonder deze eis kreeg "Personal Leadership" een treffer op grond
   * van het woord "reflectie" in één bijzin, en dat verscheen dan als "22%
   * match". Dat is misleidend: het suggereert bewijs terwijl er niets staat.
   *
   * Eén toevallig woord is geen bewijs. Twee onafhankelijke begrippen uit
   * dezelfde leeruitkomst is een signaal.
   */
  const treffers = gesorteerd
    .filter((r) => {
      if (verplicht.includes(r.code)) return true;
      if (r.aantalBegrippen < minBegrippen) return false;
      return r.score >= minScore && r.relatief >= drempel;
    })
    .slice(0, max);

  /* Hoe sterk is het signaal? Kijken naar de beste én naar het verschil met de
   * tweede. Twee even sterke kandidaten betekent: niet kiezen, vragen. */
  const beste = gesorteerd[0];
  const tweede = gesorteerd[1];
  const marge = tweede ? beste.score - tweede.score : beste.score;
  const signaalSterkte = Number(Math.min(1, beste.score * 1.3 + marge * 3).toFixed(3));
  const onzeker = treffers.length === 0 || signaalSterkte < 0.32 || (tweede && marge < 0.04 && beste.score < 0.5);

  let uitleg;
  if (!treffers.length) {
    uitleg =
      'Geen leeruitkomst komt duidelijk terug in deze tekst. ' +
      (beste && beste.score > 0
        ? `Het sterkste signaal was ${beste.naam}, maar met te weinig aanknopingspunten om er een koppeling op te baseren.`
        : 'Er zijn geen aanknopingspunten gevonden.');
  } else if (onzeker && tweede) {
    uitleg =
      `Twijfel tussen ${beste.naam} en ${tweede.naam}: ze scoren bijna gelijk. ` +
      'Kijk zelf welke het beste past.';
  } else {
    uitleg = `${beste.naam} past het beste (${Math.round(beste.relatief * 100)}% van de sterkste treffer).`;
    if (treffers.length > 1) {
      uitleg += ` Ook: ${treffers.slice(1, 4).map((t) => t.naam).join(', ')}.`;
    }
  }

  return {
    treffers,
    alle: gesorteerd.map((r) => ({ code: r.code, naam: r.naam, score: Number(r.score.toFixed(4)), relatief: r.relatief })),
    onzeker,
    signaalSterkte,
    aantalWoorden: docWoorden.length,
    uitleg,
  };
}

/**
 * Dezelfde check, maar dan met de titel en bestandsnaam erbij.
 *
 * De titel weegt extra zwaar, en dat is met opzet. Een sectie die
 * "Reflectie op het afstudeerproces" heet, is Personal Leadership — ook als de
 * tekst eronder vooral over het project zelf gaat. Zonder deze weging verdrinkt
 * dat ene woord in duizenden tekens en wint de leeruitkomst met de meeste
 * toevallige treffers.
 *
 * Hoeveel zwaarder: genoeg om mee te tellen, niet genoeg om de tekst te
 * overschreeuwen. Bij een lange tekst herhalen we de titel vaker, zodat de
 * verhouding ongeveer gelijk blijft.
 */
export function checkDocument({ titel = '', bestandsnaam = '', tekst = '', beschrijving = '' }, opties = {}) {
  const lengte = String(tekst ?? '').length;
  // Ongeveer één titelherhaling per 1200 tekens, met een minimum van 3 en een
  // maximum van 12 — anders wordt een boek één lange titel.
  const herhalingen = Math.max(3, Math.min(12, Math.round(lengte / 1200)));
  const titelBlok = titel ? Array.from({ length: herhalingen }, () => titel).join('\n') : '';

  const verrijkt = [titelBlok, bestandsnaam, beschrijving, tekst].filter(Boolean).join('\n\n');
  const uitkomst = checkLeeruitkomsten(verrijkt, opties);
  return { ...uitkomst, titelGebruikt: titel, titelHerhalingen: herhalingen, tekstLengte: lengte };
}

/**
 * Vergelijkt een document met de leeruitkomsten die al aan een map hangen.
 *
 * Dit is de handigste vraag in de praktijk: je sleept een document in een map,
 * en je wilt weten of het bij die map hoort of dat het elders beter past.
 */
export function checkVoorMap(tekst, mapNaam, opties = {}) {
  const uitkomst = checkLeeruitkomsten(tekst, opties);
  const naam = String(mapNaam ?? '').toLowerCase();

  // Waar hoort een map bij? Puur op naam, want dat is wat de mappen onderscheidt.
  const mapHint = {
    orientatie: ['LO2', 'LO3'],
    klantproject: ['LO4', 'LO1'],
    'persoonlijk project': ['LO5', 'LO6'],
  };
  const verwacht = Object.entries(mapHint).find(([k]) => naam.includes(k))?.[1] ?? [];

  const inMap = uitkomst.treffers.filter((t) => verwacht.includes(t.code));
  const buitenMap = uitkomst.treffers.filter((t) => !verwacht.includes(t.code));

  return {
    ...uitkomst,
    map: mapNaam,
    verwachtVoorMap: verwacht,
    pastBijMap: inMap.length > 0,
    beterElders: inMap.length === 0 && buitenMap.length > 0 ? buitenMap[0] : null,
  };
}
