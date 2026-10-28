/**
 * Meldingen naar Microsoft Teams.
 *
 * WAAROM EEN WEBHOOK EN GEEN BOT
 *
 * Een echte Teams-bot vraagt een Azure-app, een app-manifest, Bot Framework en
 * toestemming van een beheerder. Voor "stuur een berichtje als er een mail de
 * deur uit is" is dat een vrachtwagen voor een boodschap.
 *
 * Sinds mei 2026 zijn de oude Office 365-connectors (webhook.office.com)
 * uitgeschakeld. Wat ervoor in de plaats kwam is een Power Automate-flow met
 * de trigger "When a Teams webhook request is received". Die geeft je een URL
 * waar je JSON naartoe post, en de flow zet er een kaart van in een kanaal of
 * chat. Dat is wat deze module doet.
 *
 * WAT ER NAAR BUITEN GAAT
 *
 * Alleen wat in de kaart staat: een titel, een paar regels en eventueel een
 * link. Geen bedrijfsdossiers, geen mailteksten, geen wachtwoorden. De URL
 * zelf is een geheim (iedereen met de URL kan in je kanaal posten), dus hij
 * wordt bewaard zoals de Gmail-sleutel: in een eigen bestand, alleen leesbaar
 * voor jou.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { inData, inProject, vindEnv } from '../../mcp/lib/paden.mjs';

const KOPPEL_PAD = inData('stagebot', 'teams.json');
const TIMEOUT_MS = 15_000;

/**
 * Alleen Microsoft-hosts.
 *
 * De URL komt uit een formulier en de server post er naartoe. Zonder deze
 * beperking zou een verkeerd geplakte of kwaadwillende URL de server naar
 * willekeurige adressen laten posten. Power Automate gebruikt
 * `*.logic.azure.com` en `*.powerplatform.com`.
 */
const TOEGESTANE_HOSTS = [
  'logic.azure.com',
  'powerplatform.com',
  'webhook.office.com',
  'outlook.office.com',
];

export function isTeamsUrl(url) {
  try {
    const parsed = new URL(url);
    const extra = (process.env.TEAMS_EXTRA_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean)
      .some((host) => parsed.hostname === host);

    // Eigen hosts (test, eigen gateway) mogen ook zonder TLS — dat is de
    // keuze van de beheerder, niet van de bezoeker.
    if (extra) return parsed.protocol === 'https:' || parsed.protocol === 'http:';

    if (parsed.protocol !== 'https:') return false;
    return TOEGESTANE_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

/* ─────────────────────────────── opslag ───────────────────────────────── */

export function bewaarTeamsWebhook(url, { meldingen = true } = {}) {
  const schoon = String(url ?? '').trim();
  if (!isTeamsUrl(schoon)) {
    throw new Error(
      'Dat is geen Teams-webhook-URL. Hij moet met https:// beginnen en van Microsoft zijn (*.logic.azure.com of *.powerplatform.com).',
    );
  }

  mkdirSync(path.dirname(KOPPEL_PAD), { recursive: true });
  writeFileSync(
    KOPPEL_PAD,
    JSON.stringify({ versie: 1, url: schoon, meldingen, gekoppeld: new Date().toISOString() }, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  );
  try {
    chmodSync(KOPPEL_PAD, 0o600);
  } catch {
    /* niet elk bestandssysteem doet dit */
  }
  return { gekoppeld: true, meldingen };
}

export function verwijderTeamsWebhook() {
  if (existsSync(KOPPEL_PAD)) rmSync(KOPPEL_PAD);
}

/**
 * De webhook: eerst de omgeving, dan het koppelbestand, dan .env.
 */
export function vindTeamsWebhook() {
  if (process.env.TEAMS_WEBHOOK_URL) {
    return { url: process.env.TEAMS_WEBHOOK_URL.trim(), meldingen: true, bron: 'omgeving' };
  }

  if (existsSync(KOPPEL_PAD)) {
    try {
      const data = JSON.parse(readFileSync(KOPPEL_PAD, 'utf8'));
      if (data.url) {
        return {
          url: data.url,
          meldingen: data.meldingen !== false,
          bron: 'het scherm',
          alleenLeesbaarVoorJou: (statSync(KOPPEL_PAD).mode & 0o077) === 0,
        };
      }
    } catch {
      /* stuk bestand */
    }
  }

  for (const pad of [vindEnv(), inProject('.env')].filter(Boolean)) {
    if (!existsSync(pad)) continue;
    let tekst;
    try {
      tekst = readFileSync(pad, 'utf8');
    } catch {
      continue;
    }
    for (const regel of tekst.split('\n')) {
      const match = /^\s*TEAMS_WEBHOOK_URL\s*=\s*(.*)\s*$/.exec(regel);
      if (match && match[1].trim()) {
        return { url: match[1].trim().replace(/^["']|["']$/g, ''), meldingen: true, bron: pad };
      }
    }
  }

  return null;
}

export function teamsBeschikbaar() {
  return vindTeamsWebhook() !== null;
}

/* ─────────────────────────────── de kaart ─────────────────────────────── */

/**
 * De kaart die in Teams verschijnt.
 *
 * We sturen drie dingen in één lichaam:
 *   - Title en Message, voor de standaardflow "Post to a channel when a
 *     webhook request is received" (die leest die twee velden)
 *   - de Adaptive Card, voor een flow die de hele aanvraag als kaart post
 *
 * Extra velden negeert een flow; zo werkt dezelfde knop met beide manieren van
 * inrichten, en hoef jij niet te weten welke je hebt gekozen.
 */
export function maakTeamsBericht({ titel, tekst, feiten = [], link } = {}) {
  const body = [
    { type: 'TextBlock', text: titel ?? 'Stagebot', weight: 'Bolder', size: 'Medium', wrap: true },
  ];

  if (tekst) body.push({ type: 'TextBlock', text: tekst, wrap: true, spacing: 'Small' });

  if (feiten.length) {
    body.push({
      type: 'FactSet',
      spacing: 'Small',
      facts: feiten.map(([naam, waarde]) => ({ title: naam, value: String(waarde) })),
    });
  }

  if (link) {
    body.push({
      type: 'ActionSet',
      spacing: 'Small',
      actions: [{ type: 'Action.OpenUrl', title: 'Openen', url: link }],
    });
  }

  return {
    Title: titel ?? 'Stagebot',
    Message: tekst ?? '',
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
        },
      },
    ],
  };
}

/**
 * Post de kaart.
 *
 * @returns {Promise<{ok: true, status: number}>}
 */
export async function verstuurTeams(kaart, { url, timeoutMs = TIMEOUT_MS } = {}) {
  const webhook = url ? { url } : vindTeamsWebhook();
  if (!webhook?.url) throw new Error('Teams is nog niet gekoppeld.');
  if (!isTeamsUrl(webhook.url)) throw new Error('De bewaarde Teams-URL is geen Microsoft-adres.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const antwoord = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kaart),
      signal: controller.signal,
    });

    if (!antwoord.ok) {
      const tekst = (await antwoord.text().catch(() => '')).slice(0, 200);
      throw new Error(`Teams gaf HTTP ${antwoord.status}${tekst ? `: ${tekst}` : ''}`);
    }

    return { ok: true, status: antwoord.status };
  } catch (fout) {
    if (fout.name === 'AbortError') throw new Error('Teams antwoordde niet op tijd.');
    throw fout;
  } finally {
    clearTimeout(timer);
  }
}

/** De kaart als platte tekst, voor als de melding via de mail gaat. */
export function platteTekst(kaart) {
  const regels = [kaart?.Message ?? ''];
  const feiten = kaart?.attachments?.[0]?.content?.body?.find((blok) => blok.type === 'FactSet');
  for (const feit of feiten?.facts ?? []) regels.push(`${feit.title}: ${feit.value}`);
  return regels.filter(Boolean).join('\n');
}

/**
 * Een melding, maar nooit zo belangrijk dat hij iets anders mag breken.
 *
 * Als Teams eruit ligt, mag een mail nog steeds verstuurd worden. We loggen de
 * fout en gaan door — de mail is het werk, de melding is het gemak.
 */
export async function meldTeams(kaart) {
  try {
    if (!teamsBeschikbaar()) return { ok: false, reden: 'niet gekoppeld' };
    const webhook = vindTeamsWebhook();
    if (!webhook?.meldingen) return { ok: false, reden: 'meldingen staan uit' };
    return await verstuurTeams(kaart);
  } catch (fout) {
    console.warn(`  Teams-melding mislukte: ${fout.message}`);
    return { ok: false, reden: fout.message };
  }
}


/**
 * Een melding via het kanaal dat wél werkt.
 *
 * Teams eerst. Is dat niet gekoppeld, dan gaat dezelfde melding als mail naar
 * jezelf — je hebt Gmail immers al gekoppeld. Zo krijg je vanaf de eerste
 * verstuurde mail bericht, ook voordat de Teams-flow er is.
 */
export async function meldKanaal(kaart) {
  if (teamsBeschikbaar()) {
    const uitkomst = await meldTeams(kaart);
    if (uitkomst.ok) return { kanaal: 'teams', ok: true };
  }

  /*
   * ntfy: push naar je telefoon, geen account en geen toestemming van wie dan
   * ook. Staat vóór de mail, want een melding die je meteen ziet is meer waard
   * dan een mail tussen de rest.
   */
  try {
    const { ntfyBeschikbaar, verstuurPush } = await import('./ntfy.mjs');
    if (ntfyBeschikbaar()) {
      await verstuurPush({ titel: kaart?.Title, tekst: platteTekst(kaart) });
      return { kanaal: 'ntfy', ok: true };
    }
  } catch (fout) {
    console.warn(`  ntfy-melding mislukte: ${fout.message}`);
  }

  try {
    const { gmailBeschikbaar, verstuurMail } = await import('./gmail.mjs');
    if (!gmailBeschikbaar()) return { kanaal: 'geen', ok: false };

    const { leesProfiel } = await import('./profiel.mjs');
    const profiel = leesProfiel();
    if (!profiel.email) return { kanaal: 'geen', ok: false };

    await verstuurMail({
      van: profiel.email,
      vanNaam: 'Stagebot',
      aan: profiel.email,
      onderwerp: kaart?.Title ?? 'Stagebot',
      tekst: platteTekst(kaart),
    });
    return { kanaal: 'mail', ok: true };
  } catch (fout) {
    console.warn(`  Melding mislukte ook via de mail: ${fout.message}`);
    return { kanaal: 'mail', ok: false };
  }
}
