/**
 * Praten met een taalmodel.
 *
 * De stagebot gebruikt dit om twee dingen te doen die je niet met een
 * zoek-en-vervang kunt doen:
 *
 *   1. uit de tekst van een bedrijfssite halen wat er echt staat (wat doen ze,
 *      welke technologie, waar zit een aanknopingspunt)
 *   2. een mail schrijven die daarnaar verwijst, in plaats van een template
 *
 * Zonder sleutel werkt de rest van de stagebot gewoon; alleen de AI-stappen
 * vallen dan terug op een eenvoudige tekst. Dat is bewust: je moet kunnen
 * zien wat er gebeurt voordat je een sleutel hoeft te regelen.
 */

import { inProject, vindEnv } from '../../mcp/lib/paden.mjs';
import { readFileSync, existsSync } from 'node:fs';

/** Waar de sleutel vandaan kan komen. */
export const SLEUTEL_BRONNEN = [
  'DEEPSEEK_API_KEY in de omgeving',
  'DEEPSEEK_API_KEY in .env',
  '../KravaDoc/.env (de sleutel die Krava al gebruikt)',
];

const MODEL = process.env.STAGEBOT_MODEL || 'deepseek-chat';
const API = process.env.STAGEBOT_API || 'https://api.deepseek.com/chat/completions';

function leesEnvBestand(pad) {
  if (!pad || !existsSync(pad)) return null;
  const tekst = readFileSync(pad, 'utf8');
  const regel = tekst
    .split(/\r?\n/)
    .find((r) => r.trim().startsWith('DEEPSEEK_API_KEY='));
  if (!regel) return null;
  return regel.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') || null;
}

/**
 * Zoekt de sleutel.
 *
 * We lenen bewust de sleutel van Krava als de zijne er is: dat is dezelfde
 * rekening, en het scheelt een tweede sleutel in een tweede bestand. Je kunt
 * altijd je eigen sleutel in .env zetten; die gaat voor.
 */
export function vindSleutel() {
  if (process.env.DEEPSEEK_API_KEY) {
    return { sleutel: process.env.DEEPSEEK_API_KEY, bron: 'omgeving' };
  }
  const env = vindEnv();
  const uitEnv = leesEnvBestand(env);
  if (uitEnv) return { sleutel: uitEnv, bron: env };

  // De sleutel die Krava al gebruikt: één map hoger, in KravaDoc.
  const krava = inProject('..', 'KravaDoc', '.env');
  const uitKrava = leesEnvBestand(krava);
  if (uitKrava) return { sleutel: uitKrava, bron: krava };

  return { sleutel: null, bron: null };
}

/** Is er een sleutel? Handig om te weten voordat je iets probeert. */
export function aiBeschikbaar() {
  return Boolean(vindSleutel().sleutel);
}

/**
 * Eén vraag aan het model.
 *
 * @param {object} opties
 * @param {string} opties.systeem   de rol die het model speelt
 * @param {string} opties.vraag     wat je wilt weten
 * @param {number} [opties.temperatuur]
 * @param {number} [opties.maxTekens]
 * @returns {Promise<string>}
 */
export async function vraag({ systeem, vraag: vraagTekst, temperatuur = 0.4, maxTekens = 2000 }) {
  const { sleutel, bron } = vindSleutel();
  if (!sleutel) {
    throw new Error(
      `Geen DeepSeek-sleutel gevonden. Zet DEEPSEEK_API_KEY in ${vindEnv() ?? 'het .env-bestand van het project'}.`,
    );
  }

  const antwoord = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sleutel}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: temperatuur,
      max_tokens: maxTekens,
      messages: [
        { role: 'system', content: systeem },
        { role: 'user', content: vraagTekst },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!antwoord.ok) {
    const tekst = await antwoord.text().catch(() => '');
    // De sleutel nooit in een foutmelding laten belanden.
    throw new Error(`Het model antwoordde met status ${antwoord.status}. ${tekst.slice(0, 300)}`);
  }

  const data = await antwoord.json();
  const inhoud = data?.choices?.[0]?.message?.content;
  if (!inhoud) {
    throw new Error('Het model gaf een leeg antwoord.');
  }
  return inhoud.trim();
}

/**
 * Vraagt het model om JSON.
 *
 * Modellen zetten soms tekst om de JSON heen. We knippen het eerste object of
 * de eerste lijst eruit en proberen dat te parsen, in plaats van meteen te
 * falen — dat scheelt een hoop gepuzzel.
 */
export async function vraagJson({ systeem, vraag: vraagTekst, temperatuur = 0.2, maxTekens = 2000 }) {
  const ruw = await vraag({
    systeem: `${systeem}\n\nAntwoord uitsluitend met geldige JSON. Geen uitleg, geen markdown, geen codeblok.`,
    vraag: vraagTekst,
    temperatuur,
    maxTekens,
  });

  const pogingen = [ruw];

  // Een codeblok eromheen.
  const blok = ruw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (blok) pogingen.push(blok[1].trim());

  // Het eerste { ... } of [ ... ].
  const object = ruw.match(/(\{[\s\S]*\})/);
  if (object) pogingen.push(object[1]);
  const lijst = ruw.match(/(\[[\s\S]*\])/);
  if (lijst) pogingen.push(lijst[1]);

  for (const p of pogingen) {
    try {
      return JSON.parse(p);
    } catch {
      // volgende poging
    }
  }

  throw new Error(`Het model gaf geen leesbare JSON. Begin van het antwoord: ${ruw.slice(0, 200)}`);
}
