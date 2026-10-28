/**
 * De laatste stap: de mail de deur uit.
 *
 * Hier zit de enige plek in het project die iets onomkeerbaars doet. Daarom
 * zijn de regels streng en expliciet:
 *
 *   - alleen een bedrijf met een geschreven mail kan verstuurd worden
 *   - alleen als de status concept of goedgekeurd is (niet als hij al weg is)
 *   - er moet een e-mailadres zijn dat de moeite lijkt
 *
 * En de status gaat pas op "verstuurd" als de mailserver hem echt heeft
 * aangenomen. Niet bij het starten van het verzoek — dan staat er een vinkje
 * bij een mail die nooit aankwam.
 */

import { zoekBedrijf, werkBij, leesBedrijven } from './bedrijven.mjs';
import { leesProfiel } from './profiel.mjs';
import { verstuurMail, gmailBeschikbaar } from './gmail.mjs';
import { meldTeams, maakTeamsBericht } from './teams.mjs';

/** Adressen die je nooit wilt gebruiken. */
const ONGELDIG = /^(noreply|no-reply|postmaster|abuse|webmaster)@/i;

/**
 * Welk adres?
 *
 * Het eerste bruikbare adres. Bij meerdere (info@ en een tweede) kiezen we het
 * eerste: dat is meestal het algemene adres, en daar komt een stagevraag aan.
 */
export function kiesAdres(bedrijf) {
  const adressen = (bedrijf.emails ?? []).filter(
    (adres) => typeof adres === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adres) && !ONGELDIG.test(adres),
  );
  return adressen[0] ?? null;
}

/**
 * Verstuurt de mail van één bedrijf.
 *
 * @param {string} id
 * @param {{droog?: boolean}} [opties]  droog = alles doen behalve echt versturen
 */
export async function verstuurBedrijf(id, { droog = false, stil = false } = {}) {
  const bedrijf = zoekBedrijf(id);
  if (!bedrijf) throw new Error(`Onbekend bedrijf: ${id}`);
  if (!bedrijf.mail?.volledig) throw new Error(`${bedrijf.titel}: er is nog geen mail geschreven`);
  if (bedrijf.status === 'verstuurd') throw new Error(`${bedrijf.titel}: deze mail is al verstuurd`);
  if (!['concept', 'goedgekeurd'].includes(bedrijf.status)) {
    throw new Error(`${bedrijf.titel}: status is "${bedrijf.status}" — keur de mail eerst goed`);
  }

  const naar = kiesAdres(bedrijf);
  if (!naar) throw new Error(`${bedrijf.titel}: geen bruikbaar e-mailadres gevonden`);

  const profiel = leesProfiel();
  const van = profiel.email || process.env.GMAIL_USER;

  if (!droog && !gmailBeschikbaar()) {
    throw new Error('Gmail is nog niet gekoppeld. Zet GMAIL_USER en GMAIL_APP_PASSWORD in .env.');
  }

  const resultaat = droog
    ? { ok: true, naar, messageId: null }
    : await verstuurMail({
        van,
        vanNaam: profiel.naam,
        aan: naar,
        onderwerp: bedrijf.mail.onderwerp,
        tekst: bedrijf.mail.volledig,
      });

  const opgeslagen = werkBij(bedrijf.id, (b) => {
    b.status = 'verstuurd';
    b.verstuurd = [...(b.verstuurd ?? []), new Date().toISOString()];
    b.verzending = {
      op: new Date().toISOString(),
      naar,
      messageId: resultaat.messageId ?? null,
      droog,
    };
  });

  /*
   * Een melding in Teams. Best effort: ligt Teams eruit, dan is de mail nog
   * steeds verstuurd en mag er niets stukgaan.
   */
  if (!droog && !stil) {
    await meldTeams(
      maakTeamsBericht({
        titel: `Mail verstuurd: ${bedrijf.titel}`,
        tekst: bedrijf.mail.onderwerp,
        feiten: [
          ['Naar', naar],
          ['Bedrijf', bedrijf.titel],
        ],
      }),
    );
  }

  return { bedrijf: opgeslagen, naar, messageId: resultaat.messageId ?? null, droog };
}

/**
 * Alles wat klaarstaat in één keer versturen.
 *
 * Dit is de "automatische" knop: hij pakt alleen mails met status goedgekeurd,
 * dus wat er tussen zit dat je nog niet hebt nagekeken blijft liggen.
 */
export async function verstuurGoedgekeurd({ limiet = 20, droog = false } = {}) {
  const klaar = [];
  const mislukt = [];

  // Eén voor één, met een korte pauze: Gmail ziet liever geen twintig
  // verbindingen tegelijk vanaf hetzelfde account.
  for (const bedrijf of wachtOpGoedkeuring(limiet)) {
    try {
      const uitkomst = await verstuurBedrijf(bedrijf.id, { droog, stil: true });
      klaar.push(uitkomst);
    } catch (fout) {
      mislukt.push({ bedrijf: bedrijf.titel, fout: fout.message });
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  // Eén samenvatting in plaats van twintig losse meldingen.
  if (klaar.length && !droog) {
    await meldTeams(
      maakTeamsBericht({
        titel: `${klaar.length} mail${klaar.length === 1 ? '' : 's'} verstuurd`,
        tekst: mislukt.length ? `${mislukt.length} mislukt — zie het scherm.` : 'Alles is de deur uit.',
        feiten: klaar.slice(0, 6).map((k) => [k.bedrijf.titel, k.naar]),
      }),
    );
  }

  return { klaar, mislukt };
}

function wachtOpGoedkeuring(limiet) {
  return leesBedrijven()
    .bedrijven.filter((b) => b.status === 'goedgekeurd')
    .slice(0, limiet);
}
