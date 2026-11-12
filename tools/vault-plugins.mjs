#!/usr/bin/env node
/**
 * De plugins van de vault installeren.
 *
 * Obsidian-plugins zijn losse mappen in `.obsidian/plugins/<id>/` met daarin
 * `main.js`, `manifest.json` en soms `styles.css`. Ze staan als losse
 * bestanden bij de releases op GitHub, dus dit script haalt precies die drie op
 * — geen zip uitpakken, geen omweg.
 *
 * Alleen plugins uit deze lijst. Een plugin krijgt volledige toegang tot je
 * vault (en je systeem), dus "gewoon alles installeren" is geen goed idee.
 *
 *   node tools/vault-plugins.mjs            # installeren wat ontbreekt
 *   node tools/vault-plugins.mjs --update   # alles bijwerken naar de nieuwste
 *   node tools/vault-plugins.mjs --lijst    # laten zien wat er is
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.resolve(HIER, '..', 'vault');
const PLUGINS = path.join(VAULT, '.obsidian', 'plugins');

/**
 * De lijst. Bewust kort: elke plugin is een stuk code dat je vertrouwt.
 */
const LIJST = [
  {
    id: 'dataview',
    repo: 'blacksmithgu/obsidian-dataview',
    waarom: 'Tabellen en lijsten uit je eigen notities (de vraagbaak op de startpagina)',
  },
  {
    id: 'templater-obsidian',
    repo: 'SilentVoid13/Templater',
    waarom: 'Sjablonen met datum en variabelen, één sneltoets per notitie',
  },
  {
    id: 'obsidian-tasks-plugin',
    repo: 'obsidian-tasks-group/obsidian-tasks',
    waarom: 'Checkboxes met een deadline, die je overal terugziet',
  },
  {
    id: 'omnisearch',
    repo: 'scambier/obsidian-omnisearch',
    waarom: 'Zoeken dat ook in PDF\'s en bijlagen kijkt, met relevantie',
  },
  {
    id: 'quickadd',
    repo: 'chhoumann/quickadd',
    waarom: 'Snel een taak of notitie vastleggen zonder de vault te verlaten',
  },
  {
    id: 'obsidian-style-settings',
    repo: 'mgmeyers/obsidian-style-settings',
    waarom: 'Thema-instellingen zonder CSS te hoeven schrijven',
  },
];

const update = process.argv.includes('--update');
const lijst = process.argv.includes('--lijst');

async function haal(url) {
  const antwoord = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cavascp-vault',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!antwoord.ok) throw new Error(`${antwoord.status} bij ${url}`);
  return antwoord;
}

async function installeer(plugin) {
  const doel = path.join(PLUGINS, plugin.id);
  const manifestPad = path.join(doel, 'manifest.json');

  const release = await (await haal(`https://api.github.com/repos/${plugin.repo}/releases/latest`)).json();
  const versie = release.tag_name;

  if (existsSync(manifestPad) && !update) {
    const huidig = JSON.parse(readFileSync(manifestPad, 'utf8'));
    console.log(`  ·  ${plugin.id.padEnd(24)} ${huidig.version ?? '?'} (al geïnstalleerd)`);
    return;
  }

  const bestanden = (release.assets ?? []).filter((asset) =>
    ['main.js', 'manifest.json', 'styles.css'].includes(asset.name),
  );

  if (!bestanden.some((b) => b.name === 'main.js')) {
    throw new Error(`${plugin.id}: geen main.js in de release`);
  }

  mkdirSync(doel, { recursive: true });

  for (const bestand of bestanden) {
    const inhoud = Buffer.from(await (await haal(bestand.browser_download_url)).arrayBuffer());
    writeFileSync(path.join(doel, bestand.name), inhoud);
  }

  console.log(`  +  ${plugin.id.padEnd(24)} ${versie} (${bestanden.length} bestanden)`);
}

function schrijfInstellingen() {
  const map = path.join(VAULT, '.obsidian');
  mkdirSync(map, { recursive: true });

  const communityPad = path.join(map, 'community-plugins.json');
  const bestaand = existsSync(communityPad) ? JSON.parse(readFileSync(communityPad, 'utf8')) : [];
  const samen = [...new Set([...bestaand, ...LIJST.map((p) => p.id)])];
  writeFileSync(communityPad, `${JSON.stringify(samen, null, 2)}\n`);

  const appPad = path.join(map, 'app.json');
  if (!existsSync(appPad)) {
    writeFileSync(
      appPad,
      `${JSON.stringify(
        {
          newFileLocation: 'folder',
          newFileFolderPath: '02 Logboek',
          attachmentFolderPath: '99 Bijlagen',
          alwaysUpdateLinks: true,
          showUnsupportedFiles: true,
        },
        null,
        2,
      )}\n`,
    );
  }

  const corePad = path.join(map, 'core-plugins.json');
  if (!existsSync(corePad)) {
    writeFileSync(
      corePad,
      `${JSON.stringify(
        {
          'file-explorer': true,
          'global-search': true,
          switcher: true,
          graph: true,
          backlink: true,
          'outgoing-link': true,
          'page-preview': true,
          templates: true,
          'daily-notes': true,
          'command-palette': true,
          'editor-status': true,
          bookmarks: true,
          outline: true,
          'word-count': true,
          'file-recovery': true,
          bases: true,
        },
        null,
        2,
      )}\n`,
    );
  }
}

if (lijst) {
  console.log('\n  Plugins in de vault:\n');
  for (const plugin of LIJST) {
    const manifestPad = path.join(PLUGINS, plugin.id, 'manifest.json');
    const versie = existsSync(manifestPad) ? JSON.parse(readFileSync(manifestPad, 'utf8')).version : '—';
    console.log(`  ${plugin.id.padEnd(24)} ${String(versie).padEnd(10)} ${plugin.waarom}`);
  }
  console.log('');
  process.exit(0);
}

console.log(`\n  Plugins installeren in ${PLUGINS}${update ? ' (bijwerken)' : ''}\n`);

let mislukt = 0;
for (const plugin of LIJST) {
  try {
    await installeer(plugin);
  } catch (fout) {
    mislukt += 1;
    console.log(`  !  ${plugin.id.padEnd(24)} ${fout.message}`);
  }
}

schrijfInstellingen();

console.log(
  `\n  ${LIJST.length - mislukt} van ${LIJST.length} geïnstalleerd.` +
    (mislukt ? ` ${mislukt} mislukt — probeer het later opnieuw.` : '') +
    '\n',
);
process.exit(mislukt ? 1 : 0);
