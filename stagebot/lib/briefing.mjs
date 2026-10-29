/**
 * De dagbriefing.
 *
 * Eén blok dat 's ochtends vertelt wat er vandaag aandacht vraagt: wie je moet
 * opvolgen, wat er terugkwam, en hoe vol de dag zit. Bedoeld voor de push en
 * voor de commandoregel — niet voor het scherm, dat laat dezelfde cijfers al
 * zien.
 */

import { leesBedrijven, dagTelling } from './bedrijven.mjs';
import { opTeVolgen } from './opvolgen.mjs';
import { leesProfiel } from './profiel.mjs';

const vandaag = (iso) => {
  if (!iso) return false;
  const d = new Date(iso);
  const nu = new Date();
  return d.toDateString() === nu.toDateString();
};

export function dagbriefing() {
  const bedrijven = leesBedrijven().bedrijven;
  const telling = dagTelling();
  const profiel = leesProfiel();

  const opvolgen = opTeVolgen();
  const antwoordenVandaag = bedrijven.filter((b) => vandaag(b.laatsteAntwoord?.op));
  const gesprekken = bedrijven.filter((b) => b.status === 'gesprek');
  const verstuurdTotaal = bedrijven.filter((b) => ['verstuurd', 'geantwoord', 'gesprek', 'klaar'].includes(b.status));

  return {
    dag: telling.dag,
    klaargezet: telling.gedaan,
    limiet: telling.limiet,
    opvolgen: opvolgen.length,
    opvolgenLijst: opvolgen.slice(0, 8),
    antwoordenVandaag: antwoordenVandaag.length,
    gesprekken: gesprekken.length,
    verstuurd: verstuurdTotaal.length,
    verhouding: verstuurdTotaal.length
      ? Math.round((bedrijven.filter((b) => ['geantwoord', 'gesprek', 'klaar'].includes(b.status)).length / verstuurdTotaal.length) * 100)
      : 0,
    naam: profiel.naam,
  };
}

export function briefingTekst(briefing = dagbriefing()) {
  const regels = [`${briefing.naam?.split(' ')[0] ?? 'Dag'}, dit staat er vandaag:`];

  regels.push(`• ${briefing.klaargezet}/${briefing.limiet} mails klaargezet`);
  if (briefing.opvolgen) {
    regels.push(`• ${briefing.opvolgen} op te volgen: ${briefing.opvolgenLijst.map((o) => o.titel).slice(0, 4).join(', ')}`);
  }
  if (briefing.antwoordenVandaag) regels.push(`• ${briefing.antwoordenVandaag} nieuw antwoord vandaag`);
  if (briefing.gesprekken) regels.push(`• ${briefing.gesprekken} in gesprek`);
  if (briefing.verstuurd) {
    regels.push(`• ${briefing.verstuurd} verstuurd, ${briefing.verhouding}% reactie`);
  }

  if (regels.length === 1) regels.push('• Niets dat aandacht vraagt.');
  return regels.join('\n');
}
