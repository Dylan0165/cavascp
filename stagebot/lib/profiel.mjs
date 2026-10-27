/**
 * Wie ben je, en wat zoek je?
 *
 * Elke mail moet kloppen met wat je echt doet en kunt. Daarom komt het profiel
 * niet uit de lucht vallen maar uit twee bronnen:
 *
 *   1. Canvas — welke opleiding, welke minor, welke vakken, welke cijfers
 *   2. Portflow — welk bewijs je al hebt (dat mag je noemen in een mail)
 *
 * Wat je zelf invult staat in data/stagebot/profiel.json. Dat bestand is van
 * jou; de stagebot vult het aan met wat hij uit Canvas haalt.
 *
 * WAAROM DIT ER IS
 *
 * Een mail die zegt "ik ben een gemotiveerde student" is waardeloos. Een mail
 * die zegt "ik doe de minor AI & Data en bouwde een RAG-assistent voor
 * Fontys" — dat is een reden om terug te mailen. Daarvoor moet de bot weten
 * wat je gedaan hebt.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inData } from '../../mcp/lib/paden.mjs';

export const PROFIEL_PAD = inData('stagebot', 'profiel.json');

/** Een leeg profiel met de velden die ertoe doen. */
export function leegProfiel() {
  return {
    naam: 'Dylan Schuurman',
    email: '',
    telefoon: '',
    opleiding: 'HBO-ICT',
    instelling: 'Fontys Hogeschool ICT, Tilburg',
    studiefase: 'Semester 5',
    // Waar je goed in bent, in gewone taal. De bot gebruikt dit, maar verzint
    // er niets bij.
    vaardigheden: [],
    // Projecten die je mag noemen. Kort houden: dit komt in een mail.
    projecten: [],
    // Wat voor stage je zoekt.
    stage: {
      van: '2027-02',
      tot: '2027-06',
      richting: [],
      regio: ['Tilburg', 'Eindhoven', 'Breda', "'s-Hertogenbosch"],
      vorm: '', // meewerken, individuele opdracht of hybride
      volledig: true,
    },
    // Leeruitkomsten van de stage. Deze vier gelden voor S5.
    leeruitkomsten: [
      'Professional duties — werk op junior bachelor-niveau in je IT-domein',
      'Situation-orientation — kennis toepassen in een echte context, met meerdere stakeholders',
      'Professional standard — methodisch werken, toegepast onderzoek, advies en rapportage',
      'Personal leadership — sterke en zwakke punten, kernwaarden, groei',
    ],
    bijgewerkt: null,
  };
}

/** Leest het profiel, of maakt een leeg profiel aan. */
export function leesProfiel() {
  if (!existsSync(PROFIEL_PAD)) {
    const leeg = leegProfiel();
    bewaarProfiel(leeg);
    return leeg;
  }
  try {
    return { ...leegProfiel(), ...JSON.parse(readFileSync(PROFIEL_PAD, 'utf8')) };
  } catch {
    return leegProfiel();
  }
}

export function bewaarProfiel(profiel) {
  mkdirSync(path.dirname(PROFIEL_PAD), { recursive: true });
  const metTijd = { ...profiel, bijgewerkt: new Date().toISOString() };
  writeFileSync(PROFIEL_PAD, JSON.stringify(metTijd, null, 2), 'utf8');
  return metTijd;
}

/**
 * Vult het profiel aan met wat er in Canvas staat.
 *
 * We halen alleen op wat we zeker weten: welke cursussen je volgt en in welke
 * periode. Geen cijfers, geen aannames over niveau.
 */
export async function verrijkVanuitCanvas(canvas, { term } = {}) {
  const profiel = leesProfiel();

  /*
   * Let op het pad. De Canvas-client plakt base + pad aan elkaar, en de base is
   * alleen het domein. Zonder `/api/v1` vraag je de webpagina op in plaats van
   * de API, en dan krijg je een 401 die eruitziet als een ongeldig token.
   */
  const cursussen = await canvas.get('/api/v1/courses', {
    enrollment_state: 'active',
    per_page: 50,
    'include[]': ['term'],
  });

  const nu = (cursussen || [])
    .filter((c) => c.name && !/^(p-db|i2-db)/i.test(c.course_code || ''))
    .map((c) => ({
      naam: c.name,
      code: c.course_code,
      periode: (c.term || {}).name ?? null,
    }));

  profiel.canvas = {
    opgehaald: new Date().toISOString(),
    term: term ?? null,
    cursussen: nu,
  };

  // De minor als die er is: dat is je sterkste verhaal in een mail.
  const minor = nu.find((c) => /MAIFS|minor|V-OL/i.test(`${c.code} ${c.naam}`));
  if (minor && !profiel.studiefase.includes(minor.naam)) {
    profiel.minor = minor.naam;
  }

  return bewaarProfiel(profiel);
}

/**
 * Het profiel als tekst voor het taalmodel.
 *
 * Alleen wat we weten. Ontbreekt er iets, dan staat er niets — en dan kan het
 * model het ook niet verzinnen.
 */
export function profielAlsTekst(profiel = leesProfiel()) {
  const regels = [];

  regels.push(`Naam: ${profiel.naam}`);
  regels.push(`Opleiding: ${profiel.opleiding}, ${profiel.instelling}`);
  if (profiel.studiefase) regels.push(`Fase: ${profiel.studiefase}`);
  if (profiel.minor) regels.push(`Minor: ${profiel.minor}`);

  if (profiel.vaardigheden?.length) {
    regels.push(`Vaardigheden: ${profiel.vaardigheden.join(', ')}`);
  }

  if (profiel.projecten?.length) {
    regels.push('Projecten:');
    for (const p of profiel.projecten) {
      const delen = [p.naam, p.wat].filter(Boolean).join(' — ');
      if (delen) regels.push(`  - ${delen}`);
    }
  }

  if (profiel.canvas?.cursussen?.length) {
    const namen = profiel.canvas.cursussen.map((c) => c.naam).filter(Boolean);
    if (namen.length) regels.push(`Vakken in Canvas: ${namen.join(', ')}`);
  }

  const s = profiel.stage || {};
  if (s.van || s.tot) regels.push(`Stageperiode: ${s.van ?? '?'} tot ${s.tot ?? '?'}`);
  if (s.richting?.length) regels.push(`Richting: ${s.richting.join(', ')}`);
  if (s.regio?.length) regels.push(`Regio: ${s.regio.join(', ')}`);
  if (s.vorm) regels.push(`Vorm: ${s.vorm}`);

  if (profiel.leeruitkomsten?.length) {
    regels.push('Leeruitkomsten die ik moet aantonen:');
    for (const lo of profiel.leeruitkomsten) regels.push(`  - ${lo}`);
  }

  return regels.join('\n');
}
