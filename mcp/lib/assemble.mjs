/**
 * Een Krava-project omzetten naar een Word- of PowerPoint-bestand.
 *
 * Dit is hetzelfde werk dat Krava's eigen export doet, maar dan hier. Waarom
 * hier en niet bij Krava: Krava vraagt een login en geeft zonder sessie 401.
 * Het dashboard leest de projecten daarom rechtstreeks van schijf en maakt het
 * document zelf met dezelfde generator die Krava gebruikt.
 *
 * De opbouw in stappen, precies zoals in Krava's server:
 *
 *   1. het plan is een boom: secties met subsecties, elk met Markdown in `tekst`
 *   2. die boom wordt platgeslagen tot een lijst met een niveau per sectie
 *   3. de Markdown wordt omgezet naar blokken (kop, alinea, lijst, callout, …)
 *   4. een kop die de sectietitel herhaalt gaat eruit — anders staat hij dubbel
 *   5. de blokken gaan naar de generator, samen met de huisstijl
 *
 * Als hier iets afwijkt van Krava, zie je dat in het document. Daarom staat
 * elke stap in een eigen functie die los te testen is.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { bouwDocx } from './docx.mjs';
import { bouwPptx } from './pptx.mjs';
import { ontleed, schoonTekst } from './markdown.mjs';

/* ───────────────────────────── het plan ───────────────────────────────── */

/**
 * Slakt de sectieboom plat.
 *
 * Een sectie kan subsecties hebben, en die weer. Voor het document maakt dat
 * niet uit: het is één rij waarin `niveau` zegt hoe diep hij zit.
 */
export function vlakeSecties(secties, niveau = 1, pad = []) {
  const uit = [];
  for (const sectie of secties || []) {
    const nieuwPad = [...pad, sectie.titel];
    uit.push({ ...sectie, niveau, pad: nieuwPad });
    if (sectie.subsecties && sectie.subsecties.length) {
      uit.push(...vlakeSecties(sectie.subsecties, niveau + 1, nieuwPad));
    }
  }
  return uit;
}

/** Woorden die alleen verschillen in nummering en spaties zijn hetzelfde kopje. */
function zelfdeKop(a, b) {
  const schoon = (t) =>
    String(t || '')
      .toLowerCase()
      .replace(/^\d+[.)]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
  return schoon(a) === schoon(b);
}

/**
 * Bouwt de sectielijst met blokken zoals de generator die wil.
 *
 * @param {object} project  een Krava-project
 * @returns {{secties: object[], gebruikt: Set<string>, ontbrekend: string[]}}
 */
export function assembleer(project) {
  const plat = vlakeSecties(project.plan?.secties || []);

  const secties = plat.map((sectie) => {
    // Een subsectie begint met zijn eigen kop, want die staat niet in de tekst.
    const prefix = sectie.niveau > 1 ? `${'#'.repeat(Math.min(2, sectie.niveau))} ${sectie.titel}\n\n` : '';
    const blokken = markeerFiguren(ontleed(`${prefix}${sectie.tekst || ''}`, sectie.titel))
      // Een kop die de sectietitel herhaalt is ruis: de sectiekop staat er al,
      // en anders komt hij twee keer in de inhoudsopgave.
      .filter((blok) => {
        if (blok.type !== 'heading' && blok.type !== 'subheading') return true;
        return !zelfdeKop(blok.tekst, sectie.titel);
      });
    return { ...sectie, titel: sectie.titel, niveau: sectie.niveau, blokken };
  });

  const gebruikt = new Set();
  for (const sectie of secties) {
    for (const blok of sectie.blokken || []) {
      if (blok.type === 'figure' && blok.ref) gebruikt.add(blok.ref);
    }
    for (const naam of sectie.figuren || []) gebruikt.add(naam);
  }
  const ontbrekend = (project.afbeeldingen || []).filter((b) => !gebruikt.has(b.naam)).map((b) => b.naam);

  return { secties, gebruikt, ontbrekend };
}

/** Markeert welke figuren in de tekst zijn geplaatst. */
function markeerFiguren(blokken) {
  for (const blok of blokken) {
    if (blok.type === 'figure') blok.geplaatst = true;
  }
  return blokken;
}

/* ──────────────────────────── de huisstijl ────────────────────────────── */

/**
 * Zet de huisstijl van het project om naar de opties van de generator.
 *
 * Alles mag ontbreken; de generator heeft eigen standaardwaarden. Zo werkt een
 * project zonder huisstijl ook, en dat is precies wat we willen voor de
 * leeswijzer: die krijgt de vormgeving van het dashboard.
 */
export function docxOpties(project, afbeeldingen = []) {
  const h = project?.huisstijl || {};
  const o = project?.opties || {};
  return {
    afbeeldingen,
    afbeeldingBreedte: Number(h.afbeeldingBreedte) || 1,
    kleuren: {
      accent: h.accent,
      kop2: h.kop2,
      kop3: h.kop3,
      tekst: h.tekst,
      subtekst: h.subtekst,
      tabelKop: h.tabelKop,
      calloutAchtergrond: h.calloutAchtergrond,
      calloutRand: h.accent,
      codeAchtergrond: h.codeAchtergrond,
      codeRand: h.codeRand || '#D8DCE3',
      codeTekst: h.codeTekst || '#24292F',
      tabelRand: h.tabelRand || '#C6CEDA',
      link: h.accent,
    },
    font: {
      tekst: h.fontTekst,
      kop: h.fontKop,
      mono: h.fontMono,
      tekstGrootte: Number(h.tekstGrootte) || 10.5,
      kopGrootte: String(h.kopGrootte || '17,13.5,11.5').split(',').map((n) => Number(n) || 12),
      titelGrootte: Number(h.titelGrootte) || 26,
    },
    spacing: { naAlinea: Number(h.naAlinea) || 6, regelafstand: Number(h.regelafstand) || 276 },
    omslag: o.omslag !== false,
    inhoudsopgave: o.inhoudsopgave !== false,
    paginanummer: o.paginanummer !== false,
    werkInhoudsopgaveBij: o.werkInhoudsopgaveBij !== false,
    koptekst: o.koptekst || '',
    voettekst: o.voettekst || '',
    marges: o.marges || { boven: 2.5, onder: 2.5, links: 2.5, rechts: 2.5 },
    logo: null,
  };
}

/**
 * Zoekt het mediabestand van een project.
 *
 * Krava bewaart beelden in de map van het project zelf. We kijken op een paar
 * logische plekken zodat het ook werkt als de indeling iets afwijkt.
 */
function zoekMedia(projectMap, projectId, naam) {
  for (const kandidaat of [
    path.join(projectMap, `${projectId}-media`, naam),
    path.join(projectMap, projectId, naam),
    path.join(projectMap, naam),
    path.join(projectMap, `${projectId}-media`, `${naam}.png`),
  ]) {
    if (existsSync(kandidaat)) return readFileSync(kandidaat);
  }
  return null;
}

/* ───────────────────────────── de exports ─────────────────────────────── */

/**
 * Maakt een Word-bestand van een Krava-project.
 *
 * @param {object} project
 * @param {object} [opties]
 * @param {string} [opties.projectMap]  waar de media staan (voor afbeeldingen en logo)
 * @returns {{buffer: Buffer, filename: string, statistiek: object}}
 */
export function projectNaarDocx(project, opties = {}) {
  const { secties } = assembleer(project);
  if (!secties.length) {
    throw new Error('Dit project heeft nog geen inhoud om te exporteren.');
  }

  const samen = {
    titel: project.titel,
    subtitel: project.subtitel ?? '',
    auteur: project.auteur,
    instelling: project.instelling,
    opleiding: project.opleiding,
    vak: project.vak,
    begeleiders: project.begeleiders,
    datum: project.datum,
    versie: project.versie,
    secties,
    bronnen: project.bronnen || [],
  };

  let generatorOpties = docxOpties(project, opties.afbeeldingen || opties.beelden || []);
  if (opties.extraKleuren) {
    generatorOpties = {
      ...generatorOpties,
      kleuren: { ...generatorOpties.kleuren, ...opties.extraKleuren },
    };
  }
  if (opties.labels) generatorOpties = { ...generatorOpties, labels: opties.labels };
  if (opties.logoPad && existsSync(opties.logoPad)) {
    generatorOpties.logo = {
      naam: path.basename(opties.logoPad),
      bytes: readFileSync(opties.logoPad),
      formaat: opties.logoPad.toLowerCase().endsWith('.jpg') || opties.logoPad.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png',
      alt: 'Logo',
      bestandsnaam: path.basename(opties.logoPad),
    };
    generatorOpties.logoBreedteCm = Number(project?.huisstijl?.logoBreedteCm) || 3.2;
  }

  const { buffer, statistiek } = bouwDocx(samen, generatorOpties);
  return { buffer, statistiek, filename: bestandsnaam(project.titel, 'docx'), secties };
}

/** Maakt een PowerPoint-bestand van een Krava-project. */
export function projectNaarPptx(project, opties = {}) {
  const { secties } = assembleer(project);
  if (!secties.length) throw new Error('Dit project heeft nog geen inhoud om te exporteren.');

  const samen = {
    titel: project.titel,
    subtitel: project.subtitel ?? '',
    auteur: project.auteur,
    instelling: project.instelling,
    opleiding: project.opleiding,
    vak: project.vak,
    begeleiders: project.begeleiders,
    datum: project.datum,
    versie: project.versie,
    secties,
    bronnen: project.bronnen || [],
  };

  const generatorOpties = docxOpties(project, opties.afbeeldingen || []);
  if (opties.labels) generatorOpties.labels = opties.labels;

  const { buffer, statistiek } = bouwPptx(samen, generatorOpties);
  return { buffer, statistiek, filename: bestandsnaam(project.titel, 'pptx'), secties };
}

/** Een nette bestandsnaam zonder rare tekens. */
export function bestandsnaam(titel, extensie) {
  const schoon = String(titel || 'document')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .replace(/\s+/g, '_');
  return `${schoon || 'document'}.${extensie}`;
}

/** De volledige tekst van een project, voor controle en zoeken. */
export function projectTekst(project) {
  const { secties } = assembleer(project);
  return secties
    .map((s) => `${'#'.repeat(Math.min(3, s.niveau))} ${s.titel}\n\n${schoonTekst(s.tekst || '')}`)
    .join('\n\n');
}

export { zoekMedia };
