#!/usr/bin/env node
/**
 * De OV-module vanaf de commandoregel.
 *
 *   node ov/cli.mjs reis Roosendaal Breda
 *   node ov/cli.mjs reistijd Breda
 *   node ov/cli.mjs stations breda
 *   node ov/cli.mjs status
 *   node ov/cli.mjs import
 *
 * Zelfde planner als de MCP-server en het stage-scherm, zodat een reistijd
 * overal hetzelfde is.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { laadNet, plan, zoekHaltes, isGeimporteerd, netPad, volgendeWerkdag } from './lib/planner.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const [, , commando, ...rest] = process.argv;

function gebruik() {
  console.log(`
  OV — reizen met de trein, uit eigen dienstregeling

    node ov/cli.mjs reis <van> <naar> [--om 08:30] [--datum 2026-11-02]
    node ov/cli.mjs reistijd <naar> [--van Roosendaal] [--om 08:30]
    node ov/cli.mjs stations <zoekterm>
    node ov/cli.mjs status
    node ov/cli.mjs import              haalt de nieuwste dienstregeling op

  Voorbeeld:
    node ov/cli.mjs reis Roosendaal Breda
`);
}

function vlag(naam) {
  const index = rest.indexOf(naam);
  return index === -1 ? undefined : rest[index + 1];
}

async function main() {
  switch (commando) {
    case 'import': {
      const uitkomst = spawnSync(process.execPath, [path.join(HIER, 'import.mjs')], { stdio: 'inherit' });
      return uitkomst.status ?? 1;
    }

    case 'status': {
      if (!isGeimporteerd()) {
        console.log('\n  Geen dienstregeling. Draai: node ov/import.mjs\n');
        return 1;
      }
      const net = laadNet();
      console.log(`\n  ${net.reizen.length} treinreizen, ${net.stops.length} haltes`);
      console.log(`  bron: ${net.bron}`);
      console.log(`  gegenereerd: ${net.gegenereerd}`);
      console.log(`  peildatum: ${volgendeWerkdag().toISOString().slice(0, 10)}\n`);
      return 0;
    }

    case 'stations': {
      const net = laadNet();
      const haltes = zoekHaltes(net, rest[0] ?? '');
      const namen = [...new Set(haltes.map((i) => net.stops[i].naam))].slice(0, 20);
      for (const naam of namen) console.log(`  ${naam}`);
      return 0;
    }

    case 'reis': {
      const net = laadNet();
      const [van, naar] = rest.filter((r) => !r.startsWith('--') && r !== vlag('--om') && r !== vlag('--datum'));
      if (!van || !naar) {
        gebruik();
        return 1;
      }
      const datum = vlag('--datum') ? new Date(vlag('--datum')) : undefined;
      const reizen = plan(net, { van, naar, datum, vertrek: vlag('--om') ?? '08:30', aantal: 4 });

      console.log(`\n  ${van} → ${naar}`);
      console.log(`  ${'─'.repeat(60)}`);
      if (!reizen.length) {
        console.log('  geen reis gevonden');
        console.log('');
        return 0;
      }

      for (const [i, reis] of reizen.entries()) {
        console.log(
          `  ${i + 1}. ${reis.vertrek} → ${reis.aankomst}   ${String(reis.minuten).padStart(3)} min   ` +
            `${reis.overstappen} overstap${reis.overstappen === 1 ? '' : 'pen'}`,
        );
        for (const leg of reis.legs) {
          console.log(
            `       ${[leg.lijn, leg.vervoerder].filter(Boolean).join(' · ') || 'trein'}  ` +
              `${leg.van} → ${leg.naar}  (${leg.vertrek}–${leg.aankomst})`,
          );
        }
      }
      console.log('');
      return 0;
    }

    case 'reistijd': {
      const net = laadNet();
      const naar = rest.find((r) => !r.startsWith('--') && r !== vlag('--om') && r !== vlag('--van'));
      if (!naar) {
        gebruik();
        return 1;
      }
      const van = vlag('--van') ?? 'Roosendaal';
      const reizen = plan(net, { van, naar, vertrek: vlag('--om') ?? '08:30', aantal: 2 });
      if (!reizen.length) {
        console.log(`\n  Geen reis van ${van} naar ${naar}.\n`);
        return 1;
      }
      const snel = reizen[0];
      console.log(
        `\n  ${van} → ${naar}: ${snel.minuten} minuten, ${snel.overstappen} overstap` +
          `${snel.overstappen === 1 ? '' : 'pen'}  (${snel.vertrek} → ${snel.aankomst})\n`,
      );
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
