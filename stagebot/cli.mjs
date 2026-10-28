#!/usr/bin/env node
/**
 * De stagebot — van een website naar een mail die je kunt versturen.
 *
 *   node stagebot/cli.mjs scan cco.nl
 *   node stagebot/cli.mjs lijst
 *   node stagebot/cli.mjs mail cco
 *   node stagebot/cli.mjs toon cco
 *   node stagebot/cli.mjs profiel
 *   node stagebot/cli.mjs ai
 */

import { scanBedrijf, scanVanTekst } from './lib/scan.mjs';
import { voegToe, zoekBedrijf, leesBedrijven, telPerStatus, werkBij, STATUS, wachtrij, dagTelling, vandaag, DAG_LIMIET } from './lib/bedrijven.mjs';
import { schrijfMail, keurMail } from './lib/mail.mjs';
import { leesProfiel, bewaarProfiel, profielAlsTekst, verrijkVanuitCanvas } from './lib/profiel.mjs';
import { aiBeschikbaar, vindSleutel } from './lib/deepseek.mjs';
import { zoekBedrijven, voegKandidatenToe, seedKandidaten, voegUrlToe } from './lib/zoeken.mjs';
import { leesEnSchrijf } from './lib/pijplijn.mjs';
import { herberekenVoorBedrijf } from './lib/reistijd.mjs';
import { isGeimporteerd } from '../ov/lib/planner.mjs';
import { verstuurBedrijf, verstuurGoedgekeurd, kiesAdres } from './lib/versturen.mjs';
import { vindGmailSleutels } from './lib/gmail.mjs';
import { vindTeamsWebhook, bewaarTeamsWebhook, verstuurTeams, maakTeamsBericht } from './lib/teams.mjs';
import { readFileSync } from 'node:fs';

const [, , commando, ...rest] = process.argv;

const lijn = (n = 70) => '─'.repeat(n);
const dik = (n = 70) => '━'.repeat(n);

function gebruik() {
  console.log(`
  De stagebot

    node stagebot/cli.mjs zoek            bedrijven zoeken in de regio (OSM + je eigen lijst)
    node stagebot/cli.mjs dag             twintig kandidaten lezen en mail schrijven
    node stagebot/cli.mjs status          wat staat er in de wachtrij, en hoe ver is vandaag
    node stagebot/cli.mjs ov <id>         reistijd met de trein opnieuw opvragen
    node stagebot/cli.mjs ov --alles      reistijd voor alle bedrijven opnieuw
    node stagebot/cli.mjs gmail           is Gmail gekoppeld? (--test stuurt een proefmail)
    node stagebot/cli.mjs teams           is Teams gekoppeld? (--test, --zet <url>)
    node stagebot/cli.mjs verstuur <id>   de mail van dat bedrijf echt versturen
    node stagebot/cli.mjs verstuur --alles alles wat goedgekeurd is
    node stagebot/cli.mjs voeg <url>      zelf een bedrijf toevoegen
    node stagebot/cli.mjs scan <url>      een bedrijf lezen en bewaren
    node stagebot/cli.mjs scan <url> --tekst <bestand>
                                          zelf geplakte tekst inlezen, voor sites
                                          die bots tegenhouden
    node stagebot/cli.mjs lijst           wat je hebt
    node stagebot/cli.mjs mail <id>       een mail schrijven
    node stagebot/cli.mjs toon <id>       de mail bekijken
    node stagebot/cli.mjs profiel         jouw profiel bekijken
    node stagebot/cli.mjs canvas          je vakken uit Canvas in het profiel zetten
    node stagebot/cli.mjs ai              is er een taalmodel?

  Voorbeelden:
    node stagebot/cli.mjs scan cco.nl
    node stagebot/cli.mjs mail cco
`);
}

async function main() {
  switch (commando) {
    case 'zoek': {
      /*
       * Twee bronnen, in deze volgorde:
       *
       *   1. je eigen lijst (data/stagebot/seed-bedrijven.json) — werkt altijd
       *   2. OpenStreetMap — automatisch, maar de publieke API is vaak vol
       *
       * De tweede mag falen zonder de eerste ongedaan te maken: je wilt niet
       * met lege handen staan omdat een publieke dienst overbelast is.
       */
      const seed = seedKandidaten();
      const seedUitkomst = voegKandidatenToe(seed);
      console.log(`\n  eigen lijst: ${seed.length} bedrijven, ${seedUitkomst.nieuw.length} nieuw`);

      console.log('  OpenStreetMap bevragen (kan een minuut duren)…');
      let osm = [];
      try {
        osm = await zoekBedrijven();
        const { nieuw } = voegKandidatenToe(osm);
        console.log(`  OpenStreetMap: ${osm.length} kandidaten, ${nieuw.length} nieuw`);
      } catch (fout) {
        console.log(`  OpenStreetMap overgeslagen: ${fout.message}`);
      }

      const wacht = wachtrij({ limiet: 200 });
      console.log(`\n  ${wacht.length} bedrijven in de wachtrij:`);
      for (const b of wacht.slice(0, 25)) {
        const plek = [b.plaats, b.ov].filter(Boolean).join(' · ');
        console.log(`     ${String(b.id).padEnd(22)} ${String(b.titel).slice(0, 30).padEnd(30)} ${plek}`);
      }
      if (wacht.length > 25) console.log(`     … en ${wacht.length - 25} meer`);
      console.log('\n  Nu: node stagebot/cli.mjs dag\n');
      return 0;
    }

    case 'status': {
      const telling = dagTelling();
      const perStatus = telPerStatus();
      console.log(`\n  Vandaag (${telling.dag}): ${telling.gedaan}/${telling.limiet} gedaan, ${telling.over} te gaan`);
      console.log(`  ${lijn()}`);
      for (const [status, aantal] of Object.entries(perStatus.perStatus)) {
        console.log(`  ${String(aantal).padStart(3)}  ${STATUS[status] ?? status}`);
      }
      console.log(`  ${lijn()}`);
      console.log(`  wachtrij: ${wachtrij({ limiet: 500 }).length} bedrijven om te lezen`);
      console.log('');
      return 0;
    }

    case 'voeg': {
      const url = rest[0];
      if (!url) {
        console.log('  welke site? bijvoorbeeld: node stagebot/cli.mjs voeg daemen-ict.nl');
        return 1;
      }
      const bedrijf = voegUrlToe(url);
      console.log(`\n  toegevoegd: ${bedrijf.titel} (${bedrijf.domein})\n`);
      return 0;
    }

    case 'dag': {
      const limietIndex = rest.indexOf('--limiet');
      const limiet = limietIndex !== -1 ? Number(rest[limietIndex + 1]) || DAG_LIMIET : DAG_LIMIET;

      const telling = dagTelling();
      const teDoen = Math.min(limiet, telling.over);
      if (teDoen <= 0) {
        console.log(`\n  Vandaag staan er al ${telling.gedaan} klaar (limiet ${telling.limiet}).`);
        console.log('  Morgen weer. Zo blijft het tempo waar je adres tegen kan.\n');
        return 0;
      }

      console.log(`\n  ${telling.dag}: ${telling.gedaan} gedaan, ${teDoen} te gaan`);

      // Zonder aanvoer valt er niets te lezen. Eerst je eigen lijst, dan OSM.
      if (wachtrij({ limiet: 1 }).length === 0) {
        console.log('  geen wachtrij — eerst je eigen lijst en OpenStreetMap…');
        voegKandidatenToe(seedKandidaten());
        try {
          voegKandidatenToe(await zoekBedrijven());
        } catch (fout) {
          console.log(`  OpenStreetMap overgeslagen: ${fout.message}`);
        }
      }

      const kandidaten = wachtrij({ limiet: teDoen });
      if (!kandidaten.length) {
        console.log('\n  Geen kandidaten. Voeg er een toe met: node stagebot/cli.mjs voeg <url>\n');
        return 1;
      }

      let gelukt = 0;
      const mislukt = [];
      for (const kandidaat of kandidaten) {
        console.log(`\n  ${kandidaat.titel} (${kandidaat.domein})`);
        try {
          const { bedrijf, keuring } = await leesEnSchrijf(kandidaat.id);
          gelukt += 1;
          const oordeel = keuring.goed ? 'in orde' : `let op: ${keuring.punten.join('; ')}`;
          console.log(`     mail geschreven — ${keuring.woorden} woorden, ${oordeel}`);
          if (bedrijf.reistijd?.minuten != null) {
            console.log(
              `     met de trein: ${bedrijf.reistijd.minuten} min, ${bedrijf.reistijd.overstappen} overstap` +
                `${bedrijf.reistijd.overstappen === 1 ? '' : 'pen'}`,
            );
          }
        } catch (fout) {
          mislukt.push({ bedrijf: kandidaat.titel, fout: fout.message });
          console.log(`     overgeslagen: ${fout.message}`);
        }
      }

      console.log(`\n  ${lijn()}`);
      console.log(`  ${gelukt} klaargezet, ${mislukt.length} mislukt`);
      for (const m of mislukt) console.log(`     ${m.bedrijf}: ${m.fout}`);
      console.log(`  Nog ${dagTelling().over} van vandaag over. Open het dashboard om na te kijken.\n`);
      return gelukt ? 0 : 1;
    }

    case 'ov': {
      if (rest.includes('--alles')) {
        if (!isGeimporteerd()) {
          console.log('\n  Geen dienstregeling. Draai eerst: node ov/import.mjs\n');
          return 1;
        }
        const bedrijven = leesBedrijven().bedrijven.filter((b) => b.station?.naam);
        if (!bedrijven.length) {
          console.log('\n  Nog geen bedrijven met een station. Scan eerst iets.\n');
          return 0;
        }
        console.log(`\n  Reistijd opvragen voor ${bedrijven.length} bedrijven…`);
        let gelukt = 0;
        for (const bedrijf of bedrijven) {
          try {
            const reistijd = await herberekenVoorBedrijf(bedrijf);
            if (!reistijd) {
              console.log(`     ${bedrijf.titel}: geen reis gevonden`);
              continue;
            }
            gelukt += 1;
            console.log(
              `     ${String(bedrijf.titel).slice(0, 26).padEnd(27)} ${reistijd.minuten} min, ${reistijd.overstappen} overstap${reistijd.overstappen === 1 ? '' : 'pen'}`,
            );
          } catch (fout) {
            console.log(`     ${bedrijf.titel}: ${fout.message}`);
          }
        }
        console.log(`\n  ${gelukt} van ${bedrijven.length} gelukt.\n`);
        return gelukt ? 0 : 1;
      }

      const id = rest[0];
      if (!id) {
        console.log('  welk bedrijf? bijvoorbeeld: node stagebot/cli.mjs ov daemen-ict');
        return 1;
      }
      if (!isGeimporteerd()) {
        console.log('\n  Geen dienstregeling. Draai eerst: node ov/import.mjs\n');
        return 1;
      }
      const bedrijf = zoekBedrijf(id);
      if (!bedrijf) {
        console.log(`  geen bedrijf gevonden voor "${id}"`);
        return 1;
      }
      if (!bedrijf.station?.naam) {
        console.log(`\n  Van ${bedrijf.titel} is geen station bekend. Scan het bedrijf eerst.\n`);
        return 1;
      }
      const reistijd = await herberekenVoorBedrijf(bedrijf);
      if (!reistijd) {
        console.log('\n  De NS gaf geen reis terug voor deze bestemming.\n');
        return 1;
      }
      console.log(
        `\n  ${bedrijf.titel}: ${reistijd.van} → ${reistijd.naar} — ${reistijd.minuten} min, ` +
          `${reistijd.overstappen} overstap${reistijd.overstappen === 1 ? '' : 'pen'}\n`,
      );
      return 0;
    }

    case 'teams': {
      const zetIndex = rest.indexOf('--zet');
      if (zetIndex !== -1) {
        const url = rest[zetIndex + 1];
        if (!url) {
          console.log('  welke url? bijvoorbeeld: node stagebot/cli.mjs teams --zet https://prod-...logic.azure.com/...');
          return 1;
        }
        try {
          await verstuurTeams(maakTeamsBericht({ titel: 'Stagebot is gekoppeld', tekst: 'Proefbericht.' }), { url });
          bewaarTeamsWebhook(url);
          console.log('\n  Gekoppeld. Er is een proefbericht naar Teams gestuurd.\n');
          return 0;
        } catch (fout) {
          console.log(`\n  Mislukt: ${fout.message}\n`);
          return 1;
        }
      }

      const webhook = vindTeamsWebhook();
      if (!webhook) {
        console.log('\n  Teams is nog niet gekoppeld.');
        console.log('  Maak een flow in Teams (Workflows → "When a Teams webhook request is received")');
        console.log('  en zet de URL hier neer:');
        console.log('    node stagebot/cli.mjs teams --zet <url>\n');
        return 1;
      }

      console.log(`\n  Teams: gekoppeld (${webhook.bron === 'omgeving' ? 'uit de omgeving' : 'uit het scherm of .env'})`);
      console.log(`  Meldingen: ${webhook.meldingen ? 'aan' : 'uit'}`);

      if (rest.includes('--test')) {
        await verstuurTeams(maakTeamsBericht({ titel: 'Proefbericht', tekst: 'Als je dit ziet, werkt de koppeling.' }));
        console.log('  Proefbericht verstuurd.\n');
        return 0;
      }

      console.log('  Probeer: node stagebot/cli.mjs teams --test\n');
      return 0;
    }

    case 'gmail': {
      const sleutels = vindGmailSleutels();
      if (!sleutels) {
        console.log('\n  Gmail is nog niet gekoppeld.');
        console.log('  Zet in .env:');
        console.log('    GMAIL_USER=dylanschuurman04@gmail.com');
        console.log('    GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx');
        console.log('  Een app-wachtwoord maak je op https://myaccount.google.com/apppasswords');
        console.log('  (tweestapsverificatie moet aan staan).\n');
        return 1;
      }

      console.log(`\n  Gmail: ${sleutels.gebruiker}`);
      console.log(`  Sleutel uit: ${sleutels.bron} (${sleutels.wachtwoord.length} tekens)`);
      if (!sleutels.alleenLeesbaarVoorJou) {
        console.log('  LET OP: dat bestand is leesbaar voor andere gebruikers op deze machine.');
      }

      if (rest.includes('--test')) {
        const { verstuurMail } = await import('./lib/gmail.mjs');
        console.log('  Proefmail naar jezelf sturen…');
        await verstuurMail({
          van: sleutels.gebruiker,
          vanNaam: 'Stagebot',
          aan: sleutels.gebruiker,
          onderwerp: 'Proef: de stagebot kan mailen',
          tekst: 'Deze mail is verstuurd door de stagebot om te controleren of de koppeling werkt.\n\nAls je dit leest, is het gelukt.',
        });
        console.log('  Verstuurd. Kijk in je inbox (en in spam, de eerste keer).\n');
        return 0;
      }

      console.log('\n  Probeer het met: node stagebot/cli.mjs gmail --test\n');
      return 0;
    }

    case 'verstuur': {
      const alles = rest.includes('--alles');

      if (alles) {
        if (!rest.includes('--ja')) {
          console.log('\n  Dit verstuurt alle mails met status "goedgekeurd".');
          console.log('  Zeker weten? Voeg --ja toe: node stagebot/cli.mjs verstuur --alles --ja\n');
          return 1;
        }
        const { klaar, mislukt } = await verstuurGoedgekeurd();
        console.log(`\n  ${klaar.length} verstuurd, ${mislukt.length} mislukt`);
        for (const k of klaar) console.log(`     ✓ ${k.naar}`);
        for (const m of mislukt) console.log(`     ✗ ${m.bedrijf}: ${m.fout}`);
        console.log('');
        return mislukt.length ? 1 : 0;
      }

      const id = rest[0];
      if (!id) {
        console.log('  welk bedrijf? bijvoorbeeld: node stagebot/cli.mjs verstuur daemen-ict');
        return 1;
      }

      const bedrijf = zoekBedrijf(id);
      if (!bedrijf) {
        console.log(`  geen bedrijf gevonden voor "${id}"`);
        return 1;
      }
      const adres = kiesAdres(bedrijf);
      console.log(`\n  Versturen naar ${adres ?? 'geen adres'} — ${bedrijf.titel}`);
      const { naar, messageId } = await verstuurBedrijf(bedrijf.id);
      console.log(`  Verstuurd naar ${naar}`);
      console.log(`  Message-ID: ${messageId}\n`);
      return 0;
    }

    case 'scan': {
      const url = rest[0];
      if (!url) {
        console.log('  welke site? bijvoorbeeld: node stagebot/cli.mjs scan cco.nl');
        return 1;
      }

      /*
       * Handmatige route: `scan cco.nl --tekst pagina.txt`.
       *
       * Nodig voor sites die bots tegenhouden. Jij opent de site, kopieert wat
       * er staat, en de bot doet dezelfde analyse zonder het ophalen.
       */
      const tekstIndex = rest.indexOf('--tekst');
      let scan;
      if (tekstIndex !== -1) {
        const bestand = rest[tekstIndex + 1];
        if (!bestand) {
          console.log('  welk bestand? bijvoorbeeld: scan cco.nl --tekst cco.txt');
          return 1;
        }
        const tekst = readFileSync(bestand, 'utf8');
        console.log(`\n  ${url} lezen uit ${bestand}…`);
        scan = scanVanTekst(url, tekst);
      } else {
        console.log(`\n  ${url} lezen…`);
        try {
          scan = await scanBedrijf(url);
        } catch (fout) {
          if (fout.blokkade) {
            console.log(`\n  Deze site houdt bots tegen (${fout.blokkade}).`);
            console.log('  Open hem zelf in je browser, kopieer de tekst naar een bestand,');
            console.log(`  en doe dan: node stagebot/cli.mjs scan ${url} --tekst jouwbestand.txt\n`);
            return 1;
          }
          throw fout;
        }
      }

      console.log(`  ${scan.paginas.length} pagina('s), ${scan.tekst.length} tekens`);
      if (scan.emails.length) console.log(`  e-mail: ${scan.emails.slice(0, 4).join(', ')}`);
      else console.log('  geen e-mailadres gevonden — je zult er zelf een moeten zoeken');
      if (scan.tech.length) console.log(`  techniek: ${scan.tech.slice(0, 10).join(', ')}`);
      if (scan.stageSignaal.length) console.log(`  stage-signaal: ${scan.stageSignaal.join(', ')}`);

      const { bedrijf, nieuw } = voegToe(scan);
      console.log(`\n  ${nieuw ? 'toegevoegd' : 'bijgewerkt'}: ${bedrijf.titel}  (id: ${bedrijf.id})`);
      console.log(`  ${bedrijf.tekst.slice(0, 220).replace(/\n/g, ' ')}…`);
      return 0;
    }

    case 'lijst': {
      const { totaal, perStatus } = telPerStatus();
      if (!totaal) {
        console.log('\n  Nog geen bedrijven. Begin met: node stagebot/cli.mjs scan <url>\n');
        return 0;
      }
      const data = leesBedrijven();
      console.log(`\n  ${totaal} bedrijven`);
      console.log(`  ${lijn()}`);
      for (const b of data.bedrijven) {
        const status = STATUS[b.status] ?? b.status;
        const mail = b.mail ? '✉' : ' ';
        const mailAdres = b.emails?.[0] ?? '—';
        console.log(`  ${mail} ${b.id.padEnd(22)} ${String(b.titel).slice(0, 28).padEnd(28)} ${status}`);
        console.log(`    ${mailAdres}`);
      }
      console.log(`  ${lijn()}`);
      const samenvatting = Object.entries(perStatus)
        .map(([s, n]) => `${n} ${s}`)
        .join(', ');
      console.log(`  ${samenvatting}\n`);
      return 0;
    }

    case 'mail': {
      const id = rest[0];
      if (!id) {
        console.log('  welk bedrijf? bijvoorbeeld: node stagebot/cli.mjs mail cco');
        return 1;
      }
      const bedrijf = zoekBedrijf(id);
      if (!bedrijf) {
        console.log(`  geen bedrijf gevonden voor "${id}". Gebruik: node stagebot/cli.mjs lijst`);
        return 1;
      }

      if (!aiBeschikbaar()) {
        console.log('\n  Geen taalmodel-sleutel gevonden, dus er kan geen mail geschreven worden.');
        console.log('  Zet DEEPSEEK_API_KEY in .env, of zorg dat ../KravaDoc/.env bestaat.\n');
        return 1;
      }

      console.log(`\n  Mail schrijven voor ${bedrijf.titel}…`);
      const mail = await schrijfMail(bedrijf);
      const keuring = keurMail(mail);

      werkBij(bedrijf.id, (b) => {
        b.mail = mail;
        if (b.status === 'gescand') b.status = 'concept';
      });

      console.log(`\n  ${dik()}`);
      console.log(`  AAN     : ${bedrijf.emails?.[0] ?? 'nog geen adres gevonden'}`);
      console.log(`  ONDERWERP: ${mail.onderwerp}`);
      console.log(`  ${dik()}\n`);
      for (const regel of mail.volledig.split('\n')) console.log(`  ${regel}`);
      console.log(`\n  ${lijn()}`);
      if (mail.waarom) console.log(`  Aanknopingspunt : ${mail.waarom}`);
      if (mail.vraag) console.log(`  De vraag        : ${mail.vraag}`);
      console.log(`  Lengte          : ${keuring.woorden} woorden`);
      if (keuring.goed) {
        console.log('  Controle        : in orde');
      } else {
        console.log('  Controle        : let op');
        for (const p of keuring.punten) console.log(`     - ${p}`);
      }
      console.log(`  ${lijn()}\n`);
      return 0;
    }

    case 'toon': {
      const bedrijf = zoekBedrijf(rest[0] ?? '');
      if (!bedrijf) {
        console.log('  niet gevonden');
        return 1;
      }
      if (!bedrijf.mail) {
        console.log(`\n  Nog geen mail voor ${bedrijf.titel}. Maak er een met: node stagebot/cli.mjs mail ${bedrijf.id}\n`);
        return 0;
      }
      console.log(`\n  ${bedrijf.mail.onderwerp}\n  ${lijn()}`);
      for (const regel of bedrijf.mail.volledig.split('\n')) console.log(`  ${regel}`);
      console.log(`  ${lijn()}\n`);
      return 0;
    }

    case 'profiel': {
      const profiel = leesProfiel();
      console.log(`\n  ${dik()}`);
      console.log('  JOUW PROFIEL');
      console.log(`  ${dik()}\n`);
      for (const regel of profielAlsTekst(profiel).split('\n')) console.log(`  ${regel}`);
      console.log(`\n  ${lijn()}`);
      console.log('  Pas aan in: data/stagebot/profiel.json');
      if (!profiel.email) console.log('  LET OP: je e-mailadres staat er nog niet in. Zet het erin,');
      if (!profiel.email) console.log('           anders staat er geen adres onder de mail.');
      if (!profiel.vaardigheden?.length) console.log('  LET OP: je vaardigheden zijn leeg. De mail wordt dan vaag.');
      if (!profiel.projecten?.length) console.log('  LET OP: je projecten zijn leeg. Dat is je sterkste argument.');
      console.log(`  ${lijn()}\n`);
      return 0;
    }

    case 'canvas': {
      // Het profiel aanvullen met wat er in Canvas staat.
      const { loadEnvFile, createCanvas } = await import('../mcp/lib/canvas.mjs');
      const { ENV_PAD, vindEnv } = await import('../mcp/lib/paden.mjs');

      const envPad = vindEnv();
      if (!envPad) {
        console.log('\n  Geen .env gevonden. Zet CANVAS_TOKEN in .env in de projectmap.\n');
        return 1;
      }

      const env = await loadEnvFile(envPad);
      if (!env?.CANVAS_TOKEN) {
        console.log(`\n  ${envPad} gevonden, maar er staat geen CANVAS_TOKEN in.`);
        console.log(`  Gevonden sleutels: ${Object.keys(env || {}).join(', ') || 'geen'}\n`);
        return 1;
      }

      console.log(`\n  Token gevonden in ${envPad} (${env.CANVAS_TOKEN.length} tekens)`);
      console.log(`  Server: ${env.CANVAS_BASE_URL || 'https://fhict.instructure.com'}`);

      const canvas = createCanvas({ baseUrl: env.CANVAS_BASE_URL, token: env.CANVAS_TOKEN });
      console.log('  Canvas lezen…');
      let profiel;
      try {
        profiel = await verrijkVanuitCanvas(canvas);
      } catch (fout) {
        console.log(`\n  Canvas weigerde het verzoek: ${fout.message}`);
        console.log('  Controleer of het token nog geldig is (Canvas → Account → Instellingen →');
        console.log('  Nieuwe toegangssleutel). Een token verloopt of kan ingetrokken zijn.\n');
        return 1;
      }

      const cursussen = profiel.canvas?.cursussen ?? [];
      console.log(`  ${cursussen.length} cursussen:`);
      for (const c of cursussen.slice(0, 12)) {
        console.log(`     ${String(c.code).padEnd(14)} ${c.naam}`);
      }
      console.log('\n  Je profiel is bijgewerkt met je vakken.\n');
      return 0;
    }

    case 'ai': {
      const { sleutel, bron } = vindSleutel();
      if (!sleutel) {
        console.log('\n  Geen taalmodel-sleutel gevonden.');
        console.log('  Zet DEEPSEEK_API_KEY in .env van dit project.\n');
        return 1;
      }
      console.log(`\n  Sleutel gevonden in: ${bron}`);
      console.log(`  Lengte: ${sleutel.length} tekens`);
      console.log('\n  De mailgenerator kan werken.\n');
      return 0;
    }

    default:
      gebruik();
      return commando ? 1 : 0;
  }
}

main().catch((fout) => {
  console.error(`\n  FOUT: ${fout.message}\n`);
  process.exitCode = 1;
});
