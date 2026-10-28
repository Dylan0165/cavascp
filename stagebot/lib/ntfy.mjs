/**
 * Pushmeldingen via ntfy.
 *
 * WAAROM DIT ER IS
 *
 * Teams blijkt bij Fontys dichtgezet: de webhook-connector én de algemene
 * HTTP-trigger botsen met het DLP-beleid van de tenant. Dat is een beleid, geen
 * fout — en dus zoeken we een kanaal dat niemand hoeft goed te keuren.
 *
 * ntfy is dat kanaal: een onderwerpnaam volstaat, je hoeft geen account te
 * maken. Een melding gaat naar https://ntfy.sh/<onderwerp> en komt binnen in de
 * ntfy-app of in je browser. Het is openbaar tenzij je een geheim onderwerp
 * kiest — vandaar de willekeurige naam die we genereren.
 *
 * WAT ER IN DE MELDING STAAT
 *
 * Alleen de titel en één regel tekst. Geen mailinhoud, geen bedrijfsdossiers.
 * Wie het onderwerp raadt, ziet alleen dát er iets verstuurd is.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { inData } from '../../mcp/lib/paden.mjs';

const PAD = inData('stagebot', 'ntfy.json');
const BASIS = process.env.NTFY_URL || 'https://ntfy.sh';
const TIMEOUT_MS = 10_000;

/** Een onraadbaar onderwerp: 24 tekens uit een veilige set. */
export function nieuwTopic() {
  return `stagebot-${randomBytes(9).toString('base64url').toLowerCase()}`;
}

export function bewaarTopic(topic) {
  const schoon = String(topic ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(schoon)) {
    throw new Error('Een ntfy-onderwerp bestaat uit letters, cijfers, - en _, minstens 8 tekens.');
  }
  mkdirSync(path.dirname(PAD), { recursive: true });
  writeFileSync(PAD, JSON.stringify({ versie: 1, topic: schoon }, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(PAD, 0o600);
  } catch {
    /* niet elk bestandssysteem doet dit */
  }
  return { topic: schoon };
}

export function verwijderTopic() {
  if (existsSync(PAD)) rmSync(PAD);
}

export function vindTopic() {
  if (process.env.NTFY_TOPIC) return { topic: process.env.NTFY_TOPIC.trim(), bron: 'omgeving' };
  if (!existsSync(PAD)) return null;
  try {
    const data = JSON.parse(readFileSync(PAD, 'utf8'));
    return data.topic ? { topic: data.topic, bron: 'het scherm' } : null;
  } catch {
    return null;
  }
}

export function ntfyBeschikbaar() {
  return vindTopic() !== null;
}

/**
 * Stuurt één pushmelding.
 *
 * ntfy verwacht platte tekst in de body en de rest in headers. De titel gaat
 * mee als `Title`, de urgentie als `Priority`.
 */
export async function verstuurPush({ titel, tekst, prioriteit = 3, tags = ['robot'] } = {}) {
  const gevonden = vindTopic();
  if (!gevonden) throw new Error('Geen ntfy-onderwerp ingesteld.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const antwoord = await fetch(`${BASIS}/${encodeURIComponent(gevonden.topic)}`, {
      method: 'POST',
      headers: {
        Title: encodeURIComponent(titel ?? 'Stagebot'),
        Priority: String(prioriteit),
        Tags: tags.join(','),
      },
      body: tekst ?? '',
      signal: controller.signal,
    });

    if (!antwoord.ok) {
      const reden = (await antwoord.text().catch(() => '')).slice(0, 160);
      throw new Error(`ntfy gaf HTTP ${antwoord.status}${reden ? `: ${reden}` : ''}`);
    }

    return { ok: true, topic: gevonden.topic };
  } catch (fout) {
    if (fout.name === 'AbortError') throw new Error('ntfy antwoordde niet op tijd.');
    throw fout;
  } finally {
    clearTimeout(timer);
  }
}
