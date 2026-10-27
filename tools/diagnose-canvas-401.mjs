#!/usr/bin/env node
/**
 * Zoekt uit waarom Canvas 401 zegt terwijl het token werkt.
 *
 * Probeert hetzelfde token met verschillende verzoeken, en laat per verzoek de
 * status zien. Zo zie je of het aan het token ligt, aan de parameters, of aan
 * iets anders.
 *
 *   node tools/diagnose-canvas-401.mjs
 */

import { loadEnvFile, createCanvas } from '../mcp/lib/canvas.mjs';
import { vindEnv, ENV_PAD } from '../mcp/lib/paden.mjs';

const pad = vindEnv() ?? ENV_PAD;
const env = await loadEnvFile(pad);
const token = env.CANVAS_TOKEN;
const base = env.CANVAS_BASE_URL || 'https://fhict.instructure.com';

console.log(`env         : ${pad}`);
console.log(`token lengte: ${token?.length ?? 0}`);
console.log(`basis       : ${base}`);
console.log('');

const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

async function probe(label, url, extraHeaders = {}) {
  try {
    const r = await fetch(url, { headers: { ...headers, ...extraHeaders } });
    const tekst = await r.text();
    let kort = tekst.slice(0, 120).replace(/\s+/g, ' ');
    console.log(`  ${String(r.status).padEnd(4)} ${label}`);
    if (r.status !== 200) console.log(`       ${kort}`);
    return r.status;
  } catch (fout) {
    console.log(`  FOUT ${label}: ${fout.message}`);
    return 0;
  }
}

console.log('=== met fetch, plat ===');
await probe('/users/self', `${base}/api/v1/users/self`);
await probe('/courses', `${base}/api/v1/courses`);
await probe('/courses?per_page=50', `${base}/api/v1/courses?per_page=50`);
await probe('/courses?enrollment_state=active', `${base}/api/v1/courses?enrollment_state=active`);
await probe('/courses?include[]=term', `${base}/api/v1/courses?include%5B%5D=term`);

console.log('');
console.log('=== met dezelfde user-agent als de client ===');
await probe(
  '/courses met UA cavascp-mcp',
  `${base}/api/v1/courses`,
  { 'User-Agent': 'cavascp-mcp/1.0 (+lokaal, read-only)' },
);

console.log('');
console.log('=== via de canvas-client zelf ===');
const canvas = createCanvas({ baseUrl: base, token });
try {
  const zelf = await canvas.get('/courses', { per_page: 5 });
  console.log(`  OK — ${Array.isArray(zelf) ? zelf.length : '?'} cursussen`);
} catch (fout) {
  console.log(`  FOUT — ${fout.message} (status ${fout.status ?? '?'})`);
}

try {
  const metParams = await canvas.get('/courses', {
    enrollment_state: 'active',
    per_page: 5,
    'include[]': ['term'],
  });
  console.log(`  OK met parameters — ${Array.isArray(metParams) ? metParams.length : '?'} cursussen`);
} catch (fout) {
  console.log(`  FOUT met parameters — ${fout.message} (status ${fout.status ?? '?'})`);
}
