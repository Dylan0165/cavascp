/**
 * De pijplijn: van een gevonden bedrijf naar een nagekeken mail.
 *
 * Dit is het enige stuk dat zowel de commandoregel als het dashboard gebruiken.
 * Twee keer dezelfde stappen opschrijven zou betekenen dat ze uit elkaar lopen —
 * en dan schrijft het dashboard een andere mail dan de CLI.
 */

import { scanBedrijf } from './scan.mjs';
import { voegToe, werkBij, zoekBedrijf, vandaag } from './bedrijven.mjs';
import { geocodeBedrijf } from './geo.mjs';
import { laadStations, beoordeelLocatie, vindPlaats } from './regio.mjs';
import { berekenReistijd } from './reistijd.mjs';
import { schrijfMail, keurMail } from './mail.mjs';
import { leesProfiel } from './profiel.mjs';

/**
 * Leest de site en schrijft de mail.
 *
 * Bij een fout blijft het bedrijf staan zoals het stond, met de fout in de
 * notities. Niet stil doorslikken: dan denk je dat er twintig klaarstaan en
 * staat er niets.
 */
export async function leesEnSchrijf(bedrijfId, { dag = vandaag() } = {}) {
  const bestaand = zoekBedrijf(bedrijfId);
  if (!bestaand) throw new Error(`Onbekend bedrijf: ${bedrijfId}`);

  let scan;
  try {
    scan = await scanBedrijf(bestaand.url);
  } catch (fout) {
    werkBij(bestaand.id, (b) => {
      b.notities = [
        ...(b.notities ?? []),
        { op: new Date().toISOString(), tekst: `lezen mislukt: ${fout.message}` },
      ];
    });
    throw fout;
  }

  const { bedrijf } = voegToe(scan);

  /*
   * Waar ligt dit bedrijf?
   *
   * Een bedrijf uit OpenStreetMap heeft al coördinaten; een bedrijf dat je zelf
   * toevoegde niet. Zonder coördinaten is de OV-kolom leeg en kun je niet zien
   * of je er met de trein komt. Dus zoeken we het adres op — één keer, en het
   * antwoord blijft staan.
   */
  /*
   * Kent de lijst geen plaats, dan kijken we op de site zelf. Bijna elk
   * bedrijf noemt zijn vestiging ("Ons kantoor in Breda"), en zonder plaats
   * kunnen we niet zoeken — "Informa" levert de uitgever in Amsterdam op.
   */
  if (!bedrijf.plaats) {
    const gevondenPlaats = vindPlaats(scan.tekst);
    if (gevondenPlaats) {
      werkBij(bedrijf.id, (b) => {
        b.plaats = gevondenPlaats;
        b.plaatsBron = 'site';
      });
      bedrijf.plaats = gevondenPlaats;
    }
  }

  // Alleen met een plaatsnaam: "Informa" zonder "Roosendaal" levert de uitgever
  // in Amsterdam op, en dan staat er een verkeerde afstand in je lijst.
  if ((bedrijf.lat == null || bedrijf.lon == null) && bedrijf.plaats) {
    const gevonden = await geocodeBedrijf({ naam: bedrijf.titel, plaats: bedrijf.plaats });
    if (gevonden) {
      const stations = await laadStations().catch(() => []);
      const locatie = beoordeelLocatie(gevonden, stations);
      werkBij(bedrijf.id, (b) => {
        b.lat = gevonden.lat;
        b.lon = gevonden.lon;
        b.plaats = b.plaats ?? gevonden.naam;
        b.locatieBron = 'gecodeerd';
        b.station = locatie.station;
        b.vanHuisKm = locatie.vanHuisKm;
        b.ov = locatie.ov;
      });
    }
  }

  /*
   * De reistijd met de trein. Lukt dat niet (geen NS-sleutel, geen station),
   * dan blijft het leeg — de kilometer-aanduiding staat er dan nog wel.
   */
  await berekenReistijd(bedrijf).catch(() => null);

  const profiel = leesProfiel();
  const mail = await schrijfMail(bedrijf, { profiel });
  const keuring = keurMail(mail, profiel);

  const opgeslagen = werkBij(bedrijf.id, (b) => {
    b.mail = mail;
    b.status = 'concept';
    b.dag = dag;
    b.keuring = { goed: keuring.goed, punten: keuring.punten, woorden: keuring.woorden };
  });

  return { bedrijf: opgeslagen, mail, keuring };
}
