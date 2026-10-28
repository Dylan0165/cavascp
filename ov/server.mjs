#!/usr/bin/env node
/**
 * ov-mcp — reisadvies uit onze eigen dienstregeling.
 *
 * Waarom niet de NS-API: die vraagt een sleutel via een portaal dat niet
 * werkte. Daarom halen we de dienstregeling op als open data (GTFS via OVapi),
 * rekenen we de reis zelf uit, en zetten we dat achter een MCP zodat je het in
 * de chat kunt vragen.
 *
 * De data staat in data/ov/net.json en wordt gemaakt door ov/import.mjs.
 *
 *   node ov/server.mjs --selftest    # alle tools één keer, leesbaar
 *   node ov/server.mjs               # stdio, voor DSH
 */

import { laadNet, plan, zoekHaltes, isGeimporteerd, netPad, volgendeWerkdag, alsTijd } from './lib/planner.mjs';

const SERVER_NAME = 'ov';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

function tabel(koppen, rijen) {
  return [
    `| ${koppen.join(' | ')} |`,
    `|${koppen.map(() => '---').join('|')}|`,
    ...rijen.map((rij) => `| ${rij.join(' | ')} |`),
  ].join('\n');
}

function legRegel(leg) {
  const trein = [leg.lijn, leg.vervoerder].filter(Boolean).join(' · ');
  return `- ${leg.vertrek} → ${leg.aankomst}  ${trein || 'trein'}  ${leg.van} → ${leg.naar}`;
}

async function toolReisadvies({ van, naar, vertrek, datum, aantal = 3 } = {}) {
  if (!van || !naar) throw new Error('Geef een van- en een naar-station.');
  const net = laadNet();
  const dag = datum ? new Date(datum) : undefined;
  const reizen = plan(net, { van, naar, datum: dag, vertrek: vertrek ?? '08:30', aantal });

  if (!reizen.length) return `Geen reis gevonden van ${van} naar ${naar}.`;

  const regels = [
    `# ${reizen[0].van} → ${reizen[0].naar}`,
    '',
    tabel(
      ['#', 'Vertrek', 'Aankomst', 'Reistijd', 'Overstappen'],
      reizen.map((reis, i) => [
        String(i + 1),
        reis.vertrek,
        reis.aankomst,
        `${reis.minuten} min`,
        String(reis.overstappen),
      ]),
    ),
    '',
  ];

  reizen.forEach((reis, i) => {
    regels.push(`**Optie ${i + 1}**`);
    for (const leg of reis.legs) regels.push(legRegel(leg));
    regels.push('');
  });

  return regels.join('\n');
}

async function toolReistijd({ van = 'Roosendaal', naar, vertrek = '08:30' } = {}) {
  if (!naar) throw new Error('Geef een bestemming.');
  const net = laadNet();
  const reizen = plan(net, { van, naar, vertrek, aantal: 2 });
  if (!reizen.length) return `Geen reis gevonden van ${van} naar ${naar}.`;

  const snel = reizen[0];
  return [
    `**${van} → ${naar}: ${snel.minuten} minuten, ${snel.overstappen} overstap${snel.overstappen === 1 ? '' : 'pen'}**`,
    '',
    `Vertrek ${snel.vertrek}, aankomst ${snel.aankomst}.`,
  ].join('\n');
}

async function toolStations({ zoek } = {}) {
  const net = laadNet();
  const haltes = zoekHaltes(net, zoek ?? '');
  if (!haltes.length) return `Geen halte gevonden voor "${zoek}".`;

  const namen = [...new Set(haltes.map((i) => net.stops[i].naam))].slice(0, 25);
  return [`# Haltes${zoek ? ` met "${zoek}"` : ''}`, '', ...namen.map((n) => `- ${n}`)].join('\n');
}

async function toolStatus() {
  if (!isGeimporteerd()) {
    return [
      '# OV-koppeling',
      '',
      '**Geen dienstregeling gevonden.**',
      '',
      'Draai eenmalig:',
      '',
      '```',
      'node ov/import.mjs',
      '```',
      '',
      'Dat haalt de open data van OVapi op (ongeveer 200 MB) en houdt de treinen',
      'rond Roosendaal over (een paar MB).',
    ].join('\n');
  }

  const net = laadNet();
  const dag = volgendeWerkdag();
  const reizen = plan(net, { van: 'Roosendaal', naar: 'Breda', vertrek: '08:30', aantal: 1 });

  return [
    '# OV-koppeling',
    '',
    `- **Dienstregeling**: ${net.reizen.length} treinreizen, ${net.stops.length} haltes`,
    `- **Bron**: ${net.bron}`,
    `- **Gegenereerd**: ${net.gegenereerd?.slice(0, 10) ?? '?'}`,
    `- **Proefvraag**: Roosendaal → Breda ${reizen[0] ? `om ${reizen[0].vertrek}, ${reizen[0].minuten} min` : 'geen reis'}`,
    `- **Peildatum**: ${dag.toISOString().slice(0, 10)}`,
  ].join('\n');
}

const TOOLS = [
  {
    name: 'ov_reisadvies',
    description:
      'Reisadvies met de trein tussen twee stations, uit de eigen dienstregeling (open data). Geeft vertrek, aankomst, reistijd en overstappen.',
    inputSchema: {
      type: 'object',
      properties: {
        van: { type: 'string', description: 'Vertrekstation, bijvoorbeeld "Roosendaal".' },
        naar: { type: 'string', description: 'Bestemmingsstation, bijvoorbeeld "Breda".' },
        vertrek: { type: 'string', description: 'Vertrektijd als "HH:MM" (default 08:30).' },
        datum: { type: 'string', description: 'Datum als JJJJ-MM-DD; leeg = volgende werkdag.' },
        aantal: { type: 'number', description: 'Aantal opties (1-5, default 3).' },
      },
      required: ['van', 'naar'],
    },
  },
  {
    name: 'ov_reistijd',
    description: 'De snelste reistijd tussen twee stations in één regel.',
    inputSchema: {
      type: 'object',
      properties: {
        van: { type: 'string', description: 'Vertrekstation (default Roosendaal).' },
        naar: { type: 'string' },
        vertrek: { type: 'string', description: 'Vertrektijd als "HH:MM" (default 08:30).' },
      },
      required: ['naar'],
    },
  },
  {
    name: 'ov_stations',
    description: 'Zoek stations in de dienstregeling.',
    inputSchema: {
      type: 'object',
      properties: { zoek: { type: 'string', description: 'Deel van de naam, bijvoorbeeld "breda".' } },
    },
  },
  {
    name: 'ov_status',
    description: 'Controleert of de dienstregeling aanwezig is en of er een reis uit komt.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const HANDLERS = {
  ov_reisadvies: toolReisadvies,
  ov_reistijd: toolReistijd,
  ov_stations: toolStations,
  ov_status: toolStatus,
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
      const reply = HANDLERS[naam];
      if (!reply) return fail(id, -32602, `Onbekende tool: ${naam}`);
      try {
        const tekst = await reply(params?.arguments ?? {});
        return ok(id, { content: [{ type: 'text', text: tekst }] });
      } catch (fout) {
        return ok(id, {
          content: [{ type: 'text', text: `**OV-fout**: ${fout?.message ?? String(fout)}` }],
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

async function selftest() {
  console.log('');
  console.log('  ov-mcp — zelftest');
  console.log('  ' + '─'.repeat(60));
  console.log(`  dienstregeling: ${netPad()}`);

  for (const tool of TOOLS) {
    const args =
      tool.name === 'ov_reisadvies'
        ? { van: 'Roosendaal', naar: 'Breda' }
        : tool.name === 'ov_reistijd'
          ? { naar: 'Breda' }
          : tool.name === 'ov_stations'
            ? { zoek: 'breda' }
            : {};
    try {
      const tekst = await HANDLERS[tool.name](args);
      console.log(`\n  ${tool.name}`);
      console.log(
        String(tekst)
          .split('\n')
          .slice(0, 7)
          .map((r) => `  ${r}`)
          .join('\n'),
      );
    } catch (fout) {
      console.log(`\n  ${tool.name}: FOUT — ${fout.message}`);
    }
  }
  console.log('');
}

if (process.argv.includes('--selftest')) {
  await selftest();
} else {
  await serveStdio();
}
