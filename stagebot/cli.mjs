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
import { voegToe, zoekBedrijf, leesBedrijven, telPerStatus, werkBij, STATUS } from './lib/bedrijven.mjs';
import { schrijfMail, keurMail } from './lib/mail.mjs';
import { leesProfiel, bewaarProfiel, profielAlsTekst, verrijkVanuitCanvas } from './lib/profiel.mjs';
import { aiBeschikbaar, vindSleutel } from './lib/deepseek.mjs';
import { readFileSync } from 'node:fs';

const [, , commando, ...rest] = process.argv;

const lijn = (n = 70) => '─'.repeat(n);
const dik = (n = 70) => '━'.repeat(n);

function gebruik() {
  console.log(`
  De stagebot

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
