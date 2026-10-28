/**
 * Wat er terugkomt.
 *
 * Je stuurt twintig mails; er komen er een paar terug. Tot nu toe moest je dat
 * zelf in je inbox zien en de status met de hand omzetten. Dit leest de inbox
 * en doet dat voor je — maar alleen voor bedrijven die je al hebt benaderd, en
 * alleen om te tonen wat er staat.
 *
 * WAT HET WEL DOET
 *
 *   - de INBOX van je eigen Gmail lezen (met het app-wachtwoord dat er al is)
 *   - berichten koppelen aan een bedrijf op basis van het afzenderadres
 *   - herkennen of het een afwijzing, een vraag of een automatisch antwoord is
 *   - dat bij het bedrijf bewaren en de status bijwerken
 *   - één melding sturen als er iets nieuws binnen is
 *
 * WAT HET NIET DOET
 *
 * Geen mail beantwoorden, niets verwijderen, niets als gelezen markeren
 * (BODY.PEEK). En het bewaart niet je hele inbox: alleen de afzender, het
 * onderwerp en de eerste regels van berichten van bedrijven die je zelf hebt
 * aangeschreven.
 */

import { haalBerichten } from './imap.mjs';
import { leesBedrijven, werkBij } from './bedrijven.mjs';
import { vindGmailSleutels } from './gmail.mjs';
import { meldKanaal, maakTeamsBericht } from './teams.mjs';

/** Woorden die op een afwijzing wijzen. */
const AFWIJZING =
  /(geen (interesse|stageplek|stageplaats|ruimte|mogelijkheden)|helaas|niet in de gelegenheid|afwijz|we hebben (al|geen)|vacature is vervuld|niet mogelijk|moeten je teleurstellen|besloten (om )?niet)/i;

/** Automatische antwoorden. */
const AUTOMATISCH =
  /(automatisch(e)? antwoord|automatic reply|out of office|afwezig|niet aanwezig|vakantie|auto-?reply|noreply|no-reply)/i;

/**
 * Berichten die géén antwoord zijn.
 *
 * Een helpdesk stuurt je een welkomstmail zodra je een bedrijf leert kennen;
 * dat is geen reactie op je stagevraag. Zulke ruis mag de status niet
 * veranderen, anders staat er "geantwoord" bij een bedrijf dat nog niets zei.
 */
const RUIS =
  /(nieuwsbrief|newsletter|welkomstbericht|welkom bij|bevestig (je|uw)|verificatie|verification|actie vereist|ticket|no-?reply|uitschrijven|unsubscribe|je account)/i;

/** Woorden die met stage te maken hebben. */
const STAGE =
  /(stage|stageplek|stageplaats|stageopdracht|afstudeer|internship|sollicitatie|meewerken|kennismaken)/i;

/**
 * Wat voor bericht is dit?
 *
 * De volgorde is belangrijk: een automatisch antwoord kan toevallig "geen
 * ruimte" bevatten, en dat is geen afwijzing van een mens.
 */
export function soortVanBericht({ van, vanNaam, onderwerp, tekst }) {
  const alles = `${van ?? ''} ${vanNaam ?? ''} ${onderwerp ?? ''} ${tekst ?? ''}`;

  if (AUTOMATISCH.test(`${van ?? ''} ${onderwerp ?? ''}`)) return 'automatisch';
  if (AFWIJZING.test(alles)) return 'afwijzing';
  if (STAGE.test(alles)) return 'stage';
  return 'antwoord';
}

/** De eerste bruikbare regel uit een mailtekst, als samenvatting. */
export function samenvattingVan(tekst, { lengte = 220 } = {}) {
  const schoon = String(tekst ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((regel) => regel.trim())
    .filter((regel) => regel && !/^(>|--|__|verzonden|sent from|van:|from:)/i.test(regel))
    // Aangehaalde tekst van je eigen mail eruit.
    .filter((regel) => !/^op .* schreef/i.test(regel));

  const eerste = schoon.slice(0, 3).join(' ');
  return eerste.length > lengte ? `${eerste.slice(0, lengte - 1)}…` : eerste;
}

/**
 * Koppelt een bericht aan een bedrijf.
 *
 * Op afzenderadres: het domein van de afzender moet bij een bedrijf horen, of
 * het adres moet in de lijst met gevonden e-mailadressen staan.
 */
export function koppelBedrijf(bericht, bedrijven) {
  const afzender = String(bericht.van ?? '').toLowerCase();
  if (!afzender) return null;

  const domein = afzender.split('@')[1] ?? '';

  const direct = bedrijven.find((b) =>
    (b.emails ?? []).some((adres) => String(adres).toLowerCase() === afzender),
  );
  if (direct) return direct;

  return (
    bedrijven.find((b) => b.domein && (domein === b.domein || domein.endsWith(`.${b.domein}`))) ?? null
  );
}

/**
 * Haalt antwoorden op en verwerkt ze.
 *
 * @param {{dagen?: number, limiet?: number, melden?: boolean}} opties
 */
export async function haalAntwoorden({ dagen = 30, limiet = 40, melden = true } = {}) {
  const sleutels = vindGmailSleutels();
  if (!sleutels) {
    throw new Error('Gmail is nog niet gekoppeld, dus er kan niets gelezen worden.');
  }

  const berichten = await haalBerichten({
    gebruiker: sleutels.gebruiker,
    wachtwoord: sleutels.wachtwoord,
    dagen,
    limiet,
  });

  const bedrijven = leesBedrijven().bedrijven;
  const nieuw = [];

  for (const bericht of berichten) {
    const bedrijf = koppelBedrijf(bericht, bedrijven);
    if (!bedrijf) continue;

    // Al eerder gezien?
    if ((bedrijf.antwoorden ?? []).some((a) => a.uid === bericht.uid)) continue;

    // Ruis overslaan: welkomstmails, nieuwsbrieven, tickets.
    if (RUIS.test(`${bericht.van ?? ''} ${bericht.onderwerp ?? ''}`)) continue;

    /*
     * Een antwoord komt ná je mail. Ligt het bericht vóór het moment dat je
     * verstuurde, dan is het iets anders — een oude factuur, een uitnodiging
     * van vorige maand.
     */
    if (bedrijf.verzending?.op && bericht.datum) {
      const ontvangen = Date.parse(bericht.datum);
      if (Number.isFinite(ontvangen) && ontvangen < Date.parse(bedrijf.verzending.op) - 86_400_000) continue;
    }

    const soort = soortVanBericht(bericht);
    const antwoord = {
      uid: bericht.uid,
      op: new Date().toISOString(),
      datum: bericht.datum ?? null,
      van: bericht.van,
      onderwerp: bericht.onderwerp,
      samenvatting: samenvattingVan(bericht.tekst),
      soort,
    };

    werkBij(bedrijf.id, (b) => {
      b.antwoorden = [...(b.antwoorden ?? []), antwoord].slice(-10);
      b.laatsteAntwoord = antwoord;

      /*
       * Alleen omhoog bijwerken. Een gesprek of een gevonden stage zet je niet
       * terug naar "geantwoord" omdat er nog een mail binnenkomt.
       */
      if (['verstuurd', 'geantwoord'].includes(b.status)) {
        b.status = soort === 'afwijzing' ? 'afgewezen' : 'geantwoord';
      }
    });

    nieuw.push({ bedrijf: bedrijf.titel, ...antwoord });
  }

  if (nieuw.length && melden) {
    await meldKanaal(
      maakTeamsBericht({
        titel: `${nieuw.length} nieuw antwoord${nieuw.length === 1 ? '' : 'en'}`,
        tekst: nieuw
          .slice(0, 3)
          .map((n) => `${n.bedrijf}: ${n.onderwerp}`)
          .join('\n'),
        feiten: [['Bedrijven', nieuw.map((n) => n.bedrijf).join(', ')]],
      }),
    );
  }

  return { gelezen: berichten.length, nieuw };
}
