/**
 * Opvolgen.
 *
 * De meeste stageplekken komen niet uit de eerste mail maar uit de tweede. Nu
 * is het één mail en daarna stilte — deze module zorgt dat er na een week een
 * korte, vriendelijke herinnering klaarstaat.
 *
 * TWEE REGELS
 *
 * 1. **Maximaal twee keer.** Daarna is het opdringerig en verpest je adres.
 * 2. **Kort.** Een opvolging is geen tweede sollicitatie: drie zinnen, één
 *    vraag, en klaar. Wie de eerste mail niet las, leest een lange tweede
 *    zeker niet.
 */

import { leesBedrijven, werkBij, zoekBedrijf } from './bedrijven.mjs';
import { leesProfiel } from './profiel.mjs';
import { vraagJson } from './deepseek.mjs';
import { verstuurMail, gmailBeschikbaar } from './gmail.mjs';
import { kiesAdres } from './versturen.mjs';
import { meldKanaal, maakTeamsBericht } from './teams.mjs';

/** Na hoeveel dagen is een opvolging gepast? */
export const WACHTDAGEN = 6;

/** Meer dan dit wordt opdringerig. */
export const MAX_OPVOLGINGEN = 2;

const DAG = 86_400_000;

function dagenSinds(iso) {
  if (!iso) return null;
  const tijd = Date.parse(iso);
  if (!Number.isFinite(tijd)) return null;
  return Math.floor((Date.now() - tijd) / DAG);
}

/**
 * Wie moet er opgevolgd worden?
 *
 * Alleen bedrijven waar je iets naartoe stuurde en die niet terugmailden. Een
 * bedrijf waar je al in gesprek bent, of dat heeft afgezegd, hoort er niet in.
 */
export function opTeVolgen({ dagen = WACHTDAGEN, max = MAX_OPVOLGINGEN } = {}) {
  return leesBedrijven()
    .bedrijven.filter((bedrijf) => {
      if (bedrijf.status !== 'verstuurd') return false;
      if ((bedrijf.antwoorden ?? []).length) return false;

      const laatste = (bedrijf.opvolgingen ?? []).at(-1);
      if ((bedrijf.opvolgingen ?? []).length >= max) return false;

      const sinds = dagenSinds(laatste?.op ?? bedrijf.verzending?.op ?? bedrijf.verstuurd?.[0]);
      return sinds != null && sinds >= dagen;
    })
    .map((bedrijf) => ({
      id: bedrijf.id,
      titel: bedrijf.titel,
      naar: kiesAdres(bedrijf),
      dagenGeleden: dagenSinds(bedrijf.verzending?.op ?? bedrijf.verstuurd?.[0]),
      keer: (bedrijf.opvolgingen ?? []).length,
      onderwerp: bedrijf.mail?.onderwerp ?? null,
    }));
}

/**
 * Schrijft de opvolging.
 *
 * Geen nieuwe verkooppraat: verwijzen naar de vorige mail, één nieuwe vraag, en
 * de ruimte om nee te zeggen.
 */
export async function schrijfOpvolging(bedrijf) {
  const profiel = leesProfiel();
  const vorige = bedrijf.mail?.volledig ?? '';
  const dagen = dagenSinds(bedrijf.verzending?.op) ?? WACHTDAGEN;

  const uit = await vraagJson({
    systeem: `Je schrijft een korte opvolging op een eerdere stage-mail, in het Nederlands.
Harde regels:
- Maximaal 70 woorden.
- Verwijs in één zin naar de mail van ${dagen} dagen geleden. Herhaal de inhoud niet.
- Stel één nieuwe, makkelijk te beantwoorden vraag: past het niet, of is het te vroeg?
- Geen verwijten, geen "ik heb nog niets gehoord".
- Sluit af met één korte regel waarin een nee prima is.`,
    vraag: `EERDERE MAIL
${vorige.slice(0, 2000)}

STUDENT
${profiel.naam}, ${profiel.opleiding} aan ${profiel.instelling}.

BEDRIJF
${bedrijf.titel} — ${bedrijf.url}

Schrijf de opvolging. Geef als JSON:
{
  "onderwerp": "kort onderwerp, max 60 tekens (bijvoorbeeld 'Re: <oorspronkelijk onderwerp>')",
  "body": "de mail zelf, zonder aanhef en zonder handtekening"
}`,
    temperatuur: 0.5,
    maxTekens: 700,
  });

  const aanhef = 'Beste team van ' + (bedrijf.titel ?? bedrijf.domein) + ',';
  const handtekening = [profiel.naam, [profiel.opleiding, profiel.instelling].filter(Boolean).join(', '), profiel.email]
    .filter(Boolean)
    .join('\n');

  return {
    onderwerp: String(uit.onderwerp ?? `Re: ${bedrijf.mail?.onderwerp ?? 'stage'}`).trim(),
    volledig: `${aanhef}\n\n${String(uit.body ?? '').trim()}\n\nMet vriendelijke groet,\n\n${handtekening}`,
    op: new Date().toISOString(),
  };
}

/**
 * Maakt én verstuurt de opvolging.
 *
 * De status blijft "verstuurd" — er is nog niets terug. Wat er verandert is het
 * aantal opvolgingen, zodat we na twee keer stoppen.
 */
export async function verstuurOpvolging(id, { droog = false } = {}) {
  const bedrijf = zoekBedrijf(id);
  if (!bedrijf) throw new Error(`Onbekend bedrijf: ${id}`);

  const naar = kiesAdres(bedrijf);
  if (!naar) throw new Error(`${bedrijf.titel}: geen bruikbaar e-mailadres`);
  if (!droog && !gmailBeschikbaar()) throw new Error('Gmail is niet gekoppeld.');

  const opvolging = await schrijfOpvolging(bedrijf);

  if (!droog) {
    await verstuurMail({
      van: leesProfiel().email,
      vanNaam: leesProfiel().naam,
      aan: naar,
      onderwerp: opvolging.onderwerp,
      tekst: opvolging.volledig,
    });
  }

  const bijgewerkt = werkBij(bedrijf.id, (b) => {
    b.opvolgingen = [...(b.opvolgingen ?? []), { ...opvolging, naar, droog }];
  });

  if (!droog) {
    await meldKanaal(
      maakTeamsBericht({
        titel: `Opvolging verstuurd: ${bedrijf.titel}`,
        tekst: opvolging.onderwerp,
        feiten: [['Naar', naar], ['Keer', String((bijgewerkt?.opvolgingen ?? []).length)]],
      }),
    ).catch(() => null);
  }

  return { bedrijf: bijgewerkt, opvolging, naar };
}

/** Waar staat het? Voor de dagbriefing. */
export function telOpvolgingen(opties = {}) {
  const lijst = opTeVolgen(opties);
  return { aantal: lijst.length, lijst };
}
