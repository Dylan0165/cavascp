#!/usr/bin/env node
/**
 * Controleert of de cavascp-regel nog goed in het DSH-profiel staat.
 *
 * WAAROM VIA `dsh --dump-config`
 *
 * Een eerdere versie parseerde cordis.patch.yml zelf met het `yaml`-pakket.
 * Dat werkt alleen als dat pakket toevallig in ~/.dsh/profiles/node_modules
 * staat, en het keurt de verkeerde laag: het bestand kan geldige YAML zijn en
 * toch niet laden, bijvoorbeeld door een verkeerd pad of een pluginnaam die
 * niet bestaat.
 *
 * `dsh --profile web --dump-config` laat de loader zelf alle patchlagen
 * samenstellen. Een YAML-fout, een onbekend veld of een ontbrekende plugin
 * komt daar als niet-nul exitcode uit — en dat is precies het scenario dat je
 * wilt voorkomen: een typefout die pas bij de eerstvolgende herstart blijkt,
 * als de GUI niet meer opkomt.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ENV_PAD } from './lib/paden.mjs';

const PROFIEL = process.env.DSH_PROFILE || 'web';

let dump;
try {
  dump = execFileSync('dsh', ['--profile', PROFIEL, '--dump-config'], {
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (fout) {
  console.log('FOUT: de profielconfiguratie laadt niet');
  const detail = String(fout.stderr || fout.message).trim().split('\n').slice(-10).join('\n');
  if (detail) console.log(detail);
  process.exit(1);
}

console.log(`profiel "${PROFIEL}" laadt: OK`);

/*
 * Het mcp-cavascp-blok uit de samengestelde boom halen. Regelgewijs, want het
 * gaat om één rij met vaste velden; een YAML-parser zou hier alleen maar een
 * afhankelijkheid toevoegen.
 */
const regels = dump.split('\n');
const start = regels.findIndex((r) => r.trim() === '- id: mcp-cavascp');
if (start === -1) {
  console.log('FOUT: mcp-cavascp staat niet in het profiel');
  process.exit(1);
}

let eind = regels.length;
for (let i = start + 1; i < regels.length; i += 1) {
  if (/^- (id|insert):/.test(regels[i])) {
    eind = i;
    break;
  }
}
const blok = regels.slice(start, eind).join('\n');

console.log('');
console.log(`mcp-cavascp (regel ${start + 1} van de samengestelde configuratie):`);
for (const regel of blok.split('\n')) console.log(`  ${regel}`);

const eisen = [
  ['@deepseek-ai/dsh-mcp-client', 'de client-pluginnaam'],
  ['serverName: cavascp', 'serverName'],
  ['transport: stdio', 'transport'],
  ['server.mjs', 'een pad naar server.mjs in args'],
];

const problemen = eisen.filter(([fragment]) => !blok.includes(fragment)).map(([, wat]) => `${wat} ontbreekt`);

/*
 * Geen `env` is goed: mcp/server.mjs leest het token zelf uit <project>/.env,
 * omdat DSH ambient *TOKEN*-variabelen wegfiltert voordat het proces start.
 * Staat er wél een env, dan moet het een !!js-expressie zijn.
 */
const heeftEnv = /^\s+env:/m.test(blok);
if (heeftEnv && !blok.includes('!!js')) problemen.push('env staat er wel, maar niet als !!js-expressie');

const envPad = ENV_PAD;
const tokenInEnv = existsSync(envPad);
console.log('');
console.log(`tokenbestand: ${path.relative(process.cwd(), envPad) || envPad} — ${tokenInEnv ? 'gevonden' : 'ONTBREEKT'}`);
if (!tokenInEnv) problemen.push(`geen .env op ${envPad}, dus de server start zonder token`);

console.log('');
if (problemen.length) {
  console.log(`PROBLEMEN: ${problemen.join('; ')}`);
  process.exit(1);
}
console.log('CONFIG OK');
