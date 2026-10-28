#!/usr/bin/env node
/**
 * De NS vanaf de commandoregel.
 *
 *   node mcp/ns/cli.mjs reis Roosendaal Breda
 *   node mcp/ns/cli.mjs reistijd Breda
 *   node mcp/ns/cli.mjs vertrek Breda --richting Roosendaal
 *   node mcp/ns/cli.mjs storingen
 *   node mcp/ns/cli.mjs stations breda
 *   node mcp/ns/cli.mjs status
 *
 * Zelfde onderliggende client als de MCP-server, zodat een reistijd in de chat
 * en een reistijd op de commandoregel nooit verschillen.
 */

import {
  reisadvies,
  snelsteReis,
  storingen,
  vertrekken,
  zoekStations,
  nsBeschikbaar,
  vindNsSleutel,
} from './lib/client.mjs';

const [, , commando, ...rest] = process.argv;

const tijd = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '—';

function gebruik() {
  console.log(`
  NS — reizen, storingen en vertrektijden

    node mcp/ns/cli.mjs reis <van> <naar> [--om 08:30] [--aankomst]
    node mcp/ns/cli.mjs reistijd <naar> [--van Roosendaal]
    node mcp/ns/cli.mjs vertrek <station> [--richting <deel>] [--aantal 8]
    node mcp/ns/cli.mjs storingen [--station <naam>]
    node mcp/ns/cli.mjs stations <zoekterm>
    node mcp/ns/cli.mjs status

  Voorbeeld:
    node mcp/ns/cli.mjs reistijd Breda
`);
}

/** "--om 08:30" → een Date van vandaag (of morgen als het al voorbij is). */
function datumVanVlag(waarde) {
  if (!waarde) return undefined;
  const [uur, minuut] = String(waarde).split(':').map(Number);
  if (!Number.isFinite(uur)) return undefined;
  const datum = new Date();
  datum.setHours(uur, minuut ?? 0, 0, 0);
  if (datum.getTime() < Date.now()) datum.setDate(datum.getDate() + 1);
  return datum;
}

function vlag(naam) {
  const index = rest.indexOf(naam);
  return index === -1 ? undefined : rest[index + 1];
}

async function main() {
  switch (commando) {
    case 'status': {
      const sleutel = vindNsSleutel();
      if (!sleutel) {
        console.log('\n  Geen NS-sleutel. Maak er een op https://apiportal.ns.nl');
        console.log('  (gratis product "Ns-App") en zet NS_SUBSCRIPTION_KEY in .env.\n');
        return 1;
      }
      console.log(`\n  Sleutel gevonden (${sleutel.bron})`);
      const reizen = await reisadvies({ van: 'Roosendaal', naar: 'Breda', aantal: 1 });
      console.log(`  Proefvraag Roosendaal → Breda: ${reizen[0]?.minuten ?? '?'} minuten\n`);
      return 0;
    }

    case 'reis': {
      const [van, naar] = rest.filter((r) => !r.startsWith('--'));
      if (!van || !naar) {
        console.log('  gebruik: reis Roosendaal Breda');
        return 1;
      }
      const om = datumVanVlag(vlag('--om'));
      const reizen = await reisadvies({ van, naar, vertrek: om, aantal: 4 });
      console.log(`\n  ${van} → ${naar}`);
      console.log(`  ${'─'.repeat(66)}`);
      for (const reis of reizen) {
        const bijzonder = [reis.geannuleerd ? 'vervalt' : null, reis.vertragingMinuten ? `+${reis.vertragingMinuten} min` : null]
          .filter(Boolean)
          .join(', ');
        console.log(
          `  ${String(reis.nummer).padStart(2)}. ${tijd(reis.vertrek)} → ${tijd(reis.aankomst)}  ` +
            `${String(reis.minuten).padStart(3)} min  ${reis.overstappen} overstap${reis.overstappen === 1 ? '' : 'pen'}` +
            `${bijzonder ? `  (${bijzonder})` : ''}`,
        );
        for (const stuk of reis.vol) {
          const trein = [stuk.soort, stuk.lijn].filter(Boolean).join(' ') || 'trein';
          console.log(
            `        ${trein}${stuk.richting ? ` richting ${stuk.richting}` : ''}: ` +
              `${stuk.van ?? '?'}${stuk.vertrekSpoor ? ` spoor ${stuk.vertrekSpoor}` : ''} → ${stuk.naar ?? '?'}`,
          );
        }
      }
      console.log('');
      return 0;
    }

    case 'reistijd': {
      const naar = rest.find((r) => !r.startsWith('--'));
      if (!naar) {
        console.log('  gebruik: reistijd Breda');
        return 1;
      }
      const van = vlag('--van') ?? 'Roosendaal';
      const snel = snelsteReis(await reisadvies({ van, naar, aantal: 3 }));
      if (!snel) {
        console.log(`\n  Geen reis gevonden van ${van} naar ${naar}.\n`);
        return 1;
      }
      console.log(
        `\n  ${van} → ${naar}: ${snel.minuten} minuten, ${snel.overstappen} overstap${snel.overstappen === 1 ? '' : 'pen'}` +
          `  (${tijd(snel.vertrek)} → ${tijd(snel.aankomst)})\n`,
      );
      return 0;
    }

    case 'vertrek': {
      const station = rest.find((r) => !r.startsWith('--'));
      if (!station) {
        console.log('  gebruik: vertrek Breda');
        return 1;
      }
      const lijst = await vertrekken({
        station,
        richting: vlag('--richting'),
        aantal: Number(vlag('--aantal') ?? 8),
      });
      console.log(`\n  Vertrekken vanaf ${station}`);
      console.log(`  ${'─'.repeat(66)}`);
      for (const trein of lijst) {
        const bijzonder = [trein.geannuleerd ? 'vervalt' : null, trein.vertragingMinuten ? `+${trein.vertragingMinuten}` : null]
          .filter(Boolean)
          .join(' ');
        console.log(
          `  ${tijd(trein.vertrek)}  ${String(trein.richting ?? '?').padEnd(28)} ${String(trein.soort ?? '').padEnd(4)} ` +
            `${trein.spoor != null ? `spoor ${trein.spoor}` : ''} ${bijzonder}`.trimEnd(),
        );
      }
      console.log('');
      return 0;
    }

    case 'storingen': {
      const lijst = await storingen({ station: vlag('--station') });
      if (!lijst.length) {
        console.log('\n  Geen actieve storingen.\n');
        return 0;
      }
      console.log(`\n  ${lijst.length} storing${lijst.length === 1 ? '' : 'en'}`);
      console.log(`  ${'─'.repeat(66)}`);
      for (const storing of lijst.slice(0, 12)) {
        console.log(`  • ${storing.titel}`);
        if (storing.bericht && storing.bericht !== storing.titel) console.log(`    ${storing.bericht}`);
      }
      console.log('');
      return 0;
    }

    case 'stations': {
      const zoek = rest[0];
      const lijst = await zoekStations(zoek ?? '');
      for (const station of lijst) console.log(`  ${String(station.code).padEnd(5)} ${station.naam}`);
      console.log('');
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
