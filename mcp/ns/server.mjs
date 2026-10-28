#!/usr/bin/env node
/**
 * ns-mcp — reisadvies, storingen en vertrektijden van de NS.
 *
 * Waarom een tweede MCP-server en niet erbij in cavascp: dit is een andere
 * bron met een andere sleutel en een ander ritme (reistijden veranderen per
 * minuut, portfolio-deadlines per maand). Een eigen server betekent ook dat
 * je hem kunt uitzetten zonder je portfolio te raken.
 *
 * Geen afhankelijkheden: het MCP-protocol is hier direct op stdio
 * geïmplementeerd, net als bij de cavascp-server.
 *
 *   node mcp/ns/server.mjs --selftest     # alle tools één keer, leesbaar
 *   node mcp/ns/server.mjs               # stdio, voor DSH
 */

import { reisadvies, snelsteReis, storingen, vertrekken, zoekStations, nsBeschikbaar, vindNsSleutel, NsError } from './lib/client.mjs';

const SERVER_NAME = 'ns';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

/* ────────────────────────────── formatteren ───────────────────────────── */

const tijd = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : '—';

const datumTijd = (iso) =>
  iso ? new Date(iso).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

function tabel(koppen, rijen) {
  const kop = `| ${koppen.join(' | ')} |`;
  const scheiding = `|${koppen.map(() => '---').join('|')}|`;
  return [kop, scheiding, ...rijen.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/* ──────────────────────────────── tools ───────────────────────────────── */

async function toolReisadvies({ van, naar, vertrek, aankomst, aantal = 3 } = {}) {
  if (!van || !naar) throw new NsError('Geef een van- en een naar-station.');
  const reizen = await reisadvies({ van, naar, vertrek, aankomst, aantal });
  if (!reizen.length) return `Geen reizen gevonden van ${van} naar ${naar}.`;

  const regels = [
    `# ${reizen[0].van ?? van} → ${reizen[0].naar ?? naar}`,
    '',
    tabel(
      ['#', 'Vertrek', 'Aankomst', 'Reistijd', 'Overstappen', 'Bijzonder'],
      reizen.map((reis) => [
        String(reis.nummer),
        tijd(reis.vertrek),
        tijd(reis.aankomst),
        reis.minuten != null ? `${reis.minuten} min` : '—',
        String(reis.overstappen),
        [reis.geannuleerd ? 'vervalt' : null, reis.vertragingMinuten ? `+${reis.vertragingMinuten} min` : null]
          .filter(Boolean)
          .join(', ') || '—',
      ]),
    ),
    '',
  ];

  for (const reis of reizen) {
    regels.push(`**Optie ${reis.nummer}**`);
    for (const stuk of reis.vol) {
      const trein = [stuk.soort, stuk.lijn].filter(Boolean).join(' ') || 'trein';
      regels.push(
        `- ${trein}${stuk.richting ? ` richting ${stuk.richting}` : ''} — ` +
          `${stuk.van ?? '?'}${stuk.vertrekSpoor ? ` (spoor ${stuk.vertrekSpoor})` : ''} → ` +
          `${stuk.naar ?? '?'}${stuk.minuten != null ? ` · ${stuk.minuten} min` : ''}`,
      );
    }
    regels.push('');
  }

  return regels.join('\n');
}

async function toolReistijd({ van = 'Roosendaal', naar } = {}) {
  if (!naar) throw new NsError('Geef een bestemming.');
  const reizen = await reisadvies({ van, naar, aantal: 3 });
  const snel = snelsteReis(reizen);
  if (!snel) return `Geen reis gevonden van ${van} naar ${naar}.`;

  return [
    `**${van} → ${naar}: ${snel.minuten} minuten, ${snel.overstappen} overstap${snel.overstappen === 1 ? '' : 'pen'}**`,
    '',
    `Vertrek ${tijd(snel.vertrek)}, aankomst ${tijd(snel.aankomst)}.`,
  ].join('\n');
}

async function toolStoringen({ station } = {}) {
  const lijst = await storingen({ station });
  if (!lijst.length) return station ? `Geen storingen rond ${station}.` : 'Geen actieve storingen.';

  return [
    station ? `# Storingen rond ${station}` : '# Actuele storingen',
    '',
    ...lijst.slice(0, 15).map((s) => {
      const periode = s.van || s.tot ? ` (${datumTijd(s.van)} – ${datumTijd(s.tot)})` : '';
      return `- **${s.titel}**${periode}${s.bericht ? `\n  ${s.bericht}` : ''}`;
    }),
  ].join('\n');
}

async function toolVertrektijden({ station, richting, aantal = 8 } = {}) {
  if (!station) throw new NsError('Geef een station.');
  const lijst = await vertrekken({ station, richting, aantal });
  if (!lijst.length) return `Geen vertrektijden gevonden voor ${station}.`;

  return [
    `# Vertrekken vanaf ${station}`,
    '',
    tabel(
      ['Tijd', 'Richting', 'Soort', 'Spoor', 'Bijzonder'],
      lijst.map((t) => [
        tijd(t.vertrek),
        t.richting ?? '—',
        t.soort ?? '—',
        t.spoor ?? '—',
        [t.geannuleerd ? 'vervalt' : null, t.vertragingMinuten ? `+${t.vertragingMinuten} min` : null]
          .filter(Boolean)
          .join(', ') || '—',
      ]),
    ),
  ].join('\n');
}

async function toolStations({ zoek } = {}) {
  const lijst = await zoekStations(zoek ?? '');
  if (!lijst.length) return `Geen station gevonden voor "${zoek}".`;
  return [
    `# Stations${zoek ? ` met "${zoek}"` : ''}`,
    '',
    ...lijst.map((s) => `- **${s.naam}** (${s.code})${s.kort ? ` — ${s.kort}` : ''}`),
  ].join('\n');
}

async function toolStatus() {
  const sleutel = vindNsSleutel();
  if (!sleutel) {
    return [
      '# NS-koppeling',
      '',
      '**Geen sleutel gevonden.**',
      '',
      'Maak er een op <https://apiportal.ns.nl> (gratis product "Ns-App") en zet in `.env`:',
      '',
      '```',
      'NS_SUBSCRIPTION_KEY=...',
      '```',
    ].join('\n');
  }

  const reizen = await reisadvies({ van: 'Roosendaal', naar: 'Breda', aantal: 1 });
  return [
    '# NS-koppeling',
    '',
    `- **Sleutel**: gevonden (${sleutel.bron === 'omgeving' ? 'uit de omgeving' : 'uit een .env-bestand'})`,
    `- **Proefvraag**: Roosendaal → Breda, ${reizen[0]?.minuten ?? '?'} minuten`,
  ].join('\n');
}

const TOOLS = [
  {
    name: 'ns_reisadvies',
    description:
      'Reisadvies tussen twee stations: vertrek- en aankomsttijd, reistijd, overstappen en de treinen per optie. Werkt met stationsnamen of codes.',
    inputSchema: {
      type: 'object',
      properties: {
        van: { type: 'string', description: 'Vertrekstation, bijvoorbeeld "Roosendaal".' },
        naar: { type: 'string', description: 'Bestemmingsstation, bijvoorbeeld "Breda".' },
        vertrek: { type: 'string', description: 'ISO-datum/tijd van vertrek; leeg = nu.' },
        aankomst: { type: 'string', description: 'Uiterste aankomsttijd; dan zoekt NS terug.' },
        aantal: { type: 'number', description: 'Aantal opties (1-5, default 3).' },
      },
      required: ['van', 'naar'],
    },
  },
  {
    name: 'ns_reistijd',
    description: 'De snelste reistijd tussen twee stations in één regel. Handig om te zien of een stageplek bereikbaar is.',
    inputSchema: {
      type: 'object',
      properties: {
        van: { type: 'string', description: 'Vertrekstation (default Roosendaal).' },
        naar: { type: 'string', description: 'Bestemmingsstation.' },
      },
      required: ['naar'],
    },
  },
  {
    name: 'ns_storingen',
    description: 'Actuele storingen en werkzaamheden, eventueel gefilterd op station.',
    inputSchema: {
      type: 'object',
      properties: { station: { type: 'string', description: 'Station of plaats om op te filteren.' } },
    },
  },
  {
    name: 'ns_vertrektijden',
    description: 'De eerstvolgende vertrektijden vanaf een station.',
    inputSchema: {
      type: 'object',
      properties: {
        station: { type: 'string' },
        richting: { type: 'string', description: 'Filter op richting (deel van de naam).' },
        aantal: { type: 'number', description: 'Aantal vertrekken (1-20, default 8).' },
      },
      required: ['station'],
    },
  },
  {
    name: 'ns_stations',
    description: 'Zoek stations op naam of code.',
    inputSchema: {
      type: 'object',
      properties: { zoek: { type: 'string', description: 'Deel van de naam of de code, bijvoorbeeld "breda".' } },
    },
  },
  {
    name: 'ns_status',
    description: 'Controleert of de NS-koppeling werkt: is er een sleutel en antwoordt de API.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const HANDLERS = {
  ns_reisadvies: toolReisadvies,
  ns_reistijd: toolReistijd,
  ns_storingen: toolStoringen,
  ns_vertrektijden: toolVertrektijden,
  ns_stations: toolStations,
  ns_status: toolStatus,
};

/* ──────────────────────────── MCP plumbing ─────────────────────────────── */

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(message) {
  const { id, method, params } = message;

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });

    case 'notifications/initialized':
    case 'initialized':
      return null;

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, { tools: TOOLS });

    case 'tools/call': {
      const naam = params?.name;
      const args = params?.arguments ?? {};
      const handler = HANDLERS[naam];
      if (!handler) return fail(id, -32602, `Onbekende tool: ${naam}`);
      try {
        const tekst = await handler(args);
        return ok(id, { content: [{ type: 'text', text: tekst }] });
      } catch (fout) {
        if (fout instanceof NsError) {
          return ok(id, { content: [{ type: 'text', text: `**NS-fout**: ${fout.message}` }], isError: true });
        }
        return ok(id, {
          content: [{ type: 'text', text: `**Fout**: ${fout?.message ?? String(fout)}` }],
          isError: true,
        });
      }
    }

    default:
      if (id === undefined || id === null) return null;
      return fail(id, -32601, `Onbekende methode: ${method}`);
  }
}

function write(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function serveStdio() {
  let buffer = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        write(fail(null, -32700, 'Parse error'));
        continue;
      }

      handle(message)
        .then((response) => {
          if (response) write(response);
        })
        .catch((error) => {
          if (message?.id !== undefined) write(fail(message.id, -32603, error?.message ?? 'Interne fout'));
        });
    }
  });

  process.stdin.on('end', () => process.exit(0));
}

/* ─────────────────────────────── selftest ──────────────────────────────── */

async function selftest() {
  console.log('');
  console.log('  ns-mcp — zelftest');
  console.log('  ' + '─'.repeat(60));

  if (!nsBeschikbaar()) {
    console.log('  Geen NS-sleutel gevonden.');
    console.log('  Zet NS_SUBSCRIPTION_KEY in .env (zie docs/ov.md).');
    console.log('');
    process.exit(1);
  }

  for (const tool of TOOLS) {
    const args =
      tool.name === 'ns_reisadvies'
        ? { van: 'Roosendaal', naar: 'Breda' }
        : tool.name === 'ns_reistijd'
          ? { naar: 'Breda' }
          : tool.name === 'ns_vertrektijden'
            ? { station: 'Roosendaal', aantal: 3 }
            : tool.name === 'ns_stations'
              ? { zoek: 'breda' }
              : tool.name === 'ns_storingen'
                ? {}
                : {};

    try {
      const tekst = await HANDLERS[tool.name](args);
      console.log(`\n  ${tool.name}`);
      console.log(
        String(tekst)
          .split('\n')
          .slice(0, 8)
          .map((r) => `  ${r}`)
          .join('\n'),
      );
    } catch (fout) {
      console.log(`\n  ${tool.name}: FOUT — ${fout.message}`);
    }
  }

  console.log('');
}

/* ──────────────────────────────── start ────────────────────────────────── */

if (process.argv.includes('--selftest')) {
  await selftest();
} else {
  await serveStdio();
}
